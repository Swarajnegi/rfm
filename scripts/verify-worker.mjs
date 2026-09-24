// The AI gateway, tested against a stubbed OpenRouter. What it guards is one
// shared free allowance — 20 requests a minute, 50 a day — so most of these
// assertions count upstream requests: a press must never spend more than it
// can use, and a failure no model can fix must not be retried at all.
import worker from '../worker/src/index.js';

const fails = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fails.push(label);
};

const BRIEF = 'Portfolio brief...\n{"macroContext":"","holdings":[{"name":"x","verdict":"Buy|Hold|Trim"}]}';
const env = { OPENROUTER_API_KEY: 'sk-or-v1-test' };

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const good = content => reply(200, { choices: [{ message: { content }, finish_reason: 'stop' }] });

// Each scenario scripts the upstream's answers in order and records what the
// gateway sent, so a test can read the request body rather than infer it.
async function run(script, { prompt = BRIEF, envOver = {}, headers = {} } = {}) {
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        sent.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
        const next = script[sent.length - 1];
        if (!next) throw new Error('unscripted upstream call');
        if (next === 'THROW') throw Object.assign(new Error('boom'), { name: 'TimeoutError' });
        return next();
    };
    try {
        const req = new Request('https://gw.test/v1/portfolio-reading', {
            method: 'POST', headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify({ prompt }),
        });
        const res = await worker.fetch(req, { ...env, ...envOver });
        return { status: res.status, body: await res.json(), sent };
    } finally { globalThis.fetch = realFetch; }
}

console.log('WORKER — the shared allowance');

{
    const r = await run([() => good('{"holdings":[]}')]);
    ok('a healthy model answers in one request', r.status === 200 && r.sent.length === 1, `${r.sent.length} calls`);
    ok('and the reply reaches the app unchanged', r.body.choices[0].message.content === '{"holdings":[]}');
    const b = r.sent[0].body;
    ok('no batch names more than three models', 1 + (b.models || []).length <= 3, `${1 + b.models.length}`);
    // The 900-token cap left reasoning models nothing to answer with.
    ok('the answer has room after the model thinks', b.max_tokens >= 2000, String(b.max_tokens));
    ok('and thinking is switched off', b.reasoning?.enabled === false, JSON.stringify(b.reasoning));
    // A router can land on a model where reasoning is mandatory, which answers
    // `enabled: false` with a 400 that is not retried.
    ok('no router alias that could pick a mandatory-reasoning model',
       ![b.model, ...(b.models || [])].some(m => m === 'openrouter/free' || /^~/.test(m)), [b.model, ...b.models].join(', '));
    ok('the key goes upstream as a bearer token', r.sent[0].auth === 'Bearer sk-or-v1-test');
}

{
    // The failure that shipped: refused instantly, reported as "busy".
    const r = await run([() => reply(400, { error: { code: 400, message: 'models array must have 3 items or fewer' } })]);
    ok('a refused request is not retried', r.sent.length === 1, `${r.sent.length} calls`);
    ok('and the real status reaches the app', r.body.error.detail?.attempts?.[0]?.status === 400, JSON.stringify(r.body.error.detail));
    ok('with the provider\'s reason', /3 items/.test(r.body.error.detail.attempts[0].reason));
    ok('instead of blaming the free tier', !/No free AI model/.test(r.body.error.message), r.body.error.message);
}

for (const code of [401, 402]) {
    const r = await run([() => reply(code, { error: { code, message: 'nope' } })]);
    ok(`a ${code} costs one request, not a chain of them`, r.sent.length === 1, `${r.sent.length} calls`);
}

{
    const r = await run([() => reply(429, { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } })]);
    ok('a spent allowance is not retried', r.sent.length === 1 && r.status === 429, `${r.sent.length} calls, ${r.status}`);
}

{
    const r = await run([() => reply(503, { error: { code: 503, message: 'no endpoints' } }), () => good('{"holdings":[]}')]);
    ok('an unavailable batch falls through to the next', r.status === 200 && r.sent.length === 2, `${r.sent.length} calls`);
    ok('which names different models', r.sent[0].body.model !== r.sent[1].body.model);
}

