# Corpus: security, subscriptions and Play launch plan

Created / last updated: 2026-09-27 (Asia/Kolkata)

This is the primary launch plan and issue tracker for this repository. Read it before launch-related work and update it after each relevant implementation or verification pass. It consolidates the September 27 security/readiness review and the subsequent subscription discussion. The older [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) is historical context, not current release approval.

## 1. Objective and current decision

Build a trustworthy, sustainable portfolio app that can serve hundreds of users, pass Google Play review, and earn revenue with positive margins. Profitability is an objective to measure, not a guarantee from adding subscriptions.

**Current verdict: NO-GO for broad public release or paid launch.** Suitable only for controlled testing with known limitations. No issue below is considered fixed by creating this document.

Initial scale to validate: up to 500 registered accounts, including a scenario of 500 daily active users and 50 concurrent active users. These are proposed test targets, not measured capacity or an approved service guarantee. Distinguish installed, registered, daily active, concurrent and paying users in every capacity report.

### Standing boundaries

- Preserve existing user data and unrelated working-tree changes.
- No paid upgrade, provider credit purchase, domain purchase, recurring charge, paid load test or automatic paid fallback without explicit budget approval. Discussing subscriptions did not authorize spending.
- No production stress tests, destructive account tests or bulk emails without a separately agreed scope. Use synthetic users and staging/local systems.
- Never put provider secrets, signing passwords, purchase tokens or real portfolio data in this tracker, source, screenshots or test logs.
- Security, data integrity, export, account deletion and access to existing portfolio data are baseline protections for every tier.
- Google and email-code sign-in are the current account scope. Email codes are OTP; SMS OTP is not included or promised free.
- No claim of end-to-end encryption, automatic closed-app daily valuation, guaranteed returns, guaranteed AI uptime or guaranteed profit unless actually established.
- A successful build or test suite is not proof of physical-device behaviour or independent penetration-test certification.

## 2. How to maintain this tracker

Priorities describe delivery order, not CVSS vulnerability scores:

- **P0:** close before expanding beyond controlled testing; especially data exposure/loss and access-control defects.
- **P1:** close before public or paid launch, as applicable.
- **P2:** hardening or follow-up; needs an explicit decision if deferred.

Statuses: `OPEN`, `IN PROGRESS`, `VERIFY`, `BLOCKED`, `DONE`, `DEFERRED`.

Evidence: `Reproduced` = isolated probe demonstrated the failure; `Observed` = source/configuration directly shows it; `Untested` = required assurance is absent; `Decision` = business/product approval needed.

Owners below are proposed roles: Engineering, Product (Swaraj), Operations, QA, or qualified Legal/Accounting. Assign an actual person when work starts. No assignment here authorizes contacting third parties.

To close an item:

1. Update its status, actual owner, and evidence classification if needed.
2. Meet its closure criteria; code written without relevant verification stays `VERIFY`.
3. Add an entry to the evidence log with date, item IDs, commit/build or deployed version, tests, outcome, and remaining limitations. Include artifact hashes where relevant.
4. If a provider/deployment changed, verify the deployed version separately from local code.
5. For a deferral, record reason, compensating control, approving owner, expiry/review date, and affected release gate. A deferred launch blocker does not silently become a pass.
6. Reopen an item when a regression or changed external requirement invalidates its evidence. Keep IDs stable; do not delete history.

No automatic monitoring, implementation or scheduled tracker updates are created by this plan.

## 3. Baseline evidence and limits

The following is a dated snapshot of the September 27 review, not a fresh verification on every future reading:

| Area | Observed foundation | Remaining boundary |
|---|---|---|
| Cloud access | Supabase RLS (row-level security) ownership policies; anonymous portfolio request returned 401; revision-based writes | Full two-user API tests, session lifecycle and new entitlement tables must be verified |
| Android authentication | AES-GCM session storage with Android Keystore; PKCE OAuth flow | Not encryption of every portfolio/export; browser sessions remain in browser storage |
| Release APK | Package `com.swarajnegi.corpus`, version code 7 / name 3.1, target SDK 36; not marked debuggable; automatic Android backup disabled | Validate every new release, Play signing path and migration on a phone |
| Existing tests | Account engine and Worker tests passed in the review; prior full app/account suites passed | Existing tests did not detect the new failure probes; physical multi-device and failure testing remain |
| Secret handling | OpenRouter secret stays server-side; targeted scan of 40 source/config files found no matching credential patterns | Not exhaustive history/binary scanning; exposed OAuth secret still needs rotation approval |
| Current usage | One cloud portfolio row at review time; database roughly 11.2 MB | Not representative of hundreds of users; compressed row bytes are not network payload size |
| User-reported phone checks | Google login/initial sync and receipt of an email code were demonstrated/reported | New-user OTP verification, two-device behaviour and full deletion/recovery remain unverified |

