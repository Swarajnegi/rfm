// Invested, value and gain, tested against a real book.
//
// The fixture is shaped exactly like the one that exposed the bug: five US
// stocks (a broker shows invested $1,362.44, now $1,336.56), two mutual funds
// that arrived through a statement import (cost kept in `amount`, no buy
// price), and an EPF balance. The AI reading reported a ₹49,392 "gain" on it,
// because its private copy of the maths counted the imported funds as ₹0
// invested at their full value. Every expected figure is worked by hand below;
// asserting that the code agrees with itself would pass on a wrong formula.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const fails = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fails.push(label);
};
const near = (a, b, tol = 1.5) => Math.abs(Number(a) - Number(b)) <= tol;

const FX = 95.92;
const US = [
    // units, average $, price now $
    ['Broadcom', 'AVGO', 1.303029, 386.24, 353.62],   // 503.28 → 460.78
    ['NVIDIA', 'NVDA', 2, 180, 190],                   // 360.00 → 380.00
    ['Marvell', 'MRVL', 3, 80, 78],                    // 240.00 → 234.00
    ['Roundhill Memory', 'DRAM', 5, 30, 32],           // 150.00 → 160.00
    ['Micron', 'MU', 2, 54.580029, 50.890029],         // 109.16 → 101.78
].map(([name, ticker, units, buyPrice, currentPrice], i) => ({
    id: `us${i}`, name, ticker, type: 'Stock (US)', currency: 'USD', units, buyPrice, currentPrice,
}));
// Invested $1,362.44 and now $1,336.56 (the broker's figures), to the cent.
const usCost = US.reduce((a, h) => a + h.units * h.buyPrice, 0);
const usNow = US.reduce((a, h) => a + h.units * h.currentPrice, 0);

// As the statement importer wrote them: cost in amount, NAV as the price.
const MF = [
    { id: 'inv', name: 'Invesco India Mid Cap Fund Direct Growth', type: 'Mutual Fund', schemeCode: '120505',
      units: 131.348, amount: 27999, nav: 31181 / 131.348, currentPrice: 31181 / 131.348, currentValue: 31181, importSource: 'CAS' },
    { id: 'qnt', name: 'Quant Small Cap Fund Direct Plan Growth', type: 'Mutual Fund', schemeCode: '120828',
      units: 65.328, amount: 17998.70, nav: 20835.09 / 65.328, currentPrice: 20835.09 / 65.328, currentValue: 20835.09, importSource: 'CAS' },
];
const EPF = { id: 'epf', name: 'EPF', type: 'Government Scheme', amount: 28747, currentValue: 28747 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(([s, fx]) => {
    if (!localStorage.getItem('rfm_v1')) localStorage.setItem('rfm_v1', s);
    localStorage.setItem('rfm_usd_inr_rate', JSON.stringify({ rate: fx, ts: Date.now() }));
    localStorage.setItem('corpus_tour_v1', 'seen');
}, [JSON.stringify({ version: '3.0', networth: {}, sips: [], goals: [], investments: [...US, ...MF, EPF],
    profile: { version: 2, completedAt: '2026-09-01T00:00:00.000Z', name: 'Test', age: 30, holdings: ['us_stocks', 'mf'] } }), FX]);
await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
await page.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil: 'load' });
await page.waitForTimeout(1800);

const r = await page.evaluate(fx => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    d.usdInrRate = fx;
    const snap = window.RegenWealth.buildPortfolioSnapshot(d);
    const byId = id => d.investments.find(i => i.id === id);
    d.activePage = 'investments'; d.invFilter = 'mf';
    return new Promise(res => setTimeout(() => res({
        fx: d.fxUsdInr,
        book: { ...d.marketBook },
        total: d.holdingsTotal,
        fundTags: ['inv', 'qnt'].map(id => d.holdingTag(byId(id))?.label || null),
        fundCost: ['inv', 'qnt'].map(id => d.getInvInvestedCost(byId(id))),
        epfLinked: d.isMarketLinked(byId('epf')),
        snap: { invested: snap.totalInvested, value: snap.pricedValue, gain: snap.marketGain, pct: snap.marketGainPct,
                balances: snap.balancesValue, all: snap.totalMarketValue, unknown: snap.costUnknown, alloc: snap.allocationPct },
    }), 400));
}, FX);

console.log('\nMONEY — a statement-imported fund keeps what it cost');
// Invesco: 27,999 → 31,181 is +11.36%; Quant: 17,998.70 → 20,835.09 is +15.76%.
ok('each imported fund costs what the statement said', near(r.fundCost[0], 27999) && near(r.fundCost[1], 17998.70), r.fundCost.map(Math.round).join(', '));
ok('its row shows the real gain, not +0.00%', r.fundTags[0] === '↑ 11.4%' && r.fundTags[1] === '↑ 15.8%', r.fundTags.join(' · '));

console.log('\nMONEY — one set of figures across the app and the AI reading');
// US at ₹95.92: 1,362.44 → ₹1,30,685.2 invested, 1,336.56 → ₹1,28,202.8 now.
// Funds: 45,997.70 → 52,016.09. Market-linked: 1,76,682.9 → 1,80,218.9, +3,536.0.
const invested = usCost * FX + 45997.70, now = usNow * FX + 52016.09;
ok('the fixture is the broker book', near(usCost, 1362.44, 0.01) && near(usNow, 1336.56, 0.01), `$${usCost.toFixed(2)} → $${usNow.toFixed(2)}`);
ok('the app reads it at the rate given', r.fx === FX, String(r.fx));
ok('market-linked invested is ₹1,76,683', near(r.book.invested, 176682.9) && near(invested, 176682.9), Math.round(r.book.invested).toLocaleString('en-IN'));
ok('and worth ₹1,80,219 now', near(r.book.value, 180218.9) && near(now, 180218.9), Math.round(r.book.value).toLocaleString('en-IN'));
ok('a gain of about ₹3,536 (+2.0%), not ₹49,392', near(r.book.gain, 3536.0) && near(r.book.gainPct, 2.0, 0.05), `${Math.round(r.book.gain)} (${r.book.gainPct?.toFixed(2)}%)`);
ok('the AI snapshot quotes exactly the same figures', near(r.snap.invested, r.book.invested, 3) && near(r.snap.value, r.book.value, 3)
   && near(r.snap.gain, r.book.gain, 3), JSON.stringify({ invested: r.snap.invested, value: r.snap.value, gain: r.snap.gain, pct: r.snap.pct }));
