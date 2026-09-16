// Renders Corpus screens for visual review. Network is cut, so what you see is
// what ships offline.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FILE = process.env.PAGE_FILE || 'web/corpus.html';
const themes = (process.env.THEMES || 'light,dark').split(',');
const seedBlob = readFileSync('scripts/seed.json', 'utf8');
const hist = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
  date: new Date(Date.now() - (39 - i) * 864e5).toISOString().slice(0, 10),
  value: Math.round(1180000 + i * 3100 + Math.sin(i / 4) * 38000), source: 'seed',
})));

const b = await chromium.launch();
for (const theme of themes) {
  for (const [label, page] of Object.entries(JSON.parse(process.env.PAGES || '{"home":"home"}'))) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(([s, h, t]) => {
      localStorage.setItem('rfm_v1', s);
      localStorage.setItem('rfm_nw_history', h);
      localStorage.setItem('rfm_usd_inr_rate', '88.41');
      localStorage.setItem('rfm_tour_v1', 'seen');
      localStorage.setItem('corpus_theme', t);
    }, [seedBlob, hist, theme]);
    await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await p.goto(pathToFileURL(path.resolve(FILE)).href);
    await p.waitForTimeout(1600);
    if (page !== 'home') {
      await p.evaluate(v => { document.querySelector('[x-data]')._x_dataStack[0].activePage = v; }, page);
      await p.waitForTimeout(700);
    }
    const out = `/tmp/corpus-${label}-${theme}.png`;
    await p.screenshot({ path: out });
    console.log(`  ${out}${errs.length ? '   ERRORS: ' + errs.slice(0,2).join(' | ') : ''}`);
    await p.close();
  }
}
await b.close();
