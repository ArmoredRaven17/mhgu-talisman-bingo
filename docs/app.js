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
  const SOFT_FLOOR = 1 / 300;
  const HARD_FLOOR = 1 / 1000;
  const hardBudgetFor = (need) => Math.floor(need / 16);   // 0 on 3x3 and 4x4, 1 on 5x5, 3 on 7x7

  const MAX_CELL_TEXT = 40;

  // ── Goal presentation ──────────────────────────────────────────────────────
  const treeName = ROLL.treeName;
  const charmName = ROLL.charmName;

  const slotPhrase = (s) => s === 3 ? "3 slots" : s + " slot" + (s > 1 ? "s" : "") + " or more";

  // A goal is a set of condition fields that are ANDed (see tools/build-data.js for the
  // full list). Text is composed from whichever are present, so one function covers all
  // five pools and any combination they produce.
  function goalText(g) {
    if (g.re != null) return "Roll a " + charmName(g.re);
    if (g.tr != null) return "Roll a " + TIER_LABEL[g.tr] + " talisman";
    if (g.c === "slot") return slotPhrase(g.s);
    if (g.c === "rar") return "Rarity " + g.r + " or higher";
    // A bare skill needs the verb. Inside a combo the tree name alone reads fine, because
    // the other clause supplies the rest of the sentence ("Attack, 2+ slots").
    if (g.c === "name") return "Has " + treeName(g.a);

    const parts = [];
    if (g.a != null) parts.push(treeName(g.a) + (g.b ? " +" + g.b : ""));
    // With a tree already named, "two positive skills" reads as that tree PLUS two more, so
    // state what the second skill has to be instead. The bare form keeps the generic wording.
    if (g.n === 2 && g.pos && g.a != null) parts.push("a positive 2nd skill");
    else if (g.n === 2) parts.push(g.pos ? "two positive skills" : "two skills");
    if (g.n === 1) parts.push("one skill only");
    if (g.neg != null) parts.push("a skill at " + g.neg + " or worse");
    if (g.s != null) parts.push(g.s === 3 ? "3 slots" : g.s + "+ slots");
    if (g.rx != null) parts.push("rarity " + g.rx + " or lower");
    if (g.r != null) parts.push("rarity " + g.r + "+");
    const text = parts.join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Squares deliberately carry NO sub-line. An earlier version printed each tile's odds
  // ("1 in 876") as a difficulty pip. It reads as a spoiler: knowing a square is hopeless
  // before you start turns the card into a spreadsheet, and the whole appeal of charm
  // farming is not knowing. The probability is still computed — the floors depend on it —
  // it just never reaches the player.

  function goalIcon(g) {
    if (g.re != null) return talismanIcon(g.re);
    if (g.tr != null) return talismanIcon(ROLL.TIER_RARITIES[g.tr][0]);
    return "";
  }

  // ── Eligibility ────────────────────────────────────────────────────────────
  // data.js carries each goal's probability GIVEN each tier. The real hit rate is the dot
  // product with the normalised tier weights, which is why it can't be baked: the weights
  // are a user control.
  function normTierW(tw) {
    const total = TIERS.reduce((a, t) => a + (tw[t] | 0), 0);
    return total > 0 ? TIERS.map((t) => (tw[t] | 0) / total) : TIERS.map(() => 0);
  }
  const goalProb = (g, nw) => g.pt.reduce((a, p, i) => a + p * nw[i], 0);

  // Every eligible goal, split into the ordinary band and the hard band, bucketed by pool.
  // Returned as full cell objects so buildCells only has to pick.
  function buildGoalPool(tw) {
    const nw = normTierW(tw);
    const soft = {}, hard = {};
    for (const c of CATS) { soft[c.id] = []; hard[c.id] = []; }
    for (const g of DATA.goals) {
      const p = goalProb(g, nw);
      if (p < HARD_FLOOR) continue;
      const cell = {
        key: g.k, cat: g.c, text: goalText(g).slice(0, MAX_CELL_TEXT), sub: "",
        icon: goalIcon(g), tint: POOL_COLORS[g.c], p: p, cond: g,
      };
      (p >= SOFT_FLOOR ? soft : hard)[g.c].push(cell);
    }
    return { soft: soft, hard: hard };
  }

  // ── Matching ───────────────────────────────────────────────────────────────
  // The runtime twin of the probability maths in tools/build-data.js. Pure and DOM-free so
  // scripts/test-roll.mjs can hammer it against the real roller; if a condition field is
  // added there, add it here or the tile will silently mark on every draw.
  function satisfies(charm, cond) {
    if (!charm || !cond) return false;
    if (cond.a != null && !charm.k.some((x) => x[0] === cond.a && x[1] >= (cond.b || 1))) return false;
    if (cond.s != null && charm.s < cond.s) return false;
    if (cond.r != null && charm.r < cond.r) return false;
    if (cond.rx != null && charm.r > cond.rx) return false;
    if (cond.re != null && charm.r !== cond.re) return false;
    if (cond.tr != null && ROLL.tierOf(charm.r) !== cond.tr) return false;
    if (cond.n != null && charm.k.length !== cond.n) return false;
    if (cond.pos && !charm.k.every((x) => x[1] > 0)) return false;
    if (cond.neg != null && !charm.k.some((x) => x[1] <= cond.neg)) return false;
    return true;
  }
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
  const SEED_RE = /^MHGU-([3-9]|10)([FN])-((?:[NPSRC][1-9])+)-([0-9A-Z]{6})-([0-9A-Z]{4})$/;

  // The one place Math.random is allowed for the card. Everything downstream is seeded.
  const newToken = () => b32(Math.floor(Math.random() * 0x100000000), 6);

  const effFree = (c) => !!c.free && c.size % 2 === 1;

  function seedBody(c, token) {
    const cats = CATS.filter((x) => (c.cats[x.id] | 0) > 0)
      .map((x) => CAT_LETTER[x.id] + c.cats[x.id]).join("");
    return "MHGU-" + c.size + (effFree(c) ? "F" : "N") + "-" + cats + "-" + token;
  }

  // Covers what changes WHICH goals are eligible but isn't in the seed body. With the tier
  // weights fixed, that is only the data itself — so a rebuilt catalogue makes old seeds
  // warn rather than silently produce a different card.
  const fingerprint = () => "d" + DATA.dataVersion;

  function decodeSeed(raw) {
    const s = (raw || "").trim().toUpperCase();
    const m = SEED_RE.exec(s);
    // Anything unparseable still produces a card: hash it into a token so typing a word
    // gives you a reproducible board rather than an error.
    if (!m) return { cfg: null, token: b32(hashStr(s), 6), fp: null };
    const cfg = { size: parseInt(m[1], 10), free: m[2] === "F", cats: {} };
    for (const c of CATS) cfg.cats[c.id] = 0;
    m[3].replace(/([NPSRC])([1-9])/g, (_, L, n) => { cfg.cats[LETTER_CAT[L]] = parseInt(n, 10); return ""; });
    return { cfg: cfg, token: m[4], fp: m[5] };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
  let card = null;
  let bags = null;          // leftover goals per pool, for per-square reroll
  let usedKeys = new Set();
  let showReroll = true;
  let autoTimer = null;

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

    // Which draw ordinals become hard squares. Chosen up front so the count is exact and
    // seeded, rather than emerging from a per-square coin flip.
    const hardAt = new Set();
    const budget = Math.min(hardBudgetFor(need), need);
    for (let guard = 0; hardAt.size < budget && guard < need * 8; guard++) hardAt.add(rng.rand(need));

    const used = new Set(), drawn = [];
    while (drawn.length < need) {
      const wantHard = hardAt.has(drawn.length);
      const live = active.filter((x) => (wantHard ? hardBags : softBags)[x.id].length);
      const pool = live.length ? live : active.filter((x) => softBags[x.id].length || hardBags[x.id].length);
      if (!pool.length) break;

      const total = pool.reduce((s, x) => s + c.cats[x.id], 0);
      let r = rng.next() * total, chosen = pool[pool.length - 1];
      for (const x of pool) { r -= c.cats[x.id]; if (r < 0) { chosen = x; break; } }

      const bag = (wantHard && hardBags[chosen.id].length ? hardBags : softBags)[chosen.id];
      const goal = (bag.length ? bag : hardBags[chosen.id].length ? hardBags[chosen.id] : softBags[chosen.id]).pop();
      if (!goal) break;
      if (used.has(goal.key)) continue;
      used.add(goal.key);
      drawn.push(goal);
    }

    const cells = [];
    let di = 0;
    for (let i = 0; i < n; i++) {
      if (i === freeIdx) cells.push({ key: "free", cat: "free", text: "FREE", sub: "", icon: "", tint: POOL_COLORS.free });
      else if (di < drawn.length) cells.push(drawn[di++]);
      else cells.push({ key: "empty:" + i, cat: "empty", text: "—", sub: "", icon: "", tint: "" });
    }
    // Bags keep the leftovers so a per-square reroll has somewhere to draw from.
    return { cells: cells, freeIdx: freeIdx, need: need, filled: drawn.length, bags: softBags, used: used };
  }

  function generate(token) {
    const pools = buildGoalPool(TIER_W);
    const body = seedBody(cfg, token);
    const fp = b32(hashStr(fingerprint()), 4);
    // Seeded from the body only, exactly as MHGU Bingo does — the fingerprint is advisory
    // and drives the "different settings" banner, never the layout.
    const rng = makeRng(body);
    const built = buildCells(rng, cfg, pools);
    bags = built.bags;
    usedKeys = built.used;
    card = {
      seed: body + "-" + fp, token: token, fp: fp,
      cfg: JSON.parse(JSON.stringify(cfg)),
      modified: false, freeIdx: built.freeIdx, cells: built.cells,
      marked: new Set(built.freeIdx >= 0 ? [built.freeIdx] : []),
      created: Date.now(), need: built.need, short: built.need - built.filled,
      draws: 0, firstBingoDraw: null, blackoutDraw: null, log: [], last: null,
    };
    stopAuto();
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
    let next = null;
    while (bag.length) { const g = bag.pop(); if (!usedKeys.has(g.key)) { next = g; break; } }
    if (!next) return;
    usedKeys.delete(cell.key);
    usedKeys.add(next.key);
    card.cells[i] = next;
    card.marked.delete(i);
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
  function drawOnce() {
    if (!card || isComplete()) return null;
    const charm = ROLL.draw(TIER_PAIRS);
    if (!charm) return null;
    const hits = [];
    for (let i = 0; i < card.cells.length; i++) {
      const cell = card.cells[i];
      if (card.marked.has(i) || !cell.cond) continue;
      if (satisfies(charm, cell.cond)) { card.marked.add(i); hits.push(i); }
    }
    card.draws++;
    card.last = { charm: charm, hits: hits.length };
    card.log.unshift({ charm: charm, hits: hits.length, at: card.draws });
    if (card.log.length > 50) card.log.length = 50;

    // Frozen at the moment they happen, rather than recomputed — the score is when you got
    // there, and a later reroll or reload must not be able to move it.
    if (card.firstBingoDraw == null && completedLines().length) card.firstBingoDraw = card.draws;
    if (card.blackoutDraw == null && isComplete()) card.blackoutDraw = card.draws;
    return { charm: charm, hits: hits };
  }

  const totalCells = () => card ? card.cells.filter((c) => c.cat !== "empty").length : 0;
  const isComplete = () => !!card && card.marked.size >= totalCells() && totalCells() > 0;

  function drawBatch(n) {
    let hit = false;
    for (let i = 0; i < n; i++) {
      const r = drawOnce();
      if (!r) break;
      if (r.hits.length) hit = true;
      if (isComplete()) break;
    }
    renderCard();
    saveCard();
    return hit;
  }

  // Auto-draw runs in batches on a timer rather than one draw per frame: a 5x5 takes a
  // median of about 700 draws and a bad card several thousand, which is a lot of clicking
  // and far too slow to watch one at a time. AUTO_STOP is a runaway guard, not a rule —
  // it only matters if a pool somehow contains a square nothing can satisfy.
  // Tuned against scripts/simulate.mjs: a 5x5 blacks out in a median of ~730 draws, so
  // ~160 draws a second finishes a typical card in about five seconds and a bad one in
  // twenty. Fast enough not to be a chore, slow enough that the squares visibly fill and
  // the log is worth watching — the filling IS the game, so racing past it is a loss.
  const AUTO_BATCH = 8, AUTO_TICK = 50, AUTO_STOP = 20000;
  function startAuto(untilMatch) {
    stopAuto();
    if (!card || isComplete()) return;
    const startedAt = card.draws;
    $("autoBtn").textContent = "Stop";
    $("autoBtn").classList.add("accent");
    autoTimer = setInterval(() => {
      const hit = drawBatch(untilMatch ? 1 : AUTO_BATCH);
      if (isComplete() || (untilMatch && hit) || card.draws - startedAt > AUTO_STOP) stopAuto();
    }, untilMatch ? 16 : AUTO_TICK);
  }
  function stopAuto() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    const b = $("autoBtn");
    if (b) { b.textContent = "Auto"; b.classList.remove("accent"); }
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
      if (cell.sub) {
        const sub = document.createElement("div");
        sub.className = "cell-sub";
        sub.textContent = cell.sub;
        el.appendChild(sub);
      }

      // Squares are not buttons here. Every tile resolves from a draw, so there is no
      // manual marking to offer — and a hand-markable square would quietly invalidate the
      // draw count, which is the whole score.
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
      note.textContent = card.last.hits
        ? "marked " + card.last.hits + (card.last.hits === 1 ? " square" : " squares")
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
      t.textContent = charmName(entry.charm.r) + " · " + (entry.charm.s || 0) + "s · "
        + entry.charm.k.map((s) => treeName(s[0]) + " " + (s[1] > 0 ? "+" : "") + s[1]).join(", ");
      row.appendChild(n); row.appendChild(t);
      if (entry.hits) {
        const h = document.createElement("span");
        h.className = "log-hit";
        h.textContent = "+" + entry.hits;
        row.appendChild(h);
      }
      log.appendChild(row);
    }

    const done = isComplete();
    $("drawBtn").disabled = done;
    $("draw25Btn").disabled = done;
    $("autoBtn").disabled = done;
  }

  function updateSeedBar() {
    if (!card) return;
    $("seedInput").value = card.seed;
    $("seedModified").classList.toggle("hidden", !card.modified);
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
    const pools = buildGoalPool(TIER_W);
    let avail = 0;
    for (const c of CATS) {
      const n = pools.soft[c.id].length;
      const el = $("count_" + c.id);
      if (el) el.textContent = n ? n + (n === 1 ? " goal" : " goals") : "none at these tiers";
      // Counted from the ordinary band only. The hard band is capped at a couple of squares
      // per card, so folding it in here would claim a grid can be filled when it can't.
      if ((cfg.cats[c.id] | 0) > 0) avail += n;
    }
    const n = cfg.size * cfg.size - (effFree(cfg) ? 1 : 0);
    $("poolStatus").textContent = avail + " goals available · " + n + " squares to fill";
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
      const cnt = document.createElement("span");
      cnt.id = "count_" + c.id;
      hint.appendChild(document.createTextNode(c.hint + " · "));
      hint.appendChild(cnt);

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

  // ── Persistence ────────────────────────────────────────────────────────────
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, cfg: cfg, showReroll: showReroll, previewMin: previewMin }));
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
    card = d;
    card.marked = new Set(Array.isArray(d.marked) ? d.marked : []);
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
    const pools = buildGoalPool(TIER_W);
    const rng = makeRng(card ? card.seed + ":bags" : "bags");
    bags = {};
    for (const c of CATS) {
      const all = pools.soft[c.id].concat(pools.hard[c.id]).filter((g) => !usedKeys.has(g.key));
      bags[c.id] = weightedShuffle(all, rng);
    }
  }

  function doReset() {
    cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
    showReroll = true;
    previewMin = 5;
    $("showReroll").checked = true;
    $("previewMin").value = "5";
    $("gridSize").value = String(cfg.size);
    $("freeSpace").checked = cfg.free;
    buildCatRows();
    syncFreeSpace();
    saveSettings();
    refreshCounts();
    generate(newToken());
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
    if (d.cfg && CATS.some((c) => (d.cfg.cats[c.id] | 0) > 0)) {
      cfg = d.cfg;
      $("gridSize").value = String(cfg.size);
      buildCatRows();
      syncFreeSpace();
      saveSettings();
      refreshCounts();
    }
    generate(d.token);
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
    $("previewMin").addEventListener("change", () => {
      previewMin = parseInt($("previewMin").value, 10); saveSettings(); hidePreview();
    });

    const newCard = () => guard("New card?", "New card", () => generate(newToken()));
    $("generateBtn").addEventListener("click", newCard);
    $("newCardBtn").addEventListener("click", newCard);
    $("resetBtn").addEventListener("click", () => guard("Reset everything?", "Reset", doReset));

    $("drawBtn").addEventListener("click", () => { stopAuto(); drawBatch(1); });
    $("draw25Btn").addEventListener("click", () => { stopAuto(); drawBatch(25); });
    $("autoBtn").addEventListener("click", () => { if (autoTimer) stopAuto(); else startAuto(false); });
    $("untilBtn").addEventListener("click", () => { if (autoTimer) stopAuto(); else startAuto(true); });

    $("seedApply").addEventListener("click", () => guard("Load that seed?", "Load", applySeed));
    $("seedInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") guard("Load that seed?", "Load", applySeed);
    });
    $("seedCopy").addEventListener("click", () => {
      const v = $("seedInput").value;
      const done = () => {
        const b = $("seedCopy");
        b.textContent = "Copied";
        setTimeout(() => { b.textContent = "Copy"; }, 1200);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(done, done);
      else { $("seedInput").select(); document.execCommand("copy"); done(); }
    });

    $("confirmOk").addEventListener("click", () => { const f = confirmFn; closeConfirm(); if (f) f(); });
    $("confirmCancel").addEventListener("click", closeConfirm);
    wireModal("helpModal", "helpBtn", "helpClose");
    wireModal("linksModal", "linksBtn", "linksClose");
    wireModal("themeModal", "themeBtn", "themeClose");
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
