// The figures, measured against the rules they claim to implement.
//
// The rest of the harness proves the app RENDERS. Nothing in it could tell you that the
// senior-citizen checkbox was wired to nothing, that three fields on the net-worth screen
// were write-only, or that opening the app bought mutual fund units at an invented ₹100
// NAV. Every one of those looked perfect on screen and in every screenshot.
//
// So this suite asserts on arithmetic and on state, never on pixels. It drives the real
// Alpine component in a real browser with the network cut, sets inputs, and reads the
// numbers back out.
//
// What it does NOT cover: whether the slab rates themselves are current law (they are
// FY 2024-25 here), and anything about the PDF import path, which needs fixtures.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const fails = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fails.push(label);
};
const near = (a, b, tol = 1) => Math.abs(Number(a) - Number(b)) <= tol;

const browser = await chromium.launch();

// Boot with a portfolio seeded straight into the OLD key shapes, so the migration is
// exercised rather than assumed: a rate stranded on interestRate, and money stranded on
// bankBalance / cashOnHand / propertyValue.
const LEGACY = JSON.stringify({
    version: '3.0',
    investments: [
        { id: 'legacy1', name: 'Legacy FD', type: 'Bank FD', amount: 1000000,
          interestRate: 7, rate: 0, payout: 'Monthly', maturityDate: '2030-01-01' },
    ],
    networth: { bankBalance: 250000, cashOnHand: 50000, propertyValue: 4000000, credit: 0 },
    pension: { monthlyAmount: 0, type: 'Government', revisions: [] },
    sips: [], goals: [],
});

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
// Idempotent on purpose: addInitScript re-runs on every navigation, so a plain
// setItem here re-seeded the fixture over whatever the app had just saved — which made
// the reload test below read the ORIGINAL portfolio back and call it "unchanged".
await page.addInitScript(s => {
    if (!localStorage.getItem('rfm_v1')) localStorage.setItem('rfm_v1', s);
    localStorage.setItem('corpus_tour_v1', 'x'); localStorage.setItem('rfm_v1', JSON.stringify((v => ({ ...v, profile: v.profile || { completedAt: '2026-09-01T00:00:00.000Z', name: 'Test', age: 40, goal: 'balanced', risk: 'medium', horizon: '7to15', interests: ['stocks'] } }))(JSON.parse(localStorage.getItem('rfm_v1') || '{}'))));
}, LEGACY);
await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
await page.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil: 'load' });
await page.waitForTimeout(1400);

// A watchdog, because a suite that can hang forever is not an instrument: it stops
// reporting and starts blocking, and a dead probe looks exactly like a slow one. Each
// section announces itself, so an overrun names the section it died in instead of
// leaving you to bisect a seven-minute run.
let STEP = 'boot';
const step = name => { STEP = name; };
const WATCHDOG = setTimeout(() => {
    console.error(`\n  TIMED OUT in section: ${STEP}\n`);
    process.exit(1);
}, 180000);
WATCHDOG.unref?.();
const alive = async (tag) => {
    const r = await Promise.race([page.evaluate(() => 1+1),
        new Promise(res => setTimeout(() => res('WEDGED'), 5000))]);
    console.error(`    [alive] ${tag}: ${r}`);
};
const $ = fn => page.evaluate(fn);
const set = (patch) => page.evaluate(p => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    for (const [path, value] of Object.entries(p)) {
        const keys = path.split('.');
        let o = d;
        while (keys.length > 1) o = o[keys.shift()];
        o[keys[0]] = value;
    }
}, patch);

// ── NAVIGATION DOES NOT WEDGE THE RENDERER ────────────────────────────────────
console.log('\nNAVIGATION — leaving Home and returning keeps the page alive');
{
    step('navigation - leaving home and returning keeps the pa');
    // Found by this suite, not by inspection: renderNwChart() used to run INSIDE the
    // View Transition callback. Lightweight Charts builds a canvas and measures its
    // container, and doing that during the transition's capture deadlocked Chromium's
    // renderer — the page kept painting but stopped running script. Every rendering
    // suite stayed green, because the pixels were fine; it was script that had stopped.
    const t0 = Date.now();
    const alive = await Promise.race([
        (async () => {
            await page.evaluate(async () => {
                const d = document.querySelector('[x-data]')._x_dataStack[0];
                d.activePage = 'investments';
                await new Promise(r => setTimeout(r, 700));
                d.activePage = 'home';
            });
            await page.waitForTimeout(400);
            return await page.evaluate(() => 1 + 1);
        })(),
        new Promise(r => setTimeout(() => r('WEDGED'), 10000)),
    ]);
    ok('script still runs after Home -> Holdings -> Home', alive === 2,
       alive === 2 ? `responsive in ${Date.now() - t0}ms` : 'the renderer deadlocked');
}

