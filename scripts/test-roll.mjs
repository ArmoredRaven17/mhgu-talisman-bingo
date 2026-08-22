// Headless check on the roller, the goal catalogue and the matcher.
// Run: node scripts/test-roll.mjs
//
// The thing actually being tested is that TWO independent descriptions of the same rules
// agree: the closed-form probabilities goals.js integrates, and the matcher it uses to mark
// squares. If one drifts from the other, tiles either mark on charms that shouldn't satisfy
// them or advertise odds they don't have — and neither shows up as an error anywhere else.
//
// Since cards prune the tree pool, both halves are now checked PER KEEP-SET, and the draws
// come off the same pruned table the card would use. A closed form that were only right on
// the full tables would sail through the old test and be wrong in every real game.
import { DATA, ROLL, GOALS, DEFAULT_TIER_W, SOFT_FLOOR, HARD_FLOOR, FLOORS,
         KEEP_N, tierPairs, satisfies, keepFor, pools, makeRng } from "./common.mjs";

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.error("FAIL:", msg); } };

// ── Every rolled charm must be legal, at every rarity ─────────────────────────
const N = 200000;
const slotSeen = {};
for (let i = 0; i < N; i++) {
  const rarity = 1 + Math.floor(Math.random() * 10);
  const c = ROLL.rollCharm(rarity);
  check(c !== null, `rollCharm(${rarity}) returned null`);
  if (!c) continue;
  const problems = ROLL.verify(c);
  if (problems.length) {
    check(false, `illegal charm ${JSON.stringify(c)} -> ${problems.join("; ")}`);
    if (fail > 5) break;
  }
  const tier = ROLL.tierOf(c.r);
  (slotSeen[tier] = slotSeen[tier] || new Set()).add(c.s);
}
console.log(`rolled ${N.toLocaleString()} charms across all rarities`);

// SLOT_TIER_FLOOR is [0,0,1,2] indexed by SLOT COUNT: two slots needs shining or better,
// three needs timeworn or better. So shining legitimately reaches 2 and timeworn reaches 3.
check(!slotSeen.mystery.has(2) && !slotSeen.mystery.has(3), "mystery rolled 2 or 3 slots");
check(!slotSeen.shining.has(3), "shining rolled 3 slots");
check(slotSeen.shining.has(2), "shining never rolled a 2-slot charm");
check(slotSeen.timeworn.has(3), "timeworn never rolled a 3-slot charm");

// A mystery charm has no second-skill table at all, so it is always single-skilled. This is
// load-bearing: it is the hard ceiling on every pair tile, and no amount of pruning lifts it.
let mysteryTwoSkill = 0;
for (let i = 0; i < 50000; i++) if (ROLL.rollCharm(1 + (i % 2)).k.length > 1) mysteryTwoSkill++;
check(mysteryTwoSkill === 0, `mystery produced ${mysteryTwoSkill} two-skill charms`);

// ── A pruned charm must only ever carry kept trees ────────────────────────────
const probeKeep = keepFor("probe");
const probeView = ROLL.table(probeKeep);
const kept = new Set(probeKeep);
let leaked = 0;
for (let i = 0; i < 50000; i++) {
  const c = probeView.draw(tierPairs(DEFAULT_TIER_W));
  if (!c) continue;
  if (ROLL.verify(c).length) { check(false, `pruned roll produced an illegal charm ${JSON.stringify(c)}`); break; }
  for (const s of c.k) if (!kept.has(s[0])) leaked++;
}
check(leaked === 0, `${leaked} skills outside the keep-set leaked into pruned rolls`);
console.log(`pruned draws honour the keep-set (${KEEP_N} of ${GOALS.ELIGIBLE.length} trees)`);

// ── The catalogue, per keep-set ───────────────────────────────────────────────
const SEEDS = ["alpha", "bravo", "charlie"];
let totalChecked = 0, sumZ = 0, worst = { z: 0, k: null };
const M = 200000;

