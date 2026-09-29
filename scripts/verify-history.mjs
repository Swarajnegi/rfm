// The net-worth history, tested as a claim about the world rather than as a
// picture.
//
// Every one of these cases corresponds to something the chart used to assert and
// could not support: a ₹0 point for a user who had entered nothing, a "1W" pill
// silently drawing two years because the window came back empty, an evening
// observation filed under tomorrow because the key was UTC, and "+98764.50% all
// time" about a portfolio that had merely been funded.
//
// Dates are the subject here, so the clock and the timezone are pinned:
// Asia/Kolkata (+05:30) is the app's actual audience and the offset that made
// the UTC bug invisible in a UTC-run CI.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const fails = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fails.push(label);
};

const URL = pathToFileURL(path.resolve('web/index.html')).href;
const browser = await chromium.launch();

// A local YYYY-MM-DD, offset by whole days. The app writes keys off the LOCAL
// calendar, so a fixture built with toISOString() is a day out east of
// Greenwich — which is how the bug survived as long as it did.
const key = (back = 0, base = new Date()) => {
    const d = new Date(base);
    d.setDate(d.getDate() - back);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MINIMAL = JSON.stringify({ version: '3.0', investments: [], networth: {}, sips: [], goals: [] });

/** A booted page in Kolkata time, with whatever localStorage the case needs. */
async function boot(storage = {}, { wait = 2200, clock = null } = {}) {
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        timezoneId: 'Asia/Kolkata',
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    if (clock) await page.clock.install({ time: clock });
    await page.addInitScript(s => {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        localStorage.setItem('corpus_tour_v1', 'seen'); localStorage.setItem('rfm_v1', JSON.stringify((v => ({ ...v, profile: v.profile || { version: 2, completedAt: '2026-09-01T00:00:00.000Z', name: 'Test', age: 40, goal: 'balanced', risk: 'medium', horizon: '7to15', interests: ['stocks'] } }))(JSON.parse(localStorage.getItem('rfm_v1') || '{}'))));
        localStorage.setItem('rfm_tour_v1', 'seen');
    }, storage);
    await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await page.goto(URL, { waitUntil: 'load' });
    if (clock) await page.clock.runFor(wait); else await page.waitForTimeout(wait);
    return { ctx, page, errors };
}

const read = page => page.evaluate(() => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem('rfm_nw_history')) || []; } catch (e) { stored = []; }
    const main = [...document.querySelectorAll('main')].find(m => m.offsetParent !== null);
    return {
        history: d.nwHistory.map(p => ({ date: p.date, value: p.value, source: p.source })),
        stored: stored.map(p => ({ date: p.date, value: p.value })),
        windowed: d.nwChartData.map(p => p.date),
        plotted: d.nwChartSeries.map(p => ({ date: p.date, value: p.value })),
        change: d.nwRangeChange,
        span: d.nwRangeSpanLabel,
        rangeEmpty: d.nwRangeEmpty,
        hasObs: d.nwHasObservations,
        netWorth: d.netWorthTotal,
        range: d.nwChartRange,
        hero: (document.getElementById('nwHero') || {}).innerText || '',
        canvas: !!document.querySelector('#nwChart svg path.line'),
        chartShown: !!document.querySelector('#nwChart') && document.querySelector('#nwChart').offsetParent !== null,
        text: main ? main.innerText : '',
    };
});

const setRange = (page, r) => page.evaluate(v => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    d.nwChartRange = v;
    d.renderNwChart();
}, r);

