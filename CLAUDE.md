# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project Overview

MHGU Talisman Bingo is a static bingo-card generator where every square is a **condition on a
talisman**. It is played like real bingo: **one person draws and calls**, and everyone else marks
their own card by hand. Pressing Draw rolls a real, legal charm off the game's own tables and
announces it — it marks nothing. Cards are seeded and shareable, so a group can race one board.

**Live URL:** https://armoredraven17.github.io/mhgu-talisman-bingo/

**To develop:** serve `docs/` over HTTP — `python -m http.server` from inside `docs/`. There is no
build step for the app itself. Do **not** test via `file://`; localStorage origin behaviour differs.

## Files

- `docs/index.html` — markup + modals
- `docs/styles.css` — all styling, theme CSS variables
- `docs/app.js` — all application logic (one IIFE, no modules)
- `docs/roll.js` — the charm roller, ported from `mhgu-charm-farm`
- `docs/goals.js` — keep-set, goal catalogue, exact probabilities, `satisfies()`
- `docs/data.js` — **generated**, do not edit by hand; just the tables now
- `tools/build-data.js` — regenerates `docs/data.js`
- `scripts/test-roll.mjs`, `scripts/simulate.mjs` — headless checks
- `talisman_charm_table.json`, `skills.json`, `talisman.json` — vendored from `mhgu-editor`

## Cache busting (mandatory)

GitHub Pages caches assets by full URL. Every time you change `styles.css`, `app.js`, `roll.js` or
`data.js`, you **must** increment the `?v=N` query string on its tag in `index.html`. Without this,
users keep the stale copy until they hard-refresh.

## The draw stream is deliberately NOT seeded

The seeded RNG lays out the **card**. `drawOnce()` uses `Math.random()` and always will.

If the draws were derived from the card seed, everyone on a given seed would get a byte-identical
game and "fewest draws" would have exactly one possible answer. The card is the reproducible part;
the luck is not. Don't "fix" this by threading the seed into the roller.

This matters more now that one person calls for a table: the caller's stream is the only stream,
and it has to be a fresh roll every session, not a replay of the seed.

## Regenerating data

`talisman_charm_table.json`, `skills.json` and `talisman.json` are copies of the files in
`mhgu-editor/src/assets/`. Vendoring from there rather than from `mhgu-charm-farm/docs/data/` keeps
this app one hop from the romfs source instead of two.

```
node tools/build-data.js
node scripts/test-roll.mjs      # always, after a rebuild
```

`dataVersion` hashes the source bytes and rides in every seed's fingerprint, so a data rebuild makes
old seeds *warn* rather than silently produce a different card. Bump `data.js?v=N` afterwards.

## Goals are conditions, and the probabilities are computed at runtime

A goal is a set of optional fields that are **ANDed** — `a` tree, `b` minimum points, `a2` a second
tree, `se` exact slots, `re` exact rarity.

**`docs/goals.js` owns all of it**: the keep-set, the goal enumeration, the closed-form
probabilities and `satisfies()`. Probabilities used to be baked into `data.js` by
`tools/build-data.js`, four per goal, one per charm kind. Pruning ended that — a card keeps only
`KEEP_N` of the 137 trees and every probability depends on which ones, so there is no fixed
catalogue left to bake. `data.js` is now just the tables (10KB, down from 172KB).

They are still computed **in closed form**, not by simulation. `rollCharm` is simple enough to
integrate exactly, and an exact number makes the floors a guarantee rather than a sampling estimate.

The old hazard was that `satisfies()` lived in `app.js` while the maths lived in `build-data.js`,
and a field added to one and not the other silently broke tiles. They are now in the same file,
adjacent. `scripts/test-roll.mjs` still checks one against the other over 600k real draws — and it
does so **per keep-set, drawing from the pruned table**, because a closed form that were right only
on the full tables would pass the old test and be wrong in every real game.

## Two floors and a ceiling

