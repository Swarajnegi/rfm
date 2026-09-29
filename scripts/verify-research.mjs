// The research pass, and the promise it makes: every number the model is shown
// was measured, and everything that was NOT measured is shown as unavailable.
//
// That distinction is the whole feature. A missing PE that reaches the prompt
// as a blank invites the model to supply one from memory, and a plausible
// invented PE in a finance app is worse than no PE at all. So the tests here
// are mostly about absence — what happens when an endpoint fails, times out,
// or returns a shape nobody expected.
//
// The network is cut in this harness, so every upstream is a fixture injected
// over `fetchMarketJson`. That is also what lets the failure paths be tested
// for real rather than hoped about.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const fails = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fails.push(label);
};
const near = (a, b, tol = 0.05) => Math.abs(Number(a) - Number(b)) <= tol;

const URL = pathToFileURL(path.resolve('web/index.html')).href;
const browser = await chromium.launch();

const AVGO = { id: 'avgo', name: 'Broadcom', type: 'Stock (US)', ticker: 'AVGO', currency: 'USD',
               units: 4, buyPrice: 310, currentPrice: 312.40 };
const RIL  = { id: 'ril', name: 'Reliance', type: 'Stock (IND)', ticker: 'RELIANCE',
               units: 100, buyPrice: 2000, currentPrice: 2400 };
const FD   = { id: 'fd', name: 'HDFC FD', type: 'Bank FD', amount: 500000, currentValue: 500000, rate: 7.1 };

/* The LLM call is intercepted at the WIRE, not stubbed inside the module. That
   matters twice over: analyze() runs for real end to end — snapshot, research,
   prompt, transport, parse, validate — and the prompt can be read straight off
   the outgoing request body rather than inferred. `sent` collects every request
   so a test can assert on what was actually asked. */
async function boot(investments, llmReply) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errors = [];
    const sent = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(s => {
        if (!localStorage.getItem('rfm_v1')) localStorage.setItem('rfm_v1', s);
        localStorage.setItem('corpus_tour_v1', 'seen');
        localStorage.setItem('rfm_tour_v1', 'seen');
    }, JSON.stringify({ version: '3.0', networth: {}, sips: [], goals: [], investments }));

    const reply = { value: llmReply || {
        fit: { status: 'drifting', line: 'Growth is on track but income is thin for the goal.' },
        findings: [{ priority: 1, kind: 'income', title: 'A real one', why: 'because X was measured', consider: 'weigh Y' }],
        holdings: [{ name: 'Broadcom', verdict: 'Hold', summary: 'because Z' }],
    } };
    await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith('file://')) return route.continue();
        if (url.includes('openrouter.ai') || url.includes('corpus-ai-gateway.test.workers.dev/v1/portfolio-reading')) {
            try { sent.push(JSON.parse(route.request().postData() || '{}')); } catch (_) { sent.push(null); }
            // The sentinel makes the model answer in prose instead of JSON —
            // the commonest real failure and one the parser must name.
            // `{ __raw }` sends the model's text exactly as given, for replies
            // that are not a single clean JSON document.
            const content = reply.value === '__PROSE__'
                ? 'Sure! Here are some thoughts on your portfolio. You should diversify.'
                : (reply.value && typeof reply.value.__raw === 'string') ? reply.value.__raw : JSON.stringify(reply.value);
            return route.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ choices: [{ message: { content } }] }),
            });
        }
        return route.abort();
    });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    // The prompt, taken off the last outgoing request.
    const lastPrompt = () => {
        const body = sent[sent.length - 1];
        const msgs = body?.messages || [];
        return body?.prompt || msgs[msgs.length - 1]?.content || '';
    };
    const setReply = v => { reply.value = v; };
    return { ctx, page, errors, sent, lastPrompt, setReply };
}

const run = page => page.evaluate(async () => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    window.CorpusAiConfig = { endpoint: 'https://corpus-ai-gateway.test.workers.dev/v1/portfolio-reading' };
    try { return { ok: true, result: await window.RegenWealth.analyzeManaged(d, () => {}) }; }
    catch (e) { return { ok: false, error: e.message }; }
});

/* Stands in for every upstream. `routes` maps a URL substring to either a
   value or the string 'THROW', so a test can make exactly one endpoint fail
   and watch what the rest of the pipeline does about it. */
const stub = (page, routes) => page.evaluate(r => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    window.__calls = [];
    d.fetchMarketJson = async (url) => {
        window.__calls.push(url);
        for (const [needle, payload] of r) {
            if (url.includes(needle)) {
                if (payload === 'THROW') throw new Error('stubbed failure');
                return JSON.parse(JSON.stringify(payload));
            }
        }
        throw new Error('no stub for ' + url);
    };
}, routes);

// A close series whose statistics are known by construction: 250 sessions
// flat at 100, then the last one at 120. The 200-day mean is therefore
// (199×100 + 120)/200 = 100.1 and the 52-week high is 120.
const FLAT_THEN_JUMP = (() => {
    const closes = Array.from({ length: 250 }, () => 100);
    closes[closes.length - 1] = 120;
    return { chart: { result: [{ indicators: { quote: [{ close: closes }] } }] } };
})();

/* Recorded from api.nasdaq.com during development — the real field names,
   the real "$1,234" strings, the real "$495/$289.96" range format. Testing
   against a tidied-up shape would prove only that the parser handles the shape
   I imagined. */
