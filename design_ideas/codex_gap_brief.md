# Corpus — gaps between the approved Stitch designs and the shipped app

Written for an agent with access to the Stitch project **`3314503033916534356`**
("Corpus Wealth Tracker Latest") and to this repo.

Every "app today" value below was **measured** in a real browser at 390×844 in dark
theme, not read from the source. Where a number is given, it is the computed value.

Approved screens on the Stitch canvas (some sit far below the main cluster — use
zoom-to-fit; `Dashboard v2 fixed` is at y 8923 and `Dashboard — Light` at y 11093):

| Screen | Status |
|---|---|
| `Dashboard v2 fixed` | approved — the reference for the home screen |
| `Insights v2` | approved |
| `Planning` (the 2142px-tall frame) | approved |
| `Planning — Cashflow, Goals, Emergency` | approved |
| `Planning — Tax, Pension, Assets` | approved |
| `Holdings`, `Holding Detail`, `Holdings States & Fact Variations` | approved |
| `Holdings — Maturities and Import` | approved |
| `Bottom sheets` | approved |
| `Dashboard — Light` | approved — the light-theme reference |
| `Corpus Adaptive Launcher Icon` | already shipped into the Android build |

---

## READ THIS FIRST — five decisions that are deliberate, do not "fix" them

1. **The AI console stays navy-and-gold in BOTH themes.** Its colours are hardcoded
   in `.sheet--ai` and independent of the theme on purpose. `corpus.css` says why:
   *"a 'console' that changes its identity between light and dark would just be
   another panel."* In light mode it gets a heavier shadow (`--ai-cast`) so it reads
   as a slab on the page rather than a hole punched through it.

2. **There is no price chart on the Holding Detail screen**, and the mockup's chart
   must NOT be reproduced. The app stores one net-worth snapshot per day and no
   per-instrument price series at all, so a chart there would have nothing to plot.
   Building one means building history collection first — see "Known-missing data".

3. **Chart ranges differ per instrument and that is correct.** A mutual fund offers
   no `1D` (AMFI publishes one NAV a day). A deposit offers no chart at all (it
   accrues at a contracted rate; it is not quoted). `chartRangesFor()` decides this
   on whether a **price source** exists (`ticker || schemeCode`), not on the type
   name — because `Other` and `Real Estate` slip through a type-name test.

4. **"Needs you" was merged into "Coming up" on the Dashboard, not deleted.**
   `attentionItems` is a to-do list, not a calendar: only 2 of its 5 categories are
   dated. One of them is the SIP confirmation, and nothing in this app is ever
   bought automatically — an unconfirmed SIP silently does not happen. The card
   shows dated movements, then a rule, then the undated items that need a decision.

5. **The card material is `--card-*` tokens in `corpus.css`, and the dark/light
   asymmetry is intentional.** Light draws no bottom edge because a shadow has room
   to darken; dark MUST draw one (`--card-under: rgb(0 0 0 / 0.70)`) because a
   shadow onto `#061A12` has nothing left to darken. Do not "simplify" these to
   match each other.

---

## THE GAPS

### 1. Chart line colour — WRONG, and the most visible gap

| | |
|---|---|
| Design | a single soft gold line, `#BFA05C`, always |
| App today | `--jade` `#3FA47A` (green) when the range is up, `--carnelian` `#D2705C` (red) when down |
| Where | `web/app.js:658` — `const stroke = rising ? this._token('--jade', …) : this._token('--carnelian', …)` |

Fix: the stroke and its area fill are always `--brass`. Keep green/red for the
delta **text** under the hero figure; only the line changes. In light theme the
brass token is already darkened to `#7E6524`, so `var(--brass)` is correct in both.

### 2. Allocation — one sheet of rows vs six cards

| | |
|---|---|
| Design | six separate elevated cards, ~72px tall, 16px apart; each holds only name, value, % change |
| App today | 5 rows inside **one** `.sheet`, each with an `.alloc__bar` hairline showing share of total, plus a `Total` row |
| Where | `web/index.html`, the "Holdings" section of `main[x-show*=home]` |

Fix: emit one `.sheet` per `allocationRows` entry. Drop `.alloc__bar` and the
`row--total` row (the hero figure above already states the total). Note the app
renders **5** groups where the design drew 6 — `allocationRows` is derived from
actual holdings, so a group with nothing in it is correctly absent. Do not
hard-code six.

### 3. Holdings list — grouped sheets vs flat cards

| | |
|---|---|
| Design | one flat list; each holding is its own elevated card ~88px tall |
| App today | rows inside **4 per-asset-class `.sheet` groups**, each with a class heading and subtotal; row height **116px** |
| Where | `web/index.html`, `groupedHoldings` loop |

Decide with the owner before changing: the grouping carries real information (a
per-class subtotal) that the design drops. If the design wins, use `visibleHoldings`
instead of `groupedHoldings` and emit one `.sheet` per holding.

### 4. Logo discs — wrong shape and size

| | |
|---|---|
| Design | 40px **circular** disc in lists, 64px circular on Holding Detail, each with its own soft shadow |
| App today | `.mark` is **34×34px, border-radius 10px** (a rounded square), no shadow. `.mark--lg` is **56px, radius 16px** |
| Where | `src/corpus.css` `.mark` and `.mark--lg` |

