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
    ["Tetsucabra","#c65900"],["Agnaktor","#fc933e"],
    ["Tigrex","#C8A319"],["Rajang","#f1d364"],
    ["Deviljho","#0B570F"],["Rathian","#3a9b3f"],
    ["Astalos","#14503d"],["Zinogre","#2dae85"],
    ["Zamtrios","#005984"],["Plesioth","#0080c1"],
    ["Brachydios","#0B2757"],["Lagiacrus","#0b3f97"],
    ["G. Magala","#1F0B57","Gore Magala"],["Nerscylla","#4e2fa2"],
    ["Y. Garuga","#62008f","Yian Garuga"],["Chameleos","#8e50ab"],
    ["Mizutsune","#D84696"],["Congalala","#ce79a8"],
    ["Duramboros","#5a411f"],["Diablos","#997c54"],
    ["Barroth","#B57C45"],["Bulldrome","#cfaa87"],
    ["K. Daora","#505358","Kushala Daora"],["Valstrax","#aeb5c1"],
    ["Forbidden","#1E2025","Question Mark"],
  ];
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
  let showReroll = true;
  let softHighlight = true;
  // HIDDEN, and forced off. The mechanism below works and is left intact, but the control is
  // not offered yet because it only holds up for the person pressing Draw.
  //
  // In a real game one person calls and everyone else just watches their own card. Those other
  // devices never draw, so their `eligible` set stays empty and EVERY square locks forever —
  // the check breaks precisely for the players it was meant to keep honest. Re-enabling it
  // needs the draw to reach the other screens first.
  //
  // Read as a literal rather than from settings on purpose: anyone who ticked the box while it
  // was live has `lockUnmatched: true` in localStorage, and honouring that with no control on
  // the page would strand them with an uncompletable card.
  let lockUnmatched = false;
  // "gm" rolls talismans here; "player" types in what someone else called. Persisted, because
  // which one you are is a property of your seat at the table, not of the card.
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
    if (mode === "player") buildEntryForm();
    renderCard();
    saveCard();
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
  function applyCharm(charm, typed) {
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
    card.last = { charm: charm, hits: hint.length };
    card.log.unshift({ charm: charm, hits: hint.length, at: card.draws, typed: !!typed });
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
    return charm ? applyCharm(charm, false) : null;
  }

  // Undo a mis-entered talisman. Only offered on the Player tab: a typo is a player problem,
  // whereas a Gamemaster deleting a roll they didn't like is just cheating with extra steps.
  //
  // Everything newer shifts down a number so the log stays sequential. card.eligible is left
  // alone deliberately -- with the marking gate disabled it has no effect, and rebuilding it
  // from the log would be wrong anyway, since the log only keeps the last 50 draws.
  function removeDraw(at) {
    if (!card) return;
    // Not while following a session: this renumbers the log and decrements card.draws,
    // which would put the follower permanently out of step with the server's count.
    if (live && !live.mine && !liveLost) return;
    const i = card.log.findIndex((e) => e.at === at);
    if (i < 0) return;
    card.log.splice(i, 1);
    for (const e of card.log) if (e.at > at) e.at--;
    card.draws = Math.max(0, card.draws - 1);
    const newest = card.log[0];
    if (newest) {
      const hint = [];
      for (let j = 0; j < card.cells.length; j++) {
        const cell = card.cells[j];
        if (!cell.cond || card.marked.has(j)) continue;
        if (satisfies(newest.charm, cell.cond)) hint.push(j);
      }
      card.hint = hint;
      card.last = { charm: newest.charm, hits: newest.hits };
    } else {
      card.hint = [];
      card.last = null;
    }
    renderCard();
    saveCard();
  }

  const isEligible = (i) =>
    !lockUnmatched || (!!card && (card.eligible || []).indexOf(i) > -1);

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

    card.cells.forEach((cell, i) => {
      const el = document.createElement("div");
      el.className = "cell";
      if (cell.cat === "free") el.classList.add("free");
      if (cell.cat === "empty") el.classList.add("empty");
      if (card.marked.has(i)) el.classList.add("marked");
      // The glow says "this one" — it never marks. Only the player marks, and marking is
      // what swaps the glow for the filled state.
      if (softHighlight && card.hint && card.hint.indexOf(i) > -1) el.classList.add("hinted");

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
  function charmNode(charm, hits) {
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

    const head = document.createElement("div");
    head.className = "charm-name";
    head.textContent = charmName(charm.r);
    const pips = document.createElement("span");
    pips.className = "charm-slots";
    pips.textContent = charm.s ? "◈".repeat(charm.s) : "—";
    pips.title = charm.s + (charm.s === 1 ? " slot" : " slots");
    head.appendChild(pips);
    body.appendChild(head);

    for (const sk of charm.k) {
      const line = document.createElement("div");
      line.className = "charm-skill" + (sk[1] < 0 ? " neg" : "");
      line.textContent = treeName(sk[0]) + " " + (sk[1] > 0 ? "+" : "") + sk[1];
      body.appendChild(line);
    }

    wrap.appendChild(body);
    return wrap;
  }

  function renderDraw() {
    if (!card) return;
    $("drawCount").textContent = card.draws.toLocaleString();
    const score = $("drawScore");
    const bits = [];
    if (card.firstBingoDraw != null) bits.push("first line @ " + card.firstBingoDraw.toLocaleString());
    if (card.blackoutDraw != null) bits.push("blackout @ " + card.blackoutDraw.toLocaleString());
    score.textContent = bits.join(" · ");

    const last = $("lastCharm");
    last.textContent = "";
    if (card.last) {
      last.appendChild(charmNode(card.last.charm, card.last.hits));
      const note = document.createElement("div");
      note.className = "charm-note";
      // Not "marked N squares" any more: the draw marks nothing, the player does. Claiming
      // otherwise is how a draw that lights one ring while reporting two reads as a bug.
      note.textContent = card.last.hits
        ? "matches " + card.last.hits + (card.last.hits === 1 ? " square" : " squares")
        : "no match";
      last.appendChild(note);
    } else {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "Press Draw to roll a talisman.";
      last.appendChild(p);
    }

    const log = $("drawLog");
    log.textContent = "";
    for (const entry of card.log) {
      const row = document.createElement("div");
      row.className = "log-row" + (entry.hits ? " hit" : "");
      const n = document.createElement("span");
      n.className = "log-n";
      n.textContent = "#" + entry.at;
      const t = document.createElement("span");
      t.className = "log-text";
      t.textContent = charmName(entry.charm.r) + " · "
        + entry.charm.k.map((s) => treeName(s[0]) + " " + (s[1] > 0 ? "+" : "") + s[1]).join(", ");
      // Slots as filled/empty holes rather than a count, and in their own span rather than
      // appended to the text: .log-text ellipsises when a two-skill charm is long, which
      // would eat the slots exactly on the charms most worth reading.
      const sl = document.createElement("span");
      sl.className = "log-slots";
      sl.textContent = SLOT_GLYPH[entry.charm.s | 0] || SLOT_GLYPH[0];
      sl.title = (entry.charm.s | 0) + ((entry.charm.s | 0) === 1 ? " slot" : " slots");
      row.appendChild(n); row.appendChild(t); row.appendChild(sl);
      // Was "+N", from when a draw added N marks by itself. It never meant a bonus or a
      // score — it is how many squares on THIS card the charm satisfies — and now that
      // marking is manual it is a to-do count, so it says so rather than implying the app
      // already did it.
      if (entry.hits) {
        const h = document.createElement("span");
        h.className = "log-hit";
        h.textContent = entry.hits + " to mark";
        h.title = entry.hits + (entry.hits === 1 ? " square on your card matches" : " squares on your card match") + " this talisman";
        row.appendChild(h);
      }
      if (mode === "player") {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "log-del";
        x.textContent = "×";
        x.title = "Remove this talisman";
        x.setAttribute("aria-label", "Remove talisman " + entry.at);
        x.addEventListener("click", () => removeDraw(entry.at));
        row.appendChild(x);
      }
      log.appendChild(row);
    }

    $("drawBtn").disabled = isComplete();
    $("peAdd").disabled = isComplete();
    $("peNext").disabled = isComplete();
    $("peCount").textContent = String(card.draws);
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
    $("generateBtn").disabled = avail === 0;
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
  // on the pale themes — lighten(#aeb5c1, .40) is near-white, and the button's text is white.
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
  let confirmFn = null;
  function markedCount() {
    if (!card) return 0;
    return card.marked.size - (card.freeIdx >= 0 && card.marked.has(card.freeIdx) ? 1 : 0);
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
      num.disabled = !cb.checked;

      cb.addEventListener("change", () => {
        cfg.cats[c.id] = cb.checked ? Math.max(1, parseInt(num.value, 10) || 1) : 0;
        num.disabled = !cb.checked;
        saveSettings(); refreshCounts();
      });
      num.addEventListener("change", () => {
        num.value = Math.min(9, Math.max(1, parseInt(num.value, 10) || 1));
        if (cb.checked) cfg.cats[c.id] = parseInt(num.value, 10);
        saveSettings(); refreshCounts();
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
    if (!m) return;
    setToken(decodeURIComponent(m[1]));
    history.replaceState(null, "", location.pathname + location.search);
  }

  async function api(path, opts) {
    const o = Object.assign({ headers: {} }, opts || {});
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
      applyCharm(charm, false);
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
      if (st) {
        live.n = st.n; live.ended = !!st.ended;
        syncTo(st.n);
      }
      if (liveLost) { liveLost = false; renderLive(); }
      if (live.ended) { liveNote("joinStatus", "The Gamemaster ended the session."); stopPolling(); }
      else if (!liveLost && !live.mine) liveNote("joinStatus", "Following the Gamemaster — draw " + live.n + ".");
    } catch (e) {
      // Degrade, don't die. The manual controls come back and the seed still holds
      // everything needed to keep playing by ear.
      if (!liveLost) { liveLost = true; renderLive(); }
    }
  }

  function renderLive() {
    const following = !!live && !liveLost && !live.mine;
    // A follower must not be able to advance their own counter: that is both a desync and a
    // spoiler, since they could run ahead of what has actually been called.
    $("peNext").classList.toggle("hidden", following);
    $("peManualHint").classList.toggle("hidden", following);
    // Manual entry lives in the sidebar so six dropdowns don't squeeze the board. It is for
    // players only, and pointless while a session is feeding draws in automatically.
    $("manualPanel").classList.toggle("hidden", mode !== "player" || following);
    $("peManualPointer").classList.toggle("hidden", following);
    // Joining is a player action and belongs beside the other setup controls, not under the
    // board where it was costing the card ~90px of height for a control used once.
    $("joinPanel").classList.toggle("hidden", mode !== "player");

    // Sign-in lives in the header's Twitch modal, where the other apps put it. This button
    // stays a game action: it still redirects to the login if you press it signed out, but it
    // is no longer the only place the app admits Twitch is involved.
    const who = loggedInAs();
    renderTwitch();

    const hosting = !!live && live.mine && !liveLost;
    $("goLiveBtn").textContent = who ? "Go live" : "Sign in with Twitch to host";
    $("goLiveBtn").classList.toggle("hidden", hosting);
    $("endLiveBtn").classList.toggle("hidden", !hosting);
    $("shareRow").classList.toggle("hidden", !hosting);
    $("shareSession").classList.toggle("hidden", !hosting);
    if (hosting) $("shareSession").value = live.session;

    if (liveLost) {
      liveNote("joinStatus", "Lost the session — keep playing off what the Gamemaster calls.", true);
      liveNote("gmLiveStatus", "Lost the connection — draws are local until it returns.", true);
    } else if (hosting) {
      liveNote("gmLiveStatus", "Live. Viewers on this session follow your draws.");
    }
  }

  async function goLive() {
    if (!card) return;
    if (!getToken()) {
      location.href = BOT_API_ORIGIN + "/auth/login?return=talisman";
      return;
    }
    try {
      const st = await api("/live", { method: "POST", body: JSON.stringify({ session: card.session }) });
      live = { session: st.session, n: st.n | 0, ended: false, owner: st.owner, mine: true };
      liveLost = false;
      renderLive();
    } catch (e) {
      if (e.message === "not_logged_in") {
        location.href = BOT_API_ORIGIN + "/auth/login?return=talisman";
        return;
      }
      liveNote("gmLiveStatus", e.message === "already_claimed"
        ? "Someone else is already running this session."
        : "Couldn't go live — " + e.message, true);
    }
  }

  async function endLive() {
    if (!live || !live.mine) return;
    try { await api("/live/" + encodeURIComponent(live.session) + "/end", { method: "POST" }); } catch (e) {}
    live = null;
    stopPolling();
    renderLive();
    liveNote("gmLiveStatus", "Session ended.");
  }

  async function joinLive() {
    const raw = ($("joinSession").value || "").trim().toUpperCase();
    if (!raw) return;
    try {
      const st = await api("/live/" + encodeURIComponent(raw));
      // Joining rebuilds the card off the session, so the prune matches everyone else's and
      // the player token is fresh — same session, own board.
      if (!card || card.session !== st.session) {
        $("seedInput").value = st.session;
        applySeed();
      }
      live = { session: st.session, n: st.n | 0, ended: !!st.ended, owner: st.owner, mine: false };
      liveLost = false;
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

  // ── Player entry ───────────────────────────────────────────────────────────
  const PTS_MIN2 = -10, PTS_MAX = 13;

  function opt(sel, value, label) {
    const o = document.createElement("option");
    o.value = String(value); o.textContent = label;
    sel.appendChild(o);
    return o;
  }

  // The skill lists are the CARD'S KEPT TREES, not all 137. A talisman rolled for this card
  // can only carry kept trees, so anything else would be unenterable anyway -- and 20 names is
  // a usable dropdown where 137 is not.
  function buildEntryForm() {
    const keep = (card && card.keep) || [];
    const trees = keep.slice().sort((a, b) => treeName(a).localeCompare(treeName(b)));

    const rar = $("peRarity"); rar.textContent = "";
    for (let r = 1; r <= 10; r++) opt(rar, r, charmName(r));
    rar.value = "1";

    const s1 = $("peSkill1"), s2 = $("peSkill2");
    s1.textContent = ""; s2.textContent = "";
    opt(s2, "", "(none)");
    for (const id of trees) { opt(s1, id, treeName(id)); opt(s2, id, treeName(id)); }

    // Slot 1 is never zero or negative: of the 248 legal first-skill rows in the tables, not
    // one can roll below +1. Slot 2 straddles zero, and a 0-point second skill is dropped by
    // the game as no second skill at all -- so it is "(none)" here rather than a 0.
    const p1 = $("pePts1"); p1.textContent = "";
    for (let v = 1; v <= PTS_MAX; v++) opt(p1, v, "+" + v);
    const p2 = $("pePts2"); p2.textContent = "";
    for (let v = PTS_MAX; v >= PTS_MIN2; v--) if (v !== 0) opt(p2, v, (v > 0 ? "+" : "") + v);

    const sl = $("peSlots"); sl.textContent = "";
    for (let n = 0; n <= 3; n++) opt(sl, n, SLOT_GLYPH[n] + "  (" + n + ")");
    syncEntry();
  }

  // The game never puts the same tree in both slots, so skill 2 cannot offer skill 1.
  function syncEntry() {
    const a = $("peSkill1").value, s2 = $("peSkill2");
    for (const o of s2.options) o.disabled = o.value !== "" && o.value === a;
    if (s2.value && s2.value === a) s2.value = "";
    const has2 = !!s2.value;
    $("pePts2").disabled = !has2;
    $("pePts2").parentElement.style.opacity = has2 ? "1" : ".45";
  }

  function addTypedCharm() {
    if (!card || isComplete()) return;
    const t1 = parseInt($("peSkill1").value, 10);
    if (!Number.isFinite(t1)) return;
    const k = [[t1, parseInt($("pePts1").value, 10)]];
    const t2 = $("peSkill2").value;
    if (t2 !== "" && parseInt(t2, 10) !== t1) k.push([parseInt(t2, 10), parseInt($("pePts2").value, 10)]);
    const charm = { r: parseInt($("peRarity").value, 10), s: parseInt($("peSlots").value, 10), k: k };
    const r = applyCharm(charm, true);
    const note = $("peNote");
    note.textContent = r
      ? (r.hits.length ? "Added — " + r.hits.length + (r.hits.length === 1 ? " square lights up" : " squares light up")
                       : "Added — nothing on your card matches it")
      : "";
    renderCard();
    saveCard();
  }

  function setMode(next) {
    mode = next === "player" ? "player" : "gm";
    $("tabGm").setAttribute("aria-selected", mode === "gm" ? "true" : "false");
    $("tabPlayer").setAttribute("aria-selected", mode === "player" ? "true" : "false");
    $("tabGm").classList.toggle("on", mode === "gm");
    $("tabPlayer").classList.toggle("on", mode === "player");
    $("gmPanel").classList.toggle("hidden", mode !== "gm");
    $("playerPanel").classList.toggle("hidden", mode !== "player");
    $("logTitle").textContent = mode === "player" ? "Talismans logged" : "Recent draws";
    if (mode === "player") buildEntryForm();
    renderLive();
    saveSettings();
    if (card) renderCard();
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, cfg: cfg, showReroll: showReroll, softHighlight: softHighlight, mode: mode, previewMin: previewMin }));
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
    showReroll = d.showReroll !== false;
    $("showReroll").checked = showReroll;
    softHighlight = d.softHighlight !== false;
    $("softHighlight").checked = softHighlight;
    if (d.mode === "player" || d.mode === "gm") mode = d.mode;
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
    showReroll = true;
    softHighlight = true;
    previewMin = 5;
    $("showReroll").checked = true;
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

  function applySeed() {
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

    captureTokenFromHash();
    // ?session=... from the chat command's join link. Read before the card is restored so it
    // wins over whatever was in localStorage — someone following a link means to join.
    const urlSession = (new URLSearchParams(location.search).get("session") || "").trim().toUpperCase();
    loadSettings();
    buildCatRows();
    buildSwatches();
    buildColourLegend();
    $("gridSize").value = String(cfg.size);
    syncFreeSpace();
    applyTheme(localStorage.getItem(THEME_KEY) || "#1E2025");

    $("gridSize").addEventListener("change", () => {
      cfg.size = parseInt($("gridSize").value, 10);
      syncFreeSpace(); saveSettings(); refreshCounts();
    });
    $("freeSpace").addEventListener("change", () => {
      cfg.free = $("freeSpace").checked; saveSettings(); refreshCounts();
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

    const newCard = () => guard("New card?", "New card", () => generate(newToken(), newPlayer()));
    $("generateBtn").addEventListener("click", newCard);
    $("newCardBtn").addEventListener("click", newCard);
    $("resetBtn").addEventListener("click", () => guard("Reset everything?", "Reset", doReset));

    $("drawBtn").addEventListener("click", async () => {
      // Offline, or not hosting: just draw locally.
      if (!live || !live.mine || liveLost) { doDraw(); return; }
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
    $("goLiveBtn").addEventListener("click", goLive);
    $("twitchLogin").addEventListener("click", () => {
      location.href = BOT_API_ORIGIN + "/auth/login?return=talisman";
    });
    $("twitchLogout").addEventListener("click", signOut);
    $("endLiveBtn").addEventListener("click", endLive);
    $("joinBtn").addEventListener("click", joinLive);
    $("joinSession").addEventListener("keydown", (e) => { if (e.key === "Enter") joinLive(); });
    $("tabGm").addEventListener("click", () => setMode("gm"));
    $("tabPlayer").addEventListener("click", () => setMode("player"));
    $("peSkill1").addEventListener("change", syncEntry);
    $("peSkill2").addEventListener("change", syncEntry);
    $("peAdd").addEventListener("click", addTypedCharm);
    $("peNext").addEventListener("click", () => {
      // Identical to the Gamemaster's Draw: drawAt(n) is a pure function of the session and
      // the number, so following along produces the same talisman rather than a parallel one.
      if (!doDraw()) return;
      $("peNote").textContent = card.last && card.last.hits
        ? card.last.hits + (card.last.hits === 1 ? " square lights up" : " squares light up")
        : "Nothing on your card matches it";
    });
    // After the card is restored or generated, so buildEntryForm can read card.keep.
    setMode(mode);
    renderLive();
    if (urlSession) {
      setMode("player");
      $("joinSession").value = urlSession;
      history.replaceState(null, "", location.pathname);
      joinLive();
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

    $("confirmOk").addEventListener("click", () => { const f = confirmFn; closeConfirm(); if (f) f(); });
    $("confirmCancel").addEventListener("click", closeConfirm);
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
    if (loadCard()) renderCard(); else generate(newToken());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
