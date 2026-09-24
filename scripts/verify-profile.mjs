// The person, the daily brief, and the facts both are built from.
//
// Every reading used to be written for one imagined reader — a young equity
// investor — because the app stored nothing about who it was talking to. These
// tests cover the questions that fix that, the once-a-day brief that uses the
// answers, and the government-scheme and gold figures that give a retired
// saver's portfolio something real to be reasoned about.
//
// The network is cut. The AI gateway is intercepted at the wire, so the prompt
// is read straight off the outgoing request, and requests are COUNTED: the
// shared free allowance is 50 a day, and "once a day" is a promise about it.
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
const $d = 'document.querySelector("[x-data]")._x_dataStack[0]';

const FD   = { id: 'fd', name: 'HDFC FD', type: 'Bank FD', amount: 500000, currentValue: 500000, rate: 7.1, maturityDate: '' };
const SCSS = { id: 'sc', name: 'Senior Citizen Savings Scheme', type: 'Government Scheme', amount: 1500000, currentValue: 1500000, rate: 8.2, payout: 'Quarterly' };
const MIS  = { id: 'mi', name: 'PO MIS', type: 'Government Scheme', amount: 900000, currentValue: 900000, rate: 7.4, payout: 'Monthly' };
const AVGO = { id: 'avgo', name: 'Broadcom', type: 'Stock (US)', ticker: 'AVGO', currency: 'USD', units: 4, buyPrice: 310, currentPrice: 312.40 };

const DAILY = { greeting: 'Good morning, Papa', items: [
    { kind: 'price', title: 'Gold near its high', body: 'Gold is about ₹1,13,000 per 10g, 2% below its 52-week high.' },
    { kind: 'rate', title: 'Scheme rates due to reset', body: 'The government resets small-savings rates on 30 September.' },
] };
const ANALYSIS = { fit: { status: 'on-track', line: 'Income covers the monthly need.' },
                   findings: [{ priority: 1, kind: 'income', title: 'Income is steady', why: 'SCSS and MIS pay ₹38,000 a quarter.' }],
                   holdings: [{ name: 'HDFC FD', verdict: 'Keep', summary: 'Rate locked.' }] };

/* `profile` seeds an answered profile (or none). `reply` decides what the
   gateway answers: an object is returned as the model's JSON, a number is an
   HTTP error status. Every gateway request is recorded with its prompt. */
async function boot({ investments = [], profile = null, reply = DAILY, clock = null, history = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata', acceptDownloads: true });
    const page = await ctx.newPage();
    if (clock) await page.clock.install({ time: clock });
    const errors = [];
    const sent = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    await page.addInitScript(([blob, hist]) => {
        if (!localStorage.getItem('rfm_v1')) localStorage.setItem('rfm_v1', blob);
        if (hist && !localStorage.getItem('rfm_nw_history')) localStorage.setItem('rfm_nw_history', hist);
        localStorage.setItem('corpus_tour_v1', 'seen');
    }, [JSON.stringify({ version: '3.0', networth: {}, sips: [], goals: [], investments, ...(profile ? { profile } : {}) }),
        history ? JSON.stringify(history) : null]);
    const state = { reply };
    await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith('file://')) return route.continue();
        // Crash reports share the gateway's host; they are not AI requests
        // and must not be counted as spending the allowance.
        if (url.includes('/v1/crash')) return route.fulfill({ status: 204, body: '' });
        if (url.includes('/v1/portfolio-reading')) {
            let body = {};
            try { body = JSON.parse(route.request().postData() || '{}'); } catch (_) {}
            sent.push(body.prompt || '');
            if (typeof state.reply === 'number') {
                return route.fulfill({ status: state.reply, contentType: 'application/json',
                                       body: JSON.stringify({ error: { message: 'No free AI model is available right now.' } }) });
            }
            return route.fulfill({ status: 200, contentType: 'application/json',
                                   body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(state.reply) } }] }) });
        }
        return route.abort();
    });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(clock ? 0 : 600);
    return { ctx, page, errors, sent, state };
}

const PROFILE_RETIRED = { completedAt: '2026-09-01T00:00:00.000Z', name: 'Rajan Negi', age: 64, goal: 'retired', risk: 'low',
                          payout: 'monthly', horizon: '3to7', interests: ['gold', 'schemes', 'fdbonds'] };
