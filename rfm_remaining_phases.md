# Corpus — development handoff

> **Read [README.md](README.md) first for the stack and how to build.** This file deliberately
> does not repeat it. The previous version of this document did, and every line of that copy
> went stale: it described Tailwind-via-CDN, Chart.js, Inter/Outfit and an app id of
> `com.rajendernegi.rfm`, none of which had been true since July. Two descriptions of one
> system is how that happens, so there is now one.

**The app is called Corpus.** `RFM` survives as the repo name, the `rfm_v1` localStorage key and
the `RFM*` globals. Renaming those is not worth a migration.

---

## Where it stands

Phases 1–13 are shipped and in use: the core engine, the senior-citizen tax engine and ITR
checklist, the Capacitor Android shell, the PDF statement parser, capital gains, backup and
restore, equity valuation, the SIP scheduler, live AMFI NAV and Yahoo quote ingestion, native
notifications and the LLM statement classifier. The Stitch dark theme they were built against
has since been replaced entirely by the Corpus design system in `src/corpus.css`.

**Verification is the load-bearing part of this repo.** `npm run verify` runs twelve headless
suites with the network cut. Treat a red suite as a stop-the-line event — several of the faults
listed under *History* below were invisible in every screenshot and were only ever going to be
caught by measurement.

---

## Known limits — honest list

| Limit | Detail |
|---|---|
| **Icon subset must be re-vendored when icons change** | `npm run fonts` fetches a subset of exactly the glyphs in use (34 today, 53 KB) and records them in `web/fonts.css`. `icon-names.mjs --check` then fails the build if the markup uses one the subset lacks — such an icon renders as its NAME in capitals, which has shipped twice. The fetch needs `fonts.googleapis.com`; everything else builds offline. |
| **PDF import is untested** | `verify-figures.mjs` says so in its own header. The parsers in `web/parser.js` have no fixtures, so every change to them is unverified. Real CAS/Groww/bank PDFs cannot be committed; synthetic text fixtures could be. |
| **Logo coverage is partial, by design** | NSE listings and US symbols resolve; funds borrow their AMC's logo and only unambiguous AMCs are mapped. "Tata" resolves to Tata Motors, a different company, so Tata funds show the monogram. A wrong logo is worse than none. |
| **Browser quotes depend on a public relay** | See *Quote transport* below. The Android build does not. |
| **No 80+ band** | The old regime models below-60 and 60–79. The ₹5L super-senior exemption is not applied because there is no control that asks. |
| **Capital gains are entered, not derived** | Deliberate. Nothing in the data model records a disposal, so a gain cannot be computed — see *History*. A real fix is a transactions ledger, which is the Phase 2 item in [docs/enterprise-readiness.md](docs/enterprise-readiness.md). |
| **Single device** | No account, no sync, no recovery. The backup file is the only way to move. [docs/enterprise-readiness.md](docs/enterprise-readiness.md) holds the plan if that ever changes. |

---

## Building the APK

    npm run apk          # -> rfm-app.apk at the repo root, installable
    npm run apk -- --release
    adb install -r rfm-app.apk

One command because it is four ordered steps, and doing them by hand fails quietly:
`cap sync` only COPIES `web/` into the Android project, so skipping `npm run build`
first ships the previous vendor bundle inside a fresh-looking APK.

`scripts/build-apk.mjs` locates a JDK 21 itself rather than trusting `JAVA_HOME`.
On this machine `java` on PATH was 21 while `JAVA_HOME` still pointed at an 11
install, and Gradle reads `JAVA_HOME` — the resulting class-version error says
nothing about which variable is wrong. Nothing outside the build process is changed.

**It then OPENS the APK and checks it, because an exit code is not evidence.**
Gradle reported `BUILD SUCCESSFUL` with an asset merge that was up to date against an
*earlier* `cap sync`, and shipped an APK containing no `assets/native-bridge.js`, no
`capacitor.config.json` and no `capacitor.plugins.json`. `native-bridge.js` is what
defines `Capacitor.nativePromise`, so on the device **every plugin call failed** —
`e.nativePromise is not a function`, on every holding, with the sync panel reporting
"0 refreshed, 6 could not be reached". Nothing was wrong with the web layer, and no
test of it could have found this: the defect was entirely in what got packaged.

The script now verifies the bridge is present and that each packaged file under
`assets/public/` hashes equal to its counterpart in `web/`. If either fails it forces
`gradlew clean` and re-checks, and exits non-zero rather than hand over a bad build.
**If a device ever reports `nativePromise is not a function`, the APK is the suspect,
not the code.**

`--release` produces an **unsigned** APK, which a device refuses to install with an
error that does not explain why. Debug is the default for that reason.

The APK is gitignored (`*.apk`). Two were previously committed, ~9 MiB each.

## Quote transport — read this before debugging a sync failure

Yahoo returns **429 Too Many Requests** to any client that does not send a browser
User-Agent. Android sets one via `CapacitorHttp` and calls Yahoo directly. A browser
cannot set that header, and Yahoo sends no CORS header, so the web build must relay.