The review used source inspection, dependency scanning, live read-only metadata/public endpoint checks and isolated synthetic probes. It did not perform a hostile production penetration test, real-provider AI abuse, live load test or destructive production test.

Supabase's latest review returned a leaked-password-protection warning; earlier notes saying no security lints are historical. Its relevance must be assessed for this Google/email-code app rather than treated as proof of an OTP vulnerability.

## 4. Security and privacy tracker

| ID | Priority / status | Evidence / owner | Issue and required closure evidence |
|---|---|---|---|
| SEC-01 | P0 / OPEN | Reproduced / Engineering | AI gateway accepts unauthenticated callers with a forgeable brief marker; missing limiter binding fails open. Verify authenticated users server-side, validate structured input and construct prompts server-side. Enforce atomic per-user/global quotas, concurrency and body limits before provider calls. After billing exists, require authoritative entitlement too. Tests: missing/expired/forged identity, copied marker, missing binding, oversized/chunked body, concurrent quota races; zero upstream calls for rejected requests. |
| SEC-02 | P0 / OPEN | Observed / Engineering + Product | Daily AI brief sends financial/profile context automatically without explicit AI opt-in. Add separate informed consent, versioned consent state, an off switch and data minimization. Test first run, onboarding, restart, restore and account switch: no AI transmission before consent or after withdrawal. Sync consent must not substitute for AI consent. |
| SEC-03 | P0 / OPEN | Reproduced / Engineering | Crash scrubber preserves synthetic names, PAN-like identifiers, token strings and callback query codes. Prefer allowlisted error identifiers; redact client- and server-side; strip query strings and credentials; define diagnostic disclosure and retention. Adversarial synthetic tests must prove forbidden content never reaches collected logs. This is a filtering gap, not evidence of a historical real-data leak. |
| SEC-04 | P0 / OPEN | Observed design weakness / Engineering | Deletion freshness uses user-wide `last_sign_in_at`, not fresh authentication bound to the requesting session. Implement short-lived session-bound reauthentication and required session checks. Test old token plus fresh login elsewhere, revoked/expired tokens, wrong user, repeat requests and partial failures. No anonymous deletion exploit was demonstrated. |
| SEC-05 | P0 / BLOCKED | Known exposure / Product + Operations | Google OAuth client secret appeared in a screenshot; user previously declined rotation. Obtain explicit approval, replace it in Google/Supabase, revoke the old value and test login. Do not reproduce the secret or rotate it silently. Extend secret scanning to relevant Git history and packaged artifacts; document findings privately. Public release remains blocked on resolution. |
| SEC-06 | P1 / OPEN | Untested / QA + Engineering | Revalidate ownership boundaries with two disposable authenticated users through REST/RPC, including direct writes, owner reassignment, forged metadata, stale sessions and deleted accounts. Add tests for future subscriptions/usage tables: clients cannot grant themselves premium or edit quotas. RLS and grants must be tested together; user-editable metadata must not authorize access. |
| SEC-07 | P1 / OPEN | Observed / Engineering + Product | Biometric code prompts but does not gate the UI after cancellation; no exposed current toggle was found. Either remove unsupported lock claims/dead implementation or deliver a real lock screen covering cold start/resume/cancel/unavailable sensor. Define recent-app preview/screenshot privacy separately. Verify on a physical device. |
| SEC-08 | P1 / OPEN | Observed / Engineering | Backup/recovery exports are plaintext; temporary exported copies persist; FileProvider roots are broad. Narrow sharing roots, clean app-managed temporary exports, warn about plaintext copies and account-deletion limitations for user-exported files. Test URI grants, share completion/cancellation and sign-out cleanup. Decide whether optional encrypted exports are needed; do not claim existing E2EE. |
| SEC-09 | P1 / OPEN | Observed / Engineering | AI requests do not explicitly constrain provider data collection/retention. Inspect account settings, define an approved provider privacy policy and enforce it in routing. Test no-compliant-provider failure without silently relaxing privacy. Paid models are not automatically private; compatible free capacity may shrink. Disclose all processors. |
| SEC-10 | P1 / OPEN | Observed / Engineering | Public web responses checked lacked CSP, framing protection and `nosniff`. Introduce a compatible Content Security Policy and other headers, review script sinks and callback URLs, and test browser/native flows. A missing header is hardening debt, not a demonstrated XSS exploit. |
| SEC-11 | P1 / OPEN | Observed / Engineering | Native AI bridge accepts any `*.workers.dev` host. Restrict exact gateway host/path, validate redirects, bound request/response sizes and reject unintended schemes/hosts. Review all network proxy allowlists, including delegated RSS fetches. Test rejection without outgoing network calls. |
| SEC-12 | P1 / OPEN | Observed / Engineering | Audit reported three high-severity dependencies: `@xmldom/xmldom`, `brace-expansion`, `tar`, all through Capacitor CLI tooling. Update compatible versions, separate build/runtime dependencies, rerun audit and release builds. Record reachability of any remaining advisory rather than describing all as APK exploits. |
| SEC-13 | P1 / OPEN | Untested / Operations | Verify least-privilege dashboard/service access, administrator MFA, protected signing-key/off-machine recovery, CI secrets, incident response and credential rotation. Review unused auth methods and leaked-password warning; do not purchase a feature merely to clear a scanner warning. Record configuration checks without credentials. |

