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
| **Combo** | Attack, 2+ slots · Evasion, a positive 2nd skill · A cursed charm |

Squares are filtered so a card stays winnable. Nothing hopeless is ever put on a board, and only a
small budget per card — one square on a 5×5 — is allowed to be a real grind. The odds behind that
filtering are never shown: not knowing which square will break first is the point.

## Roll tiers

Charms come off four tables: mystery rolls the junk, enduring rolls Hero, Legend and Creator
talismans. The mix is fixed and junk-heavy — the shape of a real charm run.

It matters more than it looks, but not in the way you'd expect: it decides *which squares can exist*
rather than how long a card takes. A mystery talisman never carries a second skill and never reaches
two slots, so those conditions are simply rarer, and the app never offers one it can't produce.

## Seeds and sessions

A seed is in two halves — `MHGU-5F-N4P3S1R2C3-EYBKVK` is the **session**, and the trailing
`-DCK0-HMGF` is your card.

The session fixes the pruned skill pool *and* the whole sequence of talismans, so everyone on it
draws the same charms in the same order. The card half is per player, because shared calls with an
identical board would have everyone calling BINGO on the same draw.

One person is the Gamemaster and draws; everyone else joins the session and their card follows
along, catching up on anything called before they arrived. Lose the connection and the session alone
still determines every talisman, so play carries on by ear.

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