// ── 1. A GENUINELY NEW USER ──────────────────────────────────────────────────
console.log('\nEMPTY FIRST RUN — nothing observed, so nothing plotted');
{
    const { ctx, page, errors } = await boot({});
    const r = await read(page);
    ok('no observation is recorded', r.history.length === 0 && r.stored.length === 0,
       `${r.history.length} in memory, ${r.stored.length} stored`);
    // The whole failure this suite exists for: netWorthTotal is 0, and the old
    // renderer invented {date: today, value: 0} so the chart would have
    // something to draw.
    ok('no fabricated ₹0 point', !r.history.some(p => p.value === 0), JSON.stringify(r.history));
    ok('no percentage is claimed', !/%/.test(r.hero), (r.hero.match(/\S*%\S*/) || [''])[0]);
    ok('no growth language on an empty portfolio hero', !/profit|investment return|growth|gain/i.test(r.hero));
    ok('the onboarding hero stands in for the chart', /Add your first holding/.test(r.text));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 2. THE FIRST HOLDING ─────────────────────────────────────────────────────
console.log('\nFIRST HOLDING — ₹20,000 becomes today’s first observation');
{
    const { ctx, page, errors } = await boot({ rfm_v1: MINIMAL });
    const before = await read(page);
    ok('still nothing before any holding exists', before.history.length === 0, String(before.history.length));

    await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.investments.push({ id: 'first', name: 'First FD', type: 'Bank FD', amount: 20000, rate: 0 });
    });
    // queueNwSnapshot debounces 300ms; the chart render follows it.
    await page.waitForTimeout(900);
    const r = await read(page);

    ok('exactly one observation', r.history.length === 1, JSON.stringify(r.history));
    ok('dated today, locally', r.history[0]?.date === key(0), `${r.history[0]?.date} vs ${key(0)}`);
    ok('valued at the real netWorthTotal', r.history[0]?.value === 20000, String(r.history[0]?.value));
    ok('the headline agrees', r.netWorth === 20000 && /₹20,000/.test(r.text), String(r.netWorth));
    ok('it reaches localStorage', r.stored.length === 1 && r.stored[0].value === 20000, JSON.stringify(r.stored));
    // One observation is a dated point. It is not a trend, and it must not be
    // dressed as one — no line, no percentage, no direction.
    ok('one point is not a trend', r.change === null, JSON.stringify(r.change));
    ok('the caption says so', /1 observation/.test(r.span), r.span);
    // The hero, not the whole page: an allocation row states its OWN P&L from
    // cost basis, which is a real return and is allowed to say so.
    ok('no percentage on a single point', !/%/.test(r.hero), (r.hero.match(/\S*%\S*/) || [''])[0]);
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 3. SAME-DAY REVISIONS ────────────────────────────────────────────────────
console.log('\nSAME DAY — an edit and a quote update REPLACE today, never append');
{
    const { ctx, page, errors } = await boot({
        rfm_v1: JSON.stringify({ version: '3.0', networth: {}, sips: [], goals: [],
            investments: [{ id: 'a', name: 'A', type: 'Bank FD', amount: 20000, rate: 0 }] }),
    });
    const first = await read(page);
    ok('opening snapshot is today', first.history.length === 1 && first.history[0].date === key(0),
       JSON.stringify(first.history));

    await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.investments[0].amount = 25000;
        d.investments = [...d.investments];
    });
    await page.waitForTimeout(900);
    const edited = await read(page);
    ok('an edit replaces rather than appends', edited.history.length === 1, JSON.stringify(edited.history));
    ok('the replacement carries the new value', edited.history[0].value === 25000, String(edited.history[0].value));

    // A quote sync writes through a different call site (saveNwSnapshot direct,
    // not the debounced watcher), which is exactly where a second daily point
    // could creep in.
    await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.investments[0].amount = 31000;
    });
    // Let the 300ms watcher debounce land first, or it stamps its own source
    // over the sync's and the assertion below tests the race instead of the
    // behaviour.
    await page.waitForTimeout(700);
    await page.evaluate(() => {
        document.querySelector('[x-data]')._x_dataStack[0].saveNwSnapshot({ source: 'price-sync' });
    });
    await page.waitForTimeout(300);
    const synced = await read(page);
    ok('a quote update still leaves one point for today', synced.history.length === 1, JSON.stringify(synced.history));
    ok('with the synced value', synced.history[0].value === 31000, String(synced.history[0].value));
    ok('and the later source wins', synced.history[0].source === 'price-sync', String(synced.history[0].source));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 4. A LATER DAY, AND THE GAPS BETWEEN ─────────────────────────────────────
