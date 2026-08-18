# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project Overview

MHGU Talisman Bingo is a static bingo-card generator where every square is a **condition on a
talisman**. Pressing Draw rolls a real, legal charm off the game's own tables and auto-marks every
open square that charm satisfies. Cards are seeded and shareable; the score is how few draws it took.

**Live URL:** https://armoredraven17.github.io/mhgu-talisman-bingo/

**To develop:** serve `docs/` over HTTP — `python -m http.server` from inside `docs/`. There is no
build step for the app itself. Do **not** test via `file://`; localStorage origin behaviour differs.

## Files

- `docs/index.html` — markup + modals
- `docs/styles.css` — all styling, theme CSS variables
- `docs/app.js` — all application logic (one IIFE, no modules)
- `docs/roll.js` — the charm roller, ported from `mhgu-charm-farm`
- `docs/data.js` — **generated**, do not edit by hand
- `tools/build-data.js` — regenerates `docs/data.js`
- `scripts/test-roll.mjs`, `scripts/simulate.mjs` — headless checks
- `talisman_charm_table.json`, `skills.json`, `talisman.json` — vendored from `mhgu-editor`

## Cache busting (mandatory)

GitHub Pages caches assets by full URL. Every time you change `styles.css`, `app.js`, `roll.js` or
`data.js`, you **must** increment the `?v=N` query string on its tag in `index.html`. Without this,
users keep the stale copy until they hard-refresh.

## The draw stream is deliberately NOT seeded

The seeded RNG lays out the **card**. `drawOnce()` uses `Math.random()` and always will.

A drawn charm marks every open square it satisfies and the player makes no decisions. If the draws
were derived from the card seed, everyone on a given seed would get a byte-identical game and
"fewest draws" would have exactly one possible answer. The card is the reproducible part; the luck
is not. Don't "fix" this by threading the seed into the roller.

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

## Goals are conditions, and the probabilities are exact

`docs/data.js` holds ~1,540 goals. A goal is a set of optional fields that are **ANDed** — `a` tree,
`b` minimum points, `s` slots, `r`/`rx`/`re` rarity, `tr` tier, `n` skill count, `pos`, `neg` — plus
`pt`, its probability under each of the four roll tiers.

`pt` is computed **in closed form**, not by simulation. `rollCharm` is simple enough to integrate
exactly, and an exact number makes the probability floor a guarantee rather than a sampling estimate
— a 1-in-500 goal measured over 400k rolls has seen only ~800 hits, which is not enough to trust.

Per-tier rather than one number because the tier weights are a user control: the real hit rate is the
dot product with the normalised weights and can only be known at runtime.

**`satisfies()` in `app.js` is the runtime twin of that maths.** If you add a condition field to one,
add it to the other, or a tile will either mark on charms that don't satisfy it or advertise odds it
doesn't have. `scripts/test-roll.mjs` is what catches that: it checks every eligible goal's exact
probability against its empirical hit rate over 400k real draws.

## Two floors, not one

- `SOFT_FLOOR` (1/300) — what an ordinary square must clear.
- `HARD_FLOOR` (1/1000) — absolute eligibility.
- `hardBudgetFor(need)` = `floor(need/16)` squares per card may come from the band between them.

Below roughly 1-in-300 the pools collapse: at a 1-in-100 floor the points and combo pools go to
**zero** and the game degenerates into 44 skill names and 16 rarity tiles. So 1/300 is the tightest
floor that keeps all five pools alive.

The band between the floors is not academic — it holds **Handicraft** (1 in 876), Critical Up,
Carving and Capturer. Handicraft is the most recognisable charm skill in the game, and a card that
can never ask for it reads as a bug. One hard square costs about 100 draws on a 5×5.

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
- **Never emit skill × skill combos.** Two *named* skills on one charm is 1 in 16,065 at its most
  generous (Furor + Charmer) and a median of 1 in 49,161, so all 7,047 producible pairs are
  unwinnable — not one clears `HARD_FLOOR`, and nothing appears at all until a floor of about
  1 in 20,000. Mystery is 30% of draws and has **zero** legal slot-2 rows, so nearly a third of the
  stream cannot make a two-skill charm at all. This was tried and reverted; don't re-add it.
- **What does express "one skill and another": name one tree and ask only that the second skill be
  positive** (`{a, n: 2, pos: 1}`, the `cq:` pool). That pays the 50% gate once instead of also
  paying a 1-in-74..105 second pick, which lands it at 1 in 213 at best — 408 tiles, 26 above the
  soft floor and 227 in the hard band. Its probability is a **joint, not a product**: both
  conditions live in the same two slots, so `pWithPosSecond` sums the two placements of the named
  tree rather than multiplying `pHas` by `pSecond`. Slots, rarity and a positive second skill are
  the only second conditions cheap enough to pair with a named skill. Per-tree *negative* tiles
  fail like skill × skill does; the generic ones ("a cursed charm", 1 in 7) are cheap because any
  tree will do, and they're the only tiles that make a junk charm feel like a hit.

## Odds are never shown to the player

Every goal carries an exact probability and the floors depend on it, but it is internal. An earlier
version printed it under each tile as a difficulty pip; it reads as a spoiler, and knowing a square is
hopeless before you start turns the card into a spreadsheet. Not knowing is the appeal. Don't put it
back on the tile — the Help modal says only that cards are filtered to stay winnable.

## Squares are not clickable

The draws do the marking. A hand-markable square would quietly invalidate the draw count, which is
the entire score. `renderCard` builds `<div>`s, not `<button>`s, and wires no click handler — only
the reroll button on top is interactive. There is no custom-text pool for the same reason.

## Pacing

`scripts/simulate.mjs` is the regression guard on the floors and the default tier weights — those are
a pacing choice, not derivable from the tables, so the only way to know a change broke the game is to
play it a few hundred times. Current 5×5: first line at a median of ~90 draws, blackout at ~730.

`AUTO_BATCH`/`AUTO_TICK` are tuned against that: ~160 draws a second finishes a typical card in about
five seconds. Faster is worse — the squares filling *is* the game.

## This app shares no state with the other MHGU apps

All the MHGU apps publish under `https://armoredraven17.github.io`, and GitHub Pages project sites
are paths rather than subdomains, so **they share one localStorage origin**. Every key here is
namespaced `mhgu-talisman-bingo-*`. Don't introduce an unprefixed key.

## Parity

There is no desktop version and none is planned. There is no Twitch/Worker integration — the seed
plus the unseeded draw stream is the whole sharing story.
