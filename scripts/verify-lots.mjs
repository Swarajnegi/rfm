// Topping up a holding, tested as money rather than as UI.
//
// This is cost-basis arithmetic, so every expected figure below is computed by
// hand in the comment beside it. Asserting that the code agrees with itself
// would pass just as happily on a wrong formula.
//
// The off-hours path is the interesting one. An order placed while the exchange
// is shut fills at the NEXT open, which the app cannot witness — it is asleep.
// It does not need to: the open of a session that has already happened sits in
// the daily candles and is read back retroactively. These tests drive that with
// a fixed candle series rather than the network, which is cut here anyway.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const fails = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fails.push(label);
};
const near = (a, b, tol = 1e-4) => Math.abs(Number(a) - Number(b)) <= tol;

const URL = pathToFileURL(path.resolve('web/index.html')).href;
const browser = await chromium.launch();

const BOOK = inv => JSON.stringify({
    version: '3.0', networth: {}, sips: [], goals: [], investments: inv,
});

// 4 units of a $310 average — the running example.
const AVGO = {
    id: 'avgo', name: 'Broadcom', type: 'Stock (US)', ticker: 'AVGO', currency: 'USD',
    units: 4, buyPrice: 310, currentPrice: 312.40,
};
const RELIANCE = {
    id: 'ril', name: 'Reliance', type: 'Stock (IND)', ticker: 'RELIANCE',
    units: 10, buyPrice: 2000, currentPrice: 2400,
};

async function boot(investments) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    // Seeded only when absent. addInitScript re-runs on every navigation, so a
    // plain setItem re-seeds the fixture over whatever the app just saved —
    // which makes a reload test read the ORIGINAL book back and call it
    // "unchanged". verify-figures carries the same note for the same reason.
    await page.addInitScript(s => {
        if (!localStorage.getItem('rfm_v1')) localStorage.setItem('rfm_v1', s);
        localStorage.setItem('corpus_tour_v1', 'seen'); localStorage.setItem('rfm_v1', JSON.stringify((v => ({ ...v, profile: v.profile || { version: 2, completedAt: '2026-09-01T00:00:00.000Z', name: 'Test', age: 40, goal: 'balanced', risk: 'medium', horizon: '7to15', interests: ['stocks'] } }))(JSON.parse(localStorage.getItem('rfm_v1') || '{}'))));
        localStorage.setItem('rfm_tour_v1', 'seen');
        localStorage.setItem('corpus_chart_mode', 'corpus');
    }, BOOK(investments));
    await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    return { ctx, page, errors };
}

const holding = (page, id) => page.evaluate(i => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    const h = d.investments.find(x => x.id === i);
    return h ? { units: h.units, buyPrice: h.buyPrice, currentValue: h.currentValue,
                 pending: (h.pendingLots || []).map(l => ({ amount: l.amount, unresolved: !!l.unresolved })),
                 settled: (h.settledLots || []).length } : null;
}, id);

// ── 1. THE ARITHMETIC ────────────────────────────────────────────────────────
console.log('\nDURING MARKET HOURS — units and average, computed not typed');
{
    const { ctx, page, errors } = await boot([AVGO]);
    const preview = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.openAddLot(d.investments[0]);
        d.lotForm.amount = 500;
        d.lotForm.timing = 'market';
        return d.lotPreview;
    });
    // By hand: 500 / 312.40          = 1.600512...
    //          qty  4 + 1.600512     = 5.600512...
    //          cost 4×310 + 500      = 1740
    //          avg  1740 / 5.600512  = 310.6858...
    ok('price is the live quote', near(preview.price, 312.40), String(preview.price));
    ok('units = amount / price', near(preview.units, 500 / 312.40), preview.units.toFixed(6));
    ok('  which is 1.600512', near(preview.units, 1.600512, 1e-6), preview.units.toFixed(6));
    ok('new quantity is 5.600512', near(preview.newQty, 5.600512, 1e-6), preview.newQty.toFixed(6));
    // Cost-weighted, NOT the mean of the two prices. (310+312.40)/2 = 311.20 is
    // the wrong answer and is what averaging prices instead of costs produces.
    ok('new average is cost-weighted', near(preview.newAvg, 1740 / (4 + 500 / 312.40), 1e-6),
       preview.newAvg.toFixed(6));
    ok('  which is 310.6858, not 311.20', near(preview.newAvg, 310.6858, 1e-3) && !near(preview.newAvg, 311.20, 1e-2),
       preview.newAvg.toFixed(4));

    await page.evaluate(() => document.querySelector('[x-data]')._x_dataStack[0].commitAddLot());
    await page.waitForTimeout(500);
    const after = await holding(page, 'avgo');
    ok('committing writes it to the holding', near(after.units, 5.600512, 1e-6), String(after.units));
    ok('and the average with it', near(after.buyPrice, 310.6858, 1e-3), String(after.buyPrice));
    ok('nothing is left pending', after.pending.length === 0, JSON.stringify(after.pending));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 2. CURRENCY ──────────────────────────────────────────────────────────────
