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
                   classFit: [{ class: 'US stocks', status: 'drifting', line: 'Growth money at 61% of the book, above what a 3 to 7 year need can ride out.' },
                              { class: 'Mutual funds', status: 'on-track', line: 'Retirement money with 15+ years to run, left to compound.' }],
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

// Profile v2: every money answer is per asset class, several at once.
const PROFILE_RETIRED = { version: 2, completedAt: '2026-09-01T00:00:00.000Z', name: 'Rajan Negi', age: 64,
    holdings: ['gold', 'fd_bonds', 'schemes'],
    purpose: { gold: ['safe'], fd_bonds: ['income', 'safe'], schemes: ['income', 'safe'] },
    fall: { gold: ['sell'] }, horizon: { gold: ['3to7'], fd_bonds: ['3to7'], schemes: ['3to7'] },
    payout: { fd_bonds: ['quarterly'], schemes: ['monthly'] }, knows: { schemes: ['long'] },
    income: ['pension'], dependents: ['none'], cover: ['health'], plans: { nothing: [] } };
// The shape of the book that asked for this: US shares for growth, bought on
// dips and trimmed, needed in 3 to 7 years; funds for retirement and children.
const PROFILE_YOUNG = { version: 2, completedAt: '2026-09-01T00:00:00.000Z', name: 'Swaraj', age: 26,
    holdings: ['us_stocks', 'mf'],
    purpose: { us_stocks: ['grow'], mf: ['retirement', 'children'] },
    fall: { us_stocks: ['wait', 'buy'], mf: ['wait'] },
    horizon: { us_stocks: ['trim', '3to7'], mf: ['gt15'] },
    payout: { us_stocks: ['none'], mf: ['none'] }, knows: { us_stocks: ['some'], mf: ['long'] },
    income: ['salary'], dependents: ['parents'], cover: ['health'], plans: { home: ['4to5'] } };

