/* Store and press imagery. Composites REAL app screens — not mockup art — into
   a device frame on a Corpus-palette ground, at Play Store phone dimensions
   (1080x1920). Two passes: capture the live screens, then lay them up.

     node scripts/press-shots.mjs [--theme light|dark]                        */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const THEME = (process.argv[process.argv.indexOf('--theme') + 1] || 'light');
const DARK = THEME === 'dark';
mkdirSync('press', { recursive: true });

/* Each frame states ONE thing. Store captions are read in a swipe, so a
   sentence that needs parsing is a sentence nobody reads. */
const FRAMES = [
  { route: 'home',        head: 'Everything you own,\nin one figure',      sub: 'Deposits, funds, stocks, gold — valued together.' },
  { route: 'investments', head: 'Every price says\nwhere it came from',    sub: 'AMFI, Yahoo, and the exact minute it was verified.' },
  { route: 'planning',    head: 'What is left over,\nand what it is for',  sub: 'Cash flow, goals and your emergency buffer.' },
  { route: 'regen',       head: 'What your own\nnumbers say',              sub: 'Observations about your position. Never a stock tip.' },
  { route: 'import',      head: 'Read a statement\ninstead of typing it',  sub: 'CAS and bank PDFs, parsed on your device.' },
];

const seed = readFileSync('scripts/seed.json', 'utf8');
// Local calendar keys, matching what the app writes. toISOString() is UTC and
// dated every fixture a day early east of Greenwich.
const key = i => { const d = new Date(); d.setDate(d.getDate() - i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hist = JSON.stringify(Array.from({ length: 44 }, (_, i) => ({
  date: key(43 - i),
  value: Math.round(1_150_000 + i * 3_400 + Math.sin(i / 5) * 41_000), source: 'press',
})));

const b = await chromium.launch();

// ── Pass 1: capture the live app at 3x so it stays crisp when scaled up.
const shots = {};
for (const f of FRAMES) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await p.addInitScript(([s, h, t]) => {
    localStorage.setItem('rfm_v1', s);
    localStorage.setItem('rfm_nw_history', h);
    localStorage.setItem('rfm_usd_inr_rate', '88.41');
    localStorage.setItem('corpus_tour_v1', 'seen'); localStorage.setItem('rfm_v1', JSON.stringify((v => ({ ...v, profile: v.profile || { version: 2, completedAt: '2026-09-01T00:00:00.000Z', name: 'Test', age: 40, goal: 'balanced', risk: 'medium', horizon: '7to15', interests: ['stocks'] } }))(JSON.parse(localStorage.getItem('rfm_v1') || '{}'))));
    localStorage.setItem('corpus_theme', t);
    localStorage.setItem('corpus_last_visit', JSON.stringify({
      at: new Date(Date.now() - 3 * 864e5).toISOString(), value: 1_237_000,
    }));
  }, [seed, hist, THEME]);
  await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
  await p.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil: 'load' });
  await p.waitForTimeout(1700);
  if (f.route !== 'home') {
    await p.evaluate(v => { document.querySelector('[x-data]')._x_dataStack[0].activePage = v; }, f.route);
    await p.waitForFunction(() => [...document.querySelectorAll('main')].filter(m => m.offsetParent !== null).length === 1,
                            null, { timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(500);
  }
  shots[f.route] = (await p.screenshot()).toString('base64');
  await p.close();
  console.log(`  captured ${f.route}`);
}
await b.close();
writeFileSync('/tmp/press-shots.json', JSON.stringify({ shots, THEME, DARK, FRAMES }));
console.log(`\n  ${FRAMES.length} screens captured (${THEME})`);