Source starting points: `worker/src/index.js`, `worker/wrangler.toml`, `web/crash.js`, `web/regenWealth.js`, `web/app.js`, `supabase/functions/delete-account/index.ts`, `android/app/src/main/java/com/swarajnegi/corpus/`, `android/app/src/main/res/xml/file_paths.xml`.

## 5. Data integrity, accounts and reliability tracker

| ID | Priority / status | Evidence / owner | Issue and required closure evidence |
|---|---|---|---|
| DATA-01 | P0 / OPEN | Reproduced / Engineering | Staged cloud restore removes old keys before all new keys are written; simulated quota failure left a partial portfolio/history/metadata state. Ordinary backup restore is also sequential. Use transactional storage or a recoverable atomic version switch; validate first, retain recovery, block unsafe boot/sync on incomplete recovery. Tests: quota failure at every write, process interruption, restart and rollback with unchanged/recoverable original data. |
| DATA-02 | P0 / OPEN | Reproduced / Engineering | Sync validation accepts malformed nested holdings/history. Define a versioned shared contract with finite/ranged financial values, valid dates, types, collection and byte bounds, and safe migrations. Enforce essential server constraints as well as client validation. Reject malformed input without changing local/cloud data. Preserve valid historical backups. |
| DATA-03 | P1 / OPEN | Observed / Engineering | Full portfolio downloaded every visible minute. Use lightweight revision checks/change notifications or another measured approach, fetch documents only on change, back off offline/errors and preserve conflict safety. Measure requests, wire bytes, latency and writes for realistic portfolios before/after; no silent last-writer-wins. |
| DATA-04 | P1 / OPEN | Observed failure path / Engineering + QA | Native process death can leave analysis state `running`; account-boundary operations then remain blocked. Add job expiry/cancellation and durable recovery, prevent duplicate jobs and clean private cached results. Test kill/restart/reboot, network loss, background limits and sign-out/deletion while work is pending on a phone. |
| DATA-05 | P1 / OPEN | Observed / Engineering | PDF extraction loads the whole file and every page without clear resource bounds. Bound file size, pages, extracted text and time; support cancellation and cleanup. Test huge/malformed/password-protected files and low-memory devices without freezing or partial import. |
| DATA-06 | P1 / OPEN | Untested / QA + Engineering | Broker-grounded financial correctness: confirm MF/stock/FX refresh, NAV dates, holidays/stale feeds, invested cost, fees, splits/corporate actions where supported, SIP links, duplicate imports, disposals and missing quotes. Reconcile representative statements, not only internal totals. Graph must keep actual dated observations, honest empty windows and contribution-inclusive wording; never invent closed-app valuations. Document unsupported cases. |
| AUTH-01 | P1 / OPEN | Partial demonstration / Product + QA | Verify Google production consent, exact redirects, PKCE callbacks, cancel/retry and fresh/repeat user login. Verify both Magic Link and Confirm signup templates contain the email code, expiry/resend/rate limits and successful physical-device code verification. Verify sender-domain deliverability and warnings; one received email is insufficient. No SMS promise. |
| AUTH-02 | P1 / OPEN | Untested / Engineering + QA | Implement/verify abuse protection for signups and OTP requests, including server-side throttling and suitable bot protection. Test shared-IP users, bursts and exhausted email capacity; never rely only on a client cooldown. Preserve Google/offline alternatives without bypassing verification. |
| AUTH-03 | P1 / OPEN | Untested / QA | Two devices and two accounts: offline edits, concurrent conflicts, first cloud attach, account switching, missing remote row, token expiry, logout, reinstall, backup restore and deletion. Verify old data/AI caches/notifications do not cross account boundaries. Confirm deletion removes the cloud row and cannot be resurrected by stale clients. A browser can cover some cases but is not complete Android QA. |

Source starting points: `src/accounts.mjs`, `src/account-sync.mjs`, `supabase/migrations/`, `web/parser.js`, `web/app.js`, `web/regenWealth.js`, `docs/accounts-and-sync.md`, `scripts/verify-*.mjs`.

