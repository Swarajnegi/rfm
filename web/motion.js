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

    // One choke point for the user's on/off preference, rather than a check at
    // each of the six call sites. Read live from storage instead of cached at
    // load, so flipping the switch takes effect on the very next tap without a
    // reload — and so app.js remains the single owner of the setting.
    function hapticsEnabled() {
        try { return localStorage.getItem('corpus_haptics') !== 'off'; } catch (e) { return true; }
    }

    const Haptics = {
        _p: () => (hapticsEnabled() && (activated || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())))
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
        // Starting a transition while one is running ABORTS the old one, and its
        // ready/finished promises reject with "Transition was skipped". Nothing
        // was catching them, so tapping two destinations in quick succession —
        // which people do constantly — produced an unhandled rejection. The
        // abort itself is correct and expected; only the noise is a bug.
        const vt = document.startViewTransition(mutate);
        const swallow = (e) => { if (!e || e.name !== 'AbortError') throw e; };
        vt.ready.catch(swallow);
        vt.finished.catch(swallow);
        vt.updateCallbackDone.catch(swallow);
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
    const TOUR_KEY = 'corpus_tour_v1';

    function buildSteps() {
        const want = [
            ['#nwHero',        'Your corpus',          'Everything you own, minus what you owe. It moves as you add holdings and refresh prices.'],
            ['#navportfolio',  'Your holdings',        'Deposits, funds, stocks and gold live here — add them by hand, or import a CAS or bank statement and Corpus will read it.'],
            ['#navplanning',   'Planning',             'What comes in, what goes out, your goals, your emergency fund and your tax.'],
            ['#syncButton',    'Live prices',          'Pulls NAVs from AMFI and quotes for your stocks. Every figure shows where it came from and when, so you can always tell a live price from yesterday’s close.'],
            ['#navinsights',   'Insights',             'What your own numbers say — and where your backup, theme and this tour live.'],
        ];
        return want
            .filter(([sel]) => document.querySelector(sel))
            .map(([sel, title, description]) => ({ element: sel, popover: { title, description } }));
    }

    function startTour(force) {
        if (!window.driver) return;
        // Only ever runs from Overview: the steps describe that screen, and a
        // tour that fires over a detail view is disorienting rather than helpful.
        const onHome = !!document.querySelector('main[x-show*="\'home\'"]:not([style*="display: none"])');
        if (!force && !onHome) return;
        try { if (!force && localStorage.getItem(TOUR_KEY)) return; } catch (e) {}
        const steps = buildSteps();
        if (steps.length < 2) return;

        const d = window.driver({
            showProgress: true,
            allowClose: true,
            nextBtnText: 'Next',
            prevBtnText: 'Back',
            doneBtnText: 'Got it',
            popoverClass: 'corpus-tour',
            steps,
            onDestroyed() { try { localStorage.setItem(TOUR_KEY, new Date().toISOString()); } catch (e) {} },
            onHighlightStarted() { Haptics.tap(); },
        });
        d.drive();
    }


    /* ── List motion ─────────────────────────────────────────────────────
       AutoAnimate on any container marked [data-animate-list]. Rows added,
       removed or reordered by Alpine's x-for slide instead of snapping, so
       adding a holding or changing a filter reads as a change to the same
       list rather than a different screen. */
    function enhanceLists(root) {
        if (reduced || !window.autoAnimate) return;
        (root || document).querySelectorAll('[data-animate-list]').forEach(el => {
            if (el.__aa) return;
            el.__aa = true;
            try { window.autoAnimate(el, { duration: 220, easing: 'cubic-bezier(0.16,1,0.3,1)' }); } catch (e) {}
        });
    }

    /* ── Insights reveal ─────────────────────────────────────────────────
       The AI section used to go spinner -> wall of text. Cards now land one
       at a time so the eye is led through them, and the headline figure is
       split so it resolves character by character. Purely presentational:
       if GSAP is absent the cards are simply already visible. */
    function revealInsights(scope) {
        if (reduced || !window.gsap) return;
        const root = scope || document;
        const cards = [...root.querySelectorAll('[data-insight-card]')];
        if (!cards.length) return;

        const tl = window.gsap.timeline({ defaults: { ease: 'ledger' } });
        tl.fromTo(cards,
            { opacity: 0, y: 14 },
            { opacity: 1, y: 0, duration: 0.42, stagger: 0.08, clearProps: 'all' });

        const score = root.querySelector('[data-insight-score]');
        if (score && window.SplitText) {
            try {
                const split = new window.SplitText(score, { type: 'chars' });
                tl.from(split.chars, { opacity: 0, y: -8, duration: 0.3, stagger: 0.04 }, 0.1);
            } catch (e) {}
        }
        Haptics.commit();
    }

    /* The app bar takes its rule only when content is behind it. Uses an
       IntersectionObserver on a sentinel rather than a scroll listener, so it
       costs nothing per frame. */
    function watchAppBar() {
        const bar = document.querySelector('.appbar');
        if (!bar || !('IntersectionObserver' in window)) return;

        // Rule: appears as soon as anything is behind the bar.
        const sentinel = document.createElement('div');
        sentinel.setAttribute('aria-hidden', 'true');
        sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;pointer-events:none';
        document.body.prepend(sentinel);
        new IntersectionObserver(
            ([e]) => bar.classList.toggle('is-stuck', !e.isIntersecting),
            { threshold: 0 }
        ).observe(sentinel);

        // Collapse: keyed to the HERO FIGURE leaving, not to scroll position.
        // Tying it to a pixel offset would swap the title in while the figure
        // was still on screen, showing the same number twice.
        let heroObserver = null;
        const watchHero = () => {
            const hero = document.querySelector('#nwHero');
            if (heroObserver) heroObserver.disconnect();
            if (!hero) { bar.classList.remove('is-collapsed'); return; }
            heroObserver = new IntersectionObserver(
                ([e]) => bar.classList.toggle('is-collapsed', !e.isIntersecting),
                { rootMargin: '-56px 0px 0px 0px', threshold: 0 }
            );
            heroObserver.observe(hero);
        };
        watchHero();
        // The hero belongs to one surface, so re-bind whenever the page changes.
        document.addEventListener('corpus:navigated', watchHero);
    }

    window.RFMMotion = { transition, hapticsEnabled, syncSweep, flashValue, enhanceLists, revealInsights, watchAppBar, Haptics, startTour, TOUR_KEY, reduced };

    // Lists appear as pages are visited, so re-scan after Alpine settles.
    document.addEventListener('alpine:initialized', () => {
        watchAppBar();
        enhanceLists();
        setInterval(() => enhanceLists(), 1500);
    });
})();