console.log('\nCURRENCY — a dollar amount stays a dollar amount');
{
    const { ctx, page } = await boot([AVGO, RELIANCE]);
    const r = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const us = d.investments.find(i => i.id === 'avgo');
        const ind = d.investments.find(i => i.id === 'ril');
        d.openAddLot(us); d.lotForm.amount = 500; d.lotForm.timing = 'market';
        const usPrev = d.lotPreview;
        d.openAddLot(ind); d.lotForm.amount = 24000; d.lotForm.timing = 'market';
        const indPrev = d.lotPreview;
        return { fx: d.fxUsdInr, usCur: d.lotCurrency(us), indCur: d.lotCurrency(ind),
                 usAvg: usPrev.newAvg, usUnits: usPrev.units,
                 indAvg: indPrev.newAvg, indUnits: indPrev.units,
                 usLabel: d.formatNative(us, 500), indLabel: d.formatNative(ind, 500) };
    });
    ok('a US holding is quoted in USD', r.usCur === 'USD' && r.usLabel.startsWith('$'), r.usLabel);
    ok('an Indian one in INR', r.indCur === 'INR' && /₹/.test(r.indLabel), r.indLabel);
    // buyPrice is stored natively and getInvInvestedCost applies FX on the way
    // OUT. Converting on the way in would leave a rupee figure sitting in a
    // dollar field and silently inflate the cost basis ~88x.
    ok('the new USD average is nowhere near FX-scaled',
       r.usAvg < 400 && r.usAvg > 300, `${r.usAvg.toFixed(2)} with fx ${r.fx}`);
    ok('units are not FX-scaled either', near(r.usUnits, 500 / 312.40, 1e-6), r.usUnits.toFixed(6));
    // 24000 / 2400 = exactly 10 units; avg (10×2000 + 24000)/20 = 2200
    ok('the Indian side is plain arithmetic', near(r.indUnits, 10) && near(r.indAvg, 2200),
       `${r.indUnits} units, avg ${r.indAvg}`);
    await ctx.close();
}

// ── 3. OFF HOURS — RECORDED, NOT PRICED ──────────────────────────────────────
console.log('\nOFF HOURS — nothing is folded in until a session opens');
{
    const { ctx, page, errors } = await boot([AVGO]);
    const preview = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.openAddLot(d.investments[0]);
        d.lotForm.amount = 500;
        d.lotForm.timing = 'offhours';
        return d.lotPreview;
    });
    // The fill price is the open of a session that has not happened. Showing
    // the current quote here would state a price the trade will not get.
    ok('no price is offered', preview.pending === true && preview.price === undefined,
       JSON.stringify(preview));

    await page.evaluate(() => document.querySelector('[x-data]')._x_dataStack[0].commitAddLot());
    await page.waitForTimeout(400);
    const after = await holding(page, 'avgo');
    ok('the position is UNCHANGED', near(after.units, 4) && near(after.buyPrice, 310),
       `${after.units} @ ${after.buyPrice}`);
    ok('the purchase is recorded as pending', after.pending.length === 1 && after.pending[0].amount === 500,
       JSON.stringify(after.pending));

    const note = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { note: d.pendingLotNote(d.investments[0]), count: d.pendingLotCount };
    });
    ok('and the screen says so', /waiting for the next market open/.test(note.note), note.note);
    ok('the count is visible to the app', note.count === 1, String(note.count));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 4. SETTLEMENT ────────────────────────────────────────────────────────────
