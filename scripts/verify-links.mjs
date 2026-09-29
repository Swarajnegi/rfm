// Records that refer to the same real thing, tested as such.
//
// An audit after the SIP-duplicate bug found the same class of fault across
// statement import, SIPs, deletes, classification and cash flow: things matched
// by loose names, a value filed as a cost, one figure computed two ways. Each
// block below is one of those faults, driven through the app's own methods.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const fails = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fails.push(label);
};

const browser = await chromium.launch();
async function boot(book) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.addInitScript(s => {
        if (!localStorage.getItem('rfm_v1')) localStorage.setItem('rfm_v1', s);
        localStorage.setItem('rfm_usd_inr_rate', JSON.stringify({ rate: 95, ts: Date.now() }));
        localStorage.setItem('corpus_tour_v1', 'seen');
    }, JSON.stringify({ version: '3.0', networth: {}, sips: [], goals: [], investments: [],
        profile: { version: 2, completedAt: '2026-09-01T00:00:00.000Z', name: 'T', age: 30 }, ...book }));
    await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await page.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    return { ctx, page, errors };
}
const D = 'document.querySelector("[x-data]")._x_dataStack[0]';

console.log('\nIMPORT — a statement without an invested figure never invents one');
{
    const { ctx, page } = await boot({});
    const r = await page.evaluate(() => {
        const P = window.RFMParser;
        const rows = P.normalizeToInvestments({ type: 'CAMS', holdings: [
            { name: 'HDFC Mid Cap Opportunities Fund Direct Growth', type: 'Mutual Fund', isin: 'INF179K01XQ0', units: 100, nav: 150, value: 15000 },
            { name: 'Mirae Asset ELSS Tax Saver Fund Direct Growth', type: 'Mutual Fund', isin: 'INF769K01DM9', units: 50, nav: 40, value: 2000 },
            { name: 'Bharat Bond ETF FOF April 2030', type: 'Mutual Fund', isin: 'INF754K01KO1', units: 10, nav: 12, value: 120 },
        ] });
        return rows.map(x => ({ type: x.type, amount: x.amount, buyPrice: x.buyPrice }));
    });
    ok('no cost is made up from the value', r[0].amount === 0 && r[0].buyPrice === 0, JSON.stringify(r[0]));
    ok('an ELSS fund stays a mutual fund', r[1].type === 'Mutual Fund', r[1].type);
    ok('a bond FOF stays a mutual fund', r[2].type === 'Mutual Fund', r[2].type);
    await ctx.close();
}

