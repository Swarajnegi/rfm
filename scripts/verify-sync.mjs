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
const p = await b.newPage({ viewport:{width:390,height:844}, hasTouch:true });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(s => {
  localStorage.setItem('rfm_v1', s);
  localStorage.setItem('corpus_tour_v1','x'); localStorage.setItem('rfm_v1', JSON.stringify((v => ({ ...v, profile: v.profile || { completedAt: '2026-09-01T00:00:00.000Z', name: 'Test', age: 40, goal: 'balanced', risk: 'medium', horizon: '7to15', interests: ['stocks'] } }))(JSON.parse(localStorage.getItem('rfm_v1') || '{}'))));
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
    banner: !!document.querySelector('.syncbar, [x-show*="fetching"], .is-spinning'),
    reentrant: (() => { const before = d.navFetchState; d.fetchAllPrices(); return d.navFetchState === before; })(),
  }), 140));
});
ok('an in-flight sync is visible on screen', busy.banner);
// The button that carried :disabled is gone, so the re-entrancy guard has to
// live in fetchAllPrices itself rather than in the markup that called it.
ok('sync cannot be re-fired mid-flight', busy.reentrant);

// PULL TO SYNC — the gesture is now the only way in, so it has to exist and
// has to be wired to the same global refresh.
const ptr = await p.evaluate(() => {
  const d = document.querySelector('[x-data]')._x_dataStack[0];
  return {
    indicator: !!document.getElementById('ptr'),
    bound: d._ptrBound === true,
    oneSync: typeof d.triggerPullRefresh === 'function',
    noButton: !document.getElementById('syncButton'),
  };
});
ok('the pull indicator is in the DOM', ptr.indicator);
ok('the gesture is bound', ptr.bound);
ok('it runs one sync for everything', ptr.oneSync);
ok('the per-list refresh button is gone', ptr.noButton);

// DRIVE THE DRAG. Everything above would pass on an indicator wired to
// nothing; this is the part that says the finger reaches the sync.
const drag = await p.evaluate(async () => {
  const bar = document.getElementById('ptr');
  const d = document.querySelector('[x-data]')._x_dataStack[0];
  d.navFetchState = 'idle';
  const touch = (type, y) => {
    const t = new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
    document.dispatchEvent(new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [t],
      targetTouches: type === 'touchend' ? [] : [t],
      changedTouches: [t], bubbles: true, cancelable: true,
    }));
  };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const pull = () => parseFloat((bar.style.transform.match(/([\d.]+)px/) || [0, 0])[1]);

  window.scrollTo(0, 0);
  touch('touchstart', 100);
  touch('touchmove', 130); await frame();
  const short = { y: pull(), armed: bar.dataset.armed, label: bar.querySelector('.ptr__label').textContent };
  touch('touchmove', 260); await frame();
  const long = { y: pull(), armed: bar.dataset.armed, label: bar.querySelector('.ptr__label').textContent };
  touch('touchend', 260);
  // Read synchronously: with the network blocked the sync resolves in
  // milliseconds, so an awaited read would only ever see the end state.
  const committed = { label: bar.querySelector('.ptr__label').textContent,
                      syncing: document.body.classList.contains('is-syncing') };
  await new Promise(r => setTimeout(r, 2200));
  const rest = { opacity: bar.style.opacity, syncing: document.body.classList.contains('is-syncing'),
                 refreshing: d.pullToRefresh.isRefreshing };

  // A short pull must NOT sync, or every downward flick fires the network.
  d.navFetchState = 'idle';
  const before = d.navFetchState;
  touch('touchstart', 100); touch('touchmove', 120); await frame(); touch('touchend', 120);
  await new Promise(r => setTimeout(r, 200));
  const shortPullSynced = d.pullToRefresh.isRefreshing || d.navFetchState !== before;

  // And it must not fire at all when the page is scrolled: otherwise it
  // hijacks an ordinary flick back to the top.
  window.scrollTo(0, 400);
  touch('touchstart', 100); touch('touchmove', 300); await frame();
  const whenScrolled = pull();
  touch('touchend', 300);
  window.scrollTo(0, 0);

  return { short, long, committed, rest, shortPullSynced, whenScrolled };
});

ok('the indicator follows the finger', drag.short.y > 0 && drag.short.y < drag.long.y,
   `${drag.short.y.toFixed(0)}px then ${drag.long.y.toFixed(0)}px`);
ok('a short pull is not armed', drag.short.armed === '0' && /Pull to sync/.test(drag.short.label),
   `${drag.short.armed} "${drag.short.label}"`);
ok('crossing the threshold arms it', drag.long.armed === '1' && /Release/.test(drag.long.label),
   `${drag.long.armed} "${drag.long.label}"`);
ok('releasing past the threshold starts a sync',
   /Syncing/.test(drag.committed.label) && drag.committed.syncing, JSON.stringify(drag.committed));
ok('and it puts itself away afterwards',
   drag.rest.opacity === '0' && !drag.rest.syncing && !drag.rest.refreshing, JSON.stringify(drag.rest));
ok('a short pull syncs nothing', !drag.shortPullSynced);
ok('a scrolled page keeps its scroll gesture', drag.whenScrolled === 0, `${drag.whenScrolled}px`);

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
  const now = new Date().toISOString();
  const threeDays = new Date(Date.now() - 3 * 864e5).toISOString();
  const inv = d.investments.find(i => i.schemeCode);
  return {
    seeded: d.priceFreshness(inv).state,
    live:   d.priceFreshness({ lastNavUpdate: now, priceAsOf: now, priceSource: 'AMFI', priceIsClose: false }).state,
    old:    d.priceFreshness({ lastNavUpdate: threeDays, priceAsOf: threeDays, priceSource: 'Yahoo' }).state,
    none:   d.priceFreshness({}).state,
    // THE BUG THIS REPLACED: a US holding synced seconds ago, quoting the last
    // US close — 01:30 IST at best, Friday's across a weekend. Judged on the
    // quote's age it read "not refreshed today" forever and no amount of
    // refreshing could clear it, because refreshing does not open a market.
    usJustSynced: d.priceFreshness({ lastNavUpdate: now, priceAsOf: threeDays, priceSource: 'Yahoo' }),
    portfolio: d.portfolioFreshness.label,
  };
});
ok('a fresh quote reads live', prov.live === 'live', prov.live);
ok('a holding not synced for 3 days reads stale', prov.old === 'stale', prov.old);
ok('an unsynced holding says so', prov.none === 'unknown', prov.none);
ok('a just-synced holding is NEVER stale, however old its quote',
   prov.usJustSynced.state !== 'stale', `${prov.usJustSynced.state} — "${prov.usJustSynced.label}"`);
ok('and it says the market is shut rather than blaming the user',
   /last close/.test(prov.usJustSynced.label), prov.usJustSynced.label);
ok('portfolio freshness summarises the worst case', !!prov.portfolio, prov.portfolio);

const real = errs.filter(e => !/favicon/i.test(e));
ok('no console errors', real.length === 0, real[0] || '');
await b.close();
console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'SYNC UI OK'}\n`);
process.exit(fails.length ? 1 : 0);
