/* Interaction layer: page transitions, the price-sync sweep, haptics and the
   first-run tutorial. Kept out of app.js because none of it is business logic —
   app.js owns what the numbers ARE, this owns how a change is communicated.

   Everything here degrades to a no-op rather than throwing: on a desktop browser
   there is no Haptics bridge, and on an older WebView there is no View
   Transition API. The app must work identically without either. */

(function () {
    'use strict';

    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ── Haptics ─────────────────────────────────────────────────────────
       Capacitor only. Silent on web. Deliberately sparse: a phone that
       buzzes at everything is worse than one that never does, so this fires
       on committed actions, not on every tap. */
    // The Web fallback uses navigator.vibrate, which browsers refuse until the
    // user has interacted with the frame — it logs a console warning if called
    // before then. Track activation and stay silent until it happens.
    let activated = false;
    for (const evt of ['pointerdown', 'keydown', 'touchstart']) {
        window.addEventListener(evt, () => { activated = true; }, { once: true, passive: true });
    }

    const Haptics = {
        _p: () => (activated || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()))
                  ? (window.AppPlugins && window.AppPlugins.Haptics) : null,
        tap()     { try { this._p() && this._p().impact({ style: 'Light'  }); } catch (e) {} },
        commit()  { try { this._p() && this._p().impact({ style: 'Medium' }); } catch (e) {} },
        success() { try { this._p() && this._p().notification({ type: 'SUCCESS' }); } catch (e) {} },
        warn()    { try { this._p() && this._p().notification({ type: 'WARNING' }); } catch (e) {} },
    };

    /* ── Page transitions ────────────────────────────────────────────────
       The View Transition API does the cross-fade natively at compositor
       speed. Where it is unavailable we fall back to a short GSAP fade so
       the change still reads as a transition rather than a jump cut. */
    function transition(mutate) {
        if (reduced || typeof document.startViewTransition !== 'function') {
            mutate();
            if (!reduced && window.gsap) {
                const el = document.querySelector('main[x-show]:not([style*="display: none"])');
                if (el) window.gsap.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.22, ease: 'ledger' });
            }
            return;
        }
        document.startViewTransition(mutate);
    }

    /* ── The price-sync sweep ────────────────────────────────────────────
       The signature moment, and it is not decoration: it is the honesty
       mechanism. A highlight travels down the rows that actually changed,
       so a sync that updated 3 of 11 holdings LOOKS like a sync that
       updated 3 of 11 holdings instead of a spinner that said "done". */
    function syncSweep(rowSelector) {
        if (reduced || !window.gsap) return;
        const rows = [...document.querySelectorAll(rowSelector || '[data-holding-row]')]
            .filter(r => r.offsetParent !== null);
        if (!rows.length) return;

        window.gsap.fromTo(rows,
            { '--sweep': 0 },
            {
                '--sweep': 1,
                duration: 0.42,
                ease: 'ledger',
                stagger: { each: 0.035, from: 'start' },
                onStart() { Haptics.tap(); },
                clearProps: '--sweep',
            });
    }

    /* Pulses a single figure that changed. Used per-row after a quote lands. */
    function flashValue(el, direction) {
        if (!el || reduced || !window.gsap) return;
        const up = direction >= 0;
        window.gsap.fromTo(el,
            { color: up ? '#6ee7b7' : '#fca5a5' },
            { color: '', duration: 1.1, ease: 'power2.out' });
    }

    /* ── First-run tutorial ──────────────────────────────────────────────
       Driver.js. Deliberately short and anchored to real controls: a long
       walkthrough of a portfolio the user has not built yet is the pattern
       everyone skips. Steps that point at absent elements are dropped
       rather than shown against nothing. */
    const TOUR_KEY = 'rfm_tour_v1';

    function buildSteps() {
        const want = [
            ['#nwHero',        'Your net worth',       'Everything you own, minus what you owe. It updates as you add holdings and sync prices.'],
            ['#navPortfolio',  'Your holdings',        'Add fixed deposits, mutual funds, stocks and gold here — or import a CAS or bank statement instead of typing them in.'],
            ['#navPlanning',   'Planning',             'Goals, SIPs, emergency fund and tax sit here.'],
            ['#syncButton',    'Live prices',          'Pulls NAVs from AMFI and quotes for your stocks. Every figure shows where it came from and when, so you can always tell a live price from yesterday’s close.'],
            ['#navMore',       'Everything else',      'Import, insights and settings. You can replay this tour from here any time.'],
        ];
        return want
            .filter(([sel]) => document.querySelector(sel))
            .map(([sel, title, description]) => ({ element: sel, popover: { title, description } }));
    }

    function startTour(force) {
        if (!window.driver) return;
        try { if (!force && localStorage.getItem(TOUR_KEY)) return; } catch (e) {}
        const steps = buildSteps();
        if (steps.length < 2) return;

        const d = window.driver({
            showProgress: true,
            allowClose: true,
            nextBtnText: 'Next',
            prevBtnText: 'Back',
            doneBtnText: 'Got it',
            popoverClass: 'rfm-tour',
            steps,
            onDestroyed() { try { localStorage.setItem(TOUR_KEY, new Date().toISOString()); } catch (e) {} },
            onHighlightStarted() { Haptics.tap(); },
        });
        d.drive();
    }

    window.RFMMotion = { transition, syncSweep, flashValue, Haptics, startTour, TOUR_KEY, reduced };
})();
