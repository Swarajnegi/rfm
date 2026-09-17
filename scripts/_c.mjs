import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const b = await chromium.launch();
for (const theme of ['light','dark']) {
  const p = await b.newPage({ viewport:{width:390,height:844} });
  await p.addInitScript(([s,t]) => { localStorage.setItem('rfm_v1',s); localStorage.setItem('corpus_tour_v1','x'); localStorage.setItem('rfm_theme',t); }, [readFileSync('scripts/seed.json','utf8'), theme]);
  await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
  await p.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil:'load' });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { document.querySelector('[x-data]')._x_dataStack[0].activePage='regen'; });
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const lum = ([r,g,b]) => { const f=v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
    const parse = s => s.match(/[\d.]+/g).slice(0,3).map(Number);
    const over = (fg, bg) => { const [r,g,b,a=1]=s2(fg); const B=parse(bg); return [r*a+B[0]*(1-a), g*a+B[1]*(1-a), b*a+B[2]*(1-a)]; };
    const s2 = s => s.match(/[\d.]+/g).map(Number);
    const panel = document.querySelector('.sheet--ai');
    const pbg = getComputedStyle(panel).backgroundColor;
    // gradients: sample the painted pixel is not possible here; use the navy base
    const base = [11,24,46];
    const out = [];
    for (const sel of ['.aipanel__title','.aipanel__note','.sheet--ai .btn--brass']) {
      const el = panel.querySelector(sel) || document.querySelector(sel);
      if (!el) { out.push([sel,'(absent)']); continue; }
      const cs = getComputedStyle(el);
      const fg = over(cs.color, `rgb(${base.join(',')})`);
      const bgIsBtn = sel.includes('btn');
      const bg = bgIsBtn ? [230,208,138] : base;
      const L1=lum(fg)+0.05, L2=lum(bg)+0.05;
      out.push([sel, (Math.max(L1,L2)/Math.min(L1,L2)).toFixed(2)+':1']);
    }
    return out;
  });
  console.log(`  ${theme}:`); for (const [k,v] of r) console.log(`    ${k.padEnd(28)} ${v}`);
  await p.close();
}
await b.close();
