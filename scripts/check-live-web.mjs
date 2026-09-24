// Live check of the DEPLOYED web app in WebKit at iPhone 12 size: first-run
// questions, a real price sync through our gateway, and a real daily brief.
// Spends 1-2 AI requests from the shared daily allowance, so run it by hand,
// not in `npm run verify`:   node scripts/check-live-web.mjs <screenshot dir>

import { webkit, devices } from 'playwright';
const OUT = process.argv[2];
const URL = 'https://corpus-app.swarajnegi999.workers.dev/';
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 12'], timezoneId: 'Asia/Kolkata' });
const page = await ctx.newPage();
const errors = [], market = [], ai = [], relays = [];
page.on('pageerror', e => errors.push(e.message));

page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url().replace(/.*[?&]u(rl)?=/, '').slice(0, 90)); });
page.on('request', r => { const u = r.url();
  if (u.includes('/v1/market')) market.push(decodeURIComponent(u.split('u=')[1] || '').slice(0, 70));
  if (u.includes('/v1/portfolio-reading')) ai.push(u);
  if (/r\.jina\.ai|allorigins/.test(u)) relays.push(u.slice(0, 60)); });
const out = {};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1500);
out.onboardingShown = await page.locator('.onboard').isVisible();
await page.screenshot({ path: `${OUT}/ios-1-onboard.png` });
out.manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).status);
out.touchIcon = await page.evaluate(async () => (await fetch('icons/apple-touch-icon.png')).status);
out.swSupported = await page.evaluate(() => 'serviceWorker' in navigator);
out.swRegistered = await page.evaluate(async () => { try { return !!(await navigator.serviceWorker.getRegistration()); } catch (e) { return 'err ' + e.message; } });
// Answer the questions as a retired saver, by tapping.
await page.fill('.onboard__input', 'Rajan'); await page.click('.onboard__foot .btn');
await page.fill('.onboard__input', '64'); await page.click('.onboard__foot .btn'); await page.waitForTimeout(350);
await page.click('.onboard__opt:has-text("retired")'); await page.waitForTimeout(350);
await page.click('.onboard__opt:has-text("Wait it out")'); await page.waitForTimeout(350);
await page.click('.onboard__opt:has-text("Monthly")'); await page.waitForTimeout(350);
await page.click('.onboard__opt:has-text("3 to 7 years")'); await page.waitForTimeout(350);
await page.click('.onboard__opt:has-text("Gold")'); await page.click('.onboard__opt:has-text("Government schemes")');
await page.click('.onboard__foot .btn'); await page.waitForTimeout(500);
out.onboardingDone = !(await page.locator('.onboard').isVisible());
// A real book: an Indian stock, a US stock, a fund, a scheme.
await page.evaluate(() => { const d = document.querySelector('[x-data]')._x_dataStack[0];
  d.investments = [
    { id: 'r1', name: 'Reliance Industries', type: 'Stock (IND)', ticker: 'RELIANCE', units: 40, buyPrice: 1300, currentPrice: 1300 },
    { id: 'a1', name: 'Broadcom', type: 'Stock (US)', ticker: 'AVGO', currency: 'USD', units: 4, buyPrice: 300, currentPrice: 300 },
    { id: 'm1', name: 'Quant Small Cap Fund Direct Plan Growth', type: 'Mutual Fund', schemeCode: '120828', units: 800, buyPrice: 250, currentPrice: 250 },
    { id: 's1', name: 'Senior Citizen Savings Scheme', type: 'Government Scheme', amount: 1500000, currentValue: 1500000, rate: 8.2, payout: 'Quarterly' } ]; });
const t0 = Date.now();
await page.evaluate(async () => { await document.querySelector('[x-data]')._x_dataStack[0].fetchAllPrices(); });
out.syncSeconds = ((Date.now() - t0) / 1000).toFixed(1);
out.prices = await page.evaluate(() => document.querySelector('[x-data]')._x_dataStack[0].investments.map(i => `${i.name.split(' ')[0]}=${i.currentPrice ?? i.currentValue}`));
await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'overview'; });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/ios-2-home.png` });
// The daily brief, for real (one AI request).
await page.evaluate(() => document.querySelector('[x-data]')._x_dataStack[0].maybeRunDaily(true));
await page.waitForFunction(() => { const d = document.querySelector('[x-data]')._x_dataStack[0]; return !d.daily.loading; }, null, { timeout: 120000 });
out.daily = await page.evaluate(() => { const d = document.querySelector('[x-data]')._x_dataStack[0]; return d.daily.brief ? d.daily.brief.items.map(i => i.title) : 'ERROR: ' + d.daily.error; }); out.news = await page.evaluate(() => (document.querySelector('[x-data]')._x_dataStack[0].daily.brief?.sources || []).map(s => s.source + ':' + s.count));
await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'regen'; });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/ios-3-insights.png` });
out.overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
out.storageKept = await page.evaluate(() => !!JSON.parse(localStorage.getItem('rfm_v1') || '{}').profile);
out.marketViaGateway = market.length; out.relaysUsed = relays.length; out.aiRequests = ai.length;
out.marketSample = market.slice(0, 6); out.errors = errors.slice(0, 12);
console.log(JSON.stringify(out, null, 1));
await b.close();
