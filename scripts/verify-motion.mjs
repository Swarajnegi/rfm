// Exercises interactions rather than inspecting CSS. A transition that is
// declared but never fires looks identical to one that works, in source.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fails = [];
const ok = (l, c, d='') => { console.log(`  ${c?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); if(!c) fails.push(l); };

const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:844} });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(s => {
  localStorage.setItem('rfm_v1', s);
  localStorage.setItem('corpus_theme','light');
  localStorage.setItem('corpus_tour_v1','seen');
}, readFileSync('scripts/seed.json','utf8'));
await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
await p.goto(pathToFileURL(path.resolve('web/index.html')).href);
await p.waitForTimeout(1600);

// App bar should be bare at rest and ruled once content is behind it.
const atRest = await p.evaluate(() => document.querySelector('.appbar').classList.contains('is-stuck'));
await p.evaluate(() => window.scrollTo(0, 400));
await p.waitForTimeout(500);
const scrolled = await p.evaluate(() => document.querySelector('.appbar').classList.contains('is-stuck'));
ok('app bar is bare at rest', !atRest);
ok('app bar takes its rule on scroll', scrolled);
await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(450);
ok('app bar gives the rule back', !(await p.evaluate(() => document.querySelector('.appbar').classList.contains('is-stuck'))));

// Springs must actually be resolved values, not an unparsed custom property.
const springs = await p.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const btn = document.querySelector('.btn');
  return {
    spring: cs.getPropertyValue('--spring').trim().slice(0, 12),
    btnTiming: btn ? getComputedStyle(btn).transitionTimingFunction.slice(0, 14) : '',
    dockTiming: getComputedStyle(document.querySelector('.dock__item'), '::before').transitionTimingFunction.slice(0,14),
  };
});
ok('spring easing resolves', springs.spring.startsWith('linear('), springs.spring + '…');
ok('buttons use the spring', /linear|cubic/.test(springs.btnTiming), springs.btnTiming);

// View transitions must be reachable, and navigation must actually change page.
const vt = await p.evaluate(() => typeof document.startViewTransition === 'function');
const before = await p.evaluate(() => document.querySelector('[x-data]')._x_dataStack[0].activePage);
await p.click('#navplanning');
await p.waitForTimeout(600);
const after = await p.evaluate(() => document.querySelector('[x-data]')._x_dataStack[0].activePage);
ok('View Transition API available', vt, vt ? '' : 'falls back to GSAP fade');
ok('dock navigates', before !== after, `${before} -> ${after}`);
ok('dock marks the active surface', await p.evaluate(() => document.querySelector('#navplanning').classList.contains('is-active')));

// A sheet must open, trap nothing, and close on Escape.
await p.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage = 'investments'; });
await p.waitForTimeout(400);
await p.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].addingInv = true; });
await p.waitForTimeout(650);
ok('sheet opens', await p.evaluate(() => !!document.querySelector('.bsheet') && document.querySelector('.bsheet').offsetParent !== null));
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
ok('sheet closes on Escape', await p.evaluate(() => !document.querySelector('[x-data]')._x_dataStack[0].addingInv));

// Reduced motion, measured rather than asserted: reading cssRules off a
// file:// stylesheet throws, so emulate the preference and measure what the
// engine actually computes.
const p2 = await b.newPage({ viewport:{width:390,height:844}, reducedMotion: 'reduce' });
await p2.addInitScript(() => localStorage.setItem('corpus_theme','light'));
await p2.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
await p2.goto(pathToFileURL(path.resolve('web/index.html')).href);
await p2.waitForTimeout(900);
const durations = await p2.evaluate(() => {
  const btn = document.querySelector('.btn') || document.querySelector('.dock__item');
  return {
    btn: getComputedStyle(btn).transitionDuration,
    dock: getComputedStyle(document.querySelector('.dock__item'), '::before').transitionDuration,
  };
});
const collapsed = v => v.split(',').every(x => parseFloat(x) <= 0.002);
ok('reduced motion collapses durations', collapsed(durations.btn) && collapsed(durations.dock),
   `btn ${durations.btn}, dock ${durations.dock}`);
await p2.close();

const real = errs.filter(e => !/favicon/i.test(e));
ok('no console errors', real.length === 0, real[0] || '');
await b.close();
console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'MOTION OK'}\n`);
process.exit(fails.length ? 1 : 0);
