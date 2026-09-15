# RFM — Personal Finance Manager

A private, offline-first portfolio manager for Indian investors. Tracks fixed
deposits, bonds, government schemes, mutual funds, Indian and US equities, gold,
EPF and property in one place; values them from live sources; and tells you what
tax you owe under both regimes.

**Simple decisions. Secure future.**

---

## What makes it different

**Every figure can say where it came from and when.** Provenance is a column,
not a tooltip. A stale quote is labelled stale, a partial sync shows which
holdings failed, and a value that could not be refreshed keeps its last verified
figure with its timestamp. The app never invents a price, a chart point or a
quote time.

**It works with no network.** Everything needed to render is on the device —
no CDN, no account, no server. Your portfolio never leaves the phone.

---

## Running it

```bash
npm install
npm run build          # CSS + vendor bundle + Capacitor bridge
```

Then open `web/index.html` in any browser, or build the Android app:

```bash
npx cap sync android
cd android && ./gradlew assembleDebug
```

### Verifying

```bash
npm run verify         # boots the app in headless Chromium with the network cut
npm run verify -- --seed   # same, against a populated portfolio
```

The harness aborts every non-`file://` request and asserts that the app still
renders: no remote asset requests, Alpine started and `x-cloak` stripped,
Tailwind emitting real utilities, the subset icon font loaded, exactly one page
visible and a clean console. It distinguishes *asset* requests (must be zero)
from *live-data* requests (quotes and FX, expected to be attempted and to fail
gracefully), so it cannot be satisfied by an app that merely fetches less.

---

## How it is built

| Layer | Choice |
|---|---|
| Shell | Capacitor 8 → Android. Biometric lock, local notifications, native HTTP |
| UI | Alpine.js, Tailwind (compiled at build time, not the CDN play build) |
| Motion | GSAP (+ Flip, SplitText), View Transitions API, AutoAnimate |
| Numbers | NumberFlow with `en-IN` locale — lakh–crore 2,2,3 grouping |
| Charts | TradingView Lightweight Charts |
| Tutorial | Driver.js |
| PDF | pdf.js, worker vendored locally for offline CAS/statement parsing |
| Storage | `localStorage`, single JSON blob. No account, no cloud |

All dependencies are free and permissively licensed. Nothing here requires a
paid tier.

### Source layout

```
src/         build inputs — vendor bundle, Capacitor bridge, Tailwind entry
web/         what actually ships (Capacitor webDir)
scripts/     verification harness + seed fixture
android/     Capacitor Android project
docs/        architecture notes; docs/legacy holds retired shells
```

Build outputs (`web/vendor.js`, `web/tailwind.css`, `web/boot.js`,
`web/plugins.js`, `web/fonts/`) are committed deliberately so a clone can be
synced to Android without a build step.

---

## Data sources

AMFI (mutual fund NAVs), Yahoo Finance (NSE and US quotes), CAMS/KFintech CAS
and bank statement PDFs, and public FX endpoints for USD→INR. Market data is
requested directly by the client; there is no backend.

---

## Status and limits

- Tax calculations are **indicative only**. Not a substitute for a professional.
- Insights are **educational decision support**, not regulated financial advice.
  Anything that warrants it should go to a SEBI-registered adviser.
- Data lives on one device. Use the backup export before changing phones —
  a restore covers the portfolio, valuation history and preferences, but
  deliberately excludes API keys.

## Licence

MIT. See [LICENSE](LICENSE).