// ── MIGRATION ─────────────────────────────────────────────────────────────────
console.log('\nMIGRATION — figures stranded under dead keys');
{
    step('migration - figures stranded under dead keys');
    const r = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { nw: { ...d.networth }, rate: d.investments[0].rate,
                 stranded: 'interestRate' in d.investments[0], assets: d.totalAssets };
    });
    ok('bank balance adopted from bankBalance', r.nw.bank === 250000, String(r.nw.bank));
    ok('cash adopted from cashOnHand', r.nw.cash === 50000, String(r.nw.cash));
    ok('property adopted from propertyValue', r.nw.property === 4000000, String(r.nw.property));
    ok('dead keys removed', !('bankBalance' in r.nw) && !('cashOnHand' in r.nw));
    ok('stranded interestRate adopted as rate', r.rate === 7, String(r.rate));
    ok('interestRate key removed', !r.stranded);
    // 1,000,000 holding + 250k bank + 50k cash + 4,000,000 property
    ok('net worth now counts bank, cash and property', near(r.assets, 5300000), String(r.assets));
}

// ── NET WORTH IS ACTUALLY WIRED ───────────────────────────────────────────────
console.log('\nNET WORTH — the form reaches the figure');
{
    step('net worth - the form reaches the figure');
    const before = await $(() => document.querySelector('[x-data]')._x_dataStack[0].netWorthTotal);
    await set({ 'networth.bank': 350000 });
    await page.waitForTimeout(120);
    const after = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const rows = d.allocationRows;
        const cash = rows.find(r => r.key === 'cash');
        return { nw: d.netWorthTotal, cashRow: cash ? cash.value : null,
                 rowSum: rows.reduce((a, r) => a + r.value, 0), assets: d.totalAssets };
    });
    ok('a ₹100,000 bank increase moves net worth by exactly that',
       near(after.nw - before, 100000), `Δ ${Math.round(after.nw - before)}`);
    ok('allocation cash row reads the same keys as the total',
       near(after.cashRow, 400000), String(after.cashRow));
    ok('allocation rows sum to total assets', near(after.rowSum, after.assets, 2),
       `${Math.round(after.rowSum)} vs ${Math.round(after.assets)}`);
    await set({ 'networth.bank': 250000 });
}

// ── TAX: AGE ──────────────────────────────────────────────────────────────────
console.log('\nTAX — the senior-citizen flag');
{
    step('tax - the senior-citizen flag');
    // 80TTB is held at zero here so this measures the EXEMPTION BAND alone. With it
    // claimed the gap is 15,080, which is correct but conflates two separate reliefs.
    await set({ 'tax.seniorCitizen': false, 'pension.monthlyAmount': 0,
                'tax.otherIncome': 1000000, 'tax.deduction80TTB': 0,
                'tax.deduction80TTA': 0, 'tax.regime': 'old' });
    await page.waitForTimeout(150);
    const young = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { tax: d.oldRegimeTax.tax, b: { ...d.oldRegimeTax.breakdown } };
    });
    await set({ 'tax.seniorCitizen': true });
    await page.waitForTimeout(150);
    const senior = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { tax: d.oldRegimeTax.tax, b: { ...d.oldRegimeTax.breakdown } };
    });

    ok('ticking the box changes the bill at all', young.tax !== senior.tax,
       `${young.tax} vs ${senior.tax}`);
    ok('a non-senior pays exactly ₹2,600 more (₹50k band at 5% + 4% cess)',
       near(young.tax - senior.tax, 2600, 1), `Δ ${young.tax - senior.tax}`);

    // Now add 80TTB and confirm only the senior can use it.
    await set({ 'tax.deduction80TTB': 50000, 'tax.seniorCitizen': false });
    await page.waitForTimeout(150);
    const youngTTB = await $(() => document.querySelector('[x-data]')._x_dataStack[0].oldRegimeTax.breakdown.ded80TTB);
    await set({ 'tax.seniorCitizen': true });
    await page.waitForTimeout(150);
    const seniorTTB = await $(() => document.querySelector('[x-data]')._x_dataStack[0].oldRegimeTax.breakdown.ded80TTB);
    ok('80TTB is refused to a non-senior', youngTTB === 0, String(youngTTB));
    ok('80TTB is granted to a senior', seniorTTB === 50000, String(seniorTTB));
    await set({ 'tax.deduction80D': 50000, 'tax.seniorCitizen': false });
    await page.waitForTimeout(150);
    const dYoung = await $(() => document.querySelector('[x-data]')._x_dataStack[0].oldRegimeTax.breakdown.ded80D);
    await set({ 'tax.seniorCitizen': true });
    await page.waitForTimeout(150);
    const dSenior = await $(() => document.querySelector('[x-data]')._x_dataStack[0].oldRegimeTax.breakdown.ded80D);
    ok('80D caps at ₹25,000 below 60 and ₹50,000 at 60+',
       dYoung === 25000 && dSenior === 50000, `${dYoung} / ${dSenior}`);
    await set({ 'tax.deduction80D': 0, 'tax.deduction80TTB': 0 });
}

// ── TAX: 80TTA ────────────────────────────────────────────────────────────────
console.log('\nTAX — 80TTA, which had no input at all');
{
    step('tax - 80tta, which had no input at all');
    await set({ 'tax.seniorCitizen': false, 'tax.deduction80TTA': 10000 });
    await page.waitForTimeout(150);
    const withTTA = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { ded: d.oldRegimeTax.breakdown.ded80TTA, taxable: d.oldRegimeTax.taxableIncome };
    });
    ok('80TTA reaches the deduction total for a non-senior', withTTA.ded === 10000, String(withTTA.ded));
    await set({ 'tax.deduction80TTA': 40000 });
    await page.waitForTimeout(150);
    const capped = await $(() => document.querySelector('[x-data]')._x_dataStack[0].oldRegimeTax.breakdown.ded80TTA);
    ok('80TTA is capped at ₹10,000', capped === 10000, String(capped));
    await set({ 'tax.deduction80TTA': 0 });
}

