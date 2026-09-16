// Every modal flag must have a sheet that actually appears, and every sheet
// must close. A handler wired to nothing is a dead end the eye cannot see.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const FLAGS = ['addingInv','addingGoal','addingSip','showNotifications'];
const OPENERS = [['editingInv','openEditModal',0],['editingGoal','openGoalEdit',0],['editingSip','openEditSipModal',0]];
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:844} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(s => { localStorage.setItem('rfm_v1',s); localStorage.setItem('corpus_tour_v1','x'); }, readFileSync('scripts/seed.json','utf8'));
await p.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
await p.goto(pathToFileURL(path.resolve('web/index.html')).href, { waitUntil:'load' });
await p.waitForTimeout(1300);
let bad = 0;
for (const f of FLAGS) {
  const r = await p.evaluate(flag => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    d[flag] = true;
    return new Promise(res => setTimeout(() => {
      const sheet = [...document.querySelectorAll('.bsheet')].find(s => s.offsetParent !== null);
      const visible = !!sheet;
      const label = sheet?.getAttribute('aria-label') || '';
      d[flag] = false;
      setTimeout(() => res({ visible, label,
        closed: ![...document.querySelectorAll('.bsheet')].some(s => s.offsetParent !== null) }), 200);
    }, 400));
  }, f);
  const ok = r.visible && r.closed;
  if (!ok) bad++;
  console.log(`  ${ok?'PASS':'FAIL'}  ${f.padEnd(18)} opens:${r.visible?'y':'N'} closes:${r.closed?'y':'N'}  ${r.label}`);
}
for (const [flag, opener, idx] of OPENERS) {
  const r = await p.evaluate(([flag, opener, idx]) => {
    const d = document.querySelector('[x-data]')._x_dataStack[0];
    const src = opener === 'openGoalEdit' ? d.goalsProgress : opener === 'openEditSipModal' ? d.sips : d.investments;
    if (!src || !src[idx]) return { skip: true };
    d[opener](src[idx]);
    return new Promise(res => setTimeout(() => {
      const sheet = [...document.querySelectorAll('.bsheet')].find(s => s.offsetParent !== null);
      const out = { visible: !!sheet, label: sheet?.getAttribute('aria-label') || '' };
      d[flag] = null;
      res(out);
    }, 400));
  }, [flag, opener, idx]);
  if (r.skip) { console.log(`  SKIP  ${opener} — no seed row`); continue; }
  if (!r.visible) bad++;
  console.log(`  ${r.visible?'PASS':'FAIL'}  ${opener.padEnd(18)} opens:${r.visible?'y':'N'}  ${r.label}`);
}
const real = errs.filter(e => !/favicon/i.test(e));
if (real.length) { bad++; console.log('  FAIL  console:', real[0]); }
await b.close();
console.log(bad ? `\n  ${bad} sheet failures\n` : '\n  ALL SHEETS OK\n');
process.exit(bad?1:0);