console.log('\nSETTLEMENT — the first open AFTER the purchase, read back later');
{
    const { ctx, page, errors } = await boot([AVGO]);

    // A fixed candle series standing in for the network, shaped exactly like
    // the real response: timestamps are session opens in UTC seconds, and
    // indicators.quote[0].open carries the opening price of each.
    const r = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const DAY = 86400;
        const base = Math.floor(Date.parse('2026-09-15T13:30:00Z') / 1000);
        const times = [base, base + DAY, base + 2 * DAY, base + 3 * DAY, base + 6 * DAY];
        const opens = [346.04, 342.37, 346.62, 352.08, 358.66];
        const calls = [];
        d._dailyOpens = async () => { calls.push(1); return { times, opens }; };

        const inv = d.investments[0];
        // Placed on the evening of the 16th, after that session's open.
        inv.pendingLots = [{ id: 'lot1', amount: 500, placedAt: '2026-09-16T20:00:00Z', basis: 'open' }];

        const settled = await d.settlePendingLots(inv);
        const first = { units: inv.units, buyPrice: inv.buyPrice, pending: (inv.pendingLots || []).length };
        // Run it again — a second sync must not buy the same units twice.
        const again = await d.settlePendingLots(inv);
        return { settled, again, first, calls: calls.length,
                 units: inv.units, buyPrice: inv.buyPrice,
                 settledIds: (inv.settledLots || []).slice() };
    });

    // The 16th's open (342.37) is BEFORE the 20:00 placement, so the fill is
    // the 17th's open, 346.62. Taking the nearest candle instead of the first
    // one strictly after would pick 342.37 and flatter the entry.
    // By hand: 500 / 346.62        = 1.442502...
    //          qty  4 + 1.442502   = 5.442502...
    //          avg  1740 / 5.4425  = 319.7003...
    ok('one lot settles', r.settled === 1, String(r.settled));
    ok('at the first open AFTER the purchase, not the nearest',
       near(r.units, 4 + 500 / 346.62, 1e-6), `${r.units.toFixed(6)} units`);
    ok('  i.e. 346.62, not 342.37', near(r.units, 5.442502, 1e-6), r.units.toFixed(6));
    ok('the average follows', near(r.buyPrice, 1740 / (4 + 500 / 346.62), 1e-6), r.buyPrice.toFixed(4));
    ok('the pending queue empties', r.first.pending === 0, String(r.first.pending));
    // Idempotence is not decoration: the sync path and the app-open path can
    // both fire within a second of each other.
    ok('settling twice buys nothing twice', r.again === 0 && near(r.units, 5.442502, 1e-6),
       `${r.again} on the second pass, ${r.units.toFixed(6)} units`);
    ok('the lot id is remembered', r.settledIds.includes('lot1'), JSON.stringify(r.settledIds));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 5. NOT YET, AND TOO OLD ──────────────────────────────────────────────────
console.log('\nUNSETTLED — the session has not opened, or cannot be seen');
{
    const { ctx, page } = await boot([AVGO]);
    const r = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const DAY = 86400;
        const base = Math.floor(Date.parse('2026-09-15T13:30:00Z') / 1000);
        const times = [base, base + DAY, base + 2 * DAY];
        const opens = [346.04, 342.37, 346.62];
        d._dailyOpens = async () => ({ times, opens });
        const inv = d.investments[0];

        // (a) Placed after the last candle: the session simply has not opened.
        inv.pendingLots = [{ id: 'future', amount: 500, placedAt: '2026-09-18T20:00:00Z', basis: 'open' }];
        const a = await d.settlePendingLots(inv);
        const afterA = { n: a, units: inv.units, pending: inv.pendingLots.length,
                         unresolved: !!inv.pendingLots[0]?.unresolved };

        // (b) Placed BEFORE the window starts. Some session in between may have
        //     been the real fill and it is not visible, so settling at the
        //     first candle we happen to hold would be a plausible guess, not a
        //     fact.
        inv.pendingLots = [{ id: 'ancient', amount: 500, placedAt: '2026-06-01T09:00:00Z', basis: 'open' }];
        const b = await d.settlePendingLots(inv);
        const afterB = { n: b, units: inv.units, pending: inv.pendingLots.length,
                         unresolved: !!inv.pendingLots[0]?.unresolved,
                         note: d.pendingLotNote(inv) };
        return { afterA, afterB };
    });
    ok('a purchase awaiting its session stays pending',
       r.afterA.n === 0 && r.afterA.pending === 1 && near(r.afterA.units, 4), JSON.stringify(r.afterA));
    ok('and is not flagged as a problem', r.afterA.unresolved === false, String(r.afterA.unresolved));

    ok('a purchase older than the window is NOT settled at a guess',
       r.afterB.n === 0 && near(r.afterB.units, 4), JSON.stringify(r.afterB));
    ok('it is kept, not dropped', r.afterB.pending === 1, String(r.afterB.pending));
    ok('and flagged for manual entry', r.afterB.unresolved === true && /by hand/.test(r.afterB.note),
       r.afterB.note);
    await ctx.close();
}

