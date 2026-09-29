import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { latestCpi } from '../worker/src/index.js';
import { validateDocument } from '../src/account-sync.mjs';

const sandbox = { window: {}, Date, Number, Object, Math };
runInNewContext(readFileSync('web/tax-ledger.js', 'utf8'), sandbox);
const tax = sandbox.window.CorpusTaxLedger;
const lot = (id, date, quantity, cost) => ({ id, date, quantity, quantityRemaining: quantity, cost });
const holding = { id: 'h', name: 'Indian stock', type: 'Stock (IND)', units: 10,
  taxLots: [lot('a', '2025-02-01', 4, 400), lot('b', '2025-09-01', 6, 900)] };
const a = tax.allocateSale(holding, { date: '2026-05-02', quantity: 5, proceeds: 1000, fees: 10, sttEligible: true });
assert.equal(a.sale.fy, '2026-27');
assert.equal(a.sale.allocations.length, 2);
assert.equal(a.sale.allocations[0].code, '112A');
assert.equal(a.sale.allocations[1].code, '111A');
assert.equal(a.lots[0].quantityRemaining, 0);
assert.equal(a.lots[1].quantityRemaining, 5);
assert.equal(a.sale.gain, 440);
const sum = tax.summarize([{ ...a.sale, id: 's' }], '2026-27');
assert.equal(sum.amounts['112A'], 392);
assert.equal(sum.amounts['111A'], 48);
assert.equal(sum.specialTax, 9.98);
assert.equal(tax.summarize([{ ...a.sale, id:'s' }], '2025-26').sales.length, 0);
const unknownBasis = tax.allocateSale({ ...holding, taxLots: [] }, { date:'2026-05-02', quantity:1, proceeds:100 });
assert.equal(unknownBasis.sale.gain, null);
assert.equal(unknownBasis.sale.allocations[0].code, 'review');
assert.equal(tax.summarize([{ ...unknownBasis.sale, id:'u' }], '2026-27').realizedGain, null);
assert.equal(tax.category({ type:'Stock (IND)' }, { sttEligible:true }, '2026-02-31', '2026-05-02').code, 'review');
assert.throws(() => tax.allocateSale(holding, { date:'2026-05-02', quantity:11, proceeds:100 }), /exceeds/);
const review = tax.allocateSale(holding, { date:'2026-05-02', quantity:2, proceeds:300, sttEligible:false });
assert.equal(review.sale.allocations[0].code, 'review');
assert.ok(tax.summarize([{ ...review.sale, id:'r' }], '2026-27').review.length);
const fund = { id:'f', name:'Debt fund', type:'Mutual Fund', units:1, taxLots:[lot('d','2025-01-01',1,100)] };
assert.equal(tax.allocateSale(fund, { date:'2026-09-01', quantity:1, proceeds:120, fundTaxClass:'specified-50aa' }).sale.allocations[0].code, 'slab');
assert.equal(tax.allocateSale(fund, { date:'2026-09-01', quantity:1, proceeds:120 }).sale.allocations[0].code, 'review');
assert.equal(tax.category({ type:'Bond' }, { bondListing:'unlisted' }, '2025-01-01', '2026-09-01').code, 'slab');
assert.equal(tax.category({ type:'Physical Metal' }, {}, '2023-01-01', '2026-09-01').code, '112');
assert.equal(tax.category({ type:'Stock (US)', currency:'USD' }, {}, '2025-01-01', '2026-09-01').code, 'review');
assert.equal(tax.category({ type:'Stock (IND)' }, { sttEligible:true }, '2025-05-02', '2026-05-02').code, '111A');
console.log('PASS: FIFO partial sales, financial years, 111A/112A boundaries, 50AA, metals, bonds, foreign and missing-basis review.');

const catalogue = { data:[{ table_name:'All India Combined (General) level index and inflation (Base Year : 2024=100)',
  ref_period:'August 2026', release_date:'14 Sep 2026',
  data_wrapper_iframe_embeded_code:'<iframe src="https://datawrapper.dwcdn.net/ntiSj/2/"></iframe>' }] };
const csv = 'Month,Index,,,Inflation (%)\n,Rural,Urban,Combined,Rural,Urban,Combined\nAug-26*,109.27,108.07,108.74,5.23,4.31,4.82,,,,\n';
const fake = async url => url.includes('golden-sheet') ? new Response(JSON.stringify(catalogue)) : new Response(csv);
const cpi = await latestCpi(fake);
assert.equal(cpi.rate, 4.82);
assert.equal(cpi.referenceMonth, 'August 2026');
assert.equal(cpi.releasedOn, '14 Sep 2026');
await assert.rejects(() => latestCpi(async url => url.includes('golden-sheet')
  ? new Response(JSON.stringify(catalogue)) : new Response(csv.replace('Aug-26*','Jul-26'))), /does not match/);