// ── TAX: STANDARD DEDUCTION SCOPE ─────────────────────────────────────────────
console.log('\nTAX — the standard deduction is only for salary and pension');
{
    step('tax - the standard deduction is only for salary and ');
    // Entire income is deposit interest: no salary, no pension. Sec 16(ia) gives nothing.
    await set({ 'tax.seniorCitizen': false, 'pension.monthlyAmount': 0,
                'tax.salaryIncome': 0, 'tax.otherIncome': 0,
                'tax.deduction80C': 0, 'tax.deduction80TTB': 0, 'tax.deduction80TTA': 0,
                'tax.regime': 'old' });
    await page.waitForTimeout(150);
    const interestOnly = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { std: d.oldRegimeTax.breakdown.stdDeduction, gross: d.grossAnnualIncome,
                 qualifying: d.salaryAndPensionIncome, stdNew: d.newRegimeTax.stdDeduction };
    });
    ok('interest-only income earns NO standard deduction', interestOnly.std === 0,
       `std ₹${interestOnly.std} on gross ₹${interestOnly.gross}`);
    ok('the new regime applies the same rule', interestOnly.stdNew === 0, String(interestOnly.stdNew));

    await set({ 'tax.salaryIncome': 1200000 });
    await page.waitForTimeout(150);
    const salaried = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { std: d.oldRegimeTax.breakdown.stdDeduction, stdNew: d.newRegimeTax.stdDeduction,
                 qualifying: d.salaryAndPensionIncome };
    });
    ok('salary earns the full ₹50,000 in the old regime', salaried.std === 50000, String(salaried.std));
    ok('salary earns the full ₹75,000 in the new regime', salaried.stdNew === 75000, String(salaried.stdNew));

    // Rent is not salary, so moving money into "anything else" must not buy the deduction.
    await set({ 'tax.salaryIncome': 0, 'tax.otherIncome': 1200000 });
    await page.waitForTimeout(150);
    const rent = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { std: d.oldRegimeTax.breakdown.stdDeduction, gross: d.grossAnnualIncome };
    });
    ok('rent and consulting earn no standard deduction', rent.std === 0,
       `std ₹${rent.std} on gross ₹${rent.gross}`);

    // A small pension caps the deduction at the pension itself, not at ₹50,000.
    await set({ 'tax.otherIncome': 0, 'pension.monthlyAmount': 2000 });
    await page.waitForTimeout(150);
    const small = await $(() => document.querySelector('[x-data]')._x_dataStack[0].oldRegimeTax.breakdown.stdDeduction);
    ok('a ₹24,000 pension caps the deduction at ₹24,000', small === 24000, String(small));
    await set({ 'pension.monthlyAmount': 0, 'tax.salaryIncome': 0, 'tax.otherIncome': 1000000 });
}

// ── TAX: ELECTED REGIME ───────────────────────────────────────────────────────
console.log('\nTAX — the elected regime drives what is payable');
{
    step('tax - the elected regime drives what is payable');
    await set({ 'tax.seniorCitizen': true, 'tax.regime': 'compare',
                'tax.deduction80C': 150000, 'tax.otherIncome': 1000000 });
    await page.waitForTimeout(150);
    const r = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { old: d.oldRegimeTax.tax, neu: d.newRegimeTax.tax };
    });
    const cheaper = Math.min(r.old, r.neu), dearer = Math.max(r.old, r.neu);
    ok('the two regimes differ here, so the choice is observable', r.old !== r.neu,
       `old ${r.old} / new ${r.neu}`);

    await set({ 'tax.regime': 'compare' });  await page.waitForTimeout(120);
    const cmp = await $(() => document.querySelector('[x-data]')._x_dataStack[0].netTaxPayable);
    ok("'compare' still charges the cheaper of the two", near(cmp, cheaper), String(cmp));

    const dearerKey = r.old > r.neu ? 'old' : 'new';
    await set({ 'tax.regime': dearerKey });  await page.waitForTimeout(120);
    const elected = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { payable: d.netTaxPayable, eff: d.effectiveRegime };
    });
    ok('electing the dearer regime charges the dearer figure', near(elected.payable, dearer),
       `${elected.payable} (elected ${dearerKey})`);
    ok('effectiveRegime reports the election', elected.eff === dearerKey, elected.eff);
    await set({ 'tax.regime': 'compare' });
}

