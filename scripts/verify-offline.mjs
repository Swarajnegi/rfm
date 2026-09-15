// Proves the app boots with NO network — the condition that used to leave a
// blank white screen, because Alpine came from a CDN and `x-cloak` on <body>
// is only removed once Alpine initialises.
//
// Every external request is aborted, so anything still reaching for a CDN
// fails the run rather than silently degrading.
//
//   node scripts/verify-offline.mjs [--headed] [--shot path.png]

import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const APP = pathToFileURL(path.resolve('web/index.html')).href;
const shotArg = process.argv.indexOf('--shot');
const SHOT = shotArg > -1 ? process.argv[shotArg + 1] : null;

const fail = [];
const ok = (label, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) fail.push(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const consoleErrors = [];
const blocked = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

// Hard-block anything not on disk. This is the whole point of the test.
await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    blocked.push(url);
    return route.abort();
});

await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(2500); // Alpine init + deferred scripts

console.log('\nOFFLINE BOOT\n');

// Distinguish the two kinds of remote request. ASSETS (scripts, CSS, fonts)
// must be zero — those are what made the app unrenderable offline. LIVE DATA
// (FX rate, quotes) is the app doing its job; it is expected to be attempted
// and to fail gracefully when there is no network.
const isAsset = u => /\.(js|mjs|css|woff2?|ttf|png|jpe?g|svg|ico)(\?|$)/i.test(u)
                  || /fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr/i.test(u);
const assetReqs = blocked.filter(isAsset);
const dataReqs  = blocked.filter(u => !isAsset(u));
ok('zero remote ASSET requests', assetReqs.length === 0,
   assetReqs.length ? assetReqs[0].slice(0, 70) : 'all assets served from disk');
console.log(`  note  ${dataReqs.length} live-data request(s) attempted and blocked (expected): ` +
            (dataReqs[0] ? new URL(dataReqs[0]).host : '-'));

const bodyVisible = await page.evaluate(() => {
    const b = document.body;
    return getComputedStyle(b).display !== 'none' && !b.hasAttribute('x-cloak');
});
ok('body is visible (x-cloak stripped)', bodyVisible, bodyVisible ? '' : 'THE BLANK-SCREEN BUG');

const globals = await page.evaluate(() => ({
    Alpine: typeof window.Alpine,
    gsap: typeof window.gsap,
    Flip: typeof window.Flip,
    LW: typeof window.LW,
    autoAnimate: typeof window.autoAnimate,
    driver: typeof window.driver,
    numberFlow: !!customElements.get('number-flow'),
    appData: !!document.querySelector('[x-data]'),
}));
ok('Alpine started', globals.Alpine === 'function' || globals.Alpine === 'object');
ok('GSAP + Flip present', globals.gsap === 'object' && globals.Flip === 'function' || globals.Flip === 'object');
ok('Lightweight Charts present', globals.LW === 'object');
ok('AutoAnimate present', globals.autoAnimate === 'function');
ok('Driver.js present', globals.driver === 'function');
ok('<number-flow> registered', globals.numberFlow);

// Tailwind must have produced real utilities, not fallen back to nothing.
const styled = await page.evaluate(() => {
    const el = document.querySelector('main[x-show]') || document.body;
    const cs = getComputedStyle(document.body);
    return {
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage,
        font: cs.fontFamily,
        mainCount: document.querySelectorAll('main[x-show]').length,
        visibleMains: [...document.querySelectorAll('main[x-show]')].filter(m => getComputedStyle(m).display !== 'none').length,
        rendered: el.getBoundingClientRect().height > 0,
    };
});
// styles.css sets `background:` as a shorthand with gradients, so
// backgroundColor is legitimately transparent. Probe a generated utility
// instead: if Tailwind compiled, text-primary resolves to the token colour.
const tw = await page.evaluate(() => {
    const p = document.createElement('div');
    p.className = 'text-primary bg-surface-container rounded-2xl';
    document.body.appendChild(p);
    const cs = getComputedStyle(p);
    const out = { color: cs.color, bg: cs.backgroundColor, radius: cs.borderRadius };
    p.remove();
    return out;
});
ok('Tailwind compiled real utilities', tw.color === 'rgb(167, 184, 255)', `text-primary -> ${tw.color}`);
ok('body painted (gradient layer)', /gradient/.test(styled.bgImage), styled.bgImage.slice(0, 40));
ok('webfont applied', /Manrope|Serif/i.test(styled.font), styled.font.split(',')[0]);
ok('exactly one page visible', styled.visibleMains === 1, `${styled.visibleMains} of ${styled.mainCount}`);
ok('content has height', styled.rendered);

// Icons: Material Symbols renders by ligature. If the font is missing the user
// sees the literal word "notifications" instead of a glyph, so check the font
// actually loaded rather than merely that the element exists.
const iconFont = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('24px "Material Symbols Outlined"');
});
ok('icon font loaded (subset)', iconFont, iconFont ? '' : 'icons would render as words');

const realErrors = consoleErrors.filter(e => !/favicon|Failed to load resource/i.test(e));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

if (SHOT) { await page.screenshot({ path: SHOT, fullPage: false }); console.log(`\n  screenshot -> ${SHOT}`); }

await browser.close();

console.log(`\n${fail.length ? 'FAILED: ' + fail.join(', ') : 'ALL CHECKS PASSED'}\n`);
process.exit(fail.length ? 1 : 0);
