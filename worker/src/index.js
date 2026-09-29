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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-corpus-client'
};

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function fail(status, message, detail) {
    return json({ error: { message, ...(detail ? { detail } : {}) } }, status);
}

// MoSPI publishes all-India combined CPI monthly, not a live daily quote. The
// catalogue identifies the official Annexure IV; the annexure supplies the
// combined inflation column. Never replace the last verified client value on
// a malformed or unavailable release.
export async function latestCpi(fetcher = fetch) {
    const catalogue = await fetcher('https://api.mospi.gov.in/api/esankhyiki/cms/golden-sheet/list?product=CPI&page=1&limit=10',
        { signal: AbortSignal.timeout(9000) });
    if (!catalogue.ok) throw new Error('MoSPI catalogue unavailable');
    const body = await catalogue.json();
    const entry = (body.data || []).find(x => /^All India Combined \(General\) level index and inflation/.test(x.table_name || ''));
    if (!entry || !/^\w+ \d{4}$/.test(entry.ref_period || '') || !/^\d{1,2} \w{3} \d{4}$/.test(entry.release_date || ''))
        throw new Error('MoSPI release metadata invalid');
    const match = /https:\/\/datawrapper\.dwcdn\.net\/[A-Za-z0-9]+\/\d+\//.exec(entry.data_wrapper_iframe_embeded_code || '');
    if (!match) throw new Error('MoSPI annexure link invalid');
    const csv = await fetcher(match[0] + 'data.csv', { signal: AbortSignal.timeout(9000) });
    if (!csv.ok) throw new Error('MoSPI annexure unavailable');
    const rows = (await csv.text()).split(/\r?\n/).filter(x => /^[A-Z][a-z]{2}-\d{2}\*?,/.test(x));
    const last = rows.at(-1)?.split(',');
    const month = last?.[0]?.replace('*', '');
    const rate = Number(last?.[6]);
    const [referenceName, referenceYear] = entry.ref_period.split(' ');
    const expected = `${referenceName.slice(0, 3)}-${referenceYear.slice(-2)}`;
    if (month !== expected || !Number.isFinite(rate) || rate < -10 || rate > 40)
        throw new Error('MoSPI combined CPI figure does not match its release');
    return { rate, referenceMonth: entry.ref_period, releasedOn: entry.release_date,
             source: 'MoSPI, All India Combined CPI (General), Annexure IV',
             sourceUrl: 'https://esankhyiki.mospi.gov.in/catalogue-main/catalogue?product=CPI',
             fetchedAt: new Date().toISOString() };
}

