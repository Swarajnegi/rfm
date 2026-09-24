// Crash reports from the phone: what reaches the gateway, and what must not.
//
// The reporter's whole promise is that an error leaves the phone and the
// portfolio does not. So these tests throw errors that CONTAIN portfolio-like
// data — amounts, a holding's value, an email — and read the report off the
// wire to check it was scrubbed before it left.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const fails = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fails.push(label);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const reports = [];
await page.addInitScript(() => { localStorage.setItem('corpus_tour_v1', 'x'); });
await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    if (url.includes('/v1/crash')) {
        try { reports.push(JSON.parse(route.request().postData() || '{}')); } catch (_) { reports.push(null); }
        return route.fulfill({ status: 204, body: '' });
    }
    return route.abort();
});
await page.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil: 'load' });
await page.waitForTimeout(800);

console.log('CRASH — the error leaves, the portfolio does not');
ok('the app boots without reporting anything', reports.length === 0, `${reports.length} reports`);

// An error whose message carries the kind of data a real one might.
await page.evaluate(() => setTimeout(() => {
    throw new Error('Cannot value HDFC FD worth ₹15,00,000 for rajan@example.com, id 98765432');
}, 0));
await page.waitForTimeout(500);
const r = reports[0] || {};
ok('an uncaught error is reported', reports.length === 1, `${reports.length} reports`);
ok('the rupee amount is scrubbed', !/15,00,000/.test(JSON.stringify(r)) && /<amount>/.test(r.message), r.message);
ok('the email is scrubbed', !/rajan@example\.com/.test(JSON.stringify(r)) && /<email>/.test(r.message));
ok('a long number is scrubbed', !/98765432/.test(JSON.stringify(r)) && /<number>/.test(r.message));
ok('the version and platform travel with it', r.version === '1.1 (2)' && r.platform === 'web', `${r.version} / ${r.platform}`);
ok('the file path is cut to a file name', !/file:\/\//.test(r.source || '') && !/J\.A\.R\.V\.I\.S/.test(JSON.stringify(r)), r.source);

// The same error again is not a second report.
await page.evaluate(() => setTimeout(() => {
    throw new Error('Cannot value HDFC FD worth ₹15,00,000 for rajan@example.com, id 98765432');
}, 0));
await page.waitForTimeout(400);
ok('the same error is reported once', reports.length === 1, `${reports.length} reports`);

// A rejected promise nobody handled.
await page.evaluate(() => { Promise.reject(new Error('sync failed for ticker AVGO')); });
await page.waitForTimeout(400);
ok('an unhandled rejection is reported', reports.length === 2 && reports[1]?.kind === 'rejection', reports[1]?.message);

// A broken image is not a crash.
await page.evaluate(() => { const i = new Image(); i.src = 'https://example.invalid/x.png'; document.body.appendChild(i); });
await page.waitForTimeout(400);
ok('a failed image load is not reported', reports.length === 2, `${reports.length} reports`);

// A crashing loop stops at five per session.
await page.evaluate(() => { for (let i = 0; i < 10; i++) setTimeout(() => { throw new Error('loop ' + String.fromCharCode(97 + i)); }, 0); });
await page.waitForTimeout(600);
ok('a crashing loop sends at most five reports a session', reports.length === 5, `${reports.length} reports`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(' | ')}` : '\nCRASH OK');
process.exit(fails.length ? 1 : 0);
