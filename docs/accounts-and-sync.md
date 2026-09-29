# Corpus accounts and device sync

## Current rollout

Supabase project `rtoiizrwpzuywrwhoxjl` (Corpus), Mumbai, was created on the Free plan with a quoted cost of $0/month. No paid upgrade or SMS provider has been enabled. Free quotas and availability are not an unlimited service guarantee.

The schema and authenticated deletion function are deployed. Google and email-code sign-in are enabled in `web/account-config.js`. The user demonstrated Google login and initial sync on their phone. Brevo SMTP and the Magic Link code template were configured by the user; the sender was shown as Verified. A single live OTP request was accepted and the user confirmed receipt. Email-code verification on a physical device is still untested; no OTP was requested from the user or inspected. The public project URL and publishable key are safe to bundle; they do not bypass database row-level security. Never bundle service-role keys, SMTP passwords or Google client secrets.

Brevo is currently using a verified Gmail sender with domain-authentication warnings. Receipt of one message is not a public-production deliverability guarantee. Keep the free-plan limits and sender-domain warning visible in release decisions; no paid plan, domain purchase or SMS service was enabled. Cross-device Android testing was explicitly deferred by the user.

Release blocker: an OAuth client secret was exposed in a screenshot. The user declined rotation for now. Do not copy that value into source or logs; replace and revoke it before public release. The Google Cloud project selected by the user is `gen-lang-client-0042118661`, renamed Corpus.

## Provider configuration and remaining release checks

1. Create a Google **web application** OAuth client. Authorized redirect URI: `https://rtoiizrwpzuywrwhoxjl.supabase.co/auth/v1/callback`. Put its client ID and secret in Supabase's Google provider settings, not in app source. Configure consent/production publishing as required by Google.
2. Add `com.swarajnegi.corpus://auth/callback` to Supabase Auth's redirect allowlist. Add the exact production HTTPS app URL separately for web. The Android flow uses an external browser and PKCE, not an embedded Google login page.
3. Configure a production SMTP sender on a free tier with an approved sender/domain. The default Supabase sender is restricted to organization members and is not a public email service. New Free projects require custom SMTP to customize the OTP template. Use `{{ .Token }}` in BOTH the Magic Link and Confirm signup templates: first-time OTP users follow the signup path. The user confirmed saving Magic Link; Confirm signup is awaiting confirmation. Configure a short expiry and rate limits. Never disable email verification to bypass SMTP setup.
4. Enable only the configured providers in `web/account-config.js`, rebuild, then test real Google sign-in and email delivery/expiry/resend on Android and web. Email codes **are** OTP. SMS OTP is deliberately absent: it requires a separate SMS provider and is not promised free.

## Data contract

`corpus_portfolios` stores one versioned JSON document per authenticated user: portfolio fields from `rfm_v1` and actual dated history from `rfm_nw_history`. Auth sessions, device preferences, biometric settings, analysis caches, notification state and API credentials are not synchronized or exported in ordinary backups.

Existing guest data stays local until the user explicitly connects it. An existing cloud portfolio prompts a choice rather than being overwritten. Local edits debounce to an upload while online; reconnect, foreground and a one-minute visible-app check retry/pull. No closed-app sync daemon is claimed. Local storage remains the offline working copy.

Writes use an atomic expected-revision comparison. Simultaneous divergent edits stop for explicit resolution. Clean remote updates show **Load cloud copy** rather than reload during editing. No record-level merge or automatic last-writer-wins is claimed. A missing previously linked server row pauses upload rather than recreating deleted cloud data.

Loading the cloud copy stages an account-boundary reload before Alpine initializes, clears personal caches and native notifications, and retains one local recovery copy. Export it before another conflict resolution or sign-out. It is not an indefinite cloud backup. Sign-out warns about unsynced changes and clears linked financial data/recovery copies. Account deletion requires a recent sign-in, server-side token validation, explicit confirmation, revokes sessions and deletes the Auth user; foreign-key cascade removes the synchronized portfolio. Existing JWTs can remain cryptographically valid until expiry, but have no portfolio row and cannot recreate one without an Auth user.