- `SOFT_FLOOR` (1/300) — what an ordinary square must clear.
- `HARD_FLOOR` (1/1000) — absolute eligibility.
- `CEILING` (1/8) — absolute *ease*. A square that marks on one draw in eight is a second free
  space, not a goal. There was no ceiling for a long time and it showed: "rarity 5 or higher" ran
  at 1 in 2 and "exactly 0 slots" at 1 in 2. Pruning made this urgent rather than academic, because
  it lifts every single-skill tile at once.
- `hardBudgetFor(need)` = `floor(need/16)` squares per card may come from the band between the
  floors.

**Hard-native pools ignore the budget.** A pool with nothing above the soft floor is rare by nature,
and combo is exactly that — even pruned, most pairs land between the floors. Charging them against a
one-square budget does not ration the pool, it deletes it: the pool stops being offered for ordinary
squares and at most one pair ever reaches a card. The budget exists to stop a pool that *could* have
given an ordinary square from handing over a rare one; it was never meant to veto a pool outright.

## Facts about the tables that shape the design

- **A mystery charm never carries a positive second skill.** Every mystery row is `[lo, hi, 0, 0]`,
  and mystery can't reach two slots. So a mystery-heavy tier mix doesn't slow the game down, it
  *shrinks the catalogue* — 644 goals at the default weights, 328 at mystery-only. The pool
  generators refuse to emit what the enabled tiers can't produce, which is the same rule as MHGU
  Bingo's "no objective without a control behind it".
- **A charm caps at 13 points; Attack caps at 10.** Skill *activation* thresholds are therefore
  mostly unreachable — Attack Up (M) needs 15, Handicraft activates at 10 and caps at 5. 108 of the
  reachable trees have no activation threshold a charm can hit, and not one such tile clears the
  floor. The points ladder is a fixed `[3,5,7,10,13]` for exactly this reason. Fractions of each
  tree's max were the other candidate and yield less than half as many playable tiles, because
  three-quarters and all of a ceiling are both deep in the tail.
- **45 trees are second-skill-only** (Handicraft among them), 4 are first-skill-only. A
  second-skill-only tree costs the 50% gate *and* a 1-in-74..105 pick, so it lands 5–8× rarer.
- **Deviant trees 144–179 are excluded by name.** All 36 are below the floor anyway, but the real
  reason is that "Has Bloodbath X" is not a readable bingo tile. Trees 180–205 never appear in any
  table at all.
- **Skill × skill works ONLY because the card prunes the table.** On the full 137 trees the
  cheapest pair in the game is 1 in 14,030 and the median 1 in 43,887 — not one clears
  `HARD_FLOOR`, and nothing appears until a floor around 1 in 20,000. Pruning to `KEEP_N` = 20
  attacks the term responsible, the 1-in-74..105 second-slot pick: the best pair becomes about
  1 in 210 and roughly 70 per card clear the floor. Do not re-enable pairs without pruning, and do
  not raise `KEEP_N` far without checking they survive — at 40 kept, zero pairs clear the floor
  again.
- **`KEEP_N` = 20 is a floor of its own, set by starvation.** A random keep-set can leave a charm
  kind with no legal first skill, and that kind then rolls nothing and silently drops out of the
  draw stream. Measured over 3,000 sets: 2.9% at 8 kept, 0.3% at 12, zero at 16 and above. 20 also
  happens to peak the count of viable pairs. `keepFor()` repairs a starved set anyway, but the
  margin is why the number is not lower.
- **Mystery is a hard ceiling on every pair tile.** It has *zero* legal slot-2 rows, so a mystery
  charm is always single-skilled and 30% of the draw stream can never satisfy a two-skill tile at
  all. No amount of pruning lifts this.
- **Rarity is exactly the ten named talismans.** No open bands: "rarity 5 or higher" was 1 in 2,
  which the `CEILING` now catches on principle. Bands survive only as combo second conditions.
- **Talisman rarity and charm kind are two different axes.** The vendored table has four keys — the
  charm kinds — and those alone determine the skill ranges. Rarity (1–10) is the equip id, fixed
  when the item is created; `TAL_TIER` maps it to a kind purely to know which table bounds a given
  talisman. Rarities sharing a kind have byte-identical ranges: a Hero, a Legend and a Creator
  differ in name only. What decides 8 vs 9 vs 10 is the drop, and that data is in none of the
  vendored files.