Fix: `border-radius: 50%`, sizes 40px / 64px, and give each disc `--card-cast`'s
contact shadow so it rests on the card.

### 5. Bottom navigation — not a floating pill

| | |
|---|---|
| Design | a floating **true pill**: corner radius = half its height, inset 24px from the screen edges, translucent with a blurred backdrop |
| App today | `border-radius: 0px`, **full width 390px**, height 71px, `position: fixed`, flush to the screen edges. Background and blur are already right (`rgba(6,26,18,0.92)`, `blur(20px) saturate(1.4)`) |
| Where | `src/corpus.css` `.dock` |

Fix: inset it (`left/right: 24px; bottom: 24px`), `border-radius: 9999px`, and add
`--card-cast`. Body padding-bottom is currently **92px** and will need raising to
clear the now-floating bar (roughly dock height + 24 inset + 24 breathing room).

### 6. The `--skin` token is defined but used nowhere

| | |
|---|---|
| Design | `#F2ECE3` warm off-white for the wordmark, the page label, all four dock icons, the avatar outline and the active dock item. On light it has no role and resolves to ink |
| App today | `--skin` exists in all three theme blocks and has **zero** `var(--skin)` readers. The active dock item is `#F6F9F6` (ink), not skin |
| Where | `src/corpus.css` — token present, unused |

Fix: apply it to the wordmark, page label, dock icons/labels and avatar. This is a
pure token-plumbing job.

### 7. App bar — wrong contents

| | |
|---|---|
| Design | `Corpus` on the left; on the right, grouped 12px apart, an uppercase page label (`DASHBOARD`, `HOLDINGS`, …) and a circular avatar outline |
| App today | `.appbar` renders `Corpus | ₹14,65,867 | sync | notifications` — a live total, a sync button and a notifications bell. No page label, no avatar |
| Where | `web/index.html` top of file, `.titleslot` |

Decide with the owner: the live total and the sync button are useful and the design
drops them. At minimum add the page label and group it with whatever sits at the
right-hand end, per `Dashboard v2 fixed`.

### 8. Planning hub — one sheet of rows vs six cards

| | |
|---|---|
| Design | six separate elevated cards |
| App today | six rows inside one `.sheet`, driven by the `planningAreas` getter |

This was a **deliberate deviation**: six near-identical slabs 32px apart is ~700px
of scrolling to read six numbers, and the point of the screen is seeing all of it
at once. Change only if the owner asks. The data is already correct and asserted.

### 9. Holdings filter chips — labels and one missing filter

| | |
|---|---|
| Design | `All · Stocks · Mutual Funds · Deposits · US · Gold` |
| App today | `Overall · Stocks · Mutual funds · Deposits and bonds · Gold · Property` |

Two differences: the app says "Overall" not "All" and "Deposits and bonds" not
"Deposits", and it has **no `US` filter** while having a `Property` one the design
lacks. `HOLDING_CLASSES` in `web/app.js` is the single source — a US filter needs a
new class, since US equity currently falls under `equity`.

### 10. Holding Detail — spacing and mark size

The screen exists and works (facts list adapts per instrument type, deposits get a
tenure track instead of a chart). Remaining cosmetic gaps: the mark is 56px rounded
where the design has 64px circular, and the design's facts list has more air
between pairs than `.row` currently gives.

---

## ALREADY MATCHING — do not redo these

- Hero figure: **42.9px Newsreader weight 600, letter-spacing −0.015em** at 390px.
- Dock labels: **13px**. Nothing anywhere below 13px.
- Bottom sheets: **24px top radius**, grab handle present, fields recessed into
  `#03110B`.
- Card material: same-fill slab, lit top edge that fades at the corners, drawn
  undercut on dark, dual shadows, 16px between cards, 32px between sections.
- AI console at the top of Insights; health card relabelled *"Measured from your
  own numbers"*.
- "Coming up" on the Dashboard with inline Confirm/Skip.
- Chart ranges `1W 1M 3M 6M 1Y ALL`, each verified to narrow the series.
- Launcher icon: Newsreader C, `#BFA05C` on `#061A12`, all 15 mipmap PNGs.

---

## KNOWN-MISSING DATA (not a styling gap)

**No per-holding price history exists.** `nwHistory` stores one net-worth snapshot
per calendar day (730-day retention) and nothing records a per-instrument series.
Until something does, the Holding Detail screen cannot show a price chart, and
`chartRangesFor()` describes what each instrument *could* offer once one exists.

A second limitation worth knowing: snapshots are only written **while the app is
open**. Skip a week and those days have no point; the line joins across the gap.

---

## CONSTRAINTS ON ANY CHANGE

1. `npm run verify` must stay green — 12 suites. `node scripts/audit-polish.mjs`
   must print `CLEAN`.
2. `verify-align.mjs` measures each text edge against **its own container**. New
   padding inside a card is fine; a stray indent is not.
3. `verify-figures.mjs` asserts the Planning hub's figures match the pages they
   open, and that every chart range narrows the series. If you change
   `planningAreas` or the range map, those assertions must still pass.
4. Nothing below **13px**, and every tappable target at least **44×44px**.
5. `npm run apk` opens the built package and hashes it against `web/`. A build that
   does not match is refused. Do not bypass it.
6. Do not leave a comment that contradicts the line beneath it — this repo has been
   bitten by that twice, and both are recorded in `rfm_remaining_phases.md`.
