// The single source of truth for which glyphs the icon font must contain.
//
// This list used to be typed by hand on the command line, and twice shipped an
// icon that did not exist in the subset — which does not fail, it renders the
// NAME in 44px capitals ("TRENDING_DOWN") in the middle of the screen. Both
// misses had the same shape: a scan that only understood one way of naming an
// icon. So this reads all three ways the app names one, and `--check` fails the
// build when the vendored font and the markup have drifted apart.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const names = new Set();

// A ternary's CONDITION contains string literals too — `theme === 'dark'` is a
// comparison, not an icon. Only the branches name glyphs, so drop every operand
// of a comparison before reading literals out of the expression.
function branchLiterals(expr) {
  const out = [];
  for (const m of expr.replace(/[=!]==?\s*'[^']*'/g, '').matchAll(/'([a-z][a-z0-9_]{2,})'/g)) out.push(m[1]);
  return out;
}
const html = readFileSync('web/index.html', 'utf8');
const js = readFileSync('web/app.js', 'utf8');

// 1. Literal text inside an icon element: <span class="icon">download</span>
for (const m of html.matchAll(/<span[^>]*class="[^"]*\bicon\b[^"]*"[^>]*>([a-z0-9_]+)<\/span>/g)) {
  names.add(m[1]);
}
// 2. Every string literal inside an x-text on an icon element. This is what the
//    earlier scan missed: `x-text="up ? 'trending_up' : 'trending_down'"` names
//    two icons, and only one of them is ever on screen at a time.
for (const m of html.matchAll(/<span[^>]*class="[^"]*\bicon\b[^"]*"[^>]*\sx-text="([^"]*)"/g)) {
  for (const s of branchLiterals(m[1])) names.add(s);
}
// Same again for elements where x-text precedes class.
for (const m of html.matchAll(/<span[^>]*\sx-text="([^"]*)"[^>]*class="[^"]*\bicon\b[^"]*"/g)) {
  for (const s of branchLiterals(m[1])) names.add(s);
}
// 3. Icons declared in app.js data (SURFACES, attention items, filters). These
//    are invisible to any HTML-only scan — the DONUT_SMALL miss came from here.
for (const m of js.matchAll(/\bicon:\s*'([a-z][a-z0-9_]+)'/g)) names.add(m[1]);

const list = [...names].sort();

if (process.argv.includes('--check')) {
  const css = existsSync('web/fonts.css') ? readFileSync('web/fonts.css', 'utf8') : '';
  const vendored = css.match(/icon_names=([a-z0-9_,]+)/)?.[1]?.split(',') ?? null;
  if (!vendored) {
    // Not a pass. The subset is only recorded by a successful `npm run fonts`,
    // which needs network to Google Fonts — unavailable on some machines. Say so
    // loudly rather than reporting a green check this probe cannot actually make.
    console.log('  CANNOT CHECK — web/fonts.css records no icon subset.');
    console.log('  Run `npm run fonts` on a machine that can reach fonts.googleapis.com;');
    console.log('  until then an icon added to the markup will render as its NAME in capitals.');
    process.exit(0);
  }
  const missing = list.filter(n => !vendored.includes(n));
  if (missing.length) {
    console.error(`  ${missing.length} icon(s) used but not in the font subset: ${missing.join(', ')}`);
    console.error('  these render as their NAME in capitals. Re-run: npm run fonts');
    process.exit(1);
  }
  console.log(`  icons OK — ${list.length} used, all present in the subset`);
} else {
  console.log(list.join(','));
}