// ── 6. THE SHEET ─────────────────────────────────────────────────────────────
console.log('\nTHE SHEET — reachable, honest, and it closes');
{
    const { ctx, page, errors } = await boot([AVGO, { id: 'fd', name: 'HDFC FD', type: 'Bank FD', amount: 100000, rate: 7 }]);
    const r = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.openHolding(d.investments[0]);
        await new Promise(res => setTimeout(res, 500));
        const main = [...document.querySelectorAll('main')].find(m => m.offsetParent !== null);
        const btn = [...main.querySelectorAll('button')].find(b => /bought more/i.test(b.innerText));
        const box = btn ? btn.getBoundingClientRect() : null;
        // A deposit has no units and no quote — there is nothing to average.
        d.openHolding(d.investments[1]);
        await new Promise(res => setTimeout(res, 400));
        const main2 = [...document.querySelectorAll('main')].find(m => m.offsetParent !== null);
        const onFd = [...main2.querySelectorAll('button')].some(b => /bought more/i.test(b.innerText));
        return { present: !!btn, w: box ? Math.round(box.width) : 0, h: box ? Math.round(box.height) : 0, onFd };
    });
    ok('the action is on the holding screen', r.present);
    ok('and is a real tap target', r.h >= 44 && r.w >= 44, `${r.w}x${r.h}`);
    ok('a deposit is not offered it', r.onFd === false);

    const sheet = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.openHolding(d.investments[0]);
        await new Promise(res => setTimeout(res, 400));
        d.openAddLot(d.investments[0]);
        await new Promise(res => setTimeout(res, 500));
        const el = document.querySelector('.bsheet[aria-label="Add to position"]');
        const visible = !!el && el.offsetParent !== null;
        const text = visible ? el.innerText : '';
        d.lotForm.amount = 500; d.lotForm.timing = 'offhours';
        await new Promise(res => setTimeout(res, 350));
        const offText = el ? el.innerText : '';
        const radios = el ? [...el.querySelectorAll('[role="radiogroup"] [role="radio"]')].map(b => b.textContent.trim()) : [];
        return { visible, text, offText, radios };
    });
    ok('the sheet opens', sheet.visible);
    ok('it names the holding', /Broadcom/.test(sheet.text), sheet.text.split('\n')[0] || '');
    // Add to a position v4 asks with two choices rather than a dropdown.
    ok('the timing is a two-way choice', sheet.radios.join(' / ') === 'During market hours / After the close', sheet.radios.join(' / '));
    // The off-hours branch must not print a price anywhere — that is the whole
    // claim it is making.
    ok('off hours shows no fill price', !/\$3\d\d\./.test(sheet.offText),
       (sheet.offText.match(/\$\d[\d.,]*/g) || []).join(' ') || 'no prices');
    ok('and says it settles at the open', /next market open/i.test(sheet.offText));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok('Escape closes it', await page.evaluate(() => !document.querySelector('[x-data]')._x_dataStack[0].addingLot));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 7. IT SURVIVES A RELOAD ──────────────────────────────────────────────────
console.log('\nPERSISTENCE — a pending purchase is not lost on close');
{
    const { ctx, page } = await boot([AVGO]);
    await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.openAddLot(d.investments[0]);
        d.lotForm.amount = 750; d.lotForm.timing = 'offhours';
        d.commitAddLot();
    });
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2200);
    const after = await holding(page, 'avgo');
    ok('the pending purchase is still there after a reload',
       after.pending.length === 1 && after.pending[0].amount === 750, JSON.stringify(after.pending));
    ok('and the position is still untouched', near(after.units, 4) && near(after.buyPrice, 310),
       `${after.units} @ ${after.buyPrice}`);
    await ctx.close();
}

await browser.close();
console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' | ') : 'LOTS OK'}\n`);
process.exit(fails.length ? 1 : 0);
