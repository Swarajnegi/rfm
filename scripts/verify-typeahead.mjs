// A typeahead that lists the right answer and then does not fill it in is worse
// than no typeahead: the user reported being "stuck at submitting 'invesco mid'"
// after clicking the correct scheme. That bug was an argument-order mistake, and
// nothing in the app would ever have caught it, because the list LOOKED right.
//
// So this drives the real thing — types, waits for results, CLICKS one, and then
// reads the form back out. Both sources are stubbed so the suite stays offline
// and deterministic; what is under test is the wiring, not the vendor.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const YAHOO = { quotes: [
  { symbol:'NVDA',    longname:'NVIDIA Corporation',        exchDisp:'NasdaqGS', quoteType:'EQUITY' },
  { symbol:'NVDQ',    longname:'T-Rex 2X Inverse NVIDIA',   exchDisp:'NasdaqGM', quoteType:'ETF' },
  { symbol:'RELIANCE.NS', longname:'Reliance Industries Limited', exchDisp:'NSE', quoteType:'EQUITY' },
]};
const AMFI = [
  { schemeCode: 120505, schemeName: 'Invesco India Midcap Fund - Direct Plan Growth' },
  { schemeCode: 118834, schemeName: 'Invesco India Midcap Fund - Growth' },
];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(s => { localStorage.setItem('rfm_v1', s); localStorage.setItem('corpus_tour_v1','x'); },
                      readFileSync('scripts/seed.json','utf8'));

await p.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file://')) return r.continue();
  if (u.includes('finance.yahoo.com') || u.includes('corsproxy') || u.includes('allorigins'))
    return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(YAHOO) });
  if (u.includes('mfapi') || u.includes('amfi'))
    return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(AMFI) });
  return r.abort();
});
await p.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil:'load' });
await p.waitForTimeout(1200);

const D = () => p.evaluateHandle(() => document.querySelector('[x-data]')._x_dataStack[0]);
let bad = 0;
const check = (name, ok, detail='') => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function run(label, { type, query, pick, expect }) {
  await p.evaluate(t => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    d.addingInv = true; d.newInv.type = t; d.newInv.name = ''; d.newInv.ticker = '';
    d.symbolSearch.results = []; d.mfSearchResults = [];
  }, type);
  await p.waitForTimeout(350);

  const input = p.locator('.bsheet:visible input.field[type="text"]').first();
  await input.fill(query);
  await input.dispatchEvent('input');

  // The lookup is debounced by design; wait for the list rather than a fixed sleep.
  let items = p.locator('.bsheet:visible .typeahead__item');
  try { await items.first().waitFor({ state:'visible', timeout: 4000 }); }
  catch { check(`${label}: results appear`, false, `nothing listed for "${query}"`); return; }

  const n = await items.count();
  const first = (await items.first().innerText()).replace(/\s+/g,' ').trim();
  check(`${label}: results appear`, n > 0, `${n} result(s), first "${first}"`);

  await items.nth(pick).click();
  await p.waitForTimeout(300);

  const form = await p.evaluate(() => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    return { name: d.newInv.name, ticker: d.newInv.ticker, type: d.newInv.type,
             currency: d.newInv.currency, open: d.symbolSearch.results.length + d.mfSearchResults.length };
  });
  for (const [k, v] of Object.entries(expect)) {
    check(`${label}: ${k} filled`, form[k] === v, `${JSON.stringify(form[k])}${form[k]===v?'':' != '+JSON.stringify(v)}`);
  }
  check(`${label}: list closes after choosing`, form.open === 0, `${form.open} still listed`);

  await p.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].addingInv = false; });
  await p.waitForTimeout(250);
}

console.log('\nTYPEAHEAD\n');
await run('US stock', { type:'Stock (US)', query:'nvidia', pick:0,
  expect: { name:'NVIDIA Corporation', ticker:'NVDA', type:'Stock (US)', currency:'USD' } });
await run('India stock', { type:'Stock (IND)', query:'reliance', pick:0,
  expect: { name:'Reliance Industries Limited', ticker:'RELIANCE', type:'Stock (IND)', currency:'INR' } });
await run('Mutual fund', { type:'Mutual Fund', query:'invesco mid', pick:0,
  expect: { name:'Invesco India Midcap Fund - Direct Plan Growth' } });

// A US search must not offer an NSE listing: the price path and the currency
// both differ, and picking the wrong one is silently wrong forever.
const leak = await p.evaluate(async () => {
  const d = document.querySelector('[x-data]')._x_dataStack[0];
  d.newInv.type = 'Stock (US)';
  await d._runSymbolSearch('reliance', d.newInv);
  return d.symbolSearch.results.map(r => r.symbol);
});
check('market filter holds', !leak.some(s => s.endsWith('.NS')), `US search returned [${leak.join(', ')}]`);

check('no console errors', errs.length === 0, errs.join(' | '));
await b.close();
console.log(bad ? `\n${bad} FAILURE(S)\n` : '\nTYPEAHEAD OK\n');
process.exit(bad ? 1 : 0);