const PROFILE_YOUNG = { completedAt: '2026-09-01T00:00:00.000Z', name: 'Swaraj', age: 26, goal: 'grow', risk: 'high',
                        payout: null, horizon: 'gt15', interests: ['stocks', 'us'] };

// ── 1. FIRST RUN ─────────────────────────────────────────────────────────────
console.log('\nFIRST RUN — asked once, answered by tapping');
{
    const { ctx, page, errors } = await boot({ investments: [FD] });
    const shown = await page.locator('.onboard').isVisible();
    ok('a new install is asked who it is talking to', shown);

    await page.fill('.onboard__input', 'Rajan Negi');
    await page.click('.onboard__foot .btn');
    await page.fill('.onboard__input', '64');
    await page.click('.onboard__foot .btn');
    // Single choices advance by themselves.
    // Order: goal → risk → payout → horizon.
    await page.click('.onboard__opt:has-text("I’m retired")');
    await page.waitForTimeout(400);
    await page.click('.onboard__opt:has-text("Sell to stop the loss")');
    await page.waitForTimeout(400);
    ok('a retired goal is asked about payouts', await page.locator('h1:has-text("regular payouts")').isVisible());
    await page.click('.onboard__opt:has-text("Monthly")');
    await page.waitForTimeout(400);
    await page.click('.onboard__opt:has-text("3 to 7 years")');
    await page.waitForTimeout(400);
    await page.click('.onboard__opt:has-text("Gold & silver")');
    await page.click('.onboard__opt:has-text("Government schemes")');
    await page.click('.onboard__foot .btn');
    await page.waitForTimeout(400);

    const r = await page.evaluate(`(() => { const d = ${$d}; return {
        open: d.onboarding.open, profile: JSON.parse(JSON.stringify(d.profile)), senior: d.tax.seniorCitizen,
        stored: JSON.parse(localStorage.getItem('rfm_v1')).profile }; })()`);
    ok('the screen closes when done', r.open === false);
    ok('the answers are stored', r.profile.completedAt && r.profile.name === 'Rajan Negi' && r.profile.age === 64, JSON.stringify(r.profile));
    ok('the goal and payout are what was tapped', r.profile.goal === 'retired' && r.profile.payout === 'monthly');
    // Measured, not self-labelled: "Sell to stop the loss" is low risk.
    ok('"sell after a fall" is recorded as low risk', r.profile.risk === 'low', r.profile.risk);
    ok('interests are the ones picked', r.profile.interests.join() === 'gold,schemes', r.profile.interests.join());
    ok('persisted inside rfm_v1', r.stored?.completedAt === r.profile.completedAt);
    ok('age 60+ switches on the senior-citizen tax rules', r.senior === true);

    await page.reload();
    await page.waitForTimeout(600);
    ok('a second open is not asked again', !(await page.locator('.onboard').isVisible()));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 2. BRANCHES AND MAPPING ──────────────────────────────────────────────────
console.log('\nBRANCHES — only the questions that apply');
{
    const { ctx, page } = await boot();
    const r = await page.evaluate(`(() => { const d = ${$d};
        d.onboarding.draft.goal = 'grow'; const grow = d.onboardingSteps.slice();
        d.onboarding.draft.goal = 'income'; const income = d.onboardingSteps.slice();
        const risks = Object.fromEntries(d.PROFILE_OPTIONS.risk.map(o => [o.t, o.v]));
        return { grow, income, risks }; })()`);
    ok('a growth goal is not asked about payouts', !r.grow.includes('payout'), r.grow.join(' → '));
    ok('an income goal is', r.income.includes('payout'), r.income.join(' → '));
    ok('the three risk answers map to low, medium, high',
       r.risks['Sell to stop the loss'] === 'low' && r.risks['Wait it out'] === 'medium' && r.risks['Buy more'] === 'high',
       JSON.stringify(r.risks));
    await ctx.close();
}

// ── 3. SKIP ──────────────────────────────────────────────────────────────────
console.log('\nSKIP — allowed, remembered, offered again after a week');
{
    const { ctx, page } = await boot({ investments: [FD] });
    await page.click('.onboard__top .linkbtn:has-text("Skip for now")');
    await page.waitForTimeout(300);
    const after = await page.evaluate(`(() => { const d = ${$d}; d.activePage = 'regen';
        return { open: d.onboarding.open, completed: d.profile.completedAt, skipped: d.profile.skippedAt }; })()`);
    await page.waitForTimeout(500);
    ok('skipping closes the screen', after.open === false);
    ok('and records nothing but when', !after.completed && !!after.skipped);
    ok('Insights offers a way back', await page.locator('.brief__ask').isVisible());

    await page.reload();
    await page.waitForTimeout(600);
    ok('it is not asked again the next day', !(await page.locator('.onboard').isVisible()));

    await page.evaluate(`(() => { const v = JSON.parse(localStorage.getItem('rfm_v1'));
        v.profile.skippedAt = new Date(Date.now() - 8 * 86400000).toISOString();
        localStorage.setItem('rfm_v1', JSON.stringify(v)); })()`);
    await page.reload();
    await page.waitForTimeout(600);
    ok('but is offered again after a week', await page.locator('.onboard').isVisible());
    await ctx.close();
}

// ── 4. BACKUP ────────────────────────────────────────────────────────────────
console.log('\nBACKUP — the profile travels with the data');
{
    const { ctx, page } = await boot({ investments: [FD], profile: PROFILE_RETIRED });
    const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(`${$d}.backupData()`)]);
    const file = await download.path();
    await page.evaluate(`(() => { const v = JSON.parse(localStorage.getItem('rfm_v1')); delete v.profile;
        localStorage.setItem('rfm_v1', JSON.stringify(v)); })()`);
    const fresh = await browser.newContext({ timezoneId: 'Asia/Kolkata' });
    const p2 = await fresh.newPage();
    p2.on('dialog', d => d.accept());
    await p2.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await p2.goto(URL, { waitUntil: 'load' });
    await p2.waitForTimeout(500);
    await p2.setInputFiles('input[x-ref="restoreInput"]', file);
    await p2.waitForTimeout(800);
    const restored = await p2.evaluate(`JSON.parse(JSON.stringify(${$d}.profile))`);
    ok('a restore on a new phone brings the answers back', restored.name === 'Rajan Negi' && restored.goal === 'retired',
       JSON.stringify(restored).slice(0, 80));
    await fresh.close();
    await ctx.close();
}