## 6. Operations, capacity and release tracker

| ID | Priority / status | Evidence / owner | Issue and required closure evidence |
|---|---|---|---|
| OPS-01 | P1 / OPEN | Untested / Operations | Latest-document sync is not disaster recovery. Define recovery point/time targets, encrypted independent backups, retention/deletion handling and failure alerts. Include necessary configuration and any future storage objects, not just SQL. Restore into an isolated environment and reconcile counts/ownership/history; prevent deleted accounts resurfacing. Free-tier backups require an explicit process; a paid plan still requires restore testing. |
| OPS-02 | P1 / OPEN | Partial telemetry / Engineering + Operations | Privacy-safe monitoring for auth/delivery failures, sync conflicts/errors, stale quotes, native/JS crashes, AI success/latency/cost, quota saturation and billing events. Assign alert recipient, thresholds, escalation and rollback/kill-switch runbooks. Exercise a synthetic alert. No raw portfolio, token or prompt logging. |
| OPS-03 | P1 / OPEN | Untested / Engineering + QA | Measure 100/500 active-user scenarios, 50 concurrent sessions and signup bursts in a scoped staging/local environment. Include realistic large portfolios, retry storms and provider failure. Record p50/p95 latency, error rates, egress, storage and saturation; approve service targets and capacity headroom before launch. No production load test implied. |
| OPS-04 | P1 / OPEN | Decision / Product + Operations | Approve provider budgets, hard caps, alerts, privacy-compatible paid AI fallback policy, reserve and exhausted-budget behaviour. Account for free users, annual obligations and Play payout delay. No automatic spending or quota evasion via extra accounts/keys. |
| REL-01 | P1 / OPEN | Observed / Engineering | Public web build is behind local APK; `/account-config.js` returned 404. Existing AAB dated Sept 24 predates Sept 27 APK changes. Deploy/build a consistent version only after fixes, verify served/packaged hashes and configuration, then test web OAuth and offline boot. Recheck live state before acting; this is a dated observation. |
| REL-02 | P1 / OPEN | Observed design risk / Engineering | Web service worker uses a fixed cache name and per-file network-first updates, risking mixed-version shells. Adopt coherent versioned updates, prevent caching auth callback query data, scope cache cleanup and verify interrupted deployment/offline upgrade. Native APK does not use this worker. |
| REL-03 | P1 / OPEN | Untested / Engineering + QA | Produce release-signed AAB/APK with correct monotonically advancing Play version, target-SDK compliance and asset audit. Prove existing installations upgrade without uninstall/data loss. Validate Play signing vs sideload signing, key backup and rollback strategy; an older AAB passing once does not certify a new release. |
| REL-04 | P1 / OPEN | Partial prior tests / QA | Physical-device matrix: low-end/small Android, supported Android versions, permissions denied, battery/background restrictions, large fonts/accessibility, keyboard, pull-to-refresh and offline restart. Triage the prior 41 informational polish findings; distinguish real issues from false positives. WebKit emulation is not an iPhone-device test. |
| REL-05 | P1 / OPEN | Decision + untested / Product + Engineering | Complete current Play Console account/testing requirements, store listing, screenshots, reviewer access, privacy URL, external deletion route, Data Safety and Financial Features declarations. Review foreground-service/exact-alarm needs and declarations. Confirm applicable rules in Console; do not treat old checklist costs/dates as authoritative. |
| REL-06 | P1 / OPEN | Untested / Product + Operations | Controlled staged rollout with support contact, incident owner, stop thresholds, rollback and communication plan. Resolve severe beta incidents before increasing users. Validate paid-user cancellation/refund/support experience before charging broadly. |

## 7. Product and pricing proposal

Subscription direction is requested by the user. Exact tier names, boundaries, prices, allowances and discount are **proposed and not approved for sale**.

Start with **Free + one paid tier**, each paid subscription offering monthly and annual billing. A third total tier can follow proven demand; do not build three paid tiers merely for symmetry.

| Feature | Corpus Free (proposed) | Corpus Plus (proposed) | Higher tier (later, optional) |
|---|---|---|---|
| Holdings, actual corpus history, basic planning | Included | Included | Included |
| Basic account/device sync | Included, within published reasonable limits | Included | Included |
| Security, export, deletion, existing-data access | Included; never held hostage | Same baseline protection | Same baseline protection |
| AI analysis and research | No automatic daily analysis; any trial requires approved quota/consent | Defined monthly allowance using approved providers | Larger allowance if economics justify it |
| Advanced reports/research tools | Basic capabilities only | Candidate paid value; specify and validate before sale | Only genuinely additional value |
| Price | Free | Monthly INR price: TBD; annual INR price: TBD | Deferred |

