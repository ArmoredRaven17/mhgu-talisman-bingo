// Headless check on the roller, the goal catalogue and the matcher.
// Run: node scripts/test-roll.mjs
//
// The thing actually being tested is that TWO independent descriptions of the same rules
// agree: the closed-form probabilities tools/build-data.js integrates, and the runtime
// matcher app.js uses to mark squares. If one drifts from the other, tiles either mark on
// charms that shouldn't satisfy them or advertise odds they don't have — and neither shows
// up as an error anywhere else.
import { DATA, ROLL, DEFAULT_TIER_W, SOFT_FLOOR, HARD_FLOOR,
         tierPairs, normTierW, goalProb, satisfies } from "./common.mjs";

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

// A mystery charm has no positive second-skill table at all, so it is always single-skilled.
// This is load-bearing: it is why a two-condition tile is unreachable from that tier, and
// why a mystery-heavy weighting shrinks the catalogue rather than merely slowing the game.
let mysteryTwoSkill = 0;
for (let i = 0; i < 50000; i++) if (ROLL.rollCharm(1 + (i % 2)).k.length > 1) mysteryTwoSkill++;
check(mysteryTwoSkill === 0, `mystery produced ${mysteryTwoSkill} two-skill charms`);

// ── The catalogue itself ──────────────────────────────────────────────────────
const keys = new Set();
for (const g of DATA.goals) {
  check(!keys.has(g.k), `duplicate goal key ${g.k}`);
  keys.add(g.k);
  check(g.pt.length === 4, `${g.k} has ${g.pt.length} tier probabilities, expected 4`);
  check(g.pt.some((p) => p > 0), `${g.k} is impossible in every tier`);
  check(g.pt.every((p) => p >= 0 && p <= 1), `${g.k} has a probability outside 0..1`);
}
// Deviant trees make unreadable tiles ("Has Bloodbath X") and are excluded by name.
const deviant = DATA.goals.filter((g) => g.a >= 144 && g.a <= 179);
check(deviant.length === 0, `${deviant.length} deviant-tree goals leaked into the catalogue`);
console.log(`catalogue: ${DATA.goals.length.toLocaleString()} goals, all keys unique`);

// ── The two descriptions must agree ───────────────────────────────────────────
// Every eligible goal is checked, not a sample: the tail is exactly where a mismatch would
// hide, and a goal that never fires looks identical to one that is merely rare.
const tw = DEFAULT_TIER_W, nw = normTierW(tw), pairs = tierPairs(tw);
const live = DATA.goals.map((g) => ({ g, p: goalProb(g, nw) })).filter((x) => x.p >= HARD_FLOOR);
const M = 400000;
const hits = new Array(live.length).fill(0);
for (let i = 0; i < M; i++) {
  const c = ROLL.draw(pairs);
  for (let j = 0; j < live.length; j++) if (satisfies(c, live[j].g)) hits[j]++;
}
let worst = { z: 0, k: null }, sumZ = 0, counted = 0;
for (let j = 0; j < live.length; j++) {
  const exp = live[j].p, obs = hits[j] / M;
  const se = Math.sqrt(exp * (1 - exp) / M);
  const z = (obs - exp) / se;
  sumZ += z; counted++;
  if (Math.abs(z) > Math.abs(worst.z)) worst = { z, k: live[j].g.k, exp, obs };
}
const meanZ = sumZ / counted;
console.log(`matcher vs closed form: ${counted.toLocaleString()} goals over ${M.toLocaleString()} draws`);
console.log(`  mean z ${meanZ.toFixed(3)}  |  worst ${worst.k} z=${worst.z.toFixed(2)} ` +
  `(1 in ${Math.round(1 / worst.exp)} expected, 1 in ${Math.round(1 / worst.obs)} observed)`);

// A per-goal |z| of 5 is generous for one test but this runs ~1,100 of them at once, so the
// largest is expected around 3.5 by chance alone. The mean is the real guard: a systematic
// error in the probability maths moves every goal the same way and shows up there long
// before any single goal breaks a threshold.
check(Math.abs(worst.z) < 5.5, `goal ${worst.k} deviates by ${worst.z.toFixed(2)} sigma`);
check(Math.abs(meanZ) < 0.25, `mean deviation ${meanZ.toFixed(3)} suggests a systematic bias`);

// ── The floors have to leave a playable pool ──────────────────────────────────
const byCat = {};
for (const x of live) if (x.p >= SOFT_FLOOR) byCat[x.g.c] = (byCat[x.g.c] || 0) + 1;
for (const cat of ["name", "pts", "slot", "rar", "combo"]) {
  check((byCat[cat] | 0) > 0, `pool "${cat}" has no goals above the soft floor at default weights`);
}
check(Object.values(byCat).reduce((a, b) => a + b, 0) >= 100,
  "fewer than 100 ordinary goals at default weights — a 10x10 could not be filled");
console.log("pools above the soft floor:", JSON.stringify(byCat));

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall checks passed");
process.exit(fail ? 1 : 0);
