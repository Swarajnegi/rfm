/* Crash reports from real phones.

   Until this, an error on someone else's phone was invisible: the app broke,
   they stopped opening it, and nothing ever said why. Uncaught errors and
   unhandled promise rejections are now sent to the app's own gateway, which
   writes them to Cloudflare's logs. No third-party SDK, so no new company
   receives anything.

   What leaves the phone is the ERROR, never the portfolio: message, file,
   line, a few stack frames, app version, platform. Before sending, anything
   that could be the user's data is scrubbed — money amounts, long numbers,
   email addresses, full file paths. At most five reports per session, and
   the same error is sent once.

   Loaded first and without `defer`, so it is listening before anything else
   can throw. The endpoint is read lazily from ai-service-config.js, which
   loads later. */
(function () {
    'use strict';

    const MAX_PER_SESSION = 5;
    const seen = new Set();
    let sent = 0;

    function scrub(text, max) {
        return String(text || '')
            .replace(/(?:₹|\$|rs\.?\s?|inr\s?|usd\s?)\s?[\d,]+(?:\.\d+)?/gi, '<amount>')
            .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
            .replace(/\b\d[\d,]{4,}(?:\.\d+)?\b/g, '<number>')
            .replace(/(?:file|https?|capacitor):\/\/[^\s)]*\/([^/\s)]+)/g, '$1')
            .slice(0, max);
    }

    function endpoint() {
        const ai = String(window.CorpusAiConfig?.endpoint || '');
        return /^https:\/\//.test(ai) ? ai.replace(/\/v1\/[^/]+$/, '/v1/crash') : null;
    }

    function report(kind, message, source, line, col, stack) {
        const msg = scrub(message, 300);
        const key = `${kind}|${msg}|${source}|${line}`;
        if (!msg || seen.has(key) || sent >= MAX_PER_SESSION) return;
        const url = endpoint();
        if (!url) return;
        seen.add(key);
        sent++;
        const native = !!window.AppPlugins?.Capacitor?.isNativePlatform?.();
        const body = JSON.stringify({
            kind, message: msg,
            source: scrub(source, 120), line: Number(line) || null, col: Number(col) || null,
            stack: scrub(String(stack || '').split('\n').slice(0, 6).join('\n'), 1200),
            version: String(window.CorpusAiConfig?.version || 'unknown'),
            platform: native ? 'android-app' : (/iPhone|iPad/.test(navigator.userAgent) ? 'ios-web' : 'web'),
            ua: scrub(navigator.userAgent, 160),
        });
        try {
            if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
        } catch (_) { /* fall through to fetch */ }
        try { fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {}); }
        catch (_) { /* a crash reporter must never itself throw */ }
    }

    window.addEventListener('error', e => {
        // Resource load failures (an image, a font) arrive here too, with no
        // message; they are not crashes.
        if (!e.message) return;
        report('error', e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
    });
    window.addEventListener('unhandledrejection', e => {
        const r = e.reason;
        report('rejection', (r && r.message) || String(r), '', null, null, r && r.stack);
    });

    window.CorpusCrash = { report, scrub };
})();