// ── CAPITAL GAINS ─────────────────────────────────────────────────────────────
console.log('\nCAPITAL GAINS — only on what was actually sold');
{
    step('capital gains - only on what was actually sold');
    await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.investments.push({ id: 'cg1', name: 'Grown Fund', type: 'Mutual Fund',
            units: 1000, buyPrice: 100, currentPrice: 900, amount: 900000,
            currentValue: 900000, schemeCode: '1' });
        d.investments = [...d.investments];
    });
    await page.waitForTimeout(200);
    const unsold = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { cg: d.totalCapitalGainsTax, pnl: d.totalUnrealizedPnL, itr: d.itrFormRecommendation };
    });
    ok('an ₹800,000 unrealized gain produces NO capital gains tax',
       unsold.cg === 0, `tax ${unsold.cg} on P&L ${Math.round(unsold.pnl)}`);
    ok('unrealized movement is still reported as P&L', unsold.pnl > 700000,
       `₹${Math.round(unsold.pnl).toLocaleString('en-IN')}`);
    ok('ITR-2 is not recommended merely for holding a winner', unsold.itr !== 'ITR-2', unsold.itr);

    await set({ 'tax.realizedEquityLTCG': 325000 });
    await page.waitForTimeout(150);
    const sold = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return { ltcg: { ...d.equityLTCG }, cg: d.totalCapitalGainsTax, itr: d.itrFormRecommendation };
    });
    // (325,000 − 125,000 exemption) × 12.5% × 1.04 cess = 26,000
    ok('entered LTCG is taxed above the ₹1.25L exemption', near(sold.ltcg.tax, 26000),
       `₹${sold.ltcg.tax} on ₹${sold.ltcg.taxableGains} taxable`);
    ok('exemption is consumed, not ignored', sold.ltcg.exemptionUsed === 125000,
       String(sold.ltcg.exemptionUsed));
    ok('ITR-2 now recommended, because gains were actually booked', sold.itr === 'ITR-2', sold.itr);

    await set({ 'tax.realizedEquitySTCG': 100000 });
    await page.waitForTimeout(150);
    const stcg = await $(() => document.querySelector('[x-data]')._x_dataStack[0].equitySTCG.tax);
    ok('entered STCG taxed at 20% + cess', near(stcg, 20800), `₹${stcg}`);
    await set({ 'tax.realizedEquityLTCG': 0, 'tax.realizedEquitySTCG': 0 });
}

// ── SIP INSTALMENTS ───────────────────────────────────────────────────────────
console.log('\nSIP — recorded, never assumed');
{
    step('sip - recorded, never assumed');
    const state = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const inv = d.investments.find(i => i.id === 'cg1');
        d.sips = [{ id: 'sip1', name: 'Grown Fund', type: 'SIP', monthlyAmount: 9000,
                    dayOfMonth: 1, status: 'Active', linkedInvestmentId: 'cg1',
                    schemeCode: '1', lastExecutedMonth: '' }];
        return { unitsBefore: inv.units, due: d.dueSipDebits.length };
    });
    await page.waitForTimeout(150);
    ok('an unsettled instalment is surfaced as due', state.due === 1, `${state.due} due`);

    const attention = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return d.attentionItems.some(a => a.id.startsWith('sip'));
    });
    ok('it appears in "Needs you" rather than acting on its own', attention);

    // A holding with a real price: confirming records units at THAT price.
    const confirmed = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const inv = d.investments.find(i => i.id === 'cg1');
        const before = inv.units;
        const okRes = await d.confirmSipDebit(d.sips[0]);
        return { okRes, before, after: d.investments.find(i => i.id === 'cg1').units,
                 due: d.dueSipDebits.length, err: d.sipDebitError };
    });
    ok('confirming records units at the real price (9000 / 900 = 10)',
       confirmed.okRes && near(confirmed.after - confirmed.before, 10, 0.01),
       `+${(confirmed.after - confirmed.before).toFixed(3)} units`);
    ok('the instalment stops being due once recorded', confirmed.due === 0);

    // A holding with NO price must refuse rather than invent one.
    const refused = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.investments.push({ id: 'np1', name: 'Priceless Fund', type: 'Mutual Fund',
            units: 0, buyPrice: 0, currentPrice: 0, amount: 0 });
        d.sips.push({ id: 'sip2', name: 'Priceless Fund', type: 'SIP', monthlyAmount: 5000,
            dayOfMonth: 1, status: 'Active', linkedInvestmentId: 'np1', lastExecutedMonth: '' });
        const res = await d.confirmSipDebit(d.sips[1]);
        const inv = d.investments.find(i => i.id === 'np1');
        return { res, units: inv.units, amount: inv.amount, err: d.sipDebitError };
    });
    ok('with no price available it REFUSES rather than inventing one',
       refused.res === false && refused.units === 0 && refused.amount === 0);
    ok('and says why', /price/i.test(refused.err || ''), refused.err);

    const skipped = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const before = d.investments.find(i => i.id === 'np1').units;
        d.skipSipDebit(d.sips[1]);
        return { before, after: d.investments.find(i => i.id === 'np1').units, due: d.dueSipDebits.length };
    });
    ok('"No" settles the month without touching the holding',
       skipped.before === skipped.after && skipped.due === 0);
}