console.log('\nLATER DAYS — observations append; missing days stay missing');
{
    const seeded = JSON.stringify([
        { date: key(10), value: 100000, source: 'seed' },
        { date: key(1),  value: 140000, source: 'seed' },
    ]);
    const { ctx, page, errors } = await boot({
        rfm_v1: JSON.stringify({ version: '3.0', networth: { bank: 200000 }, sips: [], goals: [], investments: [] }),
        rfm_nw_history: seeded,
    });
    const r = await read(page);
    ok('today is appended, not merged into yesterday', r.history.length === 3, JSON.stringify(r.history.map(p => p.date)));
    ok('yesterday survives untouched', r.history[1].date === key(1) && r.history[1].value === 140000,
       JSON.stringify(r.history[1]));
    ok('today carries the live total', r.history[2].date === key(0) && r.history[2].value === 200000,
       JSON.stringify(r.history[2]));
    // Nine days sit between D-10 and D-1 and the app was not open for any of
    // them. Inventing a value for those days would be inventing a valuation.
    ok('the nine unobserved days are NOT back-filled', r.history.length === 3,
       `${r.history.length} points across an 11-day span`);
    ok('the caption counts observations, not days', /3 observations/.test(r.span), r.span);
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 5. AN EMPTY WINDOW ───────────────────────────────────────────────────────
console.log('\nEMPTY WINDOW — a period with nothing in it says so');
{
    // Everything is older than a week, and the app is prevented from adding
    // today's point by having no portfolio behind the history... which it does
    // have, so instead the history is old AND today's snapshot is removed after
    // boot to model a genuinely stale window.
    const old = JSON.stringify([
        { date: key(120), value: 900000, source: 'seed' },
        { date: key(100), value: 950000, source: 'seed' },
    ]);
    const { ctx, page, errors } = await boot({
        rfm_v1: JSON.stringify({ version: '3.0', networth: {}, sips: [], goals: [], investments: [] }),
        rfm_nw_history: old,
    });
    // No portfolio inputs, so hasAnyPortfolioData is true only via nwHistory and
    // netWorthTotal is 0 — the snapshot still records, so drop it to isolate the
    // empty-window case.
    await page.evaluate(k => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.nwHistory = d.nwHistory.filter(p => p.date !== k);
        localStorage.setItem('rfm_nw_history', JSON.stringify(d.nwHistory));
    }, key(0));
    await setRange(page, '1W');
    await page.waitForTimeout(300);
    const r = await read(page);

    // The old code returned the FULL history when the window came back empty, so
    // "1W" drew four months and nothing said otherwise.
    ok('the window is empty, not back-filled with everything', r.windowed.length === 0,
       JSON.stringify(r.windowed));
    ok('nothing is plotted', r.plotted.length === 0, JSON.stringify(r.plotted));
    ok('the app says which silence this is', r.rangeEmpty === true && /No values were recorded in this period/.test(r.text));
    ok('it does not claim there is no history at all', !/No history yet/.test(r.text));
    ok('no change is reported', r.change === null, JSON.stringify(r.change));
    ok('the canvas is hidden rather than blank', r.chartShown === false, String(r.chartShown));

    await setRange(page, 'ALL');
    await page.waitForTimeout(300);
    const all = await read(page);
    ok('a wider window finds them again', all.windowed.length === 2, JSON.stringify(all.windowed));
    ok('and the chart comes back', all.chartShown === true && all.canvas === true);
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 6. EVERY RANGE PICKS ITS OWN DATES ───────────────────────────────────────
console.log('\nRANGES — each window holds exactly the dates inside it');
{
    const { ctx, page, errors } = await boot({
        rfm_v1: JSON.stringify({ version: '3.0', networth: { bank: 1000000 }, sips: [], goals: [], investments: [] }),
    });
    await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const hist = [];
        for (let i = 730; i >= 0; i--) {
            const dt = new Date();
            dt.setDate(dt.getDate() - i);
            hist.push({ date: d.localDateKey(dt), value: 1000000 + (730 - i) * 100, source: 'test' });
        }
        d.nwHistory = hist;
    });

    for (const range of ['1W', '1M', '3M', '6M', '1Y', 'ALL']) {
        const r = await page.evaluate(v => {
            const d = document.querySelector('[x-data]')._x_dataStack[0];
            d.nwChartRange = v;
            const w = d.nwChartData;
            return { from: d.nwRangeStartKey, first: w[0]?.date, last: w[w.length - 1]?.date, n: w.length };
        }, range);
        const today = key(0);
        ok(`${range} starts no earlier than its cutoff`, !r.from || r.first >= r.from,
           `${r.first} vs cutoff ${r.from || '(none)'}`);
        ok(`${range} ends today`, r.last === today, `${r.last} vs ${today}`);
        // The cutoff day itself is INSIDE the window. An exclusive boundary
        // loses a real observation and is invisible in any screenshot.
        if (r.from) ok(`${range} includes its boundary day`, r.first === r.from, `${r.first} vs ${r.from}`);
    }

    const counts = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const out = {};
        for (const v of ['1W', '1M', '3M', '6M', '1Y', 'ALL']) {
            d.nwChartRange = v;
            out[v] = { raw: d.nwChartData.length, drawn: d.nwChartSeries.length };
        }
        d.nwChartRange = '1M';
        return out;
    });
    ok('ALL keeps every observation', counts.ALL.raw === 731, String(counts.ALL.raw));
    ok('1W is a week of daily points', counts['1W'].raw >= 7 && counts['1W'].raw <= 9, String(counts['1W'].raw));
    ok('short windows are drawn point for point',
       counts['1W'].drawn === counts['1W'].raw && counts['1M'].drawn === counts['1M'].raw,
       `1W ${counts['1W'].drawn}/${counts['1W'].raw}, 1M ${counts['1M'].drawn}/${counts['1M'].raw}`);
    ok('long windows are thinned', counts.ALL.drawn < counts.ALL.raw / 10,
       `${counts.ALL.drawn} drawn from ${counts.ALL.raw}`);
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 7. THINNING USES REAL OBSERVATIONS ───────────────────────────────────────
console.log('\nTHINNING — every drawn point is an observation that happened');
{
    const { ctx, page } = await boot({
        rfm_v1: JSON.stringify({ version: '3.0', networth: { bank: 1000000 }, sips: [], goals: [], investments: [] }),
    });
    // Deliberately ragged: an observation on a random day of each month rather
    // than the last, so "month-end" and "last observed" cannot be confused.
    const r = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const hist = [];
        for (let i = 730; i >= 0; i--) {
            const dt = new Date();
            dt.setDate(dt.getDate() - i);
            if (dt.getDate() % 3 === 0 || i === 0) {
                hist.push({ date: d.localDateKey(dt), value: 1000000 + (730 - i) * 37, source: 'test' });
            }
        }
        d.nwHistory = hist;
        d.nwChartRange = 'ALL';
        const drawn = d.nwChartSeries;
        const real = new Set(hist.map(p => p.date + '|' + p.value));
        const perMonth = {};
        for (const p of hist) (perMonth[p.date.slice(0, 7)] ||= []).push(p);
        return {
            n: hist.length,
            drawn: drawn.map(p => ({ date: p.date, value: p.value })),
            invented: drawn.filter(p => !real.has(p.date + '|' + p.value)).map(p => p.date),
            months: Object.keys(perMonth).length,
            // What the last ACTUAL observation of each month was.
            expected: Object.values(perMonth).map(list => list[list.length - 1].date),
            lastRaw: hist[hist.length - 1],
        };
    });

    ok('thinned to roughly one point a month', Math.abs(r.drawn.length - r.months) <= 1,
       `${r.drawn.length} drawn from ${r.n} observations across ${r.months} months`);
    ok('and never draws more than the legibility budget',
       r.drawn.length <= 60, String(r.drawn.length));
    // The core claim. A monthly chart that plots a month-end value the app never
    // computed is a fabricated valuation wearing a real date.
    ok('no drawn point was invented', r.invented.length === 0, r.invented.join(', ') || 'all real');
    ok('each is its month’s LAST real observation',
       r.drawn.map(p => p.date).join(',') === r.expected.join(','),
       r.drawn.map(p => p.date).slice(-3).join(',') + ' vs ' + r.expected.slice(-3).join(','));
    ok('the newest observation is never thinned away',
       r.drawn[r.drawn.length - 1].date === r.lastRaw.date &&
       r.drawn[r.drawn.length - 1].value === r.lastRaw.value,
       JSON.stringify(r.drawn[r.drawn.length - 1]));
    await ctx.close();
}

