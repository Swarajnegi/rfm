// Measures what "inch perfect" actually means, per route, per theme, per data
// state. Opinion does not scale across 13 screens; measurement does.
//
//   node scripts/audit-polish.mjs [--fix-list]
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROUTES = ['home','investments','import','maturity','cashflow','income','goals',
                'emergency','networth','tax','pension','regen','more'];
const seed = readFileSync('scripts/seed.json', 'utf8');
const findings = [];
const add = (kind, route, theme, detail) => findings.push({ kind, route, theme, detail });

// Three widths: the narrowest phone still in scope (minSdk 24 reaches 360dp
// devices), the design target, and a tablet — where a phone layout that simply
// stretches looks broken rather than adapted.
const VIEWPORTS = [
  { w: 360, h: 780, name: '360' },
  { w: 390, h: 844, name: '390' },
  { w: 834, h: 1112, name: 'tablet' },
];

const b = await chromium.launch();
for (const theme of ['light','dark']) {
 for (const vp of VIEWPORTS) {
  if (theme === 'dark' && vp.name !== '390') continue;   // palette is width-independent
  const p = await b.newPage({ viewport: { width: vp.w, height: vp.h } });
  await p.addInitScript(([s,t]) => {
    localStorage.setItem('rfm_v1', s);
    localStorage.setItem('corpus_theme', t);
    localStorage.setItem('corpus_tour_v1','seen');
    localStorage.setItem('rfm_tour_v1','seen');
  }, [seed, theme]);
  await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
  await p.goto(pathToFileURL(path.resolve('web/index.html')).href);
  await p.waitForTimeout(1500);

  for (const route of ROUTES) {
    await p.evaluate(v => { document.querySelector('[x-data]')._x_dataStack[0].activePage = v; }, route);
    await p.waitForTimeout(280);

    const r = await p.evaluate(() => {
      const out = { tap: [], align: [], overflow: [], rhythm: [], clipped: [], garbage: [] };
      const main = [...document.querySelectorAll('main')].find(m => m.offsetParent !== null);
      if (!main) return out;

      // 1. TOUCH TARGETS. Apple HIG says 44pt; anything interactive under that
      //    is a miss, not a style choice.
      for (const el of main.querySelectorAll('button, a, input, select, [role="tab"], label.row')) {
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) continue;         // hidden
        // A control inside a label IS targeted by that label, so the label's
        // box is the real hit area — that is the correct pattern, not a miss.
        const lbl = el.closest('label');
        if (lbl && lbl !== el) {
          const lb = lbl.getBoundingClientRect();
          if (lb.height >= 44 && lb.width >= 44) continue;
        }
        if (b.height < 44 || b.width < 44) {
          out.tap.push(`${el.tagName.toLowerCase()}.${(el.className||'').toString().split(' ')[0]} ${Math.round(b.width)}x${Math.round(b.height)} "${(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,18)}"`);
        }
      }

      // 2. LEFT-EDGE ALIGNMENT. Text that starts at a different x than its
      //    siblings is the single most visible kind of misalignment.
      const lefts = new Map();
      for (const el of main.querySelectorAll('h1,h2,h3,p,span.row__name,.label,.lead')) {
        const b = el.getBoundingClientRect();
        if (b.width < 4 || el.offsetParent === null) continue;
        const x = Math.round(b.left);
        lefts.set(x, (lefts.get(x) || 0) + 1);
      }
      const common = [...lefts.entries()].sort((a,b) => b[1]-a[1]).slice(0,3).map(e => e[0]);
      for (const [x, n] of lefts) {
        if (n <= 1 && !common.some(c => Math.abs(c - x) <= 1)) out.align.push(`x=${x} (1 element, off-grid; common ${common.join(',')})`);
      }

      // 3. HORIZONTAL OVERFLOW — anything wider than the viewport.
      const inScroller = (el) => {
        for (let n = el.parentElement; n && n !== main; n = n.parentElement) {
          const ov = getComputedStyle(n).overflowX;
          if (ov === 'auto' || ov === 'scroll') return true;
        }
        return false;
      };
      for (const el of main.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        if (inScroller(el)) continue;   // a scroller's children are meant to exceed it
        if (b.width > window.innerWidth + 1 || b.right > window.innerWidth + 1 || b.left < -1) {
          const c = (el.className || '').toString().split(' ')[0];
          if (c) out.overflow.push(`${el.tagName.toLowerCase()}.${c} right=${Math.round(b.right)}`);
        }
      }

      // 4. VERTICAL RHYTHM. Gaps between sections should come from the spacing
      //    scale, not from arbitrary values.
      const scale = [4,8,12,16,24,32,48,64];
      const secs = [...main.children].filter(e => e.offsetParent !== null);
      for (let i = 1; i < secs.length; i++) {
        const gap = Math.round(secs[i].getBoundingClientRect().top - secs[i-1].getBoundingClientRect().bottom);
        if (gap > 0 && !scale.some(s => Math.abs(s - gap) <= 1)) out.rhythm.push(`${gap}px between ${secs[i-1].className.split(' ')[0]} and ${secs[i].className.split(' ')[0]}`);
      }

      // 5. GARBAGE VALUES. A single NaN propagating through a getter renders as
      //    "₹NaN" and is invisible to every structural check. This is how the
      //    whole tax screen shipped as NaN for anyone holding one share.
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = (n.textContent || '').trim();
        if (!t) continue;
        if (/\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]|\bnull\b/.test(t)) {
          const host = n.parentElement;
          if (host && host.offsetParent !== null) out.garbage.push(`"${t.slice(0,40)}" in ${host.tagName.toLowerCase()}.${(host.className||'').toString().split(' ')[0]}`);
        }
      }

      // 6. CLIPPED TEXT — an element whose content is wider than its box.
      for (const el of main.querySelectorAll('span,p,h1,h2,h3,input')) {
        if (el.offsetParent === null) continue;
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          const t = (el.value || el.innerText || '').trim().slice(0, 20);
          if (t) out.clipped.push(`${el.tagName.toLowerCase()}.${(el.className||'').toString().split(' ')[0]} "${t}" ${el.scrollWidth}>${el.clientWidth}`);
        }
      }
      return out;
    });

    for (const k of Object.keys(r)) for (const d of new Set(r[k])) add(k, route, `${theme}/${vp.name}`, d);
  }
  await p.close();
 }
}
await b.close();

const byKind = {};
for (const f of findings) (byKind[f.kind] ||= []).push(f);
const LABEL = { tap:'TOUCH TARGET < 44px', align:'OFF-GRID LEFT EDGE', overflow:'HORIZONTAL OVERFLOW',
                rhythm:'OFF-SCALE GAP', clipped:'CLIPPED TEXT', garbage:'GARBAGE VALUE RENDERED' };
let total = 0;
for (const k of ['garbage','overflow','clipped','tap','rhythm','align']) {
  const list = byKind[k] || [];
  if (!list.length) continue;
  // collapse identical detail across themes/routes
  const seen = new Map();
  for (const f of list) {
    const key = f.detail;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(`${f.route}@${f.theme}`);
  }
  console.log(`\n${LABEL[k]}  (${seen.size} distinct)`);
  for (const [detail, routes] of [...seen].slice(0, 14)) {
    console.log(`  ${detail}`);
    console.log(`      on: ${[...routes].join(', ')}`);
  }
  if (seen.size > 14) console.log(`  … ${seen.size - 14} more`);
  total += seen.size;
}
console.log(`\n${total ? total + ' distinct issues' : 'CLEAN'}\n`);