## Odds are never shown to the player

Every goal carries an exact probability and the floors depend on it, but it is internal. An earlier
version printed it under each tile as a difficulty pip; it reads as a spoiler, and knowing a square is
hopeless before you start turns the card into a spreadsheet. Not knowing is the appeal. Don't put it
back on the tile — the Help modal says only that cards are filtered to stay winnable.

## Squares are marked by hand

**They used to be un-clickable, and that reversed deliberately.** The old model auto-marked every
square a drawn charm satisfied, and the argument for it was that hand-marking would invalidate the
draw count, which was the whole score.

That argument only holds for one player on one device. The game is now several people on a shared
seed with one person calling draws, and the app on any given screen cannot know what its player has
marked — only they can. So `renderCard` builds squares with `role="button"`, a tab stop and a key
handler, and `toggleMark()` is the only thing that ever marks.

`drawOnce()` marks nothing. It rolls, announces, and computes `card.hint`: the unmarked squares that
charm would satisfy. That set is rendered as an **outer glow**, and it is only ever a nudge — the
player still clicks, and clicking is what swaps the glow for the filled `.marked` state. The glow is
what a square looks like *before* you claim it, not a second kind of marked. It is a setting
(`softHighlight`, on by default) because calling a table without the assist is a legitimate way to
play, and a harder one.

The draw count is now the **caller's clock** rather than an objective score: `firstBingoDraw` and
`blackoutDraw` are stamped when a player's own marks complete a line or the board, against whatever
the draw count read at that moment. Still frozen once set, so a later unmark can't move a score that
already happened.

**A square can't be claimed until a draw has satisfied it** (`lockUnmatched`, on by default).
`card.eligible` is the set of squares any draw has ever matched; it only grows, and `toggleMark`
refuses to mark anything outside it. Unmarking is always allowed — that is how a misclick is undone.

`eligible` is tracked separately rather than derived from `card.log`, which keeps only the last 50
draws for display: a square matched on draw 3 would otherwise become unmarkable by draw 60. A reroll
drops its index from the set, because the new goal has never been drawn for whatever the old one
earned.

Locked squares get no dimming and no badge, only a default cursor. Marking out what is still
outstanding would hand the player the exact inverse of the hint for free, including when the
highlight is switched off.

There is no auto-draw. Draws are one at a time, because a person is reading them out.

## Pacing

`scripts/simulate.mjs` is the regression guard on the floors, the ceiling, `KEEP_N` and the tier
weights — all pacing choices, not derivable from the tables, so the only way to know a change broke
the game is to play it a few hundred times. Every simulated card prunes to its own keep-set and
draws from that same pruned table; simulating against the full tables reports a game nobody plays.

It marks automatically, which the app no longer does. That is fine and deliberate: it measures how
many draws a **perfect** player needs, which is the floor on the caller's clock and exactly the
quantity the floors and `KEEP_N` move. Real tables will be slower by however much people miss.

Current 5×5: first line at a median of ~28 draws, blackout at ~1,060.

Note the shape that pruning produces: the first line comes *fast* and blackout is the long grind.
That is intrinsic. Naming one of 20 kept trees is about 1 in 17, so ordinary squares fall quickly,
while the pair tiles that pruning exists to enable sit at 1 in 200–1,000 and are what the back half
of the card is waiting on. Raising `KEEP_N` slows the opening but strangles pairs; lowering it does
the reverse. They trade directly against each other.

## This app shares no state with the other MHGU apps

All the MHGU apps publish under `https://armoredraven17.github.io`, and GitHub Pages project sites
are paths rather than subdomains, so **they share one localStorage origin**. Every key here is
namespaced `mhgu-talisman-bingo-*`. Don't introduce an unprefixed key.

## Parity

There is no desktop version and none is planned. There is no Twitch/Worker integration — the seed
plus the unseeded draw stream is the whole sharing story.