// ── 8. WHAT THE PERCENTAGE IS ALLOWED TO SAY ─────────────────────────────────
console.log('\nTHE HEADLINE — a change in a total is not a return');
{
    const cases = [
        { name: 'zero baseline',      from: 0,      to: 197729 },
        { name: 'negative baseline',  from: -50000, to: 197729 },
        { name: 'funded from ₹200',   from: 200,    to: 197729 },
        { name: 'an ordinary month',  from: 180000, to: 197729 },
    ];
    const { ctx, page, errors } = await boot({
        rfm_v1: JSON.stringify({ version: '3.0', networth: { bank: 197729 }, sips: [], goals: [], investments: [] }),
    });
    for (const c of cases) {
        const r = await page.evaluate(([from, to, d0, d1]) => {
            const d = document.querySelector('[x-data]')._x_dataStack[0];
            d.nwHistory = [{ date: d0, value: from, source: 't' }, { date: d1, value: to, source: 't' }];
            d.nwChartRange = '1M';
            return { change: d.nwRangeChange };
        }, [c.from, c.to, key(20), key(0)]);
        const pct = r.change?.pct;
        if (c.name === 'an ordinary month') {
            ok(`${c.name}: a percentage is offered`, typeof pct === 'number', String(pct));
            ok(`${c.name}: and it is right`, Math.abs(pct - ((c.to - c.from) / c.from) * 100) < 0.01, String(pct));
        } else {
            // Infinity from a ₹0 baseline, a sign flip from a negative one, and
            // +98,764% from a funded account are all arithmetic rather than
            // information. None of them may reach the screen.
            ok(`${c.name}: no percentage is claimed`, pct === null, String(pct));
        }
        ok(`${c.name}: the rupee change is still stated`,
           r.change?.delta === c.to - c.from, String(r.change?.delta));
        ok(`${c.name}: nothing infinite or NaN`, Number.isFinite(r.change?.delta) && !/Infinity|NaN/.test(JSON.stringify(r.change)),
           JSON.stringify(r.change));
    }

    await page.waitForTimeout(250);
    const dom = await read(page);
    ok('the DOM names it a change in total corpus', /change in total corpus/i.test(dom.hero),
       (dom.hero.match(/.{0,30}total corpus.{0,20}/) || [''])[0].trim());
    ok('the DOM says contributions are included',
       /includes money added or withdrawn/i.test(dom.hero));
    ok('never claims profit, gain or growth',
       !/\b(profits?|gains?|growth|appreciation)\b/i.test(dom.hero),
       (dom.hero.match(/\b(profits?|gains?|growth|appreciation)\b/i) || [''])[0]);
    // "return" may appear only where it is being denied. An unqualified
    // "return" anywhere in the hero would be the exact claim this cannot make.
    ok('the only mention of return is a denial',
       (dom.hero.match(/\breturns?\b/gi) || []).length ===
       (dom.hero.match(/not investment return/gi) || []).length,
       dom.hero.replace(/\n/g, ' | '));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 9. AN EARLY INDIAN MORNING IS NOT YESTERDAY ──────────────────────────────
console.log('\nLOCAL CALENDAR — 02:00 in Kolkata is today, not yesterday');
{
    // +05:30 puts local AHEAD of UTC, so the UTC date is never later than the
    // local one — it is EARLIER between midnight and 05:29. 02:00 IST on the
    // 21st is 20:30Z on the 20th, so toISOString() files it under the 20th and
    // the observation lands on a day that had already been recorded.
    const at = new Date('2026-09-21T02:00:00+05:30');
    const { ctx, page, errors } = await boot({
        rfm_v1: JSON.stringify({ version: '3.0', networth: { bank: 55000 }, sips: [], goals: [], investments: [] }),
    }, { clock: at });
    const r = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return {
            local: d.localDateKey(),
            utc: new Date().toISOString().slice(0, 10),
            hour: new Date().getHours(),
            written: d.nwHistory.map(p => p.date),
        };
    });
    ok('the clock really is an early Indian morning', r.hour === 2, `0${r.hour}:xx`);
    // If these two agree the case proves nothing, so assert the trap is armed.
    ok('UTC and local genuinely disagree here', r.utc !== r.local, `utc ${r.utc}, local ${r.local}`);
    ok('the key is the local day', r.local === '2026-09-21', r.local);
    ok('the observation is filed under today, not tomorrow',
       r.written.length === 1 && r.written[0] === '2026-09-21', JSON.stringify(r.written));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 10. IT SURVIVES A RELOAD, A RESTORE AND A NAVIGATION ─────────────────────