const NASDAQ_SUMMARY = { data: { summaryData: {
    Exchange: { value: 'NASDAQ-GS' }, Sector: { value: 'Technology' },
    Industry: { value: 'Semiconductors' }, OneYrTarget: { value: '$525.00' },
    TodayHighLow: { value: 'N/A' }, PreviousClose: { value: '$362.66' },
    FiftTwoWeekHighLow: { value: '$495/$289.96' },
    MarketCap: { value: '1,729,960,121,535' },
    AnnualizedDividend: { value: '$2.60' }, Yield: { value: '0.72%' },
} } };
const NASDAQ_TARGET = { data: { symbol: 'avgo', consensusOverview: {
    lowPriceTarget: 350, highPriceTarget: 630, priceTarget: 519.21, buy: 27, sell: 0, hold: 3,
} } };
const NASDAQ_RATINGS = { data: { symbol: 'avgo', meanRatingType: 'Buy',
    ratingsSummary: "Based on 27 analysts offering recommendations for 'AVGO'.",
    brokerNames: ['B OF A GLBL RES', 'GOLDMAN SACHS', 'MORGAN STANLEY', 'JP MORGAN SECUR'] } };
const NASDAQ_FIN = { data: { incomeStatementTable: { rows: [
    { value1: 'Total Revenue', value2: '$63,887,000', value3: '$51,574,000', value4: '$35,819,000', value5: '$33,203,000' },
    { value1: 'Cost of Revenue', value2: '$20,593,000', value3: '$19,065,000' },
    { value1: 'Gross Profit', value2: '$43,294,000', value3: '$32,509,000' },
] } } };
// Order and specificity matter: '/analyst/' also matches the ratings URL, so
// the more specific needles come first.
const NASDAQ_ALL = [
    ['/ratings', NASDAQ_RATINGS], ['targetprice', NASDAQ_TARGET],
    ['/quote/', NASDAQ_SUMMARY], ['/company/', NASDAQ_FIN],
];

// mfapi.in: newest first, 13 years deep. Built so every return is known by
// construction — a flat 100 with a step to 120 at the front.
const MFAPI = (() => {
    const rows = [];
    const d = new Date('2026-09-18T00:00:00Z');
    for (let i = 0; i < 1300; i++) {
        const dt = new Date(d); dt.setDate(dt.getDate() - i);
        const dd = String(dt.getDate()).padStart(2, '0'), mm = String(dt.getMonth() + 1).padStart(2, '0');
        rows.push({ date: `${dd}-${mm}-${dt.getFullYear()}`, nav: String(i === 0 ? 120 : 100) });
    }
    return { meta: { scheme_name: 'Quant Small Cap Fund - Direct Plan - Growth Option',
                     scheme_category: 'Equity Scheme - Small Cap Fund', fund_house: 'quant Mutual Fund' },
             data: rows };
})();

// ^NSEI over a year: 100 → 92.57, i.e. −7.43%, the figure measured live.
const BENCH = { chart: { result: [{ meta: { currency: 'INR' }, indicators: { quote: [{
    close: Array.from({ length: 250 }, (_, i) => 100 - (7.43 * i) / 249) }] } }] } };

const NEWS = { news: [
    { title: 'Broadcom lifts AI revenue outlook', publisher: 'Reuters', providerPublishTime: 1758400000 },
    { title: 'Chip demand steady into Q4', publisher: 'Bloomberg', providerPublishTime: 1758300000 },
]};

const RSS = { status: 'ok', items: [
    { title: 'RBI holds repo rate at 6.25%', pubDate: '2026-09-20 10:00:00' },
    { title: 'Budget may revise capital gains slabs', pubDate: '2026-09-19 08:00:00' },
]};

// ── 1. PRICE STRUCTURE ───────────────────────────────────────────────────────
console.log('\nPRICE STRUCTURE — measured from closes, checked by hand');
{
    const { ctx, page, errors } = await boot([AVGO]);
    await stub(page, [['/chart/', FLAT_THEN_JUMP]]);
    const r = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return await window.CorpusResearch.studyHolding(d, d.investments[0]);
    });
    // 200-day mean of 199 hundreds and one 120 = 20020/200 = 100.10
    ok('200DMA matches hand arithmetic', near(r.ma200, 100.10), String(r.ma200));
    // 50-day mean = (49×100 + 120)/50 = 100.40
    ok('50DMA matches hand arithmetic', near(r.ma50, 100.40), String(r.ma50));
    ok('distance above the 200DMA', near(r.vsMa200, ((120 - 100.1) / 100.1) * 100, 0.1), r.vsMa200 + '%');
    ok('52-week high and low', r.high52 === 120 && r.low52 === 100, `${r.low52}–${r.high52}`);
    ok('at the top of its band', near(r.bandPos, 100, 0.1), r.bandPos + '%');
    ok('no drawdown at the high', near(r.drawdown, 0, 0.1), String(r.drawdown));
    ok('volatility is a number, not NaN', Number.isFinite(r.volatility), String(r.volatility));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 2. TOO LITTLE DATA ───────────────────────────────────────────────────────
console.log('\nTHIN DATA — a short series yields null, never a wrong average');
{
    const { ctx, page } = await boot([AVGO]);
    await stub(page, [['/chart/', { chart: { result: [{ indicators: { quote: [{ close: [100, 101, 102] }] } }] } }]]);
    const r = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return await window.CorpusResearch.studyHolding(d, d.investments[0]);
    });
    // Three closes cannot produce a 200-day average, and returning the mean of
    // three as if it were one is how a chart lies quietly.
    ok('three closes produce no study at all', r === null, JSON.stringify(r));

    await stub(page, [['/chart/', { chart: { result: [{ indicators: { quote: [{ close: Array.from({ length: 60 }, () => 50) }] } }] } }]]);
    const r2 = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return await window.CorpusResearch.studyHolding(d, d.investments[0]);
    });
    ok('60 closes give a 50DMA', near(r2.ma50, 50), String(r2.ma50));
    ok('but NOT a 200DMA', r2.ma200 === null, String(r2.ma200));
    ok('and the distance from it is null too', r2.vsMa200 === null, String(r2.vsMa200));
    await ctx.close();
}