await assert.rejects(() => latestCpi(async () => new Response('', { status:503 })), /unavailable/);
console.log('PASS: official CPI month, combined column, bad release and outage handling.');

const document = { schema:1, portfolio:{ investments:[{ ...holding }], tax:{ sales:[{ ...a.sale, id:'s' }] },
  cpi:{rate:4.82,referenceMonth:'August 2026'} }, history:[] };
assert.equal(validateDocument(document), document);
assert.throws(() => validateDocument({ ...document, portfolio:{ ...document.portfolio,
  tax:{ sales:[{ ...a.sale, date:'2026-02-31' }] } } }), /Invalid sales/);
assert.throws(() => validateDocument({ ...document, portfolio:{ ...document.portfolio,
  investments:[{ ...holding, taxLots:[{ ...holding.taxLots[0], cost:Infinity }] }] } }), /Invalid holding/);
console.log('PASS: new sync fields accept valid records and reject invalid sales or basis.');

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport:{width:390,height:844}, timezoneId:'Asia/Kolkata' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('corpus_alerts_enabled','false');
    localStorage.setItem('corpus_tour_v1','seen');
    localStorage.setItem('rfm_usd_inr_rate', JSON.stringify({rate:95.92,ts:new Date().toISOString()}));
    if (!localStorage.getItem('rfm_v1')) localStorage.setItem('rfm_v1', JSON.stringify({ version:'4.0', investments:[], sips:[], goals:[],
      cpi:{rate:4.82,referenceMonth:'August 2026',releasedOn:'14 Sep 2026',sourceUrl:'https://esankhyiki.mospi.gov.in/catalogue-main/catalogue?product=CPI'},
      profile:{version:2,completedAt:'2026-09-01',name:'Test'} }));
  });
  await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto(pathToFileURL(path.resolve('web/index.html')).href);
  await page.waitForFunction(() => !!document.querySelector('[x-data]')?._x_dataStack?.[0]);
  const app = () => document.querySelector('[x-data]')._x_dataStack[0];
  await page.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'regen'; });
  await page.getByText('Add a holding to analyze your portfolio.').waitFor();
  assert.equal(await page.getByRole('button', {name:'Add a holding',exact:true}).isVisible(), true);
  await page.getByRole('button', {name:'Add a holding',exact:true}).click();
  assert.equal(await page.evaluate(() => document.querySelector('[x-data]')._x_dataStack[0].addingInv), true);
  await page.evaluate(() => {
    const a = document.querySelector('[x-data]')._x_dataStack[0];
    a.addingInv = false;
    a.newSip = { name:'Bank RD', type:'RD', monthlyAmount:2000, dayOfMonth:5, status:'Active', linkedInvestmentId:null };
  });
  await page.evaluate(async () => { const a=document.querySelector('[x-data]')._x_dataStack[0]; await a.addSip(); });
  const rd = await page.evaluate(() => {
    const a=document.querySelector('[x-data]')._x_dataStack[0]; const s=a.sips.find(x=>x.type==='RD');
    const h=a.investments.find(x=>x.id===s.linkedInvestmentId); const before=a.getInvCurrentValue(h);
    s.lastExecutedMonth='2000-01'; return { before, s:s.id, h:h.id, count:a.investments.length };
  });
  assert.equal(rd.before, 0);
  assert.equal(rd.count, 1);
  const confirmed = await page.evaluate(async () => {
    const a=document.querySelector('[x-data]')._x_dataStack[0]; const s=a.sips.find(x=>x.type==='RD');
    const once=await a.confirmSipDebit(s), twice=await a.confirmSipDebit(s);
    const h=a.investments.find(x=>x.id===s.linkedInvestmentId);
    return {once,twice,principal:h.amount,entries:h.confirmedInstalments.length,linked:h.linkedSipId===s.id};
  });
  assert.deepEqual(confirmed, {once:true,twice:false,principal:2000,entries:1,linked:true});
  const skipped = await page.evaluate(() => {
    const a=document.querySelector('[x-data]')._x_dataStack[0]; const s=a.sips.find(x=>x.type==='RD');
    s.lastExecutedMonth='2000-01'; a.skipSipDebit(s); return { principal:a.investments[0].amount, skips:s.skippedInstalments.length };
  });
  assert.equal(skipped.principal, 2000);
  assert.equal(skipped.skips, 1);
  const metal = await page.evaluate(async () => {
    const a=document.querySelector('[x-data]')._x_dataStack[0]; a.usdInrRate=95.92; a.usdInrAsOf=new Date().toISOString();
    const h={id:'m',name:'Physical gold',type:'Physical Metal',metal:'gold',metalUnit:'g',purity:91.67,
      metalValuationMode:'benchmark',units:10,buyPrice:8000,currentPrice:8000};
    a.investments.push(h);
    a.httpGetJson=async()=>({price:3100,updatedAt:new Date().toISOString()});
    await a.fetchSinglePrice(h);
    const benchmark=h.currentPrice, value=a.getInvCurrentValue(h);
    h.metalValuationMode='manual'; h.currentPrice=9000;
    const manual=await a.fetchSinglePrice(h);
    h.metalValuationMode='benchmark'; a.httpGetJson=async()=>{throw new Error('offline')};
    try { await a.fetchSinglePrice(h); } catch (_) {}
    return {benchmark,value,manual,retained:h.currentPrice};
  });
  assert.ok(Math.abs(metal.benchmark-8769.3)<10, JSON.stringify(metal));
  assert.ok(Math.abs(metal.value-metal.benchmark*10)<1);
  assert.equal(metal.manual,null);
  assert.equal(metal.retained,9000);
  const disposal = await page.evaluate(() => {
    const app=document.querySelector('[x-data]')._x_dataStack[0]; const h=app.investments.find(i=>i.id==='m');
    app.openSale(h); app.saleForm.quantity=1; app.saleForm.proceeds=9200; app.saleForm.fees=100;
    app.recordSale();
    return { units:h.units, cash:app.networth.cash, gain:app.tax.sales.at(-1)?.gain,
      review:app.saleTaxSummary.review.length, error:app.saleError };
  });
  assert.deepEqual(disposal, {units:9,cash:9100,gain:null,review:1,error:''});
  const payout = await page.evaluate(() => {
    const a=document.querySelector('[x-data]')._x_dataStack[0]; a.onboarding.draft={payout:{gold:['none']}};
    a.onboardingToggleClass('payout','gold','monthly'); const first=a.onboarding.draft.payout.gold;
    a.onboardingToggleClass('payout','gold','quarterly'); const second=a.onboarding.draft.payout.gold;
    a.onboardingToggleClass('payout','gold','none'); return {first,second,third:a.onboarding.draft.payout.gold};
  });
  assert.deepEqual(payout.first,['monthly']);
  assert.deepEqual(payout.second,['monthly','quarterly']);
  assert.deepEqual(payout.third,['none']);
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('[x-data]')?._x_dataStack?.[0]);
  const persisted = await page.evaluate(() => { const a=document.querySelector('[x-data]')._x_dataStack[0];
    return {rd:a.investments.find(i=>i.type==='Recurring Deposit')?.amount,
      cpi:a.cpi?.rate, label:a.cpiLabel, offline:a.cpiOffline, sale:a.tax.sales.at(-1)?.gain}; });
  assert.equal(persisted.rd,2000);
  assert.equal(persisted.cpi,4.82);
  assert.match(persisted.label,/last available/);
  assert.equal(persisted.offline,true);
  assert.equal(persisted.sale,null);
  const restored = await page.evaluate(async () => {
    const app=document.querySelector('[x-data]')._x_dataStack[0];
    const saved=localStorage.getItem('rfm_v1');
    const payload={format:'rfm-backup',formatVersion:2,keys:{rfm_v1:saved,
      rfm_nw_history:localStorage.getItem('rfm_nw_history') || '[]'}};
    localStorage.setItem('rfm_v1',JSON.stringify({version:'4.0',investments:[],sips:[],goals:[]}));
    window.confirm=()=>true; window.alert=()=>{};
    await app.restoreData({target:{files:[new File([JSON.stringify(payload)],'corpus-test.json',{type:'application/json'})]}});
    return {rd:app.investments.find(i=>i.type==='Recurring Deposit')?.amount,
      metal:app.investments.find(i=>i.id==='m')?.units,cpi:app.cpi?.rate,sale:app.tax.sales.at(-1)?.gain};
  });
  assert.deepEqual(restored,{rd:2000,metal:9,cpi:4.82,sale:null});
  for (const route of ['home','planning','investments','regen','tax']) {
    await page.evaluate(next => { document.querySelector('[x-data]')._x_dataStack[0].activePage = next; }, route);
    await page.waitForTimeout(80);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 391, `${route} overflows a 390px phone: ${width}px`);
  }
  await page.evaluate(() => { const a=document.querySelector('[x-data]')._x_dataStack[0]; a.openSale(a.investments.find(i=>i.type==='Physical Metal')); });
  await page.locator('[data-s="sale"]').getByRole('button',{name:'Record sale'}).waitFor({state:'visible'});
  assert.equal(await page.locator('[data-s="sale"]').getByRole('button',{name:'Record sale'}).isVisible(),true);
  assert.deepEqual(errors, []);
  console.log('PASS: first-run AI CTA, RD link/confirm/skip/persistence, metal benchmark/manual/failure, payout choices, offline CPI and 390px layout.');
} finally { await browser.close(); }