console.log('\nDURABILITY — reload, restore, and leaving Home and coming back');
{
    const seeded = JSON.stringify([
        { date: key(4), value: 300000, source: 'seed' },
        { date: key(3), value: 310000, source: 'seed' },
        { date: key(2), value: 305000, source: 'seed' },
    ]);
    const { ctx, page, errors } = await boot({
        rfm_v1: JSON.stringify({ version: '3.0', networth: { bank: 320000 }, sips: [], goals: [], investments: [] }),
        rfm_nw_history: seeded,
    });
    const first = await read(page);
    ok('seeded history is kept and today is added', first.history.length === 4,
       JSON.stringify(first.history.map(p => p.date)));

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2200);
    const reloaded = await read(page);
    ok('it survives a reload', reloaded.history.length === 4, JSON.stringify(reloaded.history.map(p => p.date)));
    ok('values survive too', reloaded.history[0].value === 300000, String(reloaded.history[0].value));

    // The chart is an SVG bound to the series: a range switch must redraw the
    // line from the new window, not leave the previous one on screen.
    const redraw = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const paths = [];
        for (const v of ['1W', 'ALL']) {
            d.setNwRange(v);
            await new Promise(r => setTimeout(r, 250));
            paths.push(document.querySelector('#nwChart path.line')?.getAttribute('d') || '');
        }
        d.setNwRange('1M');
        return { paths, drawn: d.nwChartSeries.length };
    });
    ok('every range switch leaves a line drawn from its window',
       redraw.paths.every(Boolean), JSON.stringify(redraw.paths.map(p => p.length)));
    ok('and it still has data to draw', redraw.drawn > 0, String(redraw.drawn));

    // Away and back is the path that once deadlocked the renderer, when the
    // chart was a canvas measured inside a View Transition.
    await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'investments'; });
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'home'; });
    await page.waitForTimeout(900);
    const back = await read(page);
    ok('the chart redraws after leaving Home and returning', back.canvas === true);
    ok('and the page is still running script',
       await page.evaluate(() => { const d = document.querySelector('[x-data]')._x_dataStack[0]; return d.nwChartData.length > 0; }));

    // A v2 backup envelope carries rfm_nw_history alongside the portfolio.
    const restored = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const envelope = {
            format: 'rfm-backup', exportedAt: new Date().toISOString(),
            keys: {
                rfm_v1: localStorage.getItem('rfm_v1'),
                rfm_nw_history: JSON.stringify([{ date: '2026-01-05', value: 111111, source: 'backup' }]),
            },
        };
        for (const k of Object.keys(envelope.keys)) {
            if (d.BACKUP_KEYS.includes(k)) localStorage.setItem(k, envelope.keys[k]);
        }
        d.loadData();
        d.loadNwHistory();
        d.renderNwChart();
        d.nwChartRange = 'ALL';
        return { history: d.nwHistory.map(p => p.date), carried: d.BACKUP_KEYS.includes('rfm_nw_history') };
    });
    ok('history is part of the backup contract', restored.carried);
    ok('a restore replaces history with the backup’s',
       restored.history.length === 1 && restored.history[0] === '2026-01-05', JSON.stringify(restored.history));

    const errs = errors.filter(e => !/favicon/i.test(e));
    ok('no console errors', errs.length === 0, errs[0] || '');
    await ctx.close();
}