async function cpiResponse(request) {
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const key = new Request(new URL('/v1/cpi/latest', request.url).toString());
    const hit = cache && await cache.match(key);
    if (hit) return hit;
    try {
        const result = new Response(JSON.stringify(await latestCpi()), {
            headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=21600' }
        });
        if (cache) await cache.put(key, result.clone());
        return result;
    } catch (error) {
        return fail(503, 'Published CPI is temporarily unavailable.', { reason: String(error.message || error).slice(0, 120) });
    }
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

/* Crash reports from web/crash.js. Written to the Worker's log (Cloudflare
   Workers Logs, observability enabled in wrangler.toml) and nowhere else. The
   client scrubs amounts, numbers, emails and paths before sending; this side
   bounds every field again, because the endpoint is public and its input is
   untrusted. Read them with `npx wrangler tail` or the dashboard's Logs tab. */
const CRASH_FIELDS = { kind: 20, message: 300, source: 120, stack: 1200, version: 20, platform: 20, ua: 160 };
async function crash(request, env) {
    if (env.CRASH_LIMIT) {
        const { success } = await env.CRASH_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
        if (!success) return new Response(null, { status: 429, headers: JSON_HEADERS });
    }
    if (Number(request.headers.get('content-length') || 0) > 8192) return new Response(null, { status: 413, headers: JSON_HEADERS });
    let input;
    // Arrives as text/plain from sendBeacon (no preflight) or JSON from fetch.
    try { input = JSON.parse((await request.text()).slice(0, 8192)); }
    catch (_) { return new Response(null, { status: 400, headers: JSON_HEADERS }); }
    if (!input || typeof input !== 'object' || !input.message) return new Response(null, { status: 400, headers: JSON_HEADERS });
    const report = { event: 'crash', at: new Date().toISOString(), country: request.cf?.country || null };
    for (const [k, max] of Object.entries(CRASH_FIELDS)) report[k] = String(input[k] ?? '').slice(0, max);
    report.line = Number.isFinite(Number(input.line)) ? Number(input.line) : null;
    report.col = Number.isFinite(Number(input.col)) ? Number(input.col) : null;
    console.log(JSON.stringify(report));
    return new Response(null, { status: 204, headers: JSON_HEADERS });
}

/* Market data for the browser build. Browsers cannot call these sources
   directly (no CORS), and the free public relays it used before rate-limited
   and saw every ticker a user holds. This forwards ONLY to the exact sources
   the app reads, each with an edge-cache lifetime, so it cannot serve as an
   open proxy and repeat requests do not reach the source at all. */
const MARKET_SOURCES = [
    // Query strings allow what encodeURIComponent leaves unescaped (' ( ) ! * ~),
    // so a search for "Dr. Reddy's" is not refused.
    { re: /^https:\/\/query[12]\.finance\.yahoo\.com\/v8\/finance\/chart\/[^?#\/]+\?[\w=&%.\-!'()*~]*$/, ttl: 120 },
    { re: /^https:\/\/query[12]\.finance\.yahoo\.com\/v1\/finance\/search\?[\w=&%.\-+!'()*~]*$/, ttl: 3600 },
    { re: /^https:\/\/api\.nasdaq\.com\/api\/(quote|analyst|company)\/[A-Za-z.\-]{1,12}\/[\w\-]+(\?[\w=&%.\-]*)?$/, ttl: 1800 },
    { re: /^https:\/\/api\.mfapi\.in\/mf\/(\d{3,8}|search\?q=[\w%+.\-!'()*~]*)$/, ttl: 1800 },
    { re: /^https:\/\/api\.rss2json\.com\/v1\/api\.json\?(count=\d+&)?rss_url=[\w%.\-]+$/, ttl: 900 },
    { re: /^https:\/\/portal\.amfiindia\.com\/spages\/NAVAll\.txt$/, ttl: 3600 },
];
const BROWSER_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-IN,en;q=0.9',
};
async function market(request, env) {
    if (env.MARKET_LIMIT) {
        const { success } = await env.MARKET_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
        if (!success) return fail(429, 'Too many market requests. Please wait a minute.', { stage: 'market-limit' });
    }
    const target = new URL(request.url).searchParams.get('u') || '';
    const source = MARKET_SOURCES.find(s => s.re.test(target));
    if (!source) return fail(400, 'Not an allowed market source.', { stage: 'market-allowlist' });
    let upstream;
    try {
        upstream = await fetch(target, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(12000),
                                         cf: { cacheTtl: source.ttl, cacheEverything: true } });
    } catch (_) {
        return fail(504, 'The market source did not answer.', { stage: 'market-upstream' });
    }
    const headers = { ...JSON_HEADERS, 'content-type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
                      'cache-control': `public, max-age=${Math.min(source.ttl, 300)}` };
    return new Response(upstream.body, { status: upstream.status, headers });
}

/* News feeds, read here and returned in rss2json's shape so the app's reader
   is unchanged. rss2json itself cannot sit behind this Worker: its free tier
   limits requests per IP per day, and Cloudflare's shared egress had spent the
   day's allowance before any request of ours ("Daily rate limit exceeded"). It
   had also started refusing its own `count` parameter without a paid key.
   Reading the RSS here removes that third party altogether. */
// Economic Times section feeds only: Google News refuses most requests from
// Cloudflare (503), and a source that fails four times in five is not one.
const FEED_SOURCES = [
    { re: /^https:\/\/economictimes\.indiatimes\.com\/[a-z0-9\/\-]+\/rssfeeds\/\d+\.cms$/, ttl: 900 },
];
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeXml(s) {
    return String(s || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
        .replace(/<[^>]+>/g, '')
        .trim();
}
function parseRss(xml, max = 10) {
    const items = [];
    for (const m of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
        const title = decodeXml((m[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
        const pubDate = decodeXml((m[1].match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1]);
        // rss2json's date format ("2026-09-24 06:00:00"), which the app reads
        // by its first ten characters; RSS's "Wed, 24 Sep 2026" would print as
        // "Wed, 24 Se".
        const t = Date.parse(pubDate);
        if (title) items.push({ title: title.slice(0, 300),
                                pubDate: Number.isFinite(t) ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : null });
        if (items.length >= max) break;
    }
    return items;
}
async function feed(request, env) {
    if (env.MARKET_LIMIT) {
        const { success } = await env.MARKET_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
        if (!success) return fail(429, 'Too many requests. Please wait a minute.', { stage: 'feed-limit' });
    }
    const target = new URL(request.url).searchParams.get('url') || '';
    const source = FEED_SOURCES.find(s => s.re.test(target));
    if (!source) return fail(400, 'Not an allowed news feed.', { stage: 'feed-allowlist' });
    let res;
    try {
        res = await fetch(target, { headers: { ...BROWSER_HEADERS, accept: 'application/rss+xml, application/xml, text/xml' },
                                    signal: AbortSignal.timeout(10000), cf: { cacheTtl: source.ttl, cacheEverything: true } });
    } catch (_) {
        return fail(504, 'The news feed did not answer.', { stage: 'feed-upstream' });
    }
    if (!res.ok) return json({ status: 'error', message: `feed answered ${res.status}` }, 502);
    const items = parseRss(await res.text());
    return new Response(JSON.stringify({ status: 'ok', items }),
                        { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=300' } });
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });
        const path = new URL(request.url).pathname;
        if (request.method === 'POST' && path === '/v1/crash') return crash(request, env);
        if (request.method === 'GET' && path === '/v1/market') return market(request, env);
        if (request.method === 'GET' && path === '/v1/feed') return feed(request, env);
        if (request.method === 'GET' && path === '/v1/cpi/latest') return cpiResponse(request);
        if (request.method !== 'POST' || path !== '/v1/portfolio-reading') {
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