// ── RELOAD DOES NOT REWRITE THE PORTFOLIO ─────────────────────────────────────
console.log('\nSTARTUP — a launch never rewrites holdings');
{
    step('startup - a launch never rewrites holdings');
    const snapshot = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.sips = [{ id: 'sipR', name: 'Grown Fund', type: 'SIP', monthlyAmount: 9000,
                    dayOfMonth: 1, status: 'Active', linkedInvestmentId: 'cg1',
                    schemeCode: '1', lastExecutedMonth: '' }];
        d.saveData();
        return d.investments.map(i => [i.id, i.units, i.amount]);
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1600);
    const after = await $(() => document.querySelector('[x-data]')._x_dataStack[0]
        .investments.map(i => [i.id, i.units, i.amount]));
    ok('holdings are byte-identical across a reload with an overdue SIP',
       JSON.stringify(snapshot) === JSON.stringify(after),
       `${snapshot.length} holdings unchanged`);
    const stillDue = await $(() => document.querySelector('[x-data]')._x_dataStack[0].dueSipDebits.length);
    ok('the overdue instalment is still merely OFFERED after reload', stillDue === 1, `${stillDue} due`);
}

// ── LOGOS ─────────────────────────────────────────────────────────────────────
console.log('\nLOGOS — a real mark where one exists, a monogram where it does not');
{
    step('logos - a real mark where one exists, a monogram whe');
    const r = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        return {
            us:      d.logoUrl({ type: 'Stock (US)',  ticker: 'NVDA' }),
            ind:     d.logoUrl({ type: 'Stock (IND)', ticker: 'RELIANCE.NS' }),
            etfUs:   d.logoUrl({ type: 'ETF (US)',    ticker: 'VOO' }),
            mfKnown: d.logoUrl({ type: 'Mutual Fund', name: 'HDFC Mid-Cap Opportunities Fund' }),
            mfTata:  d.logoUrl({ type: 'Mutual Fund', name: 'Tata Digital India Fund' }),
            mfQuant: d.logoUrl({ type: 'Mutual Fund', name: 'Quant Small Cap Fund' }),
            fd:      d.logoUrl({ type: 'Bank FD', name: 'HDFC Bank FD' }),
            noTicker:d.logoUrl({ type: 'Stock (US)', ticker: '' }),
            junk:    d.logoUrl({ type: 'Stock (US)', ticker: '../../etc/passwd' }),
            fromSearch: d.logoUrl({ market: 'US', ticker: 'AAPL' }),
        };
    });
    ok('US stock resolves to a logo', /financialmodelingprep\.com\/symbol\/NVDA\.png$/.test(r.us || ''), r.us);
    ok('US ETF resolves too', /symbol\/VOO\.png$/.test(r.etfUs || ''), r.etfUs);
    ok('NSE stock strips the .NS suffix', /NSE_RELIANCE\.svg$/.test(r.ind || ''), r.ind);
    ok('a search result (market, not type) resolves', /symbol\/AAPL\.png$/.test(r.fromSearch || ''), r.fromSearch);
    ok('a fund borrows its AMC logo', /NSE_HDFCAMC\.svg$/.test(r.mfKnown || ''), r.mfKnown);
    ok('an ambiguous AMC gets NO logo rather than the wrong one (Tata)', r.mfTata === null, String(r.mfTata));
    ok('an unlisted AMC gets no logo (Quant)', r.mfQuant === null, String(r.mfQuant));
    ok('a deposit has no logo', r.fd === null, String(r.fd));
    ok('no ticker means no request', r.noTicker === null, String(r.noTicker));
    ok('a junk ticker cannot build a URL', r.junk === null, String(r.junk));

    // The point of the whole design: with the network cut the monogram must still render.
    const mark = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.addingInv = true; d.newInv.type = 'Stock (US)';
        d.symbolSearch.results = [{ symbol: 'NVDA', ticker: 'NVDA', name: 'NVIDIA Corporation',
                                    exchange: 'NasdaqGS', market: 'US', isEtf: false }];
        await new Promise(r => setTimeout(r, 500));
        const el = document.querySelector('.typeahead .mark');
        const img = el && el.querySelector('.mark__img');
        const txt = el ? el.textContent.trim() : '';
        const opacity = img ? getComputedStyle(img).opacity : null;
        d.addingInv = false; d.symbolSearch.results = [];
        return { hasMark: !!el, text: txt, hasImg: !!img, opacity };
    });
    ok('the monogram renders with the network cut', mark.hasMark && mark.text.length >= 1, mark.text);
    ok('the logo layer exists but is transparent until it loads',
       mark.hasImg && mark.opacity === '0', `opacity ${mark.opacity}`);
    // Holding rows carry the same mark. Offline, every row must still show a monogram
    // and a consistent left edge — a list where only some rows are indented reads worse
    // than one with none.
    const rows = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.activePage = 'investments';
        await new Promise(r => setTimeout(r, 700));
        const out = [...document.querySelectorAll('.row.holding')].map(row => ({
            mono: row.querySelector('.mark > span')?.textContent.trim() || '',
            left: Math.round(row.querySelector('.row__name').getBoundingClientRect().left),
            imgOpacity: row.querySelector('.mark__img')
                ? getComputedStyle(row.querySelector('.mark__img')).opacity : null,
        }));
        d.activePage = 'home';
        return out;
    });
    ok('every holding row shows a monogram offline',
       rows.length > 0 && rows.every(r => r.mono.length >= 1), `${rows.length} rows`);
    ok('all holding names share one left edge',
       new Set(rows.map(r => r.left)).size === 1, `left edges: ${[...new Set(rows.map(r => r.left))].join(', ')}px`);
    ok('row logos are transparent until they load',
       rows.filter(r => r.imgOpacity !== null).every(r => r.imgOpacity === '0'),
       `${rows.filter(r => r.imgOpacity !== null).length} row(s) carry a logo layer`);
}