// ── 11. GARBAGE IN ───────────────────────────────────────────────────────────
console.log('\nNORMALISATION — malformed and duplicate records cannot reach the chart');
{
    const messy = JSON.stringify([
        { date: key(2), value: 100 },
        { date: key(2), value: 200, capturedAt: '2026-01-01T00:00:00.000Z' },
        { date: key(2), value: 300, capturedAt: '2026-06-01T00:00:00.000Z' },
        { date: 'not-a-date', value: 999 },
        { date: key(1), value: 'abc' },
        { date: key(1), value: null },
        null,
        { value: 500 },
        { date: key(1) + 'T09:00:00Z', value: 400 },
    ]);
    const { ctx, page } = await boot({
        rfm_v1: JSON.stringify({ version: '3.0', networth: { bank: 1 }, sips: [], goals: [], investments: [] }),
        rfm_nw_history: messy,
    });
    const r = await read(page);
    const dates = r.history.map(p => p.date);
    ok('one record per day', new Set(dates).size === dates.length, dates.join(', '));
    ok('the malformed date is dropped', !dates.includes('not-a-date'), dates.join(', '));
    ok('non-numeric values are dropped', r.history.every(p => Number.isFinite(p.value)), JSON.stringify(r.history));
    // Re-saving means the newer number supersedes the older one; keeping the
    // first would make an edit look like it never happened.
    ok('the latest capture wins a duplicate day',
       r.history.find(p => p.date === key(2))?.value === 300,
       String(r.history.find(p => p.date === key(2))?.value));
    ok('a timestamped key is normalised to its day',
       r.history.some(p => p.date === key(1) && p.value === 400), JSON.stringify(r.history));
    ok('nothing renders as NaN or undefined', !/NaN|undefined|Infinity/.test(r.text),
       (r.text.match(/\S*(NaN|undefined|Infinity)\S*/) || [''])[0]);
    await ctx.close();
}

// ── 12. CORPUS IS THE ONLY GRAPH ──────────────────────────────────────────────
console.log('\nCORPUS ONLY — old return preference cannot change the series');
{
    const { ctx, page, errors } = await boot({
        corpus_chart_mode: 'return',
        rfm_v1: JSON.stringify({
            version: '3.0', networth: { bank: 50000 }, sips: [], goals: [],
            investments: [
                { id: 'g', name: 'Grower', type: 'Stock', ticker: 'G',
                  units: 100, buyPrice: 100, currentPrice: 120 },
                { id: 'p', name: 'Plot', type: 'Real Estate', amount: 500000 },
            ],
        }),
    });
    const r = await read(page);
    ok('at most one chart range selector', await page.locator('[role="tablist"][aria-label="Chart range"]').count() <= 1);
    ok('there is no Return or Corpus mode selector', await page.locator('[aria-label*="mode" i]').count() === 0);
    ok('legacy return preference does not change the corpus total', r.netWorth === 562000, String(r.netWorth));
    ok('today records the corpus value', r.history.length === 1 && r.history[0].value === 562000,
       JSON.stringify(r.history));
    ok('the chart uses rupees', await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return d.formatIndianShort(562000).includes('₹');
    }));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 13. THE FILTER CHIPS: THE APPROVED SET, NONE OF THEM A DEAD END ─────────
console.log('\nFILTER CHIPS — every chip lists holdings or says what belongs there');
{
    const { ctx, page } = await boot({
        rfm_v1: JSON.stringify({
            version: '3.0', networth: {}, sips: [], goals: [],
            investments: [
                { id: 'u', name: 'NVIDIA', type: 'Stock (US)', ticker: 'NVDA', units: 5, buyPrice: 100, currentPrice: 120 },
                { id: 'm', name: 'Quant Small Cap', type: 'Mutual Fund', schemeCode: '120503', units: 10, buyPrice: 100 },
            ],
        }),
    });
    await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'investments'; });
    await page.waitForTimeout(600);
    const r = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const chips = d.holdingChips.map(c => c.label);
        const rendered = [...document.querySelectorAll('[data-s~="ho"] .chips button')].map(b => b.textContent.trim());
        const outcome = {};
        for (const c of d.holdingChips) {
            d.invFilter = c.key;
            await new Promise(res => setTimeout(res, 120));
            const rows = document.querySelectorAll('.row.holding').length;
            const empty = document.querySelector('[data-s~="hofe"] .none .t-body')?.textContent.trim() || '';
            outcome[c.key] = { rows, empty };
        }
        d.invFilter = 'equity';
        const equity = d.chipHoldings.map(i => i.name);
        d.invFilter = 'all';
        return { chips, rendered, outcome, equity };
    });
    // Holdings v5 always offers the same chips; a chip with nothing in it opens
    // the approved "No bonds yet" state with a way to add one, never a blank list.
    ok('the approved chip set is offered', ['Stocks', 'Mutual funds', 'Deposits', 'Government schemes', 'Gold', 'Bonds']
       .every(c => r.chips.includes(c)), r.chips.join(' · '));
    ok('no chip is a dead end', Object.values(r.outcome).every(o => o.rows > 0 || o.empty),
       JSON.stringify(r.outcome));
    ok('one Stocks chip covers both markets', r.equity.includes('NVIDIA'), r.equity.join(', ') || '(none)');
    ok('the rendered row matches', r.rendered.join(' · ') === r.chips.join(' · '),
       `${r.rendered.join(' · ')} vs ${r.chips.join(' · ')}`);
    await ctx.close();
}