## Security and release limits

- RLS enforces `auth.uid() = user_id` for reads/inserts/updates. Anonymous grants are revoked. The write function is security-invoker, not security-definer.
- Android session/PKCE storage is AES-GCM encrypted with an Android Keystore key. Browser sessions use browser local storage; XSS prevention remains essential. Portfolios and exported backups themselves are **not end-to-end encrypted**.
- Android automatic OS backup/device transfer is excluded for app data. Explicit Corpus export and cloud sync remain available.
- `delete-account` intentionally uses `verify_jwt=false` at the gateway because the function explicitly validates the bearer token using Auth `getUser`; an unauthenticated request is rejected before admin operations.
- Before Play release: publish a working external account-deletion page, update privacy policy and Data Safety disclosures, verify Google/SMTP delivery, exercise two physical devices, review AI gateway authorization/quotas, and resolve dependency/security audit findings. This change alone is not a Play-ready certification.

## Verification

Email rollout: `npm run verify:accounts` passed after enabling email, including invalid/expired codes, local resend throttling, resend recovery and successful mocked verification. UI checked in Chromium at 390x844 via repository Playwright (Browser plugin unavailable), with screenshots outside the repository. Live mailbox receipt was confirmed by the user; the automation did not receive or verify their real code. `corpus-email-update.apk` was built with `--release`; asset audit now includes `account-config.js` and `vendor.js`. Its signing certificate matches `corpus-google-update.apk`, with the same package/version (com.swarajnegi.corpus, 7 / 3.1). The temporary-host upload checksum matched the local file. Physical-device email sign-in and new-user email delivery are still pending.

The email rollout's full `npm run verify` rerun exited 0, including offline boot and WebKit. The initial run stopped at two timing-sensitive sheet-close checks while Android compilation was running; the isolated sheet test and full rerun passed without changing those tests. The informational polish audit still lists 41 unrelated findings (touch targets/spacing/alignment and one sr-only clipping report); it is not a clean visual audit. No physical-device email sign-in or second-device test is claimed.

### Updating existing sideloaded installs

The saved `rfm-3.1.apk` is release-signed, while the first `corpus-google-test.apk` was debug-signed. They share the package ID and version code but have different certificates, so the debug APK cannot update that release in place. For these testers build with `npm run apk -- --release --out corpus-google-update.apk` using the existing protected release keystore. Compare the output certificate to the prior release with `apksigner verify --print-certs`, check package ID/version with `aapt dump badging`, and pass the package-asset audit before sharing. Do not tell users to uninstall merely to work around a packaging/signing mistake. A Play-signed install may use a different app-signing certificate and needs its own update channel.

2026-09-27: the full `npm run verify` run completed successfully; its informational polish audit still reported unrelated layout/touch-target warnings. All three account test scripts passed. The live SQL regression passed and Supabase security advisors returned no lints. An unauthenticated request to the deployed deletion function returned HTTP 401. `npm run apk -- --out corpus-accounts-preview.apk` compiled successfully and passed the packaged-asset audit. This preview keeps both sign-in providers disabled and has not been tested on a physical device.

- `node scripts/verify-accounts.mjs`: offline synchronization contract and account-owner guards.
- `node scripts/verify-account-ui.mjs`: release gates, consent, mobile UI and conflict controls.
- `node scripts/verify-account-auth.mjs`: real SDK against mocked HTTP, email-code verification, consent, offline changes and reconnect. This does not prove production delivery or Google setup.
- `supabase/tests/account_isolation.sql`: transactional live RLS/CAS regression; rolls back all fixtures.
- `npm run verify`: existing app regression suite.
- `npm run apk`: Android compilation and packaged-asset audit; not physical-device testing.

References: https://supabase.com/docs/guides/auth/auth-smtp, https://supabase.com/docs/guides/auth/auth-email-passwordless, https://supabase.com/docs/guides/auth/native-mobile-deep-linking
