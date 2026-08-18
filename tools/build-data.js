// Regenerates docs/data.js from the three vendored mhgu-editor JSONs.
// Run: node tools/build-data.js
//
// Emits window.MHGU_TALISMAN_DATA = { dataVersion, tiers, trees, names, goals }.
//
// `tiers` is the sparse charm table roll.js expects. `goals` is the authoritative list of
// every tile this app can ever put on a card. Each goal is a CONDITION — a set of optional
// fields that are ANDed — plus `pt`, the probability that one drawn charm satisfies it
// GIVEN the draw came from each of the four tiers.
//
// Why per-tier rather than one number: the tier weights are a user control, so the real hit
// rate is sum(weight_t * pt[t]) and can only be known at runtime. Baking the four
// conditionals lets the browser combine them with a dot product instead of simulating.
//
// These are computed exactly, not by Monte Carlo. rollCharm is simple enough to integrate
// in closed form, and an exact number means the probability floor is a hard guarantee
// rather than a sampling estimate — a goal at 1-in-500 measured over 400k rolls has seen
// only ~800 hits, which is not enough to trust the tail. (The closed form was cross-checked
// against a 400k-roll simulation of the real roller: 1-in-3 / 14 / 86 predicted for the
// slot goals against 1-in-3 / 14 / 83 measured.)
//
// GOAL CONDITION FIELDS — every one present must hold, and app.js's satisfies() is the
// runtime twin of the probability maths here. Keep the two in step.
//   a    tree id the charm must carry
//   b    minimum points for tree `a` (default 1)
//   s    minimum slot count
//   r    minimum rarity        rx  maximum rarity        re  exact rarity
//   tr   exact roll tier
//   n    exact number of skills
//   pos  every skill on the charm is positive
//   neg  some skill is at or below this (negative) value
//   x    presentational only: tree `a` can only ever appear as a second skill

const { readFileSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { join } = require("node:path");

const root = join(__dirname, "..");
const read = (f) => readFileSync(join(root, f), "utf8");

const rawTable = read("talisman_charm_table.json");
const rawSkills = read("skills.json");
const rawNames = read("talisman.json");

const TABLE = JSON.parse(rawTable);   // {tier: [206][4]} dense, index = tree id
const TREES = JSON.parse(rawSkills);  // {id: "Attack"}
const NAMES = JSON.parse(rawNames);   // {rarity: "Pawn Talisman"}

// Lifted from mhgu-charm-farm/docs/roll.js — the roller and this file must agree on these
// or the baked probabilities describe a different game than the one being played.
const TIER_ORDER = ["mystery", "shining", "timeworn", "enduring"];
const TIER_RARITIES = { mystery: [1, 2], shining: [3, 4], timeworn: [5, 6, 7], enduring: [8, 9, 10] };
const SLOT_TIER_FLOOR = [0, 0, 1, 2];
const SLOT_WEIGHTS = [55, 30, 12, 6];
const SECOND_SKILL_CHANCE = 0.5;

// Deviant skill trees. All 36 are second-skill-only and sit around 1 in 2,000, so the floor
// would drop them anyway — but they are excluded by name because "Has Bloodbath X" is not a
// readable bingo tile. 180-205 are excluded by the tables themselves (no row anywhere).
const DEVIANT_LO = 144, DEVIANT_HI = 179;

// ── Densify -> sparse, dropping rows the tier can't roll at all ────────────────
const tiers = {};
for (const t of TIER_ORDER) {
  const out = {};
  TABLE[t].forEach((row, id) => {
    if (id === 0) return;
    if (row[0] === 0 && row[1] === 0 && row[2] === 0 && row[3] === 0) return;
    out[id] = row;
  });
  tiers[t] = out;
}

// Trees legal in a given slot for a tier, as [id, lo, hi]. Mirrors roll.js legalTrees: an
// all-zero half means the tree can't appear in that slot.
const legalCache = {};
function legal(tier, slot) {
  const key = tier + ":" + slot;
  if (legalCache[key]) return legalCache[key];
  const out = [];
  for (const id in tiers[tier]) {
    const row = tiers[tier][id];
    const lo = slot === 1 ? row[0] : row[2];
    const hi = slot === 1 ? row[1] : row[3];
    if (lo === 0 && hi === 0) continue;
    out.push([Number(id), lo, hi]);
  }
  return (legalCache[key] = out);
}

// ── Exact probabilities ───────────────────────────────────────────────────────

// Share of integers in [lo, hi] satisfying `pred`.
function frac(lo, hi, pred) {
  const n = hi - lo + 1;
  if (n <= 0) return 0;
  let c = 0;
  for (let p = lo; p <= hi; p++) if (pred(p)) c++;
  return c / n;
}

// P(slot 1 holds tree `id` matching pred | tier).
function p1(tier, id, pred) {
  const L1 = legal(tier, 1);
  if (!L1.length) return 0;
  const e = L1.find((x) => x[0] === id);
  return e ? (1 / L1.length) * frac(e[1], e[2], pred) : 0;
}

// P(a second skill exists, is tree `id`, and matches pred | tier).
//
// Summed over which tree landed in slot 1, because that pick is excluded from slot 2's pool
// and so changes the denominator. A 0-point second skill is dropped by the roller, so every
// predicate is guarded against it here rather than at each call site.
function p2(tier, id, pred) {
  const L1 = legal(tier, 1), L2 = legal(tier, 2);
  if (!L1.length) return 0;
  const e = L2.find((x) => x[0] === id);
  if (!e) return 0;
  const inL2 = new Set(L2.map((x) => x[0]));
  let sum = 0;
  for (const entry of L1) {
    if (entry[0] === id) continue;
    const denom = L2.length - (inL2.has(entry[0]) ? 1 : 0);
    if (denom > 0) sum += (1 / L1.length) * (1 / denom);
  }
  return SECOND_SKILL_CHANCE * sum * frac(e[1], e[2], (p) => p !== 0 && pred(p));
}

// P(the charm carries tree `id` matching pred | tier). The two slots are mutually exclusive
// for one tree — the roller never puts the same tree twice on a charm — so they simply add.
const pHas = (tier, id, pred) => p1(tier, id, pred) + p2(tier, id, pred);

// P(a second skill exists at all and matches pred | tier), over every tree.
const pSecond = (tier, pred) =>
  legal(tier, 2).reduce((a, e) => a + p2(tier, e[0], pred), 0);

function pSlots(tier, minSlots) {
  const ti = TIER_ORDER.indexOf(tier);
  let total = 0, hit = 0;
  for (let s = 0; s <= 3; s++) {
    if (ti < SLOT_TIER_FLOOR[s]) continue;
    total += SLOT_WEIGHTS[s];
    if (s >= minSlots) hit += SLOT_WEIGHTS[s];
  }
  return total ? hit / total : 0;
}

// P(the charm carries tree `x` at >= `b` AND carries a positive second skill | tier).
//
// NOT the product of pHas and pSecond: both conditions live in the same two slots, so they
// are dependent. The slot-2 pool excludes whatever landed in slot 1, and if `x` is itself the
// second skill then the OTHER skill is the one that has to be positive — so both placements
// of `x` are summed separately. No legal slot-1 row can roll zero or negative (checked
// against all 248 of them), so "every skill positive" reduces to "the second skill is
// positive" and the first slot needs no guard.
function pWithPosSecond(tier, x, b) {
  const L1 = legal(tier, 1), L2 = legal(tier, 2);
  if (!L1.length || !L2.length) return 0;
  const inL2 = new Set(L2.map((e) => e[0]));
  let p = 0;

  // x in slot 1, with any positive tree behind it in slot 2.
  const e1 = L1.find((e) => e[0] === x);
  if (e1) {
    const denom = L2.length - (inL2.has(x) ? 1 : 0);
    if (denom > 0) {
      let tail = 0;
      for (const e of L2) if (e[0] !== x) tail += frac(e[1], e[2], (v) => v > 0);
      p += (1 / L1.length) * frac(e1[1], e1[2], (v) => v >= b)
         * SECOND_SKILL_CHANCE * (1 / denom) * tail;
    }
  }

  // x in slot 2 at >= b, which is positive by construction since every caller passes b >= 1.
  // Summed over the slot-1 pick, because that pick sets slot 2's denominator.
  const e2 = L2.find((e) => e[0] === x);
  if (e2) {
    const share = frac(e2[1], e2[2], (v) => v >= b);
    if (share > 0) {
      for (const y of L1) {
        if (y[0] === x) continue;
        const denom = L2.length - (inL2.has(y[0]) ? 1 : 0);
        if (denom > 0) p += (1 / L1.length) * SECOND_SKILL_CHANCE * (1 / denom) * share;
      }
    }
  }
  return p;
}

// Given the tier, slots and rarity are both independent of the skills and of each other:
// rollSlots keys off the tier index, and rarity is uniform within the tier. So a composite
// goal's probability is the product of its three parts.
const pRar = (tier, cond) => {
  const rs = TIER_RARITIES[tier];
  const ok = rs.filter((r) =>
    (cond.r == null || r >= cond.r) &&
    (cond.rx == null || r <= cond.rx) &&
    (cond.re == null || r === cond.re) &&
    (cond.tr == null || cond.tr === tier));
  return ok.length / rs.length;
};

function pOf(tier, g) {
  let p = pRar(tier, g);
  if (p === 0) return 0;
  if (g.s != null) p *= pSlots(tier, g.s);
  // A named tree plus "every skill positive" is a JOINT, not a product — the two conditions
  // share the same two slots. Everything else here is genuinely independent of the skills
  // given the tier, so the remaining branches stay multiplicative.
  if (g.a != null && g.n === 2 && g.pos) p *= pWithPosSecond(tier, g.a, g.b || 1);
  else if (g.a != null) p *= pHas(tier, g.a, (v) => v >= (g.b || 1));
  else if (g.n === 2 && g.pos) p *= pSecond(tier, (v) => v > 0);
  else if (g.n === 2) p *= pSecond(tier, () => true);
  else if (g.n === 1) p *= 1 - pSecond(tier, () => true);
  else if (g.neg != null) p *= pSecond(tier, (v) => v <= g.neg);
  return p;
}

// ── Goal enumeration ──────────────────────────────────────────────────────────
const maxPts = {}, slot2Only = {};
for (const t of TIER_ORDER) {
  for (const id in tiers[t]) {
    const row = tiers[t][id];
    maxPts[id] = Math.max(maxPts[id] || 0, row[1], row[3]);
  }
}
for (const id in maxPts) {
  slot2Only[id] = !TIER_ORDER.some((t) => legal(t, 1).some((e) => e[0] === Number(id)));
}
const reachable = Object.keys(maxPts)
  .map(Number)
  .filter((id) => maxPts[id] > 0 && !(id >= DEVIANT_LO && id <= DEVIANT_HI));

const goals = [];
function push(cat, cond) {
  const g = Object.assign({ c: cat }, cond);
  g.pt = TIER_ORDER.map((t) => Number(pOf(t, g).toPrecision(6)));
  if (g.pt.some((p) => p > 0)) goals.push(g);
}

// Skill name — carries the tree at all.
for (const id of reachable) {
  push("name", { k: "n:" + id, a: id, x: slot2Only[id] ? 1 : 0 });
}

// Skill points. A FIXED ladder, not fractions of each tree's max and not the skill's own
// activation thresholds.
//
// Activation thresholds are dead on arrival: 108 of the reachable trees have no activation
// threshold a charm can reach at all (Handicraft activates at 10 and caps at 5; Attack
// activates at 10 and only touches it as a second skill), and not one such tile clears the
// floor. Fractions of max are nearly as bad — three-quarters and all of a tree's ceiling are
// both deep in the tail, so they yield less than half as many playable tiles as a fixed
// ladder, and they read badly ("Normal S+ +4 or more"). The flat ladder gives most trees one
// genuinely gettable rung.
const LADDER = [3, 5, 7, 10, 13];
for (const id of reachable) {
  for (const b of LADDER) {
    if (b > maxPts[id]) continue;
    push("pts", { k: "p:" + id + ":" + b, a: id, b: b, x: slot2Only[id] ? 1 : 0 });
  }
}

// Slot count. "0 slots or more" is every charm and "no slots" auto-marks on the first draw,
// so the pool starts at 1.
for (const s of [1, 2, 3]) push("slot", { k: "s:" + s, s: s });

// Rarity is expressed in TALISMAN rarities — the ten named talismans, Pawn through Creator,
// plus two bands in the same units. The four roll tiers are deliberately not tiles: "mystery"
// and "timeworn" are charm-table vocabulary that appears nowhere in the game or the UI, and a
// tile should never be the only place a player meets a word.
for (let r = 1; r <= 10; r++) push("rar", { k: "re:" + r, re: r });
for (const r of [5, 8]) push("rar", { k: "rb:" + r, r: r });

// Never emit skill x skill. Two NAMED skills on one charm runs about 1 in 16,000 at its most
// generous and a median of 1 in 49,000 — measured, not guessed — so all 7,047 such tiles are
// unwinnable and not one clears HARD_FLOOR. Mystery is 30% of draws and has zero legal
// slot-2 rows, so nearly a third of the draw stream cannot produce a two-skill charm at all.
//
// What DOES express "one skill and another" affordably: name one tree and ask only that the
// second skill be positive. That leans on the 50% gate once instead of also paying a
// 1-in-74..105 pick, which lands it around 1 in 155 at best — ~70 tiles above the soft floor.
// Slots and rarity are the only other second conditions cheap enough to pair with a name.
for (const id of reachable) {
  const x = slot2Only[id] ? 1 : 0;
  push("combo", { k: "cq:" + id, a: id, n: 2, pos: 1, x: x });
  for (const b of [3, 5]) {
    if (b > maxPts[id]) continue;
    push("combo", { k: "cq:" + id + ":" + b, a: id, b: b, n: 2, pos: 1, x: x });
  }
}
for (const id of reachable) {
  const x = slot2Only[id] ? 1 : 0;
  for (const s of [1, 2]) push("combo", { k: "cs:" + id + ":" + s, a: id, s: s, x: x });
  for (const r of [5, 8]) push("combo", { k: "cr:" + id + ":" + r, a: id, r: r, x: x });
  for (const b of [3, 5]) {
    if (b > maxPts[id]) continue;
    push("combo", { k: "cp:" + id + ":" + b + ":r5", a: id, b: b, r: 5, x: x });
    push("combo", { k: "cp:" + id + ":" + b + ":s1", a: id, b: b, s: 1, x: x });
  }
}
// Slots x rarity.
push("combo", { k: "cx:s2r8", s: 2, r: 8 });
push("combo", { k: "cx:s2low", s: 2, rx: 4 });
push("combo", { k: "cx:s3r5", s: 3, r: 5 });
push("combo", { k: "cx:s3r8", s: 3, r: 8 });
push("combo", { k: "cx:s3r10", s: 3, re: 10 });
// Structural — the shape of the charm rather than what is on it. These are the cheapest
// interesting tiles in the game and the only ones that make a junk charm feel like a hit,
// which is most of the joke. Note that per-tree negative tiles are NOT emitted: a negative
// roll only ever comes from slot 2, so asking for a specific tree's negative range costs the
// 50% gate, a 1-in-~100 pick and a sub-range on top — none of the 331 candidates clears the
// floor. Generic negatives are cheap because any tree will do.
push("combo", { k: "cn:two", n: 2 });
push("combo", { k: "cn:twopos", n: 2, pos: 1 });
push("combo", { k: "cn:twoslot", n: 2, s: 2 });
push("combo", { k: "cn:solo3", n: 1, s: 3 });
push("combo", { k: "cn:cursed", neg: -1 });
push("combo", { k: "cn:cursed5", neg: -5 });
push("combo", { k: "cn:cursed10", neg: -10 });

const dataVersion = createHash("sha256").update(rawTable + rawSkills + rawNames).digest("hex").slice(0, 12);
writeFileSync(
  join(root, "docs", "data.js"),
  "// Auto-generated by tools/build-data.js. Do not edit by hand.\n" +
  "window.MHGU_TALISMAN_DATA = " + JSON.stringify({ dataVersion, tiers, trees: TREES, names: NAMES, goals }) + ";\n"
);

const counts = goals.reduce((a, g) => { a[g.c] = (a[g.c] || 0) + 1; return a; }, {});
console.log("dataVersion", dataVersion);
console.log("trees reachable:", reachable.length, "(deviants 144-179 excluded)");
console.log("goals:", goals.length, JSON.stringify(counts));