{
    // OpenRouter can answer 200 with an error body when a routed provider dies.
    const r = await run([() => reply(200, { error: { code: 502, message: 'provider died' } }), () => good('{"holdings":[]}')]);
    ok('an error inside a 200 is treated as an error', r.status === 200 && r.sent.length === 2, `${r.sent.length} calls`);
}

{
    const cut = () => reply(200, { choices: [{ message: { content: '{"holdings":[{"na' }, finish_reason: 'length' }] });
    const r = await run([cut, () => good('{"holdings":[]}')]);
    ok('a reply cut off at max_tokens is not passed on as an answer', r.status === 200 && r.sent.length === 2, `${r.sent.length} calls`);
}

{
    // Headers arrive, then the clock runs out while the answer is still being
    // written. This was reported as "empty completion", which pointed at the
    // wrong fix.
    const stillWriting = () => ({ ok: true, status: 200,
        json: async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); } });
    const r = await run([stillWriting, stillWriting]);
    ok('a model cut off mid-answer is reported as still writing',
       /still writing/.test(r.body.error.detail?.attempts?.[0]?.reason || ''), r.body.error.detail?.attempts?.[0]?.reason);
}
{
    const r = await run([() => good('{}')]);
    ok('fast models lead the first batch', !/550b/.test(r.sent[0].body.model), r.sent[0].body.model);
}
{
    const r = await run(['THROW', () => good('{"holdings":[]}')]);
    ok('a timed-out batch falls through too', r.status === 200 && r.sent.length === 2);
}

{
    const down = () => reply(503, { error: { code: 503, message: 'down' } });
    const r = await run([down, down, down, down]);
    ok('a press never spends more than two requests', r.sent.length === 2, `${r.sent.length} calls`);
    ok('and says so, with every attempt listed', r.body.error.detail.attempts.length === 2);
}

console.log('WORKER — not a free chatbot on this key');