// ── 5. SCHEMES ───────────────────────────────────────────────────────────────
console.log('\nSCHEMES — the government terms, dated');
{
    const { ctx, page } = await boot();
    const r = await page.evaluate(() => {
        const S = window.CorpusSchemes;
        const m = n => (S.match({ name: n, type: 'Government Scheme' }) || {}).id || null;
        return {
            scss: m('Senior Citizen Savings Scheme'), scss2: m('SCSS - SBI'), mis: m('PO MIS'), pomis: m('Post Office Monthly Income Scheme'),
            ppf: m('PPF account'), nsc: m('NSC VIII issue'), td5: m('Post Office 5 Year Time Deposit'), epf: m('EPF'),
            none: m('HDFC Balanced Advantage Fund'),
            inQuarter: S.status(new Date('2026-09-23T10:00:00+05:30')),
            after: S.status(new Date('2026-10-05T10:00:00+05:30')),
            scssRate: S.SCHEMES.find(x => x.id === 'scss').rate,
        };
    });
    ok('SCSS is recognised by its full name', r.scss === 'scss', r.scss);
    ok('and by its abbreviation', r.scss2 === 'scss', r.scss2);
    ok('a post office MIS is recognised either way', r.mis === 'pomis' && r.pomis === 'pomis', `${r.mis}/${r.pomis}`);
    ok('PPF, NSC, a 5-year TD and EPF each match their row',
       r.ppf === 'ppf' && r.nsc === 'nsc' && r.td5 === 'td5' && r.epf === 'epf', `${r.ppf} ${r.nsc} ${r.td5} ${r.epf}`);
    ok('a mutual fund is not mistaken for a scheme', r.none === null, String(r.none));
    ok('the table knows its own quarter', r.inQuarter.current === true && /July–September 2026/.test(r.inQuarter.note));
    // The failure this prevents: quoting last quarter's rate as today's.
    ok('after the quarter ends it says the rates may have changed',
       r.after.current === false && /may have changed — verify/.test(r.after.note), r.after.note);
    ok('SCSS carries the verified 8.2%', r.scssRate === 8.2);
    await ctx.close();
}