// ── 13b. GROUPED BY WHAT THEY ARE, INDIAN BEFORE US ─────────────────────────
console.log('\nHOLDING GROUPS — one card per kind, labelled');
{
    const { ctx, page } = await boot({
        rfm_v1: JSON.stringify({
            version: '3.0', networth: {}, sips: [], goals: [],
            investments: [
                { id: 'u', name: 'NVIDIA Corp', type: 'Stock (US)', ticker: 'NVDA', units: 5, buyPrice: 100, currentPrice: 120 },
                { id: 'i', name: 'Reliance', type: 'Stock (IND)', ticker: 'RELIANCE', units: 10, buyPrice: 2000, currentPrice: 2400 },
                { id: 'l', name: 'Legacy Co', type: 'Stock', ticker: 'LEG', units: 2, buyPrice: 50, currentPrice: 60 },
                { id: 'f', name: 'HDFC FD', type: 'Bank FD', amount: 100000 },
            ],
        }),
    });
    await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'investments'; });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.invFilter = 'all';
        const sections = d.holdingSections.map(g => ({ key: g.key, title: g.title, items: g.items.map(i => i.name) }));
        const heads = [...document.querySelectorAll('.ghead .t-group')].map(h => ({
            text: h.textContent.trim(), size: parseFloat(getComputedStyle(h).fontSize) }));
        return { sections, heads };
    });
    const at = k => r.sections.findIndex(g => g.key === k);
    ok('Indian stocks come before US stocks', at('ind') >= 0 && at('us') > at('ind'), r.sections.map(g => g.title).join(' · '));
    // An unsuffixed legacy 'Stock' is Indian in an Indian investor's app.
    ok('a legacy unsuffixed Stock files as Indian', r.sections[at('ind')].items.includes('Legacy Co'), JSON.stringify(r.sections));
    ok('a deposit is not filed with the stocks', r.sections[at('fixed')]?.items.join() === 'HDFC FD', JSON.stringify(r.sections));
    ok('nothing is lost between the groups', r.sections.reduce((n, g) => n + g.items.length, 0) === 4);
    ok('each group is titled on screen', r.heads.map(h => h.text).join(' · ') === r.sections.map(g => g.title).join(' · '),
       r.heads.map(h => h.text).join(' · '));
    ok('at or above the 14px floor', r.heads.every(h => h.size >= 14), r.heads.map(h => h.size).join(', '));

    // The dashboard still splits the markets, because there the split IS the point.
    const alloc = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return d.allocationRows.filter(r => r.key === 'us' || r.key === 'equity').map(r => ({ key: r.key, label: r.label }));
    });
    ok('the dashboard still names the market', alloc.some(r => r.key === 'us' && r.label === 'Stocks (US)'), JSON.stringify(alloc));
    ok('and the Indian side reads Stocks (IND)', alloc.some(r => r.key === 'equity' && r.label === 'Stocks (IND)'), JSON.stringify(alloc));
    await ctx.close();
}

