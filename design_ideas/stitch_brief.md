# Corpus — mobile app design brief

Design a premium mobile app called **Corpus**: a private wealth tracker for an Indian investor.
It shows someone everything they own, what it is doing, and what it means for their money. It
never moves money — there is no Send, no Receive, no Pay, no cards, no social feed.

The look is **modern, spacious and tactile** — surfaces with real depth, generous empty space,
confident serif numbers, and one warm accent. Think Apple's visionOS materials with the
typography of a financial newspaper — not a trading terminal.

**Design the Dashboard (§6.1) first and stop there.** Wait for my approval before doing the
rest.

---

## 1. PALETTE

    Background     #061A12     deep lacquer green-black — NOT navy, NOT grey
    Recessed       #03110B     the few sunken areas
    Ink            #F6F9F6     primary text
    Ink soft       #B9C8BF     secondary text
    Ink faint      #94A79B     labels and metadata
    Gold           #BFA05C     the accent — soft antique brass, NOT bright yellow
    Gold bright    #D9BF83     highlights and gradient stops only
    Positive       #3FA47A     numbers that went up
    Negative       #D2705C     numbers that went down

Deep green and soft antique gold only. No navy, purple, teal, lime, violet or neon, and no
bright saturated yellow. Green and red appear **only** on numbers that moved.

**The accent has a budget.** Gold is used for exactly three things: the chart line, the active
navigation item, and the primary button on a screen. Nowhere else — not on borders, not on
dividers, not on section headings, not on icons, not on metadata. An accent used forty times
stops being an accent and the screen looks cheap.

## 2. DEPTH — what "3D" means here, precisely

Every card, tile and sheet should feel like a physical object lit from above. This is the
signature of the app and it should be obvious at a glance. Build it from these:

- **Cards are the SAME COLOUR as the background.** This is the most important rule here. A card
  is not a lighter panel laid on top of the page — it is the page itself, pressed outward. Give
  every card exactly the background fill (`#061A12`), never a lighter one. What separates it from
  the page is only its lit top edge and the shadow beneath it. A lighter fill makes cards look
  pasted on, which is wrong.
- **Two shadows per surface, never one.** A tight contact shadow directly beneath
  (`0 2px 6px rgba(0,0,0,0.45)`) and a wide ambient one (`0 20px 50px rgba(0,0,0,0.40)`). One
  shadow reads flat; two read solid.
- **A lit top edge.** A 1px inset highlight along the top of each surface at about 10% white,
  fading out by the sides. This is what makes an object look lit rather than drawn.
- **Elevation carries meaning**, and it is carried by shadow depth alone, not by fill. The most
  important object on a screen has the widest, softest shadow. A viewer should be able to rank the
  screen by importance with the sound off.
- **Cards respond to touch** — they press down 2px and their shadow tightens.
- **The hero number and the dashboard chart tilt very slightly with the phone**, a few degrees of
  parallax. Subtle, never a gimmick.
- **The bottom navigation bar floats** — translucent, with the content visibly blurred behind it,
  and a strong shadow underneath.
- Holding logos sit on small circular discs with their own soft shadow, as if resting on the card.

**What depth must NOT be:** no bevels, no emboss, no chrome, no glossy plastic highlights, no
hard black offset shadows, no skeuomorphic leather or metal textures, no isometric illustrations,
no 3D-rendered coins or dollar signs. The depth lives in light and shadow on plain surfaces.

## 3. SPACE AND CLUTTER — the rules that outrank everything else

The previous design of this app failed by being dense. These rules win over anything below.

1. **Never put a bordered box inside another bordered box.** Maximum nesting depth is one.
2. **Use no visible borders at all.** Things are separated by elevation, shadow and empty space.
   Where a divider is unavoidable, a 1px line at 10% white.
3. **At most five elements on a screen.** Anything more scrolls off, or becomes its own screen.
   Do not shrink things to make them fit.
4. **13px is the absolute smallest text anywhere.** Use four sizes and no more: hero (~42px),
   title (~22px), body (~16px), label (~13px). Never a wall of 9px labels.
5. The hero number is clearly the most important thing on its screen, but it does not dominate it
   — around 42px, with generous space above and below rather than sheer size doing the work.
6. **32px of space between sections. 20px side gutters. 64px minimum row height.** Nothing
   touches anything.
7. **Invent no words.** Use only the labels written below. No "vault", "enclave", "sovereign",
   "secure", "ledger", no status badges, no financial-year chips, no uppercase letter-spaced
   micro-labels above every section. Text that carries no data gets deleted.

## 4. TYPE AND NUMBERS

- **Set all money figures and all headings in a high-contrast newspaper serif** — the kind of face
  a financial paper sets its market tables in, with real thick-to-thin stroke contrast. Newsreader,
  Tiempos, Source Serif or Georgia are all correct. Use a clean sans **only** for small labels,
  metadata and buttons. The mix of the two is the identity: serif for the money, sans for the
  interface. A single geometric sans throughout looks generic, and that is the thing to avoid.