ok('EPF is a balance, not money invested', r.epfLinked === false && r.snap.balances === 28747, `balances ₹${r.snap.balances}`);
ok('nothing is left out for want of a buy price', r.book.unknown.length === 0 && r.snap.unknown.length === 0, r.snap.unknown.join(', ') || 'none');
ok('the Holdings total is everything held', near(r.total, 180218.9 + 28747), Math.round(r.total).toLocaleString('en-IN'));
ok('US stocks are one line of the split', Object.keys(r.snap.alloc).filter(k => /US/.test(k)).length === 1, JSON.stringify(r.snap.alloc));

// A market holding whose cost is genuinely unknown is named and kept out of
// both sides, never counted at its full value as profit.
const u = await page.evaluate(() => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    d.investments.push({ id: 'x', name: 'Mystery Fund', type: 'Mutual Fund', units: 10, currentPrice: 100 });
    const snap = window.RegenWealth.buildPortfolioSnapshot(d);
    const out = { unknown: snap.costUnknown, gain: snap.marketGain, bookUnknown: d.marketBook.unknown, tag: d.holdingTag(d.investments.at(-1)) };
    d.investments.pop();
    return out;
});
ok('a holding with no buy price is named, not counted as gain', u.unknown.includes('Mystery Fund') && u.bookUnknown.includes('Mystery Fund')
   && near(u.gain, r.snap.gain, 3) && !u.tag, JSON.stringify(u));

console.log('\nSIPS — a SIP for a fund you hold adds to that fund');
// The statement named it "Invesco India Mid Cap Fund Direct Growth"; AMFI's
// search says "Invesco India Midcap Fund - Direct Plan - Growth" with a scheme
// code the imported row never had. Both must resolve to the one holding.
const sip = await page.evaluate(async () => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    const before = d.investments.length;
    d.newSip = { ...d.newSip, name: 'Invesco India Midcap Fund - Direct Plan - Growth', schemeCode: '120505', type: 'SIP', monthlyAmount: 5000, dayOfMonth: 5 };
    await d.addSip();
    d.newSip = { ...d.newSip, name: 'Quant Small Cap Fund - Growth - Direct Plan', schemeCode: '120828', type: 'SIP', monthlyAmount: 3000, dayOfMonth: 10 };
    await d.addSip();
    const s1 = d.sips.at(-2), s2 = d.sips.at(-1);
    return { before, after: d.investments.length, l1: s1.linkedInvestmentId, l2: s2.linkedInvestmentId,
             line: d.sipLink(s1).text };
});
ok('no second copy of either fund is created', sip.after === sip.before, `${sip.before} → ${sip.after} holdings`);
ok('each SIP links to the fund already held', sip.l1 === 'inv' && sip.l2 === 'qnt', `${sip.l1}, ${sip.l2}`);
ok('the SIP row says where its money goes', /Adds to your 131\.348 units/.test(sip.line), sip.line);

// SIPs made by the old matcher pointed at an empty copy; launch repairs them.
const repair = await page.evaluate(() => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    d.investments.push({ id: 'dup', name: 'Invesco India Midcap Fund - Direct Plan - Growth', type: 'Mutual Fund', schemeCode: '999999', units: 0, buyPrice: 0, amount: 0 });
    d.sips.push({ id: 'old', name: 'Invesco India Midcap Fund - Direct Plan - Growth', schemeCode: '999999', type: 'SIP', monthlyAmount: 5000, dayOfMonth: 5, status: 'Active', linkedInvestmentId: 'dup' });
    d._repairSipLinks();
    const out = { link: d.sips.find(s => s.id === 'old').linkedInvestmentId, dupGone: !d.investments.some(i => i.id === 'dup') };
    d.sips = d.sips.filter(s => s.id !== 'old');
    return out;
});
ok('an old SIP on an empty copy moves to the real fund', repair.link === 'inv' && repair.dupGone, JSON.stringify(repair));

// Confirming an instalment averages onto what the units really cost.
const debit = await page.evaluate(async () => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    const s1 = d.sips.find(s => s.linkedInvestmentId === 'inv');
    const h = d.investments.find(i => i.id === 'inv');
    const units0 = h.units, cost0 = d.getInvInvestedCost(h);
    s1.lastExecutedMonth = '2000-01'; // The fixture is due before confirming this instalment.
    await d.confirmSipDebit(s1);
    return { units0, cost0, units1: h.units, cost1: d.getInvInvestedCost(h), price: h.currentPrice };
});
// 5,000 at NAV 237.39 buys 21.063 units; cost goes 27,999 → 32,999.
ok('an instalment adds its units at the NAV', Math.abs(debit.units1 - debit.units0 - 5000 / debit.price) < 0.002, `${debit.units0} → ${debit.units1}`);
ok('and its cost onto what was paid, not on the value', Math.abs(debit.cost1 - (debit.cost0 + 5000)) < 2, `${Math.round(debit.cost0)} → ${Math.round(debit.cost1)}`);

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log('\nall money checks passed');
