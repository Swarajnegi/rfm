import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { validateDocument } from '../src/account-sync.mjs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const bank = require('../web/bank-transactions.js');
const csv = [
  'Account Statement,Test Bank',
  'Date,Narration,Debit,Credit,Balance,Reference',
  '28/09/2026,"POS Grocery, Pune",500.00,,99500.00,REF1',
  '28/09/2026,SELF TRANSFER,2000.00,,97500.00,REF2',
  '28/09/2026,UPI/Person,300.00,,97200.00,REF3',
  '27/09/2026,SALARY,,50000.00,100000.00,REF4'
].join('\n');
const parsed = bank.parseCsv(csv, 'HDFC •1234');
assert.equal(parsed.entries.length, 4);
assert.deepEqual(parsed.entries.map(x => x.category), ['spend', 'transfer', 'review', 'credit']);
assert.equal(parsed.entries[0].description, 'POS Grocery, Pune');
assert.equal(bank.merge(parsed.entries, parsed.entries).added, 0);
assert.notEqual(bank.parseCsv(csv, 'Other •5678').entries[0].id, parsed.entries[0].id);
assert.equal(bank.date('31/02/2026'), null);
assert.throws(() => bank.parseCsv('Date,Narration,Amount\n28/09/2026,Unknown,500', 'HDFC •1234'), /No trustworthy/);
assert.throws(() => bank.parseCsv('Date,Narration,Debit,Credit\n28/09/2026,Wrong,500,500', 'HDFC •1234'), /No trustworthy/);
assert.equal(bank.parseCsv('Date,Narration,Amount\n28/09/2026,Refund,500.00 CR', 'HDFC •1234').entries[0].direction, 'credit');
const statementScope = { window: {} };
runInNewContext(readFileSync('web/parser.js', 'utf8'), statementScope);
const bankPdf = statementScope.window.RFMParser.parseStatement('Account statement\nStatement of Transactions\nSavings Account Balance 1,20,000.00');
assert.equal(bankPdf.type, 'BANK_STATEMENT');
assert.equal(bankPdf.investments.length, 0, 'a savings balance must not become a fictitious fixed deposit');
const unrecognizedPdf = statementScope.window.RFMParser.parseStatement('Financial Statement\nTotal Balance: 1,20,000.00');
assert.equal(unrecognizedPdf.investments.length, 0, 'an unrecognized balance must not become a fictitious fund');
validateDocument({ schema: 1, portfolio: { investments: [], bankTransactions: parsed.entries }, history: [] });
assert.throws(() => validateDocument({ schema: 1, portfolio: { investments: [], bankTransactions: [{ ...parsed.entries[0], amount: -1 }] }, history: [] }), /Invalid bank/);
console.log('PASS: bank CSV quoting, classification, dedup, dates, ambiguity and sync validation');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource: net::ERR_FAILED')) errors.push(m.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('corpus_tour_v1', 'x');
    localStorage.setItem('rfm_v1', JSON.stringify({ investments: [], profile: {
      version: 2, completedAt: '2026-09-01T00:00:00.000Z', name: 'Test', age: 40,
      holdings: [], purpose: {}, horizon: {}, payout: {}
    } }));
  });
  await page.route('**/*', route => route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await page.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil: 'load' });
  assert.equal(await page.title(), 'Corpus');
  assert.ok((await page.locator('body').innerText()).includes('Corpus'));
  await page.waitForFunction(() => document.querySelector('[x-data]')?._x_dataStack?.[0]);
  await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'income'; });
  await page.getByRole('button', { name: 'Import bank CSV' }).click();
  await page.locator('[x-ref=pdf]').setInputFiles({ name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByLabel('Which bank account?').fill('HDFC •1234');
  await page.getByRole('button', { name: 'Review this statement' }).click();
  await page.getByRole('heading', { name: 'Review bank activity' }).waitFor();
  assert.equal(await page.locator('[aria-label="Bank transactions found"] [role="checkbox"]').count(), 4);
  await page.getByRole('button', { name: 'Save selected transactions' }).click();
  await page.getByRole('heading', { name: 'Bank activity' }).waitFor();
  const state = await page.evaluate(() => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    return { count: d.bankTransactions.length, spend: d.bankMonthSpend, review: d.bankMonthReviewCount,
      saved: JSON.parse(localStorage.getItem('rfm_v1')).bankTransactions.length };
  });
  assert.deepEqual(state, { count: 4, spend: 500, review: 1, saved: 4 });
  await page.getByRole('heading', { name: 'Bank activity' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(3500);
  const mobileShot = path.join(os.tmpdir(), 'corpus-bank-activity-mobile.png');
  await page.screenshot({ path: mobileShot });
  await page.getByRole('button', { name: 'Import bank CSV' }).click();
  await page.locator('[x-ref=pdf]').setInputFiles({ name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Review this statement' }).click();
  await page.getByRole('button', { name: 'Save selected transactions' }).click();
  assert.equal(await page.evaluate(() => document.querySelector('[x-data]')._x_dataStack[0].bankTransactions.length), 4);
  assert.deepEqual(errors, []);
  console.log('PASS: 390px bank CSV review, save, daily spend display and repeat-import dedup');
  console.log('Mobile screenshot:', mobileShot);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'income'; });
  await page.getByRole('heading', { name: 'Bank activity' }).scrollIntoViewIfNeeded();
  const desktopShot = path.join(os.tmpdir(), 'corpus-bank-activity-desktop.png');
  await page.screenshot({ path: desktopShot });
  console.log('Desktop screenshot:', desktopShot);
  await page.close();
} finally { await browser.close(); }