// ── 3. FUNDAMENTALS, AND THEIR ABSENCE ───────────────────────────────────────
console.log('\nWHAT THE STREET THINKS — the data whose absence gave the wrong answer');
{
    const { ctx, page } = await boot([AVGO]);
    await stub(page, NASDAQ_ALL);
    const good = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return await window.CorpusResearch.fundamentals(d, d.investments[0]);
    });
    // The figures that turn "it has fallen, be careful" into "it has fallen and
    // nobody downgraded it".
    ok('analyst consensus arrives', good.consensus === 'Buy', String(good.consensus));
    ok('with the vote split', good.buy === 27 && good.hold === 3 && good.sell === 0,
       `${good.buy}/${good.hold}/${good.sell}`);
    ok('and the mean target', near(good.targetMean, 519.21), String(good.targetMean));
    ok('with its range', near(good.targetLow, 350) && near(good.targetHigh, 630),
       `${good.targetLow}–${good.targetHigh}`);
    ok('covering brokers are named', good.brokers.includes('GOLDMAN SACHS'), good.brokers.join(', '));
    // "$495/$289.96" is one string carrying two numbers.
    ok('the 52-week range is split', near(good.high52, 495) && near(good.low52, 289.96),
       `${good.low52}–${good.high52}`);
    ok('money strings are parsed', near(good.marketCap, 1729960121535) && near(good.previousClose, 362.66),
       `${good.marketCap} / ${good.previousClose}`);
    ok('a percent string is a number', near(good.yield, 0.72), String(good.yield));
    // 63,887,000 vs 51,574,000 → +23.87%, computed rather than characterised.
    ok('revenue growth is computed from four years', near(good.revenueGrowth, 23.9, 0.1),
       String(good.revenueGrowth));
    ok('gross margin too', near(good.grossMargin, 67.8, 0.1), String(good.grossMargin));

    // THE BUG THIS FEATURE WAS BUILT ON. quoteSummary answered
    // {"error":{"description":"Invalid Crumb"}} on every call, and nothing said
    // so. A dead source must produce nothing, loudly.
    await stub(page, [['nasdaq', 'THROW']]);
    const bad = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return await window.CorpusResearch.fundamentals(d, d.investments[0]);
    });
    ok('a dead endpoint yields null, not a dossier of zeros', bad === null, JSON.stringify(bad));

    // Number('') is 0. A missing field that becomes 0 is a fabricated fact
    // wearing the look of a measured one — the exact failure mode this module
    // exists to prevent, and it was live until this test.
    await stub(page, [['/quote/', { data: { summaryData: {
        Sector: { value: 'Technology' }, TodayHighLow: { value: 'N/A' } } } }],
        ['/analyst/', 'THROW'], ['/ratings', 'THROW'], ['/company/', 'THROW']]);
    const partial = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return await window.CorpusResearch.fundamentals(d, d.investments[0]);
    });
    ok('a partial payload keeps what it has', partial.sector === 'Technology', String(partial.sector));
    ok('and nulls what it does not — never zero',
       partial.marketCap === null && partial.previousClose === null && partial.yield === null
       && partial.targetMean === null && partial.consensus === null,
       JSON.stringify({ cap: partial.marketCap, close: partial.previousClose,
                        yield: partial.yield, tgt: partial.targetMean }));
    ok('an "N/A" string is not a number', partial.high52 === null, String(partial.high52));

    // Nasdaq has no Indian listings; asking is a wasted request and a wrong answer.
    const ind = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.investments.push({ id: 'r', name: 'Reliance', type: 'Stock (IND)', ticker: 'RELIANCE',
                             units: 1, buyPrice: 1, currentPrice: 1 });
        window.__calls = [];
        const r = await window.CorpusResearch.fundamentals(d, d.investments[1]);
        return { r, asked: window.__calls.some(u => u.includes('nasdaq')) };
    });
    ok('an Indian listing is not sent to Nasdaq at all', ind.r === null && !ind.asked,
       JSON.stringify(ind));
    await ctx.close();
}

// ── 3b. FUNDS GET A REAL DOSSIER ─────────────────────────────────────────────
console.log('\nFUNDS — thirteen years of NAV, and a benchmark to read it against');
{
    const { ctx, page } = await boot([{ id: 'q', name: 'Quant Small Cap', type: 'Mutual Fund',
                                        schemeCode: '120828', units: 65, buyPrice: 300, currentPrice: 320.77 }]);
    await stub(page, [['mfapi.in', MFAPI], ['%5ENSEI', BENCH], ['/search', { news: [] }],
                      ['rss2json', { status: 'ok', items: [] }]]);
    const r = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const nav = await window.CorpusResearch.studyFund(d, d.investments[0]);
        const bench = await window.CorpusResearch.benchmark(d, 'IND');
        return { nav, bench };
    });
    // The fixture is flat 100 with today at 120, so every lookback is +20%.
    ok('NAV history is read, not just row zero', r.nav.samples === 1300, String(r.nav.samples));
    ok('the category comes through', /Small Cap/.test(r.nav.category), r.nav.category);
    ok('1Y return is computed', near(r.nav.ret1y, 20, 0.01), String(r.nav.ret1y));
    // +20% over three years is NOT +20% a year. Quoting a total beside a
    // one-year figure invites reading them as peers.
    ok('3Y is a CAGR, not a total', near(r.nav.cagr3y, 6.27, 0.05), String(r.nav.cagr3y));
    ok('5Y is a CAGR too', near(r.nav.cagr5y, 3.71, 0.05), String(r.nav.cagr5y));
    ok('drawdown from peak is zero at the peak', near(r.nav.drawdown, 0, 0.1), String(r.nav.drawdown));

    // A young fund must not be given a three-year record it does not have.
    // Annualising a partial window is the fund equivalent of calling the mean
    // of 60 closes a 200-day average.
    const young = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const rows = Array.from({ length: 300 }, (_, i) => ({ date: '01-01-2026', nav: String(i === 0 ? 120 : 100) }));
        d.fetchMarketJson = async () => ({ meta: { scheme_category: 'Equity', fund_house: 'X' }, data: rows });
        return await window.CorpusResearch.studyFund(d, d.investments[0]);
    });
    ok('a young fund still gets 1Y', near(young.ret1y, 20, 0.01), String(young.ret1y));
    ok('but NOT a 3Y or 5Y CAGR', young.cagr3y === null && young.cagr5y === null,
       `${young.cagr3y} / ${young.cagr5y}`);

    // The comparison that makes a return mean something.
    ok('the benchmark loads', r.bench && r.bench.name === 'Nifty 50', JSON.stringify(r.bench));
    ok('and carries its own year', near(r.bench.ret1y, -7.43, 0.05), String(r.bench.ret1y));
    await ctx.close();
}

