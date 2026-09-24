// The iPhone engine. Every browser on an iPhone is WebKit, and WebKit found a
// bug Chromium never showed: a View Transition into Insights crashed the page
// three times out of three. So the iPhone build is tested in WebKit, at iPhone
// size, before it reaches a family member's phone.
//
// Needs Playwright's WebKit (`npx playwright install webkit`). Without it this
// says SKIPPED loudly rather than passing — a green check it did not earn.
import { webkit, devices } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const fails = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fails.push(label);
};

let browser;
try { browser = await webkit.launch(); }
catch (e) {
    console.log('\n  WEBKIT SKIPPED — not installed here. Run: npx playwright install webkit');
    console.log('  The iPhone build is NOT verified on this machine.\n');
    process.exit(0);
}

const URL = pathToFileURL(path.resolve('web/index.html')).href;
const $d = 'document.querySelector("[x-data]")._x_dataStack[0]';

console.log('WEBKIT — iPhone 12, the engine every iPhone browser uses');

// 1. First run, answered by tapping, in WebKit.
{
    const ctx = await browser.newContext({ ...devices['iPhone 12'], timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    ok('the first-run questions open', await page.locator('.onboard').isVisible());
    await page.fill('.onboard__input', 'Rajan'); await page.tap('.onboard__foot .btn');
    await page.fill('.onboard__input', '64'); await page.tap('.onboard__foot .btn'); await page.waitForTimeout(350);
    await page.tap('.onboard__opt:has-text("retired")'); await page.waitForTimeout(350);
    await page.tap('.onboard__opt:has-text("Wait it out")'); await page.waitForTimeout(350);
    await page.tap('.onboard__opt:has-text("Monthly")'); await page.waitForTimeout(350);
    await page.tap('.onboard__opt:has-text("3 to 7 years")'); await page.waitForTimeout(350);
    await page.tap('.onboard__opt:has-text("Gold")');
    await page.tap('.onboard__foot .btn'); await page.waitForTimeout(500);
    const p = await page.evaluate(`JSON.parse(JSON.stringify(${$d}.profile))`);
    ok('tapping through saves the answers', !!p.completedAt && p.goal === 'retired' && p.payout === 'monthly', JSON.stringify(p).slice(0, 90));
    ok('no script errors', errors.length === 0, errors[0] || '');
    await ctx.close();
}

// 2. Every page, three round trips, with a real book in it.
{
    const ctx = await browser.newContext({ ...devices['iPhone 12'], timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    let crashed = false;
    page.on('crash', () => { crashed = true; });
    await page.addInitScript(() => {
        localStorage.setItem('rfm_v1', JSON.stringify({ version: '3.0', goals: [], sips: [], networth: {},
            investments: [
                { id: 's1', name: 'Senior Citizen Savings Scheme', type: 'Government Scheme', amount: 1500000, currentValue: 1500000, rate: 8.2, payout: 'Quarterly' },
                { id: 'r1', name: 'Reliance Industries', type: 'Stock (IND)', ticker: 'RELIANCE', units: 40, buyPrice: 1300, currentPrice: 1320 },
                { id: 'm1', name: 'Quant Small Cap Fund Direct Plan Growth', type: 'Mutual Fund', schemeCode: '120828', units: 800, buyPrice: 250, currentPrice: 262 },
            ],
            profile: { completedAt: '2026-09-24', name: 'Rajan', age: 64, goal: 'retired', risk: 'low', payout: 'monthly', horizon: '3to7', interests: ['gold'] } }));
    });
    await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const overflow = [];
    try {
        for (let round = 0; round < 3; round++) {
            for (const pg of ['regen', 'home', 'portfolio', 'planning']) {
                await page.evaluate(`${$d}.activePage = ${JSON.stringify(pg)}`);
                await page.waitForTimeout(700);
                if (round === 0 && await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) overflow.push(pg);
            }
        }
    } catch (_) { /* a crash surfaces as a failed evaluate; `crashed` says so */ }
    ok('three round trips through every page, including Insights, without a crash', !crashed);
    ok('no page scrolls sideways at iPhone width', overflow.length === 0, overflow.join(', '));
    // WebKit HAS startViewTransition; the app must choose not to call it.
    const vtCalls = await page.evaluate(async () => {
        let calls = 0;
        const real = document.startViewTransition;
        if (typeof real === 'function') document.startViewTransition = function (...a) { calls++; return real.apply(this, a); };
        window.RFMMotion.transition(() => {}, () => {});
        await new Promise(r => setTimeout(r, 300));
        return { calls, supported: typeof real === 'function' };
    }).catch(() => ({ calls: -1 }));
    ok('WebKit takes the fade, not a View Transition', vtCalls.calls === 0,
       `${vtCalls.calls} call(s); API present: ${vtCalls.supported}`);
    await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(' | ')}` : '\nWEBKIT OK');
process.exit(fails.length ? 1 : 0);