// ── MF SCHEME RESOLUTION ──────────────────────────────────────────────────────
console.log('\nMUTUAL FUNDS — a missing scheme code is resolved, never guessed');
{
    step('mutual funds - a missing scheme code is resolved, ne');
    // The AMFI directory is stubbed at the APP boundary, by swapping httpGetJson inside
    // the page, rather than with a Playwright route. What is under test is the MATCHING
    // logic — which scheme a name resolves to — not the transport, and registering a
    // route mid-run while the catch-all is already installed deadlocked the suite.
    const SCHEMES = [
        { schemeCode: 120828, schemeName: 'Quant Small Cap Fund - Direct Plan - Growth Option' },
        { schemeCode: 100177, schemeName: 'Quant Small Cap Fund - Regular Plan - Growth Option' },
        { schemeCode: 100176, schemeName: 'Quant Small Cap Fund - Regular Plan - IDCW Option' },
    ];
    const resolve = (name) => page.evaluate(async ([n, rows]) => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const real = d.httpGetJson;
        d.httpGetJson = async (url) => {
            if (/mfapi\.in\/mf\/search/.test(url)) return rows;
            throw new Error('not stubbed: ' + url);
        };
        try { return await d.resolveSchemeCode({ name: n }); }
        finally { d.httpGetJson = real; }
    }, [name, SCHEMES]);

    const exact = await resolve('Quant Small Cap Fund - Direct Plan Growth');
    ok('the exact fund the user reported now resolves', exact.code === '120828',
       `${exact.code} ${exact.name || exact.message || ''}`);

    const idcw = await resolve('Quant Small Cap Fund - Regular Plan - IDCW Option');
    ok('IDCW is not confused with Growth', idcw.code === '100176', String(idcw.code));

    // Note it narrowed 3 -> 2 by excluding IDCW (the query names no income option) and
    // then still refused to pick between Direct and Regular, which differ by commission.
    const vague = await resolve('Quant Small Cap');
    ok('an ambiguous name resolves to NOTHING and names the candidates',
       vague.code === null && /matches 2 AMFI schemes/.test(vague.message || '')
       && /Direct/.test(vague.message) && /Regular/.test(vague.message), vague.message);

    // And the whole path: a fund with no code must stop erroring and take one.
    const synced = await page.evaluate(async (rows) => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const realHttp = d.httpGetJson, realMarket = d.fetchMarketJson;
        const via = [];
        // The lookup and the NAV go through DIFFERENT transports on purpose:
        // resolving a scheme code is a one-off convenience, but the NAV is a
        // market price and now travels the same road as every other one —
        // fetchMarketJson, which is CapacitorHttp with a real User-Agent on
        // native and a relay in the browser. It used to be httpGetJson at its
        // 3000ms default, which reported a merely slow mfapi.in as unreachable.
        d.httpGetJson = async (url) => {
            via.push(['httpGetJson', url]);
            if (/mfapi\.in\/mf\/search/.test(url)) return rows;
            throw new Error('not stubbed: ' + url);
        };
        d.fetchMarketJson = async (url) => {
            via.push(['fetchMarketJson', url]);
            if (/mfapi\.in\/mf\/\d+/.test(url)) return { data: [{ nav: '315.7119', date: '17-09-2026' }] };
            throw new Error('not stubbed: ' + url);
        };
        const inv = { name: 'Quant Small Cap Fund - Direct Plan Growth', type: 'Mutual Fund',
                      units: 10, schemeCode: '' };
        try {
            const nav = await d.fetchSinglePrice(inv);
            return { err: null, code: inv.schemeCode, nav, value: inv.currentValue, via };
        } catch (e) { return { err: e.message, code: inv.schemeCode, via }; }
        finally { d.httpGetJson = realHttp; d.fetchMarketJson = realMarket; }
    }, SCHEMES);
    ok('sync no longer dead-ends on "needs an AMFI scheme code"',
       !/needs an AMFI scheme code/.test(synced.err || ''), synced.err || 'resolved and priced');
    ok('the resolved code is written onto the holding', synced.code === '120828', String(synced.code));
    ok('and the NAV is applied to the units', near(synced.value, 3157.12, 0.5), String(synced.value));
    ok('the NAV travels the shared market transport',
       (synced.via || []).some(([fn, url]) => fn === 'fetchMarketJson' && /mfapi\.in\/mf\/\d+/.test(url)),
       (synced.via || []).map(([fn]) => fn).join(' → '));

    // MFAPI is the fast path. It must use the per-fund response when available
    // and not download the complete AMFI report unnecessarily.
    const direct = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const real = d.fetchMarketJson;
        let n = 0;
        d.fetchMarketJson = async () => {
            ++n;
            return { data: [{ nav: '320.7702', date: '18-09-2026' }] };
        };
        const inv = { name: 'Quant', type: 'Mutual Fund', units: 10, schemeCode: '120828' };
        try { const nav = await d.fetchSinglePrice(inv); return { n, nav, err: null }; }
        catch (e) { return { n, err: e.message }; }
        finally { d.fetchMarketJson = real; }
    });
    ok('a healthy MFAPI response is used directly', direct.n === 1 && near(direct.nav, 320.7702, 0.001),
       `${direct.n} request(s), ${direct.nav ?? direct.err}`);

    // The Android failure in the reported screen was MFAPI timing out. The
    // official AMFI file has a matching scheme-code row; all concurrent funds
    // share its one download and retain AMFI's own declared date.
    const fallback = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const realJson = d.fetchMarketJson, realText = d.fetchMarketText;
        let reports = 0;
        d._amfiNavReport = null; d._amfiNavReportDate = '';
        d.fetchMarketJson = async () => { throw new Error('Timed out'); };
        d.fetchMarketText = async () => {
            reports++;
            return [
                'Scheme Code;ISIN;ISIN;Scheme Name;Plan;Option;Net Asset Value;Date',
                '120828;INF;--;Quant Small Cap Fund;Direct Plan;Growth Option;321.1234;22-09-2026',
                '120403;INF;--;Invesco India Mid Cap Fund;Direct Plan;Growth;245.6789;22-09-2026'
            ].join('\n');
        };
        const quant = { name: 'Quant', type: 'Mutual Fund', units: 10, schemeCode: '120828' };
        const invesco = { name: 'Invesco', type: 'Mutual Fund', units: 2, schemeCode: '120403' };
        try {
            await Promise.all([d.fetchSinglePrice(quant), d.fetchSinglePrice(invesco)]);
            return { reports, quant, invesco };
        } finally {
            d.fetchMarketJson = realJson; d.fetchMarketText = realText;
            d._amfiNavReport = null; d._amfiNavReportDate = '';
        }
    });
    ok('a timed-out MFAPI NAV falls back to AMFI', near(fallback.quant.currentPrice, 321.1234, 0.001),
       String(fallback.quant.currentPrice));
    ok('the AMFI fallback is shared across concurrent funds', fallback.reports === 1, `${fallback.reports} report download(s)`);
    ok('the fallback retains AMFI\'s actual NAV date', /2026-09-22/.test(fallback.invesco.priceAsOf || ''),
       String(fallback.invesco.priceAsOf));
}