// ── 6. GOLD AND SILVER ───────────────────────────────────────────────────────
console.log('\nMETALS — spot converted by hand');
{
    const { ctx, page } = await boot();
    const m = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.usdInrRate = 88;
        const series = last => ({ chart: { result: [{ meta: { currency: 'USD' },
            indicators: { quote: [{ close: Array.from({ length: 260 }, (_, i) => last * (0.8 + 0.2 * i / 259)) }] } }] } });
        d.fetchMarketJson = async url => {
            if (url.includes('GC%3DF')) return series(3000);
            if (url.includes('SI%3DF')) return series(40);
            if (url.includes('GOLDBEES')) return series(90);
            if (url.includes('SILVERBEES')) return series(110);
            throw new Error('no');
        };
        return window.CorpusResearch.metals(d);
    });
    // $3000/oz × ₹88 = ₹2,64,000/oz; ÷ 31.1035 g = ₹8,487.79/g; × 10 g = ₹84,877.9 → ₹84,878.
    ok('gold $3000/oz at ₹88 is ₹84,878 per 10g', m?.gold?.inrPer10g === 84878, String(m?.gold?.inrPer10g));
    // $40 × ₹88 = ₹3,520/oz; ÷ 31.1035 = ₹113.1705/g; × 1000 g = ₹1,13,170.5 → ₹1,13,171.
    ok('silver $40/oz at ₹88 is ₹1,13,171 per kg', m?.silver?.inrPerKg === 113171, String(m?.silver?.inrPerKg));
    ok('a year of closes rising from 80% gives +25% over the year', m?.gold?.ret1y === 25, String(m?.gold?.ret1y));
    ok('the Indian-price ETFs come along', m?.goldEtf?.symbol === 'GOLDBEES' && m?.silverEtf?.symbol === 'SILVERBEES');
    await ctx.close();
}

// ── 7. THE DAILY BRIEF ───────────────────────────────────────────────────────
console.log('\nDAILY — once per day, on the local calendar');
{
    const history = [
        { date: '2026-08-24', capturedAt: '2026-08-24T10:00:00+05:30', value: 2800000, source: 'seed' },
        { date: '2026-09-22', capturedAt: '2026-09-22T10:00:00+05:30', value: 2880000, source: 'seed' },
        { date: '2026-09-23', capturedAt: '2026-09-23T10:00:00+05:30', value: 2900000, source: 'seed' },
    ];
    const { ctx, page, sent } = await boot({ investments: [SCSS, MIS, FD], profile: PROFILE_RETIRED, history,
                                             clock: new Date('2026-09-23T23:58:00+05:30') });
    await page.clock.runFor(4000);
    await page.waitForTimeout(300);
    await page.clock.runFor(2000);
    await page.waitForTimeout(300);
    const first = await page.evaluate(`JSON.parse(JSON.stringify(${$d}.daily))`);
    ok('the brief is prepared on open', !!first.brief && first.brief.items.length === 2, JSON.stringify(first).slice(0, 90));
    ok('with one gateway request', sent.length === 1, `${sent.length} requests`);

    // A second open the same day — and the app coming back from the background.
    await page.evaluate(`${$d}.maybeRunDaily()`);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(200);
    ok('opening again the same day costs nothing', sent.length === 1, `${sent.length} requests`);

    // 23:58 → 00:02 IST. A UTC day would not have turned yet; the local one has.
    await page.clock.setSystemTime(new Date('2026-09-24T00:02:00+05:30'));
    await page.evaluate(`${$d}.maybeRunDaily()`);
    await page.waitForTimeout(400);
    ok('past local midnight it is a new day and a new brief', sent.length === 2, `${sent.length} requests`);

    const p = sent[0];
    ok('the brief is marked as a daily brief', p.startsWith('CORPUS-BRIEF: daily-v1'));
    ok('it is written for the person', /Name: Rajan Negi/.test(p) && /Retired/.test(p));
    ok('with the government scheme terms', /GOVERNMENT SCHEMES — CURRENT TERMS/.test(p) && /8\.2%/.test(p));
    ok('and their holdings matched to those schemes', /this is Senior Citizens Savings Scheme/.test(p) && /this is Post Office Monthly Income Scheme/.test(p));
    ok('and the truth about contributions', /contributions included/.test(p));
    // ₹2,900,000 against ₹2,880,000 the day before = +0.69%.
    ok('with the move since the last observation', /\+0\.69% \(₹20,000\) since 2026-09-22/.test(p),
       (p.match(/[+-][\d.]+% \(₹[\d,]+\) since [\d-]+/) || [''])[0]);
    ok('it asks for a few items, not filler', /write fewer items rather than filler/.test(p));

    // A changed profile is a new brief even on the same day.
    await page.evaluate(`(() => { const d = ${$d}; d.profile = { ...d.profile, interests: ['gold'] }; })()`);
    await page.evaluate(`${$d}.maybeRunDaily()`);
    await page.waitForTimeout(400);
    ok('changing the answers prepares a fresh brief', sent.length === 3, `${sent.length} requests`);
    await ctx.close();
}