**Both relays this app used died before 2026-09-18** — `corsproxy.io` now answers `401
keyless_legacy_url`, and `api.allorigins.win` returns 5xx. That is what "US stocks are
not syncing" was; Indian stocks were equally broken, US is just where it gets noticed.
`r.jina.ai` is the working relay now, and it returns the document as text with a preamble,
so `_looseJson` recovers the payload rather than parsing it directly.

If quotes stop again, check the relay before anything else — `curl` the Yahoo URL with
and without `-A "Mozilla/5.0 ..."` and the answer is usually immediate.

## The renderer deadlock — read before touching navigation or the chart

`renderNwChart()` builds a Lightweight Charts canvas and measures its container. Doing
that **while a View Transition is capturing the page deadlocks Chromium's renderer**: the
page keeps painting and stops running script. It looks like a freeze, and no rendering
suite can see it, because the pixels are correct — it is script that has stopped.

Two paths reached it, and both are now guarded:

1. Navigation. The `activePage` setter used to call `renderNwChart()` **inside** the
   transition callback. It now runs from an `afterward` hook that `RFMMotion.transition`
   invokes once `vt.finished` settles.
2. `queueNwSnapshot()`'s 300 ms debounce, which fires on any portfolio write and can land
   inside a transition nobody associated with the chart. `renderNwChart` therefore checks
   `RFMMotion.isTransitioning()` itself and re-schedules rather than trusting its callers.

**Residual, stated honestly:** the regression test passes from a clean boot, after a
reload, and across repeated round trips, and `verify-routes` performs ~52 navigations
without wedging. But deep inside `verify-figures` the same round trip still wedged, and
that condition was not isolated — the test is positioned early for that reason. If a
freeze is ever reported after heavy use, start here rather than assuming it is new.

## History — faults found and fixed, and what they have in common

Kept because the *pattern* recurs, not for the changelog. Every one of these rendered perfectly.

1. **Three net-worth fields were write-only.** The form wrote `bankBalance` / `cashOnHand` /
   `propertyValue`; every reader used `bank` / `cash` / `property`. Typing a bank balance changed
   nothing — not net worth, not the chart, not the health score.
2. **The senior-citizen checkbox was wired to nothing**, and the ₹3L senior exemption was applied
   to everyone. 80TTB was granted unconditionally; 80TTA had no input at all.
3. **The elected regime was ignored.** `tax.regime` was persisted and read by nothing; the payable
   figure always took the cheaper of the two.
4. **Capital gains were charged on unrealized gains** — and on a type list (`Stock`, `Mutual Fund`,
   `ETF`) that the Add form never produces, so in practice it taxed mutual funds alone, treating
   every one as long-term because no purchase date is ever collected.
5. **Opening the app rewrote the portfolio.** `loadData` ended with the comment *"Never rewrite
   holdings at startup"* and then called `checkSipDebits()`, which created holdings and bought
   units at a hardcoded **₹100 NAV** when no price was available.
6. **The edit sheet's rate field was dead** — bound to `interestRate` while every reader used
   `rate`, so editing a deposit's rate never reached the tax engine.
7. **The allocation list did not add up to the total printed beneath it.** It used a filter that
   did not match `Bank FD` — the default type in the Add form — and had no row for property.
8. **The bank parser searched for one specific person** by name and surname list, matched one
   specific employer, and defaulted the investor to that person's full name.
9. **The standard deduction was allowed against every rupee of gross** — including deposit
   interest and rent, which Sec 16(ia) expressly excludes. A person whose whole income was FD
   interest received a ₹50,000 deduction they were not entitled to. The income field mixed
   salary, rent and consulting, so it had to be split before this was even computable.
10. **Price sync died silently when its relays did.** Not a code fault at all — two third-party
   services changed their terms — but it presented as "US stocks are not syncing" with a generic
   failure message, and nothing in the app or the suite could have reported the real cause,
   because the suite runs with the network cut. The relay is now named in the docs.
11. **A fund with no AMFI scheme code dead-ended.** The error was accurate ("needs an AMFI scheme
   code") and useless: the app never said where to get one and the Edit sheet has no field for
   it. The fund's own name is the lookup key.
13. **A successful Gradle build shipped an APK with no Capacitor native bridge.** The
   only fault here that was not in the source at all — the code was correct and the
   package was not. It presented as a total sync failure on the device while every
   suite stayed green, because every suite tests `web/`, and `web/` was fine.
12. **Building the net-worth chart inside a View Transition deadlocked the renderer.** The one
   fault here that is not about names — and the only one a person would experience as the app
   simply stopping. Found by `verify-figures` hanging, not by any rendering check: every pixel
   was correct. See *The renderer deadlock* above.

**The common shape: two names for one fact.** Six of the first eight are a writer and a reader that
disagreed about a key, or two copies of a list that drifted. None was a logic error, and none was
visible on screen. `scripts/verify-figures.mjs` exists to assert on the *figures and state* rather
than the rendering, because that is the only place this class of fault shows up.

The second shape, for what it is worth: **a comment that contradicts the line under it.** Fault 5
sat directly beneath a comment forbidding exactly what it did.
