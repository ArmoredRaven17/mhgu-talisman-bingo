// Goal catalogue and exact probabilities — pure, no DOM, no globals beyond window.TB_GOALS.
//
// This used to live in tools/build-data.js, which baked four per-tier probabilities into
// every goal. Pruning killed that: a card keeps only 20 of the 137 trees, and every
// probability in the app depends on which 20. There is no longer a fixed catalogue to bake,
// so the enumeration and the closed form both moved here and run at card-generation time.
//
// The upside is that satisfies() now sits in the SAME file as the maths it mirrors. Those two
// drifting apart was the standing hazard of the old split — a condition field added to one
// and not the other makes a tile either mark on charms that don't satisfy it or advertise
// odds it doesn't have. scripts/test-roll.mjs still checks one against the other over 400k
// real draws; now they at least have to be edited together.
//
// GOAL CONDITION FIELDS — all present must hold (ANDed):
//   a    tree the charm must carry        b   minimum points for `a` (default 1)
//   a2   second tree it must ALSO carry   se  exact slot count
//   re   exact rarity
window.TB_GOALS = (function () {
  "use strict";

  const DATA = window.MHGU_TALISMAN_DATA;
  const ROLL = window.TB_ROLL;
  const TIERS = ROLL.TIER_ORDER;
  const SECOND = ROLL.SECOND_SKILL_CHANCE;

  // "Has Bloodbath X" is not a readable bingo tile, and all 36 sit far below any floor.
  const DEV_LO = 144, DEV_HI = 179;
  const LADDER = [3, 5, 7, 10, 13];

  // ── Tree metadata, derived once from the tables ─────────────────────────────
  const maxPts = {};
  for (const t of TIERS) {
    const tbl = DATA.tiers[t] || {};
    for (const id in tbl) {
      const row = tbl[id];
      maxPts[id] = Math.max(maxPts[id] || 0, row[1], row[3]);
    }
  }
  const ELIGIBLE = Object.keys(maxPts).map(Number)
    .filter((id) => maxPts[id] > 0 && !(id >= DEV_LO && id <= DEV_HI))
    .sort((a, b) => a - b);

  // ── The keep-set ────────────────────────────────────────────────────────────
  // Drawn from the card's seeded RNG, so it never has to ride in the seed string: the same
  // seed rebuilds the same 20 trees. Repaired afterwards because a random 20 of 137 can, at
  // small sizes, leave a charm kind with no legal first skill at all — that kind would then
  // roll nothing and silently vanish from the draw stream.
  // `rng` may be a bare () => float or app.js's { next, rand } wrapper — the browser and the
  // headless harness build theirs differently, and taking both here is cheaper than keeping
  // two call conventions straight at every site.
  function keepFor(rng, n) {
    const next = typeof rng === "function" ? rng : rng.next;
    const pool = ELIGIBLE.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const keep = pool.slice(0, Math.min(n, pool.length));
    const rest = pool.slice(keep.length);
    for (const t of TIERS) {
      const legal1 = ROLL.legalTrees(t, 1).map((e) => e[0]);
      if (keep.some((id) => legal1.indexOf(id) > -1)) continue;
      const fix = rest.findIndex((id) => legal1.indexOf(id) > -1);
      if (fix > -1) keep[keep.length - 1] = rest.splice(fix, 1)[0];
    }
    return keep.sort((a, b) => a - b);
  }

  // ── Exact probabilities, against a pruned view ──────────────────────────────
  const frac = (lo, hi, pred) => {
    const n = hi - lo + 1;
    if (n <= 0) return 0;
    let c = 0;
    for (let p = lo; p <= hi; p++) if (pred(p)) c++;
    return c / n;
  };
  const find = (list, id) => {
    for (let i = 0; i < list.length; i++) if (list[i][0] === id) return list[i];
    return null;
  };

  // P(charm carries `id` at >= b | tier). The two slots are mutually exclusive for one tree,
  // so they add. The slot-2 sum runs over the slot-1 pick because that pick is excluded from
  // slot 2's pool and so changes the denominator.
  function pHas(view, t, id, b) {
    const L1 = view.legalTrees(t, 1), L2 = view.legalTrees(t, 2);
    if (!L1.length) return 0;
    let p = 0;
    const e1 = find(L1, id);
    if (e1) p += (1 / L1.length) * frac(e1[1][0], e1[1][1], (v) => v >= b);
    const e2 = find(L2, id);
    if (e2) {
      const inL2 = {};
      for (const e of L2) inL2[e[0]] = 1;
      let sum = 0;
      for (const a of L1) {
        if (a[0] === id) continue;
        const den = L2.length - (inL2[a[0]] ? 1 : 0);
        if (den > 0) sum += (1 / L1.length) * (1 / den);
      }
      p += SECOND * sum * frac(e2[1][0], e2[1][1], (v) => v !== 0 && v >= b);
    }
    return p;
  }

  // P(charm carries BOTH x and y | tier). Not a product of two pHas calls: the pair lives in
  // the same two slots, so both orderings are summed with slot 2's denominator adjusted for
  // whichever tree took slot 1. A pair the tables cannot produce returns 0.
  function pBoth(view, t, x, y) {
    if (x === y) return 0;
    const L1 = view.legalTrees(t, 1), L2 = view.legalTrees(t, 2);
    if (!L1.length || !L2.length) return 0;
    const inL2 = {};
    for (const e of L2) inL2[e[0]] = 1;
    let p = 0;
    const order = [[x, y], [y, x]];
    for (const pair of order) {
      const e1 = find(L1, pair[0]), e2 = find(L2, pair[1]);
      if (!e1 || !e2) continue;
      const den = L2.length - (inL2[pair[0]] ? 1 : 0);
      if (den <= 0) continue;
      p += (1 / L1.length) * frac(e1[1][0], e1[1][1], (v) => v >= 1)
         * SECOND * (1 / den) * frac(e2[1][0], e2[1][1], (v) => v >= 1);
    }
    return p;
  }

  // Exact slot count. Slots key off the tier index only, so this is independent of skills.
  function pSlotExact(t, want) {
    const ti = TIERS.indexOf(t);
    let total = 0, hit = 0;
    for (let s = 0; s <= 3; s++) {
      if (ti < ROLL.SLOT_TIER_FLOOR[s]) continue;
      total += ROLL.SLOT_WEIGHTS[s];
      if (s === want) hit += ROLL.SLOT_WEIGHTS[s];
    }
    return total ? hit / total : 0;
  }

  // Exact rarity. Rarity is uniform within the tier that owns it.
  function pRarExact(t, want) {
    const rs = ROLL.TIER_RARITIES[t] || [];
    return rs.indexOf(want) > -1 ? 1 / rs.length : 0;
  }

  function pOf(view, t, g) {
    let p = 1;
    if (g.re != null) { p *= pRarExact(t, g.re); if (!p) return 0; }
    if (g.se != null) { p *= pSlotExact(t, g.se); if (!p) return 0; }
    if (g.a != null && g.a2 != null) p *= pBoth(view, t, g.a, g.a2);
    else if (g.a != null) p *= pHas(view, t, g.a, g.b || 1);
    return p;
  }

  // ── The runtime twin of the maths above ─────────────────────────────────────
  function satisfies(charm, g) {
    if (!charm || !g) return false;
    if (g.a != null && !charm.k.some((x) => x[0] === g.a && x[1] >= (g.b || 1))) return false;
    if (g.a2 != null && !charm.k.some((x) => x[0] === g.a2 && x[1] >= 1)) return false;
    if (g.se != null && charm.s !== g.se) return false;
    if (g.re != null && charm.r !== g.re) return false;
    return true;
  }

  // ── Catalogue ───────────────────────────────────────────────────────────────
  // Built fresh per card, because every probability depends on the keep-set.
  function build(keep, tierW, floors) {
    const view = ROLL.table(keep);
    const total = TIERS.reduce((a, t) => a + (tierW[t] | 0), 0);
    const nw = TIERS.map((t) => (total > 0 ? (tierW[t] | 0) / total : 0));
    const soft = {}, hard = {};
    for (const c of ["name", "pts", "slot", "rar", "combo"]) { soft[c] = []; hard[c] = []; }

    const add = (c, g) => {
      let p = 0;
      for (let i = 0; i < TIERS.length; i++) {
        if (nw[i] <= 0) continue;
        p += nw[i] * pOf(view, TIERS[i], g);
      }
      if (p < floors.hard) return;
      // A CEILING as well as floors. Nothing stopped a tile being too EASY before, which is
      // how "rarity 5 or higher" (1 in 2) and "exactly 0 slots" (1 in 2) got in: squares that
      // mark on the first or second draw and amount to extra free spaces. Pruning made this
      // urgent rather than academic, because it lifts every single-skill tile at once.
      if (floors.ceil && p > floors.ceil) return;
      g.c = c; g.p = p;
      (p >= floors.soft ? soft : hard)[c].push(g);
    };

    for (const id of keep) {
      add("name", { k: "n:" + id, a: id });
      for (const b of LADDER) {
        if (b > (maxPts[id] || 0)) continue;
        add("pts", { k: "p:" + id + ":" + b, a: id, b: b });
      }
    }
    for (let s = 0; s <= 3; s++) add("slot", { k: "se:" + s, se: s });
    for (let r = 1; r <= 10; r++) add("rar", { k: "re:" + r, re: r });
    for (let i = 0; i < keep.length; i++) {
      for (let j = i + 1; j < keep.length; j++) {
        add("combo", { k: "cc:" + keep[i] + ":" + keep[j], a: keep[i], a2: keep[j] });
      }
    }
    return { soft: soft, hard: hard, view: view, keep: keep };
  }

  return {
    ELIGIBLE: ELIGIBLE, LADDER: LADDER, maxPts: maxPts,
    keepFor: keepFor, build: build, satisfies: satisfies, pOf: pOf,
  };
})();