// ── 1. FIRST RUN ─────────────────────────────────────────────────────────────
console.log('\nFIRST RUN — eleven screens, several answers each, per asset');
{
    const { ctx, page, errors } = await boot({ investments: [FD] });
    ok('a new install is asked who it is talking to', await page.locator('.onboard').isVisible());
    const btn = page.locator('.onboard .foot .btn-gold');
    const next = async () => { await btn.click(); await page.waitForTimeout(250); };
    const step = () => page.evaluate(`${$d}.onboardingStep`);
    // Tick a chip on every per-asset card on the screen.
    const everyRow = async label => { for (const card of await page.locator('.pcls').all()) await card.locator('.pchip', { hasText: label }).first().click(); };

    await page.fill('#ob-name', 'Rajan Negi'); await next();
    await page.fill('#ob-age', '64'); await next();
    ok('what you hold is ticked from the book', await page.locator('.onboard__opt.on:has-text("FDs and bonds")').count() === 1);
    await page.click('.onboard__opt:has-text("Gold")');
    await page.click('.onboard__opt:has-text("Government schemes")');
    await next();

    ok('each asset gets its own row', await page.locator('.pcls').count() === 3, `${await page.locator('.pcls').count()} rows`);
    await page.locator('.pcls').first().locator('.pchip', { hasText: 'Keep it safe' }).click();
    ok('Continue waits until every row is answered', await btn.isDisabled());
    await everyRow('Regular income');
    await page.locator('.pcls').nth(1).locator('.pchip', { hasText: 'Keep it safe' }).click();
    const both = await page.evaluate(`${$d}.onboarding.draft.purpose`);
    ok('one row takes several answers', both.gold?.length === 2 && both.fd_bonds?.length === 2, JSON.stringify(both));
    await next();

    ok('a 20% fall is asked only about what moves with a market', (await step()) === 'fall' && await page.locator('.pcls').count() === 1);
    await everyRow('Sell some'); await next();
    await everyRow('3 to 7 yrs'); await everyRow('Trim along the way'); await next();
    await everyRow('Monthly'); await next();
    await page.click('.onboard__opt:has-text("Pension")'); await page.click('.onboard__opt:has-text("Interest and dividends")'); await next();

    await page.click('.onboard__opt:has-text("Partner")');
    await page.click('.onboard__opt:has-text("No one")');
    const alone = await page.evaluate(`${$d}.onboarding.draft.dependents`);
    ok('"No one" stands alone', alone.join() === 'none', alone.join());
    await page.click('.onboard__opt:has-text("Health insurance")'); await next();

    await page.click('.onboard__opt:has-text("Home")');
    ok('a plan needs a when', await btn.isDisabled());
    await page.locator('.plan__when .pchip', { hasText: '2 to 3 yrs' }).click();
    await page.locator('.plan__when .pchip', { hasText: '5+ yrs' }).click();
    await next();
    await everyRow('Many years');
    ok('the last screen starts the app', /Start using Corpus/.test(await btn.innerText()));
    await next();

    const r = await page.evaluate(`(() => { const d = ${$d}; return {
        open: d.onboarding.open, profile: JSON.parse(JSON.stringify(d.profile)), senior: d.tax.seniorCitizen,
        stored: JSON.parse(localStorage.getItem('rfm_v1')).profile, sentence: d.profileSentence }; })()`);
    const P = r.profile;
    ok('the screen closes when done', r.open === false);
    ok('eleven screens were walked', true);
    ok('stored as profile v2', P.version === 2 && P.completedAt && P.name === 'Rajan Negi' && P.age === 64);
    ok('holdings are the classes ticked', P.holdings.join() === 'gold,fd_bonds,schemes', P.holdings.join());
    ok('purposes are per class and plural', P.purpose.fd_bonds.join() === 'income,safe' && P.purpose.gold.join() === 'safe,income', JSON.stringify(P.purpose));
    ok('a fall is recorded only for gold', Object.keys(P.fall).join() === 'gold' && P.fall.gold.join() === 'sell', JSON.stringify(P.fall));
    ok('timings are plural per class', P.horizon.schemes.join() === '3to7,trim', JSON.stringify(P.horizon));
    ok('income sources are plural', P.income.join() === 'pension,dividends', P.income.join());
    ok('the plan keeps both dates', P.plans.home.join() === '2to3,5plus', JSON.stringify(P.plans));
    ok('persisted inside rfm_v1', r.stored?.version === 2 && r.stored?.completedAt === P.completedAt);
    ok('age 60+ switches on the senior-citizen tax rules', r.senior === true);
    ok('Settings speaks in the per-asset answers', /Gold for keep it safe and regular income/.test(r.sentence), r.sentence);

    await page.reload(); await page.waitForTimeout(600);
    ok('a second open is not asked again', !(await page.locator('.onboard').isVisible()));
    ok('no console errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// ── 2. BRANCHES ──────────────────────────────────────────────────────────────
console.log('\nBRANCHES — only the classes and questions that apply');
{
    const { ctx, page } = await boot();
    const r = await page.evaluate(`(() => { const d = ${$d};
        d.onboarding.draft.holdings = ['fd_bonds', 'schemes']; const safeOnly = d.onboardingSteps.slice();
        d.onboarding.draft.holdings = ['us_stocks', 'fd_bonds']; const mixed = d.onboardingSteps.slice();
        return { safeOnly, mixed, fall: d.onboardingClasses('fall').map(c => c.k), horizon: d.onboardingClasses('horizon').map(c => c.k) }; })()`);
    ok('nothing market-linked means no "20% fall" question', !r.safeOnly.includes('fall'), r.safeOnly.join(' → '));
    ok('eleven screens with something market-linked', r.mixed.length === 11, r.mixed.join(' → '));
    ok('the fall is asked of US stocks only', r.fall.join() === 'us_stocks', r.fall.join());
    ok('timing is asked of both', r.horizon.join() === 'us_stocks,fd_bonds', r.horizon.join());
    await ctx.close();
}

// ── 2b. ANSWERED BEFORE ──────────────────────────────────────────────────────
console.log('\nCATCH-UP — the one-answer profile is carried over, and asked once');
{
    const V1 = { completedAt: '2026-09-01T00:00:00.000Z', name: 'Swaraj', age: 26, goal: 'grow', risk: 'high',
                 payout: null, horizon: 'gt15', interests: ['us', 'mf'] };
    const { ctx, page } = await boot({ investments: [AVGO], profile: V1 });
    const r = await page.evaluate(`(() => { const d = ${$d}; return { open: d.onboarding.open, catchUp: d.onboarding.catchUp,
        step: d.onboardingStep, draft: JSON.parse(JSON.stringify(d.onboarding.draft)), sentence: d.profileSentence }; })()`);
    ok('an earlier answerer is asked once more', r.open && r.catchUp, JSON.stringify({ open: r.open, catchUp: r.catchUp }));
    ok('starting at the per-asset questions', r.step === 'purpose', r.step);
    ok('their old answers fill every class', r.draft.holdings.join() === 'us_stocks,mf' && r.draft.purpose.us_stocks.join() === 'grow'
       && r.draft.fall.mf.join() === 'buy' && r.draft.horizon.us_stocks.join() === 'gt15', JSON.stringify(r.draft).slice(0, 160));
    ok('Settings asks them to update', /asks per asset/.test(r.sentence), r.sentence);
    await page.click('.onboard .top .link:has-text("Later")');
    await page.waitForTimeout(200);
    const later = await page.evaluate(`(() => { const d = ${$d}; return { open: d.onboarding.open, at: d.profile.catchUpSkippedAt, done: d.profile.completedAt }; })()`);
    ok('"Later" closes it and keeps the profile', !later.open && !!later.at && !!later.done);
    await page.reload(); await page.waitForTimeout(600);
    ok('and it is not asked again that week', !(await page.locator('.onboard').isVisible()));
    await ctx.close();
}

// ── 3. SKIP ──────────────────────────────────────────────────────────────────
console.log('\nSKIP — allowed, remembered, offered again after a week');
{
    const { ctx, page } = await boot({ investments: [FD] });
    await page.click('.onboard .top .link:has-text("Skip for now")');
    await page.waitForTimeout(300);
    const after = await page.evaluate(`(() => { const d = ${$d}; d.activePage = 'regen';
        return { open: d.onboarding.open, completed: d.profile.completedAt, skipped: d.profile.skippedAt }; })()`);
    await page.waitForTimeout(500);
    ok('skipping closes the screen', after.open === false);
    ok('and records nothing but when', !after.completed && !!after.skipped);
    ok('Insights offers a way back', await page.locator('button:has-text("Tell Corpus about you first")').isVisible());

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
    ok('a restore on a new phone brings the answers back', restored.name === 'Rajan Negi' && restored.purpose?.schemes?.includes('income'),
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
    // Written for the person, but without their name: the screens promise the
    // reading sends "a summary, never your name or account numbers".
    ok('it is written for the person', /Income from: pension/.test(p) && /Government schemes \(PPF, EPF, SCSS, post office\): [^\n]*For: regular income and keeping it safe/.test(p));
    ok('and never carries their name', !/Rajan/.test(p));
    ok('with the government scheme terms', /GOVERNMENT SCHEMES — CURRENT TERMS/.test(p) && /8\.2%/.test(p));
    ok('and their holdings matched to those schemes', /this is Senior Citizens Savings Scheme/.test(p) && /this is Post Office Monthly Income Scheme/.test(p));
    ok('and the truth about contributions', /contributions included/.test(p));
    // ₹2,900,000 against ₹2,880,000 the day before = +0.69%.
    ok('with the move since the last observation', /\+0\.69% \(₹20,000\) since 2026-09-22/.test(p),
       (p.match(/[+-][\d.]+% \(₹[\d,]+\) since [\d-]+/) || [''])[0]);
    ok('it asks for a few items, not filler', /write fewer items rather than filler/.test(p));

    // A changed profile is a new brief even on the same day.
    await page.evaluate(`(() => { const d = ${$d}; d.profile = { ...d.profile, purpose: { ...d.profile.purpose, gold: ['grow'] } }; })()`);
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
    ok('the on-device score is still shown', /Health score/.test(r.text));
    ok('with a quiet line, not an error', /next time Corpus can reach the internet/.test(r.text) && !r.errorBox, r.text.slice(0, 120));
    await ctx.close();
}

// ── 9. THE READING IS WRITTEN FOR THE PERSON ─────────────────────────────────
console.log('\nPROMPT — every per-asset answer reaches the reading');
{
    const MF = { id: 'mf1', name: 'Invesco India Mid Cap Fund Direct Growth', type: 'Mutual Fund', schemeCode: '120505', units: 131.348, buyPrice: 213.17, currentPrice: 237.39 };
    const prompts = {};
    for (const [who, profile, investments] of [['retired', PROFILE_RETIRED, [SCSS, MIS, FD]], ['young', PROFILE_YOUNG, [AVGO, MF]]]) {
        const { ctx, page, sent } = await boot({ investments, profile, reply: ANALYSIS });
        await page.waitForTimeout(3600);           // let the daily brief go first
        const before = sent.length;
        await page.evaluate(`${$d}.runRegenWealthAnalysis(true)`);
        await page.waitForTimeout(300);
        prompts[who] = sent.slice(before).find(p => p.startsWith('CORPUS-BRIEF: analysis-v2')) || '';
        if (who === 'young') {
            await page.evaluate(`${$d}.activePage = 'regen'`);
            await page.waitForTimeout(600);
            const a = await page.evaluate(`JSON.parse(JSON.stringify(${$d}.regenWealth.analysis || null))`);
            ok('the analysis renders from the new shape', a?.fit?.status === 'on-track' && a.findings.length === 1);
            ok('each asset comes back with its own verdict', a?.classFit?.map(c => c.key + ':' + c.status).join() === 'us_stocks:drifting,mf:on-track',
               JSON.stringify(a?.classFit));
            const rows = await page.locator('.byasset__row').allInnerTexts();
            ok('and Insights shows them By asset', rows.length === 2 && /US stocks\s*Drifting/.test(rows[0]), rows.join(' | '));
        }
        await ctx.close();
    }
    const R = prompts.retired, Y = prompts.young;
    ok('both analyses were sent', R.length > 0 && Y.length > 0);
    ok('each class is printed with its share and every answer',
       /US stocks: \d+% of the book \(₹[\d,]+\)\. For: growth\. After a 20% fall: waits it out and buys more\. Needed: trimmed along the way and in 3 to 7 years\./.test(Y),
       (Y.match(/- US stocks: [^\n]*/) || [''])[0]);
    ok('funds keep their own, different answers',
       /Mutual funds: \d+% of the book \(₹[\d,]+\)\. For: retirement and children’s future\. After a 20% fall: waits it out\. Needed: in 15\+ years\./.test(Y),
       (Y.match(/- Mutual funds: [^\n]*/) || [''])[0]);
    ok('the rules follow each class: trimming for US stocks', /US stocks: they trim along the way/.test(Y) && !/Mutual funds: they trim/.test(Y));
    ok('buying the dip is an opportunity for US stocks', /US stocks: they would buy more after a fall/.test(Y));
    ok('experience changes the explaining', /Mutual funds: they have many years with it\. Skip the basics/.test(Y));
    ok('dependents without term cover are named first', /parents depend on them and there is no term life cover/.test(Y));
    ok('the reply is asked for one verdict per class', /"classFit":\[/.test(Y) && /judged against THAT class's own answers/.test(Y));
    ok('a retired saver is judged on the income each asset pays', /Government schemes: it should pay them monthly/.test(R));
    ok('and on senior-citizen rules', /senior citizen/.test(R) && /80TTB/.test(R));
    ok('and a gold position they would sell is judged as such', /Gold: they would sell some/.test(R) || !/Gold: they would buy more/.test(R));
    ok('a growth investor is not judged on income', !/should pay them/.test(Y));
    ok('the name is never sent', !/Swaraj/.test(Y) && !/Rajan/.test(R));
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
    ok('the indicative total is not represented as received cash', /Indicative payouts from stated terms, NOT verified cash received:\*\* about ₹15,800 a month equivalent/.test(p),
       (p.match(/Indicative payouts from stated terms[^\n]*/) || [''])[0]);
    // The bug this guards: PPF was counted as monthly income.
    ok('PPF is not counted as income', /Pays only at maturity, not as income: PPF/.test(p));
    ok('unverified payout estimates do not inflate recorded surplus',
       !/surplus INCLUDING investment payouts/.test(p),
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
    // Secondary text inside the navy AI card must stay light enough to read.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await page.goto(URL); await page.waitForTimeout(500);
    const c = await page.evaluate(async () => {
        const d = document.querySelector('[x-data]')._x_dataStack[0];
        d.onboarding.open = false; d.activePage = 'regen';
        await new Promise(r => setTimeout(r, 600));
        const lum = el => { const m = getComputedStyle(el).color.match(/[\d.]+/g).map(Number);
                            return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255; };
        const body = document.querySelector('[data-s~="id"] .ai .ai-p');
        const fine = document.querySelector('[data-s~="id"] .ai .fine');
        return { body: body ? lum(body) : 0, fine: fine ? lum(fine) : 0 };
    });
    ok('the AI card body text is light on navy', c.body > 0.6, c.body.toFixed(2));
    ok('and so is its fine print', c.fine > 0.5, c.fine.toFixed(2));
    await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(' | ')}` : '\nPROFILE OK');
process.exit(fails.length ? 1 : 0);