console.log('\nFIRST HOLDING — an empty-book brief does not last the day');
{
    // Measured live: the brief started the moment the questions were answered,
    // before any holding was added, and said "no holdings yet" all day.
    const { ctx, page, sent } = await boot({ investments: [], profile: PROFILE_RETIRED });
    await page.waitForTimeout(3800);
    const first = sent.length;
    await page.evaluate(`${$d}.investments.push(${JSON.stringify(SCSS)})`);
    await page.waitForTimeout(2200);
    const afterFirstHolding = sent.length;
    await page.evaluate(`${$d}.investments.push(${JSON.stringify(MIS)})`);
    await page.waitForTimeout(2200);
    ok('a brief was prepared for the empty book', first === 1, `${first}`);
    ok('the first holding earns a fresh brief', afterFirstHolding === 2, `${afterFirstHolding}`);
    ok('later holdings do not spend the allowance again', sent.length === 2, `${sent.length}`);
    await ctx.close();
}

// ── 8. OFFLINE ───────────────────────────────────────────────────────────────
console.log('\nOFFLINE — the card never becomes an error box');
{
    const { ctx, page } = await boot({ investments: [FD], profile: PROFILE_RETIRED, reply: 503 });
    await page.evaluate(`${$d}.activePage = 'regen'`);
    await page.waitForTimeout(4200);
    const r = await page.evaluate(() => {
        const card = document.querySelector('.brief');
        return { text: card ? card.innerText : '', errorBox: !!card?.querySelector('.down') };
    });
    ok('the on-device score is still shown', /Measured from your own numbers/.test(r.text));
    ok('with a quiet line, not an error', /next time Corpus can reach the internet/.test(r.text) && !r.errorBox, r.text.slice(0, 120));
    await ctx.close();
}

// ── 9. THE READING IS WRITTEN FOR THE PERSON ─────────────────────────────────
console.log('\nPROMPT — the same book, two different readers');
{
    const prompts = {};
    for (const [who, profile] of [['retired', PROFILE_RETIRED], ['young', PROFILE_YOUNG]]) {
        const { ctx, page, sent } = await boot({ investments: [SCSS, AVGO], profile, reply: ANALYSIS });
        await page.waitForTimeout(3600);           // let the daily brief go first
        const before = sent.length;
        await page.evaluate(`${$d}.runRegenWealthAnalysis(true)`);
        await page.waitForTimeout(300);
        prompts[who] = sent.slice(before).find(p => p.startsWith('CORPUS-BRIEF: analysis-v2')) || '';
        if (who === 'retired') {
            const a = await page.evaluate(`JSON.parse(JSON.stringify(${$d}.regenWealth.analysis || null))`);
            ok('the analysis renders from the new shape', a?.fit?.status === 'on-track' && a.findings.length === 1);
        }
        await ctx.close();
    }
    const R = prompts.retired, Y = prompts.young;
    ok('both analyses were sent', R.length > 0 && Y.length > 0);
    ok('a retired saver is judged on income first', /Judge first on INCOME/.test(R));
    ok('and on senior-citizen rules', /senior citizen/.test(R) && /80TTB/.test(R));
    ok('and on capital safety', /Capital safety and liquidity outrank return/.test(R));
    ok('a young high-risk investor is not', !/Judge first on INCOME/.test(Y) && !/Capital safety and liquidity outrank/.test(Y));
    ok('they are judged on growth quality instead', /Judge on growth quality/.test(Y));
    ok('the analysis still weighs analyst and revenue evidence for stocks',
       /analyst consensus and target, revenue and margins, company outlook and innovation/.test(Y));
}