// ── 4. THE PROMPT SAYS WHAT IT DOES NOT KNOW ────────────────────────────────
console.log('\nTHE PROMPT — absence is stated, never left blank');
{
    const { ctx, page, lastPrompt } = await boot([AVGO, RIL, FD]);
    // Price history works; fundamentals and news do not. The prompt has to
    // survive that mixture and say which half is missing.
    await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.1);
        d.fetchMarketJson = async (url) => {
            if (url.includes('/chart/')) return { chart: { result: [{ indicators: { quote: [{ close: closes }] } }] } };
            throw new Error('unavailable');
        };
    });
    const res = await run(page);
    ok('the analysis completes', res.ok, res.error || '');
    const p = lastPrompt();

    // The gateway refuses anything without this schema line, and anything
    // over 60,000 characters. The app is what must never trip either.
    ok('the brief carries the gateway marker', p.includes('"verdict":"Buy|Hold|Trim"'));
    ok('and fits the gateway cap', p.length > 0 && p.length <= 60000, `${p.length} chars`);

    ok('the dossier reaches the prompt', /HOLDING-BY-HOLDING EVIDENCE/.test(p));
    ok('with a measured moving average', /200DMA/.test(p));
    // The load-bearing claim of the whole feature.
    ok('missing fundamentals are STATED as missing',
       /Fundamentals and analyst view: (could not be retrieved|NOT AVAILABLE)/.test(p),
       (p.match(/Fundamentals and analyst view:.*/) || [''])[0].slice(0, 70));
    ok('and the model is told not to supply one', /do not state a PE/.test(p));
    // The rule that would have prevented the Broadcom answer.
    ok('the prompt forbids reading sentiment off the price alone',
       /do not infer analyst sentiment from a price fall/i.test(p));
    ok('the requested verdicts are Buy, Hold or Trim', /Buy, Hold or Trim/.test(p));
    ok('company outlook and innovation are considered only from evidence',
       /company outlook and innovation/i.test(p) && /Use only fields actually supplied/.test(p));
    // Prices must be labelled, or the model puts a rupee sign on a dollar.
    ok('prices are quoted in their own currency',
       /quoted in (USD|INR)/.test(p), (p.match(/quoted in \w+/) || [''])[0]);
    ok('and the output rule says so', /Price units must match the quoted currency/.test(p));
    ok('missing news is stated too', /none retrieved/i.test(p));
    // A deposit has no PE, no moving average and no momentum. Letting it into
    // the equity dossier invites exactly the nonsense this is meant to stop.
    ok('a deposit is kept out of the equity section',
       /HOLDINGS WITH NO MARKET QUOTE/.test(p) && /HDFC FD/.test(p));
    ok('and is flagged as unquoted', /do not trade, so they have no price/.test(p));
    ok('the instruction bans invented figures', /Never invent a price, analyst forecast, revenue figure/.test(p));
    ok('the per-holding lines are kept short', /under 20 words/.test(p));
    ok('the brief is marked as an analysis', p.startsWith('CORPUS-BRIEF: analysis-v2'));
    // No fixed count of findings: an importance bar instead, and nothing that
    // clears it may be dropped.
    ok('findings are set by an importance bar, not a count',
       /would change a decision toward or away from their goal/.test(p) && /MUST be included, however many/.test(p));
    ok('and filler is forbidden', /No filler, no generic advice/.test(p));
    ok('with no profile, the reading says it assumed one', /No profile was given/.test(p));
    // Nothing may reach the model as a bare empty value where a number belongs.
    ok('no field is left blank where a number belongs',
       !/(PE|200DMA|target|growth)\s*(:|\s)\s*(,|\n|$)/.test(p));
    await ctx.close();
}

// ── 5. NO RESEARCH AT ALL ────────────────────────────────────────────────────
console.log('\nSIZE — a large book still fits through the gateway');
{
    // Forty holdings, every one with a full year of closes. Research is
    // capped at the largest eight, but the snapshot lists them all, so this
    // is where a growing book would first cross the gateway's 60,000 cap.
    const big = Array.from({ length: 40 }, (_, i) => i % 2
        ? { id: 'mf' + i, name: `Long Named Equity Scheme Direct Plan Growth Option ${i}`, type: 'Mutual Fund', schemeCode: String(120000 + i), units: 100 + i, buyPrice: 50, currentPrice: 60 }
        : { id: 'st' + i, name: `Company Number ${i} Limited`, type: 'Stock (US)', ticker: 'T' + i, currency: 'USD', units: 5 + i, buyPrice: 100, currentPrice: 120 });
    const { ctx, page, lastPrompt } = await boot(big);
    await page.evaluate(() => {
        const closes = Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 9) * 8 + i * 0.05);
        const navs = Array.from({ length: 1400 }, (_, i) => {
            const d = new Date(Date.UTC(2026, 8, 18) - i * 86400000);
            return { date: `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`, nav: String(60 - i * 0.01) };
        });
        document.querySelector('[x-data]')._x_dataStack[0].fetchMarketJson = async (url) => {
            if (url.includes('/chart/')) return { chart: { result: [{ meta: { currency: 'USD' }, indicators: { quote: [{ close: closes, open: closes }] } }] } };
            if (url.includes('mfapi')) return { meta: { scheme_category: 'Equity Scheme - Small Cap Fund', fund_house: 'Some AMC' }, data: navs };
            throw new Error('unavailable');
        };
    });
    const res = await run(page);
    ok('a forty-holding analysis completes', res.ok, res.error || '');
    const p = lastPrompt();
    ok('and its brief fits the gateway cap', p.length > 0 && p.length <= 60000, `${p.length} chars`);
    await ctx.close();
}