### Annual-plan rules

- Annual plan should cost less than 12 monthly payments, with exact savings and full billed amount disclosed. Discount percentage is TBD after cost modelling.
- Monthly AI allowances reset monthly even for annual subscriptions. Define reset timezone/anniversary, rollover, top-ups, upgrades and refunds explicitly before implementation.
- Do not advertise unlimited AI initially. Account for retries, research, large portfolios and abuse, not just one model completion.
- Cancellation/expiry stops future premium entitlement as appropriate, never access to existing financial records, exports or account deletion.
- Annual cash received is not immediate profit: reserve enough for the remaining service term and possible refunds.
- Subscription revenue can fund costs; it does not guarantee no upfront cash need because usage charges may precede Play payouts.

### What subscriptions solve (and what they do not)

Subscriptions alone fix **zero security defects**. Revenue can fund AI, email, backend capacity and backups/monitoring. A correctly enforced entitlement system can help prevent AI abuse, but a UI paywall alone cannot. Paid plans do not fix restore corruption, consent, redaction, auth bugs, financial accuracy or compliance.

Charging for AI while relying exclusively on the same shared free-model allowance does not deliver dependable subscriber capacity. Switching to paid inference or infrastructure still needs explicit approval under OPS-04.

## 8. Billing and profitability tracker

| ID | Priority / status | Evidence / owner | Required closure evidence |
|---|---|---|---|
| BIZ-01 | P1 / OPEN | Decision / Product | Approve Free/Plus boundaries, monthly and annual prices, discount, allowances, renewal/reset rules, trials and refund/support policies. Preserve free baseline protections. Validate willingness to pay with a small cohort; do not publish placeholder promises. |
| BIZ-02 | P1 / OPEN | Unmeasured / Product + Engineering | Benchmark cost per complete analysis (p50/p95/heavy user), research costs, retries and provider/privacy availability. Model 100/500 active users at several paid-conversion rates, monthly vs annual mix and zero-growth/downside cases. Set positive contribution-margin target, break-even estimate and spend caps before selling. |
| BIZ-03 | P1 / OPEN | Decision / Product + qualified advisers | Review personalized Buy/Hold/Trim functionality and applicable investment-advice/research obligations; disclaimers do not settle legality. Verify market/news data commercial-use rights and accuracy obligations. Check terms, privacy, applicable data-protection rules, business/payout/tax setup. Do not reuse unverified legal/tax/cost assertions from the old checklist. |
| BIZ-04 | P1 / OPEN | Untested / Product + Operations | Define launch success: activation, retention, paid conversion, churn, refund rate, support load and contribution margin, with privacy-minimal measurement. Separate subscription bookings, revenue earned, cash received and profit. Record real results and a date to reassess pricing; profitability is not proven by first sales. |
| BILL-01 | P1 / OPEN | Not implemented by this plan / Engineering | Integrate current supported Google Play Billing for digital subscriptions, subject to applicable regional/program rules. Use secure backend purchase-token verification/acknowledgement and account-bound entitlements. Never trust a local premium flag or client-writable profile metadata. Test replayed tokens, wrong account/package/product and duplicate callbacks. |
| BILL-02 | P1 / OPEN | Untested / Engineering | Handle verified real-time developer notifications and periodically reconcile with Play: pending payment, renewal, grace period, hold, cancel, expiry, refund/revocation and plan change. Authenticate notifications and process them idempotently, including out-of-order/repeated events; query authoritative purchase state. |
| BILL-03 | P1 / OPEN | Untested / Engineering + QA | Restore purchases across devices/reinstall, define account-linking and offline entitlement behaviour, and prevent cross-account theft. Test successful charge with lost callback, upgrade/downgrade, annual renewal, expired subscription and deletion while subscribed. Explain that account deletion and subscription cancellation are distinct workflows. |
| BILL-04 | P1 / OPEN | Untested / Engineering | Atomically reserve/debit/refund AI allowance server-side per user and billing period; retries cannot double-charge allowance, concurrency cannot overspend, clients cannot alter counters. Define what counts as a delivered analysis and how provider failures affect allowance. Show remaining usage and reset date without exposing internal secrets. |
| BILL-05 | P1 / OPEN | Untested / QA + Product | Test monthly/annual products with Play license testers/internal testing, including localized price/currency, total annual charge, renewal/cancellation terms, refunds and purchase restoration. Enable paid launch only after entitlement and cost-control gates pass. Do not bill real users during implementation tests. |

### Unit-economics worksheet (fill before price approval)

