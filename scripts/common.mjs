// Shared harness for the headless scripts.
//
// docs/data.js, docs/roll.js and docs/goals.js are plain browser scripts that hang globals
// off `window`, so fake a window and eval them in order. Same trick
// mhgu-charm-farm/scripts/test-roll.mjs and the set builder's test-engine.mjs use.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const win = {};
globalThis.window = win;
for (const f of ["data.js", "roll.js", "goals.js"]) (0, eval)(readFileSync(join(docs, f), "utf8"));

export const DATA = win.MHGU_TALISMAN_DATA;
export const ROLL = win.TB_ROLL;
export const GOALS = win.TB_GOALS;

// These must match docs/app.js. They are duplicated rather than imported because app.js is an
// IIFE that touches the DOM on load and cannot be required from node — so if you change a
// floor, the keep size or the default weights there, change them here too.
export const DEFAULT_TIER_W = { mystery: 30, shining: 25, timeworn: 25, enduring: 20 };
export const SOFT_FLOOR = 1 / 300;
export const HARD_FLOOR = 1 / 1000;
export const CEILING = 1 / 8;
export const FLOORS = { soft: SOFT_FLOOR, hard: HARD_FLOOR, ceil: CEILING };
export const KEEP_N = 20;
export const hardBudgetFor = (need) => Math.floor(need / 16);
export const DEFAULT_CATS = { name: 4, pts: 3, slot: 1, rar: 2, combo: 3 };

export const tierPairs = (tw) => ROLL.TIER_ORDER.map((t) => [t, tw[t] | 0]);

// The matcher is no longer duplicated here — goals.js owns it, next to the maths it mirrors.
export const satisfies = GOALS.satisfies;

// Same seeded RNG as app.js, so a keep-set drawn here matches one drawn in the browser.
export function makeRng(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let a = h >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const keepFor = (seedStr, n = KEEP_N) => GOALS.keepFor(makeRng(seedStr), n);

// Pools for one keep-set. Every probability depends on which trees survived the prune, so
// there is no such thing as a global catalogue any more.
export function pools(tw, keep) {
  return GOALS.build(keep, tw, FLOORS);
}
