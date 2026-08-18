// Charm rolling — pure, no DOM, no globals beyond window.TB_ROLL.
//
// A charm is { r: rarity 1-10, s: slots 0-3, k: [[treeId, pts], [treeId, pts]?] }.
// That is the same entry shape the Set Builder, the Equipment Box and Charm Farm use, so a
// charm rolled here would drop straight into any of them if we ever add export.
//
// Ported from mhgu-charm-farm/docs/roll.js. The rolling half is verbatim — if that file's
// roller is ever corrected, correct it here too, and rerun tools/build-data.js, because
// the baked per-goal probabilities in data.js are integrated against exactly these rules.
// The economy half (charmValue, the melding pot, ore) is dropped: nothing here sells or
// melds anything.
window.TB_ROLL = (function () {
  "use strict";

  const DATA = window.MHGU_TALISMAN_DATA;
  const CHARM_TIERS = DATA.tiers;
  const TREES = DATA.trees;
  const NAMES = DATA.names;

  // A talisman's equip id IS its rarity (1-10); each maps to one of four roll tiers whose
  // table bounds the legal skills and points.
  const TAL_TIER = [null, "mystery", "mystery", "shining", "shining",
    "timeworn", "timeworn", "timeworn", "enduring", "enduring", "enduring"];
  const TIER_ORDER = ["mystery", "shining", "timeworn", "enduring"];
  // How many slots a talisman has restricts which tier can have rolled it: two slots never
  // come from a mystery roll, three never from mystery or shining. Athena's
  // CharmDatabase::CharmIsLegal states it as start[4] = {0,0,1,2} over the same four tiers.
  // The roll tables carry point ranges only, so without this a 3-slot Pawn Talisman would
  // look perfectly legal.
  const SLOT_TIER_FLOOR = [0, 0, 1, 2];

  // Rarities that belong to each tier, so a tier roll can pick a concrete talisman.
  const TIER_RARITIES = { mystery: [1, 2], shining: [3, 4], timeworn: [5, 6, 7], enduring: [8, 9, 10] };

  // Slot-count weights. Three slots stay genuinely rare even on enduring rolls — a 3-slot
  // charm should feel like a find, not a Tuesday. Invented tuning, not game data: nothing
  // in the tables says how often each slot count appears, only which tiers may reach them.
  const SLOT_WEIGHTS = [55, 30, 12, 6];

  const SECOND_SKILL_CHANCE = 0.5;

  const ri = (n) => Math.floor(Math.random() * n);
  const between = (lo, hi) => lo + ri(hi - lo + 1);

  function pickWeighted(pairs) {
    let total = 0;
    for (const p of pairs) total += p[1];
    if (total <= 0) return null;
    let n = Math.random() * total;
    for (const p of pairs) { n -= p[1]; if (n < 0) return p[0]; }
    return pairs[pairs.length - 1][0];
  }

  const tierOf = (rarity) => TAL_TIER[rarity] || null;
  const tierIndex = (rarity) => TIER_ORDER.indexOf(tierOf(rarity));

  // Trees this tier can roll in a given slot, as [treeId, [min, max]] pairs. A row is
  // [s1min, s1max, s2min, s2max]; an all-zero half means "can't appear in that slot".
  //
  // Memoised: the tables never change, and this would otherwise walk ~200 entries and build
  // a fresh array on every roll — which, under auto-draw, happens thousands of times.
  const treeCache = {};
  function legalTrees(tier, slot) {
    const key = tier + ":" + slot;
    if (treeCache[key]) return treeCache[key];
    const table = CHARM_TIERS[tier];
    const out = [];
    if (table) {
      for (const id in table) {
        const row = table[id];
        const lo = slot === 1 ? row[0] : row[2];
        const hi = slot === 1 ? row[1] : row[3];
        if (lo === 0 && hi === 0) continue;
        out.push([Number(id), [lo, hi]]);
      }
    }
    treeCache[key] = out;
    return out;
  }

  // Slot count legal for this rarity's tier, honouring SLOT_TIER_FLOOR.
  function rollSlots(rarity) {
    const ti = tierIndex(rarity);
    const pairs = [];
    for (let s = 0; s <= 3; s++) if (ti >= SLOT_TIER_FLOOR[s]) pairs.push([s, SLOT_WEIGHTS[s]]);
    const s = pickWeighted(pairs);
    return s === null ? 0 : s;
  }

  // Roll one charm of a given rarity. Always produces a legal charm — verify() below is the
  // assertion that says so, and scripts/test-roll.mjs hammers it.
  //
  // `treesFn` is how the pruned tables get in: it is legalTrees for a full roll, or a view's
  // filtered equivalent. Everything downstream — the 1/n picks, the second-skill gate, the
  // same-tree exclusion — is identical either way, which is what makes a pruned roll a real
  // roll on a smaller table rather than a different algorithm.
  function rollCharmWith(treesFn, rarity) {
    const tier = tierOf(rarity);
    if (!tier) return null;

    const first = treesFn(tier, 1);
    if (!first.length) return null;
    const pick1 = first[ri(first.length)];
    const t1 = pick1[0], r1 = pick1[1];
    const k = [[t1, between(r1[0], r1[1])]];

    // Roughly half of charms carry a second skill. It must be a different tree — the game
    // never rolls the same tree twice on one charm. Negative points are kept: a big first
    // skill paired with a painful second is the shape of a real charm.
    //
    // Note that no mystery row has a positive second half, so a mystery charm is single-
    // skilled in practice. That is why a two-condition tile is unreachable from that tier.
    if (Math.random() < SECOND_SKILL_CHANCE) {
      const second = treesFn(tier, 2).filter((e) => e[0] !== t1);
      if (second.length) {
        const pick2 = second[ri(second.length)];
        const t2 = pick2[0], r2 = pick2[1];
        const pts = between(r2[0], r2[1]);
        // Most second-skill ranges straddle zero, so a roll of exactly 0 is common. A charm
        // with a 0-point skill is the same charm as one with no second skill at all — the
        // game would just show one skill — so drop it rather than print "Insight 0".
        if (pts !== 0) k.push([t2, pts]);
      }
    }

    return { r: rarity, s: rollSlots(rarity), k: k };
  }

  const rollCharm = (rarity) => rollCharmWith(legalTrees, rarity);

  // A pruned view of the tables. `keepIds` restricts which trees may roll at all; null gives
  // the full tables back. Pruning is the only thing that makes a two-skill tile reachable:
  // it shrinks the 1-in-74..105 second-slot pick, which is the term that otherwise puts every
  // pair past 1 in 14,000.
  //
  // Each view memoises its own legal lists rather than sharing the module cache, because a
  // card holds one view for its entire life and auto-draw calls it thousands of times.
  function table(keepIds) {
    const keep = keepIds && keepIds.length ? new Set(keepIds.map(Number)) : null;
    const cache = {};
    function trees(tier, slot) {
      const key = tier + ":" + slot;
      if (cache[key]) return cache[key];
      const full = legalTrees(tier, slot);
      return (cache[key] = keep ? full.filter((e) => keep.has(e[0])) : full);
    }
    return {
      keep: keep,
      legalTrees: trees,
      rollCharm: (rarity) => rollCharmWith(trees, rarity),
      draw: function (tierWeights) {
        const tier = pickWeighted(tierWeights);
        return tier ? rollCharmWith(trees, rollRarity(tier)) : null;
      },
    };
  }

  function rollRarity(tier) {
    const rs = TIER_RARITIES[tier];
    return rs ? rs[ri(rs.length)] : 1;
  }

  // Roll a tier from [name, weight] pairs, then a charm from it. This is the app's whole
  // draw: the tier weights are the user's difficulty control.
  function draw(tierWeights) {
    const tier = pickWeighted(tierWeights);
    return tier ? rollCharm(rollRarity(tier)) : null;
  }

  // Legality check, mirroring SBEngine.validateTalisman. Returns problem strings; empty
  // means legal. Used as a self-check and by the headless test.
  function verify(c) {
    const problems = [];
    if (!c || !Number.isInteger(c.r) || c.r < 1 || c.r > 10) return ["rarity must be 1-10"];
    const tier = tierOf(c.r);
    const table = CHARM_TIERS[tier];
    if (!table) return ["no roll table for rarity " + c.r];
    if (!Number.isInteger(c.s) || c.s < 0 || c.s > 3) problems.push("slots must be 0-3");
    else if (tierIndex(c.r) < SLOT_TIER_FLOOR[c.s])
      problems.push(c.s + "-slot charm can't roll from the " + tier + " tier");

    const k = c.k || [];
    if (k.length < 1) problems.push("a charm always has a first skill");
    if (k.length > 2) problems.push("a charm has at most two skills");
    if (k[0]) {
      const row = table[k[0][0]];
      if (!row || (row[0] === 0 && row[1] === 0)) problems.push("skill 1 tree illegal on this tier");
      else if (k[0][1] < row[0] || k[0][1] > row[1]) problems.push("skill 1 points out of range");
    }
    if (k[1]) {
      if (k[0] && k[1][0] === k[0][0]) problems.push("the two skills must differ");
      const row = table[k[1][0]];
      if (!row || (row[2] === 0 && row[3] === 0)) problems.push("skill 2 tree illegal on this tier");
      else if (k[1][1] < row[2] || k[1][1] > row[3]) problems.push("skill 2 points out of range");
    }
    return problems;
  }

  // A god charm: a Creator Talisman with three slots and both skills rolled at the very top
  // of their range. As good as the tables allow a charm to be. Not a win condition here —
  // purely so the draw panel can call one out when it happens.
  const GOD_RARITY = 10;
  function isGod(c) {
    if (!c || c.r !== GOD_RARITY || c.s !== 3) return false;
    const k = c.k || [];
    if (k.length !== 2) return false;
    const table = CHARM_TIERS[tierOf(c.r)];
    if (!table) return false;
    const r1 = table[k[0][0]], r2 = table[k[1][0]];
    if (!r1 || !r2) return false;
    // Slot 1's ceiling is row[1]; slot 2's is row[3].
    return k[0][1] === r1[1] && k[1][1] === r2[3];
  }

  const treeName = (id) => TREES[id] || ("tree " + id);
  const charmName = (rarity) => NAMES[rarity] || ("Talisman " + rarity);

  return {
    TAL_TIER: TAL_TIER, TIER_ORDER: TIER_ORDER, SLOT_TIER_FLOOR: SLOT_TIER_FLOOR,
    TIER_RARITIES: TIER_RARITIES, SLOT_WEIGHTS: SLOT_WEIGHTS,
    SECOND_SKILL_CHANCE: SECOND_SKILL_CHANCE, table: table,
    tierOf: tierOf, tierIndex: tierIndex, legalTrees: legalTrees,
    rollCharm: rollCharm, rollRarity: rollRarity, rollSlots: rollSlots, draw: draw,
    verify: verify, isGod: isGod, treeName: treeName, charmName: charmName,
    pickWeighted: pickWeighted,
  };
})();
