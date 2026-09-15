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

const SEED = process.argv.includes('--seed');
const themeArg = process.argv.indexOf('--theme');
const THEME = themeArg > -1 ? process.argv[themeArg + 1] : null;   // 'light' | 'dark' | null
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const consoleErrors = [];
const blocked = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

// A populated portfolio, so the checks exercise the real UI rather than only
// the empty state. Written before any script runs.
if (SEED) {
    const { readFileSync } = await import('node:fs');
    const seed = readFileSync('scripts/seed.json', 'utf8');
    const hist = JSON.stringify(Array.from({ length: 30 }, (_, i) => {
        const d = new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10);
        return { date: d, value: Math.round(1520000 + i * 9400 + Math.sin(i / 3) * 42000), source: 'seed' };
    }));
    await page.addInitScript(([blob, h]) => {
        localStorage.setItem('rfm_v1', blob);
        localStorage.setItem('rfm_nw_history', h);
        localStorage.setItem('rfm_usd_inr_rate', '88.41');
        localStorage.setItem('rfm_tour_v1', 'done');   // tour already seen
    }, [seed, hist]);
}

if (THEME) {
    await page.addInitScript(t => localStorage.setItem('rfm_theme', t), THEME);
}

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
const expectPrimary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim());
const expectRgb = 'rgb(' + expectPrimary.split(/\s+/).join(', ') + ')';
ok('Tailwind utilities resolve through tokens', tw.color === expectRgb,
   `text-primary -> ${tw.color} (--c-primary ${expectPrimary})`);
ok('body ground painted', styled.bg !== 'rgba(0, 0, 0, 0)' || /gradient/.test(styled.bgImage), styled.bg);
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

if (SEED) {
    const populated = await page.evaluate(() => ({
        numberFlow: !!document.querySelector('number-flow'),
        // NumberFlow exposes `value` as a getter and renders into shadow DOM whose
        // textContent begins with its own <style> block — so assert on the value
        // and the laid-out width, not on scraped text.
        heroValue: document.querySelector('number-flow')?.value ?? null,
        heroWidth: document.querySelector('number-flow')?.getBoundingClientRect().width ?? 0,
        chartCanvas: !!document.querySelector('#nwChart canvas'),
        holdingRows: document.querySelectorAll('[data-holding-row]').length,
        emptyState: !!document.querySelector('.nw-empty'),
    }));
    ok('hero renders <number-flow>', populated.numberFlow);
    ok('hero has a numeric value', Number.isFinite(populated.heroValue), String(populated.heroValue));
    ok('hero figure is laid out', populated.heroWidth > 40, populated.heroWidth.toFixed(0) + 'px');
    ok('chart drew a canvas', populated.chartCanvas);
    ok('empty state suppressed', !populated.emptyState);
}

// Contrast. A light theme that ships white-on-white is worse than no light
// theme, so measure the real computed colours rather than trusting the tokens.
const contrast = await page.evaluate(() => {
    const lum = (c) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

    // Resolve the effective background by compositing every translucent layer
    // down onto the first opaque one. Treating rgba(x,y,z,0.12) as if it were
    // opaque reports an icon on a 12% tint of its own hue as 1:1, which is
    // nonsense — over paper that tint is nearly white.
    const parse = (c) => {
        const m = (c || '').match(/[\d.]+/g);
        if (!m) return null;
        return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
    };
    const over = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
    });
    const groundOf = (el) => {
        const layers = [];
        let n = el;
        while (n && n !== document.documentElement) {
            const cs = getComputedStyle(n);
            const c = parse(cs.backgroundColor);
            if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
            // A gradient is an opaque-enough ground for contrast purposes; take
            // its first colour stop rather than seeing through it to the page.
            if (cs.backgroundImage && cs.backgroundImage !== 'none') {
                const stop = cs.backgroundImage.match(/rgba?\([^)]+\)/g);
                if (stop) {
                    const g = parse(stop[stop.length - 1]);
                    if (g && g.a > 0.5) { layers.push({ ...g, a: 1 }); break; }
                }
            }
            n = n.parentElement;
        }
        let base = parse(getComputedStyle(document.documentElement).backgroundColor);
        if (!base || base.a < 1) base = { r: 255, g: 255, b: 255, a: 1 };
        // Composite from the bottom layer upward.
        let acc = base;
        for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
        return `rgb(${acc.r}, ${acc.g}, ${acc.b})`;
    };

    const probes = [];
    const sample = [...document.querySelectorAll(
            'main[x-show] p, main[x-show] span, main[x-show] h2, main[x-show] h3, main[x-show] number-flow, main[x-show] button')]
        .filter(e => e.offsetParent !== null &&
                     (e.tagName === 'NUMBER-FLOW' || e.textContent.trim().length > 2))
        .slice(0, 120);
    for (const el of sample) {
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const r = ratio(cs.color, groundOf(el));
        probes.push({ r, size, icon: el.classList.contains('material-symbols-outlined'),
                      text: el.textContent.trim().slice(0, 28) });
    }
    // Icons and large text are non-text / large-text content at 3:1; body text is 4.5:1.
    const need = p => (p.icon || p.size >= 18.66) ? 3.0 : 4.5;
    const failures = probes.filter(p => p.r < need(p));
    const minSize = Math.min(...probes.map(p => p.size));
    const smallest = probes.reduce((a, b) => (b.size < a.size ? b : a), probes[0]);
    return { checked: probes.length, failures: failures.slice(0, 4),
             worst: Math.min(...probes.map(p => p.r)), minSize: smallest.size, smallestText: smallest.text };
});
ok('text meets WCAG AA contrast', contrast.failures.length === 0,
   `${contrast.checked} probes, worst ${contrast.worst.toFixed(2)}:1` +
   (contrast.failures.length ? ` — e.g. "${contrast.failures[0].text}" at ${contrast.failures[0].r.toFixed(2)}:1` : ''));
ok('no text below the 13px floor', contrast.minSize >= 13,
   `smallest rendered ${contrast.minSize}px ("${contrast.smallestText}")`);

const realErrors = consoleErrors.filter(e => !/favicon|Failed to load resource/i.test(e));
ok('no console errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

if (SHOT) { await page.screenshot({ path: SHOT, fullPage: false }); console.log(`\n  screenshot -> ${SHOT}`); }

await browser.close();

console.log(`\n${fail.length ? 'FAILED: ' + fail.join(', ') : 'ALL CHECKS PASSED'}\n`);
process.exit(fail.length ? 1 : 0);
