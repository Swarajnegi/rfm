# Corpus — road to the Play Store and App Store

Goal: a paid app that thousands of people use. Order matters — each phase
unblocks the next. Tick items as they land; add the date.

Legend: **[you]** needs you (an account, a payment, a decision, a phone) ·
**[claude]** buildable here · **[both]**

---

## Phase 1 — Free groundwork (now)

- [x] **[claude]** Commit everything since 17 Sept to git, on a branch — `launch-prep` (24 Sept)
- [x] **[claude]** Crash reporting — JavaScript errors from real phones reach us
      (through our own Cloudflare Worker, no third-party SDK, no portfolio data) —
      read them with `npx wrangler tail --config worker/wrangler.toml` (24 Sept).
      Not covered: native Java crashes (those appear in Play Console once live)
- [x] **[claude]** Signed release build (`.aab`) instead of the debug APK —
      `npm run aab` → `corpus-release.aab` (24 Sept)
- [ ] **[you]** Back up the release signing key and its password somewhere safe
      off this laptop — losing it complicates every future update. The two files:
      `android/keystore/corpus-upload.jks` and `android/keystore.properties`
- [x] **[claude]** iPhone web app for family testing: installable to the home
      screen, market data and news through our own Worker instead of public
      relays — live at https://corpus-app.swarajnegi999.workers.dev (24 Sept)
- [ ] **[you]** Install on your Android phone and on dad's / sister's / gf's
      iPhones; use it for a week with real portfolios; report what breaks
- [x] **[claude]** Test in WebKit (the iPhone engine) at iPhone size — `verify-webkit`;
      found and fixed a crash opening Insights and a haptics error (24 Sept)
- [ ] **[claude]** Test on a low-end Android phone profile (small screen, slow CPU)

## Phase 2 — Decide what the product is allowed to say

- [ ] **[you]** One-hour consult with a securities lawyer. The question:
      *"Can a paid app show AI-generated Buy / Hold / Trim calls on specific
      securities without SEBI RIA or RA registration?"*
- [ ] **[both]** Based on the answer, either:
  - reposition the AI to explain evidence without verdicts (remove the
    "Holding by holding" verdicts from the public version), or
  - register / partner with a SEBI-registered adviser
- [ ] **[claude]** Update in-app wording and disclaimers to match the decision

## Phase 3 — Foundations for thousands of users

**Accounts and data**
- [ ] **[claude]** Sign-in: Google (Android), Apple (required on iOS if Google
      is offered), phone OTP
- [ ] **[claude]** Encrypted cloud sync; the app keeps working offline
- [ ] **[claude]** In-app account deletion + a web deletion link (Play requires both)
- [ ] **[you]** Choose the backend (recommendation: Cloudflare — already used
      for the AI gateway)

**AI**
- [ ] **[claude]** Per-user daily AI allowance enforced on the server, by tier
- [ ] **[you]** Switch from free models to paid models with OpenRouter's
      zero-data-retention setting (free models may train on prompts — not
      acceptable for strangers' financial data). Budget ≈ ₹10–15 per Pro user
      per month
- [ ] **[claude]** Lock the gateway to signed-in users

**Data**
- [ ] **[you]** Get quotes for licensed NSE/BSE price data (Yahoo / Nasdaq
      endpoints are not licensed for commercial use). AMFI NAVs stay free
- [ ] **[claude]** Serve government scheme rates from the Worker so a quarterly
      rate change needs no app update (current table expires 30 Sept 2026)
- [ ] **[claude]** Make statement import the main way people start: test the
      CAS parser on many real CAMS / KFintech / NSDL / CDSL statements; add
      broker CSV import

**Privacy (DPDP Act)**
- [ ] **[claude]** Consent screen, privacy policy, terms of use
- [ ] **[you]** Name a grievance contact (email) for the privacy policy

## Phase 4 — Money

- [ ] **[you]** Decide the business entity (sole proprietorship / LLP) and open
      a bank account for Play payouts; ask a CA about GST (threshold ≈ ₹20 lakh)
- [ ] **[both]** Tiers — proposal:

  | Free | Pro (~₹99/mo or ₹799–999/yr) | Family |
  |---|---|---|
  | Unlimited holdings, charts, on-device health score, statement import | Daily brief, AI analysis, alerts, multi-device sync | Pro for you + manage parents' / siblings' portfolios |

- [ ] **[claude]** Google Play Billing for subscriptions (mandatory for digital
      subscriptions; Google keeps 15%)
- [ ] **[claude]** Paywall screens, restore purchases, entitlement checks on the server

## Phase 5 — Play Store launch

- [ ] **[you]** Play Console account (₹2,000 one-off). If it is a **personal**
      account created after Nov 2023: **12 Android testers opted in for 14
      days in a row** before production — line up Android friends early
- [ ] **[claude]** Store listing: screenshots, feature graphic, description
- [ ] **[claude]** Data Safety form, Financial Features declaration, privacy
      policy URL
- [ ] **[claude]** Justification + video for the background (foreground service)
      permission used by the AI job
- [ ] **[claude]** Target the current Play API level; release to closed testing
- [ ] **[you]** Support email, and reply to early reviews

## Phase 6 — App Store

- [ ] **[you]** Apple Developer Program ($99/year)
- [ ] **[you]** A Mac, or a cloud Mac build service
- [ ] **[claude]** iOS build (Capacitor), Sign in with Apple, Apple in-app
      purchase, iOS equivalent of the background AI job
- [ ] **[claude]** App Review submission

---

## Standing risks

- **Free AI allowance:** 50 requests/day across all users until $10 of
  OpenRouter credit has ever been bought (then 1,000/day). Fine for family
  testing, not for launch.
- **Unofficial data endpoints** can break without warning (Nasdaq already did once).
- **Nothing is tested on a physical phone yet** — WebKit and Chromium emulation only.
- **News:** every source is now an Economic Times section feed read by our own
  Worker; rss2json (paid-only `count`, shared-IP limits) and Google News
  (refuses Cloudflare) were measured out on 24 Sept.