// ── IDS ───────────────────────────────────────────────────────────────────────
console.log('\nIDS — unique regardless of clock resolution');
{
    step('ids - unique regardless of clock resolution');
    const r = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const ids = [];
        for (let i = 0; i < 500; i++) ids.push(d.newId('inv'));
        return { total: ids.length, unique: new Set(ids).size };
    });
    ok('500 ids minted in one tick are all distinct', r.total === r.unique,
       `${r.unique}/${r.total}`);
}

// ── NET WORTH CHART RANGES ────────────────────────────────────────────────────
console.log('\nCHART RANGES — every button on screen narrows the series');
{
    step('chart ranges - every button on screen narrows the series');
    const r = await page.evaluate(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        // Seed two years of daily points so every window has something to cut.
        // Keys are LOCAL, like the app's own: toISOString() off a local-midnight
        // Date is the previous day east of Greenwich, which put every fixture a
        // day out of step with the cutoffs being tested.
        const today = new Date();
        const hist = [];
        for (let i = 730; i >= 0; i--) {
            const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
            hist.push({ date: d.localDateKey(dt), value: 1000000 + i, source: 'test' });
        }
        d.nwHistory = hist;
        const buttons = [...document.querySelectorAll('.series .seg--range .seg__item')].map(b => b.textContent.trim());
        const counts = {};
        for (const b of buttons) { d.nwChartRange = b; counts[b] = d.nwChartData.length; }
        const labels = {};
        for (const b of buttons) { d.nwChartRange = b; labels[b] = d.rangeLabel; }
        d.nwChartRange = '1M';
        return { buttons, counts, labels, total: hist.length };
    });
    ok('the selector offers 1W through ALL', r.buttons.join(' ') === '1W 1M 3M 6M 1Y ALL', r.buttons.join(' '));
    // An unknown range falls through to `new Date(0)`, which silently means ALL.
    // So a button whose window equals the whole series is indistinguishable from
    // a typo — which is precisely how a dead control would hide here.
    for (const b of r.buttons) {
        if (b === 'ALL') continue;
        ok(`${b} narrows the series`, r.counts[b] > 0 && r.counts[b] < r.total,
           `${r.counts[b]} of ${r.total} points`);
        ok(`${b} has its own label`, !!r.labels[b], r.labels[b] || 'MISSING');
    }
    ok('ALL keeps every point', r.counts.ALL === r.total, `${r.counts.ALL} of ${r.total}`);
    ok('1W is a week of daily points', r.counts['1W'] >= 7 && r.counts['1W'] <= 9, String(r.counts['1W']));
}