console.log('\nIMPORT — matching a statement row to what is held');
{
    const { ctx, page, errors } = await boot({ investments: [
        { id: 'fc', name: 'HDFC Flexi Cap Fund Direct Growth', type: 'Mutual Fund', folioNumber: '1234567', units: 10, buyPrice: 1500, currentPrice: 1900 },
        { id: 'mc', name: 'HDFC Mid Cap Opportunities Fund Direct Growth', type: 'Mutual Fund', folioNumber: '1234567', units: 20, buyPrice: 120, currentPrice: 150 },
        { id: 'n50', name: 'SBI Nifty Index Fund Direct Growth', type: 'Mutual Fund', units: 5, buyPrice: 200, currentPrice: 220 },
        { id: 'infy', name: 'Infosys ADR', type: 'Stock (US)', ticker: 'INFY', currency: 'USD', units: 10, buyPrice: 18, currentPrice: 20 },
        { id: 'ril', name: 'Reliance Industries', type: 'Stock (IND)', ticker: 'RELIANCE', units: 4, buyPrice: 1300, currentPrice: 1400 },
    ] });
    const r = await page.evaluate(d => {
        const a = eval(d);
        const m = (row, used) => (a._findStatementMatch(row, used || new Set()) || {}).id || null;
        const used = new Set(['fc']);
        return {
            folioMidCap: m({ name: 'HDFC Mid Cap Opportunities Fund - Direct Plan - Growth', folioNumber: '1234567' }),
            folioUsedSkip: m({ name: 'HDFC Flexi Cap Fund - Direct Growth', folioNumber: '1234567' }, used),
            next50: m({ name: 'SBI Nifty Next 50 Index Fund Direct Growth' }),
            regular: m({ name: 'SBI Nifty Index Fund Regular Growth' }),
            usInfy: m({ name: 'Infosys Limited', isin: 'INE009A01021' }),
            relLtd: m({ name: 'RELIANCE INDUSTRIES LTD', isin: 'INE002A01018' }),
            midHyphen: a._sameFund('Invesco India Mid-Cap Fund Direct Growth', 'Invesco India Midcap Fund - Direct Plan - Growth'),
            noOption: a._sameFund('Parag Parikh Flexi Cap Fund Direct', 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth'),
        };
    }, D);
    ok('a shared folio matches the scheme with the same name', r.folioMidCap === 'mc', String(r.folioMidCap));
    ok('a holding already matched is not matched twice', r.folioUsedSkip === null, String(r.folioUsedSkip));
    ok('Nifty Next 50 is not the Nifty 50 fund', r.next50 === null, String(r.next50));
    ok('a Regular plan is not the Direct plan', r.regular === null, String(r.regular));
    ok('an Indian row never matches a US holding', r.usInfy === null, String(r.usInfy));
    ok('"Ltd" does not stop a stock matching', r.relLtd === 'ril', String(r.relLtd));
    ok('"Mid-Cap" is "Midcap"', r.midHyphen === true);
    ok('a name without its option still matches', r.noOption === true);

    // Replacing the stock category from an Indian statement keeps US shares.
    const rep = await page.evaluate(d => {
        const a = eval(d);
        a.statementDiff = { active: true, category: 'Stock' };
        a.importResults = { type: 'CDSL_CAS', investments: [
            { id: 1, name: 'Tata Motors Ltd', type: 'Stock (IND)', isin: 'INE155A01022', units: 3, nav: 700, currentPrice: 700, amount: 0 }] };
        a.applyCategoryReplace();
        return { us: a.investments.some(i => i.id === 'infy'), ril: a.investments.some(i => i.id === 'ril'),
                 newId: typeof a.investments.find(i => i.name === 'Tata Motors Ltd')?.id };
    }, D);
    ok('replacing Indian stocks keeps US stocks', rep.us && !rep.ril, JSON.stringify(rep));
    ok('imported rows get app ids', rep.newId === 'string', rep.newId);
    ok('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
}

console.log('\nSIPS — plans that are not funds, and deleted holdings');
{
    const { ctx, page } = await boot({ investments: [
        { id: 'ppf', name: 'Public Provident Fund (PPF)', type: 'Government Scheme', amount: 150000 },
        { id: 'qnt', name: 'Quant Small Cap Fund Direct Plan Growth', type: 'Mutual Fund', schemeCode: '120828', units: 65, buyPrice: 275, currentPrice: 318 },
    ] });
    const r = await page.evaluate(async d => {
        const a = eval(d);
        const before = a.investments.length;
        a.newSip = { ...a.newSip, name: 'PPF', type: 'PPF', monthlyAmount: 5000, dayOfMonth: 5, schemeCode: '' };
        await a.addSip();
        const ppfSip = a.sips.at(-1);
        a.newSip = { ...a.newSip, name: 'Quant Small Cap Fund - Growth - Direct Plan', type: 'SIP', monthlyAmount: 3000, dayOfMonth: 10, schemeCode: '120828' };
        await a.addSip();
        const qSip = a.sips.at(-1);
        const afterAdd = a.investments.length;
        a.deleteInvestment('qnt');
        return { before, afterAdd, noStock: !a.investments.some(i => i.type === 'Stock (IND)'),
                 ppfLink: ppfSip.linkedInvestmentId, qLinkAfterDelete: qSip.linkedInvestmentId, line: a.sipLink(qSip).text };
    }, D);
    ok('a PPF plan makes no fake stock', r.noStock && r.afterAdd === r.before, `${r.before} → ${r.afterAdd} holdings`);
    ok('a PPF plan finds the PPF you hold', r.ppfLink === 'ppf', String(r.ppfLink));
    ok('deleting a holding unlinks its SIP', r.qLinkAfterDelete === null && r.line === 'Not linked to a holding', `${r.qLinkAfterDelete} / ${r.line}`);
    await ctx.close();
}

console.log('\nCASH FLOW — the pension counts once, on screen and in the reading');
{
    const { ctx, page } = await boot({ pension: { monthlyAmount: 56000 },
        cashflow: { incomes: [{ id: 'a', name: 'Monthly Salary', amount: 0 }, { id: 'b', name: 'Consulting', amount: 0 }], expenses: [{ id: 'e', name: 'Rent', amount: 20000 }] } });
    const r = await page.evaluate(d => {
        const a = eval(d);
        const one = { income: a.totalIncome, snap: window.RegenWealth.buildPortfolioSnapshot(a).monthlyIncome };
        a.cashflow.incomes.push({ id: 'p', name: 'Pension', amount: 56000 });
        const two = { income: a.totalIncome, snap: window.RegenWealth.buildPortfolioSnapshot(a).monthlyIncome };
        return { one, two, surplusSame: window.RegenWealth.buildPortfolioSnapshot(a).monthlySurplus === a.monthlySurplus };
    }, D);
    ok('the Pension page counts as income', r.one.income === 56000 && r.one.snap === 56000, JSON.stringify(r.one));
    ok('a "Pension" income row is not counted again', r.two.income === 56000 && r.two.snap === 56000, JSON.stringify(r.two));
    ok('the reading uses the screen\'s surplus', r.surplusSame);
    await ctx.close();
}

console.log('\nCLASSES AND WEIGHTS — one answer everywhere');
{
    const { ctx, page } = await boot({ investments: [
        { id: 'gb', name: 'Nippon India ETF Gold BeES', type: 'ETF (IND)', ticker: 'GOLDBEES', units: 100, buyPrice: 60, currentPrice: 70 },
        { id: 'nv', name: 'NVIDIA', type: 'Stock (US)', ticker: 'NVDA', currency: 'USD', units: 10, buyPrice: 100, currentPrice: 1000, amount: 95000 },
        { id: 'fd', name: 'HDFC FD', type: 'Bank FD', issuer: 'HDFC Bank', amount: 100000 },
    ] });
    const r = await page.evaluate(d => {
        const a = eval(d);
        return { chip: a._chipOf(a.investments[0]), cls: a._classOf(a.investments[0]),
                 conc: a.concentrationWarnings.map(w => w.name + ' ' + w.pct) };
    }, D);
    ok('a gold ETF is gold on every screen', r.chip === 'gold' && r.cls === 'gold', `${r.chip} / ${r.cls}`);
    // NVDA is 10 × $1,000 × 95 = ₹9,50,000 of ₹10,57,000: well over half.
    ok('concentration is weighed on today\'s value', r.conc.some(c => /NVIDIA/.test(c)), r.conc.join(', ') || 'none');
    await ctx.close();
}

await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log('\nall link checks passed');