- **Figures must be tabular** — every digit the same width. The totals count up when they change,
  and a proportional face makes the number jitter and change width.
- **₹ only.** Never $ or €.
- **Indian digit grouping**: ₹48,21,650 — lakh and crore placement, never ₹4,821,650.
- Changes carry a sign: `+₹1,84,230` · `+4.12%` · `−1.70%`.
- Use real Indian instruments in the mockups: HDFC Bank, Reliance Industries, Infosys, Quant
  Small Cap Fund Direct Growth, Parag Parikh Flexi Cap, SBI Fixed Deposit, Sovereign Gold Bond,
  PPF — plus Apple and NVIDIA for the US holdings.

## 5. CHARTS — curved, never angular

Every chart in this app is a **smooth curve**. Interpolate with a monotone cubic spline so the
line flows continuously between points and never shows a sharp corner or a straight segment
between two data points. Specifically:

- A soft gold line, ~2.5px, rounded caps, with a gentle outer glow.
- Beneath it, a gradient fill from gold at about 25% opacity down to fully transparent.
- No gridlines, no axis box, no border, no y-axis labels, no tick marks. The curve floats.
- Dragging along the curve moves a small gold dot and shows that date's value and change in a
  floating label above it.
- **Range selector** as plain text, evenly spaced, the active one in gold:
  - Dashboard: `1W · 1M · 3M · 6M · 1Y · ALL` — starting at 1M. Also design the sparse state, a
    short flat curve with the line `Tracking from today — a trend needs a few days of history`,
    because a new user has almost no history.
  - Individual holdings: `1D · 1W · 1M · 3M · 6M · 1Y · ALL`, starting at 1M.

---

## 6. THE SCREENS

Navigation is a **floating translucent bar with four items**: `Dashboard · Holdings · Planning ·
Insights`. Active item in gold. No centre button, no fifth item, no hamburger.

### 6.1 Dashboard — design this one first, and only this one

Four things, on the deep green background, with a lot of air between them.

1. **The total.** A small `Total corpus` label, then `₹48,21,650` in the serif, around 42px, tabular,
   sitting directly on the background — not inside a card. Under it, on one line:
   `+₹1,84,230 (4.12%)` in green, then `past month` in ink-faint. Below that, small and quiet:
   `Prices updated 12 minutes ago`.
2. **The curve.** The net-worth chart from §5, full width, no frame, with its range selector
   beneath it.
3. **Allocation** — a **single column of wide, short horizontal cards**, about 72px tall, full
   width, with clear gaps between them, each carrying the depth treatment from §2:
   `Indian Equity`, `Mutual Funds`, `US Equity`, `Fixed Deposits`, `Gold`, `Property`.
   Each card holds exactly three things: the group name on the left in the serif, the current
   value on the right, and the percentage change directly beneath the value in green or red.
   **No rupee change amount** — value and percentage only. Six calm lines, not a grid of tiles.
4. **Needs you** — one elevated card, appearing only when something genuinely needs a decision,
   listing at most three items such as `SIP due — Quant Small Cap, ₹10,000` or
   `FD maturing in 9 days`. When there is nothing, the card is absent — it never says "all clear".

Nothing else goes on this screen.

### 6.2 Holdings *(after approval)*

- A row of filter chips: `All`, `Stocks`, `Mutual Funds`, `Deposits`, `US`, `Gold`. Active chip
  filled gold with dark green text. At least 44px tall.
- A **vertical stack of elevated holding cards**, one per holding, with clear gaps between them
  so each reads as a separate object. Each card: a circular logo on a small raised disc, the
  name, one quiet line of detail (`120 units · avg ₹1,450`), and on the right the current value
  with its change beneath.
- A `Refresh prices` action, with a syncing state and a plain result line such as
  `6 refreshed · 1 could not be reached`.
- Empty state: a single calm card, `Nothing here yet`, with `Add a holding` and
  `Import a statement`.

### 6.3 Holding detail — a new screen, opened by tapping any holding

This is where the app should feel most premium.

- A large circular logo on a raised disc, the holding's full name, and its type.
- The current price and today's change.
- Then the **position**, as the hero figure: what it is worth now, with total gain or loss in
  rupees and percent beneath it.
- The **curved price chart** from §5 with the full range set `1D · 1W · 1M · 3M · 6M · 1Y · ALL`.
- Beneath, a small set of facts laid out with plenty of space, no boxes, just label-and-value
  pairs: units held, average cost, amount invested, current value, gain.
- Type-specific facts appear in the same list: a mutual fund adds its NAV, fund house and
  category; a fixed deposit adds its interest rate and maturity date; a US stock adds the USD
  price and the exchange rate used.
