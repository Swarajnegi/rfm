// Puts every font the app needs on disk, so it renders with no network.
// Re-runnable: it is the single source of truth for what lives in web/fonts/.
//
// TEXT FACES COME FROM npm, NOT FROM GOOGLE. They used to be fetched from
// fonts.googleapis.com, which makes the build depend on a host that is blocked
// on some machines — and when that fetch failed the script had already emptied
// web/fonts, leaving the app with no typeface at all. @fontsource ships the
// identical upstream binaries as versioned packages, so the build is now
// reproducible and offline. The ICON font is still fetched, because it is
// subset on Google's side to the exact glyphs used (17 KB instead of 1.1 MB)
// and no package offers that; when it cannot be fetched the icon font already
// on disk is preserved rather than discarded.
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const ICONS = process.argv.includes('--icons');
const OUT = 'web/fonts';

// Display carries the money figures, so it is chosen for them: Newsreader's
// figures are TABULAR — every digit the same width — and it has a rupee sign.
// Its predecessor had neither, which made the headline total change width as it
// counted. `opsz` is the optical-size axis: the same face drawn differently for
// a 60px total and a 13px label.
const FACES = [
  { pkg: '@fontsource-variable/newsreader', css: 'opsz.css', family: 'Newsreader' },
  { pkg: '@fontsource-variable/archivo',    css: 'wght.css', family: 'Archivo'    },
];
// Vietnamese is ~32 KB per face for an audience this app does not have.
const SUBSETS = ['latin', 'latin-ext'];

mkdirSync(OUT, { recursive: true });

const staged = [];   // [filename, absolute source path]
let css = '';

for (const face of FACES) {
  const dir = path.join('node_modules', ...face.pkg.split('/'));
  const cssPath = path.join(dir, face.css);
  if (!existsSync(cssPath)) {
    console.error(`  FAIL: ${face.pkg} is not installed. Run npm install.`);
    process.exit(1);
  }
  let block = readFileSync(cssPath, 'utf8');
  const kept = [];
  // Each @font-face names one subset. Keep the ones we ship, drop the rest,
  // and keep upstream's unicode-range so the browser only downloads what a
  // given string actually needs.
  for (const m of block.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    const rule = m[0];
    const file = rule.match(/url\(\.\/files\/([^)]+)\)/)?.[1];
    if (!file) continue;
    if (!SUBSETS.some(s => file.includes(`-${s}-`))) continue;
    kept.push(rule
      .replace(/font-family:\s*'[^']*'/, `font-family: '${face.family}'`)
      .replace(`./files/${file}`, `fonts/${file}`)
      .replace(/font-display:\s*\w+/, 'font-display: swap'));
    staged.push([file, path.join(dir, 'files', file)]);
  }
  if (!kept.length) { console.error(`  FAIL: no subsets matched for ${face.family}`); process.exit(1); }
  css += `/* ${face.family} — ${face.pkg} */\n` + kept.join('\n') + '\n\n';
  for (const [f] of staged.slice(-kept.length)) {
    const kb = readFileSync(path.join(dir, 'files', f)).length / 1024;
    console.log(`  ${f.padEnd(44)} ${kb.toFixed(0)} KB`);
  }
}

// ── Icons ────────────────────────────────────────────────────────────────
const prev = existsSync('web/fonts.css') ? readFileSync('web/fonts.css', 'utf8') : '';
let iconNames = prev.match(/icon_names=([a-z0-9_,]+)/)?.[1] ?? '';
let iconCss = '';

if (ICONS) {
  const names = process.env.ICON_NAMES
    || execFileSync('node', ['scripts/icon-names.mjs'], { encoding: 'utf8' }).trim();
  console.log(`  icon subset: ${names.split(',').length} glyphs`);
  try {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=${names}&display=block`,
                            { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let text = await res.text();
    for (const u of [...new Set([...text.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map(m => m[1]))]) {
      const bin = Buffer.from(await (await fetch(u, { headers: { 'User-Agent': UA } })).arrayBuffer());
      const name = 'icons.woff2';
      writeFileSync(path.join('/tmp', name), bin);
      staged.push([name, path.join('/tmp', name)]);
      text = text.split(u).join(`fonts/${name}`);
      console.log(`  ${name.padEnd(44)} ${(bin.length/1024).toFixed(0)} KB`);
    }
    iconCss = text; iconNames = names;
  } catch (e) {
    console.error(`  icon fetch failed (${e.message}) — keeping the icon font already on disk.`);
  }
}

if (!iconCss) {
  // Preserve what is already there. Losing the icon font because a refresh of
  // the TEXT faces could not reach Google is not an acceptable trade.
  const blocks = [...prev.matchAll(/@font-face\s*\{[^}]*Material Symbols[^}]*\}/g)].map(m => m[0]);
  const alt = [...prev.matchAll(/@font-face\s*\{[^}]*\}/g)].map(m => m[0])
                 .filter(r => /Material Symbols/.test(r));
  iconCss = (blocks.length ? blocks : alt).join('\n');
  for (const f of (iconCss.match(/fonts\/([^)'"]+)/g) || []).map(s => s.replace('fonts/', ''))) {
    if (existsSync(path.join(OUT, f))) staged.push([f, path.join(OUT, f)]);
  }
  if (iconCss) console.log('  icons: preserved the existing subset on disk');
}
if (!iconCss) console.error('  WARNING: no icon font available — icons will render as their names.');

// ── Swap, only now that every byte is in hand ────────────────────────────
const keep = new Set(staged.map(([f]) => f));
for (const f of readdirSync(OUT)) if (!keep.has(f)) unlinkSync(path.join(OUT, f));
for (const [f, src] of staged) if (path.resolve(src) !== path.resolve(OUT, f)) copyFileSync(src, path.join(OUT, f));

writeFileSync('web/fonts.css',
`/* Generated by scripts/vendor-fonts.mjs — do not edit by hand.
   icon_names=${iconNames}
   Text faces vendored from @fontsource (npm). Served from disk so the app
   renders with no network. */\n` + css + iconCss + '\n');
console.log(`\n  ${staged.length} files, fonts.css written, remote urls left: ${((css+iconCss).match(/https:\/\//g)||[]).length}`);
