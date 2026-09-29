# Corpus — Design System (MASTER)

> **Current: monochrome with a gold budget ("-latest" screens, 24 Sept 2026).**
> Supersedes the brass-everywhere table below: gold was on every icon, button
> and selection, which cheapened it. Dark gold `#C9A227` now appears in exactly
> three places, and the checker counts it on every screen:
> 1. the Overview "Portfolio over time" chart (line, fill, end dot, the corpus figure);
> 2. the Gold asset class (its allocation slice and dot, the Gold holding row's mark);
> 3. the AI card (fixed navy + gold, unchanged).
>
> Everything else is neutral: primary button `#FAFAFA` / label `#131313`
> (17.8:1); selected = 2px `#FAFAFA` edge + white 6% tint; icons `#A3A3A3`
> (7.75:1 on `#0C0C0C`); links `#FAFAFA` 600 underlined; progress `#FAFAFA` on
> `#333333`; money-out bar `#737373` (3.52:1; `#525252` failed at 2.13:1);
> holding-detail chart white. Gain/loss tags and the neutral graphite surfaces
> below are unchanged. The Stitch design system's primary token is neutral
> `#E5E5E5`, so any default `primary` class can no longer turn something gold.

> **Current direction: Graphite & Brass (24 Sept 2026)** — Stitch project
> "Corpus — Graphite & Brass" (8401258699115570318). It supersedes the blue
> palette further down; typography, type scale, spacing, motion, icons and
> structure below still apply unchanged.
>
> | Role | Hex | Measured |
> |---|---|---|
> | Ground (neutral graphite) | `#131313` | — |
> | Card / secondary | `#1E1E1E` + 1px `#2E2E2E` edge | — |
> | Inset / field | `#0C0C0C` | — |
> | Divider (decorative) | `#333333` | — |
> | Field / control edge | `#737373` | 3.52:1 on card |
> | Text / muted | `#FAFAFA` / `#A3A3A3` | 15.97 / 6.61:1 on card |
> | Primary button (brass) | `#A8883A`, label `#131313` | 5.53:1 |
> | Gold accent (selected, chart, progress, active nav) | `#C9A227` | 6.89:1 on card |
> | Brass text / links | `#D4B46A` | 8.36:1 on card |
> | Gain / loss | tags filled `#166534` / `#7F1D1D`, text `#FAFAFA`, sign + arrow | 6.83 / 9.60:1 |
>
> - **Greys are neutral on purpose.** The skill's Luxury palette is warm stone
>   (`#1C1917`, `#292524`…) and read as brown on screen; rejected by the owner.
> - **Gain and loss are fills, not text.** Dark green `#166534` and maroon
>   `#7F1D1D` measure 2.13:1 and 1.51:1 as text on the card — unreadable — so
>   they are used as tag backgrounds under near-white figures instead of being
>   lightened into the light green / bright red the owner rejected.
> - **The AI card is the one fixed-palette exception** and is the app's own
>   card copied from `src/corpus.css` (`.sheet--ai`, `.aimark*`) and
>   `web/index.html`: navy `#16294A → #0B182E`, gold `#C9A227` / `#E6D08A`,
>   Newsreader title, the aperture mark (rings 18s and 11s reverse, orbit 7s,
>   reduced-motion stop). Only change: its 13px text is raised to 14px.

Generated with the **UI/UX Pro Max** skill (`.claude/skills/ui-ux-pro-max`,
commit dcc40ff), then verified. Page-specific overrides go in `pages/`.
Every choice below names the skill database entry it came from; every
departure from the skill's output is listed at the end with its measurement.

## Product (skill: products.csv)
- **Personal Finance Tracker** — primary style *Glassmorphism + Dark Mode
  (OLED)*, secondary *Minimalism & Swiss*, palette focus "calm blue + success
  green + alert red + chart accents".
- **Financial Dashboard** — *Dark Mode (OLED) + Data-Dense Dashboard*,
  secondary *Accessible & Ethical*.
- Audience: Indian households, from a 26-year-old stock investor to a
  64-year-old retiree on SCSS, post office MIS, FDs and gold. Mobile first.

## Style
- **Base: Dark Mode (OLED)** (styles.csv) — deep slate, high contrast,
  low emission, "eye-friendly, high readability, visible focus".
- **With: Accessible & Ethical** (styles.csv) — "large audience", measured
  high-contrast pairs (4.5:1 minimum, 7:1 target), 16px+ body text, 3–4px
  focus rings, 44×44px targets, reduced motion.
- **Glass: one place only** — the AI reading card may use a frosted surface.
  The skill rates Glassmorphism's accessibility *conditional* (contrast
  depends on what is behind the glass), so it is not used for data.