// ── 9b. WHAT THE BOOK PAYS OUT ───────────────────────────────────────────────
console.log('\nPAYOUTS — the income an income goal is about');
{
    const PPF = { id: 'pp', name: 'PPF', type: 'Government Scheme', amount: 800000, currentValue: 800000, rate: 7.1 };
    const { ctx, page, sent } = await boot({ investments: [SCSS, MIS, FD, PPF], profile: PROFILE_RETIRED, reply: ANALYSIS });
    await page.waitForTimeout(3600);
    const before = sent.length;
    await page.evaluate(`${$d}.runRegenWealthAnalysis(true)`);
    await page.waitForTimeout(300);
    const p = sent.slice(before).find(x => x.startsWith('CORPUS-BRIEF: analysis-v2')) || '';
    // ₹15,00,000 × 8.2% ÷ 4 = ₹30,750 a quarter; ₹9,00,000 × 7.4% ÷ 12 = ₹5,550 a month.
    ok('SCSS pays ₹30,750 a quarter', /Senior Citizen Savings Scheme: ₹30,750 quarterly \(≈ ₹10,250 a month\)/.test(p),
       (p.match(/Senior Citizen Savings Scheme: [^\n]*/) || [''])[0]);
    ok('MIS pays ₹5,550 a month', /PO MIS: ₹5,550 monthly/.test(p), (p.match(/PO MIS: [^\n]*/) || [''])[0]);
    ok('the total is stated apart from the pension', /about ₹15,800 a month in total \(separate from the income above\)/.test(p),
       (p.match(/about ₹[\d,]+ a month in total[^\n]*/) || [''])[0]);
    // The bug this guards: PPF was counted as monthly income.
    ok('PPF is not counted as income', /Pays only at maturity, not as income: PPF/.test(p));
    // Measured live: "income gap of ₹18,000" when payouts closed all but
    // ₹2,200 of it, because the only surplus in the prompt ignored them.
    // Here income and expenses are 0, so including payouts it is ₹15,800.
    ok('the surplus that counts payouts is stated, and named as the one to use',
       /surplus INCLUDING investment payouts:\*\* ₹15,800 — use THIS figure/.test(p),
       (p.match(/surplus INCLUDING[^\n]*/) || [''])[0]);
    ok('an FD with no recorded payout is not guessed at', /Payout frequency not recorded \(do not assume one\): HDFC FD/.test(p));
    // The fabricated "80TTB utilised: No" came from a field that did not exist.
    ok('unrecorded deductions are declared unknown', /NOT recorded in this app\. Never state that one is or is not being claimed/.test(p));
    await ctx.close();
}

// ── 10. THE ON-DEVICE CARD SPEAKS TO THE SAME PERSON ─────────────────────────
console.log('\nHEALTH — no equity warnings about government schemes');
{
    const STOCK = { id: 'rel', name: 'Reliance', type: 'Stock (IND)', ticker: 'RELIANCE', units: 1000, buyPrice: 2400, currentPrice: 2500 };
    const warn = async investments => {
        const { ctx, page } = await boot({ investments, profile: PROFILE_RETIRED });
        const titles = await page.evaluate(`${$d}.healthImprovements.map(h => h.title + ' | ' + h.detail)`);
        await ctx.close();
        return titles.join(' || ');
    };
    const scss = await warn([SCSS, FD]);
    ok('SCSS as the largest holding is not called a swing risk', !/Sharp swings/.test(scss), scss.slice(0, 120));
    const fdBook = await warn([{ ...FD, amount: 2000000, currentValue: 2000000 }, MIS]);
    ok('one large FD is a spread-your-deposits point, not a price risk',
       /one deposit/.test(fdBook) && !/Sharp swings/.test(fdBook), fdBook.slice(0, 140));
    const stock = await warn([STOCK, FD]);
    ok('a stock as the largest holding still is', /High concentration in Reliance/.test(stock) && /Sharp swings/.test(stock));
}
{
    // Secondary text inside the navy console must not take the light page's
    // dark-green ink.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => { localStorage.setItem('corpus_theme', 'light'); localStorage.setItem('rfm_theme', 'light'); });
    await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await page.goto(URL); await page.waitForTimeout(500);
    const c = await page.evaluate(() => {
        const host = document.querySelector('.sheet--ai');
        const probe = cls => { const e = document.createElement('span'); e.className = cls; host.appendChild(e);
            const v = getComputedStyle(e).color; e.remove(); return v; };
        // color-mix() reports `color(srgb r g b / a)` with 0–1 channels;
        // a plain colour reports rgb() with 0–255.
        const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const k = /^color\(srgb/.test(c) ? 1 : 255;
                           return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / k; };
        return { meta: lum(probe('row__meta')), label: lum(probe('label')) };
    });
    ok('console body text is light on navy in the light theme', c.meta > 0.6, c.meta.toFixed(2));
    ok('and so is its label', c.label > 0.55, c.label.toFixed(2));
    await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(' | ')}` : '\nPROFILE OK');
process.exit(fails.length ? 1 : 0);
