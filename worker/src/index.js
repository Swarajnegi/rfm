/*
 * Corpus AI gateway. The OpenRouter key lives here as a secret and never in
 * the APK; every install shares it, so every request is spent from ONE free
 * allowance: 20 a minute and 50 a day, or 1,000 a day once the account has
 * ever bought $10 of credit. The design follows from that number.
 *
 * - Fallbacks go in BATCHES of three models per upstream request, not one
 *   request per model and not one request naming ten. OpenRouter caps the
 *   equivalent `fallbacks` list at three and the old ten-model list was
 *   refused in under a second; one request per model would spend a day's
 *   allowance in five presses.
 * - At most MAX_ATTEMPTS upstream requests per press, and only for failures
 *   another model could fix. A bad key or an empty allowance fails the same
 *   way on every model, so retrying it only spends more.
 * - The real upstream status travels back in `detail`. The previous version
 *   turned every failure into "no free model is available", which is how a
 *   request rejected in 0.6s was read as the free tier being busy.
 */

// Every model here can have reasoning switched OFF (OpenRouter /models,
// `reasoning.mandatory: false`, checked 2026-09-23). That matters twice:
// measured live, Ling spent 3,232 of 4,000 tokens thinking and was cut off
// before writing any JSON — it has no effort levels, so `effort: 'low'` was
// ignored. And a model where reasoning IS mandatory answers `enabled: false`
// with a 400, which is why `openrouter/free` is not in this list: it routes to
// whatever free model is up, including mandatory-reasoning ones.
const BATCHES = [
    ['inclusionai/ling-3.0-flash-fin:free', 'google/gemma-4-31b-it:free', 'qwen/qwen3.8-27b:free'],
    ['nex-agi/nex-n2.5-pro:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free'],
];
const MAX_ATTEMPTS = BATCHES.length;
// The first batch gets most of the budget. A model that is WRITING should be
// allowed to finish: killing it at half-time and starting a second model from
// zero wastes both. The second batch exists for fast failures.
const TOTAL_BUDGET_MS = 85000;
const FIRST_ATTEMPT_MS = 70000;
const MAX_PROMPT_CHARS = 60000;
// Every brief the app builds starts with one of these lines. It does not make
// the endpoint private — nothing shipped in an APK can — but it stops the
// gateway from working as a general free chatbot on this key. The last entry
// is the schema line older builds end with, kept so an installed app still
// works until it is replaced.
const BRIEF_MARKERS = ['CORPUS-BRIEF: analysis-v2', 'CORPUS-BRIEF: daily-v1', '"verdict":"Buy|Hold|Trim"'];

const JSON_HEADERS = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-corpus-client'
};

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function fail(status, message, detail) {
    return json({ error: { message, ...(detail ? { detail } : {}) } }, status);
}

// Failures a different model can plausibly fix. 429 is deliberately absent:
// from OpenRouter it usually means the shared allowance is spent, and the next
// batch would be refused for the same reason.
const RETRYABLE = new Set([408, 500, 502, 503, 504]);

const USER_MESSAGE = {
    400: 'Corpus AI could not read this request. Please update the app.',
    401: 'Corpus AI is not configured correctly.',
    402: 'Corpus AI is paused on the provider side.',
    403: 'Corpus AI was refused by the provider.',
    429: 'Corpus AI has reached its limit for now. Please try again later.',
};

