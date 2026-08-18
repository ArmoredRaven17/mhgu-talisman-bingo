// Shared harness for the headless scripts.
//
// docs/data.js and docs/roll.js are plain browser scripts that hang globals off `window`,
// so fake a window and eval them in order. Same trick mhgu-charm-farm/scripts/test-roll.mjs
// and the set builder's test-engine.mjs use.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const win = {};
globalThis.window = win;
for (const f of ["data.js", "roll.js"]) (0, eval)(readFileSync(join(docs, f), "utf8"));

export const DATA = win.MHGU_TALISMAN_DATA;
export const ROLL = win.TB_ROLL;

// These four must match docs/app.js. They are duplicated rather than imported because
// app.js is an IIFE that touches the DOM on load and cannot be required from node — so if
// you change a floor or the default weights there, change them here too.
export const DEFAULT_TIER_W = { mystery: 30, shining: 25, timeworn: 25, enduring: 20 };
export const SOFT_FLOOR = 1 / 300;
export const HARD_FLOOR = 1 / 1000;
export const hardBudgetFor = (need) => Math.floor(need / 16);
export const DEFAULT_CATS = { name: 4, pts: 3, slot: 1, rar: 2, combo: 3 };

export const tierPairs = (tw) => ROLL.TIER_ORDER.map((t) => [t, tw[t] | 0]);

export function normTierW(tw) {
  const total = ROLL.TIER_ORDER.reduce((a, t) => a + (tw[t] | 0), 0);
  return ROLL.TIER_ORDER.map((t) => (tw[t] | 0) / total);
}
export const goalProb = (g, nw) => g.pt.reduce((a, p, i) => a + p * nw[i], 0);

// The runtime matcher, kept byte-identical in intent to app.js's satisfies(). The whole
// point of these scripts is to check it against the probabilities in data.js.
export function satisfies(charm, g) {
  if (!charm || !g) return false;
  if (g.a != null && !charm.k.some((x) => x[0] === g.a && x[1] >= (g.b || 1))) return false;
  if (g.s != null && charm.s < g.s) return false;
  if (g.r != null && charm.r < g.r) return false;
  if (g.rx != null && charm.r > g.rx) return false;
  if (g.re != null && charm.r !== g.re) return false;
  if (g.tr != null && ROLL.tierOf(charm.r) !== g.tr) return false;
  if (g.n != null && charm.k.length !== g.n) return false;
  if (g.pos && !charm.k.every((x) => x[1] > 0)) return false;
  if (g.neg != null && !charm.k.some((x) => x[1] <= g.neg)) return false;
  return true;
}

export function pools(tw) {
  const nw = normTierW(tw);
  const soft = {}, hard = {};
  for (const g of DATA.goals) {
    const p = goalProb(g, nw);
    if (p < HARD_FLOOR) continue;
    const bucket = p >= SOFT_FLOOR ? soft : hard;
    (bucket[g.c] = bucket[g.c] || []).push(Object.assign({ p }, g));
  }
  for (const c of Object.keys(DEFAULT_CATS)) { soft[c] = soft[c] || []; hard[c] = hard[c] || []; }
  return { soft, hard };
}
