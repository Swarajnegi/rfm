# Corpus

A portfolio app with a planned paid AI companion that understands the user's finances over time and researches suitable investment options.

**Status — 14 October 2026:** existing single-device prototype; product investigations come before rebuilding the UI or application. The first development stage is a private prototype. Public launch has no deadline and remains subject to demand validation, data permissions, regulatory requirements and release checks. Android/runtime readiness is unverified.

## Product direction

Corpus should bring together investments with minimal upkeep and help users plan with their portfolio, goals, financial circumstances, risk profile, planned budget and actual spending history in context. The AI should research current markets, news, government policies, inflation, schemes and investment fundamentals, then explain suitable options, their evidence, assumptions and risks. Wealth growth is not guaranteed.

The eventual audience spans ages and backgrounds; the initial discovery segment is Indian investors using several providers. Begin with one person's portfolio; family portfolios come later. A short initial profile should lead to gradual learning from authorised data and user corrections, with a few purposeful follow-up questions. Ask what the user wants help with before generating a plan or review.

User-facing functionality comes from the app and AI; a hired-adviser service is outside the chosen product model. This delivery choice does not establish regulatory exemption or permission to access financial data. The full personalised recommendation scope is being investigated. Paid AI is the commercial direction; prices, free features and service limits are undecided.

- [Product plan, investigation tracker, gates and backlog](docs/product-plan.md) — current source of direction and next action.
- [Decision history](docs/decisions.md) — accepted, superseded and deferred choices.
- [Eligibility and recommendation investigation](docs/investigations/INV-002-eligibility-and-boundaries.md) — sole active investigation.
- [Architecture and readiness notes](docs/enterprise-readiness.md) — options to assess, not an approved architecture.

## What the current prototype contains

Source inspection shows holdings and valuation screens, price/NAV refresh, cash-flow and budget records, goals, emergency-fund and pension screens, maturity alerts, indicative tax estimates, PDF statement parsing, JSON backup/restore and optional remote AI insights. Feature presence does not establish accuracy, reliability or release readiness.

The current AI uses a financial snapshot and RSS news titles. It does not establish the planned deep research, suitability, ongoing learning or recommendation quality. Existing MF normalisation creates empty transaction arrays; full-history import is unverified. The committed APK predates the September Corpus redesign.

Automatic MFCentral, Groww, INDmoney, EPF, bank, Gmail or SMS access is not promised. Each provider investigation must separately establish holding discovery, transaction updates and price refresh, with permitted rights, cost, coverage and an explicitly accepted fallback.

## Setup and development

From the Corpus repository root, install Node.js/npm and the Android SDK/JDK appropriate to the checked-in Android project when building Android.

```powershell
npm install
npm run build
```

For browser inspection, serve the `web/` directory using a local static server, or open `web/index.html` for the file-based prototype. Native-only functions require Android. These instructions are not a record of a successful build.

For Android, from the repository root:

```powershell
npx cap sync android
Set-Location android
.\gradlew.bat assembleDebug
```

The existing application verification command is `npm run verify`. It runs route, sheet, motion, sync, typeahead, typography, alignment, icon, polish and seeded/unseeded offline checks. It is separate from Android compilation and device validation. No application checks or Android build were run for this documentation update.

## Current technical baseline

| Area | Current implementation |
|---|---|
| Android shell | Capacitor 8; app ID `com.swarajnegi.corpus`; `web/` is the packaged web directory |
| UI and styles | Alpine.js; custom `src/corpus.css` combined with Driver.js styles into `web/corpus.css` |
| Assets | Local vendor/boot/Capacitor bundles, fonts and PDF.js worker |
| Interaction | GSAP, AutoAnimate, NumberFlow and Driver.js |
| Charts and parsing | Lightweight Charts and PDF.js |
| Storage | Browser/device localStorage; current portfolio key `rfm_v1`; no verified deployed account/sync backend |
| Optional AI | Client requests to configured remote AI providers; configuration and responses stored locally |

`src/` holds build inputs; `web/` holds the live client and committed generated assets; `scripts/` contains existing verification tooling; `android/` is the native project; `docs/` holds the product records and explicitly archived material. Dependency upgrades and generated assets are outside this documentation change.

## Data, privacy and limitations

Local assets support offline rendering; network access is needed for fresh external data and remote AI. Market-data requests go to external services. If remote AI is enabled, portfolio/planning input is sent to the selected provider. The statement that portfolio data never leaves the phone would therefore be inaccurate. Current prototype API-key storage in localStorage is a limitation to assess, not an approved public-product design.

The client contains AMFI/MFapi NAV, market-quote and FX routes and statement parsing. Their presence does not establish commercial reuse rights, availability, complete holdings or transaction history. Keep stale/incomplete data visible; do not infer transactions from price changes.

Tax estimates are unverified and indicative. Current AI output and the planned recommendation service require correctness and scope assessment; a disclaimer alone does not establish permission. Export a backup before changing devices; evaluate recovery, data retention, consent withdrawal and deletion in the architecture investigation. Do not commit statements, credentials or identifying financial records.

## Licence

MIT. See [LICENSE](LICENSE).