| Input | Value / evidence required |
|---|---|
| Monthly price M / annual price A / discount | TBD; discount = `1 - A / (12 * M)` |
| Store fee and tax treatment | Confirm applicable programme, locale and settlement reports; 15% is the standard published auto-renewing subscription fee, not a universal net-revenue shortcut |
| Net monthly-equivalent receipts | Monthly receipts after applicable deductions; annual receipts allocated over 12 months for service economics |
| AI allowance / successful-analysis cost | TBD measured including research, model tokens, retries, failures and heavy users |
| Variable subscriber cost | AI + incremental sync/email/data costs + support/refund allowance |
| Fixed monthly cost | Hosting floors, independent backups, tooling, support and any approved commercial data costs |
| Free-user subsidy | Active free users * measured per-user cost; include in break-even |
| Contribution per subscriber | Net monthly-equivalent receipts minus variable subscriber cost |
| Break-even subscribers | Round up `(fixed cost + free-user subsidy) / positive average contribution`; impossible if contribution <= 0 |
| Operating profit estimate | Total contributions minus fixed costs and free-user subsidy; distinguish pre-tax estimates from accounting profit |
| Cash reserve | Approved cover for payout lag, refunds, annual obligations and incidents; TBD |

Stress-test allowances at high utilization, not only average use. Choose the annual discount only after checking annual-plan contribution remains positive. No revenue, conversion or profit projection is currently validated.

### Six beta-feedback items (2026-09-28 implementation pass)

These are product improvements, not an override of the security and release gates above. `VERIFY` means local implementation exists, not that a deployed build or a user's real records have been reconciled.

| ID | Status | Local implementation | Still required before closure |
|---|---|---|---|
| FEED-01 | VERIFY | Planning shows the latest published India combined CPI with its reference month, source link and stale/offline labelling. Overview keeps its focus on portfolio and upcoming cash flows. The Worker parses the official MoSPI-linked release and caches it. Nominal corpus history is unchanged. | Deploy the Worker with release approval; verify a live current release, month rollover, outage, and offline phone display. A local Node fetch failed at the MoSPI API TLS handshake although a proxied read succeeded; Worker-origin connectivity is unverified. CPI is monthly, never live daily inflation. |
| FEED-02 | IN PROGRESS | Dated acquisition lots and sale/redemption records, FIFO partial sales, Indian financial-year grouping, special/slab-rate preview and review flags. Legacy manual gains remain separate pending reconciliation. Unknown basis is recorded without a guessed gain. | Accountant-grade review of tax classification, acquisition dates, STT, fund/ETF status, fees, loss set-off, foreign assets, surcharge/cess and FY rule changes; reconcile representative broker/CAS/tax statements. This is not a filing calculator yet. |
| FEED-03 | VERIFY | Physical gold, silver, copper and custom metals can be held by quantity/unit/purity with manual valuation. Gold/silver can use an indicative spot-and-FX benchmark; failed refresh retains the last dated value. | Verify commercial display terms and live quote/FX behaviour on phone, benchmark vs retail-value wording, rate limits and stale fallback. Copper/custom remain manual; do not use MCX without permission. |
| FEED-04 | VERIFY | RD holding and Planning schedule can link; only a confirmed instalment raises principal, a skipped month does not. A user-entered bank-verified balance is separate from projected interest. | Test existing-user migration, reminder timing, edited verified balance, month rollover and backup/device sync on a physical installation; reconcile against bank statement. |
| FEED-05 | VERIFY | Empty Insights explains why analysis is unavailable and offers Add holding; existing nonempty AI flow remains. | Mobile usability and accessibility check on a phone, including account switching and restore. |
| FEED-06 | VERIFY | Payout choices are explicitly plural per asset class; “let it grow” excludes frequencies. AI compares every chosen frequency to recorded terms and calls unverified payouts indicative. | Review representative mixed-frequency portfolios and AI outputs; do not imply actual cash received or guaranteed yield. |

## 9. Capacity assumptions to replace with measurements

Published limits checked during the September 27 discussion; recheck before purchase or launch:

- OpenRouter no-purchase free tier: 50 requests/day and 20/minute across the shared account/key usage. Actual available provider/key capacity was not measured. Fallbacks do not create extra quota.
- Brevo Free: 300 email sends/day. Signups, retries and other transactional mail compete for capacity; queued delivery can make short-lived OTPs unusable.
- Supabase Free: 500 MB database and 5 GB ordinary egress; the additional cached allowance is not automatically a substitute for uncached database traffic. Automatic backups are not included in Free.
- Cloudflare requests/CPU, market-provider rate limits and research fan-out must be measured too; network wait time is not CPU time.

Illustrative bandwidth only: `500 daily users * 15 visible minutes/day * 20 KB full-document response * 30 days = 4.5 GB/month` before writes/retries/other calls. This is not the current measured portfolio size or capacity forecast. Compare compressed database bytes, JSON wire bytes and billing metrics separately.

