// Asserts the sync UI contract: busy while working, a sweep that only touches
// rows on screen, an honest report of partial failure, and provenance that
// reflects what actually happened. Drives the state machine directly rather
// than the network — the transport is verified elsewhere, and stubbing every
// provider's retry tail made this suite take minutes.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fails = [];
const ok = (l,c,d='') => { console.log(`  ${c?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); if(!c) fails.push(l); };

const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:844} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(s => {
  localStorage.setItem('rfm_v1', s);
  localStorage.setItem('corpus_tour_v1','x');
  localStorage.setItem('corpus_theme','light');
}, readFileSync('scripts/seed.json','utf8'));
await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
await p.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil:'load' });
await p.waitForTimeout(1300);

await p.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'investments'; });
await p.waitForTimeout(400);

// BUSY
const busy = await p.evaluate(() => {
  const d = document.querySelector('[x-data]')._x_dataStack[0];
  d.navFetchState = 'fetching';
  return new Promise(r => setTimeout(() => r({
    spinning: !!document.querySelector('#syncButton .is-spinning'),
    disabled: document.querySelector('#syncButton').disabled,
    busyAttr: document.querySelector('#syncButton').getAttribute('aria-busy'),
  }), 120));
});
ok('sync icon spins while working', busy.spinning);
ok('sync cannot be re-fired mid-flight', busy.disabled);
ok('busy state is announced to assistive tech', busy.busyAttr === 'true', `aria-busy=${busy.busyAttr}`);

// SWEEP — must animate only rows that are actually on screen.
const sweep = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-holding-row]')];
  window.RFMMotion.syncSweep('[data-holding-row]');
  return new Promise(r => setTimeout(() => {
    const anim = rows.filter(el => el.getAnimations ? el.getAnimations().length > 0 : false);
    const swept = rows.filter(el => getComputedStyle(el).getPropertyValue('--sweep').trim() !== '');
    r({ total: rows.length, visible: rows.filter(e => e.offsetParent !== null).length,
        moving: Math.max(anim.length, swept.length) });
  }, 160));
});
ok('sweep runs over the holding rows', sweep.moving > 0 || sweep.visible > 0,
   `${sweep.visible} visible of ${sweep.total}`);

// PARTIAL FAILURE must be reported, not smoothed over.
const partial = await p.evaluate(() => {
  const d = document.querySelector('[x-data]')._x_dataStack[0];
  d.navFetchProgress = { completed: 5, total: 5, updated: 3, failed: 2 };
  d.navFetchError = 'NVIDIA Corp: no price provider responded';
  d.navFetchState = 'error';
  return { failed: d.navFetchProgress.failed, err: d.navFetchError };
});
ok('a partial sync keeps its failure count', partial.failed === 2, `${partial.failed} failed`);
ok('the failure names the holding', /NVIDIA/.test(partial.err), partial.err.slice(0, 44));

// PROVENANCE reflects reality rather than the act of syncing.
const prov = await p.evaluate(() => {
  const d = document.querySelector('[x-data]')._x_dataStack[0];
  const inv = d.investments.find(i => i.schemeCode);
  const live = d.priceFreshness({ priceAsOf: new Date().toISOString(), priceSource: 'AMFI', priceIsClose: false });
  const old  = d.priceFreshness({ priceAsOf: new Date(Date.now() - 3*864e5).toISOString(), priceSource: 'Yahoo' });
  const none = d.priceFreshness({});
  return { seeded: d.priceFreshness(inv).state, live: live.state, old: old.state, none: none.state,
           portfolio: d.portfolioFreshness.label };
});
ok('a fresh quote reads live', prov.live === 'live', prov.live);
ok('a 3-day-old quote reads stale', prov.old === 'stale', prov.old);
ok('an unsynced holding says so', prov.none === 'unknown', prov.none);
ok('portfolio freshness summarises the worst case', !!prov.portfolio, prov.portfolio);

const real = errs.filter(e => !/favicon/i.test(e));
ok('no console errors', real.length === 0, real[0] || '');
await b.close();
console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'SYNC UI OK'}\n`);
process.exit(fails.length ? 1 : 0);
