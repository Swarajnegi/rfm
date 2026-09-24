/*
 * Public deployment configuration only. This file intentionally contains no
 * credential. The Worker owns the provider credential, so the same protected
 * service is used by every app without exposing an API key in the APK.
 */
window.CorpusAiConfig = Object.freeze({
    endpoint: 'https://corpus-ai-gateway.swarajnegi999.workers.dev/v1/portfolio-reading'
});
