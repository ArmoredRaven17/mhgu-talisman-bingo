# MHGU Talisman Bingo

A bingo card of talisman conditions for **Monster Hunter Generations Ultimate**.

**→ [armoredraven17.github.io/mhgu-talisman-bingo](https://armoredraven17.github.io/mhgu-talisman-bingo/)**

Every square is something a charm might be. Press **Draw Talisman** and the app rolls a real, legal
charm off the game's own tables; every open square that charm satisfies marks itself. Complete a row,
column or diagonal for a bingo, or fill the board for a blackout. Your score is how few draws it took.

There is nothing to click on the card. The draws do the marking.

## What goes on a card

Five pools, each toggleable with its own weight:

| Pool | Example square |
|---|---|
| **Skill Name** | Has Expert |
| **Skill Points** | Expert +5 or more |
| **Slot Count** | 2 slots or more |
| **Rarity** | Roll a King Talisman |
| **Combo** | Attack, 2+ slots · Two positive skills · A cursed charm |

Under each square is the chance that any one draw satisfies it — the honest difficulty rating. When a
card stalls, that number tells you which square is holding it up.

Squares are filtered so a card stays winnable. Nothing under about 1 in 1,000 is ever used, and only a
small budget per card — one square on a 5×5 — is allowed to be harder than about 1 in 300.

## Roll tiers

Charms come off four tables: mystery rolls the junk, enduring rolls Hero, Legend and Creator
talismans. The weights decide how often each is drawn.

They're a real lever, but not the one you'd expect — they mostly decide *which squares can exist*
rather than how long a card takes. A mystery talisman never carries a second skill and never reaches
two slots, so a mystery-heavy mix leaves far fewer conditions reachable, and the app stops offering
the ones it can't produce.

## Seeds

Every card has a seed like `MHGU-5F-N4P3S1R2C3-K7T2NX-9C4A`, shown in the title bar. Paste one back to
rebuild that board.

**The draws are not seeded.** Two people on the same seed get the same twenty-five squares and
completely different luck — which is the point, because the marking is automatic and a shared draw
stream would give everyone an identical game with exactly one possible score.

## Development

Serve `docs/` over HTTP — there is no build step for the app:

```bash
cd docs && python -m http.server
```

The goal catalogue is generated from the vendored data. After updating those files:

```bash
node tools/build-data.js
```

Then run the headless checks — the first verifies that every goal's exact probability matches what the
runtime matcher actually does, the second that a card still finishes in a sane number of draws:

```bash
node scripts/test-roll.mjs
```

```bash
node scripts/simulate.mjs
```

See [CLAUDE.md](CLAUDE.md) for conventions, including the mandatory `?v=` cache-bust bump.

## Credits

The charm roller is ported from [MHGU Charm Farm](https://github.com/armoredraven17/mhgu-charm-farm).
Charm tables, skill names and talisman names come from the MHGU save editor's romfs-derived data. UI
and theming are shared with the
[MHGU Quest Randomizer](https://github.com/armoredraven17/MHGU-Quest-Randomizer) and
[MHGU Bingo](https://github.com/armoredraven17/MHGU-Bingo). Monster Hunter is © Capcom.