// ── PLANNING HUB ──────────────────────────────────────────────────────────────
console.log('\nPLANNING HUB — every card agrees with the page it opens');
{
    step('planning hub - every card agrees with the page it opens');
    const r = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        const areas = d.planningAreas;
        const routes = new Set(d.SURFACES.flatMap(s => s.views));
        const by = k => areas.find(a => a.key === k);
        return {
            count: areas.length,
            deadLinks: areas.filter(a => !routes.has(a.page)).map(a => `${a.key}->${a.page}`),
            cashflow: by('cashflow').figure, surplus: d.formatCurrency(d.monthlySurplus),
            tax: by('tax').figure,           payable: d.formatCurrency(d.netTaxPayable),
            regime: by('tax').detail,        effective: d.effectiveRegime,
            blank: areas.filter(a => !a.figure || !a.label).map(a => a.key),
        };
    });
    ok('six areas', r.count === 6, String(r.count));
    // A hub card that opens a route the app does not have is a dead end, and
    // nothing else in the harness would notice: the click simply does nothing.
    ok('every card opens a real route', r.deadLinks.length === 0, r.deadLinks.join(', ') || 'all resolve');
    // The figure on the hub and the figure on the page it opens are the same
    // number by two different paths — which is exactly how this codebase has
    // gone wrong before.
    ok('cashflow card matches monthlySurplus', r.cashflow === r.surplus, `${r.cashflow} vs ${r.surplus}`);
    ok('tax card matches netTaxPayable', r.tax === r.payable, `${r.tax} vs ${r.payable}`);
    ok('tax card names the elected regime', r.regime.toLowerCase().startsWith(r.effective),
       `"${r.regime}" vs ${r.effective}`);
    ok('no card renders blank', r.blank.length === 0, r.blank.join(', ') || 'all populated');
}

// ── HOLDING DETAIL ────────────────────────────────────────────────────────────
console.log('\nHOLDING DETAIL — a range is offered only where the data could fill it');
{
    step('holding detail - a range is offered only where the d');
    const r = await $(() => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        // A quotable instrument carries a ticker or a scheme code; the probe
        // must supply one or it is testing the no-price-source path instead.
        const probe = (t, src = { ticker: 'X' }) => d.chartRangesFor({ type: t, id: 'x', ...src });
        const first = (d.investments || [])[0];
        // Selecting WITHOUT navigating. openHolding() also sets activePage,
        // which runs a View Transition; verify-routes drives the 'holding'
        // route across 4 boots already, so navigation is covered there and
        // this suite stays on arithmetic and state, as its header promises.
        d.detailHoldingId = first.id;
        const opened = { id: d.detailHolding === first, facts: d.holdingFacts.length };
        d.detailHoldingId = 'no-such-id';
        return {
            stock:    probe('Stock (IND)'),
            usStock:  probe('Stock (US)'),
            fund:     probe('Mutual Fund', { schemeCode: '120503' }),
            fd:       probe('Bank FD'),
            ppf:      probe('PPF'),
            property: probe('Real Estate', {}),
            other:    probe('Other', {}),
            opened,
            strandedResolvesToNull: d.detailHolding === null,
        };
    });
    // AMFI publishes one NAV a day, so an intraday tab on a fund would draw a
    // single point and call it a day's trading.
    ok('a fund offers no 1D', Array.isArray(r.fund) && !r.fund.includes('1D'), (r.fund || []).join(' '));
    ok('a stock does offer 1D', Array.isArray(r.stock) && r.stock.includes('1D'), (r.stock || []).join(' '));
    ok('a US stock offers 1D', Array.isArray(r.usStock) && r.usStock.includes('1D'), (r.usStock || []).join(' '));
    // A deposit is not traded. It accrues at a contracted rate, so there is no
    // price series to chart at any range at all.
    ok('a fixed deposit offers no chart', r.fd === null, String(r.fd));
    ok('PPF offers no chart', r.ppf === null, String(r.ppf));
    ok('real estate offers no chart', r.property === null, String(r.property));
    // 'Other' is a catch-all with no ticker and no scheme code, so nothing can
    // ever fetch a price for it. Deciding this on the TYPE NAME would have let
    // it through; deciding it on the price source does not.
    ok('an unquotable holding offers no chart', r.other === null, String(r.other));

    ok('selecting a holding resolves it by id', r.opened.id);
    ok('opening a holding yields facts', r.opened.facts > 0, `${r.opened.facts} row(s)`);
    // The open holding can be deleted, or an id can survive a restore that the
    // holdings no longer contain. Either must resolve to null, not to a stale
    // object or a blank screen.
    ok('a stranded id resolves to null', r.strandedResolvesToNull);
}

// ── HAPTICS ───────────────────────────────────────────────────────────────────
console.log('\nHAPTICS — every method called actually exists');
{
    step('haptics - every method called actually exists');
    const r = await $(() => {
        const H = window.RFMMotion && window.RFMMotion.Haptics;
        return ['tap', 'commit', 'success', 'warn'].filter(m => typeof H?.[m] !== 'function');
    });
    ok('tap / commit / success / warn all defined', r.length === 0, r.join(', ') || 'all present');
}

const real = errors.filter(e => !/favicon|Failed to load resource|ERR_FAILED/i.test(e));
ok('no console errors across the whole suite', real.length === 0, real.slice(0, 2).join(' | '));

clearTimeout(WATCHDOG);
await browser.close();
console.log(fails.length ? `\n  ${fails.length} FIGURE FAILURES\n` : '\n  FIGURES OK\n');
process.exit(fails.length ? 1 : 0);
