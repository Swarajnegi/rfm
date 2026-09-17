// Left edges, measured.
//
// A statement layout has ONE left margin. The design used to be cards, where
// each panel supplied its own inner padding, and when the panels were removed
// some of that padding stayed behind — so a few blocks sat ~24px further right
// than everything around them. That is invisible in isolation and obvious in a
// column, which is exactly the kind of defect a person reports as "it doesn't
// look properly made" without being able to point at it.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGES = ['home','investments','cashflow','regen','goals','emergency','networth','tax','more'];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.addInitScript(s => { localStorage.setItem('rfm_v1', s); localStorage.setItem('corpus_tour_v1','x'); },
                      readFileSync('scripts/seed.json','utf8'));
await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
await p.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil: 'load' });
await p.waitForTimeout(1300);

let bad = 0;
for (const page of PAGES) {
  await p.evaluate(pg => { document.querySelector('[x-data]')._x_dataStack[0].activePage = pg; }, page);
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const main = [...document.querySelectorAll('main')].find(m => m.offsetParent !== null);
    if (!main) return null;
    const edges = new Map();
    for (const el of main.querySelectorAll('*')) {
      if (el.offsetParent === null) continue;
      // Only leaf-ish text: a wrapper's edge is its child's edge counted twice.
      const txt = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!txt) continue;
      const cs = getComputedStyle(el);
      if (cs.textAlign === 'right' || cs.position === 'absolute') continue;
      const box = el.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;
      // Ignore anything inside a right-aligned figures column or a control.
      if (el.closest('.row__figures, .dock, .appbar, .seg, .bsheet')) continue;
      // Icon glyphs, values and the second column of a grid are SUPPOSED to sit
      // away from the gutter — a probe that flags them reports noise and buries
      // the one real signal. What is being looked for is a BLOCK of text that
      // should start at the gutter and does not, so restrict to block-level
      // elements that are the first in-flow child of their parent.
      if (el.classList.contains('icon')) continue;
      if (el.closest('.row')) continue;
      if (!['block','flex','grid','list-item'].includes(cs.display)) continue;
      // A second grid/flex COLUMN is meant to be away from the gutter, and so is
      // everything inside it — so walk the whole ancestor chain, not just the
      // immediate parent. Checking only the parent let "Out" and "Invested"
      // through, because each is the first child of its own column wrapper.
      let inColumn = false;
      for (let n = el; n && n !== main; n = n.parentElement) {
        const par = n.parentElement; if (!par) break;
        const pd = getComputedStyle(par).display;
        if (!/^(inline-)?(grid|flex)$/.test(pd)) continue;   // inline-flex counts
        const sibs = [...par.children].filter(k => getComputedStyle(k).position !== 'absolute');
        if (sibs.length > 1 && sibs.indexOf(n) > 0) { inColumn = true; break; }
      }
      if (inColumn) continue;
      const x = Math.round(box.left);
      if (!edges.has(x)) edges.set(x, []);
      edges.get(x).push((el.textContent || '').trim().slice(0, 28));
    }
    return [...edges.entries()].sort((a, b) => a[0] - b[0]).map(([x, s]) => [x, s.length, s[0]]);
  });
  if (!r) { console.log(`  SKIP  ${page} (not visible)`); continue; }
  // The gutter is the dominant edge; anything indented past it is suspect.
  const dominant = r.reduce((m, e) => e[1] > m[1] ? e : m, r[0]);
  const strays = r.filter(([x, n]) => x > dominant[0] + 2 && n > 0);
  if (strays.length) {
    bad++;
    console.log(`  FAIL  ${page.padEnd(12)} gutter ${dominant[0]}px, but ${strays.length} edge(s) indented past it:`);
    for (const [x, n, sample] of strays) console.log(`          +${x - dominant[0]}px  x${n}  "${sample}"`);
  } else {
    console.log(`  PASS  ${page.padEnd(12)} all ${r.reduce((s,e)=>s+e[1],0)} text edges on the ${dominant[0]}px gutter`);
  }
}
await b.close();
console.log(bad ? `\n${bad} PAGE(S) MISALIGNED\n` : '\nALIGNMENT OK\n');
process.exit(bad ? 1 : 0);
