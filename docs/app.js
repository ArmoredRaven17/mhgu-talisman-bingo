// MHGU Talisman Bingo — all application logic. One IIFE, no modules.
//
// The card is a grid of CONDITIONS ON A TALISMAN. Pressing Draw rolls a real, legal charm
// from the game's own tables and marks every open square that charm satisfies.
//
// Built on the MHGU Bingo shell — same seed codec, same RNG, same theme derivation, same
// panel and modal vocabulary. The seeded RNG lays out the CARD. It deliberately does NOT
// drive the draws; see draw() for why.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DATA = window.MHGU_TALISMAN_DATA;
  const ROLL = window.TB_ROLL;
  const GOALS = window.TB_GOALS;

  // Every MHGU app publishes under one armoredraven17.github.io origin, and GitHub Pages
  // project sites are paths rather than subdomains — so they all share one localStorage.
  // Every key here is namespaced; an unprefixed one would collide with a sibling app.
  const SETTINGS_KEY = "mhgu-talisman-bingo-settings";
  const CARD_KEY = "mhgu-talisman-bingo-card";
  const THEME_KEY = "mhgu-talisman-bingo-theme";

  const FALLBACK_ICON = "assets/MonsterIcons/MHGU-Question_Mark_Icon.webp";
  const monsterIcon = (name) => name
    ? "assets/MonsterIcons/MHGU-" + name.replace(/ /g, "_") + "_Icon.webp"
    : FALLBACK_ICON;
  const talismanIcon = (rarity) => "assets/TalismanIcons/icon_talisman" + (rarity ? "_r" + rarity : "") + ".png";

  // ── Themes (ported from MHGU Bingo / the Quest Randomizer) ─────────────────
  const COLORS = [
    ["Teostra","#570B0B"],["Rathalos","#b51717"],
    ["Tetsucabra","#783E0F"],["Agnaktor","#C7620E"],
    ["Tigrex","#74631D"],["Rajang","#9C8328"],
    ["Najarala","#436713"],["Gendrome","#67922E"],
    ["Deviljho","#0B570F"],["Rathian","#39993E"],
    ["Astalos","#14503d"],["Zinogre","#279773"],
    ["Zamtrios","#0C5D68"],["Kirin","#118898"],
    ["S. Ceanataur","#005984","Shogun Ceanataur"],["Plesioth","#0080c1"],
    ["Brachydios","#0B2757"],["Lagiacrus","#0b3f97"],
    ["G. Magala","#1F0B57","Gore Magala"],["Nerscylla","#4e2fa2"],
    ["Y. Garuga","#62008f","Yian Garuga"],["Chameleos","#8e50ab"],
    ["Mizutsune","#D4358C"],["Congalala","#C8679D"],
    ["Duramboros","#5a411f"],["Diablos","#997c54"],
    ["Barroth","#835A32"],["Bulldrome","#B17A47"],
    ["K. Daora","#505358","Kushala Daora"],["Valstrax","#7C879B"],
    ["Forbidden","#1E2025","Question Mark"],
  ];
  // THE PALETTE'S ONE INVARIANT: every theme takes white text and a white checkbox tick.
  //
  // Two requirements, one number. A native checkbox takes accent-color from the theme and the
  // browser picks the tick glyph itself — white below relative luminance .1791, black above it.
  // White body text needs its ground at .1833 or below to clear 4.5:1. The checkbox line is the
  // stricter of the two, so hold a surface under .1791 and white text on it clears AA for free.
  //
  // The binding surface is the lightest one a theme paints — a 60/40 composite of darken(hex,.80)
  // and darken(hex,.95), lighter than the tick's own darken(hex,.70), so testing the composite
  // covers both. Every theme is under it; worst white-on-ground in the palette is 4.73:1.
  //
  // This is load-bearing rather than cosmetic. Most of these apps paint white text unconditionally
  // with no light-theme fallback left, so a swatch over the line is not a slightly-too-bright
  // swatch, it is unreadable. The Hunting Log and the Randomizer do still carry an isLight branch,
  // but it trips only at near-white and nothing in the palette comes close. The Randomizer's
  // Gypceros is the deliberate exception — tripping that branch is its entire joke.
  //
  // A NEW OR RE-CUT COLOUR HAS TO CLEAR THIS. A swatch that fails is not a slightly-too-bright
  // swatch, it is a theme that inverts against every other one.
  //
  // Eight came down to get there — Rajang, Rathian, Zinogre, Mizutsune, Congalala, Barroth,
  // Bulldrome and Valstrax — by lightness alone, so each keeps its own hue and saturation. Where
  // capping the light member on its own would have squashed a pair onto one lightness, the dark
  // partner came down by the same factor instead of the pair collapsing: that is why Barroth
  // moved with Bulldrome, and Mizutsune with Congalala.
  //
  // Two pairs are re-cuts of other pairs, keeping their own slot on the wheel and taking the
  // source pair's saturation and lightness, member for member:
  //
  //   Tigrex / Rajang        <- Astalos / Zinogre,      at the yellow slot (47°)
  //   Tetsucabra / Agnaktor  <- Brachydios / Lagiacrus, at the orange slot (27°)
  //
  // Najarala / Gendrome and S. Ceanataur / Kirin are not re-cuts. They fill the palette's two real
  // hue gaps, and each takes the mean saturation and lightness of the pairs it sits between, which
  // is why they read as belonging to both sides rather than to neither.
  //
  //   Najarala / Gendrome    at 85.4°  — 48° to 123° measured 75° in HSL, double any other span
  //   Zamtrios / Kirin        at 187°   — 161° to 200° measures only 39° in HSL but 95° in Lab
  //
  // MEASURE HUE GAPS IN LAB, NOT HSL. HSL is badly non-uniform through cyan: the 39° between
  // Zinogre and Zamtrios covered 95 perceptual degrees, the widest hole in the palette, while the
  // 46° between Chameleos and Mizutsune that looks worst in HSL is 31° in Lab and is the
  // best-spaced span there is. Going by HSL alone fills the wrong gap.
  //
  // 187° rather than the 181° midpoint for the same reason. HSL compresses cyan->blue so hard
  // that a pair placed at the HSL midpoint still left 34° of Lab on the green side and 59° on
  // the blue; 187° splits it 49/44. The colour barely moves, the spacing does.
  //
  // Both pairs then come back up as far as the line allows, less a working margin, because a
  // source pair brings its own lightness along and the teal and blue pairs are the dark ones.
  //
  // RAJANG IS THE ONE SITTING ON THE CEILING. Its ground measures .170 against the .1791 line,
  // so it has no lift left: brightening it buys dark text and a black tick, which is the exact
  // thing this invariant exists to prevent. If it ever has to read punchier, trade saturation
  // for lightness along the boundary (#A58100 at S 1.00 is the vivid end) rather than pushing
  // lightness up — but that drops it to L .32 and squeezes the pair against Tigrex, so check
  // the separation before taking it.
  //
  // The earth tones (Duramboros, Diablos, Barroth, Bulldrome) share the 27–47° stretch with both
  // of those pairs by design. Swatches sitting close together in there is expected and is not a
  // collision to design out.
  //
  // A saved theme is a bare hex, so anyone sitting on a retired one keeps a colour that is no
  // longer in the list: it never picks up the change, and anything keyed off the hex (the selected
  // swatch, the theme's icon) stops matching. Remap on read, not on write — the stale value is
  // already in localStorage on every device that chose it. Only hexes that actually shipped are
  // listed; cuts that never left the working tree are not, because no device can hold them.
  //
  // "Shipped" is per app, not per palette. #574916 went out on Talisman Bingo alone, and
  // #68360D / #B5590D / #68581A on MHGU Bingo alone, because an unrelated commit in each of
  // those repos swept the working tree mid-edit and pushed a cut that was still being tuned.
  // They are listed in all nine anyway: the map is kept identical regardless of which app
  // released what, because this palette is hand-copied with no shared source and a per-app map
  // is one more thing to drift.
  const LEGACY_HEX = {
    "#C8A319": "#74631D", "#57470B": "#74631D", "#5E4D0C": "#74631D",           // Tigrex
    "#574916": "#74631D",
    "#F1D364": "#9C8328", "#B59417": "#9C8328", "#C39F19": "#9C8328",           // Rajang
    "#BEA031": "#9C8328",
    "#C65900": "#783E0F", "#FC933E": "#C7620E",                                 // Tetsucabra, Agnaktor
    "#68360D": "#783E0F", "#B5590D": "#C7620E",                                 // ...and the cuts that
    "#68581A": "#74631D",                                                       // reached MHGU Bingo only
    "#3A9B3F": "#39993E", "#2DAE85": "#279773",                                 // Rathian, Zinogre
    "#D84696": "#D4358C", "#CE79A8": "#C8679D",                                 // Mizutsune, Congalala
    "#B57C45": "#835A32", "#CFAA87": "#B17A47",                                 // Barroth, Bulldrome
    "#AEB5C1": "#7C879B",                                                       // Valstrax
  };
  const migrateHex = (h) => (h && LEGACY_HEX[h.toUpperCase()]) || h;
  const COLORS_HEX = Object.fromEntries(COLORS.map(([name, hex]) => [hex.toUpperCase(), name]));
  const COLORS_ICON = Object.fromEntries(COLORS.filter(c => c[2]).map(([name,,icon]) => [name, icon]));

  const BOT_API_ORIGIN = "https://mhgu-bot-api.raven-mhgu.workers.dev";

  // ── Pools ──────────────────────────────────────────────────────────────────
  // Five pools, each with an on/off toggle and a 1-9 weight. There is no named difficulty
  // setting: the weights, the tier mix and the grid size are the difficulty.
  const CATS = [
    { id: "name",  label: "Skill Name",   hint: "Has Expert" },
    { id: "pts",   label: "Skill Points", hint: "Expert +5 or more" },
    { id: "slot",  label: "Slot Count",   hint: "2 slots or more" },
    { id: "rar",   label: "Rarity",       hint: "Roll a King Talisman" },
    { id: "combo", label: "Combo",        hint: "Attack on a 2-slot charm" },
  ];
  const POOL_COLORS = {
    name: "#7fb2ff", pts: "#ff9f5e", slot: "#9b8cff", rar: "#ffd166", combo: "#5ec9a0",
    free: "#8a8f98",
  };

  const TIERS = ROLL.TIER_ORDER;                      // mystery, shining, timeworn, enduring
  const TIER_LABEL = { mystery: "Mystery", shining: "Shining", timeworn: "Timeworn", enduring: "Enduring" };

  const SIZES = [3, 4, 5, 6, 7, 8, 9, 10];
  const DEFAULT_CFG = { size: 5, free: true, cats: { name: 4, pts: 3, slot: 1, rar: 2, combo: 3 } };

  // How often each charm table is drawn from. Junk-heavy but not punishingly so, and
  // enduring stays the rarest — the shape of a real charm run.
  //
  // FIXED, and deliberately not exposed. It is the closest thing the app has to a house
  // edge: letting a player raise `enduring` would be letting them rewrite what a draw is
  // worth, and the draw count is the entire score. It also silently changes which squares
  // can exist at all — no mystery row has a positive second skill and mystery can never
  // reach two slots — so a dial here would quietly reshape the card as well as the odds.
  const TIER_W = { mystery: 30, shining: 25, timeworn: 25, enduring: 20 };

  // Two floors, not one.
  //
  // SOFT is what an ordinary square must clear. Below roughly 1-in-300 the pools start
  // collapsing — at a 1-in-100 floor the points and combo pools go to literally zero and
  // the game degenerates into 44 skill names and 16 rarity tiles.
  //
  // HARD is absolute eligibility, and the band between the two is a small per-card budget
  // of genuinely nasty squares. That band is not academic: it contains Handicraft
  // (1 in 876), Critical Up, Carving and Capturer. Handicraft is the single most
  // recognisable charm skill in the game, and a card that can never ask for it reads as a
  // bug rather than as a design. One hard square costs about 100 draws on a 5x5.
  // How many of the 137 skill trees a card keeps. This is the lever that makes a two-skill
  // tile possible at all: it shrinks the 1-in-74..105 second-slot pick, and with it every
  // pair in the game. On the full tables the cheapest pair is 1 in 14,030 and the median
  // 1 in 43,887, so not one clears HARD_FLOOR; at 20 kept the best is about 1 in 210 and
  // roughly 70 pairs per card clear it.
  //
  // 20 rather than fewer because below 16 a random keep-set starts leaving a charm kind with
  // no legal first skill at all (2.9% of sets at 8 kept), and that kind then rolls nothing
  // and silently drops out of the draw stream. 20 measured zero such sets in 3,000.
  const KEEP_N = 20;

  // The other end of the scale. A square that marks on roughly one draw in eight is a second
  // free space, not a goal, and the pools produce several: "exactly 0 slots" is 1 in 2 and a
  // Pawn Talisman is 1 in 7. Two floors and no ceiling was the gap that let those through.
  const CEILING = 1 / 8;

  const SOFT_FLOOR = 1 / 300;
  const HARD_FLOOR = 1 / 1000;
  const hardBudgetFor = (need) => Math.floor(need / 16);   // 0 on 3x3 and 4x4, 1 on 5x5, 3 on 7x7

  const MAX_CELL_TEXT = 40;

  // Slots drawn the way the game shows them: a hole per slot, filled or empty.
  const SLOT_GLYPH = ["---", "O--", "OO-", "OOO"];

  // ── Goal presentation ──────────────────────────────────────────────────────
  const treeName = ROLL.treeName;
  const charmName = ROLL.charmName;

  const slotPhrase = (s) => s === 1 ? "exactly 1 slot" : "exactly " + s + " slots";

  // A goal is a set of condition fields that are ANDed (see docs/goals.js for the full list).
  // Text is composed from whichever are present, so one function covers all five pools.
  function goalText(g) {
    if (g.re != null) return "Roll a " + charmName(g.re);
    if (g.se != null) return slotPhrase(g.se);
    // Two named skills on one talisman. Only reachable because the card prunes the tree pool
    // to 20 — on the full tables the cheapest pair in the game is past 1 in 14,000.
    if (g.a2 != null) return treeName(g.a) + " + " + treeName(g.a2);
    // A bare skill needs the verb; a points goal reads as the tree and its floor.
    if (g.b) return treeName(g.a) + " +" + g.b + " or more";
    return "Has " + treeName(g.a);
  }

  function goalIcon(g) {
    if (g.re != null) return talismanIcon(g.re);
    if (g.tr != null) return talismanIcon(ROLL.TIER_RARITIES[g.tr][0]);
    return "";
  }

  // ── Eligibility ───────────────────────────────────────────────────────
  // Probabilities are no longer baked into data.js. Each card keeps only KEEP_N of the 137
  // trees, and every probability depends on which ones, so the catalogue is enumerated and
  // integrated at generation time by goals.js.
  const FLOORS = { soft: SOFT_FLOOR, hard: HARD_FLOOR, ceil: CEILING };
  const buildPools = (keep) => GOALS.build(keep, TIER_W, FLOORS);
  const satisfies = GOALS.satisfies;

  // Cells carry their goal straight through, so the object the maths scored is the object
  // the matcher tests — there is no second copy to fall out of step.
  const toCell = (g) => ({
    key: g.k, cat: g.c, text: goalText(g).slice(0, MAX_CELL_TEXT),
    icon: goalIcon(g), tint: POOL_COLORS[g.c], p: g.p, cond: g,
  });

  // ── Seeded RNG ─────────────────────────────────────────────────────────────
  // Every draw on a card routes through here. Math.random() is used in exactly ONE
  // place in this file (newToken, below) — if a grep turns up two, something has
  // broken seed reproducibility.
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seedStr) {
    const next = mulberry32(hashStr(seedStr));
    return { next, rand: (n) => Math.floor(next() * n) };
  }
  // Weighted sampling without replacement (Efraimidis-Spirakis): key = u^(1/w), highest
  // key drawn first. Sorted ascending so the caller's pop() takes the highest. With all
  // weights 1 this is a plain uniform shuffle.
  function weightedShuffle(items, rng) {
    return items
      .map(it => ({ it, k: Math.pow(rng.next(), 1 / (it.w || 1)) }))
      .sort((a, b) => a.k - b.k)
      .map(e => e.it);
  }


  // ── Seed codec ─────────────────────────────────────────────────────────────
  // MHGU-5F-N4P3S1R2C3-K7T2NX-9C4A
  //   size + F/N free-space flag · per-pool weights · token · settings fingerprint
  const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";      // Crockford: no I, L, O, U
  const b32 = (n, len) => { let s = ""; for (let i = 0; i < len; i++) { s = B32[n & 31] + s; n = n >>> 5; } return s; };
  const CAT_LETTER = { name: "N", pts: "P", slot: "S", rar: "R", combo: "C" };
  const LETTER_CAT = Object.fromEntries(Object.entries(CAT_LETTER).map(([k, v]) => [v, k]));
  // MHGU-{size}{F|N}-{pools}-{session}[-{player}][-{fp}]
  //
  // The seed splits in two. Everything up to and including {session} is the SESSION: it fixes
  // the pruned tree pool AND the draw stream, so every seat at the table draws the same
  // talismans out of the same universe. {player} picks the card layout on top of that.
  //
  // That split is the whole point. Share only the session and each player rolls their own
  // board off it; share the full seed and you hand someone your exact card. Identical cards
  // plus a shared stream would mean every player marking in lockstep and calling BINGO on the
  // same draw, which is not a game.
  const SEED_RE = /^MHGU-([3-9]|10)([FN])-((?:[NPSRC][1-9])+)-([0-9A-Z]{6})(?:-([0-9A-Z]{4}))?(?:-([0-9A-Z]{4}))?$/;

  // The one place Math.random is allowed for the card. Everything downstream is seeded.
  const newToken = () => b32(Math.floor(Math.random() * 0x100000000), 6);
  const newPlayer = () => b32(Math.floor(Math.random() * 0x100000000), 4);

  const effFree = (c) => !!c.free && c.size % 2 === 1;

  // The session half, and the only thing a Gamemaster needs to hand out.
  function seedBody(c, token) {
    const cats = CATS.filter((x) => (c.cats[x.id] | 0) > 0)
      .map((x) => CAT_LETTER[x.id] + c.cats[x.id]).join("");
    return "MHGU-" + c.size + (effFree(c) ? "F" : "N") + "-" + cats + "-" + token;
  }

  // Covers what changes WHICH goals are eligible but isn't in the seed body. With the tier
  // weights fixed, that is only the data itself — so a rebuilt catalogue makes old seeds
  // warn rather than silently produce a different card.
  // KEEP_N rides here because it changes WHICH goals exist without changing the seed body:
  // replay an old seed under a different keep size and you get a different card, so it must
  // warn rather than differ silently.
  const fingerprint = () => "d" + DATA.dataVersion + "|k" + KEEP_N;

  function decodeSeed(raw) {
    const s = (raw || "").trim().toUpperCase();
    const m = SEED_RE.exec(s);
    // Anything unparseable still produces a card: hash it into a token so typing a word
    // gives you a reproducible board rather than an error.
    if (!m) return { cfg: null, token: b32(hashStr(s), 6), player: null, fp: null };
    const cfg = { size: parseInt(m[1], 10), free: m[2] === "F", cats: {} };
    for (const c of CATS) cfg.cats[c.id] = 0;
    m[3].replace(/([NPSRC])([1-9])/g, (_, L, n) => { cfg.cats[LETTER_CAT[L]] = parseInt(n, 10); return ""; });
    // No player part means someone pasted a session: they are JOINING, so mint them a card of
    // their own rather than handing them whoever's board the session came from.
    return { cfg: cfg, token: m[4], player: m[5] || null, fp: m[6] || null };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
  let card = null;
  let view = null;          // the card's pruned roll table; rebuilt on load, never serialised
  let bags = null;          // leftover goals per pool, for per-square reroll
  let usedKeys = new Set();
  // Hidden for now, and read as a hard-coded literal rather than from settings: anyone who
  // ticked the box while the control was live has showReroll:true in localStorage, and
  // honouring that with no control on the page would put a button on their squares they could
  // never turn off. The key is no longer written, so it clears itself on the next settings save.
  let showReroll = false;
  let softHighlight = true;
  // HIDDEN, and forced off. The mechanism below works and is left intact, but the control is
  // Marking is gated on the draw history, always, and is NOT a setting. A square only becomes
  // claimable once some talisman has actually satisfied it. That is what makes a BINGO mean
  // something: the draw history is an authoritative record, so a completed line is one the
  // calls actually justify rather than one somebody clicked. A switch to turn it off would be
  // a switch to turn the guarantee off, which is worth nothing to the player who leaves it on.
  //
  // It works here in a way it could not in MHGU Bingo, whose squares are hunt objectives only
  // the player can adjudicate. Every square here is a condition on a talisman and the app
  // produced the talisman.
  //
  // It was switched off for a long time because one person calls while everyone else only
  // watches -- those devices never drew, so their `eligible` stayed empty and every square
  // locked forever. Followers now receive the draws themselves, so the set fills on every
  // screen. Log Check is the other half: a locked board is only fair if you can see what the
  // calls have already covered.

  // "gm" rolls talismans here; "player" types in what someone else called. Persisted, because
  // which one you are is a property of your seat at the table, not of the card.
  // Derived from the session by currentRole(); never set by the user.
  let mode = "gm";

  const TIER_PAIRS = TIERS.map((t) => [t, TIER_W[t]]);

  // ── Card construction ──────────────────────────────────────────────────────
  function buildCells(rng, c, pools) {
    const n = c.size * c.size;
    const freeIdx = effFree(c) ? (n - 1) / 2 : -1;
    const need = n - (freeIdx >= 0 ? 1 : 0);
    const active = CATS.filter((x) => (c.cats[x.id] | 0) > 0);

    const softBags = {}, hardBags = {};
    for (const x of active) {
      softBags[x.id] = weightedShuffle(pools.soft[x.id].slice(), rng);
      hardBags[x.id] = weightedShuffle(pools.hard[x.id].slice(), rng);
    }

    // A pool with nothing above the soft floor is HARD-NATIVE: rare is simply what it is.
    // Combo is the case that matters — even pruned to 20 trees, most pairs land between the
    // floors, so charging them against the hard budget would not ration the pool, it would
    // delete it. The budget exists to stop a pool that COULD have given an ordinary square
    // from handing over a rare one; it was never meant to veto a pool outright.
    const hardNative = {};
    for (const x of active) hardNative[x.id] = !softBags[x.id].length && hardBags[x.id].length > 0;

    // Which draw ordinals become hard squares. Chosen up front so the count is exact and
    // seeded, rather than emerging from a per-square coin flip.
    const hardAt = new Set();
    const budget = Math.min(hardBudgetFor(need), need);
    for (let guard = 0; hardAt.size < budget && guard < need * 8; guard++) hardAt.add(rng.rand(need));

    const used = new Set(), drawn = [];
    while (drawn.length < need) {
      const wantHard = hardAt.has(drawn.length);
      const live = active.filter((x) =>
        hardNative[x.id] ? hardBags[x.id].length : (wantHard ? hardBags : softBags)[x.id].length);
      const pool = live.length ? live : active.filter((x) => softBags[x.id].length || hardBags[x.id].length);
      if (!pool.length) break;

      const total = pool.reduce((s, x) => s + c.cats[x.id], 0);
      let r = rng.next() * total, chosen = pool[pool.length - 1];
      for (const x of pool) { r -= c.cats[x.id]; if (r < 0) { chosen = x; break; } }

      const useHard = hardNative[chosen.id] || (wantHard && hardBags[chosen.id].length);
      const bag = (useHard ? hardBags : softBags)[chosen.id];
      const goal = (bag.length ? bag : hardBags[chosen.id].length ? hardBags[chosen.id] : softBags[chosen.id]).pop();
      if (!goal) break;
      if (used.has(goal.k)) continue;
      used.add(goal.k);
      drawn.push(toCell(goal));
    }

    const cells = [];
    let di = 0;
    for (let i = 0; i < n; i++) {
      if (i === freeIdx) cells.push({ key: "free", cat: "free", text: "FREE", icon: "", tint: POOL_COLORS.free });
      else if (di < drawn.length) cells.push(drawn[di++]);
      else cells.push({ key: "empty:" + i, cat: "empty", text: "—", icon: "", tint: "" });
    }
    // Bags keep the leftovers so a per-square reroll has somewhere to draw from.
    return { cells: cells, freeIdx: freeIdx, need: need, filled: drawn.length, bags: softBags, used: used };
  }

  function generate(token, player) {
    const body = seedBody(cfg, token);
    player = player || newPlayer();
    const fp = b32(hashStr(fingerprint()), 4);
    // THREE streams, all derived from the seed and deliberately independent:
    //   session          -> the pruned tree pool. Shared, so everyone draws the same universe.
    //   session + player -> this card's squares. Per player, so nobody shares a board.
    //   session + draw n -> the nth talisman (see drawAt). Shared, so calls match.
    const keep = GOALS.keepFor(makeRng(body), KEEP_N);
    const pools = buildPools(keep);
    view = pools.view;
    const built = buildCells(makeRng(body + "|p" + player), cfg, pools);
    bags = built.bags;
    usedKeys = built.used;
    card = {
      seed: body + "-" + player + "-" + fp, token: token, player: player,
      session: body, fp: fp, keep: keep,
      cfg: JSON.parse(JSON.stringify(cfg)),
      modified: false, freeIdx: built.freeIdx, cells: built.cells,
      marked: new Set(built.freeIdx >= 0 ? [built.freeIdx] : []), eligible: [],
      created: Date.now(), need: built.need, short: built.need - built.filled,
      draws: 0, firstBingoDraw: null, blackoutDraw: null, log: [], last: null,
    };
    // A new card is a new session. Anything live was tied to the OLD one, so keep going and
    // the modal shows a session you are no longer on, while draws post to a session whose
    // talismans no longer match the board in front of you.
    if (live && live.session !== card.session) {
      const wasHosting = live.mine;
      live = null;
      stopPolling();
      rememberLive();
      liveNote(wasHosting ? "gmLiveStatus" : "joinStatus",
        wasHosting ? "New card — the old session ended here. Start a new one when ready."
                   : "New card — you have left that session.");
    }
    renderCard();
    saveCard();
    renderTwitch();
  }

  function rerollCell(i) {
    const cell = card.cells[i];
    let bag = bags[cell.cat];
    if (!bag || !bag.length) {
      const alt = CATS.filter((c) => bags[c.id] && bags[c.id].length)
        .sort((a, b) => (card.cfg.cats[b.id] | 0) - (card.cfg.cats[a.id] | 0))[0];
      bag = alt ? bags[alt.id] : null;
    }
    if (!bag || !bag.length) return;
    // Bags hold RAW GOALS (keyed `k`), not finished cells. They stopped being cell-shaped
    // when the catalogue moved to goals.js, and this read `g.key` for a while afterwards:
    // always undefined, so the dedupe never fired and the raw goal went onto the card with
    // no text, tint or cond — a blank, unmatchable square. Wrap with toCell on the way in.
    let next = null;
    while (bag.length) { const g = bag.pop(); if (!usedKeys.has(g.k)) { next = g; break; } }
    if (!next) return;
    usedKeys.delete(cell.key);
    usedKeys.add(next.k);
    card.cells[i] = toCell(next);
    card.marked.delete(i);
    // A fresh square must not inherit the previous one's glow, nor its claim: the new goal
    // has never been drawn for, whatever the old one had earned.
    if (card.hint) card.hint = card.hint.filter((x) => x !== i);
    if (card.eligible) card.eligible = card.eligible.filter((x) => x !== i);
    card.modified = true;
    renderCard();
    saveCard();
  }

  // ── The draw ───────────────────────────────────────────────────────────────
  // NOT seeded, deliberately.
  //
  // A drawn charm marks every open square it satisfies, and the player makes no decisions.
  // If the draw stream were derived from the card seed, every player on a given seed would
  // get a byte-identical game and "fewest draws" would have exactly one possible answer.
  // The card is the shared, reproducible part; the luck is not. A shared seed means "we
  // raced the same board", not "we got the same rolls".
  // Drawing no longer marks anything. One person draws and calls the charm out; everyone
  // else is looking at their own card on their own device, so the app cannot know what any
  // given player has marked — only they can say. What it CAN do is point: `hint` is the set
  // of unmarked squares this charm would satisfy, which the card renders as an outer glow.
  //
  // That is the whole reason marking is manual now. Auto-marking made the draw count an
  // objective score; with several people racing one seed, the draw count is the caller's
  // clock and the marking is each player's own.
  // ONE path for a talisman reaching the card, whatever produced it: the Gamemaster rolling
  // here, a live session syncing a draw number off the Worker, or a player typing in what was
  // called across the table. All three must be indistinguishable from this point on -- any
  // second path is a place for the modes to drift apart.
  function applyCharm(charm) {
    if (!charm) return null;
    // Two sets, and the difference matters. `hint` is what to go click NOW, so it skips
    // squares already marked. `eligible` is every square ANY draw has ever satisfied, and it
    // only grows.
    const hint = [], eligible = new Set(card.eligible || []);
    for (let i = 0; i < card.cells.length; i++) {
      const cell = card.cells[i];
      if (!cell.cond) continue;
      if (!satisfies(charm, cell.cond)) continue;
      eligible.add(i);
      if (!card.marked.has(i)) hint.push(i);
    }
    card.draws++;
    card.eligible = [...eligible];
    card.hint = hint;
    card.last = { charm: charm, hits: hint.length, at: card.draws };
    card.log.unshift({ charm: charm, hits: hint.length, at: card.draws });
    if (card.log.length > 50) card.log.length = 50;
    return { charm: charm, hits: hint };
  }

  // Talisman N of the session. Seeded PER DRAW rather than from one running stream, so it is
  // reproducible without replaying: reload, undo a draw, or join late and draw 12 is still
  // draw 12. A single advancing stream would have to be replayed from zero to stay in sync,
  // and would desync permanently the moment anyone removed an entry.
  //
  // This is what makes a shared session work with no server at all. The only state the table
  // has to agree on is which number they're on, which a Gamemaster can simply say out loud.
  function drawAt(n) {
    if (!card) return null;
    const table = view || ROLL.table(card.keep);
    return table.draw(TIER_PAIRS, makeRng((card.session || card.seed) + "|d" + n));
  }

  function drawOnce() {
    if (!card || isComplete()) return null;
    const charm = drawAt(card.draws + 1);
    return charm ? applyCharm(charm) : null;
  }

  // Replay the card's own draw stream and re-derive which squares it has legitimately made
  // claimable. Cheap enough to run on load: a few hundred pure rolls against 25 conditions.
  //
  // Nothing removes a draw any more, so this is no longer a repair for deletion. It is a
  // repair for cards SAVED while deletion existed: those carry an eligible set inflated by
  // draws that were taken back, and with marking now gated that set is the difference between
  // a locked square and a free one. Running it on restore heals them.
  function rebuildEligible() {
    if (!card) return;
    const set = new Set();
    for (let n = 1; n <= card.draws; n++) {
      const charm = drawAt(n);
      if (!charm) break;
      for (let i = 0; i < card.cells.length; i++) {
        const cell = card.cells[i];
        if (cell.cond && !set.has(i) && satisfies(charm, cell.cond)) set.add(i);
      }
    }
    // Anything already marked stays claimable, so an unmark can always be redone.
    for (const i of card.marked) set.add(i);
    card.eligible = [...set];
  }

  const isEligible = (i) =>
    !!card && (card.eligible || []).indexOf(i) > -1;

  function toggleMark(i) {
    if (!card || i === card.freeIdx) return;
    const cell = card.cells[i];
    if (!cell || !cell.cond) return;
    // Unmarking is always allowed — that is how you undo a misclick. Marking is not: a
    // square only becomes claimable once some draw has actually satisfied it, which is what
    // the draw history is for.
    if (!card.marked.has(i) && !isEligible(i)) return;
    if (card.marked.has(i)) card.marked.delete(i);
    else {
      card.marked.add(i);
      if (card.hint) card.hint = card.hint.filter((x) => x !== i);
    }
    if (card.firstBingoDraw == null && completedLines().length) card.firstBingoDraw = card.draws;
    if (card.blackoutDraw == null && isComplete()) card.blackoutDraw = card.draws;
    card.modified = true;
    renderCard();
    saveCard();
  }

  const totalCells = () => card ? card.cells.filter((c) => c.cat !== "empty").length : 0;
  const isComplete = () => !!card && card.marked.size >= totalCells() && totalCells() > 0;

  function doDraw() {
    // Last line: inside a session, nothing advances this card except the server's number.
    // The Gamemaster's Draw button posts first and syncs to what comes back; it never lands
    // here while a session is running.
    if (live) return false;
    if (!drawOnce()) return false;
    renderCard();
    saveCard();
    return true;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  const markedBorder = (tint) => tint ? css(lighten(hexRgb(tint), 0.55)) : "rgba(255,255,255,.55)";

  function renderCard() {
    if (!card) return;
    const wrap = $("bingoCard");
    wrap.textContent = "";
    wrap.style.setProperty("--n", card.cfg.size);
    // A render replaces every cell node, so a hold spanning one has to re-apply itself.
    const logCheckSet = logCheckOn ? logCheckSquares() : [];

    card.cells.forEach((cell, i) => {
      const el = document.createElement("div");
      el.className = "cell";
      if (cell.cat === "free") el.classList.add("free");
      if (cell.cat === "empty") el.classList.add("empty");
      if (card.marked.has(i)) el.classList.add("marked");
      // The glow says "this one" — it never marks. Only the player marks, and marking is
      // what swaps the glow for the filled state.
      if (softHighlight && card.hint && card.hint.indexOf(i) > -1) el.classList.add("hinted");
      if (logCheckOn && logCheckSet.indexOf(i) > -1) el.classList.add("hinted");

      if (cell.icon) {
        const img = document.createElement("img");
        img.className = "cell-icon";
        img.alt = "";
        img.src = cell.icon;
        img.onerror = () => { img.onerror = null; img.src = FALLBACK_ICON; };
        el.appendChild(img);
      }
      const txt = document.createElement("div");
      txt.className = "cell-text";
      txt.textContent = cell.text;
      el.appendChild(txt);
      // Squares ARE interactive now: one person draws and calls the charm, and each player
      // marks their own card. A div rather than a <button> because the reroll control nests
      // inside it, and a button inside a button is invalid — hence the explicit role, tab
      // stop and key handling.
      const claimable = cell.cond && (card.marked.has(i) || isEligible(i));
      if (cell.cond) {
        if (claimable) {
          el.setAttribute("role", "button");
          el.setAttribute("tabindex", "0");
          el.setAttribute("aria-pressed", card.marked.has(i) ? "true" : "false");
          el.setAttribute("aria-label", cell.text + (card.marked.has(i) ? ", marked" : ""));
          el.addEventListener("click", () => toggleMark(i));
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMark(i); }
          });
        } else {
          // Not yet drawn for. Left out of the tab order rather than given aria-disabled,
          // because a control you cannot use is noise to step through.
          el.classList.add("locked");
          el.setAttribute("aria-label", cell.text + ", not yet drawn");
        }
      }
      if (cell.cat !== "free" && cell.cat !== "empty" && showReroll) {
        const rr = document.createElement("button");
        rr.type = "button";
        rr.className = "cell-reroll";
        rr.textContent = "↻";
        rr.title = "Reroll this square";
        rr.setAttribute("aria-label", "Reroll this square");
        rr.addEventListener("click", (e) => { e.stopPropagation(); rerollCell(i); });
        el.appendChild(rr);
      }
      wrap.appendChild(el);
    });

    highlightLines();
    renderDraw();
    updateSeedBar();
    updateBanner();
  }

  // Row/column/diagonal index sets for a given size.
  function linesFor(s) {
    const out = [];
    for (let r = 0; r < s; r++) out.push(Array.from({ length: s }, (_, c) => r * s + c));
    for (let c = 0; c < s; c++) out.push(Array.from({ length: s }, (_, r) => r * s + c));
    out.push(Array.from({ length: s }, (_, i) => i * s + i));
    out.push(Array.from({ length: s }, (_, i) => i * s + (s - 1 - i)));
    return out;
  }
  const completedLines = () =>
    !card ? [] : linesFor(card.cfg.size).filter((ln) => ln.every((i) => card.marked.has(i)));

  function highlightLines() {
    if (!card) return;
    const cells = $("bingoCard").children;
    const done = completedLines();
    const lit = new Set();
    for (const ln of done) for (const i of ln) lit.add(i);

    // Single place that decides a square's border, in priority order: part of a completed
    // line beats merely marked, which beats the pool's own colour.
    for (let i = 0; i < cells.length; i++) {
      cells[i].classList.toggle("line", lit.has(i));
      cells[i].style.borderColor = lit.has(i) ? "var(--win)"
        : card.marked.has(i) ? markedBorder(card.cells[i].tint)
        : (card.cells[i].tint || "");
    }

    const el = $("status");
    const total = totalCells();
    el.classList.toggle("win", done.length > 0);
    if (isComplete()) el.textContent = "BLACKOUT in " + card.blackoutDraw.toLocaleString() + " draws!";
    else if (done.length) {
      el.textContent = "Bingo! " + done.length + (done.length === 1 ? " line" : " lines")
        + " — first in " + card.firstBingoDraw.toLocaleString() + " draws";
    } else el.textContent = card.marked.size + " of " + total + " marked";
  }

  // ── The draw panel ─────────────────────────────────────────────────────────
  // Renders the charm the way the game would show it: rarity icon, talisman name, slot
  // pips, then one line per skill.
  function charmNode(charm, hits, at) {
    const wrap = document.createElement("div");
    wrap.className = "charm";
    if (ROLL.isGod(charm)) wrap.classList.add("god");
    if (hits) wrap.classList.add("hit");

    const img = document.createElement("img");
    img.className = "charm-icon";
    img.alt = "";
    img.src = talismanIcon(charm.r);
    img.onerror = () => { img.onerror = null; img.src = talismanIcon(0); };
    wrap.appendChild(img);

    const body = document.createElement("div");
    body.className = "charm-body";

    // Same field order as a log row -- number and name, skills, slots -- so the talisman you
    // just drew and the same talisman five draws later read identically. They used to differ
    // in both shape and slot notation, which made the log look like a different data source.
    const head = document.createElement("div");
    head.className = "charm-name";
    if (at != null) {
      const n = document.createElement("span");
      n.className = "charm-n";
      n.textContent = "#" + at;
      head.appendChild(n);
    }
    const nm = document.createElement("span");
    nm.textContent = charmName(charm.r);
    head.appendChild(nm);
    body.appendChild(head);

    // Always two skill lines, even when the talisman has one. A charm with no second skill is
    // the common case, and letting the block shrink meant the slots and the match count moved
    // up a line between draws -- so the two fields you actually read were never in the same
    // place twice running.
    for (let i = 0; i < 2; i++) {
      const sk = charm.k[i];
      const line = document.createElement("div");
      line.className = "charm-skill" + (sk ? (sk[1] < 0 ? " neg" : "") : " none");
      line.textContent = sk ? treeName(sk[0]) + " " + (sk[1] > 0 ? "+" : "") + sk[1] : "N/A";
      body.appendChild(line);
    }

    const pips = document.createElement("div");
    pips.className = "charm-slots";
    pips.textContent = SLOT_GLYPH[charm.s | 0] || SLOT_GLYPH[0];
    pips.title = charm.s + (charm.s === 1 ? " slot" : " slots");
    body.appendChild(pips);

    wrap.appendChild(body);
    return wrap;
  }

  function renderDraw() {
    if (!card) return;
    const last = $("lastCharm");
    last.textContent = "";
    if (card.last) {
      last.appendChild(charmNode(card.last.charm, card.last.hits, card.last.at));
      const note = document.createElement("div");
      note.className = "charm-note" + (card.last.hits ? " hit" : "");
      // Not "marked N squares" any more: the draw marks nothing, the player does. Claiming
      // otherwise is how a draw that lights one ring while reporting two reads as a bug.
      note.textContent = card.last.hits
        ? card.last.hits + (card.last.hits === 1 ? " Matching Tile" : " Matching Tiles")
        : "No matching tiles";
      last.appendChild(note);
    } else {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "Press Draw to roll a talisman.";
      last.appendChild(p);
    }

    const log = $("drawLog");
    log.textContent = "";
    // The newest entry is the talisman shown above as the current draw, so the log starts at
    // the one before it. Printing it in both places made the top of the block say the same
    // thing twice, and the copy in the log is the one that moves -- it only becomes history
    // once the next draw pushes it down.
    for (const entry of card.log.slice(1)) {
      const row = document.createElement("div");
      row.className = "log-row" + (entry.hits ? " hit" : "");

      // One field per line, in the order the player reads them: which draw and what it was,
      // then each skill, then the slots, then what it means for their card. A single line
      // could not hold a two-skill talisman without ellipsising the half worth reading, and
      // stacking the skills also lines the "+N" up into a column down the log.
      const head = document.createElement("div");
      head.className = "log-line";
      const n = document.createElement("span");
      n.className = "log-n";
      n.textContent = "#" + entry.at;
      const nm = document.createElement("span");
      nm.className = "log-name";
      nm.textContent = charmName(entry.charm.r);
      head.appendChild(n); head.appendChild(nm);
      row.appendChild(head);

      // Two lines always, for the same reason as the drawn talisman above: a fixed row height
      // is what lets the eye scan straight down the slot glyphs and the match counts.
      for (let i = 0; i < 2; i++) {
        const kv = entry.charm.k[i];
        const sk = document.createElement("div");
        sk.className = "log-skill" + (kv ? "" : " none");
        sk.textContent = kv ? treeName(kv[0]) + " " + (kv[1] > 0 ? "+" : "") + kv[1] : "N/A";
        row.appendChild(sk);
      }

      const sl = document.createElement("div");
      sl.className = "log-slots";
      sl.textContent = SLOT_GLYPH[entry.charm.s | 0] || SLOT_GLYPH[0];
      sl.title = (entry.charm.s | 0) + ((entry.charm.s | 0) === 1 ? " slot" : " slots");
      row.appendChild(sl);

      // Was "+N", from when a draw added N marks by itself. It never meant a bonus or a
      // score — it is how many squares on THIS card the charm satisfies — and now that
      // marking is manual it is a to-do count, so it says so rather than implying the app
      // already did it.
      const h = document.createElement("div");
      h.className = "log-hit";
      h.textContent = entry.hits
        ? entry.hits + (entry.hits === 1 ? " Matching Tile" : " Matching Tiles")
        : "No matching tiles";
      row.appendChild(h);

      log.appendChild(row);
    }

    $("drawBtn").disabled = isComplete();
    $("peNext").disabled = isComplete();
  }

  function updateSeedBar() {
    if (!card) return;
    $("seedInput").value = card.seed;
    $("seedModified").classList.toggle("hidden", !card.modified);
    // Copying the SESSION is the normal sharing action, not copying the seed: the full seed
    // ends in this player's card token, so handing it out gives everyone your exact board.
    const sc = $("sessionCopy");
    if (sc) sc.title = "Copy the session (" + (card.session || "") + ") — same draws, own card";
  }

  function updateBanner() {
    const b = $("banner");
    if (!card) return b.classList.add("hidden");
    const msgs = [];
    if (card.short > 0) {
      msgs.push("Only " + (card.need - card.short) + " of " + card.need
        + " squares could be filled — turn on more pools, raise a tier weight, or use a smaller grid.");
    }
    if (card.fp && card.fp !== b32(hashStr(fingerprint()), 4)) {
      msgs.push("This seed was made before the talisman data was updated, so the squares may differ.");
    }
    b.textContent = msgs.join(" ");
    b.classList.toggle("hidden", !msgs.length);
  }

  // How many distinct goals each pool can currently offer, and whether the grid can be
  // filled at all. Runs on every settings change, so a pool that a tier mix has emptied
  // says so before the player presses New Card.
  function refreshCounts() {
    // A sample keep-set, not the card's: this only decides which grid sizes are offered, and
    // pool sizes barely move between keep-sets. The real card builds its own.
    const pools = buildPools(GOALS.keepFor(makeRng("avail"), KEEP_N));
    let avail = 0;
    for (const c of CATS) {
      // Counted from the ordinary band only. The hard band is capped at a couple of squares
      // per card, so folding it in here would claim a grid can be filled when it can't.
      if ((cfg.cats[c.id] | 0) > 0) avail += pools.soft[c.id].length;
    }
    const n = cfg.size * cfg.size - (effFree(cfg) ? 1 : 0);
    // The tally still decides which grid sizes are offered, but it is never printed. A goal
    // count is the same kind of spoiler as a per-tile probability: it invites counting the
    // catalogue instead of playing it, and it was the only place the odds leaked back in.
    $("poolStatus").textContent = n + (n === 1 ? " square to fill" : " squares to fill");
    for (const opt of $("gridSize").options) {
      const need = opt.value * opt.value - ((cfg.free && opt.value % 2 === 1) ? 1 : 0);
      opt.disabled = need > avail && parseInt(opt.value, 10) !== cfg.size;
    }
    $("newCardBtn").disabled = avail === 0;
  }
  // ── Theme ──────────────────────────────────────────────────────────────────
  const hexRgb = (h) => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const rgbToHsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
            : max === g ? ((b - r) / d + 2) / 6
            :             ((r - g) / d + 4) / 6;
    return [h, s, l];
  };
  const hslToRgb = ([h, s, l]) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2;
    const hi = Math.floor(h * 6) % 6;
    const [r, g, b] = hi === 0 ? [c, x, 0] : hi === 1 ? [x, c, 0] : hi === 2 ? [0, c, x]
                    : hi === 3 ? [0, x, c] : hi === 4 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m].map(v => clamp(v * 255));
  };
  // Only lightness is shifted, so every derived shade keeps the chosen colour's hue.
  const darken  = (rgb, f) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l * f)]); };
  const lighten = (rgb, b) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l + (1 - l) * b)]); };
  const css = (rgb) => "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";

  // WCAG relative luminance / contrast, used to pick a bingo highlight that stays legible
  // on every theme rather than only on the dark ones.
  const relLum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const x = relLum(a), y = relLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const mix = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));

  // The bingo highlight.
  //
  // Every other colour on the page is derived from the theme by shifting lightness only,
  // so a brighter shade of the same hue reads as "slightly lighter" rather than "you won".
  // Two things fix that. The hue is rotated a full 180°, putting it as far from the
  // theme's family as the colour wheel allows — including on the near-greyscale themes,
  // which have almost no chroma of their own to compete with.
  //
  // A completed line FILLS its squares with this colour rather than just outlining them,
  // which is what makes the lightness solvable. Trying to tune a 2px border to contrast
  // with both the gap behind the grid and the marked-square fill pulls in two directions
  // at once, and on the amber themes it has no good answer at all — an earlier attempt
  // bottomed out at 1.24:1. Filling the square leaves exactly one contrast requirement:
  // the cell's white text has to stay readable on it.
  //
  // HSL lightness is not perceived brightness (green carries 72% of relative luminance,
  // blue only 7%), so a fixed lightness would be readable at one hue and not another.
  // Instead, walk down from a vivid lightness until white text clears WCAG AA. Every hue
  // reaches that eventually, so this always terminates with the lightest colour that is
  // still legible.
  const WHITE = [255, 255, 255];
  function winColor(c) {
    const hue = (rgbToHsl(c)[0] + 0.5) % 1;
    for (let l = 0.60; l >= 0.20; l -= 0.01) {
      const cand = hslToRgb([hue, 0.95, l]);
      if (contrast(cand, WHITE) >= 4.5) return cand;
    }
    return hslToRgb([hue, 0.95, 0.20]);
  }

  // New Card, the one control the page wants you to reach for. It used to be --bg1, a
  // near-black shade of the theme sitting on the near-black --bg2 sidebar, so it read as
  // just another panel.
  //
  // Same lightness search as winColor and for the same reason — HSL lightness isn't
  // perceived brightness, so one fixed value would be legible at some hues and not others —
  // but at the theme's OWN hue rather than its opposite. That keeps it in the family and
  // leaves the 180°-rotated --win as the only thing on the page wearing that colour, so a
  // bright button never reads as a bingo.
  //
  // Saturation is taken from the theme untouched. An earlier version floored it, which put
  // a blue button on K. Daora, Valstrax and Forbidden — the three neutral themes have
  // barely any chroma, so a floor doesn't make them vivid, it invents a hue out of
  // rounding noise. Lightness alone is enough to separate the button there: the search
  // still lands it ~4.5:1 clear of the sidebar, just in grey.
  //
  // Lightening from the theme colour instead was the obvious alternative and fails outright
  // on a pale theme — lighten() of the lightest swatch runs to near-white, and the button's
  // text is white.
  function ctaColor(c) {
    const [hue, sat] = rgbToHsl(c);
    for (let l = 0.62; l >= 0.22; l -= 0.01) {
      const cand = hslToRgb([hue, sat, l]);
      if (contrast(cand, WHITE) >= 4.5) return cand;
    }
    return hslToRgb([hue, sat, 0.22]);
  }

  // The hint ring, which has to be the most visible thing on the card for the moment it is
  // up. It cannot be --accent: that is darken(c,.70), byte-identical to --bg, so a ring drawn
  // in it has a contrast ratio of exactly 1.00 against the square behind it. That is how the
  // highlight first shipped and why it was hard to see.
  //
  // A fixed lighten() is not enough either. It is bright on the dark themes and washes out on
  // the pale ones — measured 1.7:1 on the pale yellow, against 8:1 on the dark green. So this
  // searches the whole lightness axis at the theme's own hue and keeps whatever contrasts
  // best against the card well, which means it goes light on dark themes and dark on pale
  // ones rather than assuming every theme is dark enough to take a white ring.
  function hintColor(c) {
    const well = darken(c, .40);
    const [hue, sat] = rgbToHsl(c);
    let best = null, bestRatio = 0;
    for (let l = 0.97; l >= 0.06; l -= 0.03) {
      const cand = hslToRgb([hue, sat, l]);
      const r = contrast(cand, well);
      if (r > bestRatio) { bestRatio = r; best = cand; }
    }
    return best || WHITE;
  }

  // Every theme in COLORS is a dark one, so there's no light branch to switch on.
  function applyTheme(hex) {
    const c = hexRgb(hex), r = document.documentElement.style;
    const well = darken(c, .40), accent = darken(c, .70);
    r.setProperty("--bg",           css(darken(c, .70)));
    r.setProperty("--bg1",          css(darken(c, .80)));
    r.setProperty("--bg2",          css(darken(c, .95)));
    // The card well sits behind the squares, so it has to read as darker than they do —
    // otherwise the grid dissolves into the background.
    r.setProperty("--well",         css(well));
    r.setProperty("--accent",       css(accent));
    r.setProperty("--accent-hover", css(lighten(c, .40)));
    r.setProperty("--win",          css(winColor(c)));
    r.setProperty("--hint",         css(hintColor(c)));
    r.setProperty("--cta",          css(ctaColor(c)));
    r.setProperty("--text",     "#ffffff");
    r.setProperty("--text-dim", "#fffffff5");
    r.setProperty("--line",     "rgba(11,8,8,0.12)");
    r.setProperty("--card",     "rgba(255,255,255,0.05)");
    try { localStorage.setItem(THEME_KEY, hex); } catch (e) {}
    document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("sel", s.dataset.hex === hex));
    const icon = document.querySelector(".title-icon");
    if (icon) {
      const name = COLORS_HEX[hex.toUpperCase()];
      icon.src = name ? monsterIcon(COLORS_ICON[name] || name) : FALLBACK_ICON;
    }
    // Repaint the card on a theme change. Chromium does not reliably re-resolve a
    // var()-based background on cells that have already been painted when the custom
    // property changes on :root — the cell reads the new --win, but keeps rendering the
    // old colour indefinitely, even after a forced reflow. Rebuilding the squares is
    // cheap (25 nodes) and is what actually repaints a completed line's fill.
    if (card) renderCard();
  }

  function buildSwatches() {
    const wrap = $("swatches");
    wrap.textContent = "";
    for (const [name, hex] of COLORS) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "swatch";
      b.dataset.hex = hex; b.style.background = hex; b.title = name;
      const img = document.createElement("img");
      img.className = "swatch-icon"; img.alt = "";
      img.src = monsterIcon(COLORS_ICON[name] || name);
      img.onerror = () => { img.onerror = null; img.src = FALLBACK_ICON; };
      const span = document.createElement("span");
      span.textContent = name;
      b.appendChild(img); b.appendChild(span);
      b.addEventListener("click", () => applyTheme(hex));
      wrap.appendChild(b);
    }
  }

  // ── Enlarged tile preview ──────────────────────────────────────────────────
  // Hovering a square shows a bigger copy of it. At 10x10 the text is around 5px, so the
  // card becomes unreadable long before it becomes unplayable — this is what makes the
  // larger grids usable rather than just possible.
  // Smallest grid the preview kicks in at; 0 disables it. A display preference, so it
  // stays off cfg for the same reason showReroll does.
  let previewMin = 5;

  function hidePreview() { $("tilePreview").classList.remove("on"); }

  function showPreview(el) {
    if (!previewMin || !card || card.cfg.size < previewMin) return hidePreview();

    const r = el.getBoundingClientRect();
    const p = $("tilePreview");
    p.textContent = "";
    const clone = el.cloneNode(true);
    clone.removeAttribute("id");
    clone.querySelectorAll(".cell-reroll").forEach(b => b.remove());
    p.appendChild(clone);
    p.classList.add("on");

    // Prefer the right of the square, flip to the left when it would run off, and clamp
    // vertically so a square near the top or bottom edge still shows a full panel.
    const pw = p.offsetWidth, ph = p.offsetHeight, M = 10;
    let x = r.right + M;
    if (x + pw > innerWidth - M) x = r.left - pw - M;
    if (x < M) x = M;
    const y = Math.max(M, Math.min(r.top + r.height / 2 - ph / 2, innerHeight - ph - M));
    p.style.left = Math.round(x) + "px";
    p.style.top = Math.round(y) + "px";
  }

  // ── Confirmation ───────────────────────────────────────────────────────────
  // Only asked when there is something to lose. An unmarked card costs nothing to
  // regenerate — and its seed is sitting in the title bar anyway — so confirming that
  // would be pure friction. Marks are the part that can't be recovered.
  let confirmFn = null, cancelFn = null;
  function markedCount() {
    if (!card) return 0;
    return card.marked.size - (card.freeIdx >= 0 && card.marked.has(card.freeIdx) ? 1 : 0);
  }
  // Always asks, unlike guard(), which only interrupts when there is marked progress to lose.
  // Restarting a session is outward-facing -- it strands everyone currently following it --
  // so it is confirmed even when this card is untouched.
  function confirmAlways(title, body, okLabel, fn, onCancel) {
    $("confirmTitle").textContent = title;
    $("confirmBody").textContent = body;
    $("confirmOk").textContent = okLabel;
    confirmFn = fn;
    cancelFn = onCancel || null;
    $("confirmModal").classList.remove("hidden");
  }

  function guard(title, okLabel, fn) {
    const n = markedCount();
    if (!n) return fn();
    $("confirmTitle").textContent = title;
    $("confirmBody").textContent = "You've marked " + n + (n === 1 ? " square" : " squares")
      + " on this card. That progress is lost — the squares themselves you can always get back from the seed.";
    $("confirmOk").textContent = okLabel;
    confirmFn = fn;
    $("confirmModal").classList.remove("hidden");
  }
  function closeConfirm() {
    $("confirmModal").classList.add("hidden");
    confirmFn = null;
    cancelFn = null;
  }


  // ── Sidebar ────────────────────────────────────────────────────────────────
  function buildCatRows() {
    const wrap = $("catList");
    wrap.textContent = "";
    for (const c of CATS) {
      const row = document.createElement("div");
      row.className = "cat-row";

      const l = document.createElement("label");
      l.className = "chk";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = (cfg.cats[c.id] | 0) > 0;
      const num = document.createElement("input");
      num.type = "number";
      num.className = "num";
      num.min = 1; num.max = 9;
      num.value = Math.max(1, cfg.cats[c.id] | 0);
      num.title = "Weight 1-9";
      num.disabled = !cb.checked || !!live;
      cb.disabled = !!live;

      cb.addEventListener("change", () => {
        cfg.cats[c.id] = cb.checked ? Math.max(1, parseInt(num.value, 10) || 1) : 0;
        num.disabled = !cb.checked;
        seedSettingChanged();
      });
      num.addEventListener("change", () => {
        num.value = Math.min(9, Math.max(1, parseInt(num.value, 10) || 1));
        if (cb.checked) cfg.cats[c.id] = parseInt(num.value, 10);
        seedSettingChanged();
      });

      l.appendChild(cb);
      l.appendChild(document.createTextNode(c.label));
      row.appendChild(l);
      row.appendChild(num);

      const hint = document.createElement("p");
      hint.className = "hint cat-hint";
      hint.textContent = c.hint;

      const box = document.createElement("div");
      box.className = "cat-box";
      box.style.borderLeftColor = POOL_COLORS[c.id];
      box.appendChild(row);
      box.appendChild(hint);
      wrap.appendChild(box);
    }
  }


  // Built from POOL_COLORS rather than repeated in the markup, so the Help legend can never
  // drift from what the cards actually draw.
  function buildColourLegend() {
    const wrap = $("legend");
    if (!wrap) return;
    wrap.textContent = "";
    for (const c of CATS) {
      const row = document.createElement("div");
      const sw = document.createElement("span");
      sw.className = "legend-sw";
      sw.style.background = POOL_COLORS[c.id];
      row.appendChild(sw);
      row.appendChild(document.createTextNode(c.label));
      wrap.appendChild(row);
    }
  }

  // ── Live sessions ──────────────────────────────────────────────────────────
  // A Gamemaster draws; everyone following the session sees it appear on their own card.
  //
  // Only ONE INTEGER crosses the network — the current draw number. drawAt(n) is a pure
  // function of (session string, n), so every client turns that integer into the identical
  // talisman locally. The server never sees a talisman, a card or a mark.
  //
  // That is also why losing the connection is survivable: the session string alone still
  // determines the prune and the whole draw sequence, so a dropped viewer falls back to the
  // manual controls and keeps playing off what the Gamemaster calls out.
  const TOKEN_KEY = "mhgu-talisman-bingo-token";
  const POLL_MS = 3000;

  let live = null;        // { session, n, ended, owner, mine } while connected
  let livePoll = null;
  let liveLost = false;

  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } };
  const setToken = (t) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  };

  // Who the stored token says you are. For DISPLAY ONLY — the token is a signed {login, exp}
  // blob and the Worker verifies the signature on every privileged call; nothing here trusts
  // what this returns. Same approach MHGU Bingo uses.
  function loggedInAs() {
    const t = getToken();
    if (!t) return null;
    try {
      const payload = JSON.parse(atob(t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.exp && payload.exp > Date.now() ? payload.login : null;
    } catch (e) { return null; }
  }

  function renderTwitch() {
    const who = loggedInAs();
    $("twitchLoggedOut").classList.toggle("hidden", !!who);
    $("twitchLoggedIn").classList.toggle("hidden", !who);
    if (who) $("twitchLoginName").textContent = who;

    // Nightbot pastes the whole $(urlfetch ...) tag in as the command's RESPONSE; Moobot and
    // most others want the bare URL in their own fetch tag. Both forms, same as MHGU Bingo's
    // bot modal and the Quest Randomizer's.
    //
    // Not an !addcom line: that is Nightbot's syntax for CREATING a command, which is useless
    // in a bot's web UI and wrong for every other bot.
    const url = BOT_API_ORIGIN + "/live-link?channel=";
    $("cmdNightbot").textContent = "$(urlfetch " + url + "$(channel))";
    $("cmdUrl").textContent = url + (who || "YOUR_CHANNEL");

    const hosting = !!live && live.mine;
    $("liveIdle").classList.toggle("hidden", hosting);
    $("liveRunning").classList.toggle("hidden", !hosting);
    // Which session Start is about to claim. Without it, "New session" changes something you
    // cannot see -- the full seed is in the bar behind the modal, but the session half is the
    // part that matters here and the bar shows the player token too.
    if (!hosting && card) $("liveIdleSession").value = card.session || "";
    if (hosting) {
      $("liveSessionOut").value = live.session;
      // The draw count makes it visibly alive rather than merely claiming to be. A static
      // "Live" tells you nothing about whether it is still working.
      $("liveDrawCount").textContent = "draw " + (live.n | 0);
    }
    // On the header button too: whether a session is running should not require opening a
    // modal to discover.
    $("liveDot").classList.toggle("hidden", !live);
    $("liveDot").classList.toggle("lost", !!live && liveLost);
    $("twitchBtn").title = !live ? "Twitch & live sessions"
      : liveLost ? "Lost the connection — draws are local until it returns"
      : (live.mine ? "LIVE — hosting a session" : "Following a live session");
    // Signing in is part of starting, not a prerequisite to be enforced up front — pressing
    // this signed out sends you to Twitch and you come back ready to go.
    $("liveIdleHint").textContent = who
      ? "Start a session and every viewer who joins gets their own card that follows your draws."
      : "Starting a session signs you in with Twitch first. Viewers who join need no account.";
  }

  function signOut() {
    setToken("");
    if (live && live.mine) { live = null; stopPolling(); }
    renderLive();
  }

  // The Worker hands the session back in the URL FRAGMENT, which never reaches a server and
  // never lands in a Referer header. Same handoff MHGU Bingo uses, and the reason a GitHub
  // Pages app can authenticate against a workers.dev origin at all.
  function captureTokenFromHash() {
    const m = (location.hash || "").match(/[#&]mhgu_bot_token=([^&]+)/);
    if (!m) return false;
    setToken(decodeURIComponent(m[1]));
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }

  async function api(path, opts) {
    // no-store: the read carries an ETag and a short max-age, so the browser would answer a
    // poll with a 304. That says "unchanged since you cached it" -- which says nothing about
    // where this CARD is. After a reload the card can sit far behind the cached value, and a
    // 304 then leaves it stranded there permanently.
    const o = Object.assign({ headers: {}, cache: "no-store" }, opts || {});
    const tok = getToken();
    if (tok) o.headers["Authorization"] = "Bearer " + tok;
    if (o.body) o.headers["Content-Type"] = "application/json";
    const res = await fetch(BOT_API_ORIGIN + path, o);
    if (res.status === 401) { setToken(""); throw new Error("not_logged_in"); }
    if (res.status === 304) return null;
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error) || ("http_" + res.status));
    return data;
  }

  // Apply every draw from where this card is up to `n`. Deterministic, so a viewer joining
  // at draw 40 replays all 40 and their card reflects the whole game. The guard is a
  // runaway stop, not a policy — a well-behaved server can never ask for a jump that big.
  function syncTo(n) {
    if (!card) return 0;
    let applied = 0;
    while (card.draws < n && applied < 500) {
      const charm = drawAt(card.draws + 1);
      if (!charm) break;
      applyCharm(charm);
      applied++;
    }
    if (applied) { renderCard(); saveCard(); }
    return applied;
  }

  function liveNote(id, msg, bad) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("bad", !!bad);
  }

  function stopPolling() {
    if (livePoll) clearInterval(livePoll);
    livePoll = null;
  }

  // Polling, not a socket, and not as a compromise. A Twitch stream runs seconds behind
  // live, so pushing faster would light a viewer's card up BEFORE they hear the talisman
  // called — it would spoil the reveal rather than improve it.
  function startPolling() {
    stopPolling();
    livePoll = setInterval(pollLive, POLL_MS + Math.floor(Math.random() * 600));
    pollLive();
  }

  async function pollLive() {
    if (!live) return;
    try {
      const st = await api("/live/" + encodeURIComponent(live.session));
      if (st) { live.n = st.n; live.ended = !!st.ended; }
      // Sync unconditionally, not only when the response carried a body. Being behind must
      // heal itself on the next tick whatever the transport did.
      syncTo(live.n | 0);
      renderTwitch();
      if (liveLost) { liveLost = false; renderLive(); }
      if (live.ended) { liveNote("joinStatus", "The Gamemaster ended the session."); stopPolling(); }
      else if (!liveLost && !live.mine) liveNote("joinStatus", "Following the Gamemaster — draw " + live.n + ".");
    } catch (e) {
      // Degrade, don't die. The manual controls come back and the seed still holds
      // everything needed to keep playing by ear.
      if (!liveLost) { liveLost = true; renderLive(); }
    }
  }

  // Grid size, the free-space flag and the pool weights are all IN the seed body -- they are
  // literally part of the session string, so they are the Gamemaster's to set and fixed for
  // everyone the moment a session starts, host included.
  //
  // The code already relied on that: applySeed adopts them when you join, and
  // newCardInSession rebuilds them from the session before every new card, precisely so a
  // local change cannot quietly fork the seed. What was missing is that the controls still
  // LOOKED editable -- changing grid size mid-session did nothing to your card and was
  // overwritten on the next one, with nothing on screen saying why.
  //
  // The personal settings below them (highlighting, the marking gate, hover preview) are not
  // in the seed and stay editable: they change how you read your own card, not what is on it.
  function syncSessionLock() {
    // Followers only. The Gamemaster OWNS these -- changing one restarts the session with the
    // new settings, which is the only way to change them at all, since they are the session
    // string. Locking the host out of them would mean nobody could ever change the size.
    const locked = !!live && !live.mine;
    $("gridSize").disabled = locked;
    $("freeSpace").disabled = locked;
    for (const row of $("catList").querySelectorAll(".cat-row")) {
      const cb = row.querySelector('input[type="checkbox"]');
      const num = row.querySelector("input.num");
      if (cb) cb.disabled = locked;
      if (num) num.disabled = locked || !(cb && cb.checked);
    }

    // Highlighting and enlarge-on-hover stay the player's own: both change how you read your
    // card on your own screen, not what is on it or what counts as marked. Calling a table
    // without the glow is a legitimate way to play, and a harder one -- that is the player's
    // call to make, not the session's.
    $("sessionLock").classList.toggle("hidden", !locked);
    // The host gets the other half of the story: theirs are editable, and changing one is a
    // new session rather than a tweak to this one.
    $("sessionOwner").classList.toggle("hidden", !(live && live.mine));
  }

  function renderLive() {
    const following = !!live && !liveLost && !live.mine;
    // Shown only to a FOLLOWER in a session. It asks the server where the Gamemaster is and
    // catches up to that, so it cannot outrun the caller. A host has no use for it — they set
    // the number — and outside a session there is no number to ask for.

    // Everything about starting, sharing and ending a session now lives in the header's
    // Twitch modal — the one place titled "live sessions". This panel only reports state,
    // because a second copy of the control is how it ended up findable from neither.
    renderTwitch();
    syncSessionLock();

    // Drawing belongs to the session owner, and that is now enforced by the role rather than
    // by disabling a tab: a follower's panel offers Sync where a caller's offers Draw. NOT
    // gated on liveLost either -- losing the connection does not make you the session owner.
    setMode();

    const hosting = !!live && live.mine && !liveLost;
    if (liveLost) {
      liveNote("joinStatus", "Lost the session — keep playing off what the Gamemaster calls.", true);
      liveNote("gmLiveStatus", "Lost the connection — draws are local until it returns.", true);
    } else if (hosting) {
      liveNote("gmLiveStatus", "Live — viewers on this session follow your draws.");
    } else {
      liveNote("gmLiveStatus", "Not live. Start a session from the Twitch button at the top.");
    }
  }

  // A viewer on a stream refreshes. Without this, `live` is in-memory only, so a reload
  // silently drops them out of the session: the card stops updating, the Gamemaster tab
  // unlocks again, and nothing says why. Only the session and which side you were on need
  // storing — drawAt(n) reconstructs the rest.
  const LIVE_KEY = "mhgu-talisman-bingo-live";
  function rememberLive() {
    try {
      if (live) localStorage.setItem(LIVE_KEY, JSON.stringify({ session: live.session, mine: !!live.mine }));
      else localStorage.removeItem(LIVE_KEY);
    } catch (e) {}
  }
  function restoreLive() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(LIVE_KEY) || "null"); } catch (e) {}
    if (!d || !d.session || !card || card.session !== d.session) return;
    // n starts at the card's own position, NOT as a claim about the session. The immediate
    // poll in startPolling() replaces it with the truth and syncTo() closes the gap.
    live = { session: d.session, n: card.draws | 0, ended: false, owner: null, mine: !!d.mine };
    renderLive();
    startPolling();
  }

  // Every outcome reports INSIDE the modal. Failures used to go to gmLiveStatus, which lives
  // in the panel under the card, so pressing Start and having it fail looked like nothing
  // happened at all.
  // A new card WITHOUT leaving the session. The session fixes the tree pool and the whole
  // talisman sequence; only the player token picks the squares. So reroll the token, keep the
  // session, and catch straight back up to the current draw.
  //
  // Better than disabling New Card mid-session: a viewer who dislikes their board can take a
  // fresh one and keep playing, instead of choosing between a bad card and leaving.
  // A seed-body setting changed while hosting. Size, the free-space flag and the pool weights
  // ARE the session string, so there is no way to change one and stay in the same game --
  // the new settings necessarily describe a different session. Mint a card for them, drop the
  // old session and claim the new one.
  //
  // The old session is ended rather than abandoned, so anyone still on it is told it is over
  // instead of quietly following a game that has stopped advancing.
  async function restartSession() {
    generate(newToken(), newPlayer());
    await endLive();
    await goLive();
    renderTwitch();
    renderLive();
  }

  // Whether the current settings still describe the session we are hosting.
  function settingsMatchSession() {
    if (!live) return true;
    const d = decodeSeed(live.session);
    return !!d.cfg && seedBody(cfg, d.token) === live.session;
  }

  // Put a seed-body control back to what the running session says, for a cancelled restart.
  function revertToSession() {
    const d = decodeSeed(live.session);
    if (!d.cfg) return;
    cfg = d.cfg;
    $("gridSize").value = String(cfg.size);
    buildCatRows();
    syncFreeSpace();
    saveSettings();
    refreshCounts();
  }

  // Shared by grid size, free space and every pool weight: the three things that live in the
  // seed body. Outside a session they just change the next card, as they always did.
  function seedSettingChanged() {
    saveSettings();
    refreshCounts();
    if (!live || !live.mine || settingsMatchSession()) return;
    confirmAlways(
      "Restart the session?",
      "Grid size, free space and the pools are part of the session itself, so changing one "
        + "starts a new session. You'll get a new seed to hand out, and anyone on the old one "
        + "has to join again.",
      "Restart",
      restartSession,
      revertToSession);
  }

  function newCardInSession() {
    const d = decodeSeed(live.session);
    // Rebuild cfg from the session, or a locally changed pool weight would alter the seed
    // body and quietly produce a DIFFERENT session.
    if (d.cfg && CATS.some((c) => (d.cfg.cats[c.id] | 0) > 0)) {
      cfg = d.cfg;
      $("gridSize").value = String(cfg.size);
      buildCatRows();
      syncFreeSpace();
      saveSettings();
      refreshCounts();
    }
    const target = live.n | 0;
    generate(d.token, newPlayer());
    if (live && live.session === card.session) syncTo(target);
    renderLive();
  }

  async function goLive() {
    if (!card) return;
    if (!getToken()) {
      liveNote("liveStartStatus", "Sending you to Twitch to sign in…");
      location.href = BOT_API_ORIGIN + "/auth/login?return=talisman";
      return;
    }
    const btn = $("startLiveBtn");
    btn.disabled = true;
    liveNote("liveStartStatus", "Starting…");
    try {
      const st = await api("/live", { method: "POST", body: JSON.stringify({ session: card.session }) });
      live = { session: st.session, n: st.n | 0, ended: false, owner: st.owner, mine: true };
      liveLost = false;
      rememberLive();
      liveNote("liveStartStatus", "");
      renderLive();
    } catch (e) {
      if (e.message === "not_logged_in") {
        liveNote("liveStartStatus", "Sending you to Twitch to sign in…");
        location.href = BOT_API_ORIGIN + "/auth/login?return=talisman";
        return;
      }
      const why = e.message === "already_claimed"
          ? "Someone else is already running a session on this seed. Make a new card and try again."
        : e.message === "invalid_session"
          ? "That card's session was rejected by the server."
        : /fetch|network/i.test(e.message)
          ? "Couldn't reach the server. Check your connection and try again."
        : "Couldn't start the session — " + e.message;
      liveNote("liveStartStatus", why, true);
    } finally {
      btn.disabled = false;
    }
  }

  async function endLive() {
    if (!live || !live.mine) return;
    try { await api("/live/" + encodeURIComponent(live.session) + "/end", { method: "POST" }); } catch (e) {}
    live = null;
    stopPolling();
    rememberLive();
    renderLive();
    liveNote("liveStartStatus", "Session ended. Viewers stop following it.");
    liveNote("gmLiveStatus", "Session ended.");
  }

  async function joinLive(sessionArg) {
    const raw = String(sessionArg || "").trim().toUpperCase();
    if (!raw) return;
    try {
      const st = await api("/live/" + encodeURIComponent(raw));
      // Joining a session gets you a NEW card: same session, so the same tree pool and the
      // same talismans, but a fresh player token and therefore your own board. Everyone
      // sharing a board would mean everyone calling BINGO on the same draw.
      //
      // The exception is reconnecting to the session you are already in — a reload, or
      // reopening the link you are already playing. Reminting there would wipe every mark
      // the player had made, which is worse than anything it fixes.
      let remembered = null;
      try { remembered = JSON.parse(localStorage.getItem(LIVE_KEY) || "null"); } catch (e) {}
      const reconnecting = !!card && card.session === st.session
        && !!remembered && remembered.session === st.session;
      if (!reconnecting) {
        $("seedInput").value = st.session;
        applySeed(true);
      }
      live = { session: st.session, n: st.n | 0, ended: !!st.ended, owner: st.owner, mine: false };
      liveLost = false;
      rememberLive();
      // You joined someone's game; put you where you play it rather than making you find the tab.
      const caught = syncTo(st.n);
      renderLive();
      liveNote("joinStatus", caught
        ? "Joined — caught up on " + caught + (caught === 1 ? " draw." : " draws.")
        : "Joined. Waiting for the next draw.");
      startPolling();
    } catch (e) {
      liveNote("joinStatus", e.message === "not_found"
        ? "No live session with that seed."
        : "Couldn't join — " + e.message, true);
    }
  }

  // ── Log check ──────────────────────────────────────────────────────────────
  // Toggle on to glow every unmarked square that ANYTHING in the log already satisfied; toggle
  // off and it goes away. The normal hint only ever covers the newest draw, which is right for
  // playing along but useless for someone who sat down mid-game or looked away for ten calls.
  //
  // Computed from card.log rather than card.eligible, even though eligible reaches further
  // back. eligible is never rebuilt when a Player deletes a log entry, so it would keep
  // glowing squares for a talisman that has been taken back -- and a check that shows you a
  // square you cannot justify from the visible log is worse than no check. The log is what
  // the button is named after and what the player can audit.
  let logCheckOn = false;

  function logCheckSquares() {
    if (!card) return [];
    const out = [];
    for (let i = 0; i < card.cells.length; i++) {
      const cell = card.cells[i];
      if (!cell.cond || card.marked.has(i)) continue;
      for (const entry of card.log) {
        if (satisfies(entry.charm, cell.cond)) { out.push(i); break; }
      }
    }
    return out;
  }

  function setLogCheck(on) {
    if (on === logCheckOn) return;
    logCheckOn = on;
    const cells = $("bingoCard").children;
    // Toggling the class directly rather than going through card.hint and renderCard(): this
    // is a peek, not state. It must not be saved, must not survive a reload, and must not
    // disturb the glow the current draw is showing underneath it.
    if (on) {
      for (const i of logCheckSquares()) if (cells[i]) cells[i].classList.add("hinted");
    } else {
      const keep = (softHighlight && card && card.hint) || [];
      for (let i = 0; i < cells.length; i++) {
        if (keep.indexOf(i) === -1) cells[i].classList.remove("hinted");
      }
    }
    const btn = $("logCheckBtn");
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  // Which seat you are at is DERIVED, never chosen. It used to be a two-tab switcher, and the
  // tabs are gone: the session already decides the answer, so a control asking you to pick one
  // could only ever agree with it or be overruled. Host or solo, you draw; following someone
  // else's session, you do not. Both seats see exactly the same panel -- the only difference
  // is which button is live, which is the only difference there ever really was.
  function currentRole() {
    return live && !live.mine ? "player" : "gm";
  }

  function setMode() {
    mode = currentRole();
    const follower = mode === "player";
    $("roleName").textContent = follower ? "Player" : "Gamemaster";
    $("roleName").classList.toggle("is-player", follower);
    $("logTitle").textContent = follower ? "Talismans logged" : "Recent draws";
    // The caller draws; a follower syncs. Shown rather than swapped so the panel is one fixed
    // shape -- the awkward gap the two panels used to leave was them being different heights.
    $("drawBtn").classList.toggle("hidden", follower);
    $("peNext").classList.toggle("hidden", !follower);
    // The sync result reserves two lines so the block does not jump when a message appears.
    // A caller never sees one, so for them that reserve is just a gap under the Draw button.
    $("peNote").classList.toggle("hidden", !follower);
    if (card) renderCard();
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, cfg: cfg, softHighlight: softHighlight, previewMin: previewMin }));
    } catch (e) {}
  }
  function saveCard() {
    if (!card) return;
    try {
      localStorage.setItem(CARD_KEY, JSON.stringify(Object.assign({}, card, { v: 1, marked: [...card.marked] })));
    } catch (e) {}
  }

  function loadSettings() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch (e) {}
    if (!d) return;
    $("showReroll").checked = showReroll;
    softHighlight = d.softHighlight !== false;
    $("softHighlight").checked = softHighlight;
    if (Number.isInteger(d.previewMin)) previewMin = d.previewMin;
    $("previewMin").value = String(previewMin);
    if (d.cfg && typeof d.cfg === "object") {
      cfg.size = SIZES.includes(d.cfg.size) ? d.cfg.size : DEFAULT_CFG.size;
      cfg.free = d.cfg.free !== false;
      for (const c of CATS) {
        const v = d.cfg.cats ? (d.cfg.cats[c.id] | 0) : DEFAULT_CFG.cats[c.id];
        cfg.cats[c.id] = Math.min(9, Math.max(0, v));
      }
    }
  }

  function loadCard() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(CARD_KEY) || "null"); } catch (e) {}
    if (!d || !Array.isArray(d.cells) || !d.cfg) return false;
    // Cards saved before pruning carry no keep-set, and their conditions use fields the
    // current matcher no longer reads (minimum slots, rarity bands, skill counts). Restoring
    // one would not merely look odd — satisfies() would ignore the half it doesn't recognise
    // and mark the square on a partial match. Drop it and start clean.
    if (!Array.isArray(d.keep) || !d.keep.length) return false;
    card = d;
    card.marked = new Set(Array.isArray(d.marked) ? d.marked : []);
    // Cards saved before marking was gated carry no eligible list. Seed it from what is
    // already marked (plus any live hint) so an in-flight game doesn't start rejecting its
    // own squares; anything else re-earns eligibility on the next matching draw.
    card.eligible = Array.isArray(d.eligible) ? d.eligible
      : [...new Set([...(d.marked || []), ...(d.hint || [])])];
    card.need = d.need | 0;
    card.short = d.short | 0;
    card.draws = d.draws | 0;
    card.log = Array.isArray(d.log) ? d.log : [];
    card.firstBingoDraw = d.firstBingoDraw == null ? null : d.firstBingoDraw | 0;
    card.blackoutDraw = d.blackoutDraw == null ? null : d.blackoutDraw | 0;
    // Bags aren't serialised — a reroll only needs a fresh draw, so repopulate from the
    // current pools minus whatever is already on the card.
    usedKeys = new Set(card.cells.map((c) => c.key));
    rebuildBags();
    // Re-derive rather than trust what was saved -- see rebuildEligible.
    rebuildEligible();
    return true;
  }

  function rebuildBags() {
    const pools = buildPools((card && card.keep) || GOALS.keepFor(makeRng("avail"), KEEP_N));
    view = pools.view;
    const rng = makeRng(card ? card.seed + ":bags" : "bags");
    bags = {};
    for (const c of CATS) {
      // `g.k` — these are raw goals. usedKeys holds goal keys (a cell's `key` IS its goal's
      // `k`), so filtering on `g.key` here matched nothing and let squares already on the
      // card back into the reroll bag.
      const all = pools.soft[c.id].concat(pools.hard[c.id]).filter((g) => !usedKeys.has(g.k));
      bags[c.id] = weightedShuffle(all, rng);
    }
  }

  function doReset() {
    cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
    softHighlight = true;
    previewMin = 5;
    $("softHighlight").checked = true;
    $("previewMin").value = "5";
    $("gridSize").value = String(cfg.size);
    $("freeSpace").checked = cfg.free;
    buildCatRows();
    syncFreeSpace();
    saveSettings();
    refreshCounts();
    generate(newToken(), newPlayer());
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  function wireModal(modalId, openId, closeId) {
    if (openId) $(openId).addEventListener("click", () => $(modalId).classList.remove("hidden"));
    if (closeId) $(closeId).addEventListener("click", () => $(modalId).classList.add("hidden"));
    $(modalId).addEventListener("click", (e) => { if (e.target.id === modalId) $(modalId).classList.add("hidden"); });
  }

  // Reflects the preference into the checkbox without writing back to it, so an even grid
  // greys the box out rather than clearing what the user asked for.
  function syncFreeSpace() {
    const box = $("freeSpace");
    const odd = cfg.size % 2 === 1;
    box.disabled = !odd;
    box.checked = cfg.free && odd;
    box.parentElement.classList.toggle("disabled", !odd);
  }

  function applySeed(fromJoin) {
    const d = decodeSeed($("seedInput").value);
    const joining = d.cfg && !d.player;
    if (d.cfg && CATS.some((c) => (d.cfg.cats[c.id] | 0) > 0)) {
      cfg = d.cfg;
      $("gridSize").value = String(cfg.size);
      buildCatRows();
      syncFreeSpace();
      saveSettings();
      refreshCounts();
    }
    generate(d.token, d.player);
    // A session-only seed means "put me in this game", so connect as well as rebuild. Without
    // this, Load and the modal's Join did almost the same thing and only one of them worked.
    if (joining && !fromJoin) {
      const s = card && card.session;
      if (s) joinLive(s);
    }
    if (joining) {
      const b = $("banner");
      b.textContent = "Joined the session — same tree pool and the same draws as everyone else, "
        + "but this card is yours alone.";
      b.classList.remove("hidden");
    }
  }

  function boot() {
    document.querySelectorAll(".panel-head").forEach((h) => {
      h.addEventListener("click", () => {
        const panel = h.parentElement;
        const open = panel.dataset.open === "true";
        document.querySelectorAll(".panel").forEach((p) => { p.dataset.open = "false"; });
        panel.dataset.open = open ? "false" : "true";
      });
    });

    const justLoggedIn = captureTokenFromHash();
    // ?session=... from the chat command's join link. Read before the card is restored so it
    // wins over whatever was in localStorage — someone following a link means to join.
    const urlSession = (new URLSearchParams(location.search).get("session") || "").trim().toUpperCase();
    loadSettings();
    buildCatRows();
    buildSwatches();
    buildColourLegend();
    $("gridSize").value = String(cfg.size);
    syncFreeSpace();
    applyTheme(migrateHex(localStorage.getItem(THEME_KEY)) || "#1E2025");

    $("gridSize").addEventListener("change", () => {
      cfg.size = parseInt($("gridSize").value, 10);
      syncFreeSpace(); seedSettingChanged();
    });
    $("freeSpace").addEventListener("change", () => {
      cfg.free = $("freeSpace").checked; seedSettingChanged();
    });
    $("showReroll").addEventListener("change", () => {
      showReroll = $("showReroll").checked; saveSettings(); if (card) renderCard();
    });
    $("softHighlight").addEventListener("change", () => {
      softHighlight = $("softHighlight").checked; saveSettings(); if (card) renderCard();
    });
    $("previewMin").addEventListener("change", () => {
      previewMin = parseInt($("previewMin").value, 10); saveSettings(); hidePreview();
    });

    const newCard = () => guard("New card?", "New card", () => {
      if (live) newCardInSession(); else generate(newToken(), newPlayer());
    });
    $("newCardBtn").addEventListener("click", newCard);
    $("resetBtn").addEventListener("click", () => guard("Reset everything?", "Reset", doReset));

    $("drawBtn").addEventListener("click", async () => {
      // Offline, or not hosting: just draw locally.
      if (!live || !live.mine) { doDraw(); return; }
      // Hosting but disconnected: do NOT draw locally. That advances this card without the
      // server, so the audience never sees it and the two drift further apart.
      if (liveLost) {
        liveNote("gmLiveStatus", "Not connected — reconnecting before the next draw.", true);
        pollLive();
        return;
      }
      // Hosting: the SERVER's number is authoritative. Post first, then apply what it
      // returns, so a Gamemaster whose request failed can never be a draw ahead of the
      // audience following them.
      try {
        const st = await api("/live/" + encodeURIComponent(live.session) + "/draw",
          { method: "POST", body: JSON.stringify({ n: card.draws + 1 }) });
        live.n = st.n;
        syncTo(st.n);
      } catch (e) {
        if (!liveLost) { liveLost = true; renderLive(); }
      }
    });
    $("twitchLogin").addEventListener("click", () => {
      location.href = BOT_API_ORIGIN + "/auth/login?return=talisman";
    });
    $("twitchLogout").addEventListener("click", signOut);
    $("startLiveBtn").addEventListener("click", async () => { await goLive(); renderTwitch(); });
    $("stopLiveBtn").addEventListener("click", async () => { await endLive(); renderTwitch(); });
    // Roll a different session to start ON, BEFORE going live. Start claims the seed of the
    // card you are holding, so a seed someone else already claimed dead-ends inside the modal:
    // the error tells you to make a new card, which used to mean closing the modal to do it.
    //
    // It does not go live by itself. Changing which session you are about to start and
    // actually starting it are two decisions, and the second one is the outward-facing one.
    $("newLiveBtn").addEventListener("click", () => {
      if (live) return;
      guard("New card and session?", "New session", () => {
        generate(newToken(), newPlayer());
        renderTwitch();
        liveNote("liveStartStatus", "New session ready — press Start to go live on it.");
      });
    });
    $("copyLiveSession").addEventListener("click", () => {
      const b = $("copyLiveSession");
      const done = () => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy session"; }, 1200); };
      const v = $("liveSessionOut").value;
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(done, done);
      else { $("liveSessionOut").select(); document.execCommand("copy"); done(); }
    });
    // Press and hold, by pointer or by key. blur is in the list because releasing the mouse
    // outside the button, or tabbing away mid-hold, otherwise leaves the board stuck glowing.
    // A toggle, not a press-and-hold. Holding meant you could not scroll the log, mark a
    // square, or look anywhere else while the check was up -- and every square it lights is
    // one you then have to go and click, so letting go in order to do that defeated the point.
    //
    // Plain click, same as the Angle and Orbit locks in Weapon Trees. It also drops the
    // pointerup/leave/cancel/blur handlers, which are what made the held version fragile:
    // releasing off the button or tabbing away mid-hold could leave the flag set with nothing
    // lit.
    $("logCheckBtn").addEventListener("click", () => setLogCheck(!logCheckOn));

    $("peNext").addEventListener("click", async () => {
      // Ask the SESSION where the Gamemaster is and catch up to that. It used to take a typed
      // number, which was the same thing as drawing: a player could type any figure and run
      // ahead of what had actually been called. The draw number is the Gamemaster's to set,
      // and a player has no way of knowing it anyway -- so it is never an input here.
      const note = $("peNote");
      if (!live) { note.textContent = "Not in a session — there is nothing to sync to."; return; }
      const btn = $("peNext");
      btn.disabled = true;
      note.textContent = "Checking the session…";
      try {
        const st = await api("/live/" + encodeURIComponent(live.session));
        if (st) { live.n = st.n; live.ended = !!st.ended; }
        const applied = syncTo(live.n | 0);
        if (liveLost) { liveLost = false; renderLive(); }
        renderTwitch();
        note.textContent = applied
          ? "Caught up " + applied + (applied === 1 ? " draw. " : " draws. ")
            + (card.last && card.last.hits
              ? card.last.hits + (card.last.hits === 1 ? " square lights up" : " squares light up")
              : "Nothing on your card matches the newest one")
          : "Already level with the Gamemaster at draw " + card.draws + ".";
      } catch (e) {
        if (!liveLost) { liveLost = true; renderLive(); }
        note.textContent = "Could not reach the session. Keep playing off what the Gamemaster calls.";
      }
      btn.disabled = isComplete();
    });
    setMode();
    renderLive();
    if (urlSession) {
      history.replaceState(null, "", location.pathname);
      joinLive(urlSession);
    }

    $("seedApply").addEventListener("click", () => guard("Load that seed?", "Load", applySeed));
    $("seedInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") guard("Load that seed?", "Load", applySeed);
    });
    // Two things worth copying, and they are not interchangeable. The session is what a
    // Gamemaster hands round — same tree pool, same draws, everyone rolls their own card. The
    // full card seed reproduces one exact board, which is for showing someone your card, not
    // for starting a game.
    const copyTo = (btnId, label, getText) => {
      $(btnId).addEventListener("click", () => {
        const b = $(btnId);
        const done = () => { b.textContent = "Copied"; setTimeout(() => { b.textContent = label; }, 1200); };
        const v = getText();
        if (navigator.clipboard) navigator.clipboard.writeText(v).then(done, done);
        else { $("seedInput").select(); document.execCommand("copy"); done(); }
      });
    };
    copyTo("seedCopy", "Copy card", () => $("seedInput").value);
    copyTo("sessionCopy", "Copy session", () => (card && card.session) || $("seedInput").value);

    $("confirmOk").addEventListener("click", () => {
      const f = confirmFn; cancelFn = null; closeConfirm(); if (f) f();
    });
    $("confirmCancel").addEventListener("click", () => {
      const c = cancelFn; closeConfirm(); if (c) c();
    });
    wireModal("helpModal", "helpBtn", "helpClose");
    wireModal("linksModal", "linksBtn", "linksClose");
    wireModal("themeModal", "themeBtn", "themeClose");
    wireModal("twitchModal", "twitchBtn", "twitchClose");
    // Refresh on open: the modal can be opened long after the last renderLive(), and coming
    // back from the Twitch redirect lands with a token the modal has never seen.
    $("twitchBtn").addEventListener("click", renderTwitch);
    wireModal("confirmModal", null, null);

    const grid = $("bingoCard");
    grid.addEventListener("mouseover", (e) => {
      const cell = e.target.closest(".cell");
      if (cell && grid.contains(cell)) showPreview(cell); else hidePreview();
    });
    grid.addEventListener("mouseleave", hidePreview);
    window.addEventListener("scroll", hidePreview, true);

    refreshCounts();
    if (loadCard()) renderCard(); else generate(newToken(), newPlayer());
    // AFTER the card exists: restoreLive compares the stored session against card.session, so
    // running it earlier in boot (where setMode and renderLive sit) always bailed on !card and
    // silently dropped every reloading viewer out of their session.
    restoreLive();
    // Coming back from Twitch drops you on a normal page load with the modal shut, which is
    // the middle of a job you started -- signing in is only ever a step towards hosting. Put
    // you back where you were, signed in, with Start ready.
    if (justLoggedIn) {
      renderTwitch();
      $("twitchModal").classList.remove("hidden");
      liveNote("liveStartStatus", "Signed in. You can start your session now.");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
