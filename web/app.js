document.addEventListener('alpine:init', () => {
    Alpine.data('appData', () => ({

        // ── UI State ────────────────────────────────────────────────
        // Backing field. activePage stays a plain property to every binding and
        // every `activePage = 'x'` call site in index.html, but the setter funnels
        // all ~30 of those writes through one place so the page change can be
        // wrapped in a View Transition without touching a single call site.
        // Alpine 3's reactive() preserves accessor descriptors, so this stays
        // reactive: x-show reads the getter and is tracked normally.
        _activePage: 'home',

        get activePage() { return this._activePage; },
        set activePage(next) {
            if (next === this._activePage) return;
            const apply = () => {
                this._activePage = next;
                // Lets the interaction layer re-bind observers that are scoped to
                // a single surface, without app.js knowing what those are.
                document.dispatchEvent(new CustomEvent('corpus:navigated', { detail: next }));
                try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
            };
            // Chart creation runs AFTER the transition has settled, never inside it.
            // Lightweight Charts builds a canvas and measures its container; doing that
            // during a View Transition's capture deadlocked the renderer — the page kept
            // painting but stopped running script, so leaving Home and returning could
            // freeze the app. It reproduced 4 times out of 4, and disabling EITHER the
            // transition or the chart cleared it, which is what identified the pair.
            const afterward = () => {
                if (next === 'home') this.$nextTick(() => this.renderNwChart());
            };
            // No haptic here on purpose. Feedback belongs on COMMITTED actions —
            // saving, syncing, confirming — not on moving between pages, which a
            // person does dozens of times a minute.
            if (window.RFMMotion) window.RFMMotion.transition(apply, afterward);
            else { apply(); afterward(); }
        },

        showNotifications: false,

        // ── Data Stores ─────────────────────────────────────────────
        investments: [],

        // ── Net Worth History (daily valuation snapshots) ────────────
        nwHistory: [],   // [{ date: 'YYYY-MM-DD', capturedAt, value, source }]

        // Pension is the single source of truth for pension income
        // (Engineering Principle #008: No Data Duplication)
        // Starts at 0. A seeded 56000 meant a brand-new user opened the app to a pension
        // they had never entered, and Home derived a cash runway from it — a figure the
        // app invented about someone's finances. Existing users are unaffected: saveData
        // always writes this key, so a saved value overrides the default on load.
        pension: {
            monthlyAmount: 0,
            type: 'Government', // Government | Corporate | Military | Other
            revisions: []       // { date, previousAmount, note }
        },

        cashflow: {
            incomes: [
                { id: 'inc_salary', name: 'Monthly Salary', amount: 0, category: 'Salary' },
                { id: 'inc_consulting', name: 'Consulting / Freelance', amount: 0, category: 'Projects' }
            ],
            expenses: [
                { id: 'exp_housing', name: 'Rent & Housing', amount: 0, category: 'Housing' },
                { id: 'exp_food', name: 'Food & Groceries', amount: 0, category: 'Food' },
                { id: 'exp_personal', name: 'Personal & Lifestyle', amount: 0, category: 'Personal' }
            ],
            sipOverride: null, // Custom monthly SIP outflow override if desired
            // Legacy fallbacks
            project: 0,
            otherIncome: 0,
            housing: 0,
            food: 0,
            medical: 0,
            otherExpense: 0
        },

        networth: {
            bank: 0, cash: 0, property: 0, otherAsset: 0,
            homeLoan: 0, personalLoan: 0, credit: 0, otherDebt: 0
        },

        // efMonthly starts at 0 for the same reason. efMonths is a target, not a claim
        // about the user's money, so 6 is kept as a neutral starting recommendation.
        emergency: {
            efMonthly: 0, efMonths: 6, efCurrent: 0
        },

        // ── Tax Data Store (Phase 3) ─────────────────────────────
        tax: {
            // Inputs
            // Salary is SEPARATE from other income because the standard deduction under
            // Sec 16(ia) is allowed against salary and pension only — not against rent,
            // interest or consulting. One combined field made that impossible to compute,
            // and the app was granting the deduction against every rupee of gross.
            salaryIncome:     0,    // Annual salary — qualifies for the standard deduction
            otherIncome:      0,    // Rent, consulting, anything that does NOT qualify
            deduction80C:     0,    // LIC, PPF, ELSS, NSC, home loan principal (max ₹1.5L)
            deduction80D:     0,    // Medical insurance premium (max ₹50K senior)
            deduction80TTA:   0,    // Savings account interest (max ₹10K, not for seniors)
            deduction80TTB:   0,    // Bank/PO/FD interest for seniors (max ₹50K)
            hra:              0,    // House Rent Allowance exemption
            homeLoanInterest: 0,    // Section 24 interest deduction (max ₹2L)
            otherDeductions:  0,    // Any other eligible deductions
            // Gains BOOKED this financial year, i.e. actually sold. Not derivable from a
            // holdings list — see the capital gains engine below.
            realizedEquityLTCG: 0,  // Equity/equity-MF units held > 12 months, then sold
            realizedEquitySTCG: 0,  // Equity/equity-MF units held ≤ 12 months, then sold
            regime:          'compare', // 'old' | 'new' | 'compare'
            // Defaults to false. The app was built for a 60+ user, so this was seeded true;
            // for a general release most users are not, and a wrong value silently changes
            // the slabs and unlocks 80TTB. Existing users keep their saved setting.
            seniorCitizen:    false, // Age 60+ — different slabs & deductions apply
            capitalGainsOverride: null // Manual override for total capital gains tax
        },

        goals: [],

        // ── The person (asked once, on first open) ──────────────────
        /* Everything the AI says is judged against this. Without it every
           reading was written for one imagined reader, a young equity investor.
           Persisted inside rfm_v1, so backup and restore carry it. */
        profile: {
            name: '', age: null, goal: null, risk: null, payout: null, horizon: null,
            interests: [], completedAt: null, skippedAt: null,
        },
        onboarding: { open: false, step: 0, draft: null, editing: false },

        // ── The daily brief (the card under the AI card) ─────────────
        daily: { brief: null, loading: false, error: '' },

        // ── SIP & Recurring Investments (Phase 9) ───────────────────
        sips: [],
        addingSip: false,
        editingSip: null,
        editSipForm: {},

        // ── Investment Edit State (Deliverable 1) ───────────────────
        editingInv: null,
        editForm: {},
        addingInv: false,
        addingGoal: false,

        // ── Topping up a holding you already own ────────────────────
        // You say what you SPENT; the app works out the units and the new
        // average, because that is arithmetic it already has the price for.
        addingLot: null,                              // the holding being topped up
        lotForm: { amount: '', timing: 'market' },    // 'market' | 'offhours'
        lotError: '',

        // Haptics are a preference, not a fact about the device. Persisted
        // separately from the portfolio blob so a restore cannot clobber it.
        haptics: (function () {
            try { return localStorage.getItem('corpus_haptics') !== 'off'; } catch (e) { return true; }
        })(),
        moreMenuOpen: false,

        // ── Goal Edit State (Deliverable 3) ─────────────────────────
        editingGoal: null,
        editGoalForm: {},

        // ── Add Forms ───────────────────────────────────────────────
        newInv: {
            name: '', type: 'Bank FD', issuer: '', amount: '',
            rate: '', payout: 'Monthly', rating: '', maturityDate: '',
            ticker: '', units: '', buyPrice: '', currentPrice: '',
            purchaseDate: '', assetClass: 'equity', schemeCode: ''
        },
        newGoal: {
            name: '', type: 'Emergency Fund',
            target: '', current: '', targetDate: ''
        },
        newSip: {
            name: '', type: 'SIP', monthlyAmount: '',
            dayOfMonth: 5, startDate: '', endDate: '',
            status: 'Active', linkedInvestmentId: null, ticker: '',
            schemeCode: ''
        },

        // ── SIP Modal MF Autocomplete State ───────────────────────────────
        sipMfSearch: {
            query: '',
            results: [],
            loading: false,
            show: false,
            _timer: null
        },

        // ── Internal chart instances (not reactive state) ────────────
        // They live on window._rfmNw, not on `this`. Alpine wraps anything
        // assigned to the component in a reactive Proxy, and a Lightweight
        // Charts object read back through that Proxy fails its own internal
        // identity checks — it throws "Value is null" out of the renderer, twice
        // per paint, with a stack entirely inside the minified bundle and no
        // mention of this file. Keep chart handles off the component.

        // ── Phase 11: Live NAV & Stock Price Ingestion ──────────────
        navFetchState: 'idle', // 'idle' | 'fetching' | 'done' | 'error'
        navFetchError: '',
        lastNavFetchTime: null,
        navFetchProgress: { completed: 0, total: 0, updated: 0, failed: 0 },
        syncDetailOpen: false,   // the partial-failure banner starts collapsed
        mfSearchResults: [],
        isSearchingMf: false,
        mfSearchQuery: '',

        // ── Phase 12: Native Local Notifications ─────────────────────
        alertsState: 'idle',      // 'idle' | 'scheduling' | 'scheduled' | 'error' | 'unsupported'
        alertsError: '',
        scheduledAlertsCount: 0,
        notifPermissionGranted: false,

        // ── Import State (Phase 5) ───────────────────────────────────
        importState: 'idle',
        importFile: null,
        importPassword: '',
        pdfPassword: '',
        importError: '',
        importResults: null,
        importSelections: {},
        importDuplicateMode: 'skip',
        importStats: null,

        // ── Smart Portfolio Diff State (Groww & AI Portfolio Ingestion) ─
        statementDiff: {
            active: false,
            category: 'Mutual Fund',
            broker: 'Groww',
            asOfDate: '',
            investor: { name: '', pan: '', mobile: '' },
            summary: { totalInvested: 0, currentValue: 0, profitLoss: 0, xirr: 0 },
            aiMessage: '',
            matched: [],
            newItems: [],
            omitted: []
        },

        // ── Regenerative Wealth State ────────────────────────────────
        regenWealth: {
            loading:      false,
            progressMsg:  '',
            error:        '',
            analysis:     null   // The cached/live analysis result object
        },

        // ── Pull-to-Refresh Gesture State ─────────────────────────────
        pullToRefresh: {
            distance: 0,
            isRefreshing: false,
            completed: false,
            thresholdReached: false
        },

        // ── Phase 14: Real-Time US & Global Stocks Live FX Engine ─────
        // null until a real rate is fetched or restored from cache. Never seed a made-up
        // number here: a wrong rate scales the ENTIRE US book at once, which reads as a
        // uniform "prices are off" rather than as a missing rate.
        usdInrRate: null,
        usdInrAsOf: null,
        // Last-resort placeholder, used only when no provider and no cache can supply a
        // rate. Surfaced as "estimated" wherever it is used — never presented as real.
        // Checked 2026-09-18 against open.er-api.com and exchangerate-api: the live rate
        // was 95.96 while this constant still said 88.0, so a total provider outage was
        // understating the entire US book by ~9%. It will drift again — that is the nature
        // of a hardcoded rate — which is why fxIsEstimated exists and why every figure
        // derived from it is labelled rather than shown as fact.
        FX_FALLBACK_USD_INR: 95.96,
        FX_MAX_AGE_MS: 12 * 60 * 60 * 1000,
        // ── HTTP ────────────────────────────────────────────────────
        // One GET path for every price/FX provider. On Android CapacitorHttp runs the
        // request natively and is therefore not subject to CORS, so the caller can hit
        // the real endpoint directly. In a browser it degrades to fetch(), which is why
        // the stock path still needs its proxy list there.
        get canUseNativeHttp() {
            return !!(window.AppPlugins?.CapacitorHttp && window.AppPlugins?.Capacitor?.isNativePlatform?.());
        },

        // Resolve with the first task that succeeds; reject only if all fail. Hand-rolled
        // rather than Promise.any because that needs Chrome 85+ and minSdk is 24, where a
        // device with an un-updated Android System WebView would throw at runtime.
        firstSuccessful(tasks) {
            return new Promise((resolve, reject) => {
                let pending = tasks.length;
                let settled = false;
                let lastError = null;
                if (!pending) return reject(new Error('No price provider responded.'));
                tasks.forEach(task => {
                    Promise.resolve().then(task).then(
                        value => { if (!settled) { settled = true; resolve(value); } },
                        error => {
                            lastError = error;
                            if (--pending === 0 && !settled) {
                                reject(lastError || new Error('No price provider responded.'));
                            }
                        }
                    );
                });
            });
        },

        async httpGetJson(url, timeoutMs = 3000) {
            if (this.canUseNativeHttp) {
                const res = await Promise.race([
                    window.AppPlugins.CapacitorHttp.get({
                        url,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
                            'Accept': 'application/json, text/plain, */*'
                        },
                        readTimeout: timeoutMs,
                        connectTimeout: timeoutMs
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), timeoutMs + 500))
                ]);
                if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
                return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
            }
            return this.fetchJsonWithTimeout(url, timeoutMs);
        },

        /* ── Relays ─────────────────────────────────────────────────────────
           Yahoo sends no CORS header, so a browser cannot call it directly. It also
           now answers 429 "Too Many Requests" to any client that does not send a
           browser User-Agent — which is why the NATIVE path works (CapacitorHttp sets
           one from native code) and the browser path cannot.

           The two public relays this used to race are both gone as of 2026-09-18:
           corsproxy.io answers 401 `keyless_legacy_url` ("anonymous legacy proxy URLs
           are no longer supported") and allorigins returns 5xx. That is why stock
           prices stopped syncing in the browser entirely — Indian as well as US, though
           US is where it shows first because those are the holdings people watch.

           r.jina.ai still works keyless and sends CORS, but it returns the document as
           TEXT with a "Title: / URL Source: / Markdown Content:" preamble, so the JSON
           has to be recovered from the body rather than parsed straight off. */
        PRICE_RELAYS: [
            { url: t => `https://r.jina.ai/${t}`,                                       loose: true  },
            { url: t => `https://api.allorigins.win/raw?url=${encodeURIComponent(t)}`,  loose: false },
        ],

        /* Pulls the JSON object out of a text response. A relay that wraps the payload
           in prose would otherwise fail JSON.parse on the first character. */
        _looseJson(text) {
            if (text && typeof text === 'object') return text;
            const t = String(text || '');
            const i = t.indexOf('{'), j = t.lastIndexOf('}');
            if (i < 0 || j <= i) throw new Error('Relay returned no JSON.');
            return JSON.parse(t.slice(i, j + 1));
        },

        async httpGetText(url, timeoutMs = 8000) {
            if (this.canUseNativeHttp) {
                const res = await window.AppPlugins.CapacitorHttp.get({
                    url, headers: { 'Accept': 'text/plain, application/json, */*' },
                    readTimeout: timeoutMs, connectTimeout: timeoutMs
                });
                if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
                return res.data;
            }
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
            try {
                const r = await fetch(url, controller ? { signal: controller.signal } : undefined);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return await r.text();
            } finally { if (timer) clearTimeout(timer); }
        },

        /* The browser build (the iPhone home-screen app) cannot call these sources
           directly — no CORS headers. It used to race two free public relays, which
           rate-limited a second research pass to nothing and passed every ticker the
           user holds through strangers' servers. Our own gateway now forwards to an
           allowlist of exactly these sources; the public relays remain only as a
           fallback. Null on native, where the app fetches directly. */
        get marketProxy() {
            if (this.canUseNativeHttp) return null;
            const ai = String(window.CorpusAiConfig?.endpoint || '');
            return /^https:\/\//.test(ai) ? ai.replace(/\/v1\/[^/]+$/, '/v1/market?u=') : null;
        },

        _viaProxy(targetUrl) {
            return this.marketProxy ? [() => this.marketProxy + encodeURIComponent(targetUrl)] : [];
        },

        /* Native goes straight to the source with a real User-Agent — one request, no
           relay. The browser goes through our gateway, then the relays. */
        async fetchMarketJson(targetUrl, timeoutMs = 8000) {
            if (this.canUseNativeHttp) return this.httpGetJson(targetUrl, timeoutMs);
            const viaGateway = this._viaProxy(targetUrl).map(u => async () =>
                JSON.parse(await this.httpGetText(u(), timeoutMs + 1000)));
            // Sequenced, not raced: the gateway is ours and usually answers; a
            // relay is only worth a request when it has not.
            try { if (viaGateway.length) return await viaGateway[0](); } catch (_) { /* fall back */ }
            return this.firstSuccessful(this.PRICE_RELAYS.map(relay => async () => {
                const body = await this.httpGetText(relay.url(targetUrl), timeoutMs + 1000);
                return relay.loose ? this._looseJson(body)
                                   : (typeof body === 'string' ? JSON.parse(body) : body);
            }));
        },

        // AMFI's official complete NAV report is a text file, not JSON. Keep this
        // transport beside fetchMarketJson so Android uses CapacitorHttp (and the
        // web build uses the same CORS relays) rather than silently falling back to
        // a WebView fetch that cannot reach the source.
        async fetchMarketText(targetUrl, timeoutMs = 8000) {
            if (this.canUseNativeHttp) return this.httpGetText(targetUrl, timeoutMs);
            if (this.marketProxy) {
                try { return await this.httpGetText(this.marketProxy + encodeURIComponent(targetUrl), timeoutMs + 1000); }
                catch (_) { /* fall back to the relays */ }
            }
            return this.firstSuccessful(this.PRICE_RELAYS.map(relay =>
                () => this.httpGetText(relay.url(targetUrl), timeoutMs + 1000)
            ));
        },

        // ── USD/INR ─────────────────────────────────────────────────
        // SINGLE source of truth. Nine call sites previously each carried their own
        // hardcoded fallback (95.74, 86.5, 95.76, and a 1 in regenWealth.js), so the
        // same holding could be valued differently on different screens — 95.74 vs 86.5
        // is a 10.7% spread. Everything now reads fxUsdInr, and when no real rate is
        // available the value is flagged as estimated instead of silently guessed.
        get fxUsdInr() {
            const r = Number(this.usdInrRate);
            return (Number.isFinite(r) && r > 50 && r < 150) ? r : this.FX_FALLBACK_USD_INR;
        },

        get fxIsEstimated() {
            const r = Number(this.usdInrRate);
            return !(Number.isFinite(r) && r > 50 && r < 150);
        },

        get fxIsStale() {
            if (this.fxIsEstimated) return true;
            if (!this.usdInrAsOf) return true;
            return (Date.now() - new Date(this.usdInrAsOf).getTime()) > this.FX_MAX_AGE_MS;
        },

        get fxLabel() {
            if (this.fxIsEstimated) return `₹${this.fxUsdInr.toFixed(2)} (estimated — no rate available)`;
            if (this.fxIsStale)    return `₹${this.fxUsdInr.toFixed(2)} · ${this.formatDate(this.usdInrAsOf)} (stale)`;
            return `₹${this.fxUsdInr.toFixed(2)}`;
        },

        loadCachedFxRate() {
            try {
                const raw = localStorage.getItem('rfm_usd_inr_rate');
                if (!raw) return;
                // Accept both the new {rate, ts} shape and the bare number written by older builds.
                const parsed = raw.trim().startsWith('{') ? JSON.parse(raw) : { rate: Number(raw), ts: null };
                const rate = Number(parsed.rate);
                if (Number.isFinite(rate) && rate > 50 && rate < 150) {
                    this.usdInrRate  = Number(rate.toFixed(2));
                    this.usdInrAsOf  = parsed.ts || null;
                }
            } catch (e) { /* corrupt cache → treat as absent */ }
        },

        async fetchUsdInrRate() {
            this.loadCachedFxRate();

            const providers = [
                { url: 'https://open.er-api.com/v6/latest/USD',                    pick: d => d?.rates?.INR },
                { url: 'https://api.frankfurter.app/latest?from=USD&to=INR',       pick: d => d?.rates?.INR },
                { url: 'https://api.exchangerate-api.com/v4/latest/USD',           pick: d => d?.rates?.INR },
                { url: 'https://query1.finance.yahoo.com/v8/finance/chart/INR=X',  pick: d => d?.chart?.result?.[0]?.meta?.regularMarketPrice },
            ];

            // Previously four sequential bare fetch() calls with NO timeout, so a provider
            // that hung (rather than failed) hung the entire sync with the spinner up.
            for (const p of providers) {
                try {
                    const rate = Number(p.pick(await this.httpGetJson(p.url, 2500)));
                    if (Number.isFinite(rate) && rate > 50 && rate < 150) {
                        this.usdInrRate = Number(rate.toFixed(2));
                        this.usdInrAsOf = new Date().toISOString();
                        localStorage.setItem('rfm_usd_inr_rate', JSON.stringify({ rate: this.usdInrRate, ts: this.usdInrAsOf }));
                        return this.usdInrRate;
                    }
                } catch (e) { /* try the next provider */ }
            }

            return this.usdInrRate;
        },

        // ════════════════════════════════════════════════════════════
        //  LIFECYCLE
        // ════════════════════════════════════════════════════════════
        init() {
            this.loadData();
            this.initCapacitor();
            this.fetchUsdInrRate();
            this.syncNativeChrome();
            this.loadVisit();
            // Stamp on the way out — visibilitychange fires on Android when the
            // app is backgrounded, where 'beforeunload' does not.
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') this.recordVisit();
                // An app left open overnight is still owed today's brief.
                else this.maybeRunDaily();
            });
            window.addEventListener('pagehide', () => this.recordVisit());
            if (!this._visit.at) setTimeout(() => this.recordVisit(), 4000);

            // Tutorial is available on demand from Insights/Settings.
            // Schedule alerts only if explicitly opted in
            if (localStorage.getItem('corpus_alerts_enabled') === 'true') {
                setTimeout(() => {
                    this.scheduleMaturityAlerts().catch(e => console.warn('[Phase 12] Initial alerts schedule failed:', e));
                }, 4000);
            }
            let hadHoldings = this.investments.length > 0;
            this.$watch('investments',  () => {
                this.saveData();
                this.queueNwSnapshot('portfolio-change');
                // The first holding changes what today's brief can say.
                const has = this.investments.length > 0;
                if (has && !hadHoldings) setTimeout(() => this.maybeRunDaily(), 1500);
                hadHoldings = has;
            }, { deep: true });
            this.$watch('cashflow',     () => this.saveData(), { deep: true });
            this.$watch('networth',     () => {
                this.saveData();
                this.queueNwSnapshot('balance-change');
            }, { deep: true });
            this.$watch('emergency',    () => this.saveData(), { deep: true });
            this.$watch('tax',          () => this.saveData(), { deep: true });
            this.$watch('goals',        () => this.saveData(), { deep: true });
            this.$watch('pension',      () => this.saveData(), { deep: true });
            this.$watch('sips',         () => this.saveData(), { deep: true });
            this.$watch('profile',      () => this.saveData(), { deep: true });
            if (this.shouldAskProfile) this.openOnboarding();
            // ITR checklist state (UI-only, not persisted)
            this.itrCheckState = {};

            // Corpus now uses the managed AI service. Remove legacy user-supplied
            // credentials rather than silently retaining an old key on device.
            ['rfm_api_key', 'rfm_gemini_key', 'rfm_api_provider', 'rfm_api_model', 'rfm_api_custom_model']
                .forEach(key => localStorage.removeItem(key));
            const cached = window.RegenWealth?.loadCached(this.$data);
            if (cached) this.regenWealth.analysis = cached;
            if (window.RegenWealth?.hasPending?.()) {
                this.regenWealth.loading = true;
                window.RegenWealth.recoverPending(msg => { this.regenWealth.progressMsg = msg; })
                    .then(result => { if (result) this.regenWealth.analysis = result; })
                    .catch(error => { this.regenWealth.error = error.message || 'Analysis was interrupted.'; })
                    .finally(() => { this.regenWealth.loading = false; this.regenWealth.progressMsg = ''; });
            }

            // Bound on the next tick: initPullToRefresh reaches for #ptr, which
            // does not exist until Alpine has rendered the shell.
            this.$nextTick(() => this.initPullToRefresh());

            // Read history BEFORE the opening snapshot. hasAnyPortfolioData counts
            // nwHistory, #nwChart lives behind it, and loadNwHistory used to be
            // called only from inside renderNwChart — a circle that left a saved
            // history invisible on any boot where net worth happened to be zero.
            this.loadNwHistory();

            // Record the opening valuation. Subsequent edits and quote syncs update it.
            setTimeout(() => {
                this.saveNwSnapshot({ source: 'app-open' });
                this.renderNwChart();
            }, 1500);

            // After FX and the opening snapshot, so the brief reads real values.
            setTimeout(() => this.maybeRunDaily(), 3200);

            // Settle off-hours purchases on the way in, not only on a sync.
            // The whole point is that you do not have to be holding the phone
            // at the opening bell: the open of a session that has already
            // happened is in the daily candles and can be read back at any
            // time. Opening the app mid-afternoon resolves it silently.
            setTimeout(() => {
                this.settleAllPendingLots().then(n => {
                    if (n) { this.saveNwSnapshot({ source: 'lot-settled' }); this.renderNwChart(); }
                }).catch(() => {});
            }, 2600);
        },

        // ════════════════════════════════════════════════════════════
        //  NET WORTH HISTORY — Daily valuation snapshot engine
        // ════════════════════════════════════════════════════════════
        //
        // Every point in here is a value this app COMPUTED while it was open, on
        // the day it computed it. Nothing is interpolated, back-filled or carried
        // forward. A day the app never ran has no point and never gets one.

        /* The local calendar day. toISOString() is UTC, and at +05:30 local time
           runs AHEAD of it, so any observation taken between midnight and 05:29
           was filed under YESTERDAY — a 1 a.m. edit created a point dated the
           day before the day it happened, and the following evening's edit then
           overwrote a record that belonged to a different date. Keys are
           compared as strings everywhere below, so one calendar is in play
           rather than UTC-parsed keys measured against local-midnight Dates. */
        localDateKey(d = new Date()) {
            const t = d instanceof Date ? d : new Date(d);
            if (Number.isNaN(t.getTime())) return '';
            return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        },

        /* One final value per day, ascending, two years deep. Duplicates collapse
           to the LATEST capture rather than the first, because the reason to save
           again is that the newer number supersedes the older one. Legacy records
           carry no capturedAt; for those, later in the array wins. */
        _normalizeHistory(list) {
            const byDate = new Map();
            for (const p of Array.isArray(list) ? list : []) {
                if (!p) continue;
                const date = String(p.date || '').slice(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
                const value = Number(p.value);
                if (!Number.isFinite(value)) continue;
                const next = { ...p, date, value };
                const prev = byDate.get(date);
                if (prev && prev.capturedAt && next.capturedAt && prev.capturedAt > next.capturedAt) continue;
                byDate.set(date, next);
            }
            return [...byDate.values()].sort((a, b) => a.date < b.date ? -1 : 1).slice(-730);
        },

        /** Store the latest truthful value for today; never invent historical points. */
        saveNwSnapshot({ source = 'valuation' } = {}) {
            try {
                const nw = this.netWorthTotal;
                if (!Number.isFinite(nw)) return;
                // The guard is "is there anything to value", not "is the value
                // positive". A brand-new user must not get a ₹0 point; but a
                // portfolio that has been emptied, or one whose debts exceed its
                // assets, is a real observation and belongs in the series. The old
                // `nw <= 0` test silently refused to record either of those.
                if (!this.hasAnyPortfolioData) return;

                const today = this.localDateKey();
                if (!today) return;

                let history = [];
                try { history = JSON.parse(localStorage.getItem('rfm_nw_history')) || []; } catch (e) { history = []; }
                if (!Array.isArray(history)) history = [];

                const point = {
                    date: today,
                    capturedAt: new Date().toISOString(),
                    value: Math.round(nw),
                    source
                };
                history.push(point);

                history = this._normalizeHistory(history);
                localStorage.setItem('rfm_nw_history', JSON.stringify(history));
                this.nwHistory = history;
            } catch (e) {
                console.warn('[NW Snapshot]', e);
            }
        },

        /** Load NW history from localStorage into reactive state */
        loadNwHistory() {
            try {
                const raw = localStorage.getItem('rfm_nw_history');
                this.nwHistory = this._normalizeHistory(raw ? JSON.parse(raw) : []);
            } catch (e) {
                this.nwHistory = [];
            }
        },

        queueNwSnapshot(source) {
            clearTimeout(this._nwSnapshotDebounce);
            this._nwSnapshotDebounce = setTimeout(() => {
                this.saveNwSnapshot({ source });
                this.renderNwChart();
            }, 300);
        },

        /** Active chart time range: '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL' */
        nwChartRange: '1M',

        /** The hovered observation, as a caption. Empty means "not hovering". */
        nwHoverLabel: '',

        /* The first date INSIDE the selected window, as a key. Built from local
           date parts so it lands on the same calendar the observations carry.
           ALL has no floor and returns ''. */
        get nwRangeStartKey() {
            const now = new Date();
            const at = (y, m, d) => this.localDateKey(new Date(y, m, d));
            return ({
                // Snapshots are daily, so a week is a real window rather than
                // one or two points. It is the shortest range the data supports:
                // there is no intraday series, so nothing below 1W would differ.
                '1W':  at(now.getFullYear(),     now.getMonth(),     now.getDate() - 7),
                '1M':  at(now.getFullYear(),     now.getMonth() - 1, now.getDate()),
                '3M':  at(now.getFullYear(),     now.getMonth() - 3, now.getDate()),
                '6M':  at(now.getFullYear(),     now.getMonth() - 6, now.getDate()),
                '1Y':  at(now.getFullYear() - 1, now.getMonth(),     now.getDate()),
            })[this.nwChartRange] || '';
        },

        /* The observations that actually fall inside the window. When there are
           none this is EMPTY. It does NOT fall back to the full history, which is
           what the old code did — an empty "1W" quietly drew two years of data
           under a pill that said one week, and there was no way to tell. */
        get nwChartData() {
            const all = this.nwHistory || [];
            if (!all.length) return [];
            const from = this.nwRangeStartKey;
            return from ? all.filter(p => p.date >= from) : [...all];
        },

        /* A year of daily points is 365 vertices across 350px — legible as a
           shape, illegible as a series. A crowded window is therefore thinned to
           ONE POINT PER BUCKET, and that point is the last observation the app
           actually made inside the bucket, carrying its real date. Nothing is
           averaged and no month-end is synthesised: a month whose last
           observation was the 12th is plotted on the 12th.

           The bucket is chosen by how many points COME OUT, not by the range
           name. Keying off the range needs a raw-count threshold, and any
           threshold is wrong for a sparse history: two years of every-third-day
           observations is only 245 raw points, which passed a "dense enough for
           months" test and then drew 106 weekly vertices about 3px apart. */
        NW_MAX_DRAWN: 60,

        _groupByLast(pts, keyOf) {
            // Points are ascending, so the last write per bucket IS that bucket's
            // final observation, and Map keeps first-seen key order — ascending.
            const last = new Map();
            for (const p of pts) last.set(keyOf(p.date), p);
            return [...last.values()];
        },

        get nwChartSeries() {
            const pts = this.nwChartData;
            if (pts.length <= this.NW_MAX_DRAWN) return pts;

            const monday = d => {
                const t = new Date(`${d}T00:00:00`);
                t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
                return this.localDateKey(t);
            };
            const weekly = this._groupByLast(pts, monday);
            if (weekly.length <= this.NW_MAX_DRAWN) return weekly;

            return this._groupByLast(pts, d => d.slice(0, 7));
        },

        get nwHasObservations() { return this.nwHistory.length > 0; },

        /* Distinguishes "nothing has ever been recorded" from "nothing was
           recorded in THESE dates". They look identical on an empty chart and
           mean completely different things. */
        get nwRangeEmpty() { return this.nwHasObservations && this.nwChartData.length === 0; },

        /* Day and month; the year only on windows that can span one. */
        formatObsDate(key) {
            const d = new Date(`${String(key || '').slice(0, 10)}T00:00:00`);
            if (Number.isNaN(d.getTime())) return '';
            const long = this.nwChartRange === '1Y' || this.nwChartRange === 'ALL';
            return d.toLocaleDateString('en-IN',
                long ? { day: 'numeric', month: 'short', year: '2-digit' }
                     : { day: 'numeric', month: 'short' });
        },

        /* The caption under the chart. The pill says what was asked for; this
           says what was found — the real span of the drawn data and how many
           observations stand behind it. */
        get nwRangeSpanLabel() {
            const pts = this.nwChartData;
            if (!pts.length) return '';
            const n = pts.length;
            const count = `${n} observation${n === 1 ? '' : 's'}`;
            const last = this.formatObsDate(pts[n - 1].date);
            return n === 1 ? `${last} · ${count}`
                           : `${this.formatObsDate(pts[0].date)} — ${last} · ${count}`;
        },

        /* The honest reading of two snapshots.

           This is the difference between two TOTALS, and a total moves for two
           unrelated reasons: the market moved, and money was paid in or taken
           out. Nothing in this app records the second, so nothing here can
           separate them — which is why the figure is a rupee amount labelled
           "change in total corpus" and never a return. A first ₹20,000 deposit
           is not a +100% gain, and treating it as one is how the hero came to
           read "+98764.50% all time". */
        get nwRangeChange() {
            const pts = this.nwChartData;
            if (pts.length < 2) return null;
            const from = Number(pts[0].value);
            const to   = Number(pts[pts.length - 1].value);
            if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
            const delta = to - from;
            // A percentage needs a baseline that means something. A zero or
            // negative baseline yields Infinity or sign-flipped nonsense, and a
            // four-figure percentage is contributions rather than performance
            // every single time — arithmetic, not information.
            const raw = from > 0 ? ((to - from) / from) * 100 : null;
            const pct = raw !== null && Number.isFinite(raw) && Math.abs(raw) < 1000 ? raw : null;
            return {
                delta,
                up: delta >= 0,
                pct,
                deltaLabel: `${delta >= 0 ? '+' : '\u2212'}${this.formatCurrency(Math.abs(delta))}`,
                pctLabel: pct === null ? '' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
            };
        },

        /** Net-worth series (TradingView Lightweight Charts) */
        // Formats an INR figure the way Indians read it: crore, then lakh, then
        // full 2,2,3 grouping. Was buried inside a Chart.js tooltip callback.
        formatIndianShort(v) {
            const n = Number(v) || 0;
            const a = Math.abs(n);
            if (a >= 1e7) return '\u20b9' + (n / 1e7).toFixed(2) + ' Cr';
            if (a >= 1e5) return '\u20b9' + (n / 1e5).toFixed(2) + ' L';
            return '\u20b9' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
        },

        renderNwChart() {
            // Net worth chart canvas only lives and renders on the 'home' overview page
            if (this.activePage !== 'home') return;

            // NEVER build the chart while a View Transition is capturing the page.
            // Lightweight Charts creates a canvas and measures its container, and doing
            // that mid-capture deadlocks Chromium's renderer: the page keeps painting and
            // stops running script. The guard lives HERE rather than at the call sites
            // because the dangerous caller is not navigation — it is queueNwSnapshot's
            // 300ms debounce, which fires on any portfolio write and can land inside a
            // transition nobody associated with the chart.
            if (window.RFMMotion?.isTransitioning?.()) {
                clearTimeout(this._nwChartDefer);
                this._nwChartDefer = setTimeout(() => this.renderNwChart(), 120);
                return;
            }

            const el = document.getElementById('nwChart');
            if (!el || !window.LW) return;

            this.loadNwHistory();

            // Nothing observed inside this window. Tear the chart down and let the
            // template's honest placeholder stand in its place. The old code did
            // two dishonest things here instead: it fell back to the ENTIRE
            // history when a window came back empty, and when there was no
            // history at all it invented a point at today's value — which for a
            // brand-new user plotted a ₹0 observation that never happened.
            //
            // This has to come BEFORE the width check below: an empty window
            // hides the canvas, a hidden canvas measures 0 wide, and the width
            // check would then defer forever waiting for a box that is never
            // coming.
            const points = this.nwChartSeries
                .map(p => ({ time: p.date, value: Number(p.value) }))
                .filter(p => Number.isFinite(p.value));
            if (!points.length) { this._nwChartRetries = 0; this._destroyNwChart(); return; }

            // Lightweight Charts measures its container. Inside an x-show'd page
            // that is display:none the measurement is 0x0 and the chart renders
            // blank with no error, so defer until the element actually has a box.
            // BOUNDED, because this used to set a flag the callback cleared on
            // its way back in — "retry once" that was really "retry forever",
            // and a page that never gets a box is then a page that never runs
            // anything else again.
            if (!el.clientWidth) {
                if ((this._nwChartRetries || 0) < 10) {
                    this._nwChartRetries = (this._nwChartRetries || 0) + 1;
                    this.$nextTick(() => {
                        if (this.activePage === 'home') this.renderNwChart();
                    });
                }
                return;
            }
            this._nwChartRetries = 0;

            const c = this._nwChartColors();
            const single = points.length === 1;
            const seriesOpts = {
                lineColor: single ? 'rgba(0,0,0,0)' : c.stroke,
                lineWidth: single ? 0 : 2,
                topColor: single ? 'rgba(0,0,0,0)' : c.fill,
                bottomColor: c.clear,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerRadius: 4,
                crosshairMarkerBorderColor: c.stroke,
                crosshairMarkerBackgroundColor: c.stroke,
            };

            // Reuse beats rebuild. A range tap, a quote refresh and a theme
            // switch all change only DATA or COLOUR, and remove()/createChart()
            // on each of those threw away a canvas and its listeners to redraw
            // the same shape — the very teardown the View Transition guard above
            // exists to keep away from a capturing renderer.
            const held = window._rfmNw;
            if (window._rfmNwChart && held && held.el === el && held.series) {
                try {
                    held.series.applyOptions(seriesOpts);
                    held.series.setData(points);
                    window._rfmNwChart.applyOptions({
                        width: el.clientWidth,
                        layout: { textColor: c.ink },
                        crosshair: { vertLine: { color: c.stroke } },
                        localization: { priceFormatter: (v) => this.formatIndianShort(v) },
                    });
                    this._markSingleObservation(points, c.stroke, single);
                    window._rfmNwChart.timeScale().fitContent();
                    return;
                } catch (e) {
                    // A library that refuses an update still has to draw, so fall
                    // through to a rebuild rather than leave a stale series up.
                    this._destroyNwChart();
                }
            }

            this._destroyNwChart();

            const chart = window.LW.createChart(el, {
                width: el.clientWidth,
                height: el.clientHeight || 140,
                layout: { background: { color: 'transparent' }, textColor: c.ink, attributionLogo: false },
                grid: { vertLines: { visible: false }, horzLines: { visible: false } },
                rightPriceScale: { visible: false },
                leftPriceScale: { visible: false },
                timeScale: { visible: false, fixLeftEdge: true, fixRightEdge: true },
                handleScroll: false,
                handleScale: false,
                crosshair: {
                    vertLine: { color: c.stroke, width: 1, style: 3, labelVisible: false },
                    horzLine: { visible: false, labelVisible: false },
                },
                localization: { priceFormatter: (v) => this.formatIndianShort(v) },
            });

            const series = chart.addSeries(window.LW.AreaSeries, seriesOpts);
            series.setData(points);
            chart.timeScale().fitContent();

            window._rfmNwChart = chart;
            window._rfmNw = { series, markers: null, el };
            this._markSingleObservation(points, c.stroke, single);

            // The readout. There is no time axis and no price scale — that is the
            // approved design — so this subscription is the ONLY place an exact
            // date or an exact value can be read, and it reports the observation's
            // real date rather than a position interpolated along the line.
            chart.subscribeCrosshairMove(param => {
                const bar = param && param.seriesData && param.seriesData.get(series);
                const value = bar && typeof bar === 'object' ? bar.value : bar;
                if (!param || !param.time || value == null) { this.nwHoverLabel = ''; return; }
                this.nwHoverLabel = `${this.formatObsDate(this._timeToKey(param.time))} · ${this.formatIndianShort(value)}`;
            });

            if (this._nwResizeBound) window.removeEventListener('resize', this._nwResizeBound);
            this._nwResizeBound = () => {
                if (window._rfmNwChart && el.clientWidth) {
                    window._rfmNwChart.applyOptions({ width: el.clientWidth });
                }
            };
            window.addEventListener('resize', this._nwResizeBound);
        },

        /* Read once, in one place, so the reuse path and the rebuild path cannot
           drift apart on colour. Lightweight Charts parses colour strings itself
           and understands neither color-mix() nor a bare hex with alpha — the
           area fill was once declared as color-mix() and therefore silently never
           drew, which is why the chart read as a squiggle rather than as the
           shape of the money. --brass is #BFA05C on dark and #7E6524 on light, so
           this is also what makes a theme switch correct rather than stale. */
        _nwChartColors() {
            const stroke = this._token('--brass', '#BFA05C');
            const alpha = (hex, a) => {
                const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
                if (!m) return `rgba(191,160,92,${a})`;
                const n = parseInt(m[1], 16);
                return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
            };
            return {
                stroke,
                ink: this._token('--ink-faint', '#74857D'),
                fill: alpha(stroke, 0.28),
                clear: alpha(stroke, 0),
            };
        },

        /* A single observation is a point, not a fabricated flat line. The plugin
           is kept and re-set rather than re-created, or a series that goes from
           one point to many keeps a marker that no longer means anything. */
        _markSingleObservation(points, stroke, single) {
            const held = window._rfmNw;
            if (!held || !held.series) return;
            // size is not decoration. Lightweight Charts scales a marker to the
            // bar spacing, and with ONE observation the bar spacing is the whole
            // chart — the dot rendered as a 40px blob floating in the middle of
            // an empty panel.
            const marks = single
                ? [{ time: points[0].time, position: 'inBar', color: stroke, shape: 'circle', size: 0.4 }]
                : [];
            if (held.markers) { held.markers.setMarkers(marks); return; }
            if (marks.length) held.markers = window.LW.createSeriesMarkers(held.series, marks);
        },

        /* Lightweight Charts hands back whatever shape it decided to store the
           time as — the original string, or a {year,month,day} — so the readout
           normalises rather than assuming one of them. */
        _timeToKey(t) {
            if (typeof t === 'string') return t.slice(0, 10);
            if (t && typeof t === 'object' && t.year) {
                return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
            }
            if (typeof t === 'number') return this.localDateKey(new Date(t * 1000));
            return '';
        },

        _destroyNwChart() {
            if (window._rfmNwChart) {
                try { window._rfmNwChart.remove(); } catch (e) {}
            }
            window._rfmNwChart = null;
            window._rfmNw = null;
            this.nwHoverLabel = '';
        },

        async initCapacitor() {
            const isNative = window.AppPlugins && window.AppPlugins.Capacitor.isNativePlatform();
            if (!isNative) return;

            const { App, NativeBiometric, SplashScreen, StatusBar, Style } = window.AppPlugins;

            // Hide Splash Screen once Alpine is mounted and UI is ready
            try { await SplashScreen.hide(); } catch (e) {}

            // Match status bar to our dark background color
            try { 
                await StatusBar.setStyle({ style: Style.Dark });
                await StatusBar.setBackgroundColor({ color: '#0a0a0a' });
            } catch (e) {}

            // Phase 12: Register Android notification channels (required on Android 8+ / API 26+)
            try {
                const { LocalNotifications } = window.AppPlugins;
                if (LocalNotifications) {
                    await LocalNotifications.createChannel({
                        id:          'rfm_maturity',
                        name:        'Maturity Alerts',
                        description: 'FD and Bond maturity reminders',
                        importance:  5,   // IMPORTANCE_HIGH
                        visibility:  1,   // VISIBILITY_PUBLIC
                        vibration:   true,
                        sound:       'default'
                    });
                    await LocalNotifications.createChannel({
                        id:          'rfm_sip',
                        name:        'SIP Reminders',
                        description: 'Monthly SIP payment debit reminders',
                        importance:  4,   // IMPORTANCE_DEFAULT
                        visibility:  1,
                        vibration:   true,
                        sound:       'default'
                    });
                }
            } catch (e) { console.warn('[Phase 12] Channel creation failed:', e); }

            // Biometrics: Strictly OPT-IN. Never prompt unless user explicitly enabled it in settings.
            const isBiometricEnabled = () => {
                try {
                    return localStorage.getItem('corpus_biometric_enabled') === 'true';
                } catch (e) {
                    return false;
                }
            };

            let isPrompting = false;
            let isAuthenticated = !isBiometricEnabled();

            const enforceBiometric = async () => {
                if (!isBiometricEnabled()) {
                    isAuthenticated = true;
                    return;
                }
                if (isPrompting || isAuthenticated) return;
                isPrompting = true;

                try {
                    if (!NativeBiometric) return;
                    const result = await NativeBiometric.isAvailable();
                    if (result && result.isAvailable) {
                        await NativeBiometric.verifyIdentity({
                            reason: "Authenticate to access Corpus",
                            title: "Corpus Security",
                            subtitle: "Confirm your fingerprint or face ID",
                            description: "Touch the sensor to continue",
                            negativeButtonText: "Cancel"
                        });
                        isAuthenticated = true;
                        this.biometricBlocked = false;
                    } else {
                        isAuthenticated = true;
                    }
                } catch (e) {
                    console.warn("Biometric authentication cancelled or not completed:", e);
                    isAuthenticated = false;
                    // Never schedule an autonomous recursive loop — let the user retry manually
                } finally {
                    isPrompting = false;
                }
            };

            // Retry deliberately from UI if opted in
            this.retryBiometric = () => {
                isAuthenticated = false;
                enforceBiometric();
            };

            // Prompt on cold start ONLY if explicitly opted in
            if (isBiometricEnabled()) {
                await enforceBiometric();
            }

            // Lock on resume ONLY if explicitly opted in
            App.addListener('appStateChange', ({ isActive }) => {
                if (this.isSelectingFile) {
                    if (isActive) {
                        setTimeout(() => { this.isSelectingFile = false; }, 2000);
                    }
                    return;
                }
                if (!isBiometricEnabled()) return;
                if (!isActive) {
                    isAuthenticated = false;
                } else if (isActive && !isAuthenticated && !isPrompting) {
                    enforceBiometric();
                }
            });
        },

        // ════════════════════════════════════════════════════════════
        //  PULL-TO-REFRESH MOBILE SWIPE GESTURE ENGINE
        // ════════════════════════════════════════════════════════════
        /* Pull down to sync everything.

           This existed once and was torn out, for a real reason recorded at the
           time: it wrote Alpine state on every touchmove, and a reactive write
           per pixel of finger travel re-evaluated every binding on the page
           sixty times a second. It thrashed layout and froze the phone.

           The fix is not to avoid the gesture, it is to keep the GESTURE off
           the reactive graph entirely. While the finger is down this touches
           nothing but two inline styles on one element, batched into a single
           rAF. Alpine hears about it exactly twice: once when the sync starts
           and once when it ends. */
        PTR_TRIGGER: 72,          // resisted travel that commits to a sync
        PTR_MAX: 108,             // cap the indicator's travel

        initPullToRefresh() {
            const bar = document.getElementById('ptr');
            if (!bar || this._ptrBound) return;
            this._ptrBound = true;

            const label = bar.querySelector('.ptr__label');
            let startX = 0, startY = 0, pulled = 0, tracking = false, axis = '', frame = 0;
            const spin = bar.querySelector('.ptr__spin');

            const paint = () => {
                frame = 0;
                const t = Math.min(pulled, this.PTR_MAX);
                bar.style.transform = `translateY(${t}px)`;
                bar.style.opacity = String(Math.min(1, t / 40));
                bar.dataset.armed = pulled >= this.PTR_TRIGGER ? '1' : '0';
                if (spin) spin.style.transform = `rotate(${Math.min(300, t / this.PTR_TRIGGER * 250)}deg) scale(${pulled >= this.PTR_TRIGGER ? 1.12 : 1})`;
                if (label) label.textContent = pulled >= this.PTR_TRIGGER ? 'Release to sync' : 'Pull to sync';
            };
            const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
            const reset = () => {
                pulled = 0; tracking = false;
                if (frame) { cancelAnimationFrame(frame); frame = 0; }
                bar.style.transition = 'transform .34s var(--ease), opacity .22s linear';
                bar.style.transform = 'translateY(0)';
                bar.style.opacity = '0';
                bar.dataset.armed = '0';
                if (spin) spin.style.transform = '';
                if (label) label.textContent = 'Pull to sync';
                setTimeout(() => { bar.style.transition = ''; }, 360);
            };

            document.addEventListener('touchstart', (e) => {
                if (this.pullToRefresh.isRefreshing) return;
                // Only from a genuine top-of-page rest position, or the gesture
                // fights the scroller for every upward flick.
                if (window.scrollY > 0 || e.touches.length !== 1) return;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                tracking = true;
                axis = '';
                pulled = 0;
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (!tracking || this.pullToRefresh.isRefreshing) return;
                const dx = e.touches[0].clientX - startX;
                const dy = e.touches[0].clientY - startY;
                if (!axis) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
                    axis = dy > 0 && Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'other';
                    if (axis === 'other') { tracking = false; return; }
                }
                if (dy <= 0) { if (pulled) { pulled = 0; schedule(); } return; }
                // A light, predictable resistance keeps the indicator under the
                // thumb. The old power curve needed about 180px of finger travel
                // to reach a 72px threshold, which made refresh feel stuck.
                const thresholdTravel = this.PTR_TRIGGER / 0.72;
                pulled = Math.min(this.PTR_MAX, dy <= thresholdTravel
                    ? dy * 0.72
                    : this.PTR_TRIGGER + (dy - thresholdTravel) * 0.22);
                if (e.cancelable) e.preventDefault();
                schedule();
            }, { passive: false });

            const release = () => {
                if (!tracking) return;
                const commit = pulled >= this.PTR_TRIGGER;
                tracking = false;
                if (!commit) { reset(); return; }
                bar.style.transition = 'transform .22s var(--ease)';
                bar.style.transform = `translateY(${this.PTR_TRIGGER}px)`;
                bar.style.opacity = '1';
                if (spin) spin.style.transform = '';
                if (label) label.textContent = 'Syncing prices\u2026';
                this.triggerPullRefresh().then(message => {
                    if (label) label.textContent = message;
                    setTimeout(reset, 1100);
                });
            };
            document.addEventListener('touchend', release, { passive: true });
            document.addEventListener('touchcancel', () => { if (tracking) reset(); }, { passive: true });
        },

        /* One sync for everything, whatever page you pulled on. The old
           per-list "Refresh prices" button synced the same global set while
           looking like it only touched the group above it. */
        async triggerPullRefresh() {
            if (this.pullToRefresh.isRefreshing) return 'Sync already running';
            this.pullToRefresh.isRefreshing = true;
            document.body.classList.add('is-syncing');
            if (this.haptics && window.RFMMotion) window.RFMMotion.Haptics.tap();
            let result = 'Sync finished';
            try {
                await this.fetchAllPrices();
                const { updated = 0, failed = 0, total = 0 } = this.navFetchProgress || {};
                if (this.navFetchState === 'error') result = 'Sync failed · check connection';
                else if (failed > 0) result = `${updated} updated · ${failed} need attention`;
                else if (updated > 0) result = `${updated} prices updated`;
                else if (!total) result = 'Add a holding to sync';
                else result = 'No prices changed';
                if (typeof this.scheduleMaturityAlerts === 'function') {
                    await this.scheduleMaturityAlerts().catch(() => {});
                }
                this.saveData();
            } catch (err) {
                console.warn('Pull-to-refresh execution error:', err);
                result = 'Sync failed · try again';
            } finally {
                document.body.classList.remove('is-syncing');
                this.pullToRefresh.isRefreshing = false;
            }
            return result;
        },

        // ════════════════════════════════════════════════════════════
        //  DATA PERSISTENCE
        // ════════════════════════════════════════════════════════════
        loadData() {
            // ── Load V1 format ──
            let saved = localStorage.getItem('rfm_v1');
            if (saved) {
                try {
                    const p = JSON.parse(saved);
                    this.investments = (p.investments || []).map(inv => this.migrateHolding(inv));
                    this.goals       = p.goals       || [];
                    this.sips        = p.sips        || [];
                    if (p.profile) this.profile = { ...this.profile, ...p.profile };
                    this.lastNavFetchTime = p.lastNavFetchTime || null;

                    if (p.pension) {
                        this.pension = { ...this.pension, ...p.pension };
                    } else if (p.cashflow && p.cashflow.pension) {
                        // Legacy blobs stored pension inside cashflow. Falls back to 0, not
                        // to the old seeded 56000 — an absent value means "not entered".
                        this.pension.monthlyAmount = Number(p.cashflow.pension) || 0;
                    }

                    if (p.cashflow) {
                        const { pension: _removed, ...rest } = p.cashflow;
                        this.cashflow = { ...this.cashflow, ...rest };
                    }

                    this.networth  = this.migrateNetworth({ ...this.networth, ...(p.networth || {}) });
                    this.emergency = { ...this.emergency, ...(p.emergency || {}) };

                    if (p.tax) {
                        const { taxIncome: _ti, taxOther, taxDeduction, ...taxRest } = p.tax;
                        this.tax = {
                            ...this.tax,
                            ...taxRest,
                            otherIncome:    taxRest.otherIncome    ?? (taxOther    || 0),
                            deduction80C:   taxRest.deduction80C   ?? (taxDeduction || 0),
                        };
                    }
                } catch (e) {
                    console.error('Failed to parse saved RFM data:', e);
                }

                // Saved financial records belong to the user. Never rewrite holdings at startup.
                // This line used to be followed by checkSipDebits(), which did exactly that.
                return;
            }

            // A new user starts with an empty, explicit portfolio rather than another user's demo data.
            this.saveData();
        },

        // The Assets-and-debts form wrote bankBalance / cashOnHand / propertyValue while
        // totalAssets read bank / cash / property, so those three fields were WRITE-ONLY:
        // typing a bank balance changed nothing about net worth, the chart, the health
        // score or what was sent to the AI. Renaming the bindings alone would have thrown
        // away whatever people had already entered, so the orphaned keys are folded into
        // the canonical ones here and then removed. The canonical value wins if both hold
        // a figure — it is the one every reader has been using.
        NETWORTH_ALIASES: {
            bank:      'bankBalance',
            cash:      'cashOnHand',
            property:  'propertyValue',
            credit:    'creditCard',
            otherDebt: 'otherLiability',
        },

        // The Edit-holding sheet bound `interestRate` while every reader used `rate`, and
        // saveEdit spreads the whole form onto the record — so a rate typed into that field
        // was persisted under a key nothing consulted, and the holding's real `rate` was
        // simultaneously reset. Anyone who ever edited a deposit has a rate stranded there.
        migrateHolding(inv) {
            const out = { ...inv };
            const stranded = Number(out.interestRate);
            if (!Number(out.rate) && Number.isFinite(stranded) && stranded !== 0) {
                out.rate = stranded;
            }
            delete out.interestRate;
            return out;
        },

        migrateNetworth(nw) {
            const out = { ...nw };
            for (const [canonical, alias] of Object.entries(this.NETWORTH_ALIASES)) {
                const orphan = Number(out[alias]);
                if (!Number(out[canonical]) && Number.isFinite(orphan) && orphan !== 0) {
                    out[canonical] = orphan;
                }
                delete out[alias];
            }
            return out;
        },

        saveData({ rescheduleAlerts = false } = {}) {
            localStorage.setItem('rfm_v1', JSON.stringify({
                version:     '3.0',
                investments: this.investments,
                pension:     this.pension,
                cashflow:    this.cashflow,
                networth:    this.networth,
                emergency:   this.emergency,
                tax:         this.tax,
                goals:       this.goals,
                sips:        this.sips,
                profile:     this.profile,
                lastNavFetchTime: this.lastNavFetchTime
            }));
            // Notification work is native and expensive. Only reschedule if user explicitly opted in
            if (rescheduleAlerts && localStorage.getItem('corpus_alerts_enabled') === 'true') {
                clearTimeout(this._alertDebounce);
                this._alertDebounce = setTimeout(() => {
                    this.scheduleMaturityAlerts().catch(e => console.warn('[Phase 12] Reschedule alerts failed:', e));
                }, 4000);
            }
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — CASH FLOW (Dynamic Multi-Stream Engine)
        // ════════════════════════════════════════════════════════════

        get totalIncome() {
            if (this.cashflow.incomes && Array.isArray(this.cashflow.incomes) && this.cashflow.incomes.length > 0) {
                return this.cashflow.incomes.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
            }
            return Number(this.pension?.monthlyAmount || 0)
                 + Number(this.cashflow.project || 0)
                 + Number(this.cashflow.otherIncome || 0);
        },
        get totalExpense() {
            let base = 0;
            if (this.cashflow.expenses && Array.isArray(this.cashflow.expenses) && this.cashflow.expenses.length > 0) {
                base = this.cashflow.expenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
            } else {
                base = Number(this.cashflow.housing || 0)
                     + Number(this.cashflow.food || 0)
                     + Number(this.cashflow.medical || 0)
                     + Number(this.cashflow.otherExpense || 0);
            }
            return base + this.effectiveMonthlySipOutflow;
        },
        get effectiveMonthlySipOutflow() {
            if (this.cashflow.sipOverride !== null && this.cashflow.sipOverride !== undefined && this.cashflow.sipOverride !== '') {
                return Number(this.cashflow.sipOverride) || 0;
            }
            return this.totalMonthlySipOutflow;
        },
        get monthlySurplus() { return this.totalIncome - this.totalExpense; },
        get savingsRate() {
            if (this.totalIncome <= 0) return 0;
            return ((this.monthlySurplus / this.totalIncome) * 100).toFixed(1);
        },
        get cashflowCycleInfo() {
            const now = new Date();
            const salaryDay = Number(this.cashflow.salaryDay) || 1;
            const currentDay = now.getDate();
            
            let cycleStart, cycleEnd;
            if (currentDay >= salaryDay) {
                cycleStart = new Date(now.getFullYear(), now.getMonth(), salaryDay);
                cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, salaryDay - 1);
            } else {
                cycleStart = new Date(now.getFullYear(), now.getMonth() - 1, salaryDay);
                cycleEnd = new Date(now.getFullYear(), now.getMonth(), salaryDay - 1);
            }

            const daysTotal = Math.max(1, Math.round((cycleEnd - cycleStart) / (1000 * 60 * 60 * 24)) + 1);
            const daysPassed = Math.max(0, Math.round((now - cycleStart) / (1000 * 60 * 60 * 24)));
            const daysRemaining = Math.max(0, daysTotal - daysPassed);

            const startStr = cycleStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            const endStr = cycleEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

            return {
                salaryDay,
                cycleLabel: `${startStr} – ${endStr}`,
                daysRemaining,
                daysPassed,
                progressPct: Math.min(100, Math.round((daysPassed / daysTotal) * 100))
            };
        },

        // Dynamic Income & Expense Item Helpers
        addIncomeStream(name = 'New Income Source', amount = 0, category = 'Salary', creditDay = 1) {
            if (!this.cashflow.incomes) this.cashflow.incomes = [];
            this.cashflow.incomes.push({
                id: this.newId('inc'),
                name: name,
                amount: Number(amount) || 0,
                category: category,
                creditDay: Number(creditDay) || 1
            });
            this.saveData();
        },
        deleteIncomeStream(id) {
            if (!this.cashflow.incomes) return;
            this.cashflow.incomes = this.cashflow.incomes.filter(inc => inc.id !== id);
            this.saveData();
        },
        addExpenseItem(name = 'New Expense Item', amount = 0, category = 'General') {
            if (!this.cashflow.expenses) this.cashflow.expenses = [];
            this.cashflow.expenses.push({
                id: this.newId('exp'),
                name: name,
                amount: Number(amount) || 0,
                category: category
            });
            this.saveData();
        },
        deleteExpenseItem(id) {
            if (!this.cashflow.expenses) return;
            this.cashflow.expenses = this.cashflow.expenses.filter(exp => exp.id !== id);
            this.saveData();
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — SIP & RECURRING (Phase 9)
        // ════════════════════════════════════════════════════════════
        get activeSips() {
            return this.sips.filter(s => s.status === 'Active');
        },
        get totalMonthlySipOutflow() {
            return this.activeSips.reduce((sum, s) => sum + Number(s.monthlyAmount || 0), 0);
        },
        get activeSipCount() {
            return this.activeSips.length;
        },
        get totalSipInvestedToDate() {
            return this.sips.reduce((sum, s) => {
                if (!s.startDate) return sum;
                const start  = new Date(s.startDate);
                const end    = s.endDate ? new Date(s.endDate) : new Date();
                const months = Math.max(0, (end.getFullYear() - start.getFullYear()) * 12
                             + (end.getMonth() - start.getMonth()) + 1);
                return sum + (Number(s.monthlyAmount || 0) * months);
            }, 0);
        },
        get upcomingSipDebits() {
            const today = new Date().getDate();
            return this.activeSips
                .slice()
                .sort((a, b) => {
                    const da = Number(a.dayOfMonth) >= today ? Number(a.dayOfMonth) : Number(a.dayOfMonth) + 31;
                    const db = Number(b.dayOfMonth) >= today ? Number(b.dayOfMonth) : Number(b.dayOfMonth) + 31;
                    return da - db;
                });
        },

        // ════════════════════════════════════════════════════════════
        //  VALUATION & P&L HELPERS (Phase 8: Dynamic Equity Engine)
        // ════════════════════════════════════════════════════════════
        getInvCurrentValue(inv) {
            if (!inv) return 0;
            const units = Number(inv.units) || 0;
            // For US stocks/ETFs: always use units × price × FX rate. Never fall back to `amount`.
            const isUsd = inv.currency === 'USD' || ['Stock (US)', 'ETF (US)'].includes(inv.type);
            const rate = isUsd ? this.fxUsdInr : 1;
            if (units > 0) {
                const currentPrice = Number(inv.currentPrice) || Number(inv.nav) || Number(inv.buyPrice) || 0;
                const val = units * currentPrice * rate;
                return isNaN(val) ? 0 : val;
            }
            // For non-unit assets (FDs, EPF, bonds): use currentValue or amount in INR
            const fallback = Number(inv.currentValue) || Number(inv.amount) || 0;
            const val = fallback * (isUsd ? rate : 1);
            return isNaN(val) ? 0 : val;
        },

        getInvInvestedCost(inv) {
            if (!inv) return 0;
            const units = Number(inv.units) || 0;
            const isUsd = inv.currency === 'USD' || ['Stock (US)', 'ETF (US)'].includes(inv.type);
            const rate = isUsd ? this.fxUsdInr : 1;
            if (units > 0) {
                const buyPrice = Number(inv.buyPrice) || Number(inv.nav) || 0;
                const val = units * buyPrice * rate;
                return isNaN(val) ? 0 : val;
            }
            const val = (Number(inv.amount) || 0) * (isUsd ? rate : 1);
            return isNaN(val) ? 0 : val;
        },

        getInvPnL(inv) {
            const pnl = this.getInvCurrentValue(inv) - this.getInvInvestedCost(inv);
            return isNaN(pnl) ? 0 : pnl;
        },

        getInvPnLPct(inv) {
            const cost = this.getInvInvestedCost(inv);
            if (cost <= 0) return '0.00';
            const pct = ((this.getInvPnL(inv) / cost) * 100);
            return isNaN(pct) ? '0.00' : pct.toFixed(2);
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — NET WORTH
        // ════════════════════════════════════════════════════════════
        get totalAssets() {
            const invTotal = (this.investments || []).reduce((s, i) => s + (this.getInvCurrentValue(i) || 0), 0);
            const bank = Number(this.networth?.bank) || 0;
            const cash = Number(this.networth?.cash) || 0;
            const property = Number(this.networth?.property) || 0;
            const other = Number(this.networth?.otherAsset) || 0;
            return bank + cash + property + other + invTotal;
        },
        get totalLiabilities() {
            const hl = Number(this.networth?.homeLoan) || 0;
            const pl = Number(this.networth?.personalLoan) || 0;
            const cc = Number(this.networth?.credit) || 0;
            const od = Number(this.networth?.otherDebt) || 0;
            return hl + pl + cc + od;
        },
        get netWorthTotal() {
            const val = this.totalAssets - this.totalLiabilities;
            return isNaN(val) ? 0 : val;
        },
        get debtRatio() {
            if (!this.totalAssets || this.totalAssets <= 0) return 0;
            const ratio = (this.totalLiabilities / this.totalAssets) * 100;
            return isNaN(ratio) ? 0 : ratio.toFixed(1);
        },

        stockFilter: 'all', // 'all' | 'ind' | 'us'

        get stockInvestments() {
            return (this.investments || []).filter(i =>
                ['Stock', 'Stock (IND)', 'Stock (US)', 'ETF', 'ETF (IND)', 'ETF (US)'].includes(i.type) ||
                (i.type || '').toLowerCase().includes('stock') ||
                (i.type || '').toLowerCase().includes('etf')
            );
        },

        get filteredStockInvestments() {
            if (this.stockFilter === 'ind') {
                return this.stockInvestments.filter(i => ['Stock (IND)', 'ETF (IND)', 'Stock'].includes(i.type) || !i.type.includes('US'));
            }
            if (this.stockFilter === 'us') {
                return this.stockInvestments.filter(i => ['Stock (US)', 'ETF (US)'].includes(i.type) || (i.currency === 'USD'));
            }
            return this.stockInvestments;
        },

        get totalStockValuation() {
            return this.stockInvestments.reduce((sum, i) => sum + this.getInvCurrentValue(i), 0);
        },

        get totalStockCost() {
            return this.stockInvestments.reduce((sum, i) => sum + this.getInvInvestedCost(i), 0);
        },

        get totalStockPnL() {
            return this.totalStockValuation - this.totalStockCost;
        },

        get totalStockPnLPct() {
            if (this.totalStockCost <= 0) return '0.00';
            return ((this.totalStockPnL / this.totalStockCost) * 100).toFixed(2);
        },

        get totalIndStockValuation() {
            return this.stockInvestments
                .filter(i => ['Stock (IND)', 'ETF (IND)', 'Stock'].includes(i.type) || !i.type.includes('US'))
                .reduce((sum, i) => sum + this.getInvCurrentValue(i), 0);
        },

        get totalUsStockValuation() {
            return this.stockInvestments
                .filter(i => ['Stock (US)', 'ETF (US)'].includes(i.type) || (i.currency === 'USD'))
                .reduce((sum, i) => sum + this.getInvCurrentValue(i), 0);
        },

        get totalUsStockUSD() {
            const usdRate = this.fxUsdInr;
            return this.totalUsStockValuation / usdRate;
        },

        invFilter: 'all', // 'all' | 'mf' | 'stocks' | 'debt'

        // The holding currently open on the detail view, by id rather than by
        // reference: the array is replaced wholesale on every edit and sync, so
        // a held reference would go stale and silently show the old figures.
        detailHoldingId: null,
        detailRange: '1M',
        get filteredInvestments() {
            if (this.invFilter === 'mf') {
                return (this.investments || []).filter(i => (i.type || '').toLowerCase().includes('mutual'));
            }
            if (this.invFilter === 'stocks') {
                return (this.investments || []).filter(i => (i.type || '').toLowerCase().includes('stock') || (i.type || '').toLowerCase().includes('etf'));
            }
            if (this.invFilter === 'debt') {
                return (this.investments || []).filter(i => (i.type || '').toLowerCase().includes('government') || (i.type || '').toLowerCase().includes('bond') || (i.name || '').toLowerCase().includes('epf') || (i.type || '').toLowerCase().includes('fd'));
            }
            return this.investments || [];
        },

        get usStockList() {
            return (this.investments || []).filter(i => ['Stock (US)', 'ETF (US)'].includes(i.type) || (i.currency === 'USD'));
        },
        get indStockList() {
            return (this.investments || []).filter(i => (['Stock (IND)', 'ETF (IND)', 'Stock', 'ETF'].includes(i.type) || (i.type || '').toLowerCase().includes('stock')) && !['Stock (US)', 'ETF (US)'].includes(i.type) && i.currency !== 'USD');
        },
        get mutualFundList() {
            return (this.investments || []).filter(i => i.type === 'Mutual Fund' || (i.type || '').toLowerCase().includes('mutual'));
        },
        get debtAndEpfList() {
            return (this.investments || []).filter(i =>
                ['Government Scheme', 'Bond', 'Fixed Deposit', 'Gold'].includes(i.type) ||
                (i.type || '').toLowerCase().includes('government') ||
                (i.type || '').toLowerCase().includes('bond') ||
                (i.type || '').toLowerCase().includes('epf') ||
                (i.name || '').toLowerCase().includes('epf')
            );
        },

        // ── Mutual Funds Portfolio Computed Properties ────────────────
        mfFilter: 'all', // 'all' | 'equity' | 'debt'

        get mfInvestments() {
            return (this.investments || []).filter(i =>
                i.type === 'Mutual Fund' || (i.type || '').toLowerCase().includes('mutual')
            );
        },

        get filteredMfInvestments() {
            if (this.mfFilter === 'equity') {
                return this.mfInvestments.filter(i => !(i.name || '').toLowerCase().includes('debt') && !(i.name || '').toLowerCase().includes('liquid'));
            }
            if (this.mfFilter === 'debt') {
                return this.mfInvestments.filter(i => (i.name || '').toLowerCase().includes('debt') || (i.name || '').toLowerCase().includes('liquid'));
            }
            return this.mfInvestments;
        },

        get totalMfValuation() {
            return this.mfInvestments.reduce((sum, i) => sum + this.getInvCurrentValue(i), 0);
        },

        get totalMfCost() {
            return this.mfInvestments.reduce((sum, i) => sum + this.getInvInvestedCost(i), 0);
        },

        get totalMfPnL() {
            return this.totalMfValuation - this.totalMfCost;
        },

        get totalMfPnLPct() {
            if (this.totalMfCost <= 0) return '0.00';
            return ((this.totalMfPnL / this.totalMfCost) * 100).toFixed(2);
        },

        openAddMfModal() {
            this.newInv = {
                name: '', type: 'Mutual Fund', issuer: '', amount: '',
                rate: '', payout: 'Monthly', rating: '', maturityDate: '',
                ticker: '', units: '', buyPrice: '', currentPrice: '', schemeCode: ''
            };
            this.addingInv = true;
        },

        // ── Gold Portfolio Computed Properties ────────────────────────
        goldFilter: 'all', // 'all' | 'physical' | 'sgb' | 'etf'

        get goldInvestments() {
            return (this.investments || []).filter(i =>
                ['Gold', 'Physical Gold', 'Sovereign Gold Bond (SGB)', 'Gold ETF / Digital Gold'].includes(i.type) ||
                (i.type || '').toLowerCase().includes('gold') ||
                (i.name || '').toLowerCase().includes('gold') ||
                (i.ticker || '').toUpperCase() === 'GOLDBEES.NS'
            );
        },

        get filteredGoldInvestments() {
            if (this.goldFilter === 'physical') {
                return this.goldInvestments.filter(i => (i.type || '').includes('Physical') || (i.name || '').toLowerCase().includes('physical'));
            }
            if (this.goldFilter === 'sgb') {
                return this.goldInvestments.filter(i => (i.type || '').includes('SGB') || (i.type || '').includes('Sovereign') || (i.name || '').toLowerCase().includes('sgb'));
            }
            if (this.goldFilter === 'etf') {
                return this.goldInvestments.filter(i => (i.type || '').includes('ETF') || (i.type || '').includes('Digital') || (i.name || '').toLowerCase().includes('etf'));
            }
            return this.goldInvestments;
        },

        get totalGoldValuation() {
            return this.goldInvestments.reduce((sum, i) => sum + this.getInvCurrentValue(i), 0);
        },

        get totalGoldCost() {
            return this.goldInvestments.reduce((sum, i) => sum + this.getInvInvestedCost(i), 0);
        },

        get totalGoldPnL() {
            return this.totalGoldValuation - this.totalGoldCost;
        },

        get totalGoldPnLPct() {
            if (this.totalGoldCost <= 0) return '0.00';
            return ((this.totalGoldPnL / this.totalGoldCost) * 100).toFixed(2);
        },

        get totalGoldGrams() {
            return this.goldInvestments.reduce((sum, i) => sum + Number(i.units || 0), 0);
        },

        openAddGoldModal(presetType = 'Gold ETF / Digital Gold') {
            this.newInv = {
                name: '', type: presetType, issuer: '', amount: '',
                rate: '', payout: 'Annual', rating: '', maturityDate: '',
                ticker: 'GOLDBEES.NS', units: '', buyPrice: '', currentPrice: '', schemeCode: ''
            };
            this.addingInv = true;
        },

        getAssetTotal(type) {
            return this.investments
                .filter(i => i.type === type || (type === 'Stock' && (i.type || '').includes('Stock')) || (type === 'ETF' && (i.type || '').includes('ETF')))
                .reduce((sum, i) => sum + this.getInvCurrentValue(i), 0);
        },

        get totalInvestedCost() {
            return this.investments.reduce((s, i) => s + this.getInvInvestedCost(i), 0);
        },

        get totalUnrealizedPnL() {
            return this.investments.reduce((s, i) => s + this.getInvPnL(i), 0);
        },

        get totalUnrealizedPnLPct() {
            const cost = this.totalInvestedCost;
            if (cost <= 0) return '0.00';
            return ((this.totalUnrealizedPnL / cost) * 100).toFixed(2);
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — INVESTMENTS
        // ════════════════════════════════════════════════════════════
        get monthlyInvestmentIncome() {
            return (this.investments || []).reduce((sum, inv) => {
                if (inv.payout === 'Cumulative') return sum;
                const rate = Number(inv.rate) || 0;
                if (rate <= 0) return sum;
                const yearly = Number(inv.amount || 0) * (rate / 100);
                return sum + (yearly / 12);
            }, 0);
        },

        // ── Portfolio Analysis (Deliverable 2) ──────────────────────
        get assetAllocation() {
            const groups = {};
            this.investments.forEach(inv => {
                const t = inv.type || 'Other';
                groups[t] = (groups[t] || 0) + Number(inv.amount);
            });
            return groups;
        },

        get ratingDistribution() {
            const groups = {};
            this.investments.forEach(inv => {
                const r = inv.rating || 'Not Rated';
                groups[r] = (groups[r] || 0) + Number(inv.amount);
            });
            return groups;
        },

        get weightedAvgReturn() {
            const total = this.investments.reduce((s, i) => s + Number(i.amount), 0);
            if (total === 0) return '0.00';
            const wSum = this.investments.reduce(
                (s, i) => s + Number(i.amount) * Number(i.rate), 0);
            return (wSum / total).toFixed(2);
        },

        get concentrationWarnings() {
            const total = this.investments.reduce((s, i) => s + Number(i.amount), 0);
            if (total === 0) return [];
            const byIssuer = {};
            this.investments.forEach(inv => {
                const key = inv.issuer || inv.name;
                byIssuer[key] = (byIssuer[key] || 0) + Number(inv.amount);
            });
            return Object.entries(byIssuer)
                .filter(([, amt]) => (amt / total) > 0.5)
                .map(([name, amt]) => ({
                    name,
                    pct: ((amt / total) * 100).toFixed(0)
                }));
        },

        get totalInvested() {
            // ── Single-source-of-truth: units×avgBuyPrice×FX, fallback amount ──
            const rate = this.fxUsdInr;
            return (this.investments || []).reduce((sum, inv) => {
                if (inv.units > 0 && inv.buyPrice > 0) {
                    const cost = inv.units * inv.buyPrice;
                    return sum + (inv.currency === 'USD' ? cost * rate : cost);
                }
                return sum + (Number(inv.amount) || 0);
            }, 0);
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — EMERGENCY FUND
        // ════════════════════════════════════════════════════════════
        get efRequired() { return Number(this.emergency.efMonthly) * Number(this.emergency.efMonths); },
        get efGap()      { return Math.max(0, this.efRequired - Number(this.emergency.efCurrent)); },
        get efProgress() {
            if (this.efRequired <= 0) return 100;
            return Math.min(100, (Number(this.emergency.efCurrent) / this.efRequired) * 100).toFixed(0);
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — PENSION
        // ════════════════════════════════════════════════════════════
        get annualPension() { return Number(this.pension.monthlyAmount) * 12; },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — TAX ENGINE (Phase 3)
        // ════════════════════════════════════════════════════════════

        // Annual interest income derived from investments (monthly non-cumulative income × 12)
        get annualInterestIncome() {
            // Every non-finite term used to poison the whole sum: a stock has no
            // `amount`, so Number(undefined) is NaN, NaN * x is NaN, and one
            // equity holding turned the ENTIRE tax screen — gross income, both
            // regimes, the saving — into NaN. Anyone holding a single share saw it.
            return (this.investments || []).reduce((sum, inv) => {
                const payout = inv.payout || inv.payoutFrequency || '';
                if (/cumulative|maturity/i.test(payout)) return sum;   // paid at the end, not yearly
                const principal = Number(inv.amount);
                const rate = Number(inv.rate);
                if (!Number.isFinite(principal) || !Number.isFinite(rate)) return sum;
                return sum + (principal * rate / 100);
            }, 0);
        },

        // Total gross annual income for tax purposes
        get grossAnnualIncome() {
            return this.annualPension
                 + this.annualInterestIncome
                 + Number(this.tax.salaryIncome || 0)
                 + Number(this.tax.otherIncome);
        },

        /* The only income the standard deduction may be set against. Everything else in
           gross — deposit interest, rent, consulting — is expressly outside Sec 16(ia). */
        get salaryAndPensionIncome() {
            return this.annualPension + Number(this.tax.salaryIncome || 0);
        },

        get totalInterestIncome() { return this.annualInterestIncome; },
        
        // ── CAPITAL GAINS ENGINE (Phase 6) ───────────────────────────
        // FY 2024-25 rules:
        // - Equity LTCG (>12m): 12.5% on gains above the ₹1.25L annual exemption
        // - Equity STCG (≤12m): 20% on the whole gain
        //
        // Gains are ENTERED, not derived, and this is the substantive part of the fix.
        // Capital gains tax falls due on a REALIZED gain — money from a sale. This app
        // records holdings, not disposals: no part of the data model knows that anything
        // was ever sold. The previous engine summed the UNREALIZED gain on every equity
        // holding and added 12.5% of it to netTaxPayable, inventing a liability nobody
        // owed. Two further faults hid inside it: it matched ['Stock','Mutual Fund','ETF']
        // while the Add form only ever writes 'Stock (IND)' / 'Stock (US)' / 'ETF (IND)' /
        // 'ETF (US)' / 'Mutual Fund' — so it silently taxed mutual funds alone — and it
        // defaulted isLongTerm to true because no purchase date is collected anywhere.
        //
        // What the app CAN do correctly is the arithmetic once the user states the figure,
        // which is all these getters now do. Unrealized movement is still shown, honestly
        // labelled as P&L, on every holding row.
        get equityLTCG() {
            const totalGains = Math.max(0, Number(this.tax.realizedEquityLTCG) || 0);
            const exemptionLimit = 125000;
            const exemptionUsed = Math.min(totalGains, exemptionLimit);
            const taxableGains = Math.max(0, totalGains - exemptionLimit);
            const tax = Math.round(taxableGains * 0.125 * 1.04); // 12.5% + 4% cess
            return { totalGains, exemptionUsed, taxableGains, tax };
        },

        get equitySTCG() {
            const totalGains = Math.max(0, Number(this.tax.realizedEquitySTCG) || 0);
            const tax = Math.round(totalGains * 0.20 * 1.04); // 20% + 4% cess
            return { totalGains, tax };
        },

        get totalCapitalGainsTax() {
            if (this.tax.capitalGainsOverride !== null && this.tax.capitalGainsOverride !== undefined && this.tax.capitalGainsOverride !== '') {
                return Number(this.tax.capitalGainsOverride);
            }
            return (this.equityLTCG?.tax || 0) + (this.equitySTCG?.tax || 0);
        },

        get totalTds() { return 0; },

        // The regime the user has actually elected, and the tax that follows from it.
        // netTaxPayable used to hardcode Math.min(old, new) while tax.regime was stored
        // and read by nothing — so someone who had elected the old regime was shown the
        // new regime's bill whenever it happened to be cheaper. 'compare' keeps the
        // pick-the-cheaper behaviour, and is the default.
        get effectiveRegime() {
            const choice = this.tax.regime;
            if (choice === 'old' || choice === 'new') return choice;
            // Ties resolve to New, matching optimalRegime: it is the default regime and
            // the one that requires no election to be filed.
            return this.oldRegimeTax.tax < this.newRegimeTax.tax ? 'old' : 'new';
        },

        get incomeTaxPayable() {
            return this.effectiveRegime === 'old' ? this.oldRegimeTax.tax : this.newRegimeTax.tax;
        },

        get netTaxPayable() {
            return Math.max(0, this.incomeTaxPayable + this.totalCapitalGainsTax - this.totalTds);
        },

        // ── OLD REGIME CALCULATION ───────────────────────────────────
        // Old Regime: Standard deduction ₹50K for pension, then all applicable deductions.
        // Below 60:                No tax up to ₹2.5L, 5% on 2.5L-5L, 20% on 5L-10L, 30% above 10L
        // Senior Citizen (60–79):  No tax up to ₹3L,   5% on 3L-5L,   20% on 5L-10L, 30% above 10L
        //
        // The ₹3L senior exemption used to be hardcoded for EVERYONE, and 80TTB — which
        // only a senior may claim — was granted unconditionally. `tax.seniorCitizen` was
        // bound to a checkbox on two screens and read by nothing, so ticking it changed no
        // figure and leaving it unticked still produced a senior's bill. Both now follow
        // the flag. Only the two bands the app collects an answer for are modelled: there
        // is no 80+ control, so the ₹5L super-senior exemption is deliberately not applied.
        get oldRegimeTax() {
            const gross = this.grossAnnualIncome;
            const isSenior = !!this.tax.seniorCitizen;
            // Standard deduction: ₹50,000 for pension income
            // Was Math.min(50000, gross) — so a person with no salary and no pension, whose
            // entire income was deposit interest, still received a ₹50,000 deduction they
            // are not entitled to. Bounded by qualifying income instead.
            const stdDeduction = Math.min(50000, this.salaryAndPensionIncome);
            // Section 80C
            const ded80C  = Math.min(Number(this.tax.deduction80C),  150000);
            // Section 80D — Senior citizen premium limit ₹50K, ₹25K below 60
            const ded80D  = Math.min(Number(this.tax.deduction80D),  isSenior ? 50000 : 25000);
            // 80TTB and 80TTA are mutually exclusive by age: a senior deducts up to ₹50K of
            // deposit interest, everyone else up to ₹10K of savings-account interest.
            const ded80TTB = isSenior ? Math.min(Number(this.tax.deduction80TTB), 50000) : 0;
            const ded80TTA = isSenior ? 0 : Math.min(Number(this.tax.deduction80TTA), 10000);
            // Section 24 — Home loan interest (max ₹2L)
            const dedHomeLoan = Math.min(Number(this.tax.homeLoanInterest), 200000);
            // HRA
            const dedHRA  = Number(this.tax.hra);
            // Other
            const dedOther = Number(this.tax.otherDeductions);

            const totalDeductions = stdDeduction + ded80C + ded80D + ded80TTB + ded80TTA + dedHomeLoan + dedHRA + dedOther;
            const taxableIncome   = Math.max(0, gross - totalDeductions);

            // Slabs for FY 2024-25 / AY 2025-26. Only the basic exemption differs by age;
            // every band above ₹5L is identical, so the two tables share their upper half.
            const exemptUpTo = isSenior ? 300000 : 250000;
            let tax = 0;
            if (taxableIncome <= exemptUpTo) {
                tax = 0;
            } else if (taxableIncome <= 500000) {
                tax = (taxableIncome - exemptUpTo) * 0.05;
            } else if (taxableIncome <= 1000000) {
                tax = (500000 - exemptUpTo) * 0.05 + (taxableIncome - 500000) * 0.20;
            } else {
                tax = (500000 - exemptUpTo) * 0.05 + 500000 * 0.20 + (taxableIncome - 1000000) * 0.30;
            }

            // Rebate u/s 87A (max ₹12,500 if taxable income ≤ ₹5L) — NOT available for seniors above 60 if income > 5L
            // For seniors: 87A rebate applies if taxable ≤ 5L
            if (taxableIncome <= 500000) tax = 0;

            // Surcharge: 10% if income > 50L, 15% if > 1Cr
            let surcharge = 0;
            if (taxableIncome > 10000000) surcharge = tax * 0.15;
            else if (taxableIncome > 5000000) surcharge = tax * 0.10;

            const taxAfterSurcharge = tax + surcharge;
            // Health & Education Cess: 4%
            const cess = taxAfterSurcharge * 0.04;
            const totalTax = taxAfterSurcharge + cess;

            return {
                gross,
                totalDeductions,
                taxableIncome,
                tax: Math.round(totalTax),
                breakdown: {
                    stdDeduction, ded80C, ded80D, ded80TTB, ded80TTA,
                    dedHomeLoan, dedHRA, dedOther, surcharge: Math.round(surcharge), cess: Math.round(cess)
                }
            };
        },

        // ── NEW REGIME CALCULATION ───────────────────────────────────
        // New Regime (FY 2024-25): Standard deduction ₹75K. No other deductions.
        // Slabs: 0-3L: 0%, 3-7L: 5%, 7-10L: 10%, 10-12L: 15%, 12-15L: 20%, >15L: 30%
        // Rebate u/s 87A: If income ≤ ₹7L, full rebate (no tax)
        get newRegimeTax() {
            const gross = this.grossAnnualIncome;
            const stdDeduction = Math.min(75000, this.salaryAndPensionIncome); // Sec 16(ia), new regime
            const taxableIncome = Math.max(0, gross - stdDeduction);

            let tax = 0;
            if (taxableIncome <= 300000) {
                tax = 0;
            } else if (taxableIncome <= 700000) {
                tax = (taxableIncome - 300000) * 0.05;
            } else if (taxableIncome <= 1000000) {
                tax = 20000 + (taxableIncome - 700000) * 0.10;
            } else if (taxableIncome <= 1200000) {
                tax = 50000 + (taxableIncome - 1000000) * 0.15;
            } else if (taxableIncome <= 1500000) {
                tax = 80000 + (taxableIncome - 1200000) * 0.20;
            } else {
                tax = 140000 + (taxableIncome - 1500000) * 0.30;
            }

            // Rebate: If taxable income ≤ ₹7L, no tax
            if (taxableIncome <= 700000) tax = 0;

            // Marginal relief if taxable is slightly above ₹7L
            if (taxableIncome > 700000 && tax > (taxableIncome - 700000)) {
                tax = taxableIncome - 700000;
            }

            // Surcharge
            let surcharge = 0;
            if (taxableIncome > 10000000) surcharge = tax * 0.15;
            else if (taxableIncome > 5000000) surcharge = tax * 0.10;

            const taxAfterSurcharge = tax + surcharge;
            const cess = taxAfterSurcharge * 0.04;
            const totalTax = taxAfterSurcharge + cess;

            return {
                gross,
                stdDeduction,
                taxableIncome,
                tax: Math.round(totalTax),
                breakdown: { surcharge: Math.round(surcharge), cess: Math.round(cess) }
            };
        },

        // Best regime (lower tax wins)
        get recommendedRegime() {
            const oldTax = this.oldRegimeTax.tax;
            const newTax = this.newRegimeTax.tax;
            if (oldTax === newTax) return 'equal';
            return oldTax < newTax ? 'old' : 'new';
        },

        get taxSavingByOptimalRegime() {
            return Math.abs(this.oldRegimeTax.tax - this.newRegimeTax.tax);
        },

        // index.html:1191 bound x-text="optimalRegime" against a property that was
        // never defined, so the "Optimal Regime" row on the tax card rendered empty
        // and threw on every page render. Ties are reported as New, which is the
        // default regime and the one requiring no election.
        replayTutorial() {
            try { localStorage.removeItem(window.RFMMotion.TOUR_KEY); } catch (e) {}
            this.moreMenuOpen = false;
            this.activePage = 'home';
            setTimeout(() => window.RFMMotion && window.RFMMotion.startTour(true), 450);
        },

        // Defaults to 'dark', not 'system': the deep green IS the product's
        // identity, and a first launch that resolves to the light theme because
        // the phone is in day mode shows a new user the wrong app.
        theme: (function () {
            try { return localStorage.getItem('rfm_theme') || 'dark'; } catch (e) { return 'dark'; }
        })(),

        // Cycles light -> dark. 'system' resolves to whatever the OS currently
        // says, so the first tap always moves to the opposite of what is on screen
        // rather than appearing to do nothing.
        toggleTheme() {
            const showingDark = this.theme === 'dark'
                || (this.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            this.theme = showingDark ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', this.theme);
            try { localStorage.setItem('rfm_theme', this.theme); } catch (e) {}
            if (window.RFMMotion) window.RFMMotion.Haptics.commit();
            this.syncNativeChrome();
            // The chart's colours are read from tokens at draw time, so without
            // this the line kept the previous theme's brass until something else
            // happened to redraw it. Reuse makes this an applyOptions, not a
            // teardown.
            this.$nextTick(() => this.renderNwChart());
        },

        // Status-bar icons must invert with the theme. Style.Dark means DARK
        // BACKGROUND -> light icons, so a light theme needs Style.Light — the
        // inverse of what the name suggests.
        syncNativeChrome() {
            try {
                const P = window.AppPlugins;
                if (!P || !P.Capacitor || !P.Capacitor.isNativePlatform()) return;
                const dark = document.documentElement.getAttribute('data-theme') === 'dark'
                    || (!document.documentElement.getAttribute('data-theme')
                        && window.matchMedia('(prefers-color-scheme: dark)').matches);
                P.StatusBar.setStyle({ style: dark ? P.Style.Dark : P.Style.Light });
            } catch (e) {}
        },

        /* ── CORPUS shell ────────────────────────────────────────────────
           Four destinations replace the previous fifteen pages. Every old page
           id still resolves — it simply belongs to a surface now, so existing
           `activePage = 'x'` writes keep working and deep links stay valid. */
        SURFACES: [
            { id: 'home',      label: 'Overview',  icon: 'account_balance',          root: 'home',        views: ['home'] },
            { id: 'portfolio', label: 'Holdings',  icon: 'donut_small',              root: 'investments', views: ['investments','holding','maturity','import'] },
            { id: 'planning',  label: 'Planning',  icon: 'calendar_month',           root: 'cashflow',    views: ['cashflow','income','pension','emergency','goals','networth','tax'] },
            { id: 'insights',  label: 'Insights',  icon: 'auto_awesome',             root: 'regen',       views: ['regen'] },
        ],

        get surface() {
            const p = this.activePage;
            const hit = this.SURFACES.find(s => s.views.includes(p));
            return hit ? hit.id : 'home';
        },

        get pageLabel() {
            const labels = {
                home: 'Dashboard', investments: 'Holdings', holding: 'Holding detail',
                maturity: 'Maturities', import: 'Import', cashflow: 'Planning',
                income: 'Cashflow', pension: 'Pension', emergency: 'Emergency fund',
                goals: 'Goals', networth: 'Assets & debts', tax: 'Tax',
                regen: 'Insights',
            };
            return labels[this.activePage] || 'Corpus';
        },

        /* One line describing how fresh the WHOLE portfolio is. The hero states
           it directly rather than making the user open each holding to find out,
           and it names the worst case — a portfolio is only as current as its
           stalest quote. */
        get portfolioFreshness() {
            const priced = (this.investments || []).filter(i => i.priceAsOf || i.lastNavUpdate);
            if (!priced.length) return { stale: false, label: 'Not synced yet' };
            const states = priced.map(i => this.priceFreshness(i));
            const stale = states.filter(s => s.state === 'stale').length;
            const close = states.filter(s => s.state === 'close').length;
            // "not synced today", never "not refreshed today": the second reads
            // as a failure to act, and it was firing at holdings that had been
            // refreshed minutes earlier into a market that was simply shut.
            if (stale) return { stale: true, label: `${stale} holding${stale > 1 ? 's' : ''} not synced today` };
            const newest = priced.map(i => new Date(i.lastNavUpdate || i.priceAsOf).getTime())
                                 .sort((a, b) => b - a)[0];
            const t = new Date(newest).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
            return { stale: false, label: close ? `Synced ${t} · ${close} at last close` : `Synced ${t}` };
        },

        /* Things that genuinely need a decision. Deliberately capped and
           deliberately empty-able: a permanent "all clear" row trains people to
           ignore the section. */
        get attentionItems() {
            const out = [];
            const f = this.portfolioFreshness;
            if (f.stale) out.push({ id: 'stale', title: 'Prices need a refresh', detail: f.label, page: 'investments' });

            for (const inv of (this.maturingInvestments || []).slice(0, 2)) {
                const days = Math.ceil((new Date(inv.maturityDate) - Date.now()) / 864e5);
                if (days >= 0 && days <= 30) {
                    out.push({ id: 'mat' + inv.id, title: `${inv.name} matures in ${days} day${days === 1 ? '' : 's'}`,
                               detail: `${this.formatCurrency(this.getInvCurrentValue(inv))} · plan the reinvestment`, page: 'maturity' });
                }
            }
            for (const sip of this.dueSipDebits.slice(0, 2)) {
                out.push({ id: 'sip' + sip.id, title: `${sip.name} was due on the ${this.ordinal(sip.dayOfMonth)}`,
                           detail: `${this.formatCurrency(sip.monthlyAmount)} · confirm it went through`,
                           // Routes to where the Confirm button actually is. It used to
                           // point at a tab on the planning page; that tab is gone and
                           // the recurring-contributions list now lives here.
                           page: 'income' });
            }
            if (Number(this.efGap) > 0 && Number(this.emergency.efMonthly) > 0) {
                out.push({ id: 'ef', title: 'Emergency fund is short',
                           detail: `${this.formatCurrency(this.efGap)} below a ${this.emergency.efMonths}-month buffer`, page: 'emergency' });
            }
            for (const w of (this.concentrationWarnings || []).slice(0, 1)) {
                out.push({ id: 'conc', title: 'Concentrated position', detail: typeof w === 'string' ? w : (w.message || ''), page: 'investments' });
            }
            return out.slice(0, 4);
        },

        /* Allocation as rows rather than a pie. A pie of six slices is harder to
           read than six right-aligned figures, and it cannot show gain. */
        /* Built by walking every holding through the shared classifier and adding
           non-holding balances, so the cards sum to totalAssets by construction. */
        get allocationRows() {
            const total = this.totalAssets || 0;
            const rows = this.HOLDING_CLASSES.map(d => {
                const items = (this.investments || []).filter(i => this._classOf(i) === d.key);
                const value = items.reduce((a, i) => a + this.getInvCurrentValue(i), 0);
                const cost = items.reduce((a, i) => a + this.getInvInvestedCost(i), 0);
                // Name the row after what is in it when everything in it agrees.
                // A debt side that is nothing but an EPF account is EPF, not
                // "Deposits"; a mixed one genuinely IS "Deposits", and calling
                // that by either instrument's name would be a lie.
                const kinds = new Set(items.map(i => this._kindOf(i)));
                return {
                    key: d.key,
                    label: kinds.size === 1 ? [...kinds][0] : d.short,
                    // The row links to a CHIP, and there is no 'us' chip — the
                    // Holdings list bands by market instead. Sending it to a
                    // filter that does not exist would open an empty screen.
                    filter: d.key === 'us' ? 'equity' : d.key,
                    page: 'investments',
                    value,
                    pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : null,
                };
            });

            rows.push({ key: 'cash', label: 'Cash and bank', page: 'networth', filter: 'all',
                        value: (Number(this.networth.bank) || 0) + (Number(this.networth.cash) || 0),
                        pnlPct: null });
            rows.push({ key: 'realty', label: 'Property and other assets', page: 'networth', filter: 'all',
                        value: (Number(this.networth.property) || 0) + (Number(this.networth.otherAsset) || 0),
                        pnlPct: null });

            return rows
                .filter(d => Number(d.value) > 0)
                .map(d => ({ ...d, pct: total ? (Number(d.value) / total) * 100 : 0 }))
                .sort((a, b) => b.value - a.value);
        },

        _token(name, fallback) {
            try {
                const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
                return v || fallback;
            } catch (e) { return fallback; }
        },

        get holdingFilters() {
            // _filterOf, not _classOf: there is no separate US chip, because
            // the list bands by market instead. Labels come from the class of
            // the same name, so equity reads "Stocks" and covers both.
            const present = new Set((this.investments || []).map(i => this._filterOf(i)));
            return [{ key: 'all', label: 'All' },
                    ...this.HOLDING_CLASSES.filter(d => present.has(d.key))
                                           .map(d => ({ key: d.key, label: d.short }))];
        },

        /* The Planning hub.
           This replaced a four-tab bar that hid SEVEN topics behind four
           labels — cashflow, income, pension, emergency, goals, net worth and
           tax — so finding any one of them meant guessing which tab owned it.
           Each area now states the single figure that answers "do I need to
           look at this?", and opens its own screen.

           The figures are computed here rather than in the markup so they are
           assertable, and so the hub cannot quietly disagree with the page it
           links to. */
        get planningAreas() {
            const monthly = Number(this.emergency.efMonthly) || 0;
            const months  = monthly > 0 ? (Number(this.emergency.efCurrent) || 0) / monthly : null;
            const goals   = this.goals || [];
            const target  = goals.reduce((a, g) => a + (Number(g.target) || 0), 0);
            const outside = (Number(this.networth.bank) || 0) + (Number(this.networth.cash) || 0)
                          + (Number(this.networth.property) || 0) - this.totalLiabilities;
            return [
                { key: 'cashflow',  page: 'income',    label: 'Cashflow',
                  figure: this.formatCurrency(this.monthlySurplus),
                  detail: `${this.formatCurrency(this.totalIncome)} in · ${this.formatCurrency(this.totalExpense)} out` },
                { key: 'goals',     page: 'goals',     label: 'Goals',
                  figure: target > 0 ? this.formatCurrency(target) : 'Nothing set',
                  detail: goals.length ? `${goals.length} active` : 'Add what you are saving for' },
                { key: 'emergency', page: 'emergency', label: 'Emergency fund',
                  figure: months === null ? 'Not sized' : `${months.toFixed(1)} months`,
                  detail: months === null ? 'Set a monthly figure first'
                                          : `against a ${this.emergency.efMonths}-month buffer` },
                { key: 'tax',       page: 'tax',       label: 'Tax',
                  figure: this.formatCurrency(this.netTaxPayable),
                  detail: `${this.effectiveRegime === 'old' ? 'Old' : 'New'} regime` },
                { key: 'pension',   page: 'pension',   label: 'Pension',
                  figure: this.formatCurrency(this.pension.monthlyAmount),
                  detail: Number(this.pension.monthlyAmount) > 0 ? 'every month' : 'Not set up' },
                { key: 'networth',  page: 'networth',  label: 'Assets and debts',
                  figure: this.formatCurrency(outside),
                  detail: 'outside your holdings' },
            ];
        },


        /* One line under a holding's name saying what it actually is, in the
           terms the user entered it in — units and price for market
           instruments, rate and maturity for fixed income. */
        holdingSubtitle(inv) {
            const t = inv.type || '';
            if (t.includes('Stock') || t.includes('ETF')) {
                const cur = inv.currency === 'USD' ? '$' : '\u20b9';
                return `${Number(inv.units || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })} @ ${cur}${Number(inv.currentPrice || 0).toLocaleString('en-IN')}`;
            }
            if (t === 'Mutual Fund') {
                return `${Number(inv.units || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} units @ \u20b9${Number(inv.currentPrice || 0).toFixed(2)}`;
            }
            if (t === 'Gold') return `${Number(inv.units || 0)} g`;
            const rate = inv.rate;
            if (Number(rate) > 0) {
                const m = inv.maturityDate ? ` \u00b7 matures ${this.formatDate(inv.maturityDate)}` : '';
                return `${rate}%${m}`;
            }
            return inv.issuer || t;
        },

        /* ONE classifier. The Holdings page grouped by this while the Overview's
           allocation used a separate `debtAndEpfList` filter that did not match
           'Bank FD' — the default type in the Add form — so every fixed deposit was
           missing from the allocation while still counted in the Total beneath it. */
        _classOf(inv) {
            const t = inv.type || '';
            if (inv.currency === 'USD' || t.includes('(US)')) return 'us';
            if (t.includes('Stock') || t.includes('ETF')) return 'equity';
            if (t === 'Mutual Fund') return 'mf';
            if (t === 'Gold') return 'gold';
            if (t === 'Real Estate') return 'property';
            return 'debt';
        },

        /* Which market a HOLDING trades in, or null for anything that does not
           trade. Distinct from _marketOf below, which reads a bare type string
           for the symbol search and returns null for an unsuffixed legacy
           'Stock'. This one has the whole record, so it can fall back to
           currency — a US holding entered before the type suffix existed
           carries USD and nothing else — and it defaults the rest to IND,
           because an unsuffixed holding in an Indian investor's app is Indian.

           Named apart on purpose: two `_marketOf`s in one object literal is
           not an overload, it is the second one silently winning. That is
           exactly what happened here, and it threw on the first render. */
        _marketBand(inv) {
            const t = (inv && inv.type) || '';
            if (!t.includes('Stock') && !t.includes('ETF')) return null;
            return ((inv && inv.currency) === 'USD' || t.includes('(US)')) ? 'US' : 'IND';
        },

        /* Which CHIP a holding belongs under. Deliberately coarser than
           _classOf: Indian and US equities are separate lines on the dashboard,
           because knowing the split is the point there — but on the Holdings
           page they are one list of stocks, banded by market. Two chips meant
           "Stocks" showed half your equities and the other half hid behind a
           chip most people never scrolled to. */
        _filterOf(inv) {
            const c = this._classOf(inv);
            return c === 'us' ? 'equity' : c;
        },

        /* What KIND of thing this is, in the words a row should use. _classOf
           answers "which bucket"; this answers "which instrument", and on a
           bucket holding only one instrument the second is strictly more
           informative — "Deposits ₹28,874" hides the only fact that made the
           number mean anything, which was that it is an EPF balance.

           'Government Scheme' and 'Other' are containers rather than
           instruments: EPF, PPF, NPS and SSY all land in them, and EPF is not
           even in `investmentTypes`. For those the holding's own NAME is the
           only place the real instrument is recorded, so that is what is
           used. Everywhere else the name is wrong for this job — "NVIDIA Corp"
           is a company, not a kind of thing to own. */
        _kindOf(inv) {
            const t = (inv && inv.type) || '';
            const m = this._marketBand(inv);
            if (t.includes('Stock')) return `Stocks (${m})`;
            if (t.includes('ETF'))   return `ETFs (${m})`;
            if (t === 'Mutual Fund') return 'Mutual Funds';
            if (t === 'Bank FD')     return 'Fixed deposits';
            if (t === 'Bond')        return 'Bonds';
            if (t === 'Gold')        return 'Gold';
            if (t === 'Real Estate') return 'Property';
            return ((inv && inv.name) || '').trim() || t;
        },

        HOLDING_CLASSES: [
            { key: 'equity',   label: 'Stocks and ETFs',             short: 'Stocks' },
            { key: 'mf',       label: 'Mutual funds',                short: 'Mutual Funds' },
            { key: 'debt',     label: 'Deposits, bonds and schemes', short: 'Deposits' },
            { key: 'us',       label: 'US equities',                 short: 'Stocks (US)' },
            { key: 'gold',     label: 'Gold',                        short: 'Gold' },
            { key: 'property', label: 'Property',                    short: 'Property' },
        ],

        get visibleHoldings() {
            const all = this.investments || [];
            return this.invFilter === 'all' ? all : all.filter(i => this._filterOf(i) === this.invFilter);
        },

        /* The Holdings list, banded by market. Stocks and ETFs carry a brass
           "IND" / "US" heading; everything else has no market to name and sits
           in one unheaded group above them, so a deposit is not filed under a
           country it does not trade in.

           Home market first. The two are listed here in the order they are
           read, not in the order they were asked for. */
        get holdingGroups() {
            const plain = [];
            const banded = { IND: [], US: [] };
            for (const inv of this.visibleHoldings) {
                const m = this._marketBand(inv);
                if (m) banded[m].push(inv);
                else plain.push(inv);
            }
            const out = [];
            if (plain.length) out.push({ key: 'plain', heading: '', items: plain });
            for (const m of ['IND', 'US']) {
                if (banded[m].length) out.push({ key: m, heading: m, items: banded[m] });
            }
            return out;
        },

        sipDaysUntil(sip) {
            const today = new Date().getDate();
            const debit = Number(sip.dayOfMonth);
            if (!debit) return null;
            return debit >= today ? debit - today : (31 - today) + debit;
        },

        get isDetailView() {
            const s = this.SURFACES.find(x => x.views.includes(this.activePage));
            return !!s && this.activePage !== s.root;
        },

        get detailParent() {
            const s = this.SURFACES.find(x => x.views.includes(this.activePage));
            return s ? s.root : 'home';
        },

        goBack() {
            if (this.isDetailView) { this.activePage = this.detailParent; return true; }
            if (this.activePage !== 'home') { this.activePage = 'home'; return true; }
            return false;
        },

        isUnitPriced(type) {
            const t = type || '';
            return t.includes('Stock') || t.includes('ETF') || t === 'Mutual Fund' || t === 'Gold';
        },
        needsTicker(type) {
            const t = type || '';
            return t.includes('Stock') || t.includes('ETF');
        },

        /* Instruments that carry a stated interest rate. Two call sites each held their
           own copy of this list, and neither included the types the PDF importer emits
           ('FD', 'Fixed Deposit'), so editing an imported deposit silently zeroed its
           rate — and with it the interest income the whole tax screen is built on. */
        isRateBearing(type) {
            const t = (type || '').toLowerCase();
            return /fd|fixed deposit|bond|government|post office|ppf|epf|nsc|scss|rd|recurring/.test(t);
        },

        /* What ranges an instrument can honestly offer.
           Offering a range the data cannot fill is inventing history. AMFI
           publishes ONE NAV per day, so a fund has no intraday series and a
           '1D' tab on one draws a single point. A deposit has no market price
           at all — it accrues at a contracted rate — so it gets no chart
           whatever, and property has no series either. Returning null means
           "this instrument is not quoted", not "no data yet". */
        CHART_RANGES: {
            intraday: ['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'],
            daily:    ['1W', '1M', '3M', '6M', '1Y', 'ALL'],
        },

        chartRangesFor(inv) {
            if (!inv) return null;
            if (this.isRateBearing(inv.type)) return null;
            /* No price source, no series — whatever the type is called. Asking
               the TYPE whether something is quotable fails on 'Other', on
               'Real Estate', and on anything the PDF importer invents; asking
               whether it has a ticker or a scheme code is the same question
               the sync already answers, so the two cannot disagree. */
            if (!inv.ticker && !inv.schemeCode) return null;
            return this.needsTicker(inv.type) ? this.CHART_RANGES.intraday
                                              : this.CHART_RANGES.daily;
        },

        // ── Holding detail ──────────────────────────────────────────────
        get detailHolding() {
            if (!this.detailHoldingId) return null;
            return (this.investments || []).find(i => i.id === this.detailHoldingId) || null;
        },

        openHolding(inv) {
            if (!inv || !inv.id) return;
            this.detailHoldingId = inv.id;
            const ranges = this.chartRangesFor(inv);
            // '1M' is not always offered — a fund has no 1D, and clamping to a
            // range the instrument does not have would leave the selector with
            // nothing active.
            this.detailRange = ranges && ranges.includes('1M') ? '1M' : (ranges ? ranges[0] : null);
            this.activePage = 'holding';
        },

        /* Label-and-value pairs for the detail view, varying by instrument.
           A deposit's rate and maturity matter and its "units" do not; a US
           stock needs the USD price and the rate it was converted at, because
           without them a rupee figure that moved on FX alone looks like a
           gain. */
        get holdingFacts() {
            const i = this.detailHolding;
            if (!i) return [];
            const f = [];
            const units = Number(i.units) || 0;
            const isUsd = i.currency === 'USD' || ['Stock (US)', 'ETF (US)'].includes(i.type);
            const pnl = this.getInvPnL(i);

            if (units > 0) {
                f.push({ label: 'Units held',      value: units.toLocaleString('en-IN') });
                // buyPrice is stored in the instrument's OWN currency —
                // getInvInvestedCost applies fxUsdInr on the way out — so
                // formatting it as rupees printed Broadcom's $218 average as
                // ₹218, two rows above a "Price in USD" that proved the app
                // knew better. The INR equivalent is appended rather than
                // substituted, because both readings are useful.
                const avg = Number(i.buyPrice) || 0;
                f.push({ label: 'Average cost', value: isUsd
                    ? `${this.formatNative(i, avg)}  (${this.formatCurrency(avg * this.fxUsdInr)})`
                    : this.formatNative(i, avg) });
            }
            f.push({ label: 'Amount invested', value: this.formatCurrency(this.getInvInvestedCost(i)) });
            f.push({ label: 'Current value',   value: this.formatCurrency(this.getInvCurrentValue(i)) });
            f.push({ label: 'Total gain',      value: this.formatCurrency(pnl), tone: pnl >= 0 ? 'up' : 'down' });

            if (this.isRateBearing(i.type)) {
                f.push({ label: 'Interest rate', value: `${Number(i.rate) || 0}% p.a.` });
                if (i.maturityDate) f.push({ label: 'Matures', value: this.formatDate(i.maturityDate) });
            } else if (this._classOf(i) === 'mf') {
                f.push({ label: 'NAV', value: this.formatCurrency(Number(i.currentPrice) || Number(i.nav) || 0) });
                if (i.schemeCode) f.push({ label: 'Scheme code', value: String(i.schemeCode) });
            }
            if (isUsd) {
                f.push({ label: 'Price in USD',   value: `$${(Number(i.currentPrice) || 0).toFixed(2)}` });
                f.push({ label: 'USD → INR used', value: this.formatCurrency(this.fxUsdInr) });
            }
            return f;
        },

        /* How far a deposit is through its tenure. This is what replaces the
           chart on a rate-bearing holding: it accrues rather than moves, so
           the honest visual is progress toward maturity, not a price line. */
        get depositProgress() {
            const i = this.detailHolding;
            if (!i || !this.isRateBearing(i.type) || !i.maturityDate) return null;
            const end = new Date(i.maturityDate).getTime();
            const start = i.startDate ? new Date(i.startDate).getTime() : null;
            if (!Number.isFinite(end)) return null;
            const now = Date.now();
            const days = Math.max(0, Math.ceil((end - now) / 864e5));
            const pct = start && end > start
                ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))
                : null;
            return { pct, days, matures: this.formatDate(i.maturityDate),
                     opened: i.startDate ? this.formatDate(i.startDate) : null };
        },

        /* The canonical instrument list, in the order an Indian investor is
           likely to hold them rather than alphabetically. */
        investmentTypes: [
            'Bank FD', 'Bond', 'Government Scheme', 'Mutual Fund',
            'Stock (IND)', 'Stock (US)', 'ETF (IND)', 'ETF (US)',
            'Gold', 'Real Estate', 'Other',
        ],

        addHoldingContext: 'all',

        openAddHolding(context = null) {
            const ctx = context || (this.activePage === 'investments' ? this.invFilter : 'all');
            this.addHoldingContext = ctx;
            this.resetNewInvForm(ctx);
            this.addingInv = true;
        },

        closeAddHolding() {
            this.resetNewInvForm();
            this.addingInv = false;
        },

        resetNewInvForm(context = null) {
            const ctx = context || this.addHoldingContext || 'all';
            let defaultType = 'Stock (IND)';
            if (ctx === 'mf') defaultType = 'Mutual Fund';
            else if (ctx === 'debt') defaultType = 'Bank FD';
            else if (ctx === 'gold') defaultType = 'Gold';
            else if (ctx === 'equity') defaultType = 'Stock (IND)';

            this.newInv = {
                name: '',
                type: defaultType,
                issuer: '',
                amount: '',
                rate: '',
                payout: 'Monthly',
                rating: '',
                maturityDate: '',
                ticker: '',
                units: '',
                buyPrice: '',
                currentPrice: '',
                schemeCode: '',
                currency: defaultType.includes('US') ? 'USD' : 'INR'
            };

            // Clear search query & results so draft state never bleeds into other openings
            clearTimeout(this.symbolSearch?._timer);
            if (this.symbolSearch) {
                this.symbolSearch.query = '';
                this.symbolSearch.results = [];
                this.symbolSearch.error = '';
                this.symbolSearch.loading = false;
            }

            this.mfSearchQuery = '';
            this.mfSearchResults = [];
            this.mfSearchLoading = false;
        },

        get availableInvestmentTypes() {
            switch (this.addHoldingContext) {
                case 'equity':
                    return ['Stock (IND)', 'Stock (US)', 'ETF (IND)', 'ETF (US)'];
                case 'mf':
                    return ['Mutual Fund'];
                case 'debt':
                    return ['Bank FD', 'Bond', 'Government Scheme'];
                case 'gold':
                    return ['Gold'];
                default:
                    return this.investmentTypes;
            }
        },

        setHoldingType(type) {
            if (!type || this.newInv.type === type) return;
            this.newInv.type = type;
            this.newInv.currency = type.includes('(US)') ? 'USD' : 'INR';
            if (this.symbolSearch) {
                this.symbolSearch.results = [];
                this.symbolSearch.error = '';
            }
            this.mfSearchResults = [];
            if (this.newInv.name) {
                if (type === 'Mutual Fund') {
                    this.searchMfScheme(this.newInv.name, this.newInv);
                } else if (this.needsTicker(type)) {
                    this.searchSymbol(this.newInv.name, this.newInv);
                }
            }
            if (window.RFMMotion && window.RFMMotion.Haptics) {
                window.RFMMotion.Haptics.tap();
            }
        },

        /* Every record's id came from Date.now(), in five different shapes across the
           file — a bare number, a float with Math.random() mixed in, 'inv_' + now, and
           `ai_${now}_${i}`. Two holdings created inside the same millisecond therefore
           shared an id, and deleteInvestment filters by id, so removing one removed both
           and an edit could land on the wrong row. A counter makes that impossible
           regardless of clock resolution. */
        _idSeq: 0,
        newId(prefix) {
            this._idSeq += 1;
            return `${prefix}_${Date.now().toString(36)}_${this._idSeq}`;
        },

        ordinal(n) {
            const v = Number(n) || 0;
            const s = ['th', 'st', 'nd', 'rd'], k = v % 100;
            return v + (s[(k - 20) % 10] || s[k] || s[0]);
        },

        /* Money that moves without anyone doing anything — maturities and SIP
           debits — on one timeline. This is the "what did I forget" surface. */
        get upcomingEvents() {
            const out = [];
            for (const inv of (this.maturingInvestments || []).slice(0, 4)) {
                const days = Math.ceil((new Date(inv.maturityDate) - Date.now()) / 864e5);
                if (days < 0 || days > 120) continue;
                out.push({ id: 'm' + inv.id, title: `${inv.name} matures`,
                           when: days === 0 ? 'Today' : `In ${days} day${days === 1 ? '' : 's'} · ${this.formatDate(inv.maturityDate)}`,
                           amount: this.getInvCurrentValue(inv), direction: 'in', sort: days });
            }
            for (const sip of (this.activeSips || []).slice(0, 4)) {
                const days = this.sipDaysUntil(sip);
                if (days === null || days > 45) continue;
                out.push({ id: 's' + sip.id, title: `${sip.name}`,
                           when: days === 0 ? 'Debits today' : `Debits in ${days} day${days === 1 ? '' : 's'}`,
                           amount: sip.monthlyAmount, direction: 'out', sort: days });
            }
            return out.sort((a, b) => a.sort - b.sort).slice(0, 5);
        },

        /* ── Since you last looked ─────────────────────────────────────────
           Every portfolio app shows what you are worth. Almost none show what
           CHANGED while you were away, which is the thing a person actually
           opens the app to find out. Recorded per visit, reported once, and
           only when the gap is long enough for the answer to be interesting. */
        _visit: { at: null, value: null },

        loadVisit() {
            try {
                const raw = localStorage.getItem('corpus_last_visit');
                if (raw) this._visit = JSON.parse(raw);
            } catch (e) { /* first run, or cleared storage */ }
        },

        /* Written on the way OUT, not on load: stamping it at boot would make
           the comparison always read zero. */
        recordVisit() {
            try {
                localStorage.setItem('corpus_last_visit', JSON.stringify({
                    at: new Date().toISOString(),
                    value: Math.round(this.netWorthTotal),
                }));
            } catch (e) {}
        },

        get sinceLastLook() {
            const v = this._visit;
            if (!v || !v.at || !Number.isFinite(Number(v.value))) return null;
            if (!this.hasAnyPortfolioData) return null;

            const hours = (Date.now() - new Date(v.at).getTime()) / 36e5;
            if (hours < 8) return null;                 // too soon to be news
            const delta = Math.round(this.netWorthTotal) - Number(v.value);
            if (Math.abs(delta) < 1) return null;       // nothing moved

            const days = Math.floor(hours / 24);
            let when;
            if (days < 1)      when = 'since this morning';
            else if (days === 1) when = 'since yesterday';
            else if (days < 7) when = `since ${new Date(v.at).toLocaleDateString('en-IN', { weekday: 'long' })}`;
            else if (days < 31) when = `in the last ${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? '' : 's'}`;
            else               when = `since ${this.formatDate(v.at)}`;

            return { delta, up: delta >= 0, when,
                     label: `${delta >= 0 ? 'Up' : 'Down'} ${this.formatCurrency(Math.abs(delta))} ${when}` };
        },

        /* The range chip says "1M"; the sentence needs "past month". Built here
           rather than with three chained .replace() calls in the template, which
           is where "1 months" came from. */
        get rangeLabel() {
            return ({ '1W': 'past week', '1M': 'past month', '3M': 'past 3 months',
                      '6M': 'past 6 months', '1Y': 'past year', 'ALL': 'all time' })[this.nwChartRange] || '';
        },

        /* Signed, unlike efGap which clamps at zero. Positive means over-funded,
           which is a real state worth naming: money sitting in a liquid account
           past what the buffer needs is money not working. */
        get efSurplus() {
            return (Number(this.emergency.efCurrent) || 0) - (Number(this.efRequired) || 0);
        },

        goalTypes: ['Emergency Fund', 'Retirement', 'House', 'Education', 'Travel', 'New Car', 'Other'],

        toggleHaptics() {
            this.haptics = !this.haptics;
            try { localStorage.setItem('corpus_haptics', this.haptics ? 'on' : 'off'); } catch (e) {}
            if (this.haptics && window.RFMMotion) window.RFMMotion.Haptics.commit();
        },

        /* ── Symbol search ─────────────────────────────────────────────────
           Typing "nvidia" should produce NVDA — NVIDIA Corporation — NASDAQ,
           not leave the user to know the ticker themselves. Yahoo's search
           endpoint covers US listings and Indian ones (NSE arrives as
           RELIANCE.NS), so one lookup serves stocks and ETFs on both markets.

           Results are filtered to the market the form is asking for: choosing
           "Stock (US)" and typing "reliance" should NOT offer an NSE listing,
           because the price path and the currency both differ. */
        symbolSearch: { query: '', results: [], loading: false, error: '', _timer: null, _seq: 0 },

        _marketOf(type) {
            const t = type || '';
            if (t.includes('(US)')) return 'US';
            if (t.includes('(IND)')) return 'IND';
            return null;
        },

        searchSymbol(query, form) {
            const q = (query || '').trim();
            this.symbolSearch.query = q;
            clearTimeout(this.symbolSearch._timer);
            if (q.length < 2) {
                this.symbolSearch.results = [];
                this.symbolSearch.error = '';
                this.symbolSearch.loading = false;
                return;
            }
            // Debounced: a lookup per keystroke would hammer a public endpoint
            // and the answer for a 2-character prefix is never the one wanted.
            this.symbolSearch._timer = setTimeout(() => this._runSymbolSearch(q, form), 280);
        },

        async _runSymbolSearch(q, form) {
            const seq = ++this.symbolSearch._seq;
            this.symbolSearch.loading = true;
            this.symbolSearch.error = '';
            const want = this._marketOf(form && form.type);
            const wantEtf = (form && form.type || '').includes('ETF');

            const url1 = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=14&newsCount=0&listsCount=0`;
            const url2 = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=14&newsCount=0&listsCount=0`;
            try {
                const data = await this.firstSuccessful([
                    ...(this.marketProxy ? [async () => JSON.parse(await this.httpGetText(this.marketProxy + encodeURIComponent(url1), 5000))] : []),
                    () => this.httpGetJson(url1, 4000),
                    () => this.httpGetJson(url2, 4000),
                    () => this.httpGetJson(`https://api.allorigins.win/raw?url=${encodeURIComponent(url1)}`, 6000),
                ]);
                // A later keystroke already superseded this lookup.
                if (seq !== this.symbolSearch._seq) return;

                const allQuotes = (data && data.quotes || [])
                    .filter(r => r.symbol && (r.quoteType === 'EQUITY' || r.quoteType === 'ETF'))
                    .map(r => {
                        const isNse = /\.(NS|BO)$/i.test(r.symbol);
                        return {
                            symbol: r.symbol,
                            ticker: r.symbol.replace(/\.(NS|BO)$/i, ''),
                            name: r.longname || r.shortname || r.symbol,
                            exchange: r.exchDisp || (isNse ? 'NSE' : ''),
                            market: isNse ? 'IND' : 'US',
                            isEtf: r.quoteType === 'ETF',
                        };
                    });

                const rows = allQuotes
                    .filter(r => !want || r.market === want)
                    .filter(r => !wantEtf || r.isEtf)
                    .slice(0, 7);

                this.symbolSearch.results = rows;
                if (!rows.length) {
                    const hasUs = allQuotes.some(r => r.market === 'US');
                    if (want === 'IND' && hasUs) {
                        this.symbolSearch.error = `No Indian listing for "${q}". Tap "Stock (US)" above for US listings.`;
                    } else {
                        this.symbolSearch.error = want === 'IND' ? `Nothing on NSE or BSE matching "${q}".`
                                                                : `No ${wantEtf ? 'ETF' : 'listing'} found for "${q}".`;
                    }
                } else {
                    this.symbolSearch.error = '';
                }
            } catch (e) {
                if (seq !== this.symbolSearch._seq) return;
                this.symbolSearch.results = [];
                this.symbolSearch.error = 'Could not reach the symbol lookup. You can still type the ticker yourself.';
            } finally {
                if (seq === this.symbolSearch._seq) this.symbolSearch.loading = false;
            }
        },

        selectSymbol(form, r) {
            if (!form || !r) return;
            form.name   = r.name;
            form.ticker = r.ticker;
            form.type   = r.isEtf ? (r.market === 'US' ? 'ETF (US)' : 'ETF (IND)')
                                  : (r.market === 'US' ? 'Stock (US)' : 'Stock (IND)');
            form.currency = r.market === 'US' ? 'USD' : 'INR';
            this.symbolSearch.results = [];
            this.symbolSearch.query = '';
            if (this.haptics && window.RFMMotion) window.RFMMotion.Haptics.commit();
        },

        /* ── Logos ──────────────────────────────────────────────────────────
           A holding is recognised by its mark long before its name is read, so the
           search list shows the real one where a real one exists.

           The monogram below is NOT replaced by this — it is the layer underneath.
           The `img` is transparent until its own load event fires, so a symbol with
           no logo, a 404, or no network at all leaves the monogram showing and never
           a broken image. That was the whole objection to remote logos, and it is
           answered by layering rather than by going without.

           Sources, all free and key-less, verified 2026-09-18:
             NSE  — dharunashokkumar.github.io/indian-listed-company-logos (2,468 NSE
                    listings, static SVG, clean 404 on a miss)
             US   — images.financialmodelingprep.com (covers ETFs as well as stocks)
           Mutual funds have no logo of their own, so they borrow their AMC's. Only
           AMCs whose parent is NSE-listed AND unambiguous are mapped: "Tata" resolves
           to Tata Motors, which is a different company, so Tata funds are deliberately
           left to the monogram. A wrong logo is worse than none. */
        logoHost(kind) {
            return kind === 'us'
                ? 'https://images.financialmodelingprep.com/symbol/'
                : 'https://dharunashokkumar.github.io/indian-listed-company-logos/nse/NSE_';
        },

        /* Prefix-matched against the AMFI scheme name, longest first so "Aditya Birla
           Sun Life" is not shadowed by a shorter entry. */
        AMC_TICKERS: [
            ['aditya birla sun life', 'ABSLAMC'],
            ['icici prudential',      'ICICIBANK'],
            ['motilal oswal',         'MOTILALOFS'],
            ['kotak mahindra',        'KOTAKBANK'],
            ['edelweiss',             'EDELWEISS'],
            ['360 one',               '360ONE'],
            ['kotak',                 'KOTAKBANK'],
            ['hdfc',                  'HDFCAMC'],
            ['axis',                  'AXISBANK'],
            ['sbi',                   'SBIN'],
            ['uti',                   'UTIAMC'],
            ['jm ',                   'JMFINANCIL'],
        ],

        _amcTicker(schemeName) {
            const n = (schemeName || '').trim().toLowerCase();
            if (!n) return null;
            for (const [prefix, ticker] of this.AMC_TICKERS) {
                if (n.startsWith(prefix)) return ticker;
            }
            return null;
        },

        /* Accepts anything carrying a type/ticker/name — a holding, a market search
           result, or an AMFI scheme. Returns null when nothing sound can be built,
           which is the signal to render the monogram alone. */
        logoUrl(entity) {
            if (!entity) return null;
            const type = entity.type || (entity.market === 'US' ? 'Stock (US)'
                        : entity.market === 'IND' ? 'Stock (IND)'
                        : entity.schemeName || entity.schemeCode ? 'Mutual Fund' : '');
            const sym = String(entity.ticker || entity.symbol || '')
                .trim().toUpperCase().replace(/\.(NS|BO)$/, '');

            if (type === 'Mutual Fund') {
                const amc = this._amcTicker(entity.name || entity.schemeName);
                return amc ? this.logoHost('nse') + amc + '.svg' : null;
            }
            if (!sym || !/^[A-Z0-9.&-]{1,20}$/.test(sym)) return null;
            if (type.includes('(US)')) return this.logoHost('us') + encodeURIComponent(sym) + '.png';
            if (type.includes('Stock') || type.includes('ETF')) {
                return this.logoHost('nse') + encodeURIComponent(sym) + '.svg';
            }
            return null;
        },

        /* A monogram, generated from the symbol itself. Deliberately not a
           remote logo: a logo service that 404s leaves a broken image in a
           finance app, and there is no free source that covers NSE listings
           reliably. Deterministic hue means the same holding always reads the
           same colour, which is most of what a logo does at this size. */
        symbolMark(sym) {
            const s = String(sym || '?').toUpperCase();
            let h = 0;
            for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
            return { text: s.slice(0, 2), hue: h };
        },

        get hasAnyPortfolioData() {
            const nz = v => Number(v) > 0;
            return (this.investments || []).length > 0
                || (this.goals       || []).length > 0
                || (this.sips        || []).length > 0
                || (this.nwHistory   || []).length > 0
                || Object.values(this.networth || {}).some(nz)
                || ((this.cashflow || {}).incomes  || []).some(i => nz(i.amount))
                || ((this.cashflow || {}).expenses || []).some(e => nz(e.amount))
                || nz((this.emergency || {}).efCurrent);
        },

        get optimalRegime() {
            return this.oldRegimeTax.tax < this.newRegimeTax.tax ? 'Old' : 'New';
        },

        // ── ADVANCE TAX SCHEDULE ─────────────────────────────────────
        // Advance tax is only required if total tax liability > ₹10,000
        // Pension earners (TDS on pension by bank) are usually exempt,
        // but for self-assessment income they may need to pay.
        get advanceTaxSchedule() {
            const annualTax = this.incomeTaxPayable;
            if (annualTax <= 10000) return null; // Below threshold — no advance tax needed

            const year  = new Date().getFullYear();
            const nextFY = new Date().getMonth() >= 3 ? year : year - 1; // FY starts April

            return [
                { due: `15 Jun ${nextFY}`,   pct: 15, amount: Math.round(annualTax * 0.15) },
                { due: `15 Sep ${nextFY}`,   pct: 45, amount: Math.round(annualTax * 0.45) },
                { due: `15 Dec ${nextFY}`,   pct: 75, amount: Math.round(annualTax * 0.75) },
                { due: `15 Mar ${nextFY + 1}`, pct: 100, amount: annualTax }
            ];
        },

        get itrFormRecommendation() {
            const hasCapGains     = (this.equityLTCG?.totalGains > 0 || this.equitySTCG?.totalGains > 0 || this.totalCapitalGainsTax > 0);
            const hasForeignAssets = false;
            const hasBusiness     = Number(this.cashflow.project) > 0;
            const income          = this.grossAnnualIncome;

            if (hasForeignAssets || hasCapGains) return 'ITR-2';
            if (hasBusiness) return 'ITR-3';
            if (income <= 5000000) return 'ITR-1';
            return 'ITR-2';
        },

        get itrDeadline() {
            const year = new Date().getFullYear();
            // Standard deadline: 31 July of assessment year
            return `31 July ${new Date().getMonth() >= 3 ? year + 1 : year}`;
        },

        // ── ITR CHECKLIST ITEMS ──────────────────────────────────────
        get itrChecklist() {
            const items = [
                // Always required
                { cat: 'Identity & Bank', done: false, doc: 'PAN Card', note: 'Required for all ITR forms' },
                { cat: 'Identity & Bank', done: false, doc: 'Aadhaar Number', note: 'Linked to PAN for e-verification' },
                { cat: 'Identity & Bank', done: false, doc: 'Bank Account Details (IFSC, Account No.)', note: 'For refund credit' },
                // Income docs
                { cat: 'Income Documents', done: false, doc: 'Form 16 / Pension Certificate', note: `Annual pension: ${this.formatCurrency(this.annualPension)}` },
                { cat: 'Income Documents', done: false, doc: 'Bank Interest Certificates (Form 16A)', note: 'From all banks where FDs or savings accounts exist' },
                { cat: 'Income Documents', done: false, doc: 'Annual Information Statement (AIS)', note: 'Download from Income Tax portal — cross-check all entries' },
                { cat: 'Income Documents', done: false, doc: 'Form 26AS', note: 'Tax credit statement — must match your filing' },
            ];

            // Conditional items
            if (this.tax.deduction80C > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: '80C Proof (LIC/PPF/NSC/ELSS receipts)', note: `Claimed: ${this.formatCurrency(this.tax.deduction80C)}` });
            if (this.tax.deduction80D > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: '80D Medical Insurance Premium Receipt', note: `Claimed: ${this.formatCurrency(this.tax.deduction80D)}` });
            if (this.tax.seniorCitizen && this.tax.deduction80TTB > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: '80TTB Interest Income Statement (Senior)', note: `Claimed: ${this.formatCurrency(this.tax.deduction80TTB)}` });
            if (!this.tax.seniorCitizen && this.tax.deduction80TTA > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: '80TTA Savings Interest Statement', note: `Claimed: ${this.formatCurrency(this.tax.deduction80TTA)}` });
            if (this.tax.homeLoanInterest > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: 'Home Loan Interest Certificate (Sec 24)', note: `Claimed: ${this.formatCurrency(this.tax.homeLoanInterest)}` });
            if (Number(this.cashflow.project) > 0)
                items.push({ cat: 'Income Documents', done: false, doc: 'Consulting/Project Income Records', note: 'Invoice copies, payment receipts' });

            // Investment-related
            if (this.investments.length > 0)
                items.push({ cat: 'Investments', done: false, doc: 'Bond/FD Maturity & Interest Statements', note: `${this.investments.length} holdings — collect from each issuer` });

            // Filing
            items.push({ cat: 'Filing', done: false, doc: `File ${this.itrFormRecommendation} on Income Tax Portal`, note: `Due: ${this.itrDeadline}` });
            items.push({ cat: 'Filing', done: false, doc: 'E-verify ITR (within 30 days)', note: 'Via Aadhaar OTP, Net Banking, or DSC' });

            return items;
        },

        // Group ITR checklist by category
        get itrChecklistGrouped() {
            const groups = {};
            this.itrChecklist.forEach(item => {
                if (!groups[item.cat]) groups[item.cat] = [];
                groups[item.cat].push(item);
            });
            return Object.entries(groups).map(([cat, items]) => ({ cat, items }));
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — GOALS (Deliverable 3)
        // ════════════════════════════════════════════════════════════
        get goalsProgress() {
            return this.goals.map(g => {
                const target  = Number(g.target)  || 0;
                const current = Number(g.current) || 0;
                const pct     = target > 0 ? Math.min(100, (current / target) * 100).toFixed(0) : 0;
                const gap     = Math.max(0, target - current);

                let monthlyNeeded = 0;
                if (g.targetDate && current < target) {
                    const now   = new Date();
                    const end   = new Date(g.targetDate);
                    const months = Math.max(1,
                        (end.getFullYear() - now.getFullYear()) * 12 +
                        (end.getMonth()    - now.getMonth()));
                    monthlyNeeded = Math.ceil(gap / months);
                }

                return { ...g, pct: Number(pct), gap, monthlyNeeded };
            });
        },

        get nextGoalMilestone() {
            const active = this.goalsProgress.filter(g => g.pct < 100);
            if (active.length === 0) return null;
            return active.sort((a, b) => b.pct - a.pct)[0];
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — FINANCIAL HEALTH SCORE (Phase 3 upgrade)
        //  5 Dimensions: Savings, Emergency, Diversification, Liquidity, Concentration
        // ════════════════════════════════════════════════════════════

        // Dim 1 — Savings Rate (0–30 pts)
        get scoreD1Savings() {
            if (this.totalIncome <= 0) return 0;
            const sr = (this.monthlySurplus / this.totalIncome) * 100;
            if (sr >= 30) return 30;
            if (sr >= 20) return 22;
            if (sr >= 10) return 14;
            if (sr >   0) return 7;
            return 0;
        },

        // Dim 2 — Emergency Fund (0–25 pts)
        get scoreD2Emergency() {
            const monthsCovered = this.emergency.efMonthly > 0
                ? Number(this.emergency.efCurrent) / Number(this.emergency.efMonthly)
                : 0;
            if (monthsCovered >= 12) return 25;
            if (monthsCovered >= 6)  return 20;
            if (monthsCovered >= 3)  return 12;
            if (monthsCovered >= 1)  return 5;
            return 0;
        },

        // Dim 3 — Diversification (0–20 pts)
        get scoreD3Diversification() {
            const types   = new Set(this.investments.map(i => i.type)).size;
            const issuers = new Set(this.investments.map(i => i.issuer || i.name)).size;
            let pts = 0;
            if (types >= 4)   pts += 10; else if (types >= 2) pts += 5;
            if (issuers >= 5) pts += 10; else if (issuers >= 3) pts += 5;
            return pts;
        },

        // Dim 4 — Liquidity (0–15 pts)
        // % of total assets in liquid form (bank + cash vs. locked in FD/bonds)
        get scoreD4Liquidity() {
            const liquid = Number(this.networth.bank) + Number(this.networth.cash);
            const total  = this.totalAssets;
            if (total <= 0) return 0;
            const pct = (liquid / total) * 100;
            if (pct >= 20) return 15;
            if (pct >= 10) return 10;
            if (pct >= 5)  return 5;
            return 0;
        },

        // Dim 5 — Concentration Risk (0–10 pts)
        get scoreD5Concentration() {
            if (this.investments.length === 0) return 0;
            return this.concentrationWarnings.length === 0 ? 10 : 2;
        },

        get financialHealthScore() {
            return Math.min(100, Math.max(0,
                this.scoreD1Savings +
                this.scoreD2Emergency +
                this.scoreD3Diversification +
                this.scoreD4Liquidity +
                this.scoreD5Concentration
            ));
        },

        get healthLabel() {
            const s = this.financialHealthScore;
            if (s >= 80) return 'Excellent';
            if (s >= 60) return 'Good';
            if (s >= 40) return 'Fair';
            return 'Needs Attention';
        },

        // ── Formatters & Notifications ─────────────────────────────────
        formatCurrency(amount) {
            const val = Number(amount) || 0;
            return new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: 'INR',
                maximumFractionDigits: 0
            }).format(val);
        },

        formatDate(dateStr) {
            if (!dateStr) return 'N/A';
            try {
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return dateStr;
                return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            } catch (e) {
                return dateStr;
            }
        },

        get notificationsList() {
            const list = [];
            const today = new Date();

            // 1. Maturing Investments (within 90 days)
            (this.investments || []).forEach(inv => {
                if (inv.maturityDate) {
                    const mDate = new Date(inv.maturityDate);
                    const diffDays = Math.ceil((mDate - today) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 0 && diffDays <= 90) {
                        list.push({
                            id: 'mat_' + inv.id,
                            type: 'warning',
                            icon: 'calendar_clock',
                            title: `${inv.name} Maturing Soon`,
                            detail: `Matures in ${diffDays} days (${this.formatDate(inv.maturityDate)}) — Value: ${this.formatCurrency(this.getInvCurrentValue(inv))}`,
                            actionPage: 'investments'
                        });
                    } else if (diffDays < 0) {
                        list.push({
                            id: 'mat_exp_' + inv.id,
                            type: 'alert',
                            icon: 'history',
                            title: `${inv.name} Has Matured`,
                            detail: `Matured on ${this.formatDate(inv.maturityDate)}. Consider reinvesting.`,
                            actionPage: 'investments'
                        });
                    }
                }
            });

            // 2. Concentration Risk Warnings
            (this.concentrationWarnings || []).forEach((w, idx) => {
                list.push({
                    id: 'conc_' + idx,
                    type: 'alert',
                    icon: 'warning',
                    title: 'High Concentration Risk',
                    detail: `${w.name} accounts for ${w.pct}% of your total portfolio. Consider diversifying.`,
                    actionPage: 'investments'
                });
            });

            // 3. Upcoming SIP Debits (Next 7 days)
            const currentDay = today.getDate();
            (this.activeSips || []).forEach(sip => {
                const debitDay = Number(sip.dayOfMonth) || 5;
                let daysUntil = debitDay - currentDay;
                if (daysUntil < 0) daysUntil += 30;
                if (daysUntil <= 7) {
                    list.push({
                        id: 'sip_' + sip.id,
                        type: 'info',
                        icon: 'event_repeat',
                        title: `SIP Debit Approaching: ${sip.name}`,
                        detail: `₹${sip.monthlyAmount} will be debited on the ${debitDay}th of the month.`,
                        actionPage: 'investments'
                    });
                }
            });

            // 4. Emergency Fund Gap Alert
            if (this.efGap > 0) {
                list.push({
                    id: 'ef_gap',
                    type: 'info',
                    icon: 'shield_locked',
                    title: 'Emergency Fund Below Target',
                    detail: `Gap of ${this.formatCurrency(this.efGap)} to reach ${this.emergency.efMonths} months safety buffer.`,
                    actionPage: 'home'
                });
            }

            // Default System Welcome Notification if list is empty
            if (list.length === 0) {
                list.push({
                    id: 'welcome',
                    type: 'success',
                    icon: 'check_circle',
                    title: 'All Systems Optimal',
                    detail: 'No urgent portfolio actions or upcoming maturity alerts at this time.',
                    actionPage: 'home'
                });
            }

            return list;
        },

        get healthStrengths() {
            const s = [];
            const effectiveMonthlyExp = Number(this.emergency.efMonthly) > 0
                ? Number(this.emergency.efMonthly)
                : Number(this.totalExpense) || 0;
            const liquidBuffer = Number(this.emergency.efCurrent) || 0;

            // 1. Emergency buffer check (ONLY fires if actual expenses AND buffer exist!)
            if (effectiveMonthlyExp > 0 && liquidBuffer > 0) {
                const months = liquidBuffer / effectiveMonthlyExp;
                if (months >= 6) {
                    s.push({
                        title: 'Emergency buffer fully funded',
                        detail: `${months.toFixed(1)} months of expenses reserved (${this.formatCurrency(liquidBuffer)}).`
                    });
                } else if (months >= 3) {
                    s.push({
                        title: '3-month emergency safety buffer',
                        detail: `${months.toFixed(1)} months covered (${this.formatCurrency(liquidBuffer)}).`
                    });
                }
            }

            // 2. Cash flow surplus & savings discipline
            if (this.monthlySurplus > 0) {
                const rate = Number(this.savingsRate) || 0;
                s.push({
                    title: 'Positive monthly cash surplus',
                    detail: `${this.formatCurrency(this.monthlySurplus)} surplus per month (${rate.toFixed(0)}% savings rate).`
                });
            }

            // 3. Asset & Portfolio Breakdown
            if (this.investments.length > 0) {
                const totalVal = this.investments.reduce((sum, i) => sum + this.getInvCurrentValue(i), 0);
                const equities = this.investments.filter(inv => ['Stock', 'Stock (IND)', 'Stock (US)', 'Equity', 'Mutual Fund', 'ETF', 'ETF (IND)', 'ETF (US)'].includes(inv.type));
                const usHoldings = this.investments.filter(inv => ['Stock (US)', 'ETF (US)'].includes(inv.type));
                const mfHoldings = this.investments.filter(inv => inv.type === 'Mutual Fund');
                const debtHoldings = this.investments.filter(inv => ['Bank FD', 'Bond', 'Government Scheme', 'EPF', 'PPF'].includes(inv.type));

                // Global / US diversification
                if (usHoldings.length > 0 && totalVal > 0) {
                    const usVal = usHoldings.reduce((sum, h) => sum + (Number(h.amount) || (Number(h.units) * (Number(h.currentPrice) || Number(h.buyPrice)) * (Number(this.usdInrRate) || 86)) || 0), 0);
                    const usPct = Math.round((usVal / totalVal) * 100);
                    if (usPct > 0) {
                        s.push({
                            title: 'Global currency hedge',
                            detail: `${usPct}% allocated in US equities (${usHoldings.map(h => h.name).slice(0, 2).join(', ')}), providing a USD hedge against INR depreciation.`
                        });
                    }
                }

                // Dual fund and direct equity structure
                if (mfHoldings.length > 0 && equities.length > mfHoldings.length) {
                    s.push({
                        title: 'Dual active & fund portfolio',
                        detail: `${mfHoldings.length} mutual fund(s) alongside direct equity positions for broad market exposure.`
                    });
                } else if (this.investments.length >= 3 && this.concentrationWarnings.length === 0) {
                    s.push({
                        title: 'Well-distributed portfolio',
                        detail: `${this.investments.length} holdings with no single position dominating portfolio risk.`
                    });
                }

                // Multi-asset allocation
                if (debtHoldings.length > 0 && equities.length > 0 && totalVal > 0) {
                    s.push({
                        title: 'Multi-asset allocation active',
                        detail: 'Portfolio holds both growth assets (equities) and defensive stability (fixed income/deposits).'
                    });
                }
            }

            // 4. SIP & Automated Compounding
            if (this.activeSips && this.activeSips.length > 0) {
                s.push({
                    title: 'Systematic SIP compounding',
                    detail: `${this.formatCurrency(this.totalMonthlySipOutflow)} committed monthly across ${this.activeSips.length} automated SIPs.`
                });
            }

            return s;
        },

        get healthImprovements() {
            const i = [];
            const effectiveMonthlyExp = Number(this.emergency.efMonthly) > 0
                ? Number(this.emergency.efMonthly)
                : Number(this.totalExpense) || 0;
            const liquidBuffer = Number(this.emergency.efCurrent) || 0;

            // 1. Emergency Runway Diagnosis
            if (effectiveMonthlyExp > 0) {
                const months = liquidBuffer > 0 ? (liquidBuffer / effectiveMonthlyExp) : 0;
                if (months < 3) {
                    const target = effectiveMonthlyExp * 6;
                    i.push({
                        title: 'Emergency buffer below safety runway',
                        detail: liquidBuffer === 0
                            ? `Zero dedicated buffer. Monthly expenses are ${this.formatCurrency(effectiveMonthlyExp)}. Build a 6-month buffer of ${this.formatCurrency(target)}.`
                            : `Current liquid buffer only covers ${months.toFixed(1)} months (${this.formatCurrency(liquidBuffer)}). Target 6-month safety buffer is ${this.formatCurrency(target)}.`
                    });
                } else if (months < 6) {
                    i.push({
                        title: 'Expand emergency runway to 6 months',
                        detail: `Current buffer covers ${months.toFixed(1)} months. Target is ${this.formatCurrency(effectiveMonthlyExp * 6)}.`
                    });
                }
            } else if (this.totalIncome > 0 && effectiveMonthlyExp === 0) {
                i.push({
                    title: 'Monthly expenses not configured',
                    detail: 'Add monthly expenses in Planning to unlock accurate emergency buffer and cashflow runway calculations.'
                });
            }

            // 2. Concentration Risk Check
            if (this.investments.length > 0) {
                const totalVal = this.investments.reduce((sum, i) => sum + this.getInvCurrentValue(i), 0);
                if (totalVal > 0) {
                    // Find top holding by valuation — through the one valuation
                    // path, not a local copy with its own hardcoded ₹86 rate.
                    let topHolding = null;
                    let topVal = 0;
                    for (const inv of this.investments) {
                        const val = this.getInvCurrentValue(inv) || 0;
                        if (val > topVal) {
                            topVal = val;
                            topHolding = inv;
                        }
                    }
                    if (topHolding && topVal > 0) {
                        const topPct = Math.round((topVal / totalVal) * 100);
                        const kind = String(topHolding.type || '').toLowerCase();
                        // "Sharp swings" is true of a stock and false of SCSS or
                        // PPF, which are government-backed and do not reprice.
                        // Telling a retired saver their safest holding is a risk
                        // is exactly the equity-shaped advice this card must not give.
                        const sovereign = /government|ppf|epf|nps|post office|scss|nsc|kvp|sgb/.test(kind)
                            || !!window.CorpusSchemes?.match(topHolding);
                        if (topPct >= 35 && !sovereign) {
                            i.push(/fd|fixed deposit/.test(kind)
                                ? { title: `${topPct}% of your book is one deposit`,
                                    detail: `${topHolding.name} holds ${this.formatCurrency(topVal)}. Spreading deposits across banks and maturity dates keeps both the risk and the reinvestment decision smaller.` }
                                : { title: `High concentration in ${topHolding.name}`,
                                    detail: `Accounts for ${topPct}% of your entire portfolio (${this.formatCurrency(topVal)}). Sharp swings will disproportionately impact your corpus.` });
                        }
                    }

                    // Check if 100% equity with zero defensive buffer
                    const debtHoldings = this.investments.filter(inv => ['Bank FD', 'Bond', 'Government Scheme', 'EPF', 'PPF'].includes(inv.type));
                    if (debtHoldings.length === 0 && liquidBuffer === 0) {
                        i.push({
                            title: '100% growth asset exposure',
                            detail: 'Zero fixed income or liquid defensive buffer. Consider adding liquid debt or gold to cushion equity volatility.'
                        });
                    }
                }
            }

            // 3. Cashflow & Savings Rate
            if (this.totalIncome > 0) {
                const sr = Number(this.savingsRate) || 0;
                if (this.monthlySurplus <= 0 && this.totalExpense > this.totalIncome) {
                    i.push({
                        title: 'Negative cash flow deficit',
                        detail: `Monthly expenses exceed income by ${this.formatCurrency(Math.abs(this.monthlySurplus))}. Review discretionary outflows.`
                    });
                } else if (sr < 20 && sr >= 0) {
                    i.push({
                        title: `Savings rate at ${sr.toFixed(0)}% (Target: 20%+)`,
                        detail: `Increasing your monthly savings from ${this.formatCurrency(this.monthlySurplus)} to ${this.formatCurrency(this.totalIncome * 0.2)} will accelerate compounding.`
                    });
                }
            }

            // 4. Idle Surplus without SIP
            if (this.monthlySurplus > 5000 && (!this.activeSips || this.activeSips.length === 0)) {
                i.push({
                    title: 'Surplus cash is unallocated',
                    detail: `You have ${this.formatCurrency(this.monthlySurplus)} uncommitted monthly surplus. Automate investing with recurring SIPs in Planning.`
                });
            }

            return i;
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — INVESTMENTS (Deliverable 1 & Phase 8)
        // ════════════════════════════════════════════════════════════
        refreshingLivePrices: false,
        livePriceMsg: '',

        addInvestment() {
            if (!this.newInv.name) return;
            const isEquity = ['Stock', 'Stock (IND)', 'Stock (US)', 'Equity', 'Mutual Fund', 'ETF', 'ETF (IND)', 'ETF (US)'].includes(this.newInv.type);
            const isUS     = ['Stock (US)', 'ETF (US)'].includes(this.newInv.type);
            const units    = Number(this.newInv.units) || 0;
            const buyPrice = Number(this.newInv.buyPrice) || 0;
            const currentPrice = Number(this.newInv.currentPrice) || buyPrice || 0;
            
            let amount = Number(this.newInv.amount) || 0;
            if (isEquity && units > 0 && (currentPrice > 0 || buyPrice > 0)) {
                const usdRate = isUS ? this.fxUsdInr : 1;
                amount = units * (currentPrice || buyPrice) * usdRate;
            }

            const createdInv = {
                ...this.newInv,
                id:           this.newId('inv'),
                amount:       amount,
                units:        units,
                buyPrice:     buyPrice,
                currentPrice: currentPrice || buyPrice,
                currentValue: amount,
                rate:         this.isRateBearing(this.newInv.type) ? (Number(this.newInv.rate) || 0) : 0
            };

            this.investments.push(createdInv);

            // Trigger single price fetch asynchronously without blocking UI
            if (createdInv.ticker || createdInv.schemeCode) {
                this.fetchSinglePrice(createdInv).catch(err => {
                    console.warn('[SinglePriceSync] Auto-fetch error:', err);
                });
            }

            this.resetNewInvForm();
            this.addingInv = false;
            if (window.RFMMotion && window.RFMMotion.Haptics) {
                window.RFMMotion.Haptics.commit();
            }
        },

        deleteInvestment(id) {
            if (confirm('Are you sure you want to delete this investment?')) {
                this.investments = this.investments.filter(i => i.id !== id);
            }
        },

        openEditModal(inv) {
            this.editForm    = { ...inv };
            this.editingInv  = inv;
        },

        saveEdit() {
            const idx = this.investments.findIndex(i => i.id === this.editForm.id);
            if (idx !== -1) {
                const isEquity = ['Stock', 'Stock (IND)', 'Stock (US)', 'Equity', 'Mutual Fund', 'ETF', 'ETF (IND)', 'ETF (US)'].includes(this.editForm.type);
                const isUS     = ['Stock (US)', 'ETF (US)'].includes(this.editForm.type);
                const units    = Number(this.editForm.units) || 0;
                const buyPrice = Number(this.editForm.buyPrice) || 0;
                const currentPrice = Number(this.editForm.currentPrice) || buyPrice || 0;
                
                let amount = Number(this.editForm.amount) || 0;
                if (isEquity && units > 0 && (currentPrice > 0 || buyPrice > 0)) {
                    const usdRate = isUS ? this.fxUsdInr : 1;
                    amount = units * (currentPrice || buyPrice) * usdRate;
                }

                this.editForm.amount       = amount;
                this.editForm.units        = units;
                this.editForm.buyPrice     = buyPrice;
                this.editForm.currentPrice = currentPrice || buyPrice;
                this.editForm.currentValue = amount;
                this.editForm.rate         = this.isRateBearing(this.editForm.type) ? (Number(this.editForm.rate) || 0) : 0;

                this.investments[idx] = { ...this.editForm };
                this.investments = [...this.investments];

                if (this.editForm.ticker || this.editForm.schemeCode) {
                    this.fetchSinglePrice(this.investments[idx]);
                }
            }
            this.editingInv = null;
        },

        // ════════════════════════════════════════════════════════════
        //  TOPPING UP A HOLDING — amount in, units and average out
        // ════════════════════════════════════════════════════════════
        //
        // You bought ₹20,000 more of a fund, or $500 more of Broadcom. The app
        // knows the price, so retyping a recomputed quantity and a recomputed
        // average by hand is arithmetic the app should be doing — and it is
        // arithmetic that is easy to get wrong at 2 a.m. after a fill.
        //
        // Everything here works in the holding's OWN currency. buyPrice is
        // already stored that way — getInvInvestedCost applies fxUsdInr on the
        // way out for USD rows — so a dollar amount must never be converted on
        // the way in, or the average silently becomes a rupee figure sitting in
        // a dollar field.

        openAddLot(inv) {
            if (!inv) return;
            this.addingLot = inv;
            this.lotForm = { amount: '', timing: 'market' };
            this.lotError = '';
            if (window.RFMMotion?.Haptics) window.RFMMotion.Haptics.tap();
        },

        cancelAddLot() { this.addingLot = null; this.lotError = ''; },

        /* The symbol a price is quoted in. Not a formatter — the sheet has to
           say "$500" for a US holding and "₹500" for an Indian one, and
           formatCurrency is hardcoded to INR. */
        lotCurrency(inv) {
            return (inv && (inv.currency === 'USD'
                            || inv.type === 'Stock (US)' || inv.type === 'ETF (US)')) ? 'USD' : 'INR';
        },

        formatNative(inv, n) {
            const v = Number(n) || 0;
            return this.lotCurrency(inv) === 'USD'
                ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : this.formatCurrency(v);
        },

        /* What the sheet shows before you commit. Returns null when there is
           nothing honest to show yet — an off-hours purchase has NO price,
           because the session it will fill at has not opened. */
        get lotPreview() {
            const inv = this.addingLot;
            const amount = Number(this.lotForm.amount) || 0;
            if (!inv || amount <= 0) return null;

            const qty = Number(inv.units) || 0;
            const avg = Number(inv.buyPrice) || 0;

            if (this.lotForm.timing === 'offhours') {
                return { pending: true, amount, qty, avg };
            }

            const price = Number(inv.currentPrice) || avg;
            if (!(price > 0)) return null;
            const units = amount / price;
            const newQty = qty + units;
            // The average is cost-weighted, not price-averaged: two lots of
            // different sizes do not contribute equally.
            const newAvg = newQty > 0 ? ((qty * avg) + amount) / newQty : price;
            return { pending: false, amount, price, units, qty, avg, newQty, newAvg,
                     priceAsOf: inv.priceAsOf || null };
        },

        /* Folds a settled purchase into the position. Idempotent by lot id:
           a sync that runs twice, or overlaps itself, must not buy the same
           units twice. */
        _applyLot(inv, amount, price, lotId) {
            if (!inv || !(amount > 0) || !(price > 0)) return false;
            inv.settledLots = Array.isArray(inv.settledLots) ? inv.settledLots : [];
            if (lotId && inv.settledLots.includes(lotId)) return false;

            const qty = Number(inv.units) || 0;
            const avg = Number(inv.buyPrice) || 0;
            const units = amount / price;
            const newQty = qty + units;

            inv.units = newQty;
            inv.buyPrice = newQty > 0 ? ((qty * avg) + amount) / newQty : price;
            const live = Number(inv.currentPrice) || price;
            inv.currentValue = Math.round(newQty * live * (this.lotCurrency(inv) === 'USD' ? this.fxUsdInr : 1) * 100) / 100;
            inv.amount = inv.currentValue;
            if (lotId) inv.settledLots.push(lotId);
            return true;
        },

        commitAddLot() {
            const inv = this.addingLot;
            const p = this.lotPreview;
            if (!inv || !p) { this.lotError = 'Enter how much you bought.'; return; }

            const idx = (this.investments || []).findIndex(i => i.id === inv.id);
            if (idx < 0) { this.lotError = 'That holding is no longer here.'; return; }
            const row = { ...this.investments[idx] };

            if (p.pending) {
                // Nothing is folded in yet. The fill price is the open of a
                // session that has not happened, and inventing units for it
                // would be inventing a trade.
                row.pendingLots = Array.isArray(row.pendingLots) ? [...row.pendingLots] : [];
                row.pendingLots.push({
                    id: this.newId('lot'),
                    amount: p.amount,
                    placedAt: new Date().toISOString(),
                    basis: 'open',
                });
            } else if (!this._applyLot(row, p.amount, p.price, null)) {
                this.lotError = 'Could not work out a price for that.';
                return;
            }

            this.investments[idx] = row;
            this.investments = [...this.investments];
            this.addingLot = null;
            this.lotError = '';
            if (window.RFMMotion?.Haptics) window.RFMMotion.Haptics.success();
            if (p.pending) this.settlePendingLots(row).catch(() => {});
        },

        /* Daily session opens, newest last. A MONTH rather than the 5 days the
           price path fetches: a lot placed on a Friday evening before a long
           weekend still has to find its session, and five candles is not
           enough to guarantee the window straddles the purchase. */
        async _dailyOpens(inv) {
            const isUS = this.lotCurrency(inv) === 'USD';
            const clean = String(inv.ticker || '').trim().toUpperCase().replace(/\.(NS|BO)$/, '');
            if (!clean) return null;
            const sym = isUS ? clean : `${clean}.NS`;
            const data = await this.fetchMarketJson(
                `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1mo`);
            const res = data?.chart?.result?.[0];
            const times = res?.timestamp;
            const opens = res?.indicators?.quote?.[0]?.open;
            if (!Array.isArray(times) || !Array.isArray(opens) || !times.length) return null;
            return { times, opens };
        },

        /* Settles anything waiting on a market open.

           This is what makes "I bought off hours" work without the app being
           awake at the open. It never needs to be: the open of a session that
           has already happened is in the daily candles, so the lot is resolved
           retroactively the next time the app runs. A later sync then shows the
           LIVE price as normal — settling fixes the cost basis, not the value.

           A lot is only settled when the candle window provably straddles the
           purchase. If the window starts AFTER the lot was placed, some session
           in between may have been the real fill and we cannot see it, so the
           lot is flagged rather than settled at a price that is merely plausible. */
        async settlePendingLots(inv) {
            if (!inv || !Array.isArray(inv.pendingLots) || !inv.pendingLots.length) return 0;
            if (!inv.ticker) return 0;

            let series = null;
            try { series = await this._dailyOpens(inv); } catch (e) { return 0; }
            if (!series) return 0;

            const { times, opens } = series;
            const windowStart = times[0] * 1000;
            const keep = [];
            let settled = 0;

            for (const lot of inv.pendingLots) {
                const placed = new Date(lot.placedAt).getTime();
                if (!Number.isFinite(placed)) continue;

                if (placed < windowStart) {
                    // Older than anything we can see. Surfaced, never guessed.
                    keep.push({ ...lot, unresolved: true });
                    continue;
                }
                const i = times.findIndex((t, n) => (t * 1000) > placed
                                                 && Number.isFinite(opens[n]) && opens[n] > 0);
                if (i < 0) { keep.push(lot); continue; }   // the session has not opened yet

                if (this._applyLot(inv, lot.amount, opens[i], lot.id)) settled++;
            }

            inv.pendingLots = keep;
            if (settled) {
                const idx = (this.investments || []).findIndex(i => i.id === inv.id);
                if (idx >= 0) { this.investments[idx] = { ...inv }; this.investments = [...this.investments]; }
            }
            return settled;
        },

        async settleAllPendingLots() {
            const waiting = (this.investments || []).filter(i => (i.pendingLots || []).length);
            if (!waiting.length) return 0;
            let n = 0;
            for (const inv of waiting) {
                try { n += await this.settlePendingLots(inv); } catch (e) { /* next holding */ }
            }
            if (n) this.saveData();
            return n;
        },

        get pendingLotCount() {
            return (this.investments || []).reduce((n, i) => n + ((i.pendingLots || []).length), 0);
        },

        pendingLotNote(inv) {
            const lots = (inv && inv.pendingLots) || [];
            if (!lots.length) return '';
            const stuck = lots.filter(l => l.unresolved).length;
            if (stuck) return `${stuck} purchase${stuck > 1 ? 's' : ''} could not be priced — add ${stuck > 1 ? 'them' : 'it'} by hand`;
            return `${lots.length} purchase${lots.length > 1 ? 's' : ''} waiting for the next market open`;
        },

        async fetchLivePrices() {
            // Keep pull-to-refresh and the Portfolio button on one implementation.
            await this.fetchAllPrices();
        },

        cancelEdit() { this.editingInv = null; },

        getMonthlyEquivalent(inv) {
            if (inv.payout === 'Cumulative') return 'Reinvested';
            const yearly = Number(inv.amount) * (Number(inv.rate) / 100);
            return this.formatCurrency(yearly / 12);
        },
        // ════════════════════════════════════════════════════════════
        addGoal() {
            if (!this.newGoal.name || !this.newGoal.target) return;
            this.goals.push({
                ...this.newGoal,
                id:      this.newId('goal'),
                target:  Number(this.newGoal.target),
                current: Number(this.newGoal.current) || 0
            });
            this.newGoal = { name: '', type: 'Emergency Fund', target: '', current: '', targetDate: '' };
        },

        deleteGoal(id) {
            if (confirm('Delete this goal?')) {
                this.goals = this.goals.filter(g => g.id !== id);
            }
        },

        openGoalEdit(goal) {
            this.editGoalForm = { ...goal };
            this.editingGoal  = goal;
        },

        saveGoalEdit() {
            const idx = this.goals.findIndex(g => g.id === this.editGoalForm.id);
            if (idx !== -1) {
                this.editGoalForm.target  = Number(this.editGoalForm.target);
                this.editGoalForm.current = Number(this.editGoalForm.current);
                this.goals[idx] = { ...this.editGoalForm };
                this.goals = [...this.goals];
            }
            this.editingGoal = null;
        },

        cancelGoalEdit() { this.editingGoal = null; },

        goalTypeEmoji(type) {
            const map = {
                'Emergency Fund': '🛡️', 'Retirement': '🏖️', 'New Car': '🚗',
                'House': '🏠', 'Education': '📚', 'Travel': '✈️', 'Custom': '🎯'
            };
            return map[type] || '🎯';
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — PENSION (Deliverable 4)
        // ════════════════════════════════════════════════════════════
        updatePension(newAmount) {
            const prev = Number(this.pension.monthlyAmount);
            const next = Number(newAmount);
            if (prev === next) return;
            // Log revision before applying change
            this.pension.revisions.push({
                date:            new Date().toISOString().slice(0, 10),
                previousAmount:  prev,
                note:            'Manual update'
            });
            this.pension.monthlyAmount = next;
        },

        deletePensionRevision(idx) {
            if (confirm('Delete this revision record?')) {
                this.pension.revisions.splice(idx, 1);
            }
        },

        get maturingInvestments() {
            return (this.investments || [])
                .filter(inv => inv.maturityDate)
                .map(inv => {
                    const today = new Date();
                    const mDate = new Date(inv.maturityDate);
                    const daysLeft = Math.ceil((mDate - today) / (1000 * 60 * 60 * 24));
                    let status = 'normal';
                    if (daysLeft < 0) status = 'expired';
                    else if (daysLeft <= 30) status = 'urgent';
                    else if (daysLeft <= 90) status = 'soon';
                    return { ...inv, daysLeft, status };
                })
                .sort((a, b) => new Date(a.maturityDate) - new Date(b.maturityDate));
        },

        // ── used by the pension input field (two-way without full update overhead)
        pensionInput: null, // tracks the draft input value

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — IMPORT (Phase 5)
        // ════════════════════════════════════════════════════════════
        isSelectingFile: false,

        handleFileUpload(event) {
            this.isSelectingFile = false;
            this.handleImportFile(event);
        },

        get pdfPassword() { return this.importPassword; },
        set pdfPassword(val) { this.importPassword = val; },

        async processStatement() {
            return this.parseStatement();
        },

        handleImportFile(event) {
            this.isSelectingFile = false;
            const file = event.target.files?.[0];
            if (file && file.type === 'application/pdf') {
                this.importFile = file;
                this.importError = '';
                this.importResults = null;
                this.importStats = null;
                this.importState = 'idle';
            }
        },

        handleImportDrop(event) {
            const file = event.dataTransfer.files[0];
            if (file && file.type === 'application/pdf') {
                this.importFile = file;
                this.importError = '';
                this.importResults = null;
                this.importStats = null;
                this.importState = 'idle';
            } else {
                this.importError = 'Please drop a PDF file.';
            }
        },

        async parseStatement() {
            if (!this.importFile) return;

            this.importState = 'loading';
            this.importError = '';
            this.importResults = null;
            this.importStats = null;
            this.statementDiff.active = false;

            try {
                const text = await this.extractPdfText(this.importFile, this.importPassword);

                if (!text || text.trim().length < 50) {
                    this.importError = 'Could not extract text from this PDF. It may be image-based or corrupted. Please use the original PDF from your email.';
                    this.importState = 'error';
                    return;
                }

                // Phase 5 regex-based parser
                const result = window.RFMParser.parseStatement(text);

                if (result.type === 'UNKNOWN' || result.investments.length === 0) {
                    // Statement import is intentionally deterministic. The managed
                    // portfolio-reading service is not a document-processing API,
                    // so this path never falls back to a hidden personal key.
                    this.importError = result.investments.length === 0
                        ? `Statement recognized as ${result.type.replace('_',' ')} but no holdings could be extracted. Add them manually.`
                        : 'Statement format is not supported by the built-in parser. Add holdings manually.';
                    this.importState = 'error';
                    return;
                }

                // Built-in parser succeeded
                this.importResults = result;
                this.importSelections = {};
                result.investments.forEach((_, idx) => {
                    this.importSelections[idx] = true;
                });

                // Compute smart portfolio diff
                this.generatePortfolioDiff(result);
                this.importState = 'diff_ready';
                if (this.haptics && window.RFMMotion) window.RFMMotion.Haptics.tap();

            } catch (err) {
                console.error('Parse error:', err);
                if (err.name === 'PasswordException' || (err.message && err.message.includes('password'))) {
                    this.importError = 'Incorrect password. CAS files are usually encrypted with your PAN number (e.g., ABCDE1234F).';
                } else {
                    this.importError = 'Failed to parse PDF: ' + (err.message || 'Unknown error');
                }
                this.importState = 'error';
            }
        },

        async getPdfWorkerUrl() {
            if (window._pdfWorkerBlobUrl) return window._pdfWorkerBlobUrl;

            try {
                const res = await fetch('pdf.worker.min.js');
                if (res.ok) {
                    const text = await res.text();
                    const blob = new Blob([text], { type: 'text/javascript' });
                    window._pdfWorkerBlobUrl = URL.createObjectURL(blob);
                    return window._pdfWorkerBlobUrl;
                }
            } catch (e) {
                console.warn('Failed to fetch local PDF worker script for blob creation:', e);
            }
            return 'pdf.worker.min.js';
        },

        async extractPdfText(file, password) {
            const pdfjsLib = window.pdfjsLib;
            if (!pdfjsLib) {
                throw new Error('PDF library not loaded. Please reload the app.');
            }

            try {
                const workerUrl = await this.getPdfWorkerUrl();
                pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
            } catch (e) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
            }

            const arrayBuffer = await file.arrayBuffer();
            const loadingConfig = { data: arrayBuffer };
            if (password) loadingConfig.password = password;

            let pdf;
            try {
                pdf = await pdfjsLib.getDocument(loadingConfig).promise;
            } catch (err) {
                console.warn('Primary worker load exception, attempting fallback:', err);
                if (err.name === 'PasswordException' || (err.message && err.message.toLowerCase().includes('password'))) {
                    throw err;
                }
                // Was a CDN fetch of pdfjs-dist@6.1.200 — the single remaining line in the
                // app that needed a network, in an app whose whole claim is that it does
                // not. It was also pinned to a different version than the bundle ships
                // (6.3.289), so the worker and the API would have disagreed even online.
                // The .mjs build is vendored beside the .js one; both match the bundle.
                if (pdfjsLib.GlobalWorkerOptions) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.mjs';
                    pdf = await pdfjsLib.getDocument(loadingConfig).promise;
                } else {
                    throw err;
                }
            }

            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items.map(item => item.str).join(' ');
                fullText += `\n--- PAGE ${i} OF ${pdf.numPages} ---\n` + pageText + '\n';
            }

            return fullText;
        },

        findDuplicate(newItem) {
            // 1. Match by ISIN (strongest signal)
            if (newItem.isin) {
                const match = this.investments.find(inv => inv.isin === newItem.isin);
                if (match) return match;
            }
            // 2. Fuzzy match by name + type
            const newName = (newItem.name || '').toLowerCase().trim();
            if (newName.length > 3) {
                return this.investments.find(inv => {
                    const existName = (inv.name || '').toLowerCase().trim();
                    return existName === newName && inv.type === newItem.type;
                });
            }
            return null;
        },

        // ════════════════════════════════════════════════════════════
        //  SMART PORTFOLIO DIFF ENGINE (Groww / MF / Stock Statement Diff)
        // ════════════════════════════════════════════════════════════

        generatePortfolioDiff(statementResult) {
            if (!statementResult || !statementResult.investments) return;

            const type = statementResult.type || '';
            const docCat = (statementResult.documentCategory === 'Stock' || type.includes('STOCK') || type.includes('CAS'))
                ? 'Stock'
                : 'Mutual Fund';

            const broker = statementResult.broker || (type.includes('GROWW') ? 'Groww' : (type.includes('CAMS') ? 'CAMS' : (type.includes('KFIN') ? 'KFintech' : 'Broker')));
            const asOfDate = statementResult.asOfDate || '';
            const investor = statementResult.investor || {};
            const summary = statementResult.summary || {};

            // Existing holdings in app for this category
            const appCategoryHoldings = (this.investments || []).filter(inv => {
                if (docCat === 'Mutual Fund') {
                    return inv.type === 'Mutual Fund' || (inv.type || '').toLowerCase().includes('mutual');
                } else {
                    return ['Stock', 'Stock (IND)', 'Stock (US)', 'ETF', 'ETF (IND)', 'ETF (US)'].includes(inv.type) ||
                           (inv.type || '').toLowerCase().includes('stock');
                }
            });

            // Normalization helper for fuzzy name matching
            const simplify = (str) => {
                return (str || '')
                    .toLowerCase()
                    .replace(/\b(direct|regular|plan|growth|dividend|idcw|fund|mutual|equity|index|cap|ltd|limited|shares?|amc)\b/gi, '')
                    .replace(/[^a-z0-9]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            };

            const matched = [];
            const newItems = [];
            const matchedExistingIds = new Set();

            const incomingHoldings = statementResult.investments || [];

            incomingHoldings.forEach(inc => {
                const incSimp = simplify(inc.name);
                const incFolio = (inc.folioNumber || '').trim();
                const incIsin = (inc.isin || '').trim();

                let match = null;

                // 1. Folio match (highest accuracy for MF)
                if (incFolio && incFolio.length > 4) {
                    match = appCategoryHoldings.find(ex => (ex.folioNumber || '').trim() === incFolio);
                }

                // 2. ISIN match (highest accuracy for Stocks)
                if (!match && incIsin) {
                    match = appCategoryHoldings.find(ex => (ex.isin || '').trim() === incIsin);
                }

                // 3. Fuzzy name match
                if (!match && incSimp.length > 3) {
                    match = appCategoryHoldings.find(ex => {
                        const exSimp = simplify(ex.name);
                        if (!exSimp) return false;
                        return exSimp === incSimp || exSimp.includes(incSimp) || incSimp.includes(exSimp);
                    });
                }

                if (match) {
                    matchedExistingIds.add(match.id);
                    const oldUnits = Number(match.units) || 0;
                    const newUnits = Number(inc.units) || 0;
                    const oldCost = Number(match.amount) || 0;
                    const newCost = Number(inc.amount) || oldCost;
                    const oldVal = Number(match.currentValue) || (oldUnits * (Number(match.currentPrice) || Number(match.nav) || 0)) || oldCost;
                    const newVal = Number(inc.currentValue) || (newUnits * (Number(inc.nav) || Number(inc.currentPrice) || 0)) || newCost;
                    const oldNav = Number(match.currentPrice) || Number(match.nav) || 0;
                    const newNav = Number(inc.nav) || Number(inc.currentPrice) || 0;

                    matched.push({
                        existingId: match.id,
                        existingName: match.name,
                        incomingName: inc.name,
                        type: match.type || inc.type,
                        issuer: inc.issuer || match.issuer || '',
                        folioNumber: inc.folioNumber || match.folioNumber || '',
                        oldUnits: oldUnits,
                        newUnits: newUnits,
                        unitsDelta: Math.round((newUnits - oldUnits) * 1000) / 1000,
                        oldInvested: oldCost,
                        newInvested: newCost,
                        investedDelta: Math.round((newCost - oldCost) * 100) / 100,
                        oldValue: oldVal,
                        newValue: newVal,
                        valueDelta: Math.round((newVal - oldVal) * 100) / 100,
                        oldNav: oldNav,
                        newNav: newNav,
                        incomingHolding: inc
                    });
                } else {
                    newItems.push({
                        name: inc.name,
                        type: inc.type || docCat,
                        issuer: inc.issuer || '',
                        folioNumber: inc.folioNumber || '',
                        units: Number(inc.units) || 0,
                        amount: Number(inc.amount) || Number(inc.currentValue) || 0,
                        currentValue: Number(inc.currentValue) || (Number(inc.units) * Number(inc.nav)) || 0,
                        nav: Number(inc.nav) || Number(inc.currentPrice) || 0,
                        incomingHolding: inc
                    });
                }
            });

            // Omitted holdings in app for this category
            const omitted = appCategoryHoldings
                .filter(ex => !matchedExistingIds.has(ex.id))
                .map(ex => ({
                    id: ex.id,
                    name: ex.name,
                    units: Number(ex.units) || 0,
                    currentValue: Number(ex.currentValue) || Number(ex.amount) || 0
                }));

            // Synthesize intelligent conversational message
            const asOfStr = asOfDate ? ` (as of ${this.formatDate(asOfDate)})` : '';
            let aiMessage = '';

            if (matched.length > 0 && newItems.length === 0) {
                const names = matched.map(m => `“${m.existingName}”`).join(' and ');
                aiMessage = `This ${broker} statement${asOfStr} is the current portfolio for the ${matched.length} ${docCat} holding${matched.length === 1 ? '' : 's'} already in Corpus: ${names}. Would you like to update them to the latest units and valuations from this statement?`;
            } else if (matched.length > 0 && newItems.length > 0) {
                const mNames = matched.map(m => `“${m.existingName}”`).join(', ');
                const nNames = newItems.map(n => `“${n.name}”`).join(', ');
                aiMessage = `This ${broker} statement${asOfStr} matches ${matched.length} existing holding${matched.length === 1 ? '' : 's'} (${mNames}) and includes ${newItems.length} new holding${newItems.length === 1 ? '' : 's'} (${nNames}). Would you like to update matching holdings and add the new one${newItems.length === 1 ? '' : 's'}?`;
            } else if (matched.length === 0 && newItems.length > 0) {
                const tot = summary.currentValue || newItems.reduce((s, i) => s + i.currentValue, 0);
                aiMessage = `This ${broker} statement${asOfStr} contains ${newItems.length} ${docCat} holding${newItems.length === 1 ? '' : 's'} totaling ${this.formatCurrency(tot)}. None of these are currently in your portfolio. Would you like to add them?`;
            } else {
                aiMessage = `Identified ${broker} ${docCat} portfolio statement${asOfStr}. Review the portfolio diff below.`;
            }

            this.statementDiff = {
                active: true,
                category: docCat,
                broker: broker,
                asOfDate: asOfDate,
                investor: investor,
                summary: summary,
                aiMessage: aiMessage,
                matched: matched,
                newItems: newItems,
                omitted: omitted
            };
        },

        applyPortfolioUpdate() {
            if (!this.statementDiff || !this.statementDiff.active) return;

            let updatedCount = 0;
            let addedCount = 0;

            // 1. Update matched holdings
            this.statementDiff.matched.forEach(m => {
                const idx = this.investments.findIndex(i => i.id === m.existingId);
                if (idx !== -1) {
                    const inc = m.incomingHolding;
                    this.investments[idx] = {
                        ...this.investments[idx],
                        units:        m.newUnits,
                        amount:       m.newInvested || this.investments[idx].amount,
                        nav:          m.newNav || this.investments[idx].nav,
                        currentPrice: m.newNav || this.investments[idx].currentPrice,
                        currentValue: m.newValue,
                        folioNumber:  m.folioNumber || this.investments[idx].folioNumber,
                        importSource: this.importResults?.type || 'GROWW_MF',
                        importDate:   new Date().toISOString().slice(0, 10),
                        lastNavUpdate: new Date().toISOString()
                    };
                    updatedCount++;
                }
            });

            // 2. Add new items
            this.statementDiff.newItems.forEach(n => {
                this.investments.push(n.incomingHolding);
                addedCount++;
            });

            this.investments = [...this.investments];
            this.saveData({ rescheduleAlerts: true });
            this.queueNwSnapshot('statement-update');
            if (this.haptics && window.RFMMotion) window.RFMMotion.Haptics.commit();

            this.importStats = {
                total: updatedCount + addedCount,
                imported: updatedCount + addedCount,
                duplicates: updatedCount,
                skipped: 0
            };
            this.statementDiff.active = false;
            this.importState = 'done';
            this.importFile = null;
        },

        applyCategoryReplace() {
            if (!this.statementDiff || !this.statementDiff.active) return;

            const cat = this.statementDiff.category;
            const incomingCount = (this.importResults?.investments || []).length;

            const msg = `Are you sure you want to replace all ${cat} holdings in Corpus with the ${incomingCount} holding${incomingCount === 1 ? '' : 's'} from this statement?\n\nOther investments (like Stocks, FDs, PPF, Gold) will NOT be affected.`;
            if (!confirm(msg)) return;

            // Remove existing holdings of this category
            this.investments = this.investments.filter(inv => {
                if (cat === 'Mutual Fund') {
                    return !(inv.type === 'Mutual Fund' || (inv.type || '').toLowerCase().includes('mutual'));
                } else {
                    return !(['Stock', 'Stock (IND)', 'Stock (US)', 'ETF', 'ETF (IND)', 'ETF (US)'].includes(inv.type) ||
                             (inv.type || '').toLowerCase().includes('stock'));
                }
            });

            // Add all incoming holdings
            (this.importResults?.investments || []).forEach(inc => {
                this.investments.push(inc);
            });

            this.investments = [...this.investments];
            this.saveData({ rescheduleAlerts: true });
            this.queueNwSnapshot('category-replace');
            if (this.haptics && window.RFMMotion) window.RFMMotion.Haptics.commit();

            this.importStats = {
                total: incomingCount,
                imported: incomingCount,
                duplicates: 0,
                skipped: 0
            };
            this.statementDiff.active = false;
            this.importState = 'done';
            this.importFile = null;
        },

        applyAddNew() {
            if (!this.statementDiff || !this.statementDiff.active) return;

            const incoming = this.importResults?.investments || [];
            incoming.forEach(inc => {
                this.investments.push({ ...inc, id: this.newId('inv') });
            });

            this.investments = [...this.investments];
            this.saveData({ rescheduleAlerts: true });
            this.queueNwSnapshot('add-new-holdings');
            if (this.haptics && window.RFMMotion) window.RFMMotion.Haptics.commit();

            this.importStats = {
                total: incoming.length,
                imported: incoming.length,
                duplicates: 0,
                skipped: 0
            };
            this.statementDiff.active = false;
            this.importState = 'done';
            this.importFile = null;
        },

        cancelDiff() {
            this.statementDiff.active = false;
            this.importState = 'idle';
            this.importFile = null;
            this.importResults = null;
        },

        toggleAllImports(checked) {
            if (!this.importResults) return;
            this.importResults.investments.forEach((_, idx) => {
                this.importSelections[idx] = checked;
            });
        },

        countSelectedImports() {
            if (!this.importResults) return 0;
            return this.importResults.investments.filter((_, idx) =>
                this.importSelections[idx] !== false
            ).length;
        },

        countDuplicateImports() {
            if (!this.importResults) return 0;
            return this.importResults.investments.filter(inv =>
                this.findDuplicate(inv)
            ).length;
        },

        importSelected() {
            if (!this.importResults) return;

            let imported = 0;
            let duplicates = 0;
            let skipped = 0;

            this.importResults.investments.forEach((inv, idx) => {
                // Skip unselected
                if (this.importSelections[idx] === false) {
                    skipped++;
                    return;
                }

                const existing = this.findDuplicate(inv);

                if (existing) {
                    if (this.importDuplicateMode === 'skip') {
                        duplicates++;
                        return;
                    }
                    // Overwrite: update amount/units/nav but preserve manual edits
                    const existIdx = this.investments.findIndex(i => i.id === existing.id);
                    if (existIdx !== -1) {
                        this.investments[existIdx] = {
                            ...this.investments[existIdx],
                            amount:       inv.amount,
                            units:        inv.units,
                            nav:          inv.nav,
                            currentValue: inv.currentValue,
                            isin:         inv.isin || this.investments[existIdx].isin,
                            importSource: inv.importSource,
                            importDate:   inv.importDate
                        };
                        duplicates++;
                        imported++;
                    }
                } else {
                    // New entry
                    this.investments.push(inv);
                    imported++;
                }
            });

            // Trigger reactivity
            this.investments = [...this.investments];

            this.importStats = { total: this.importResults.investments.length, imported, duplicates, skipped };
            this.importResults = null;
            this.importFile = null;
            this.importState = 'done';
        },

        // ════════════════════════════════════════════════════════════
        //  PHASE 11: LIVE NAV & STOCK PRICE INGESTION ENGINE
        // ════════════════════════════════════════════════════════════

        // Search AMFI Mutual Fund schemes by query
        async searchMfScheme(query, targetForm) {
            const q = (query || this.mfSearchQuery || '').trim();
            if (q.length < 3) {
                this.mfSearchResults = [];
                return;
            }
            this.isSearchingMf = true;
            try {
                const res = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`);
                if (res.ok) {
                    const data = await res.json();
                    this.mfSearchResults = (data || []).slice(0, 8);
                }
            } catch (err) {
                console.warn('Failed to search AMFI MF schemes:', err);
                this.mfSearchResults = [];
            } finally {
                this.isSearchingMf = false;
            }
        },

        // Select an AMFI Mutual Fund scheme for new/edited investment
        selectMfScheme(targetForm, scheme) {
            if (!targetForm) return;
            targetForm.schemeCode = String(scheme.schemeCode);
            // Unconditionally. This used to write the name only when the field
            // was still empty — but the field is never empty at this point,
            // because typing is how the list appeared. Picking a scheme then
            // silently kept the half-typed query ("invesco mid") and submitted
            // THAT as the holding's name. Choosing from the list is an explicit
            // act and always wins over what was typed to find it.
            targetForm.name = scheme.schemeName;
            this.mfSearchResults = [];
            this.mfSearchQuery = '';
            if (this.haptics && window.RFMMotion) window.RFMMotion.Haptics.commit();
        },

        async fetchJsonWithTimeout(url, timeoutMs = 4500) {
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
            try {
                const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } finally {
                if (timer) clearTimeout(timer);
            }
        },

        /* Resolve an AMFI scheme code from the fund's own name.

           Matching is deliberately strict, because the variants of one fund are NOT
           interchangeable: "Direct" and "Regular" differ by the distributor commission
           and "Growth" and "IDCW" diverge every time a dividend is paid, so the wrong
           pick reports a confidently wrong NAV forever. The plan and the option are
           therefore treated as hard filters, never as tie-breakers, and an ambiguous
           result resolves to NOTHING with the candidates named. Guessing here would be
           exactly the invented figure this app exists not to produce. */
        async resolveSchemeCode(inv) {
            const name = String(inv.name || '').trim();
            if (name.length < 4) {
                return { code: null, message: `${name || 'This fund'} needs a fuller name before its AMFI scheme can be found.` };
            }

            let rows;
            try {
                rows = await this.httpGetJson(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(name)}`, 7000);
            } catch (e) {
                return { code: null, message: `Could not reach the AMFI scheme directory to look up ${name}.` };
            }
            if (!Array.isArray(rows) || !rows.length) {
                return { code: null, message: `No AMFI scheme matches "${name}". Check the name against your statement.` };
            }

            const has = (re, t) => re.test(t);
            const DIRECT = /\bdirect\b/i, REGULAR = /\bregular\b/i, INCOME = /\b(idcw|dividend|income distribution)\b/i;
            const wantDirect  = has(DIRECT, name);
            const wantRegular = has(REGULAR, name);
            const wantIncome  = has(INCOME, name);

            let pool = rows.filter(r => {
                const n = String(r.schemeName || '');
                if (wantDirect  && !has(DIRECT, n))  return false;
                if (wantRegular && !has(REGULAR, n)) return false;
                // "Growth" is the absence of an income option, so it is matched by exclusion.
                if (!wantIncome && has(INCOME, n))   return false;
                if (wantIncome  && !has(INCOME, n))  return false;
                return true;
            });
            if (!pool.length) pool = rows;

            const norm = t => String(t || '').toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .replace(/\b(fund|scheme|plan|option|mutual|the)\b/g, ' ')
                .replace(/\s+/g, ' ').trim();
            const target = norm(name);

            let hit = pool.find(r => norm(r.schemeName) === target);
            if (!hit && pool.length === 1) hit = pool[0];

            if (!hit) {
                const names = pool.slice(0, 3).map(r => `"${r.schemeName}"`).join(', ');
                return { code: null, message: `"${name}" matches ${pool.length} AMFI schemes (${names}). Rename the holding to match one exactly — the plan and option change the NAV.` };
            }
            return { code: String(hit.schemeCode), name: hit.schemeName };
        },

        /* MFAPI is useful for its small per-scheme JSON response, but it is not
           the authority and it can intermittently time out from Android. AMFI
           publishes the same daily NAVs in its complete report. The report is
           deliberately fetched only after MFAPI fails, then shared by every
           fund in the current refresh; six funds must not create six multi-MB
           downloads. Nothing is cached as a quote here: the returned report's
           declared NAV date remains the price's provenance. */
        async fetchOfficialAmfiNavRow(schemeCode) {
            const today = this.localDateKey();
            if (!this._amfiNavReport || this._amfiNavReportDate !== today) {
                this._amfiNavReportDate = today;
                this._amfiNavReport = this.fetchMarketText(
                    'https://portal.amfiindia.com/spages/NAVAll.txt', 16000
                ).catch(error => {
                    // Do not cache an outage. A later Retry must make a real
                    // request instead of immediately replaying this failure.
                    this._amfiNavReport = null;
                    this._amfiNavReportDate = '';
                    throw error;
                });
            }

            const prefix = `${String(schemeCode || '').trim()};`;
            const report = String(await this._amfiNavReport || '');
            const line = report.split(/\r?\n/).find(row => row.startsWith(prefix));
            if (!line) throw new Error('AMFI did not list this scheme in its latest NAV report.');

            const fields = line.split(';');
            const nav = Number(fields[6]);
            const date = String(fields[7] || '').trim();
            if (!Number.isFinite(nav) || nav <= 0 || !this.parseAmfiDate(date)) {
                throw new Error('AMFI returned an invalid NAV record.');
            }
            return { nav, date };
        },

        /* MFAPI can answer successfully with a NAV several days behind. A
           transport success is not proof that its `latest` record is current.
           Allow up to three calendar days for weekends/market holidays; beyond
           that, verify against AMFI's official daily report. */
        amfiNavDateAgeDays(date) {
            const parsed = this.parseAmfiDate(date);
            if (!parsed) return Infinity;
            const dayNumber = value => {
                const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
                return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000 : NaN;
            };
            return dayNumber(this.localDateKey()) - dayNumber(this.localDateKey(new Date(parsed)));
        },

        // Fetch one instrument. A mutual fund must use an explicitly chosen AMFI scheme.
        async fetchSinglePrice(inv) {
            if (!inv) return null;

            if (inv.type === 'Mutual Fund' || inv.schemeCode) {
                // A fund with no scheme code used to dead-end here: "needs an AMFI scheme
                // code before it can be synced" is true but useless, because the app never
                // said where to get one and the Edit sheet has no field for it. Holdings
                // imported from a statement, or typed rather than picked from the dropdown,
                // all landed in that state. The name IS the lookup key, so it is used.
                if (!inv.schemeCode) {
                    const resolved = await this.resolveSchemeCode(inv);
                    if (!resolved.code) throw new Error(resolved.message);
                    inv.schemeCode = resolved.code;
                }

                // MFAPI is the fast path. A bounded official AMFI fallback is
                // used only when that provider fails, so one flaky JSON endpoint
                // cannot leave the fund stuck on last week's NAV.
                const navUrl = `https://api.mfapi.in/mf/${encodeURIComponent(inv.schemeCode)}`;
                let row = null;
                let mfapiError = null;
                try {
                    const data = await this.fetchMarketJson(navUrl, 10000);
                    const candidate = data?.data?.[0];
                    if (Number.isFinite(Number(candidate?.nav)) && Number(candidate.nav) > 0) {
                        const ageDays = this.amfiNavDateAgeDays(candidate.date);
                        if (Number.isFinite(ageDays) && ageDays <= 3) row = candidate;
                        else mfapiError = new Error(`MFAPI NAV is outdated${candidate.date ? ` (dated ${candidate.date})` : ''}.`);
                    } else mfapiError = new Error('MFAPI returned no valid NAV.');
                } catch (error) {
                    mfapiError = error;
                }

                if (!row) {
                    try {
                        row = await this.fetchOfficialAmfiNavRow(inv.schemeCode);
                    } catch (amfiError) {
                        const first = mfapiError?.message || 'MFAPI did not return a NAV';
                        throw new Error(`${first}; AMFI fallback: ${amfiError?.message || 'unavailable'}`);
                    }
                }
                const newNav = Number(row?.nav);
                if (!Number.isFinite(newNav) || newNav <= 0) throw new Error('No valid NAV was returned.');
                if (!this.parseAmfiDate(row?.date)) throw new Error('The NAV source did not provide a valid NAV date.');

                inv.currentPrice = newNav;
                if (Number(inv.units) > 0) {
                    inv.currentValue = Math.round(Number(inv.units) * newNav * 100) / 100;
                }
                // AMFI publishes one NAV per business day, so a fund is "as of" its own
                // declared date, not the moment we happened to fetch it.
                inv.priceSource   = 'AMFI';
                inv.priceAsOf     = this.parseAmfiDate(row.date);
                inv.priceIsClose  = true;
                inv.lastNavUpdate = new Date().toISOString();
                return newNav;
            }

            if (!inv.ticker) return null;

            const isUS = inv.type === 'Stock (US)' || inv.type === 'ETF (US)' || inv.currency === 'USD';
            const cleanSymbol = inv.ticker.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
            const querySymbol = isUS ? cleanSymbol : `${cleanSymbol}.NS`;
            const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(querySymbol)}?interval=1d&range=5d`;

            const data = await this.fetchMarketJson(targetUrl);

            const meta = data?.chart?.result?.[0]?.meta;
            const live = Number(meta?.regularMarketPrice);
            const close = Number(meta?.chartPreviousClose);

            // The old code did `regularMarketPrice || chartPreviousClose` and then stamped the
            // row as freshly synced. That silently reported a previous close as a live quote —
            // routine for US symbols, whose session is 7:00pm–1:30am IST. The two are now
            // distinguished and the difference is carried on the record.
            const usingClose = !(Number.isFinite(live) && live > 0);
            const price = usingClose ? close : live;
            if (!Number.isFinite(price) || price <= 0) throw new Error('No valid market price was returned.');

            inv.currentPrice = price;
            inv.currency = isUS ? 'USD' : 'INR';
            const priceInInr = price * (isUS ? this.fxUsdInr : 1);
            if (Number(inv.units) > 0) {
                inv.currentValue = Math.round(Number(inv.units) * priceInInr * 100) / 100;
            }

            inv.priceSource  = 'Yahoo';
            inv.priceIsClose = usingClose;
            inv.priceAsOf    = Number.isFinite(Number(meta?.regularMarketTime))
                ? new Date(Number(meta.regularMarketTime) * 1000).toISOString()
                : new Date().toISOString();
            if (isUS) {
                inv.fxRate = this.fxUsdInr;
                inv.fxAsOf = this.usdInrAsOf;
                inv.fxEstimated = this.fxIsEstimated;
            }
            inv.lastNavUpdate = new Date().toISOString();
            return price;
        },

        // AMFI has returned both "08-09-2026" and "23-Sep-2026". Bare Date()
        // parsing is locale-dependent and can misread the numeric form as Aug 9.
        // Anchored at UTC NOON, not local midnight: local midnight in IST is 18:30 UTC the
        // PREVIOUS day, so the ISO date component would be off by one and any date-string
        // comparison would silently use the wrong day.
        parseAmfiDate(s) {
            const value = String(s || '').trim();
            const numeric = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
            const named = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
            if (!numeric && !named) return null;
            const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const day = Number((numeric || named)[1]);
            const month = numeric ? Number(numeric[2]) : monthNames.indexOf(named[2].toLowerCase()) + 1;
            const year = Number((numeric || named)[3]);
            if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2999) return null;
            // Local noon. Date.UTC would silently roll "99-99-2026" over into a valid date,
            // and a UTC anchor renders as the wrong day east of UTC+12. Noon local is stable
            // in every timezone for the viewer who is reading it, and the 12h offset is
            // irrelevant to staleness, which is measured in days.
            const d = new Date(year, month - 1, day, 12, 0, 0, 0);
            if (Number.isNaN(d.getTime()) || d.getDate() !== day || d.getMonth() !== month - 1) return null;
            return d.toISOString();
        },

        /* Two separate facts, and conflating them made the refresh warning
           impossible to clear:

             WHEN DID WE FETCH?   lastNavUpdate — the only thing a refresh moves.
             HOW OLD IS THE QUOTE? priceAsOf — set by the market, not by us.

           A US holding's quote is the last US close, roughly 01:30 IST and
           older over a weekend, so measuring staleness against priceAsOf meant
           every US row read "not refreshed today" at every hour of every Indian
           day, no matter how many times you synced. Only a missed SYNC is
           stale; a shut market is "at last close", which is a fact about the
           market rather than a task for the user. */
        priceFreshness(inv) {
            const syncedAt = inv && (inv.lastNavUpdate || inv.priceAsOf);
            if (!syncedAt) return { state: 'unknown', label: 'not synced' };

            if (this.localDateKey(new Date(syncedAt)) !== this.localDateKey()) {
                return { state: 'stale', label: `synced ${this.formatDate(syncedAt)}` };
            }

            const quoteAt = inv.priceAsOf || syncedAt;
            // A fund has no intraday price at all — its NAV is simply the day's
            // value — so calling that a "last close" would overstate it.
            //
            // AMFI publishes ONE NAV per business day, after the market shuts.
            // A Friday date showing on a Tuesday afternoon is the publishing
            // calendar, not a failed sync, and the label now says so — reading
            // a stale-looking date next to a working refresh button is what
            // made a correct number look broken.
            if (inv.priceIsClose) {
                if (inv.priceSource === 'AMFI') {
                    return { state: 'close', label: `NAV ${this.formatDate(quoteAt)} · end of day` };
                }
                return { state: 'close', label: `last close · ${this.formatDate(quoteAt)}` };
            }
            // Six hours, not twenty-four: an Indian close at 15:30 is still the
            // last close at 21:00 the same evening, and a quote minutes old
            // during the session is genuinely live.
            if (Date.now() - new Date(quoteAt).getTime() > 6 * 60 * 60 * 1000) {
                return { state: 'close', label: `last close · ${this.formatDate(quoteAt)}` };
            }
            return { state: 'live', label: `${inv.priceSource || 'live'}` };
        },

        // Refresh eligible holdings concurrently with a small worker pool to protect public data APIs.
        async fetchAllPrices() {
            if (this.navFetchState === 'fetching') return;

            const holdings = (this.investments || []).filter(inv => inv.schemeCode || inv.ticker || inv.type === 'Mutual Fund');
            if (!holdings.length) {
                this.navFetchState = 'done';
                this.navFetchProgress = { completed: 0, total: 0, updated: 0, failed: 0 };
                this.navFetchError = 'Add a ticker or AMFI scheme code to sync a holding.';
                return;
            }

            this.navFetchState = 'fetching';
            this.navFetchError = '';
            this.navFetchProgress = { completed: 0, total: holdings.length, updated: 0, failed: 0 };

            try {
                // The FX call used to block every quote behind it. It only affects US
                // holdings' INR conversion, so it runs alongside the pool and is awaited
                // once at the end, before values are recomputed.
                const fxReady = this.fetchUsdInrRate().catch(() => null);
                let nextIndex = 0;
                const failures = [];
                const worker = async () => {
                    while (nextIndex < holdings.length) {
                        const index = nextIndex++;
                        const investment = holdings[index];
                        try {
                            const price = await this.fetchSinglePrice(investment);
                            if (price) this.navFetchProgress.updated += 1;
                            else failures.push(`${investment.name || investment.ticker}: no price returned`);
                        } catch (error) {
                            this.navFetchProgress.failed += 1;
                            failures.push(`${investment.name || investment.ticker}: ${error.message || 'sync failed'}`);
                        } finally {
                            this.navFetchProgress.completed += 1;
                        }
                    }
                };

                // 3 workers × up to 13.5s per holding was the bulk of the wait. With the
                // doomed direct attempt gone and the proxies raced, each holding is bounded
                // at ~3s, so a wider pool is both safe for the providers and much faster.
                const workerCount = Math.min(this.canUseNativeHttp ? 8 : 6, holdings.length);
                await Promise.all(Array.from({ length: workerCount }, worker));
                await fxReady;

                // Re-derive US values once the real rate is known — a quote that landed
                // before FX resolved would otherwise keep the estimated conversion.
                for (const inv of holdings) {
                    const isUS = inv.type === 'Stock (US)' || inv.type === 'ETF (US)' || inv.currency === 'USD';
                    if (!isUS || !Number.isFinite(Number(inv.currentPrice)) || !(Number(inv.units) > 0)) continue;
                    inv.currentValue = Math.round(Number(inv.units) * Number(inv.currentPrice) * this.fxUsdInr * 100) / 100;
                    inv.fxRate = this.fxUsdInr;
                    inv.fxAsOf = this.usdInrAsOf;
                    inv.fxEstimated = this.fxIsEstimated;
                }

                this.lastNavFetchTime = new Date().toISOString();
                this.investments = [...this.investments];

                // Anything bought off-hours settles here, BEFORE the snapshot
                // below: a lot that fills today changes the cost basis, and
                // recording the day's net worth first would date the purchase
                // to tomorrow. Settling never touches the live price — it fixes
                // what the units cost, not what they are worth now.
                await this.settleAllPendingLots();

                // The sweep is the honesty mechanism, not decoration: it travels
                // only over rows whose quote actually landed, so a sync that
                // updated 3 of 11 holdings looks like one.
                if (window.RFMMotion) {
                    this.$nextTick(() => window.RFMMotion.syncSweep('[data-holding-row]'));
                    if (this.navFetchProgress.failed > 0) window.RFMMotion.Haptics.warn();
                    else if (this.navFetchProgress.updated > 0) window.RFMMotion.Haptics.success();
                }
                this.saveNwSnapshot({ source: 'price-sync' });
                this.renderNwChart();
                this.saveData();
                this.navFetchState = failures.length === holdings.length ? 'error' : 'done';
                this.navFetchError = failures.length ? failures.slice(0, 2).join(' | ') : '';
            } catch (error) {
                console.error('Error fetching live prices:', error);
                this.navFetchState = 'error';
                this.navFetchError = 'Price sync could not start. Check your connection and retry.';
            }
        },

        // ════════════════════════════════════════════════════════════
        //  PHASE 12: NATIVE MATURITY & SIP PAYMENT LOCAL NOTIFICATIONS
        // ════════════════════════════════════════════════════════════

        async scheduleMaturityAlerts() {
            // Only run on native Android/iOS when explicitly opted in
            if (localStorage.getItem('corpus_alerts_enabled') !== 'true') {
                this.alertsState = 'disabled';
                return;
            }

            const plugins = window.AppPlugins;
            if (!plugins || !plugins.Capacitor?.isNativePlatform() || !plugins.LocalNotifications) {
                this.alertsState = 'unsupported';
                return;
            }

            this.alertsState = 'scheduling';
            this.alertsError = '';

            try {
                const { LocalNotifications } = plugins;

                // 1. Check permission before requesting — avoids UI freeze or redundant prompts
                let permResult = await LocalNotifications.checkPermissions();
                if (permResult.display !== 'granted') {
                    permResult = await LocalNotifications.requestPermissions();
                }
                this.notifPermissionGranted = (permResult.display === 'granted');
                if (!this.notifPermissionGranted) {
                    this.alertsState = 'error';
                    this.alertsError = 'Notification permission not granted.';
                    return;
                }

                // 2. Cancel ALL previously scheduled RFM notifications (clean slate)
                const pending = await LocalNotifications.getPending();
                if (pending.notifications && pending.notifications.length > 0) {
                    await LocalNotifications.cancel({ notifications: pending.notifications });
                }

                const alerts = [];
                const now = new Date();

                // 3. Maturity Alerts — fire 7 days before each investment's maturityDate
                (this.investments || []).forEach((inv, i) => {
                    if (!inv.maturityDate) return;
                    const matDate = new Date(inv.maturityDate);
                    const alertAt = new Date(matDate);
                    alertAt.setDate(alertAt.getDate() - 7);
                    alertAt.setHours(9, 0, 0, 0); // 9:00 AM

                    if (alertAt > now) {
                        alerts.push({
                            id:    10000 + i,
                            title: '📅 Maturity Alert — RFM',
                            body:  `${inv.name} of ${this.formatCurrency(inv.amount)} matures in 7 days (${this.formatDate(inv.maturityDate)}). Plan reinvestment now.`,
                            schedule: { at: alertAt },
                            sound:    'default',
                            smallIcon: 'ic_stat_notification',
                            channelId: 'rfm_maturity'
                        });
                    }

                    // Also schedule a same-day reminder at 9 AM on maturity date
                    const sameDayAlert = new Date(matDate);
                    sameDayAlert.setHours(9, 0, 0, 0);
                    if (sameDayAlert > now) {
                        alerts.push({
                            id:    11000 + i,
                            title: '🔔 Maturity Today — RFM',
                            body:  `${inv.name} (${this.formatCurrency(inv.amount)}) matures TODAY. Contact ${inv.issuer || 'your bank'} to reinvest.`,
                            schedule: { at: sameDayAlert },
                            sound:    'default',
                            smallIcon: 'ic_stat_notification',
                            channelId: 'rfm_maturity'
                        });
                    }
                });

                // 4. SIP Reminders — upcoming 1 debit reminder per active SIP
                (this.activeSips || []).forEach((sip, i) => {
                    const debitDay = Number(sip.dayOfMonth) || 5;
                    const reminderAt = new Date(now.getFullYear(), now.getMonth(), debitDay - 1, 9, 0, 0, 0);
                    if (reminderAt <= now) {
                        reminderAt.setMonth(reminderAt.getMonth() + 1);
                    }
                    alerts.push({
                        id:    20000 + (i * 100),
                        title: '💰 SIP Reminder — RFM',
                        body:  `${this.formatCurrency(sip.monthlyAmount)} for "${sip.name}" debits tomorrow (${debitDay}th). Ensure sufficient balance.`,
                        schedule: { at: reminderAt },
                        sound:    'default',
                        smallIcon: 'ic_stat_notification',
                        channelId: 'rfm_sip'
                    });
                });

                // 5. Schedule in one batch call
                if (alerts.length > 0) {
                    await LocalNotifications.schedule({ notifications: alerts });
                }

                this.scheduledAlertsCount = alerts.length;
                this.alertsState = 'scheduled';

            } catch (err) {
                console.warn('[Phase 12] Notification scheduling issue:', err);
                this.alertsState = 'error';
                this.alertsError = err.message || 'Error scheduling notifications.';
            }
        },

        // ════════════════════════════════════════════════════════════
        //  UTILITIES
        // ════════════════════════════════════════════════════════════
        // A SECOND formatDate used to live here. Two methods of the same name in one object
        // literal is not an error — the later one simply wins — so the guarded version above
        // was dead, and an unparseable date rendered as "Invalid Date" instead of being
        // echoed back. Deleted rather than merged; the survivor already does more.

        // ════════════════════════════════════════════════════════════
        //  REGENERATIVE WEALTH METHODS
        // ════════════════════════════════════════════════════════════

        // ════════════════════════════════════════════════════════════
        //  THE PERSON — one-time questions
        // ════════════════════════════════════════════════════════════
        /* Offered on first open, including to installs that predate it. A skip
           records WHEN, and the questions come back after a week rather than
           on every launch — asking every time is nagging, never asking again
           leaves the reading generic for good. */
        PROFILE_RETRY_MS: 7 * 24 * 60 * 60 * 1000,

        get shouldAskProfile() {
            if (this.profile.completedAt) return false;
            const skipped = Date.parse(this.profile.skippedAt || '');
            return !Number.isFinite(skipped) || Date.now() - skipped >= this.PROFILE_RETRY_MS;
        },

        PROFILE_OPTIONS: {
            goal: [
                { v: 'grow',       t: 'Grow over the long term',  d: 'Higher returns, and I can ride out the dips' },
                { v: 'balanced',   t: 'Balanced growth',          d: 'Some growth, some safety' },
                { v: 'safe',       t: 'Keep it safe',             d: 'Protecting what I have matters most' },
                { v: 'income',     t: 'Pay me a regular income',  d: 'Monthly or quarterly payouts' },
                { v: 'retirement', t: 'Build towards retirement', d: 'Growing a corpus for later' },
                { v: 'retired',    t: 'I\u2019m retired',         d: 'Steady income and safety of capital' },
            ],
            risk: [
                { v: 'low',    t: 'Sell to stop the loss', d: 'I would rather not see it fall further' },
                { v: 'medium', t: 'Wait it out',           d: 'Markets recover; I would hold' },
                { v: 'high',   t: 'Buy more',              d: 'A fall is a chance to buy cheaper' },
            ],
            payout: [
                { v: 'monthly',   t: 'Monthly' }, { v: 'quarterly', t: 'Quarterly' },
                { v: 'yearly',    t: 'Yearly' },  { v: 'none',      t: 'No, let it grow' },
            ],
            horizon: [
                { v: 'lt3', t: 'Under 3 years' }, { v: '3to7', t: '3 to 7 years' },
                { v: '7to15', t: '7 to 15 years' }, { v: 'gt15', t: 'More than 15 years' },
            ],
            interests: [
                { v: 'stocks', t: 'Stocks' }, { v: 'mf', t: 'Mutual funds' },
                { v: 'gold', t: 'Gold & silver' }, { v: 'schemes', t: 'Government schemes', d: 'PPF, SCSS, post office' },
                { v: 'fdbonds', t: 'FDs & bonds' }, { v: 'us', t: 'US markets' },
            ],
        },

        // Payouts are asked only of someone whose goal implies them.
        get onboardingSteps() {
            const d = this.onboarding.draft || {};
            const steps = ['name', 'age', 'goal', 'risk'];
            if (['income', 'retired', 'safe'].includes(d.goal)) steps.push('payout');
            steps.push('horizon', 'interests');
            return steps;
        },
        get onboardingStep() { return this.onboardingSteps[this.onboarding.step] || 'name'; },

        get onboardingCanNext() {
            const d = this.onboarding.draft || {};
            switch (this.onboardingStep) {
                case 'name': return String(d.name || '').trim().length > 0;
                case 'age': { const a = Number(d.age); return Number.isFinite(a) && a >= 12 && a <= 110; }
                case 'interests': return (d.interests || []).length > 0;
                default: return !!d[this.onboardingStep];
            }
        },

        openOnboarding(editing = false) {
            this.onboarding.draft = {
                name: this.profile.name || '', age: this.profile.age || '', goal: this.profile.goal,
                risk: this.profile.risk, payout: this.profile.payout, horizon: this.profile.horizon,
                interests: [...(this.profile.interests || [])],
            };
            this.onboarding.step = 0;
            this.onboarding.editing = editing;
            this.onboarding.open = true;
        },

        onboardingPick(key, value) {
            this.onboarding.draft[key] = value;
            if (window.RFMMotion?.Haptics && this.haptics) window.RFMMotion.Haptics.tap();
            // A single choice moves on by itself; typing and multi-select wait for Next.
            if (['goal', 'risk', 'payout', 'horizon'].includes(key)) setTimeout(() => this.onboardingNext(), 220);
        },

        onboardingToggleInterest(v) {
            const list = this.onboarding.draft.interests;
            const i = list.indexOf(v);
            if (i >= 0) list.splice(i, 1); else list.push(v);
        },

        onboardingNext() {
            if (!this.onboardingCanNext) return;
            if (this.onboarding.step < this.onboardingSteps.length - 1) this.onboarding.step++;
            else this.finishOnboarding();
        },

        onboardingBack() {
            if (this.onboarding.step > 0) this.onboarding.step--;
        },

        finishOnboarding() {
            const d = this.onboarding.draft;
            const age = Math.round(Number(d.age));
            this.profile = {
                name: String(d.name || '').trim().slice(0, 40), age,
                goal: d.goal, risk: d.risk,
                payout: this.onboardingSteps.includes('payout') ? d.payout : null,
                horizon: d.horizon, interests: [...d.interests],
                completedAt: new Date().toISOString(), skippedAt: null,
            };
            // Age decides the tax slabs and 80TTB; the person just told us it.
            this.tax.seniorCitizen = age >= 60;
            this.onboarding.open = false;
            if (window.RFMMotion?.Haptics && this.haptics) window.RFMMotion.Haptics.success();
            // A new profile is a new brief — the cached one was written for someone else.
            this.maybeRunDaily(true);
        },

        skipOnboarding() {
            if (!this.onboarding.editing) this.profile.skippedAt = new Date().toISOString();
            this.onboarding.open = false;
        },

        get profileGreetingName() {
            return this.profile.completedAt && this.profile.name ? this.profile.name.split(/\s+/)[0] : '';
        },

        // ════════════════════════════════════════════════════════════
        //  THE DAILY BRIEF
        // ════════════════════════════════════════════════════════════
        /* Prepared on the first open of each local day. One gateway request
           per person per day; the cache answers every later open. Failure is
           quiet on purpose: the card falls back to the on-device health score,
           which needs no network and is never wrong about the user's own numbers. */
        async maybeRunDaily(force = false) {
            if (!window.RegenWealth || this.daily.loading) return;
            if (!this.profile.completedAt && !this.hasAnyPortfolioData) return;
            const cached = window.RegenWealth.loadDaily(this.$data);
            if (cached && !force) { this.daily.brief = cached; return; }
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            this.daily.loading = true;
            this.daily.error = '';
            try {
                this.daily.brief = await window.RegenWealth.runDaily(this.$data, { force });
            } catch (e) {
                this.daily.error = e?.message || 'Today\u2019s brief is unavailable.';
            } finally {
                this.daily.loading = false;
            }
        },

        get dailyPreparedLabel() {
            const at = Date.parse(this.daily.brief?.preparedAt || '');
            if (!Number.isFinite(at)) return '';
            const t = new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
            return `Prepared today at ${t}`;
        },

        // `icon:` keys, so scripts/icon-names.mjs sees these glyphs and the
        // font subset carries them — a missing glyph renders as its NAME.
        DAILY_KINDS: {
            news: { icon: 'newspaper' }, rate: { icon: 'percent' }, price: { icon: 'monitoring' },
            action: { icon: 'task_alt' }, reminder: { icon: 'event' },
        },
        dailyKindIcon(kind) {
            return (this.DAILY_KINDS[kind] || this.DAILY_KINDS.news).icon;
        },

        fitClass(status) {
            return status === 'on-track' ? 'is-add' : status === 'off-track' ? 'is-cut' : '';
        },

        fitLabel(status) {
            return { 'on-track': 'On track', drifting: 'Drifting', 'off-track': 'Off track' }[status] || '';
        },

        // Clear cached analysis and force fresh fetch
        clearRegenCache() {
            window.RegenWealth?.clearCache();
            this.regenWealth.analysis = null;
        },

        // Main analysis runner — called by the Analyze button
        /* `force` is what the Re-run button passes. Without it, a reading that
           is still valid is served from cache: the portfolio has not moved, the
           prices have not moved and the headlines have not moved, so a fresh
           pass would spend twenty-odd requests and a paid model call to arrive
           at the same answer. The cache already knew this — nothing had ever
           asked it. */
        async runRegenWealthAnalysis(force = false) {
            if (!window.RegenWealth) {
                this.regenWealth.error = 'Analysis engine not loaded. Please refresh the page.';
                return;
            }
            if (this.regenWealth.loading) return;   // a second tap is not a second run

            if (!force) {
                const cached = window.RegenWealth.loadCached(this.$data);
                if (cached) {
                    this.regenWealth.analysis = cached;
                    this.regenWealth.error = '';
                    if (window.RFMMotion) this.$nextTick(() => window.RFMMotion.revealInsights());
                    return;
                }
            }

            this.regenWealth.loading     = true;
            this.regenWealth.error       = '';
            this.regenWealth.progressMsg = 'Starting analysis...';

            try {
                const result = await window.RegenWealth.analyzeManaged(
                    this.$data,
                    (msg) => { this.regenWealth.progressMsg = msg; },
                    // An unforced run may share a research pack the daily brief
                    // gathered minutes ago; Re-run always fetches afresh.
                    { reuse: !force }
                );
                this.regenWealth.analysis    = result;
                this.regenWealth.progressMsg = '';
            } catch (err) {
                this.regenWealth.error       = err.message || 'Analysis failed. Please try again.';
                this.regenWealth.progressMsg = '';
            } finally {
                this.regenWealth.loading = false;
                if (this.regenWealth.analysis && window.RFMMotion) {
                    this.$nextTick(() => window.RFMMotion.revealInsights());
                }
            }
        },

        /* Buy and Trim are the two verdicts that should stop a thumb. Hold,
           Keep and Review stay quiet — colouring every verdict would make the
           colour mean nothing. */
        regenVerdictClass(verdict) {
            if (verdict === 'Buy' || verdict === 'Add')  return 'is-add';
            if (verdict === 'Exit' || verdict === 'Trim') return 'is-cut';
            return '';
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — BACKUP & RESTORE (Phase 7)
        // ════════════════════════════════════════════════════════════
        // Everything a restore must carry. Backup previously exported rfm_v1 alone, so a
        // restore on a new phone silently dropped the entire net-worth history behind the
        // hero chart — with a "restored successfully" message. API keys are deliberately
        // NOT included: a backup is a plaintext file the user emails or copies around.
        BACKUP_KEYS: ['rfm_v1', 'rfm_nw_history', 'rfm_usd_inr_rate', 'rfm_api_provider', 'rfm_api_model', 'rfm_api_custom_model'],

        async backupData() {
            const data = localStorage.getItem('rfm_v1');
            if (!data) {
                alert('No data to backup.');
                return;
            }
            const payload = { format: 'rfm-backup', formatVersion: 2, exportedAt: new Date().toISOString(), keys: {} };
            for (const k of this.BACKUP_KEYS) {
                const v = localStorage.getItem(k);
                if (v !== null) payload.keys[k] = v;
            }
            const jsonStr = JSON.stringify(payload, null, 2);
            const filename = `corpus_backup_${new Date().toISOString().slice(0, 10)}.json`;

            // Native Android / Capacitor environment
            if (window.AppPlugins?.Capacitor?.isNativePlatform?.() && window.AppPlugins?.Filesystem) {
                try {
                    const { Filesystem, Directory, Share } = window.AppPlugins;

                    // 1. Write file to Cache directory for native sharing via FileProvider
                    const fileResult = await Filesystem.writeFile({
                        path: filename,
                        data: jsonStr,
                        directory: Directory.Cache,
                        encoding: 'utf8'
                    });

                    // 2. Also save a persistent copy to Documents folder
                    try {
                        await Filesystem.writeFile({
                            path: filename,
                            data: jsonStr,
                            directory: Directory.Documents,
                            encoding: 'utf8'
                        });
                    } catch (docErr) {
                        console.warn('Could not write to Documents directory:', docErr);
                    }

                    // 3. Open Android system Share / Save dialog
                    let shared = false;
                    if (Share && fileResult?.uri) {
                        try {
                            await Share.share({
                                title: 'Corpus Backup',
                                text: `Corpus financial portfolio backup (${new Date().toLocaleDateString('en-IN')})`,
                                url: fileResult.uri,
                                dialogTitle: 'Save or Share Backup'
                            });
                            shared = true;
                        } catch (shareErr) {
                            console.log('Share dismissed or cancelled:', shareErr);
                        }
                    }

                    if (window.RFMMotion?.Haptics) {
                        window.RFMMotion.Haptics.success();
                    }

                    if (!shared) {
                        alert(`Backup saved successfully!\n\nFile: ${filename}\nSaved to Documents folder.`);
                    }
                    return;
                } catch (nativeErr) {
                    console.error('Native backup error:', nativeErr);
                }
            }

            // Web / Desktop browser fallback
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (window.RFMMotion?.Haptics) {
                window.RFMMotion.Haptics.tap();
            }
        },

        async restoreData(event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                
                // v2 envelope carries every key; a v1 file is the bare rfm_v1 blob. Both are
                // accepted so backups taken before this change still restore.
                const isV2 = parsed && parsed.format === 'rfm-backup' && parsed.keys;
                const isV1 = parsed && parsed.version && parsed.investments;
                if (!isV2 && !isV1) {
                    alert('Invalid backup file format.');
                    return;
                }

                const restoring = isV2 ? parsed.keys : { rfm_v1: JSON.stringify(parsed) };
                const names = Object.keys(restoring).filter(k => this.BACKUP_KEYS.includes(k));
                if (!names.includes('rfm_v1')) {
                    alert('This backup has no portfolio data in it.');
                    return;
                }

                const summary = isV2
                    ? `Restore ${names.length} data set(s) from ${parsed.exportedAt ? this.formatDate(parsed.exportedAt) : 'this file'}?`
                    : 'Restore portfolio data from this older backup? It does not contain net-worth history.';

                if (confirm(`${summary}\n\nThis replaces your current data and cannot be undone.`)) {
                    for (const k of names) localStorage.setItem(k, restoring[k]);
                    this.loadData();
                    this.loadNwHistory?.();
                    this.loadCachedFxRate();
                    this.renderNwChart?.();
                    alert(`Restored ${names.length} data set(s).`);
                }
            } catch (err) {
                console.error('Restore error:', err);
                alert('Error reading backup file: ' + err.message);
            }
            // Reset file input so the same file can be selected again
            event.target.value = '';
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — SIP & RECURRING (Phase 9: Intelligent Auto-Compounding Engine)
        // ════════════════════════════════════════════════════════════
        async addSip() {
            if (!this.newSip.name || !this.newSip.monthlyAmount) return;

            const name = this.newSip.name.trim();
            const schemeCode = (this.newSip.schemeCode || '').trim();
            const ticker = (this.newSip.ticker || '').trim();

            // 1. Intelligent Holding Resolution: Check if this MF/Stock is already registered in investments
            let existingHolding = (this.investments || []).find(inv => {
                if (schemeCode && inv.schemeCode === schemeCode) return true;
                if (ticker && (inv.ticker || '').toUpperCase() === ticker.toUpperCase()) return true;
                const invName = (inv.name || '').toLowerCase();
                const searchName = name.toLowerCase();
                return invName === searchName || invName.includes(searchName) || searchName.includes(invName);
            });

            // 2. If not found in investments, automatically register a new Mutual Fund / Stock holding!
            if (!existingHolding) {
                // Market cannot be inferred from a ticker alone — NSE and US symbols are both
                // plain letters. This used to consult a hardcoded list of four specific US
                // tickers, which was dead (newSip.ticker is never written by any form) and
                // would have misclassified every other US symbol the moment it wasn't. A new
                // holding therefore defaults to the Indian market and is editable afterwards;
                // if a ticker field is ever added here, add a market selector beside it.
                const holdingType = schemeCode ? 'Mutual Fund' : 'Stock (IND)';

                existingHolding = {
                    id:            this.newId('inv'),
                    name:          name,
                    type:          holdingType,
                    schemeCode:    schemeCode,
                    ticker:        ticker,
                    units:         0,
                    buyPrice:      0,
                    currentPrice:  0,
                    amount:        0,
                    lastNavUpdate: new Date().toISOString()
                };
                this.investments.push(existingHolding);

                // Instantly fetch live NAV for newly auto-created holding
                this.fetchSinglePrice(existingHolding);
            }

            const createdSip = {
                ...this.newSip,
                id:                 this.newId('sip'),
                monthlyAmount:      Number(this.newSip.monthlyAmount),
                dayOfMonth:         Number(this.newSip.dayOfMonth) || 5,
                linkedInvestmentId: existingHolding.id,
                schemeCode:         schemeCode || existingHolding.schemeCode || '',
                ticker:             ticker || existingHolding.ticker || '',
                // Starts settled for the current month. Creating a plan on the 20th is not
                // evidence that this month's instalment was paid, and the old code bought a
                // month of units the instant the form was submitted.
                lastExecutedMonth:  this.currentMonthKey
            };

            this.sips.push(createdSip);

            this.newSip = {
                name: '', type: 'SIP', monthlyAmount: '',
                dayOfMonth: 5, startDate: '', endDate: '',
                status: 'Active', linkedInvestmentId: null, ticker: '', schemeCode: ''
            };
            this.sipMfSearch = { query: '', results: [], loading: false, show: false, _timer: null };
            this.addingSip = false;
            this.saveData();
        },

        // ── SIP INSTALMENTS — RECORDED, NOT ASSUMED ────────────────────
        // This replaces an "automated execution engine" that ran inside loadData() on every
        // launch. When a debit day had passed it created any missing holding, bought units
        // at whatever price it could find, and — when it could find none — at a hardcoded
        // ₹100 NAV. So opening the app silently rewrote the portfolio using a made-up price,
        // in an app whose stated contract is that it never invents one.
        //
        // The deeper fault is that it could not possibly know. Nothing here talks to a bank.
        // A mandate can bounce, an AMC can reject, a plan can be paused at the AMC without
        // being paused here — in each case the app had already recorded units nobody owned.
        // A SIP is a PLAN. An instalment is an EVENT. The user is the only witness to the
        // event, so the app now surfaces what looks due and records only what is confirmed.

        get currentMonthKey() {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        },

        /* Active SIPs whose debit day has passed this month and which have not yet been
           settled either way. */
        get dueSipDebits() {
            const today = new Date().getDate();
            const monthKey = this.currentMonthKey;
            return (this.activeSips || []).filter(sip =>
                today >= (Number(sip.dayOfMonth) || 5) && sip.lastExecutedMonth !== monthKey
            );
        },

        _linkedHolding(sip) {
            return (this.investments || []).find(inv =>
                inv.id === sip.linkedInvestmentId ||
                (sip.schemeCode && inv.schemeCode === sip.schemeCode) ||
                (inv.name || '').toLowerCase() === (sip.name || '').toLowerCase()
            ) || null;
        },

        /* The user confirms the money left their account. Only then do units appear — and
           only at a price that actually came from a provider. Without one there is nothing
           honest to write, so it says so and stops rather than guessing. */
        async confirmSipDebit(sip) {
            const holding = this._linkedHolding(sip);
            if (!holding) {
                this.sipDebitError = `${sip.name} is not linked to a holding yet. Open it and pick one first.`;
                return false;
            }

            let price = Number(holding.currentPrice) || Number(holding.buyPrice) || 0;
            if (price <= 0) {
                try {
                    price = Number(await this.fetchSinglePrice(holding)) || 0;
                } catch (e) {
                    price = 0;
                }
            }
            if (price <= 0) {
                this.sipDebitError = `No price is available for ${holding.name}, so the units cannot be worked out. Sync prices and try again, or enter the units by hand.`;
                return false;
            }

            const debitAmount = Number(sip.monthlyAmount) || 0;
            if (debitAmount <= 0) return false;

            const isUsd = holding.currency === 'USD' || ['Stock (US)', 'ETF (US)'].includes(holding.type);
            const priceInInr = price * (isUsd ? this.fxUsdInr : 1);
            const addedUnits = debitAmount / priceInInr;

            const totalUnits = (Number(holding.units) || 0) + addedUnits;
            const totalCost  = (Number(holding.amount) || 0) + debitAmount;

            holding.units        = Math.round(totalUnits * 1000) / 1000;
            holding.amount       = Math.round(totalCost * 100) / 100;
            holding.buyPrice     = Math.round((totalCost / totalUnits / (isUsd ? this.fxUsdInr : 1)) * 100) / 100;
            holding.currentValue = Math.round(totalUnits * priceInInr * 100) / 100;

            sip.lastExecutedMonth = this.currentMonthKey;
            this.sipDebitError = '';
            this.investments = [...this.investments];
            this.saveData();
            this.queueNwSnapshot('sip-instalment');
            if (this.haptics && window.RFMMotion) window.RFMMotion.Haptics.commit();
            return true;
        },

        /* The instalment did not happen — a bounced mandate, or a plan paused at the AMC.
           Settles the month without touching the holding. */
        skipSipDebit(sip) {
            sip.lastExecutedMonth = this.currentMonthKey;
            this.sipDebitError = '';
            this.sips = [...this.sips];
            this.saveData();
        },

        sipDebitError: '',

        // ════════════════════════════════════════════════════════════
        //  SIP MODAL: AMFI MUTUAL FUND TYPEAHEAD AUTOCOMPLETE
        // ════════════════════════════════════════════════════════════

        // Called on every keystroke in the SIP Plan Name field
        async searchSipMf() {
            const q = this.newSip.name.trim();

            // Hide dropdown for short queries
            if (q.length < 3 || this.newSip.type === 'RD' || this.newSip.type === 'EMI' || this.newSip.type === 'Other') {
                this.sipMfSearch.results = [];
                this.sipMfSearch.show = false;
                return;
            }

            // Debounce: wait 350ms after user stops typing
            clearTimeout(this.sipMfSearch._timer);
            this.sipMfSearch._timer = setTimeout(async () => {
                this.sipMfSearch.loading = true;
                this.sipMfSearch.show = true;
                try {
                    const res = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`);
                    if (res.ok) {
                        const data = await res.json();
                        // Top 7 results, sorted by closest name match
                        this.sipMfSearch.results = (data || []).slice(0, 7);
                    } else {
                        this.sipMfSearch.results = [];
                    }
                } catch (e) {
                    this.sipMfSearch.results = [];
                } finally {
                    this.sipMfSearch.loading = false;
                }
            }, 350);
        },

        // Called when user taps a dropdown result in the SIP modal
        selectSipMf(scheme) {
            this.newSip.name       = scheme.schemeName;
            this.newSip.schemeCode = String(scheme.schemeCode);
            // Auto-set type to SIP if it's a mutual fund
            if (this.newSip.type !== 'SIP') this.newSip.type = 'SIP';
            // Close dropdown
            this.sipMfSearch.results = [];
            this.sipMfSearch.show    = false;
            // Focus the Monthly Amount field after selection
            this.$nextTick(() => {
                const el = document.getElementById('sip-monthly-amount');
                if (el) el.focus();
            });
        },

        closeSipDropdown() {
            // Small delay to let click on result register before hiding
            setTimeout(() => {
                this.sipMfSearch.show = false;
                this.sipMfSearch.results = [];
            }, 180);
        },

        deleteSip(id) {
            if (confirm('Delete this recurring plan?')) {
                this.sips = this.sips.filter(s => s.id !== id);
            }
        },

        openEditSipModal(sip) {
            this.editSipForm = { ...sip };
            this.editingSip  = sip;
        },

        saveSipEdit() {
            const idx = this.sips.findIndex(s => s.id === this.editSipForm.id);
            if (idx !== -1) {
                this.editSipForm.monthlyAmount = Number(this.editSipForm.monthlyAmount);
                this.editSipForm.dayOfMonth    = Number(this.editSipForm.dayOfMonth) || 5;
                this.sips[idx] = { ...this.editSipForm };
                this.sips = [...this.sips];
            }
            this.editingSip = null;
        },

        cancelSipEdit() { this.editingSip = null; },

        toggleSipStatus(sip) {
            const idx = this.sips.findIndex(s => s.id === sip.id);
            if (idx !== -1) {
                this.sips[idx].status = this.sips[idx].status === 'Active' ? 'Paused' : 'Active';
                this.sips = [...this.sips];
            }
        },

        getSipLinkedName(sip) {
            if (!sip.linkedInvestmentId) return '';
            const inv = this.investments.find(i => i.id === sip.linkedInvestmentId);
            return inv ? inv.name : '';
        },

        getSipDaysUntilDebit(sip) {
            const today = new Date().getDate();
            const debit = Number(sip.dayOfMonth);
            const diff  = debit >= today ? debit - today : (31 - today) + debit;
            return diff === 0 ? 'Today!' : `in ${diff} day${diff !== 1 ? 's' : ''}`;
        }

    }));
});