Free plans can support a modest product after optimization; paid users do not justify wasteful polling. Budget decisions require measured demand and approved spending limits, not user-count assumptions alone.

## 10. Execution order and release gates

| Phase | Work / dependencies | Exit gate |
|---|---|---|
| A: Protect data and services | SEC-01 through SEC-06; DATA-01/02; AI consent and diagnostics first. SEC-05 needs user approval. Add failing regression tests before fixes. | No unresolved confirmed data-loss/exposure/access-control blockers; safe failures proven. |
| B: Reliable accounts and operations | Remaining SEC items; DATA-03 through DATA-06; AUTH items; OPS-01/02/03; REL-02/04. Can run product/legal research in parallel. | Isolation, two-device recovery, job lifecycle, backup restore and scoped capacity tests pass; approved privacy/security posture. |
| C: Establish sustainable product | BIZ-01/02/03 and OPS-04; provider/privacy/market-data decisions before pricing promises. | Approved package, compliant feature scope, measured unit economics and budget/reserve. No paid procurement without approval. |
| D: Implement subscriptions | BILL-01 through BILL-05 after identity, quota and economics foundations. | Verified lifecycle, restore, entitlement and usage-metering tests; no unlock-by-client or unintended charges. |
| E: Release candidate and small beta | REL-01 through REL-06, current regression suites, public policy/deletion pages. | Consistent signed artifacts, required Play declarations/testing, phone upgrade/QA, support/rollback ready. |
| F: Expand to hundreds | Start with roughly 10-25 controlled testers, then about 100 users, then up to 500 if evidence supports it. Counts are rollout proposals, not guarantees. | Review error/latency/retention/cost/support evidence at each step; no unresolved P0/P1 public-launch blockers. Track BIZ-04. |

Immediate next implementation slice, when authorized: **SEC-01 + SEC-02 + SEC-03**, followed by **DATA-01 + DATA-02**. Do not start with paywall styling while gateway and data safety remain open.

### Final go/no-go checklist

- [ ] All P0 items closed with evidence; all applicable P1 items closed or feature safely removed from launch scope and explicitly approved.
- [ ] Backend and client isolation, consent, recovery and billing tests pass against the actual release configuration.
- [ ] Real-device email/Google login, multi-device conflict resolution, deletion and in-place upgrade verified.
- [ ] Scoped capacity and failure tests meet recorded targets; no extrapolation from one portfolio row.
- [ ] Backup restore drill, incident alerts, spending limits and rollback exercised.
- [ ] Financial figures reconciled against ground truth; stale quotes and unsupported cases clearly shown.
- [ ] Privacy, external deletion, market-data/advice review and required Play declarations complete.
- [ ] Pricing/allowances/discount and cash reserve approved; positive measured contribution margin; no claim of guaranteed profitability.
- [ ] Current release AAB/APK and deployed services identified with versions/hashes; no stale config or mixed web shell.
- [ ] Product owner records final launch decision and rollout scope below.

Final decision: **NOT APPROVED**. Approver/date/release: pending.

## 11. Verification commands and evidence handling

Use the repository's current scripts; read them before running because verification tools can create local artifacts or start services. Preserve dirty changes. Suggested checks during implementation:

```text
npm run verify:accounts
node scripts/verify-worker.mjs
npm run verify
node scripts/audit-polish.mjs
npm audit --omit=dev
npm run apk -- --release
npm run aab
```

Account scripts are separate from the main verify command and must not be forgotten. Audit-polish findings require triage even when the command succeeds. Extend regression coverage for the reproduced audit failures and all subscription lifecycle cases. Check final packaged web/config hashes and signing identity; keep device evidence separate from build evidence.

Do not run production SQL fixture tests, send OTP emails, deploy Workers, buy subscriptions, change credentials or upload releases merely because a command appears in this plan. Use the authority and scope of the current task. Future cloud changes must recheck current provider documentation, RLS/grants and deployed behaviour.

### Evidence log