// ── 14. ALLOCATION ROWS NAME THE INSTRUMENT, NOT THE BUCKET ─────────────────
console.log('\nALLOCATION LABELS — a one-instrument bucket says which instrument');
{
    const book = inv => JSON.stringify({
        version: '3.0', networth: {}, sips: [], goals: [], investments: inv,
    });
    // EPF is not in `investmentTypes` — the canonical list stops at
    // 'Government Scheme' — so a real EPF entry can be carrying EITHER shape
    // depending on how it was added. The label must not depend on which.
    const EPF_AS_SCHEME = { id: 'e', name: 'EPF', type: 'Government Scheme', amount: 28874 };
    const EPF_AS_TYPE   = { id: 'e', name: 'EPF', type: 'EPF', amount: 28874 };
    const US_STOCK      = { id: 'u', name: 'NVIDIA Corp', type: 'Stock (US)', ticker: 'NVDA',
                            units: 5, buyPrice: 100, currentPrice: 120 };
    const FUND          = { id: 'm', name: 'Quant Small Cap', type: 'Mutual Fund',
                            schemeCode: '120503', units: 10, buyPrice: 100, currentPrice: 105 };
    const BANK_FD       = { id: 'f', name: 'HDFC FD', type: 'Bank FD', amount: 100000 };

    const labelOf = (page, key) => page.evaluate(k => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const row = d.allocationRows.find(r => r.key === k);
        return row ? row.label : null;
    }, key);

    for (const [shape, holding] of [['typed as a Government Scheme', EPF_AS_SCHEME],
                                    ['typed literally EPF', EPF_AS_TYPE]]) {
        const { ctx, page } = await boot({ rfm_v1: book([holding]) });
        const label = await labelOf(page, 'debt');
        ok(`a lone EPF reads "EPF" when ${shape}`, label === 'EPF', String(label));
        await ctx.close();
    }

    {
        const { ctx, page } = await boot({ rfm_v1: book([US_STOCK, FUND]) });
        const us = await labelOf(page, 'us');
        const mf = await labelOf(page, 'mf');
        // Not "US" (says where, not what) and not "NVIDIA Corp" (a company, not
        // a kind of thing to own). Instrument first, market in the bracket, so
        // the column reads as a list of things owned rather than of places.
        ok('a US equity book reads "Stocks (US)"', us === 'Stocks (US)', String(us));
        ok('a fund book reads "Mutual funds"', mf === 'Mutual funds', String(mf));
        await ctx.close();
    }

    {
        // Two instruments in one bucket genuinely ARE the bucket. Picking
        // either name would state something false about the other.
        const { ctx, page } = await boot({ rfm_v1: book([EPF_AS_SCHEME, BANK_FD]) });
        const debt = await labelOf(page, 'debt');
        ok('a mixed bucket falls back to the class name', debt === 'Deposits', String(debt));
        await ctx.close();
    }

    {
        // The rows feed verify-figures' sum assertions, so the rename must not
        // have disturbed anything a caller reads by key.
        const { ctx, page } = await boot({ rfm_v1: book([EPF_AS_SCHEME, US_STOCK, FUND]) });
        const r = await page.evaluate(() => {
            const d = document.querySelector('[x-data]')._x_dataStack[0];
            return {
                rows: d.allocationRows.map(x => ({ key: x.key, label: x.label, value: x.value })),
                assets: d.totalAssets,
                // The chips are filters, not statements about what is held: one
                // labelled "EPF" would still match a PPF added tomorrow.
                chips: d.holdingChips.map(f => f.label),
            };
        });
        const sum = r.rows.reduce((a, x) => a + x.value, 0);
        ok('every row still carries a key and a value',
           r.rows.every(x => x.key && Number.isFinite(x.value)), JSON.stringify(r.rows));
        ok('rows still sum to total assets', Math.abs(sum - r.assets) <= 2,
           `${Math.round(sum)} vs ${Math.round(r.assets)}`);
        ok('the filter chips keep their class names',
           r.chips.includes('Government schemes') && !r.chips.includes('EPF'), r.chips.join(' · '));
        await ctx.close();
    }
}

// ── 15. THE GAP READS AS A DIRECTION ────────────────────────────────────────
console.log('\nCASHFLOW — the monthly gap is green when money is left over, red when short');
{
    const read = async (incomes, expenses) => {
        const { ctx, page } = await boot({
            rfm_v1: JSON.stringify({ version: '3.0', networth: {}, sips: [], goals: [], investments: [],
                                     cashflow: { incomes, expenses } }),
        });
        await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'income'; });
        await page.waitForTimeout(600);
        const r = await page.evaluate(() => {
            const tag = document.querySelector('[data-s~="is"] .hero .gap span');
            const heads = [...document.querySelectorAll('[data-s~="is"] .card .head')].map(h => ({
                title: h.querySelector('.t-section')?.textContent.trim(), value: h.querySelector('.t-value')?.textContent.trim() }));
            const cs = getComputedStyle(tag);
            return { cls: tag.className, bg: cs.backgroundColor, text: tag.textContent.trim(), size: parseFloat(cs.fontSize), heads };
        });
        await ctx.close();
        return r;
    };
    const plus = await read([{ id: 'i1', name: 'Salary', amount: 120000 }], [{ id: 'e1', name: 'Rent', amount: 45000 }]);
    const minus = await read([{ id: 'i1', name: 'Pension', amount: 30000 }], [{ id: 'e1', name: 'Rent', amount: 45000 }]);
    ok('money left over is a green tag', plus.cls.includes('tag-up') && plus.bg === 'rgb(20, 83, 45)', `${plus.text} on ${plus.bg}`);
    ok('a shortfall is a red tag', minus.cls.includes('tag-down') && minus.bg === 'rgb(112, 26, 26)', `${minus.text} on ${minus.bg}`);
    ok('the clusters state both totals', plus.heads.some(h => h.title === 'Coming in' && h.value === '₹1,20,000')
       && plus.heads.some(h => h.title === 'Going out' && h.value === '₹45,000'), JSON.stringify(plus.heads));
    ok('nothing falls below the 14px floor', plus.size >= 14 && minus.size >= 14, `${plus.size}px / ${minus.size}px`);
}

await browser.close();
console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' | ') : 'HISTORY OK'}\n`);
process.exit(fails.length ? 1 : 0);