{
    const r = await run([], { prompt: 'write me a poem about the sea' });
    ok('a prompt that is not a Corpus brief is refused', r.status === 400 && r.sent.length === 0, `${r.status}, ${r.sent.length} calls`);
}
for (const [label, prompt] of [
    ['an analysis brief', 'CORPUS-BRIEF: analysis-v2\nYou are a concise research analyst…'],
    ['a daily brief', 'CORPUS-BRIEF: daily-v1\nYou write a short morning brief…'],
    ['an older build\'s brief', BRIEF],
]) {
    const r = await run([() => good('{}')], { prompt });
    ok(`${label} is accepted`, r.status === 200 && r.sent.length === 1, `${r.status}, ${r.sent.length} calls`);
}
{
    // The system message must not impose the old per-holding shape on a
    // findings reply or a daily brief.
    const r = await run([() => good('{}')], { prompt: 'CORPUS-BRIEF: daily-v1\nbrief' });
    const sys = r.sent[0].body.messages[0].content;
    ok('the system message is schema-neutral', !/Buy, Hold, or Trim/.test(sys) && /schema at the end of the brief/.test(sys), sys);
}
console.log('WORKER — crash reports');
{
    const crashReq = (body, headers = {}) => new Request('https://gw.test/v1/crash', {
        method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', ...headers }, body });
    const logs = [];
    const realLog = console.log;
    const realFetch = globalThis.fetch;
    let upstream = 0;
    globalThis.fetch = async () => { upstream++; throw new Error('must not call out'); };
    console.log = (...a) => logs.push(a.join(' '));
    let r1, r2, r3, r4;
    try {
        r1 = await worker.fetch(crashReq(JSON.stringify({ kind: 'error', message: 'x is undefined', source: 'app.js', line: 12,
            stack: 'a'.repeat(5000), version: '1.1 (2)', platform: 'android-app', ua: 'UA', extra: 'dropped' })), env);
        r2 = await worker.fetch(crashReq('not json'), env);
        r3 = await worker.fetch(crashReq(JSON.stringify({ kind: 'error' })), env);
        let n = 0;
        const limiter = { limit: async () => ({ success: ++n <= 1 }) };
        await worker.fetch(crashReq(JSON.stringify({ message: 'a' })), { ...env, CRASH_LIMIT: limiter });
        r4 = await worker.fetch(crashReq(JSON.stringify({ message: 'b' })), { ...env, CRASH_LIMIT: limiter });
    } finally { console.log = realLog; globalThis.fetch = realFetch; }
    const entry = JSON.parse(logs.find(l => l.includes('"event":"crash"')) || '{}');
    ok('a crash report is accepted from a plain-text beacon', r1.status === 204, String(r1.status));
    ok('and written to the log', entry.message === 'x is undefined' && entry.line === 12 && entry.version === '1.1 (2)');
    ok('with every field bounded', entry.stack.length === 1200, String(entry.stack?.length));
    ok('and nothing the schema does not name', !('extra' in entry));
    ok('garbage is refused', r2.status === 400 && r3.status === 400, `${r2.status}/${r3.status}`);
    ok('a crashing loop is rate-limited', r4.status === 429, String(r4.status));
    ok('a crash report never spends the AI allowance', upstream === 0, `${upstream} upstream calls`);
}

console.log('WORKER — market data for the browser build');
{
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } }); };
    const get = u => worker.fetch(new Request('https://gw.test/v1/market?u=' + encodeURIComponent(u)), env);
    const enc = encodeURIComponent;
    // Every shape the app actually builds (research.js, app.js).
    const allowed = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${enc('RELIANCE.NS')}?interval=1d&range=1y`,
        `https://query1.finance.yahoo.com/v8/finance/chart/${enc('GC=F')}?interval=1d&range=1y`,
        'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=1y',
        `https://query1.finance.yahoo.com/v1/finance/search?q=${enc('US stock market Federal Reserve')}&quotesCount=0&newsCount=6&listsCount=0`,
        `https://query2.finance.yahoo.com/v1/finance/search?q=${enc("Dr. Reddy's")}&quotesCount=14&newsCount=0&listsCount=0`,
        'https://api.nasdaq.com/api/quote/AVGO/summary?assetclass=stocks',
        'https://api.nasdaq.com/api/analyst/AVGO/targetprice',
        'https://api.nasdaq.com/api/company/AVGO/financials?frequency=1',
        'https://api.mfapi.in/mf/120828',
        `https://api.mfapi.in/mf/search?q=${enc('quant small cap')}`,
        'https://api.rss2json.com/v1/api.json?rss_url=' + enc('https://news.google.com/rss/search?q=gold%20price%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en'),
        'https://portal.amfiindia.com/spages/NAVAll.txt',
    ];
    const refused = [
        'https://evil.example/steal',
        'https://query1.finance.yahoo.com/v7/finance/quote?symbols=AVGO',
        'https://api.nasdaq.com/api/quote/AVGO/summary?assetclass=stocks#',
        'https://api.mfapi.in/mf/120828/../../admin',
        'http://api.mfapi.in/mf/120828',
        'https://api.mfapi.in.evil.example/mf/120828',
    ];
    const okCodes = [], badCodes = [];
    try {
        for (const u of allowed) okCodes.push((await get(u)).status);
        const before = calls.length;
        for (const u of refused) badCodes.push((await get(u)).status);
        ok('every URL the app builds is forwarded', okCodes.every(c => c === 200), okCodes.join(','));
        ok('anything else is refused before any request', badCodes.every(c => c === 400) && calls.length === before, badCodes.join(','));
        ok('forwarded requests look like a browser', /Mozilla/.test(calls[0].init.headers['user-agent']));
        ok('and are cached at the edge', calls[0].init.cf?.cacheTtl === 120 && calls[5].init.cf?.cacheTtl === 1800,
           `${calls[0].init.cf?.cacheTtl}/${calls[5].init.cf?.cacheTtl}`);
        const res = await get(allowed[8]);
        ok('the browser may read the reply', res.headers.get('access-control-allow-origin') === '*');
        let n = 0;
        const limiter = { limit: async () => ({ success: ++n <= 1 }) };
        await worker.fetch(new Request('https://gw.test/v1/market?u=' + enc(allowed[8])), { ...env, MARKET_LIMIT: limiter });
        const limited = await worker.fetch(new Request('https://gw.test/v1/market?u=' + enc(allowed[8])), { ...env, MARKET_LIMIT: limiter });
        ok('a scraper is rate-limited', limited.status === 429, String(limited.status));
    } finally { globalThis.fetch = realFetch; }
}