| Date | Item IDs | Change / test / evidence | Outcome / remaining limit |
|---|---|---|---|
| 2026-09-27 | Baseline | Read-only review; existing account/Worker tests; dependency scan; live metadata/public reads; isolated gateway, redaction, restore and schema-validation probes | Findings recorded above. No production fixes, paid purchases or live destructive/load tests performed. |
| 2026-09-27 | Planning | Created this tracker and linked the historical checklist; captured subscription proposal and release gates | Documentation only. All implementation/approval items remain open or blocked as marked. |
| 2026-09-28 | FEED-01–06 | Local source changes; `npm run verify`, `npm run verify:accounts`, `scripts/verify-feedback.mjs`, synthetic backup/restore of new fields, offline Chromium boot and 390px route checks passed. The audit tool still reports existing small touch targets/clipped screen-reader text. MoSPI API metadata was retrieved through a proxy, but a direct Node fetch failed at TLS renegotiation. No Worker deployment, APK, production dataset, bank/CAS reconciliation or phone test is claimed. | Local regression evidence only. CPI Worker connectivity, tax accuracy against statements, commercial data terms, audit findings and physical-device checks remain; all security/release gates retain their prior status. |
| 2026-09-28 | CONN-01, CONN-02 | Added local bank CSV transaction review, deduplication, daily spending and account-document validation; removed fake assets inferred from generic/bank statement balances. `npm run verify` and `npm run verify:accounts` passed; `scripts/verify-bank-transactions.mjs` covers parser and 390px UI. | Local groundwork only. Polish audit still reports 44 distinct findings, including small touch targets. No new APK, bank login, broker login, automatic transaction feed, provider consent, production data reconciliation or phone verification. Do not call this live sync. |

For new entries include: actual owner, IDs, commit/build/deployment, command or reproduction, expected/actual result, safe evidence path, date and remaining limitations. Never record secrets or private user data.

## 12. Portfolio and bank connections (new feature work)

| ID | Status | Scope and release boundary |
|---|---|---|
| CONN-01 | IN PROGRESS | One-file CAS/broker PDF import exists. A direct, read-only broker link needs official provider authorization, consent, token storage/refresh and reconciliation against a statement. Do not request broker passwords or scrape sessions. [Upstox documents OAuth](https://upstox.com/developer/api-documentation/authentication/) and a [holdings API](https://upstox.com/developer/api-documentation/get-holdings/); its [read-only analytics route](https://upstox.com/developer/api-documentation/analytics-token/) has additional access conditions. [Groww's Trade API](https://groww.in/trade-api) is subscription-based and its tokens expire daily, so it does not satisfy the standing no-spend constraint. [INDmoney advertises a first-party Claude MCP connection](https://www.indmoney.com/mcp), not permission for Corpus to use its customers' data. No broker is connected yet. |
| CONN-02 | IN PROGRESS | Local bank CSV import now records dated, reviewable transactions and daily spending without changing corpus bank balances. It is not automatic bank sync. For ongoing feeds, choose a lawful consented Account Aggregator partner/regulated FIU path or a [Play-policy-reviewed SMS alternative](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en-GB). [Sahamati FIU eligibility](https://sahamati.org.in/wp-content/uploads/2025/04/Sahamati-Membership-Terms-1.pdf) cannot be assumed for this app. Do not request broad SMS permission or present notification/SMS parsing as complete bank coverage without policy, consent, accuracy and phone testing. |

Keep imported transactions distinct from budget forecasts and asset balances; repeated file imports must not duplicate spending. Before release, test real redacted bank exports with consent, date/amount variations, partial overlaps, backups, account sync, disconnect/deletion and financial-data disclosures. These are open acceptance criteria, not a claim that connections are built.

## 13. References and historical corrections

Repository references: [accounts and sync](docs/accounts-and-sync.md), [earlier enterprise readiness notes](docs/enterprise-readiness.md), [historical launch checklist](LAUNCH_CHECKLIST.md).

Corrections to older planning: accounts now exist; backend is Supabase plus Cloudflare services; Google phone login/initial sync and email receipt have some user evidence; SMS and iOS launch are not current scope; AI cost per subscriber and final INR prices are unmeasured; diagnostic redaction is not proven complete. Historical blanket claims of no physical testing, no data in crash reports, guaranteed data licensing, fixed tax thresholds or fixed launch fees must not be carried forward as current facts.

Primary references (revalidate when implementing or submitting):

- [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)
- [Play service fees](https://support.google.com/googleplay/android-developer/answer/112622)
- [Play Billing security and verification](https://developer.android.com/google/play/billing/security)
- [Billing integration and subscription events](https://developer.android.com/google/play/billing/integrate)
- [Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Play user-data requirements](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Financial Features declaration](https://support.google.com/googleplay/android-developer/answer/13849271)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase backup scope and recovery](https://supabase.com/docs/guides/platform/backups)
- [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits)
- [OpenRouter pricing](https://openrouter.ai/pricing)
- [OpenRouter provider privacy routing](https://github.com/OpenRouterTeam/docs/blob/main/guides/routing/provider-selection.mdx)
- [Brevo Free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [SEBI Investment Advisers regulations reference](https://www.sebi.gov.in/legal/regulations/nov-2025/securities-and-exchange-board-of-india-investment-advisers-regulations-2013-and-securities-last-amended-on-november-25-2025-_98246.html)

This file is a working engineering/business plan, not legal advice, an independent security certification, an authorization to spend, or a promise of Play approval/profit.
