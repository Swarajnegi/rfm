// The typography contract, as things that can actually be measured.
//
// The previous display face failed two of these silently. Its figures were
// PROPORTIONAL — "1" is much narrower than "0" — so the headline total changed
// width as it counted, which no screenshot review catches because any single
// screenshot looks fine. And a candidate replacement (Source Serif 4) had no
// rupee sign at all, which would have rendered every figure in this app with a
// missing-glyph box. Both are one measurement each.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 360, height: 844 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(s => { localStorage.setItem('rfm_v1', s); localStorage.setItem('corpus_tour_v1','x'); },
                      readFileSync('scripts/seed.json','utf8'));
await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
await p.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil: 'load' });
await p.waitForTimeout(1300);

let bad = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) bad++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const r = await p.evaluate(async () => {
  await document.fonts.ready;
  // Width of a string in an element's exact rendered typography, measured on a
  // detached span: the live .figure holds a <number-flow> custom element rather
  // than a text node, so mutating it and measuring reports 0.
  const span = (cs, text, extra = '') => {
    const fam = cs.fontFamily;
    const s = document.createElement('span');
    s.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;`
      + `font:${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${fam};`
      + `font-variation-settings:${cs.fontVariationSettings};`
      + `font-variant-numeric:${cs.fontVariantNumeric};letter-spacing:${cs.letterSpacing};${extra}`;
    s.textContent = text;
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width; s.remove(); return w;
  };
  const pick = sel => [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null);

  // Glyph coverage, measured at a deliberately LARGE fixed size with fallbacks
  // removed. Both matter: at the element's real 16px a present rupee and a
  // missing-glyph box differ by only ~0.4px, which is inside the noise, and
  // with the full stack a system font supplies both characters so their widths
  // match exactly. Measured naively, Archivo — which plainly renders the rupee
  // on every row of this app — was reported as missing it.
  const covers = (cs) => {
    const fam = cs.fontFamily.split(',')[0];
    const at = (t) => {
      const s = document.createElement('span');
      s.style.cssText = `position:absolute;visibility:hidden;font:${cs.fontWeight} 100px ${fam}`;
      s.textContent = t;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width; s.remove(); return w;
    };
    return Math.abs(at('\u20B9') - at('\uE000'));
  };

  const fig = pick('.figure'), val = pick('.row__value');
  const fc = fig && getComputedStyle(fig), vc = val && getComputedStyle(val);
  const out = { faces: [...new Set([...document.fonts].map(f => `${f.family}:${f.status}`))] };

  if (fc) {
    out.figFamily = fc.fontFamily.split(',')[0].replace(/['"]/g, '');
    out.figTab = Math.abs(span(fc, '1111') - span(fc, '0000'));
    // A present glyph and a missing one do not render at the same width.
    out.figRupee = covers(fc);
    // The widest realistic corpus: ₹123 crore, with Indian 2,2,3 grouping.
    const holder = fig.parentElement.getBoundingClientRect().width;
    out.widest = span(fc, '₹1,23,45,67,890');
    out.holder = holder;
  }
  if (vc) {
    out.valFamily = vc.fontFamily.split(',')[0].replace(/['"]/g, '');
    out.valTab = Math.abs(span(vc, '1111') - span(vc, '0000'));
    out.valRupee = covers(vc);
  }
  // Axes declared for a face that does not have them are dead declarations.
  out.leaked = [...document.querySelectorAll('*')].filter(e => {
    if (e.offsetParent === null) return false;
    const c = getComputedStyle(e);
    if (c.fontVariationSettings === 'normal') return false;
    const fam = c.fontFamily.split(',')[0].replace(/['"]/g, '');
    const axes = c.fontVariationSettings.match(/'(\w+)'/g) || [];
    if (fam === 'Archivo') return axes.some(a => a !== "'wght'" && a !== "'wdth'");
    return false;
  }).length;
  return out;
});

ok('display face loaded', r.faces.some(f => f.startsWith('Newsreader') && f.endsWith('loaded')), r.faces.join(' | '));
ok('headline figures are tabular', r.figTab < 0.5,
   `${r.figFamily}: "1111" vs "0000" differ by ${r.figTab.toFixed(1)}px${r.figTab < 0.5 ? '' : ' — the total changes width as it counts'}`);
ok('headline face has a rupee sign', r.figRupee > 0.5,
   r.figRupee > 0.5 ? r.figFamily : `${r.figFamily} renders ₹ as a missing glyph`);
ok('value figures are tabular', r.valTab < 0.5, `${r.valFamily}: differ by ${r.valTab.toFixed(1)}px`);
ok('value face has a rupee sign', r.valRupee > 0.5, r.valFamily);
ok('₹123 crore still fits at 360px', r.widest <= r.holder + 0.5,
   `${r.widest.toFixed(0)}px of ${r.holder.toFixed(0)}px`);
ok('no display axes leaked onto UI text', r.leaked === 0, `${r.leaked} element(s)`);
ok('no console errors', errs.length === 0, errs.join(' | '));

await b.close();
console.log(bad ? `\n${bad} FAILURE(S)\n` : '\nTYPE OK\n');
process.exit(bad ? 1 : 0);
