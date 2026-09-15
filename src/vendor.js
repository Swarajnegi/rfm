// Every third-party runtime the app needs, bundled into web/vendor.js by esbuild.
//
// WHY THIS EXISTS: Tailwind, both Google Fonts, Chart.js and Alpine itself were
// all loaded from CDNs. Alpine is the fatal one — `x-cloak` sits on <body> with
// `[x-cloak]{display:none!important}`, and only Alpine removes it. With no
// network the script never arrives, x-cloak is never stripped, and the app is a
// blank white screen rather than merely an unstyled one.
//
// ORDERING CONTRACT: this bundle exposes Alpine on window but deliberately does
// NOT start it. app.js registers its `alpine:init` listener, and boot.js calls
// Alpine.start() afterwards. Script order in index.html is load-bearing.

import Alpine from 'alpinejs';

import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { SplitText } from 'gsap/SplitText';
import { CustomEase } from 'gsap/CustomEase';

import { createChart, AreaSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import autoAnimate from '@formkit/auto-animate';
import { driver } from 'driver.js';
import 'number-flow';

gsap.registerPlugin(Flip, SplitText, CustomEase);

// The app's motion signature. Defined once so every timeline shares it rather
// than each call site inventing its own easing.
CustomEase.create('ledger', '0.16, 1, 0.3, 1');

window.Alpine = Alpine;
window.gsap = gsap;
window.Flip = Flip;
window.SplitText = SplitText;
window.LW = { createChart, AreaSeries, LineSeries, createSeriesMarkers };
window.autoAnimate = autoAnimate;
window.driver = driver;

// Honour the OS/user reduced-motion preference globally instead of at each
// call site. GSAP reads this once; durations collapse rather than animations
// being skipped, so callbacks and onComplete still fire.
if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.globalTimeline.timeScale(200);
}
