// How long does a card actually take? Run: node scripts/simulate.mjs [cards]
//
// This is the regression guard on the two floors and the default tier weights. Those
// numbers are not derivable from the tables — they are a pacing choice — so the only way to
// know a change made the game unplayable is to play it a few hundred times.
//
// It builds cards the way docs/app.js does (weighted pool choice per square, dedupe by key,
// a small budget of hard squares) and then draws until blackout. The card layout uses
// Math.random rather than the seeded RNG, which is the one deliberate difference: we want
// the distribution over many different boards, not one board many times.
import { DATA, ROLL, DEFAULT_TIER_W, DEFAULT_CATS, SOFT_FLOOR,
         hardBudgetFor, tierPairs, pools, satisfies } from "./common.mjs";

const CARDS = parseInt(process.argv[2], 10) || 400;
const CAP = 60000;   // a card that hasn't finished by here is reported, not waited on

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function buildCard(size, P) {
  const n = size * size;
  const freeIdx = size % 2 === 1 ? (n - 1) / 2 : -1;
  const need = n - (freeIdx >= 0 ? 1 : 0);
  const cats = Object.keys(DEFAULT_CATS).filter((c) => DEFAULT_CATS[c] > 0 && P.soft[c].length);
  const budget = hardBudgetFor(need);
  const hardAt = new Set();
  while (hardAt.size < budget) hardAt.add(Math.floor(Math.random() * need));

  const used = new Set(), cells = [];
  let guard = 0;
  while (cells.length < need && guard++ < need * 200) {
    const wantHard = hardAt.has(cells.length);
    const total = cats.reduce((a, c) => a + DEFAULT_CATS[c], 0);
    let r = Math.random() * total, cat = cats[cats.length - 1];
    for (const c of cats) { r -= DEFAULT_CATS[c]; if (r < 0) { cat = c; break; } }
    const bag = wantHard && P.hard[cat].length ? P.hard[cat] : P.soft[cat];
    const g = pick(bag);
    if (!g || used.has(g.k)) continue;
    used.add(g.k);
    cells.push(g);
  }
  return cells;
}

function linesFor(s) {
  const out = [];
  for (let r = 0; r < s; r++) out.push(Array.from({ length: s }, (_, c) => r * s + c));
  for (let c = 0; c < s; c++) out.push(Array.from({ length: s }, (_, r) => r * s + c));
  out.push(Array.from({ length: s }, (_, i) => i * s + i));
  out.push(Array.from({ length: s }, (_, i) => i * s + (s - 1 - i)));
  return out;
}

// Play one card. Returns draws to the first completed line and to blackout.
function play(size, cells) {
  const n = size * size;
  const freeIdx = size % 2 === 1 ? (n - 1) / 2 : -1;
  // Re-seat the goals around the free space so the line geometry is the real one.
  const grid = [];
  let di = 0;
  for (let i = 0; i < n; i++) grid.push(i === freeIdx ? null : cells[di++]);
  const marked = new Set(freeIdx >= 0 ? [freeIdx] : []);
  const lines = linesFor(size);
  const pairs = tierPairs(DEFAULT_TIER_W);

  let firstLine = null, draws = 0;
  while (marked.size < n && draws < CAP) {
    draws++;
    const c = ROLL.draw(pairs);
    for (let i = 0; i < n; i++) {
      if (marked.has(i) || !grid[i]) continue;
      if (satisfies(c, grid[i])) marked.add(i);
    }
    if (firstLine === null && lines.some((ln) => ln.every((i) => marked.has(i)))) firstLine = draws;
  }
  return { firstLine, blackout: marked.size >= n ? draws : null, draws };
}

const q = (a, f) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))] : NaN;
const fmt = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString().padStart(7) : "      -";

const P = pools(DEFAULT_TIER_W);
console.log("tier weights", JSON.stringify(DEFAULT_TIER_W),
  "| ordinary goals", Object.keys(DEFAULT_CATS).reduce((a, c) => a + P.soft[c].length, 0),
  "| hard-band goals", Object.keys(DEFAULT_CATS).reduce((a, c) => a + P.hard[c].length, 0));
console.log(`${CARDS} cards per grid size\n`);
console.log("grid  squares  hard   line:med   black:mean    med       p90       p99   unfinished");

let bad = 0;
for (const size of [3, 4, 5, 6, 7]) {
  const lines = [], blacks = [];
  let unfinished = 0;
  for (let i = 0; i < CARDS; i++) {
    const cells = buildCard(size, P);
    const r = play(size, cells);
    if (r.firstLine != null) lines.push(r.firstLine);
    if (r.blackout != null) blacks.push(r.blackout); else unfinished++;
  }
  const need = size * size - (size % 2 === 1 ? 1 : 0);
  const mean = blacks.reduce((a, b) => a + b, 0) / (blacks.length || 1);
  console.log(
    `${size}x${size}` + String(need).padStart(9) + String(hardBudgetFor(need)).padStart(6) +
    fmt(q(lines, 0.5)) + "  " + fmt(mean) + fmt(q(blacks, 0.5)) +
    fmt(q(blacks, 0.9)) + fmt(q(blacks, 0.99)) + String(unfinished).padStart(13));
  if (size === 5) {
    // The headline number. A 5x5 wants to be a session, not a career: a first line inside a
    // couple of hundred draws and a blackout comfortably under the auto-draw runaway guard.
    const med = q(blacks, 0.5);
    if (!(med > 200 && med < 3000)) { console.error(`\nFAIL: 5x5 median blackout ${med} outside 200..3000`); bad++; }
    if (!(q(lines, 0.5) < 400)) { console.error(`\nFAIL: 5x5 median first line ${q(lines, 0.5)} too slow`); bad++; }
  }
  if (unfinished) { console.error(`FAIL: ${unfinished} ${size}x${size} cards unfinished after ${CAP} draws`); bad++; }
}
console.log(bad ? `\n${bad} FAILURE(S)` : "\npacing within target");
process.exit(bad ? 1 : 0);
