/* THE BIG PICTURE
 *
 * The AI panel kept saying the same thing — "51% US exposure, consider
 * reducing" — and the reason was not the model. It was the input. Everything
 * the model received was allocation percentages, and there is exactly one
 * sentence you can write from an allocation percentage. It had no price
 * history, no moving average, no valuation, no earnings, and on Android no
 * news either (the old feed path used bare fetch, which a WebView refuses
 * cross-origin, and the failure was swallowed).
 *
 * This module is the fix: it gathers EVIDENCE the model cannot invent, so the
 * reasoning has something real to be about.
 *
 * THE FLOW
 *   1. classify()      — is this book Indian, international, or both? That
 *                        decides which macro sources are worth fetching.
 *   2. studyHolding()  — per quoted holding: a year of closes from the chart
 *                        endpoint the app ALREADY calls successfully, turned
 *                        into 50/200-day averages, a 52-week position, recent
 *                        momentum and realised volatility.
 *   3. fundamentals()  — PE, margins, revenue growth, analyst target. Yahoo
 *                        often gates this behind a crumb, so it is BEST EFFORT
 *                        and records null on failure. A null reaches the prompt
 *                        as "unavailable", which is the whole difference
 *                        between an honest gap and an invented number.
 *   4. headlines()     — per-ticker news from the search endpoint the app
 *                        already uses for symbol lookup, plus Indian policy
 *                        feeds when the book warrants them.
 *   5. buildPack()     — assembles the above, in parallel, with a wall clock.
 *
 * NOTHING HERE ESTIMATES. Every field is either measured or null. A number
 * that could not be fetched must never become a number that looks fetched.
 */
(function () {
    'use strict';

    // A research pass must not hold the user hostage. Anything still in flight
    // when the clock runs out is simply absent from the pack.
    const BUDGET_MS = 12000;
    const PER_CALL_MS = 6000;
    const MAX_STUDIED = 8;       // holdings, largest first
    const MAX_NEWS_PER_HOLDING = 2;

    const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '') ? Number(v) : null;
    const pct = (a, b) => (num(a) !== null && num(b) !== null && b !== 0) ? ((a - b) / b) * 100 : null;
    const round = (v, d = 2) => v === null ? null : Math.round(v * 10 ** d) / 10 ** d;

    /* Yahoo wraps its numbers as {raw, fmt}. Sometimes. Other times it is a
       bare number, and in a third case the key is missing entirely. */
    const raw = v => (v && typeof v === 'object' && 'raw' in v) ? num(v.raw) : num(v);

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
        ]);
    }