## Colour (skill: colors.csv → "Personal Finance Tracker")
| Role | Hex | Use |
|---|---|---|
| Background | `#0F172A` | app ground |
| Card | `#192134` | raised surfaces |
| Muted surface | `#101A34` | inset fields, chips |
| Foreground | `#FFFFFF` | primary text (17.9:1 on ground, 16.1:1 on card) |
| Muted text | `#94A3B8` | captions, metadata only (7.0:1 ground / 6.3:1 card) |
| Primary | `#1E40AF` | primary button FILL, white label (8.7:1) |
| Secondary | `#3B82F6` | chart line, selected states (fills) |
| Accent / gain fill | `#059669` | positive fills, black label (5.6:1) |
| Destructive fill | `#DC2626` | destructive button fill, white label |
| Border | `rgba(255,255,255,0.08)` → `#334155` for inputs | dividers / field edges |
| **Gain text** | `#34D399` | *departure — see below* (8.4:1 on card) |
| **Loss text** | `#F87171` | *departure — see below* (5.8:1 on card) |
| **Link / action text** | `#60A5FA` | *departure — see below* (6.3:1 on card) |

Gain and loss are never colour alone: always a sign (+/−) and an arrow
glyph (▲ ▼ as icons), and the word where space allows.

## Typography (skill: typography.csv → "Financial Trust")
- **IBM Plex Sans** for everything — "financial, trustworthy, professional…
  Banks, finance, insurance, investment, fintech. Excellent for data."
- Figures use tabular numerals so columns and changing totals do not jitter.
- Scale (px / line-height / weight): display 34/40/600 (the corpus total) ·
  title 22/28/600 · heading 18/24/600 · body 16/24/400 · label 14/20/500 ·
  caption 14/20/400. Nothing below 14px (skill: 16px+ body; captions 14).
- Money in Indian grouping: ₹1,54,20,000 / ₹15.4 L / ₹1.54 Cr.

## Space, shape, motion
- Density 5/10 (standard): 4/8 rhythm, section gaps 16 / 24 / 32.
- Radius 12 on cards and sheets, 10 on buttons and fields, full on chips.
- Motion 3/10 (subtle): 150–250ms, opacity/translate only; honour
  reduced motion.
- Icons: one outline family (Material Symbols Outlined), 24px, no emoji.
- Touch targets ≥ 48dp (Android) / 44pt (iOS).

## Structure (the app's, not the skill's)
Bottom navigation, four destinations: **Overview · Holdings · Planning ·
Insights**. The skill's "pattern" output (landing-page sections) does not
apply to an app and is not used.

## Departures from the skill's output, with reasons
1. **Gain, loss and link text are lighter shades of the skill's hues.**
   Measured as text on the skill's own card `#192134`: primary `#1E40AF`
   2.05:1, green `#059669` 4.26:1, red `#DC2626` 3.32:1, blue `#3B82F6`
   4.36:1 — all below the 4.5:1 minimum the skill itself requires. Same
   hue families, lightened: `#34D399` 8.35:1, `#F87171` 5.80:1, `#60A5FA`
   6.31:1. The original shades stay as fills.
2. **Typography is the "Financial Trust" pairing, not the generator's.**
   `--design-system` returned Caveat + Quicksand ("handwritten… personal
   blogs, invitations", matched on the word *personal*) and, on a narrower
   retry, Playfair Display + Source Serif 4 ("luxury fashion, editorial").
   Neither suits figures read at a glance by a retiree; the targeted
   typography search returned IBM Plex Sans for finance.
3. **Pattern ignored** — both generator runs returned landing-page patterns
   ("Product Demo + Features", "Enterprise Gateway").