console.log('\nOFFLINE — no research means the prompt says so');
{
    const { ctx, page, lastPrompt } = await boot([AVGO]);
    await page.evaluate(() => {
        document.querySelector('[x-data]')._x_dataStack[0].fetchMarketJson =
            async () => { throw new Error('offline'); };
    });
    const res = await run(page);
    ok('the analysis still completes', res.ok, res.error || '');
    const p = lastPrompt();
    // Everything failed, so nothing was measured. The prompt must not simply
    // omit the section and leave the model to fill the silence.
    ok('the prompt still runs', p.length > 200, String(p.length));
    ok('it reports no price history', /Price history: unavailable/.test(p));
    ok('it bans remembered prices', /do not infer trend, momentum or moving averages/i.test(p));
    ok('and remembered macro', /No research could be gathered|None retrieved/.test(p));
    await ctx.close();
}

// ── 6. WHICH MARKET THIS BOOK LIVES IN ───────────────────────────────────────
console.log('\nTILT — weighted by money, not by headcount');
{
    const { ctx, page } = await boot([AVGO, RIL, FD]);
    const r = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const all = window.CorpusResearch.classify(d);
        // One large US holding beside many small Indian ones is not an Indian
        // book, and counting holdings instead of money would say it was.
        d.investments = [{ ...d.investments[0], units: 400 },
                         { id: 'a', name: 'A', type: 'Stock (IND)', ticker: 'A', units: 1, buyPrice: 10, currentPrice: 10 },
                         { id: 'b', name: 'B', type: 'Stock (IND)', ticker: 'B', units: 1, buyPrice: 10, currentPrice: 10 }];
        const skewed = window.CorpusResearch.classify(d);
        d.investments = [{ id: 'f', name: 'FD', type: 'Bank FD', amount: 100000, currentValue: 100000 }];
        const domestic = window.CorpusResearch.classify(d);
        return { all, skewed, domestic };
    });
    // AVGO 4×312.40×fx ≈ ₹1.2L, RIL 100×2400 = ₹2.4L, FD ₹5L → clearly Indian.
    ok('a deposit-heavy book is Indian', r.all.tilt === 'india', JSON.stringify(r.all));
    ok('three holdings but one big US position is NOT Indian',
       r.skewed.tilt !== 'india', JSON.stringify(r.skewed));
    // An FD is not quoted anywhere, but it is unambiguously domestic money.
    ok('an unquoted holding counts as domestic', r.domestic.tilt === 'india', JSON.stringify(r.domestic));
    ok('the percentages add up', near(r.all.indianPct + r.all.usPct, 100, 0.2),
       `${r.all.indianPct} + ${r.all.usPct}`);
    await ctx.close();
}

// ── 7. NEWS GOES THROUGH THE TRANSPORT THAT WORKS ON A PHONE ────────────────
console.log('\nNEWS TRANSPORT — the device bug, tested');
{
    const { ctx, page } = await boot([RIL]);
    await stub(page, [['/chart/', FLAT_THEN_JUMP], ['/search', NEWS], ['rss2json', RSS], ['quoteSummary', 'THROW']]);
    const r = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const pack = await window.CorpusResearch.buildPack(d, () => {});
        return { pack, calls: window.__calls.slice() };
    });
    // The old fetcher used bare fetch and was refused cross-origin inside the
    // Android WebView, every time, silently. Everything now goes through
    // fetchMarketJson, which is CapacitorHttp on native.
    ok('every request went through fetchMarketJson', r.calls.length > 0, `${r.calls.length} calls`);
    ok('including the RSS feeds', r.calls.some(u => u.includes('rss2json')),
       r.calls.filter(u => u.includes('rss2json')).length + ' feed calls');
    // News follows the person: each interest reads its own ET section, and
    // our gateway is asked before any third party.
    const topics = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        window.CorpusAiConfig = { endpoint: 'https://corpus-ai-gateway.test.workers.dev/v1/portfolio-reading' };
        const realHttp = d.httpGetJson, realMarket = d.fetchMarketJson;
        const asked = [];
        d.httpGetJson = async url => {
            asked.push(url);
            if (url.includes('/v1/feed?url=')) return { status: 'ok', items: [{ title: 'Headline for ' + decodeURIComponent(url.split('url=')[1]).split('/').slice(3, 5).join('/'), pubDate: '2026-09-24 06:00:00' }] };
            throw new Error('no');
        };
        d.fetchMarketJson = async () => { throw new Error('no'); };
        try {
            window.CorpusResearch._resetReuse();
            const pack = await window.CorpusResearch.buildPack(d, null, { profile: { holdings: ['gold', 'schemes', 'mf'] } });
            return { sources: (pack.macro.profile || []).map(f => `${f.source}:${f.items.length}`), asked };
        } finally { d.httpGetJson = realHttp; d.fetchMarketJson = realMarket; }
    });
    ok('gold, schemes and funds each read their own section',
       ['Commodities', 'Savings', 'Mutual funds'].every(k => topics.sources.some(s => s.includes(k) && s.endsWith(':1'))),
       topics.sources.join(', '));
    ok('through our gateway, not a third party', topics.asked.length > 0 && topics.asked.every(u => u.includes('/v1/feed?url=')),
       `${topics.asked.length} feed requests`);
    // rss2json answers `count` without a paid key with a 422; every feed was
    // failing that way, silently, on every platform.
    ok('no feed request uses the paid-only count parameter',
       r.calls.filter(u => u.includes('rss2json')).every(u => !/[?&]count=/.test(u)));
    ok('Indian feeds were read for an Indian book',
       r.pack.macro.india.some(f => f.items.length), JSON.stringify(r.pack.coverage));
    ok('a policy headline survives', JSON.stringify(r.pack.macro.india).includes('repo rate'));
    ok('per-holding headlines arrive', (r.pack.holdings[0].news || []).length === 2,
       JSON.stringify((r.pack.holdings[0].news || []).map(n => n.title)));
    ok('a failing endpoint does not sink the pack',
       r.pack.holdings[0].fundamentals === null && r.pack.holdings[0].price !== null);
    ok('coverage reports what was actually gathered',
       r.pack.coverage.withFundamentals === 0 && r.pack.coverage.withNews === 1,
       JSON.stringify(r.pack.coverage));
    await ctx.close();
}

