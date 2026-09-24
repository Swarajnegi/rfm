# Corpus AI gateway

This Worker keeps the OpenRouter key off every APK and browser bundle. It uses
only the internal free-model fallback chain in `src/index.js`; users never see
or choose a provider or model.

1. Create a free Cloudflare account, then run `npx wrangler login` in this folder.
2. Deploy once with `npx wrangler deploy`.
3. Add your OpenRouter key without committing it: `npx wrangler secret put OPENROUTER_API_KEY`.
4. Copy the deployed `https://…workers.dev` URL into `web/ai-service-config.js`, keeping `/v1/portfolio-reading`.
5. Run `npm run apk` from the repository root.

Never place the OpenRouter key in `wrangler.toml`, `web/`, Android resources,
or source control. Free endpoints can still be rate-limited or temporarily
unavailable; the Worker automatically tries the internal fallback chain first.