/* The wall clock, shared by every request in one pass.

       BUDGET_MS used to be a constant that was declared, exported, and enforced
       nowhere — while the header above described a pass "with a wall clock".
       One slow host could therefore hold the whole research pass for its full
       per-call timeout, repeatedly, and the only bound was luck.

       A module-level deadline is safe here because a pass is never re-entrant:
       runRegenWealthAnalysis guards on regenWealth.loading. */
    let deadline = 0;

    /* Every request goes through the app's own fetchMarketJson: native-first
       with a real User-Agent via CapacitorHttp, relays in the browser. The
       previous news fetcher bypassed this and used bare fetch, which is why it
       returned nothing at all on a phone. */
    async function get(app, url) {
        const left = deadline ? deadline - Date.now() : PER_CALL_MS;
        if (left <= 0) throw new Error('research budget spent');
        return withTimeout(app.fetchMarketJson(url), Math.min(PER_CALL_MS, left));
    }

    const symbolFor = (app, inv) => {
        const clean = String(inv.ticker || '').trim().toUpperCase().replace(/\.(NS|BO)$/, '');
        if (!clean) return null;
        return app._marketBand(inv) === 'US' ? clean : `${clean}.NS`;
    };

    // ── 1. WHICH WORLD IS THIS PORTFOLIO IN ──────────────────────────────────
    /* Weighted by money, not by count. Nine small Indian holdings beside one
       large US one is not an Indian portfolio, and a headcount would say it
       was. */
    function classify(app) {
        let ind = 0, us = 0, other = 0;
        for (const inv of (app.investments || [])) {
            const v = app.getInvCurrentValue(inv) || 0;
            const band = app._marketBand(inv);
            if (band === 'US') us += v;
            else if (band === 'IND') ind += v;
            else other += v;          // funds, deposits, gold — domestic by nature
        }
        const domestic = ind + other;
        const total = domestic + us;
        if (total <= 0) return { tilt: 'unknown', indianPct: 0, usPct: 0 };
        const indianPct = round((domestic / total) * 100, 1);
        const usPct = round((us / total) * 100, 1);
        const tilt = indianPct >= 70 ? 'india' : usPct >= 70 ? 'international' : 'both';
        return { tilt, indianPct, usPct };
    }

    // ── 2. PRICE STRUCTURE, FROM THE ENDPOINT THAT WORKS ─────────────────────
    async function studyHolding(app, inv) {
        const sym = symbolFor(app, inv);
        if (!sym) return null;
        return studySymbol(app, sym);
    }

    async function studySymbol(app, sym) {
        const data = await get(app,
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y`);
        const res = data?.chart?.result?.[0];
        const closes = (res?.indicators?.quote?.[0]?.close || []).filter(c => Number.isFinite(c));
        if (closes.length < 30) return null;

        const last = closes[closes.length - 1];
        /* A 200-day average needs 200 days. The window is required in FULL and
           not merely "enough": averaging the 60 closes a recently listed stock
           has and labelling the result a 200DMA is a fabricated statistic
           wearing a real name, and it would be quoted back as one. Short
           history yields null, which the prompt prints as unavailable. */
        const mean = n => {
            if (closes.length < n) return null;
            const slice = closes.slice(-n);
            return slice.reduce((a, b) => a + b, 0) / slice.length;
        };
        const ma50 = mean(50);
        const ma200 = mean(200);
        const high = Math.max(...closes);
        const low = Math.min(...closes);

        // Daily log returns → annualised standard deviation. Stated as a fact
        // about the past, never as a forecast.
        const rets = [];
        for (let i = 1; i < closes.length; i++) {
            if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
        }
        const rMean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
        const variance = rets.reduce((a, b) => a + (b - rMean) ** 2, 0) / Math.max(rets.length - 1, 1);
        const vol = Math.sqrt(variance * 252) * 100;

        const back = n => closes.length > n ? closes[closes.length - 1 - n] : null;
        return {
            samples: closes.length,
            // Taken from the EXCHANGE, not inferred from the holding's type.
            // Inference is how $362.66 reached the screen as ₹362.66: the
            // dossier printed a bare number and the model supplied the only
            // symbol it had seen. meta.currency is authoritative.
            currency: res?.meta?.currency || null,
            exchange: res?.meta?.exchangeName || null,
            last: round(last),
            ma50: round(ma50), ma200: round(ma200),
            vsMa50: round(pct(last, ma50), 1), vsMa200: round(pct(last, ma200), 1),
            high52: round(high), low52: round(low),
            // Where it sits in its own year: 0 = at the low, 100 = at the high.
            bandPos: high > low ? round(((last - low) / (high - low)) * 100, 1) : null,
            drawdown: round(pct(last, high), 1),
            ret30: round(pct(last, back(21)), 1),
            ret90: round(pct(last, back(63)), 1),
            ret1y: round(pct(last, closes[0]), 1),
            volatility: round(vol, 1),
        };
    }

    // ── 2b. GOLD AND SILVER ──────────────────────────────────────────────────
    /* International spot, converted to the units an Indian buyer thinks in,
       beside the domestic ETFs that track what that buyer actually pays.
       Spot converted at the FX rate runs BELOW the Indian price, because the
       Indian price carries import duty and GST; the ETF is the honest local
       reading, and the prompt is told which is which. */
    const TROY_OZ_G = 31.1035;
    async function metals(app) {
        const fx = Number(app.fxUsdInr);
        const [gold, silver, goldEtf, silverEtf] = await Promise.all([
            studySymbol(app, 'GC=F').catch(() => null),
            studySymbol(app, 'SI=F').catch(() => null),
            studySymbol(app, 'GOLDBEES.NS').catch(() => null),
            studySymbol(app, 'SILVERBEES.NS').catch(() => null),
        ]);
        if (!gold && !silver && !goldEtf && !silverEtf) return null;
        const inr = (usdPerOz, grams) => (usdPerOz && fx > 0) ? Math.round(usdPerOz * fx / TROY_OZ_G * grams) : null;
        const brief = r => r && { ret30: r.ret30, ret1y: r.ret1y, high52: r.high52, drawdown: r.drawdown, vsMa200: r.vsMa200 };
        return {
            fx: fx > 0 ? round(fx, 2) : null, fxEstimated: !!app.fxIsEstimated,
            gold: gold && { usdPerOz: gold.last, inrPer10g: inr(gold.last, 10), ...brief(gold) },
            silver: silver && { usdPerOz: silver.last, inrPerKg: inr(silver.last, 1000), ...brief(silver) },
            goldEtf: goldEtf && { symbol: 'GOLDBEES', last: goldEtf.last, ...brief(goldEtf) },
            silverEtf: silverEtf && { symbol: 'SILVERBEES', last: silverEtf.last, ...brief(silverEtf) },
        };
    }

    // ── 3. WHAT THE STREET THINKS ────────────────────────────────────────────
    /* This replaces Yahoo's quoteSummary, which had been returning

           {"error":{"code":"Unauthorized","description":"Invalid Crumb"}}

       on every single call since it shipped. Nothing said so — fundamentals
       were "best effort" and an empty result looked like an ordinary miss — so
       the model was reasoning from price alone. Price alone says one thing
       about a stock that is down, which is how a holding with 27 Buy ratings
       and a target 43% above spot got written up as a drawdown to worry about.

       api.nasdaq.com answers keyless. It is undocumented and could stop, which
       is why every field still defaults to null and the coverage line reports
       what was actually gathered. US listings only — Nasdaq replies
       "Symbol not exists" for RELIANCE, and Indian holdings are told so in the
       prompt rather than left as a gap for the model to fill from memory. */

    /* ",729,960,121,535" → 1729960121535, and a missing field → null.

       The null matters more than the parse. Number('') is 0, so an endpoint
       that returned nothing at all produced a dossier reading marketCap 0,
       previousClose 0, yield 0 — every one of them a fabricated fact that
       looked measured, which is the precise failure this module exists to
       prevent. An absent field must stay absent all the way to the prompt. */
    const money = s => {
        if (s === null || s === undefined) return null;
        const cleaned = String(s).replace(/[$,%\s]/g, '');
        if (!cleaned || cleaned === 'N/A') return null;
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : null;
    };

    async function fundamentals(app, inv) {
        if (app._marketBand(inv) !== 'US') return null;   // Nasdaq has no Indian listings
        const sym = String(inv.ticker || '').trim().toUpperCase();
        if (!sym) return null;

        const N = 'https://api.nasdaq.com/api';
        const one = url => get(app, url).catch(() => null);
        const [summary, target, ratings, fin] = await Promise.all([
            one(`${N}/quote/${encodeURIComponent(sym)}/summary?assetclass=stocks`),
            one(`${N}/analyst/${encodeURIComponent(sym)}/targetprice`),
            one(`${N}/analyst/${encodeURIComponent(sym)}/ratings`),
            one(`${N}/company/${encodeURIComponent(sym)}/financials?frequency=1`),
        ]);

        const sd = summary?.data?.summaryData || null;
        const con = target?.data?.consensusOverview || null;
        const rat = ratings?.data || null;

        // Revenue, newest column first. Four years of it, so growth is measured
        // rather than characterised.
        const revRow = (fin?.data?.incomeStatementTable?.rows || [])
            .find(r => /total revenue/i.test(r?.value1 || ''));
        const rev = revRow ? [revRow.value2, revRow.value3, revRow.value4, revRow.value5].map(money) : [];
        const revenueGrowth = (rev[0] && rev[1]) ? round(((rev[0] - rev[1]) / rev[1]) * 100, 1) : null;

        const marginRow = (fin?.data?.incomeStatementTable?.rows || [])
            .find(r => /gross profit/i.test(r?.value1 || ''));
        const grossProfit = marginRow ? money(marginRow.value2) : null;
        const grossMargin = (grossProfit && rev[0]) ? round((grossProfit / rev[0]) * 100, 1) : null;

        const [hi, lo] = String(sd?.FiftTwoWeekHighLow?.value || '').split('/').map(money);

        const out = {
            sector: sd?.Sector?.value || null,
            industry: sd?.Industry?.value || null,
            marketCap: money(sd?.MarketCap?.value),
            previousClose: money(sd?.PreviousClose?.value),
            high52: hi ?? null,
            low52: lo ?? null,
            dividend: money(sd?.AnnualizedDividend?.value),
            yield: money(sd?.Yield?.value),
            oneYrTarget: money(sd?.OneYrTarget?.value),
            // The part that was missing entirely, and the part that decides
            // whether a fall is a warning or an opportunity.
            targetMean: round(num(con?.priceTarget)),
            targetLow: round(num(con?.lowPriceTarget)),
            targetHigh: round(num(con?.highPriceTarget)),
            buy: num(con?.buy), hold: num(con?.hold), sell: num(con?.sell),
            consensus: rat?.meanRatingType || null,
            analystNote: rat?.ratingsSummary || null,
            brokers: Array.isArray(rat?.brokerNames) ? rat.brokerNames.slice(0, 6) : [],
            revenue: rev[0] ?? null,
            revenueGrowth,
            grossMargin,
        };
        // All-null means nothing was reached; say nothing rather than print a
        // dossier of blanks.
        return Object.values(out).some(v => v !== null && !(Array.isArray(v) && !v.length)) ? out : null;
    }

    // ── 3b. FUNDS — THIRTEEN YEARS OF NAV, NOT ONE NUMBER ────────────────────
    /* api.mfapi.in returns the FULL NAV history — 3,374 daily values back to
       2013 for a fund like Quant Small Cap — and the app was reading row [0]
       and discarding the rest. Everything below comes out of that one response
       the price sync already makes. */
    async function studyFund(app, inv) {
        const code = String(inv.schemeCode || '').trim();
        if (!code) return null;
        const data = await get(app, `https://api.mfapi.in/mf/${encodeURIComponent(code)}`);
        const rows = (data?.data || [])
            .map(r => ({ date: r.date, nav: Number(r.nav) }))
            .filter(r => Number.isFinite(r.nav) && r.nav > 0);
        if (rows.length < 30) return null;

        // mfapi returns newest first.
        const navAt = i => (i < rows.length ? rows[i].nav : null);
        const last = rows[0].nav;
        const ret = i => { const p = navAt(i); return p ? round(((last - p) / p) * 100, 2) : null; };
        // A multi-year figure is only honest as a CAGR — quoting +61.6% over
        // three years beside a one-year number invites reading them as peers.
        const cagr = (i, years) => {
            const p = navAt(i);
            if (!p) return null;
            return round(((last / p) ** (1 / years) - 1) * 100, 2);
        };
        const peak = Math.max(...rows.map(r => r.nav));

        const navs = rows.slice(0, 252).map(r => r.nav).reverse();
        const lr = [];
        for (let i = 1; i < navs.length; i++) if (navs[i - 1] > 0) lr.push(Math.log(navs[i] / navs[i - 1]));
        const m = lr.reduce((a, b) => a + b, 0) / (lr.length || 1);
        const variance = lr.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(lr.length - 1, 1);

        return {
            currency: 'INR',
            nav: round(last), navDate: rows[0].date, samples: rows.length,
            category: data?.meta?.scheme_category || null,
            house: data?.meta?.fund_house || null,
            // ~21 sessions a month, ~248 a year.
            ret1m: ret(21), ret3m: ret(63), ret6m: ret(126), ret1y: ret(248),
            cagr3y: rows.length > 744 ? cagr(744, 3) : null,
            cagr5y: rows.length > 1240 ? cagr(1240, 5) : null,
            drawdown: round(((last - peak) / peak) * 100, 1),
            volatility: round(Math.sqrt(variance * 252) * 100, 1),
        };
    }

    // ── 3c. THE BENCHMARK ────────────────────────────────────────────────────
    /* A fund up 14.89% over a year is unreadable on its own. Against a Nifty 50
       that fell 7.43% over the same year it is twenty-two points of
       outperformance — a completely different sentence, and one the app could
       not previously form. One request per market, shared by every holding. */
    const BENCHMARKS = {
        IND: { symbol: '%5ENSEI', name: 'Nifty 50' },
        US:  { symbol: '%5EGSPC', name: 'S&P 500' },
    };

    async function benchmark(app, market) {
        const b = BENCHMARKS[market];
        if (!b) return null;
        try {
            const data = await get(app,
                `https://query1.finance.yahoo.com/v8/finance/chart/${b.symbol}?interval=1d&range=1y`);
            const closes = (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
                .filter(c => Number.isFinite(c));
            if (closes.length < 30) return null;
            const first = closes[0], last = closes[closes.length - 1];
            return { name: b.name, ret1y: round(((last - first) / first) * 100, 2), samples: closes.length };
        } catch (e) {
            return null;
        }
    }

    // ── 4. NEWS ──────────────────────────────────────────────────────────────
    async function headlines(app, query, count) {
        const url = `https://query1.finance.yahoo.com/v1/finance/search`
                  + `?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${count}&listsCount=0`;
        try {
            const data = await get(app, url);
            return (data?.news || [])
                .filter(n => n && n.title)
                .slice(0, count)
                .map(n => ({
                    title: String(n.title).slice(0, 180),
                    publisher: n.publisher || null,
                    at: Number.isFinite(Number(n.providerPublishTime))
                        ? new Date(Number(n.providerPublishTime) * 1000).toISOString().slice(0, 10)
                        : null,
                }));
        } catch (e) {
            return [];
        }
    }

    /* rss2json turns a feed into JSON a phone can read. NO `count` parameter:
       since September 2026 it answers `count` without a paid key with a 422,
       and every feed had been failing that way — the AI was reading no market
       or policy news at all, on every platform, and nothing said so. The free
       tier returns ten items, which is plenty. */
    const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

    /* Every news source is an Economic Times section feed. Two others were
       tried and measured out on 2026-09-24: Google News answers most searches
       from Cloudflare's servers with a 503 (a different four topics out of
       five each minute), and Yahoo's news search returns nothing for a phrase
       like "gold price". ET's section feeds answered every request, current to
       the day. The RBI and Moneycontrol feeds this list once named no longer
       parse at all. */
    const et = (name, path) => ({ name, url: `https://economictimes.indiatimes.com/${path}.cms` });
    const INDIA_FEEDS = [
        et('ET Markets', 'markets/rssfeeds/1977021501'),
        et('ET Economy and policy', 'news/economy/rssfeeds/1373380680'),
        et('ET Personal finance', 'wealth/personal-finance-news/rssfeeds/49674901'),
    ];

    /* Which extra sections are read is decided by the person, not only the
       portfolio: someone who asked Corpus to watch gold and government schemes
       hears about them before they hold any. */
    function profileSearches(profile) {
        const want = new Set(profile?.interests || []);
        const out = [];
        if (want.has('gold')) out.push(et('ET Commodities (gold, silver)', 'markets/commodities/rssfeeds/1808152121'));
        if (want.has('schemes') || profile?.goal === 'retired' || Number(profile?.age) >= 60) {
            out.push(et('ET Savings (schemes, deposits)', 'wealth/save/rssfeeds/47119915'));
        }
        if (want.has('fdbonds') || profile?.goal === 'income' || profile?.goal === 'safe') {
            out.push(et('ET Bonds and rates', 'markets/bonds/rssfeeds/2146846'));
        }
        if (want.has('mf')) out.push(et('ET Mutual funds', 'mf/mf-news/rssfeeds/1107225967'));
        return out.slice(0, 4);
    }

    /* Our own gateway reads the feed first (worker/src/index.js, /v1/feed) and
       answers in rss2json's shape. It is fetched DIRECTLY — not through
       fetchMarketJson, which in the browser would wrap our own URL in the
       market proxy. rss2json stays as the fallback. */
    function feedGateway(url) {
        const ai = String(window.CorpusAiConfig?.endpoint || '');
        return /^https:\/\//.test(ai) ? ai.replace(/\/v1\/[^/]+$/, '/v1/feed?url=') + encodeURIComponent(url) : null;
    }
    async function viaGateway(app, url) {
        const gw = feedGateway(url);
        if (!gw) throw new Error('no gateway');
        const left = deadline ? deadline - Date.now() : PER_CALL_MS;
        if (left <= 0) throw new Error('research budget spent');
        const data = await withTimeout(app.httpGetJson(gw, PER_CALL_MS), Math.min(PER_CALL_MS, left));
        if (data?.status !== 'ok') throw new Error('gateway feed failed');
        return data;
    }

    async function feed(app, f) {
        try {
            const data = await viaGateway(app, f.url).catch(() => get(app, RSS2JSON + encodeURIComponent(f.url)));
            if (data?.status !== 'ok') throw new Error('feed parse');
            const items = (data.items || []).filter(i => i && i.title).slice(0, 6).map(i => ({
                title: String(i.title).slice(0, 180),
                at: i.pubDate ? String(i.pubDate).slice(0, 10) : null,
            }));
            return { source: f.name, items };
        } catch (e) {
            return { source: f.name, items: [] };
        }
    }

    // ── 5. THE PACK ──────────────────────────────────────────────────────────
    /* Passes are queued, not overlapped: `deadline` is module state, and the
       daily brief and a button press can now start within a second of each
       other. A pack under five minutes old for the same book and the same
       person is handed back instead of refetched — a second pass would learn
       nothing new and spend twenty requests doing it. */
    const REUSE_MS = 5 * 60 * 1000;
    let queue = Promise.resolve();
    let lastPack = null;
    const bookKey = (app, opts) => JSON.stringify([
        (app.investments || []).map(i => [i.id, i.units, i.amount, i.ticker, i.schemeCode]),
        opts.profile?.interests || [], opts.profile?.goal || null, Number(opts.profile?.age) || null, !!opts.metals,
    ]);

    function buildPack(app, onProgress, opts = {}) {
        const key = bookKey(app, opts);
        const run = queue.then(async () => {
            // Opt-in: Re-run must see fresh prices, so only callers that say
            // `reuse` (the automatic brief, an unforced analysis) get a copy.
            if (opts.reuse && lastPack && lastPack.key === key && Date.now() - lastPack.at < REUSE_MS) return lastPack.pack;
            const pack = await assemble(app, onProgress, opts);
            lastPack = { key, at: Date.now(), pack };
            return pack;
        });
        queue = run.catch(() => {});
        return run;
    }

    const DAY_MS = 86400000;
    function daysUntil(dateStr) {
        const t = Date.parse(dateStr);
        return Number.isFinite(t) ? Math.ceil((t - Date.now()) / DAY_MS) : null;
    }

    async function assemble(app, onProgress, opts) {
        const say = m => { try { onProgress && onProgress(m); } catch (_) {} };
        const started = Date.now();
        deadline = started + BUDGET_MS;     // armed here, cleared on the way out
        const tilt = classify(app);

        // Largest first: a research budget spent on a ₹900 position instead of
        // a ₹9,00,000 one is a budget wasted.
        const quoted = (app.investments || [])
            .filter(i => i.ticker && app._marketBand(i))
            .sort((a, b) => app.getInvCurrentValue(b) - app.getInvCurrentValue(a))
            .slice(0, MAX_STUDIED);

        // Funds are researched as thoroughly as stocks — a different dossier,
        // not a thinner one. They were previously listed by name and value and
        // nothing else, which is why the reading never had anything to say
        // about them.
        const funds = (app.investments || [])
            .filter(i => i.schemeCode && !app._marketBand(i))
            .sort((a, b) => app.getInvCurrentValue(b) - app.getInvCurrentValue(a))
            .slice(0, MAX_STUDIED);

        say(`Researching ${quoted.length + funds.length} holding${quoted.length + funds.length === 1 ? '' : 's'} and the news around them…`);

/* One benchmark request per market, shared by every holding in it — and
           STARTED here rather than awaited here. Awaiting first cost a full
           round trip out of the four this pass takes, spent blocking work that
           did not depend on it. Each holding awaits the same in-flight promise
           when it assembles, so the request is still made once. */
        const indBenchP = (funds.length || quoted.some(i => app._marketBand(i) === 'IND'))
            ? benchmark(app, 'IND').catch(() => null) : Promise.resolve(null);
        const usBenchP = quoted.some(i => app._marketBand(i) === 'US')
            ? benchmark(app, 'US').catch(() => null) : Promise.resolve(null);

        const holdingsP = Promise.all(quoted.map(async inv => {
            const [price, fund, news] = await Promise.all([
                studyHolding(app, inv).catch(() => null),
                fundamentals(app, inv).catch(() => null),
                headlines(app, inv.ticker, MAX_NEWS_PER_HOLDING).catch(() => []),
            ]);
            const market = app._marketBand(inv);
            return {
                kind: 'equity',
                name: inv.name, ticker: inv.ticker, type: inv.type, market,
                value: Math.round(app.getInvCurrentValue(inv)),
                invested: Math.round(app.getInvInvestedCost(inv)),
                price, fundamentals: fund, news,
                benchmark: await (market === 'US' ? usBenchP : indBenchP),
            };
        }));

        const fundRowsP = Promise.all(funds.map(async inv => {
            const [nav, news] = await Promise.all([
                studyFund(app, inv).catch(() => null),
                headlines(app, inv.name, 2).catch(() => []),
            ]);
            return {
                kind: 'fund',
                name: inv.name, type: inv.type, schemeCode: inv.schemeCode,
                market: 'IND',
                value: Math.round(app.getInvCurrentValue(inv)),
                invested: Math.round(app.getInvInvestedCost(inv)),
                nav, news, benchmark: await indBenchP,
            };
        }));

        // What is left has no market at all: deposits, EPF, gold bought by
        // weight, property. Rate and tenure is the whole of what can be said,
        // and the prompt makes that explicit rather than leaving room for a
        // verdict reasoned from a PE they do not have.
        const unquoted = (app.investments || [])
            .filter(i => !(i.ticker && app._marketBand(i)) && !(i.schemeCode && !app._marketBand(i)))
            .map(inv => {
                const scheme = window.CorpusSchemes?.match(inv) || null;
                return {
                    kind: 'other',
                    name: inv.name, type: inv.type,
                    value: Math.round(app.getInvCurrentValue(inv)),
                    invested: Math.round(app.getInvInvestedCost(inv)),
                    rate: num(inv.rate),
                    payout: inv.payout || inv.payoutFrequency || null,
                    maturityDate: inv.maturityDate || null,
                    daysToMaturity: inv.maturityDate ? daysUntil(inv.maturityDate) : null,
                    // The government's terms for this instrument, when it is
                    // one. The holding's own `rate` still wins where entered:
                    // SCSS, NSC and MIS lock the rate of the day they opened.
                    scheme: scheme && { id: scheme.id, name: scheme.name, currentRate: scheme.rate, payout: scheme.payout,
                                        lockIn: scheme.lockIn, limit: scheme.limit, eligibility: scheme.eligibility || null,
                                        tax: scheme.tax, rateLocks: scheme.rateLocks, note: scheme.rateNote || null },
                };
            });

        const holdsGold = (app.investments || []).some(i => /gold|sgb/i.test(`${i.type} ${i.name} ${i.ticker || ''}`));
        const metalsP = (opts.metals || holdsGold || (opts.profile?.interests || []).includes('gold'))
            ? metals(app).catch(() => null) : Promise.resolve(null);
        const searchesP = Promise.all(profileSearches(opts.profile).map(f => feed(app, f))).catch(() => []);

        const macro = { india: [], international: [] };
        const jobs = [];
        if (tilt.tilt === 'india' || tilt.tilt === 'both' || tilt.tilt === 'unknown') {
            jobs.push(Promise.all(INDIA_FEEDS.map(f => feed(app, f))).then(r => { macro.india = r; }));
        }
        if (tilt.tilt === 'international' || tilt.tilt === 'both') {
            jobs.push(headlines(app, 'US stock market Federal Reserve', 6).then(r => {
                macro.international = [{ source: 'US market headlines', items: r }];
            }));
        }
        const [holdings, fundRows, , metalRow, searches] = await Promise.all([
            holdingsP, fundRowsP, Promise.all(jobs).catch(() => {}), metalsP, searchesP]);
        macro.profile = searches || [];

        const studied = holdings.filter(h => h.price).length + fundRows.filter(f => f.nav).length;
        deadline = 0;
        return {
            capturedAt: new Date().toISOString(),
            elapsedMs: Date.now() - started,
            tilt,
            holdings, funds: fundRows, unquoted, macro, metals: metalRow,
            schemes: window.CorpusSchemes ? window.CorpusSchemes.status() : null,
            benchmarks: { IND: await indBenchP, US: await usBenchP },
            coverage: {
                studied,
                requested: quoted.length + funds.length,
                // Named separately, because "fundamentals: 0" is exactly the
                // signal that was invisible while quoteSummary was silently
                // returning Invalid Crumb on every call.
                withFundamentals: holdings.filter(h => h.fundamentals).length,
                withAnalystView: holdings.filter(h => h.fundamentals && h.fundamentals.consensus).length,
                withNews: [...holdings, ...fundRows].filter(h => (h.news || []).length).length,
                withBenchmark: (await indBenchP ? 1 : 0) + (await usBenchP ? 1 : 0),
                indiaFeeds: macro.india.filter(f => f.items.length).length,
                profileFeeds: macro.profile.filter(f => f.items.length).length,
                metals: !!metalRow,
                schemesMatched: unquoted.filter(u => u.scheme).length,
            },
        };
    }

    window.CorpusResearch = { buildPack, classify, studyHolding, studySymbol, studyFund, fundamentals,
                              benchmark, headlines, metals, profileSearches, BUDGET_MS,
                              _resetReuse: () => { lastPack = null; } };
})();
