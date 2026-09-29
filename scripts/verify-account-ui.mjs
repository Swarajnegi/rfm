import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.addInitScript(() => {
    localStorage.setItem('corpus_alerts_enabled', 'false');
    localStorage.setItem('rfm_v1', JSON.stringify({ version:'3.0', investments: [], profile: { version:2, completedAt:'2026-09-27', name:'Test' } }));
  });
  await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto(pathToFileURL(path.resolve('web/index.html')).href);
  await page.waitForFunction(() => window.Alpine?.store('account'));
  await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'settings'; });
  await page.getByRole('heading', { name: 'Account & sync' }).waitFor();
  await page.getByRole('button', { name:'Continue with Google' }).waitFor({ state:'visible' });
  assert.equal(await page.getByRole('button', { name:'Continue with Google' }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name:'Send email code' }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name:'Send email code' }).isEnabled(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('.account-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(os.tmpdir(), 'corpus-email-signin.png') });
  // Also retain the all-disabled setup state for incomplete deployments.
  await page.evaluate(() => Object.assign(Alpine.store('account'), { enabled:false, googleEnabled:false, emailEnabled:false }));
  await page.getByRole('button', { name:'Continue with Google' }).waitFor({ state:'hidden' });
  assert.match(await page.locator('.account-card').innerText(), /being set up/);
  // Render both configured providers without contacting any real auth provider.
  await page.evaluate(() => Object.assign(Alpine.store('account'), { enabled:true, googleEnabled:true, emailEnabled:true }));
  await page.getByRole('button', { name:'Continue with Google' }).waitFor({ state:'visible' });
  assert.equal(await page.getByRole('button', { name:'Continue with Google' }).isEnabled(), false);
  await page.getByRole('checkbox', { name:/I understand/ }).check();
  assert.equal(await page.getByRole('button', { name:'Continue with Google' }).isEnabled(), true);
  await page.getByLabel('Email address', { exact:true }).fill('user@example.com');
  await page.evaluate(() => { Alpine.store('account').codeSent = true; });
  assert.equal(await page.getByLabel('One-time email code').getAttribute('autocomplete'), 'one-time-code');
  await page.getByRole('button', { name:'Resend code', exact:true }).waitFor({ state:'visible' });
  assert.equal(await page.getByRole('button', { name:'Resend code', exact:true }).isVisible(), true);
  await page.getByRole('button', { name:'Use another email' }).click();
  await page.getByLabel('One-time email code').waitFor({ state:'hidden' });
  assert.equal(await page.getByLabel('One-time email code').isVisible(), false);
  await page.evaluate(() => Object.assign(Alpine.store('account'), { user:{id:'test',email:'user@example.com'}, status:'conflict', notice:'Both devices changed. No data has been overwritten.' }));
  await page.getByRole('button', { name:'Load cloud copy' }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name:'Load cloud copy' }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name:'Keep this device’s copy' }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name:'Delete account', exact:true }).isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: account release gates, mobile layout, consent, Google/email controls, code input, conflict choices, deletion control, no runtime errors.');
} finally { await browser.close(); }