async function attempt(env, models, prompt, timeoutMs) {
    const started = Date.now();
    let res;
    try {
        res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                'content-type': 'application/json',
                'authorization': 'Bearer ' + env.OPENROUTER_API_KEY,
                'x-title': 'Corpus Portfolio Advisor'
            },
            body: JSON.stringify({
                model: models[0],
                models: models.slice(1),
                messages: [
                    // Schema-neutral: the brief itself defines the shape. This
                    // used to hard-code Buy/Hold/Trim per holding, which would
                    // fight the findings and daily-brief schemas.
                    { role: 'system', content: 'Return only compact valid JSON matching the schema at the end of the brief. Use only the evidence supplied.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2,
                // The brief already contains the research; the model's job is
                // to read it and write JSON, not to think at length. Thinking
                // is charged against max_tokens, and left on it consumed the
                // whole budget. 4000 is then room for an uncapped list of
                // findings plus the collapsed per-holding lines.
                max_tokens: 4000,
                reasoning: { enabled: false }
            })
        });
    } catch (e) {
        return { ok: false, retry: true, status: 504, reason: e?.name === 'TimeoutError' ? 'timeout' : 'network', ms: Date.now() - started };
    }

    // Headers arrive at once; the answer streams in behind them. A timeout
    // here is the model still writing, not an empty reply.
    let body;
    try { body = await res.json(); }
    catch (e) {
        const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        return { ok: false, retry: true, status: timedOut ? 504 : 502,
                 reason: timedOut ? 'timed out while the model was still writing' : 'unreadable reply', ms: Date.now() - started };
    }
    const ms = Date.now() - started;
    if (!res.ok || body?.error) {
        const status = res.ok ? Number(body.error.code) || 502 : res.status;
        return { ok: false, retry: RETRYABLE.has(status), status, reason: String(body?.error?.message || res.statusText || '').slice(0, 200), ms };
    }
    const choice = body?.choices?.[0];
    const content = choice?.message?.content;
    // What actually happened, for `detail`: an empty answer and a cut-off
    // answer have different fixes, and so does a model that thought for its
    // whole budget and wrote nothing.
    const why = { finish: choice?.finish_reason || null, model: body?.model || null,
                  tokens: body?.usage ? { out: body.usage.completion_tokens,
                                          reasoning: body.usage.completion_tokens_details?.reasoning_tokens ?? null } : null };
    if (choice?.finish_reason === 'length') {
        return { ok: false, retry: true, status: 502, reason: 'completion cut off at max_tokens', ms, ...why };
    }
    if (typeof content !== 'string' || !content.trim()) {
        return { ok: false, retry: true, status: 502, reason: 'empty completion', ms, ...why };
    }
    return { ok: true, content, ms };
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });
        if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/portfolio-reading') {
            return fail(404, 'Not found.');
        }
        if (!env.OPENROUTER_API_KEY) return fail(503, 'Corpus AI is not configured yet.', { stage: 'config' });

        // Per-caller burst limit, so one device or one script cannot drain the
        // shared allowance. Optional: a deploy without the binding still works.
        if (env.PER_CLIENT) {
            const who = request.headers.get('cf-connecting-ip') || 'unknown';
            const { success } = await env.PER_CLIENT.limit({ key: who });
            if (!success) return fail(429, 'Please wait a minute before analysing again.', { stage: 'client-limit' });
        }

        if (Number(request.headers.get('content-length') || 0) > MAX_PROMPT_CHARS * 2) {
            return fail(413, 'Portfolio brief is too large.');
        }
        let input;
        try { input = await request.json(); }
        catch (_) { return fail(400, 'Invalid portfolio brief.'); }
        const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
        if (!prompt || prompt.length > MAX_PROMPT_CHARS || !BRIEF_MARKERS.some(m => prompt.includes(m))) {
            return fail(400, 'Invalid portfolio brief.', { stage: 'validate' });
        }

        const deadline = Date.now() + TOTAL_BUDGET_MS;
        const tried = [];
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            const left = deadline - Date.now();
            if (left < 5000) break;
            const r = await attempt(env, BATCHES[i], prompt, i === MAX_ATTEMPTS - 1 ? left : Math.min(left, FIRST_ATTEMPT_MS));
            if (r.ok) return json({ choices: [{ message: { content: r.content } }], attempts: i + 1 });
            tried.push({ batch: i + 1, status: r.status, reason: r.reason, ms: r.ms,
                         ...(r.model ? { model: r.model, finish: r.finish, tokens: r.tokens } : {}) });
            if (!r.retry) break;
        }

        const last = tried[tried.length - 1] || { status: 503 };
        const status = last.status === 429 ? 429 : 503;
        return fail(status,
            USER_MESSAGE[last.status] || 'No free AI model is available right now. Please try again shortly.',
            { stage: 'upstream', attempts: tried });
    }
};
