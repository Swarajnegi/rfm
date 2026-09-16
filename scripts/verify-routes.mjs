// Visits every route in both themes with a seeded portfolio AND empty, asserting
// each renders exactly one page with no console error. A screenshot of one
// screen cannot tell you the other twelve are fine.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROUTES = ['home','investments','import','maturity','cashflow','income','goals',
                'emergency','networth','tax','pension','regen','more'];
const seed = readFileSync('scripts/seed.json', 'utf8');
let fails = 0;

const b = await chromium.launch();
for (const theme of ['light','dark']) {
  for (const seeded of [true,false]) {
    const p = await b.newPage({ viewport:{width:390,height:844} });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
    await p.addInitScript(([s,t,on]) => {
      if (on) localStorage.setItem('rfm_v1', s);
      localStorage.setItem('corpus_theme', t);
      localStorage.setItem('rfm_tour_v1','seen');
    }, [seed, theme, seeded]);
    await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await p.goto(pathToFileURL(path.resolve('web/index.html')).href);
    await p.waitForTimeout(1400);

    for (const route of ROUTES) {
      errs.length = 0;
      await p.evaluate(v => { document.querySelector('[x-data]')._x_dataStack[0].activePage = v; }, route);
      await p.waitForTimeout(260);
      const r = await p.evaluate(() => {
        const vis = [...document.querySelectorAll('main')].filter(m => m.offsetParent !== null);
        return { visible: vis.length, height: vis[0]?.getBoundingClientRect().height || 0,
                 text: (vis[0]?.innerText || '').trim().length };
      });
      const bad = errs.filter(e => !/favicon|Failed to load resource/i.test(e));
      const ok = r.visible === 1 && r.height > 40 && r.text > 10 && bad.length === 0;
      if (!ok) { fails++; console.log(`  FAIL ${theme}/${seeded?'seeded':'empty '}/${route.padEnd(12)} visible=${r.visible} h=${Math.round(r.height)} text=${r.text} ${bad[0]||''}`); }
    }
    await p.close();
  }
}
await b.close();
console.log(fails ? `\n  ${fails} route failures\n` : `\n  all ${ROUTES.length} routes x 2 themes x 2 data states OK\n`);
process.exit(fails ? 1 : 0);
