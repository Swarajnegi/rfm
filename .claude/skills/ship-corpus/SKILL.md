---
name: ship-corpus
description: Release Corpus (rfm_2.0) end to end. Bump the version in all four places, run the full verify suite, build the signed APK, deploy the iPhone web app, and upload the APK to gofile with a checksum check. Use it whenever a Corpus change is finished and the user will test it, or when they ask to build, ship, release or deploy, ask for the APK, a link, or whether "the apk / web app is updated". Use it after any batch of fixes they asked for.
---

# Ship Corpus

Run every step in order and stop at the first failure. Report exactly what failed; never ship past a red test.

All commands run from `E:\J.A.R.V.I.S\rfm_2.0` (Git Bash: `cd /e/J.A.R.V.I.S/rfm_2.0`).

## 1. Version: all four places, or none

Read the current version from `android/app/build.gradle` (`versionCode N`, `versionName "X"`). Choose the next one:
- a fix → patch (3.1 → 3.1.1)
- new screens or features → minor (3.1 → 3.2)

Always versionCode + 1. Then update all four:

| File | Pattern |
|---|---|
| `android/app/build.gradle` | `versionCode N` and `versionName "X"` |
| `web/ai-service-config.js` | `version: 'X (N)'` |
| `scripts/verify-crash.mjs` | `r.version === 'X (N)'` |
| `web/index.html` | `<div class="t-meta">Corpus X</div>` (Settings footer) |

Check that all four agree: `grep -n "versionCode\|versionName" android/app/build.gradle; grep -o "version: '[^']*'" web/ai-service-config.js; grep -o "r.version === '[^']*'" scripts/verify-crash.mjs; grep -o 'Corpus [0-9.]*</div>' web/index.html`

## 2. Build and verify

```bash
npm run build
npm run verify > "$SCRATCH/verify.log" 2>&1; echo exit $?
grep -E "^\s*FAIL|FAILED|Error:" "$SCRATCH/verify.log" | head; grep -c PASS "$SCRATCH/verify.log"
```

- The suite takes about 10 minutes. Run it with `run_in_background` or a 900000 ms timeout.
- Exit must be 0 and the log must end `ALL CHECKS PASSED`.
- If a test fails, fix the cause. Change a test only when the behaviour change was intended, and say which test changed and why.

## 3. Signed APK

```bash
npm run apk -- --release --out rfm-X.apk 2>&1 | grep -E "MiB|verified|wrong|Error"
```

Expect `(release, signed with the upload key)` and `verified: native bridge packaged, web layer matches web/ on disk`.

## 4. iPhone web app

```bash
npx wrangler deploy --config wrangler.web.toml 2>&1 | grep -E "Success|Version ID|error"
curl -s https://corpus-app.swarajnegi999.workers.dev/ai-service-config.js | grep -o "version: '[^']*'"
```

The live version must equal the new one.

## 5. Upload the APK

```bash
curl -s -F "file=@rfm-X.apk" https://upload.gofile.io/uploadfile | grep -o '"downloadPage":"[^"]*"\|"md5":"[^"]*"'
md5sum rfm-X.apk
```

If the upload prints nothing, retry once. The md5 must match the local file.

## 6. Report

Give both links, one line on what changed for the user, the test count, and what was not verified. There is no physical phone attached; say so.

Never commit or push unless asked. Never touch `android/keystore*`, `*.jks` or `android/keystore.properties`.