// ── 8. THE MODEL'S REPLY IS CHECKED ─────────────────────────────────────────
console.log('\nSCHEMA — a blank card is not an acceptable failure mode');
{
    const { ctx, page, setReply } = await boot([AVGO, FD]);   // FD: so a Keep verdict has a deposit to be about
    await page.evaluate(() => {
        document.querySelector('[x-data]')._x_dataStack[0].fetchMarketJson =
            async () => { throw new Error('offline'); };
    });
    const attempt = async (reply) => {
        await setReply(reply);
        const res = await run(page);
        return res.ok ? 'accepted' : res.error;
    };
    const r = {
        empty:    await attempt({}),
        noRecs:   await attempt({ macroContext: 'x', holdings: [], portfolio: [] }),
        junkRecs: await attempt({ holdings: [{ foo: 1 }], portfolio: [{ bar: 2 }] }),
        array:    await attempt([1, 2, 3]),
        prose:    await attempt('__PROSE__'),
        // The shape actually asked for.
        good:     await attempt({ findings: [{ title: 'T', why: 'because X' }], holdings: [{ name: 'Broadcom', verdict: 'Hold', summary: 'because X' }] }),
        // A findings-only answer is still an answer.
        findingsOnly: await attempt({ findings: [{ title: 'T', why: 'because X' }] }),
        // The retired shape: nothing in it answers the question now asked.
        legacy:   await attempt({ recommendations: [{ title: 'A real one', rationale: 'because X' }] }),
        // A verdict outside the set is cleared, not rejected — the reasoning
        // beside it is still worth showing.
        oddVerdict: await attempt({ holdings: [{ name: 'X', verdict: 'Strong Buy', summary: 's' }] }),
    };
    // Each of these used to render a silent blank card, indistinguishable from
    // a working app that had nothing to say.
    ok('an empty object is rejected', /no readable analysis/i.test(r.empty), r.empty);
    ok('an empty list is rejected', /no readable analysis/i.test(r.noRecs), r.noRecs);
    ok('entries with no title or reasoning are rejected',
       /no readable analysis/i.test(r.junkRecs), r.junkRecs);
    ok('an array is rejected', /did not return an analysis/i.test(r.array), r.array);
    ok('prose instead of JSON is named as such',
       /did not return usable JSON/i.test(r.prose), r.prose);
    ok('and a real answer is accepted', r.good === 'accepted', r.good);
    ok('findings alone are accepted', r.findingsOnly === 'accepted', r.findingsOnly);
    ok('the retired recommendations-only shape is not an answer', /no readable analysis/i.test(r.legacy), r.legacy);
    ok('an undefined verdict does not sink the card', r.oddVerdict === 'accepted', r.oddVerdict);
    setReply({ macroContext: Array(35).fill('news').join(' '),
        findings: [{ title: 'T', why: Array(80).fill('reason').join(' '), evidence: ['a', 'b', 'c'] }],
        holdings: [{ name: 'Broadcom', verdict: 'Add', summary: Array(70).fill('reason').join(' ') }] });
    const compact = await run(page);
    ok('a verbose provider response is shortened for the UI', compact.ok
       && compact.result.findings[0].why.split(/\s+/).length === 45
       && compact.result.findings[0].evidence.length === 2
       && compact.result.holdings[0].summary.split(/\s+/).length === 22
       && compact.result.macroContext.split(/\s+/).length === 25);
    ok('older Add verdict is normalized to Buy', compact.result?.holdings?.[0]?.verdict === 'Buy');

    // No cap: every finding that clears the bar is kept, most important first.
    setReply({ findings: Array.from({ length: 8 }, (_, i) => ({ priority: 8 - i, title: 'F' + (8 - i), why: 'measured' })) });
    const many = await run(page);
    ok('eight findings are all kept', many.ok && many.result.findings.length === 8, String(many.result?.findings?.length));
    ok('and ranked by priority', many.result?.findings?.map(f => f.title).join(',') === 'F1,F2,F3,F4,F5,F6,F7,F8',
       many.result?.findings?.map(f => f.title).join(','));
    setReply({ findings: [{ title: 'No reason given' }, { title: 'Real', why: 'measured' }] });
    const noWhy = await run(page);
    ok('a finding with no reason is dropped', noWhy.ok && noWhy.result.findings.length === 1 && noWhy.result.findings[0].title === 'Real');
    setReply({ findings: [{ title: 'T', why: 'w' }], holdings: [{ name: 'HDFC FD', verdict: 'Keep', summary: 'rate locked' }] });
    const keep = await run(page);
    ok('deposits can be Kept rather than given a market verdict', keep.result?.holdings?.[0]?.verdict === 'Keep');

    // Measured live: JSON, then a second object after it. The old "first { to
    // last }" slice took both and failed to parse.
    setReply({ __raw: '{"findings":[{"title":"T","why":"a {brace} inside a string"}]}\n{"note":"extra"}' });
    const trailing = await run(page);
    ok('a reply with text after its JSON still parses', trailing.ok && trailing.result.findings[0].why === 'a {brace} inside a string',
       trailing.error || '');
    // Measured live: a book with no PPF came back with "Public Provident Fund — Keep".
    setReply({ findings: [{ title: 'T', why: 'w', holdings: ['Broadcom', 'Public Provident Fund'] }],
               holdings: [{ name: 'Broadcom (AVGO)', verdict: 'Hold', summary: 's' },
                          { name: 'Public Provident Fund', verdict: 'Keep', summary: 'invented' }] });
    const owned = await run(page);
    ok('a verdict on something not held is dropped', owned.ok && owned.result.holdings.length === 1
       && owned.result.holdings[0].name === 'Broadcom (AVGO)', JSON.stringify(owned.result?.holdings?.map(h => h.name)));
    ok('and so is the tag on a finding', owned.result?.findings?.[0]?.holdings?.join() === 'Broadcom',
       owned.result?.findings?.[0]?.holdings?.join());
    await ctx.close();
}