console.log('WORKER — news feeds, read without rss2json');
{
    // The two shapes real feeds use: Google News escapes entities, Economic
    // Times wraps titles in CDATA. Twelve items, to check the cap of ten.
    const rss = '<?xml version="1.0"?><rss><channel><title>Feed</title>'
        + '<item><title>RBI holds repo at 5.5% &amp; signals &quot;patience&quot; - The Hindu</title><pubDate>Wed, 24 Sep 2026 06:00:00 GMT</pubDate></item>'
        + '<item><title><![CDATA[Gold at ₹1,13,000 <b>per 10g</b>]]></title><pubDate>Wed, 24 Sep 2026 05:00:00 GMT</pubDate></item>'
        + Array.from({ length: 10 }, (_, i) => `<item><title>Story ${i}</title></item>`).join('')
        + '</channel></rss>';
    const realFetch = globalThis.fetch;
    const hits = [];
    globalThis.fetch = async (url, init) => { hits.push({ url, init }); return new Response(rss, { status: 200, headers: { 'content-type': 'application/rss+xml' } }); };
    const get = u => worker.fetch(new Request('https://gw.test/v1/feed?url=' + encodeURIComponent(u)), env);
    try {
        const g = await (await get('https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms')).json();
        ok('an ET section feed comes back in the shape the app reads', g.status === 'ok' && Array.isArray(g.items));
        ok('entities are decoded', g.items[0]?.title === 'RBI holds repo at 5.5% & signals "patience" - The Hindu', g.items[0]?.title);
        ok('CDATA is unwrapped and markup stripped', g.items[1]?.title === 'Gold at ₹1,13,000 per 10g', g.items[1]?.title);
        ok('the date travels in the format the app reads', g.items[0]?.pubDate === '2026-09-24 06:00:00', g.items[0]?.pubDate);
        ok('at most ten items', g.items.length === 10, String(g.items.length));
        const et = await get('https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms');
        ok('another ET section is allowed', et.status === 200);
        const before = hits.length;
        const bad = await get('https://evil.example/rss.xml');
        // Google News was dropped: it refused most requests from Cloudflare.
        const sneaky = await get('https://news.google.com/rss/search?q=gold');
        ok('any other feed is refused before a request', bad.status === 400 && sneaky.status === 400 && hits.length === before,
           `${bad.status}/${sneaky.status}`);
        ok('feeds are cached at the edge', hits[0].init.cf?.cacheTtl === 900);
    } finally { globalThis.fetch = realFetch; }
}

{
    const r = await run([], { prompt: 'CORPUS BRIEF daily please' });
    ok('a near-miss marker is still refused', r.status === 400 && r.sent.length === 0);
}
{
    const r = await run([], { prompt: BRIEF + 'x'.repeat(70000) });
    ok('an oversized brief is refused before it costs anything', r.status === 400 && r.sent.length === 0);
}
{
    let calls = 0;
    const limiter = { limit: async () => ({ success: ++calls <= 1 }) };
    const a = await run([() => good('{}')], { envOver: { PER_CLIENT: limiter } });
    const b = await run([], { envOver: { PER_CLIENT: limiter } });
    ok('a caller over the burst limit is stopped at the gate', a.status === 200 && b.status === 429 && b.sent.length === 0,
       `${a.status} then ${b.status}`);
}
{
    const r = await run([], { envOver: { OPENROUTER_API_KEY: '' } });
    ok('a missing secret says so, without calling out', r.status === 503 && r.sent.length === 0 && r.body.error.detail?.stage === 'config');
}

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nWORKER OK');