- `Edit` and `Delete` at the bottom.

### 6.4 Planning — restructured, because the current version is hard to navigate *(after approval)*

**Remove the tab bar.** The old design hid seven different topics behind four tabs, which is
why it felt messy. Replace it with a hub: one screen that shows every area and its key number at
once, where each area opens into its own full screen.

- At the top, the hero figure: `₹1,43,000` labelled `Left over each month`.
- Below it, **six large elevated cards, one per area, stacked with generous gaps**. Each card
  shows its name, its single most important number, and one short line of status:
  - **Cashflow** — `₹2,85,000 in · ₹1,42,000 out`
  - **Goals** — `3 active · ₹18,50,000 target`
  - **Emergency fund** — `8.5 months covered`
  - **Tax** — `₹48,600 payable · New regime`
  - **Pension** — `₹5,000 a month`
  - **Assets & debts** — `₹12,40,000 outside your holdings`

Each card opens a full screen:

- **Cashflow** — money coming in and money going out as two plain lists, then
  `Recurring contributions`: each one showing its name, amount and date. One that is due shows
  `Confirm` and `Skip` buttons inline, so nothing is ever bought automatically.
- **Goals** — one card per goal: name, target amount, amount saved, a smooth progress arc, and
  the target date. Plus adding a new goal.
- **Emergency fund** — months of expenses covered, shown as a large figure with a progress arc,
  and the monthly expense figure it is measured against.
- **Tax** — Indian income tax, laid out as a sequence of calm sections, one decision each:
  `Which regime` — two large selectable cards, `Old regime` and `New regime`, showing the tax
  payable under each so the cheaper one is obvious, with the chosen one marked in gold.
  `What you are taxed on` — salary, other income, deposit interest, rent.
  `Anything you sold` — realised long-term and short-term equity gains.
  `What you can deduct` — 80C, 80D, 80TTA/80TTB and the standard deduction, where the fields
  shown change when a `Senior citizen` toggle is switched on.
- **Pension** — monthly contribution and projected corpus.
- **Assets & debts** — `Outside your holdings`: bank balance, cash, property.
  `What you owe`: credit card, loans, other liabilities.

### 6.5 Insights *(after approval)*

Three things, nothing else:

1. **Portfolio health** — a score out of 100 as a large figure inside a smooth circular progress
   arc, a one-line verdict, and beneath it a few plain lines of strengths and things to improve.
2. **Coming up** — a short list of dated amounts that will move on their own, signed and coloured.
3. **The AI console** — described in §7. It is the hero of this screen; everything above it must
   be visually plainer so it stands out.

Below these, quiet entries for `Backup & restore` and `AI settings` (a masked API key field, a
choice of provider between Auto-detect, Google Gemini, OpenRouter and OpenAI, and save/remove).

### 6.6 Bottom sheets

All input rises from the bottom edge with large rounded top corners, a grab handle, and the
content behind it dimmed and blurred: add or edit a holding, add or edit a goal, add or edit a
recurring contribution, notifications, and the AI key. Fields sit on a raised surface with a soft
inner shadow, and the focused field is outlined in gold. Choosing a type uses a wrapping row of
chips with the selected one filled gold.

---

## 7. THE AI CONSOLE — one component that must be kept exactly

This already exists in the app and the owner wants it unchanged. It is the single richest object
in the product.

- A deep navy panel, `linear-gradient(160deg, #16294A 0%, #0B182E 58%)`, with a soft radial gold
  glow near its top-right corner at about 22% opacity, fading out by two-thirds across.
- A hairline gold gradient rule along its top edge, fading to transparent at both ends.
- The strongest elevation on its screen — the object that is closest to the viewer.
- A **56px animated mark** at the top left: an **aperture, not a robot face**. Two concentric
  gold rings drawn with dashed strokes, rotating slowly at different speeds, around a lit gold
  core with a soft glow, with one small dot travelling the outer ring. It should read as
  something *looking at* your position.
- Title: `Ask an AI to read your position`.
- One line of body text explaining that the user connects their own API key and it never leaves
  the device.
- A full-width button with a gold gradient (`#E6D08A` → `#C9A227`) and dark navy text:
  `Connect a key`, becoming `Read my position` once a key is saved.
- A working state showing a progress message and a thin indeterminate gold bar.
- A finished state: a `Re-run` link, then up to four plain rows of a short title and a sentence
  of reasoning, closing with one small line — *Educational only. Not investment advice.*

---

## 8. SUMMARY OF WHAT SUCCESS LOOKS LIKE

A person opens the app and immediately sees one confident serif number and a flowing gold curve on
deep lacquer green, with cards that look pressed out of the page rather than stuck onto it. They can tell in one second what
they are worth and whether it went up. Nothing is crowded, nothing is boxed inside a box, no text
is tiny, and gold appears only where it means something.