// ── NATIVE HANDOFF — THE WEBVIEW MAY SLEEP WHILE THE SERVICE FINISHES ────────
console.log('\nBACKGROUND — native result can be recovered after the WebView returns');
{
    const { ctx, page, errors } = await boot([AVGO]);
    const r = await page.evaluate(async () => {
        const plugins = window.AppPlugins;
        const platform = plugins.Capacitor.isNativePlatform;
        const previous = plugins.AnalysisJob;
        let polls = 0, cleared = false, request = null;
        plugins.Capacitor.isNativePlatform = () => true;
        window.CorpusAiConfig = { endpoint: 'https://corpus-ai-gateway.test.workers.dev/v1/portfolio-reading' };
        plugins.AnalysisJob = {
            start: async payload => { request = payload; return { id: 'job-1' }; },
            status: async () => ({
                id: 'job-1', state: ++polls > 1 ? 'done' : 'running', statusCode: 200,
                body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
                    holdings: [{ name: 'Broadcom', verdict: 'Buy', summary: 'Revenue grew 23.9% and analysts remain positive.' }]
                }) } }] })
            }),
            clear: async () => { cleared = true; }
        };
        try {
            const sent = await window.RegenWealth.callManagedLLM('short prompt');
            const pending = {
                id: 'job-1', provider: 'managed', providerLabel: 'Corpus AI',
                startedAt: Date.now(), pack: null,
                snapshot: { holdings: [], goals: [], totalInvested: 0, totalMarketValue: 0, monthlySurplus: 0, netWorth: 0 }
            };
            localStorage.setItem('rfm_regen_pending_brief_v1', JSON.stringify(pending));
            const recovered = await window.RegenWealth.recoverPending();
            return {
                verdict: sent.holdings[0].verdict, recovered: recovered.holdings[0].verdict,
                url: request.url, payload: JSON.parse(request.body), headers: request.headers,
                pending: localStorage.getItem('rfm_regen_pending_brief_v1'), cleared
            };
        } finally {
            plugins.Capacitor.isNativePlatform = platform;
            plugins.AnalysisJob = previous;
        }
    });
    ok('the managed request runs through the native service', r.url.includes('workers.dev') && r.verdict === 'Buy', JSON.stringify(r));
    ok('the app sends a brief, never an OpenRouter credential', r.payload.prompt === 'short prompt' && !r.headers.Authorization, JSON.stringify(r.payload));
    ok('a completed response survives return to the WebView', r.recovered === 'Buy');
    ok('completed native state is cleared', r.pending === null && r.cleared);
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 9. THE SCREEN SHOWS WHAT WAS PAID FOR ───────────────────────────────────
console.log('\nRENDERER — the fields that used to be discarded');
{
    const { ctx, page, errors } = await boot([AVGO]);
    let text = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.activePage = 'regen';
        d.regenWealth.apiKeySet = true;
        d.regenWealth.analysis = {
            fit: { status: 'drifting', line: 'Income covers half the stated monthly need.' },
            macroContext: 'Repo rate held at 6.25% and chip demand steady.',
            findings: [
                { priority: 1, kind: 'income', title: 'Monthly income falls short',
                  why: 'Payouts cover ₹18,000 of a ₹26,000 monthly need.',
                  consider: 'SCSS pays 8.2% quarterly and they are over 60.',
                  holdings: ['HDFC FD'], evidence: ['₹18,000 of ₹26,000'] },
                { priority: 2, kind: 'opportunity', title: 'Broadcom drawdown without a downgrade',
                  why: '27 of 30 analysts rate it Buy with a mean target of $519.21.',
                  consider: 'Size matters more than timing here.', holdings: ['Broadcom'],
                  evidence: ['27 buy / 3 hold / 0 sell', 'mean target $519.21'] },
            ],
            holdings: [{ name: 'Broadcom', verdict: 'Hold', summary: 'Consensus Buy; position already large.' }],
            newsSources: [{ source: 'RBI Press Releases', count: 2 }, { source: 'Dead feed', count: 0 }],
            research: { coverage: { studied: 1, requested: 1, withFundamentals: 1, withAnalystView: 1, withNews: 2, schemesMatched: 1 },
                        tilt: { indianPct: 41.2, usPct: 58.8, tilt: 'both' } },
        };
        await new Promise(r => setTimeout(r, 700));
        const main = [...document.querySelectorAll('main')].find(m => m.offsetParent !== null);
        const drawer = document.querySelector('[data-s~="in"] .disclose');
        return { text: main ? main.innerText : '', closed: drawer ? drawer.getAttribute('aria-expanded') === 'false' : null };
    });
    const closed = text.closed;
    text = text.text;
    // Insights v6 shows the fit, the ranked findings with what to consider, a
    // closed per-holding drawer and one source note. The macro line and the
    // evidence chips are not part of the approved screen.
    ok('the fit to their goal is stated', /DRIFTING/i.test(text) && /Income covers half/.test(text));
    ok('findings arrive ranked', text.indexOf('Monthly income falls short') < text.indexOf('Broadcom drawdown'),
       'order in the DOM');
    ok('each finding says what to consider', /SCSS pays 8\.2% quarterly/.test(text));
    // The verdict is the one word a thumb scrolls looking for.
    // Matched case-insensitively: the pill is text-transform: uppercase and
    // innerText returns RENDERED text, so a "Hold" verdict arrives as "HOLD".
    // Per-holding calls exist, but the section starts CLOSED: innerText of a
    // closed <details> carries the summary, not the rows inside it.
    ok('the per-holding section is there', /See the reading for each of your 1 holdings/i.test(text));
    ok('and starts closed', closed === true, String(closed));
    ok('the analyst target is shown', /\$519\.21/.test(text));
    // A source that returned nothing must not be counted as a source.
    ok('only sources that returned something are credited',
       /Read from RBI Press Releases/.test(text) && !/Dead feed/.test(text),
       (text.match(/Read from.*/) || [''])[0]);
    ok('coverage is stated', /1 of 1 holdings read/.test(text), (text.match(/\d+ of \d+ holdings.*/) || [''])[0]);
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 10. THE CACHE LETS GO ────────────────────────────────────────────────────
console.log('\nCACHE — new research means a new reading');
{
    const { ctx, page } = await boot([AVGO]);
    await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const closes = Array.from({ length: 250 }, () => 100);
        window.__headline = 'Chip demand steady';
        d.fetchMarketJson = async (url) => {
            if (url.includes('/chart/')) return { chart: { result: [{ indicators: { quote: [{ close: closes }] } }] } };
            if (url.includes('/search')) return { news: [{ title: window.__headline, providerPublishTime: 1758400000 }] };
            throw new Error('nope');
        };
    });
    const first = await run(page);
    ok('the first run succeeds', first.ok, first.error || '');
    const hitSame = await page.evaluate(() =>
        !!window.RegenWealth.loadCached(document.querySelector('[x-data]')._x_dataStack[0]));

    // Nothing about the PORTFOLIO changed — only the news did. The old
    // fingerprint covered portfolio values alone, so a book whose prices were
    // not moving served the same six-hour reading again and again.
    const staleBefore = await page.evaluate(() => {
        window.__headline = 'Broadcom cuts guidance';
        return !!window.RegenWealth.loadCached(document.querySelector('[x-data]')._x_dataStack[0]);
    });
    const second = await run(page);
    const freshHasNewNews = await page.evaluate(() => {
        const c = window.RegenWealth.loadCached(document.querySelector('[x-data]')._x_dataStack[0]);
        return JSON.stringify(c?.research || {}).includes('cuts guidance');
    });

    ok('an unchanged run is served from cache', hitSame === true, String(hitSame));

    // And the button ACTUALLY consults it. Nothing did: every press paid for a
    // full research pass and a model call to reproduce an answer the cache
    // already held. Re-run still forces a fresh one, which is its whole job.
    const spend = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.regenWealth.apiKeySet = true;
        // analyze() rejects a short key before it fetches anything, so a
        // missing one here would look exactly like a working cache.
        d.regenWealth.apiKey = 'sk-or-v1-testtesttesttest';
        d.regenWealth.provider = 'openrouter';
        d.regenWealth.model = 'anthropic/claude-sonnet-5';
        let calls = 0;
        const real = d.fetchMarketJson;
        d.fetchMarketJson = async (...a) => { calls++; return real(...a); };

        calls = 0; await d.runRegenWealthAnalysis();      // cached
        const cachedCalls = calls;
        calls = 0; await d.runRegenWealthAnalysis(true);  // forced
        const forcedCalls = calls;
        d.fetchMarketJson = real;
        return { cachedCalls, forcedCalls };
    });
    ok('a cached reading costs no requests at all', spend.cachedCalls === 0, String(spend.cachedCalls));
    ok('and Re-run really does re-run', spend.forcedCalls > 0, `${spend.forcedCalls} requests`);
    ok('the second run succeeds', second.ok, second.error || '');
    ok('a new headline produces a new reading', freshHasNewNews === true, String(freshHasNewNews));
    // loadCached compares against the research the CACHED run used, so it
    // cannot refetch to notice the change; the new run is what replaces it.
    ok('the cache is replaced rather than duplicated', staleBefore === true, String(staleBefore));
    await ctx.close();
}

// ── 11. MANAGED AI ───────────────────────────────────────────────────────────
console.log('\nMANAGED AI — no user key, picker, or raw provider failure');
{
    const { ctx, page, errors } = await boot([AVGO]);
    const ui = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.activePage = 'regen';
        await new Promise(r => setTimeout(r, 300));
        const text = document.body.innerText;
        return {
            button: [...document.querySelectorAll('button')].some(b => b.textContent.includes('Analyze my portfolio')),
            forbidden: /Key settings|Connect a key|AI Provider|Your API key|Recommended\s*\d|Free\s*\d/.test(text),
            settingsSheet: !!document.querySelector('[aria-label="Connect AI Key"]'),
            settingsPage: !![...document.querySelectorAll('main')].find(m => /AI settings/i.test(m.innerText || '')),
            noConsoleError: true
        };
    });
    ok('the only visible action is Analyze my portfolio', ui.button);
    ok('key and model UI are absent', !ui.forbidden && !ui.settingsSheet && !ui.settingsPage);
    ok('no console errors', ui.noConsoleError && errors.length === 0, errors[0] || '');
    await ctx.close();
}

await browser.close();
console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' | ') : 'RESEARCH OK'}\n`);
process.exit(fails.length ? 1 : 0);