for (const seed of SEEDS) {
  const keep = keepFor(seed);
  check(keep.length === KEEP_N, `keep-set ${seed} has ${keep.length} trees, expected ${KEEP_N}`);
  check(new Set(keep).size === keep.length, `keep-set ${seed} has duplicates`);
  check(keep.every((id) => !(id >= 144 && id <= 179)), `keep-set ${seed} contains a deviant tree`);
  // A kind with no legal first skill would roll nothing and vanish from the draw stream.
  for (const t of ROLL.TIER_ORDER) {
    check(ROLL.table(keep).legalTrees(t, 1).length > 0, `keep-set ${seed} starved ${t} of first skills`);
  }

  const P = pools(DEFAULT_TIER_W, keep);
  const all = [];
  const keys = new Set();
  for (const c of ["name", "pts", "slot", "rar", "combo"]) {
    for (const g of P.soft[c].concat(P.hard[c])) {
      check(!keys.has(g.k), `duplicate goal key ${g.k} in ${seed}`);
      keys.add(g.k);
      check(g.p >= HARD_FLOOR && g.p <= 1, `${g.k} probability ${g.p} out of range`);
      all.push(g);
    }
    check(P.soft[c].length + P.hard[c].length > 0, `pool "${c}" is empty for keep-set ${seed}`);
  }

  // Every eligible goal is checked, not a sample: the tail is exactly where a mismatch would
  // hide, and a goal that never fires looks identical to one that is merely rare.
  const pairs = tierPairs(DEFAULT_TIER_W);
  const hits = new Array(all.length).fill(0);
  for (let i = 0; i < M; i++) {
    const c = P.view.draw(pairs);
    for (let j = 0; j < all.length; j++) if (satisfies(c, all[j])) hits[j]++;
  }
  for (let j = 0; j < all.length; j++) {
    const exp = all[j].p, obs = hits[j] / M;
    const z = (obs - exp) / Math.sqrt(exp * (1 - exp) / M);
    sumZ += z; totalChecked++;
    if (Math.abs(z) > Math.abs(worst.z)) worst = { z, k: all[j].k, exp, obs, seed };
  }
  const n = (c) => P.soft[c].length + "/" + P.hard[c].length;
  console.log(`  ${seed}: ${all.length} goals  ` +
    `name ${n("name")}  pts ${n("pts")}  slot ${n("slot")}  rar ${n("rar")}  combo ${n("combo")}`);
}

// ── Every combo tile must be a pair some enabled tier can actually roll ───────
// The closed form already handles this: pBoth() reads legalTrees(tier, 1) and
// legalTrees(tier, 2) per tier and skips any ordering where a tree is not legal in that slot,
// so an impossible pair scores 0 and the hard floor drops it. This asserts the OUTCOME
// independently, straight off the tables, because the failure is silent and permanent: an
// impossible tile is a square that can never be marked, on a card that still needs it to win.
//
// It matters because 45 trees are second-skill-only and 4 are first-skill-only, so plenty of
// pairs are impossible -- and because mystery has no legal slot-2 row at all, no combo tile is
// ever reachable on every enabled tier.
{
  const reachable = (tier, x, y) => {
    const L1 = ROLL.legalTrees(tier, 1), L2 = ROLL.legalTrees(tier, 2);
    if (!L1.length || !L2.length) return false;
    const ok = (list, id) => {
      const e = list.find((r) => r[0] === id);
      return !!e && e[1][1] >= 1;          // some value in [lo, hi] reaches +1
    };
    return (ok(L1, x) && ok(L2, y)) || (ok(L1, y) && ok(L2, x));
  };
  const enabled = ROLL.TIER_ORDER.filter((t) => (DEFAULT_TIER_W[t] | 0) > 0);
  let combos = 0, bad = 0, worstK = null;
  for (let i = 0; i < 200; i++) {
    const keep = keepFor(makeRng("combo-reach:" + i), KEEP_N);
    const cat = GOALS.build(keep, DEFAULT_TIER_W, FLOORS);
    for (const b of ["soft", "hard"]) {
      for (const g of cat[b].combo) {
        combos++;
        if (!enabled.some((t) => reachable(t, g.a, g.a2))) { bad++; worstK = worstK || g.k; }
      }
    }
  }
  console.log(`combo tiles reachable: ${combos.toLocaleString()} checked, ${bad} impossible`);
  check(bad === 0, `${bad} combo tiles no enabled tier can roll, e.g. ${worstK}`);

  // Mystery cannot carry a second skill at all, so a mystery-only mix must offer NO pairs
  // rather than a pool of squares nobody can ever mark.
  const mysteryOnly = { mystery: 100, shining: 0, timeworn: 0, enduring: 0 };
  let mCombo = 0;
  for (let i = 0; i < 40; i++) {
    const keep = keepFor(makeRng("mystery-only:" + i), KEEP_N);
    const cat = GOALS.build(keep, mysteryOnly, FLOORS);
    mCombo += cat.soft.combo.length + cat.hard.combo.length;
  }
  check(mCombo === 0, `mystery-only emitted ${mCombo} combo tiles; mystery has no slot-2 rows`);
}

const meanZ = sumZ / totalChecked;
console.log(`matcher vs closed form: ${totalChecked.toLocaleString()} goals over ` +
  `${(M * SEEDS.length).toLocaleString()} draws`);
console.log(`  mean z ${meanZ.toFixed(3)}  |  worst ${worst.k} (${worst.seed}) z=${worst.z.toFixed(2)} ` +
  `(1 in ${Math.round(1 / worst.exp)} expected, 1 in ${worst.obs ? Math.round(1 / worst.obs) : "∞"} observed)`);

// A per-goal |z| of 5 is generous for one test but this runs thousands at once, so the largest
// is expected around 4 by chance alone. The mean is the real guard: a systematic error in the
// maths moves every goal the same way and shows up there long before any single goal breaks.
check(Math.abs(worst.z) < 5.5, `goal ${worst.k} deviates by ${worst.z.toFixed(2)} sigma`);
check(Math.abs(meanZ) < 0.25, `mean deviation ${meanZ.toFixed(3)} suggests a systematic bias`);

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall checks passed");
process.exit(fail ? 1 : 0);
