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


        // ── Data Stores ─────────────────────────────────────────────
        investments: [],
        bankTransactions: [],
        bankImportAccount: '',

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

        cpi: null,
        cpiOffline: false,

        get cpiStale() {
            if (!this.cpi?.releasedOn) return true;
            const published = Date.parse(this.cpi.releasedOn);
            return !Number.isFinite(published) || Date.now() - published > 50 * 86400000;
        },

        get cpiLabel() {
            if (!Number.isFinite(Number(this.cpi?.rate))) return 'India CPI unavailable';
            return `${Number(this.cpi.rate).toFixed(2)}% · ${this.cpi.referenceMonth}${this.cpiStale || this.cpiOffline ? ' · last available' : ''}`;
        },

        async refreshCpi() {
            const endpoint = String(window.CorpusAiConfig?.endpoint || '').replace(/\/v1\/portfolio-reading$/, '/v1/cpi/latest');
            if (!endpoint || !endpoint.endsWith('/v1/cpi/latest')) return;
            try {
                const res = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
                if (!res.ok) throw new Error('CPI endpoint unavailable');
                const next = await res.json();
                if (!Number.isFinite(Number(next.rate)) || !/^\w+ \d{4}$/.test(next.referenceMonth || '') || !next.releasedOn) throw new Error('Invalid CPI');
                this.cpi = next;
                this.cpiOffline = false;
                this.saveData();
            } catch (_) { this.cpiOffline = true; }
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
            sales: [],
            gainsSource: 'manual', // Migrate legacy input without counting it alongside sales.
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
            version: 2, name: '', age: null, holdings: [], purpose: {}, fall: {}, horizon: {}, payout: {}, knows: {},
            income: [], dependents: [], cover: [], plans: {}, completedAt: null, skippedAt: null, catchUpSkippedAt: null,
        },
        onboarding: { open: false, step: 0, draft: null, editing: false, catchUp: false },

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
        saleHolding: null,
        saleForm: { date: '', quantity: '', proceeds: '', fees: 0, sttEligible: false, fundTaxClass: '', bondListing: '', proceedsDestination: 'cash' },
        saleError: '',
        acquisitionHolding: null,
        acquisitionForm: { date: '', quantity: '', cost: '' },
        acquisitionError: '',
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
            rate: '', payout: 'Monthly', rating: '', maturityDate: '', startDate: '',
            ticker: '', units: '', buyPrice: '', currentPrice: '',
            purchaseDate: '', assetClass: 'equity', schemeCode: '', annualDeposit: '', monthlyDeposit: '',
            metal: 'gold', metalUnit: 'g', purity: 100, metalValuationMode: 'benchmark', manualPrice: ''
        },
        addKind: 'st',
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
        bankImport: null,
        bankImportSelections: {},

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
        // One line on the inverse surface after a background action ends.
        snack: { text: '', on: false },
        _snackTimer: 0,
        showSnack(text) {
            if (!text) return;
            clearTimeout(this._snackTimer);
            this.snack.text = text;
            this.snack.on = true;
            this._snackTimer = setTimeout(() => { this.snack.on = false; }, 3200);
        },

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
            this.refreshCpi();
            this.$store.account?.attach(this);
            this._repairSipLinks();
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
            if (localStorage.getItem('corpus_alerts_enabled') !== 'false') {
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
            if (this.shouldAskProfile) this.openOnboarding(false, !!this.profile.completedAt && this.profile.version !== 2);
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

            // A field the designs drew as a box around its text is one target: a
            // tap anywhere on it focuses the input inside, and it takes the
            // design's focused look while it has focus.
            document.addEventListener('click', e => {
                const f = e.target.closest && e.target.closest('.field');
                if (!f || e.target.closest('input, select, textarea, button')) return;
                const input = f.querySelector('input:not([type="hidden"]), select, textarea');
                if (input) input.focus();
            });
            document.addEventListener('focusin', e => { const f = e.target.closest && e.target.closest('.field'); if (f) f.classList.add('focus'); });
            document.addEventListener('focusout', e => { const f = e.target.closest && e.target.closest('.field'); if (f) f.classList.remove('focus'); });

            // Bound on the next tick: initPullToRefresh reaches for #ptr, which
            // does not exist until Alpine has rendered the shell.
            this.$nextTick(() => this.initPullToRefresh());
            try {
                const back = sessionStorage.getItem('corpus_return');
                if (back) { sessionStorage.removeItem('corpus_return'); this.activePage = back; }
            } catch (e) {}
            this.initKeyboardAvoidance();
            this.initScrollFlag();

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
                document.dispatchEvent(new Event('corpus:data-saved'));
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
            return long ? `${this.shortDate(d)} ${String(d.getFullYear()).slice(2)}` : this.shortDate(d);
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
            return n === 1 ? `${last}, ${count}`
                           : `${this.formatObsDate(pts[0].date)} to ${last}, ${count}`;
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

        // The same figure for a screen reader. TalkBack reads "\u20b91.54 Cr" as
        // letters, so the units are spelled out.
        formatIndianSpoken(v) {
            const n = Number(v) || 0;
            const a = Math.abs(n);
            const sign = n < 0 ? 'minus ' : '';
            if (a >= 1e7) return `${sign}${+(a / 1e7).toFixed(2)} crore rupees`;
            if (a >= 1e5) return `${sign}${+(a / 1e5).toFixed(2)} lakh rupees`;
            return `${sign}${Math.round(a).toLocaleString('en-IN')} rupees`;
        },

        rangeSpoken(r) {
            return ({ '1W': '1 week', '1M': '1 month', '3M': '3 months',
                      '6M': '6 months', '1Y': '1 year', 'ALL': 'All time' })[r] || r;
        },

        // The canvas says nothing to assistive tech, so the chart carries its
        // reading as a label: where the line starts, where it ends, over what.
        get nwChartSpoken() {
            const pts = this.nwChartData;
            if (!pts.length) return 'Corpus value chart, no history yet';
            const last = pts[pts.length - 1];
            if (pts.length === 1) return `Corpus value chart, one observation: ${this.formatIndianSpoken(last.value)} on ${this.formatObsDate(last.date)}`;
            return `Corpus value chart, ${this.rangeLabel}: from ${this.formatIndianSpoken(pts[0].value)} on ${this.formatObsDate(pts[0].date)} to ${this.formatIndianSpoken(last.value)} on ${this.formatObsDate(last.date)}`;
        },

        /* The chart is an SVG bound to nwSvg, so it redraws by itself whenever
           the history or the range changes. This only refreshes the history and
           replays the draw-in, for the callers that used to rebuild a canvas. */
        renderNwChart() {
            if (this.activePage !== 'home') return;
            this.loadNwHistory();
            this.nwDrawKey += 1;
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
                await StatusBar.setBackgroundColor({ color: '#09090B' });
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

            let startX = 0, startY = 0, pulled = 0, tracking = false, axis = '', frame = 0;
            const arc = bar.querySelector('.ptr__arc');
            const ring = bar.querySelector('circle');

            const paint = () => {
                frame = 0;
                const t = Math.min(pulled, this.PTR_MAX);
                const k = Math.min(1, pulled / this.PTR_TRIGGER);
                bar.style.transform = `translateY(${t}px) scale(${0.6 + 0.4 * k})`;
                bar.style.opacity = String(Math.min(1, t / 32));
                bar.dataset.armed = k >= 1 ? '1' : '0';
                if (ring) ring.style.strokeDasharray = `${Math.round(k * 78)} 100`;
                if (arc) arc.style.transform = `rotate(${-90 + t * 1.6}deg)`;
            };
            const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
            const reset = () => {
                pulled = 0; tracking = false;
                if (frame) { cancelAnimationFrame(frame); frame = 0; }
                bar.style.transition = 'transform .3s var(--ease), opacity .2s linear';
                bar.style.transform = 'translateY(0) scale(.4)';
                bar.style.opacity = '0';
                bar.dataset.armed = '0';
                setTimeout(() => {
                    bar.style.transition = '';
                    if (ring) ring.style.strokeDasharray = '';
                    if (arc) arc.style.transform = '';
                }, 320);
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
                bar.style.transform = `translateY(${Math.round(this.PTR_TRIGGER * 0.8)}px) scale(1)`;
                bar.style.opacity = '1';
                if (arc) arc.style.transform = '';
                this.triggerPullRefresh().then(message => {
                    reset();
                    this.showSnack(message);
                });
            };
            document.addEventListener('touchend', release, { passive: true });
            document.addEventListener('touchcancel', () => { if (tracking) reset(); }, { passive: true });
        },

        /* The WebView shrinks when the keyboard opens (Capacitor pads the view
           by the IME inset), and nothing scrolled the focused field back into
           view: in a sheet it ended up behind the sticky footer, so you could
           not see what you were typing. A drop of more than 150px from the
           tallest height seen marks the keyboard; the tallest resets when the
           width changes, so rotation does not read as a keyboard. */
        initKeyboardAvoidance() {
            const root = document.documentElement;
            let tallest = window.innerHeight, width = window.innerWidth;
            const typing = el => !!el && !!el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable="true"]');
            const reveal = () => {
                const el = document.activeElement;
                if (!typing(el) || root.dataset.kb !== '1') return;
                const box = el.closest('.field') || el;
                // A search field's results open beneath it, so it rides to the
                // top of the space left; any other field only needs to be seen.
                const search = [...box.querySelectorAll('.material-symbols-outlined')].some(i => i.textContent.trim() === 'search');
                box.scrollIntoView({ block: search ? 'start' : 'nearest', behavior: 'instant' });
            };
            const measure = () => {
                if (window.innerWidth !== width) { width = window.innerWidth; tallest = window.innerHeight; }
                tallest = Math.max(tallest, window.innerHeight);
                const open = tallest - window.innerHeight > 150 && typing(document.activeElement);
                if (open) root.dataset.kb = '1'; else delete root.dataset.kb;
                if (open) requestAnimationFrame(() => requestAnimationFrame(reveal));
            };
            window.addEventListener('resize', measure, { passive: true });
            document.addEventListener('focusin', () => setTimeout(measure, 320));
            document.addEventListener('focusout', () => setTimeout(measure, 60));
            // Results appearing under a search field, or a wrapping line, can push
            // the caret down while you type; keep it in view as you go.
            document.addEventListener('input', () => requestAnimationFrame(reveal));
        },

        // A hairline under the pinned top bar once content scrolls beneath it.
        initScrollFlag() {
            const root = document.documentElement;
            let on = false;
            window.addEventListener('scroll', () => {
                const now = window.scrollY > 4;
                if (now !== on) { on = now; if (on) root.dataset.scrolled = '1'; else delete root.dataset.scrolled; }
            }, { passive: true });
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
                if (this.navFetchState === 'error') result = 'Sync failed. Check the connection';
                else if (failed > 0) result = `${updated} updated, ${failed} kept their last price`;
                else if (updated > 0) result = `${updated} prices updated`;
                else if (!total) result = 'Add a holding to sync';
                else result = 'No prices changed';
                if (typeof this.scheduleMaturityAlerts === 'function') {
                    await this.scheduleMaturityAlerts().catch(() => {});
                }
                this.saveData();
            } catch (err) {
                console.warn('Pull-to-refresh execution error:', err);
                result = 'Sync failed. Try again';
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
                    this.bankTransactions = Array.isArray(p.bankTransactions) ? p.bankTransactions : [];
                    this.bankImportAccount = typeof p.bankImportAccount === 'string' ? p.bankImportAccount : '';
                    this.goals       = p.goals       || [];
                    this.sips        = p.sips        || [];
                    if (p.profile) this.profile = this.migrateProfile({ ...this.profile, ...p.profile, version: p.profile.version || 1 });
                    this.lastNavFetchTime = p.lastNavFetchTime || null;
                    this.cpi = p.cpi && Number.isFinite(Number(p.cpi.rate)) ? p.cpi : null;

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
                            sales: Array.isArray(taxRest.sales) ? taxRest.sales : [],
                            gainsSource: taxRest.gainsSource === 'sales' ? 'sales' : 'manual',
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
            // Statement imports kept the invested total in `amount` and set no buy
            // price. With units present that cost was ignored everywhere. Carry it
            // into the average price it implies; a US row never takes this path,
            // because its `amount` is a rupee value, not a dollar cost.
            const isUsd = out.currency === 'USD' || ['Stock (US)', 'ETF (US)'].includes(out.type);
            const units = Number(out.units) || 0, amount = Number(out.amount) || 0;
            if (units > 0 && !(Number(out.buyPrice) > 0) && amount > 0 && !isUsd) {
                out.buyPrice = amount / units;
            }
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
                version:     '4.0',
                investments: this.investments,
                bankTransactions: this.bankTransactions,
                bankImportAccount: this.bankImportAccount,
                pension:     this.pension,
                cashflow:    this.cashflow,
                networth:    this.networth,
                emergency:   this.emergency,
                tax:         this.tax,
                goals:       this.goals,
                sips:        this.sips,
                profile:     this.profile,
                cpi:         this.cpi,
                lastNavFetchTime: this.lastNavFetchTime
            }));
            document.dispatchEvent(new Event('corpus:data-saved'));
            // Notification work is native and expensive. Only reschedule if user explicitly opted in
            if (rescheduleAlerts && localStorage.getItem('corpus_alerts_enabled') !== 'false') {
                clearTimeout(this._alertDebounce);
                this._alertDebounce = setTimeout(() => {
                    this.scheduleMaturityAlerts().catch(e => console.warn('[Phase 12] Reschedule alerts failed:', e));
                }, 4000);
            }
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — CASH FLOW (Dynamic Multi-Stream Engine)
        // ════════════════════════════════════════════════════════════

        /* The Pension page's amount, counted as income unless an income row
           already is the pension. It was dropped entirely whenever any income row
           existed (and two always do), while the AI reading added it. */
        get pensionIncome() {
            const amt = Number(this.pension?.monthlyAmount) || 0;
            if (!(amt > 0)) return 0;
            const rows = Array.isArray(this.cashflow.incomes) ? this.cashflow.incomes : [];
            const already = rows.some(r => Number(r.amount) > 0 && (/pension/i.test(r.name || '') || String(r.category || '').toLowerCase() === 'pension'));
            return already ? 0 : amt;
        },

        get totalIncome() {
            if (this.cashflow.incomes && Array.isArray(this.cashflow.incomes) && this.cashflow.incomes.length > 0) {
                return this.cashflow.incomes.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0) + this.pensionIncome;
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
                // No price at all (a statement row without a NAV): its recorded
                // value, not ₹0, until the first sync prices it.
                if (currentPrice > 0) return isNaN(val) ? 0 : val;
            }
            // For non-unit assets (FDs, EPF, bonds): currentValue or amount. Both are
            // stored in rupees already, so no FX here; converting them again valued a
            // unitless US position at ~96x its worth.
            const val = Number(inv.currentValue) || Number(inv.amount) || 0;
            return isNaN(val) ? 0 : val;
        },

        metalQuoteStatus(inv) {
            if (inv?.type !== 'Physical Metal') return '';
            if (inv.metalValuationMode === 'manual') return `Your valuation · ${inv.metalQuoteAt ? this.shortDate(inv.metalQuoteAt) : 'date not recorded'}`;
            const age = Date.now() - Date.parse(inv.metalQuoteAt || '');
            if (!Number.isFinite(age)) return 'Benchmark pending; purchase cost shown temporarily';
            return `${age > 48 * 3600000 || this.fxIsStale ? 'Stale benchmark' : 'Indicative spot benchmark'} · ${this.shortDate(inv.metalQuoteAt)}`;
        },

        /* What was paid, and ONLY what was paid. A unit holding without a buy
           price has an unknown cost, returned as 0 and reported by hasKnownCost.
           The old fallback to `nav` took the current NAV as the cost, so every
           imported fund read "+0.00%", while the AI reading's own copy of this
           maths counted the same fund as ₹0 invested and its whole value as gain. */
        getInvInvestedCost(inv) {
            if (!inv) return 0;
            const units = Number(inv.units) || 0;
            const isUsd = inv.currency === 'USD' || ['Stock (US)', 'ETF (US)'].includes(inv.type);
            if (units > 0) {
                const val = units * (Number(inv.buyPrice) || 0) * (isUsd ? this.fxUsdInr : 1);
                return isNaN(val) ? 0 : val;
            }
            const val = Number(inv.amount) || 0;
            return isNaN(val) ? 0 : val;
        },

        hasKnownCost(inv) {
            return this.getInvInvestedCost(inv) > 0;
        },

        // Stocks, ETFs, funds and gold rise and fall with a market. Deposits, EPF,
        // PPF, schemes and bonds are balances: what they hold is not a "gain".
        isMarketLinked(inv) {
            return ['equity', 'mf', 'gold', 'metals'].includes(this._chipOf(inv));
        },

        getInvPnL(inv) {
            if (!this.hasKnownCost(inv)) return 0;
            const pnl = this.getInvCurrentValue(inv) - this.getInvInvestedCost(inv);
            return isNaN(pnl) ? 0 : pnl;
        },

        /* Invested, now and gain across market-linked holdings with a known
           cost, the one set of figures the Overview, Holdings and the AI reading
           all quote. Holdings left out are named rather than silently absorbed. */
        get marketBook() {
            let invested = 0, value = 0;
            const unknown = [];
            let balances = 0;
            for (const i of this.investments || []) {
                if (!this.isMarketLinked(i)) { balances += this.getInvCurrentValue(i); continue; }
                if (!this.hasKnownCost(i)) { unknown.push(i.name || i.ticker || 'Unnamed'); continue; }
                invested += this.getInvInvestedCost(i);
                value += this.getInvCurrentValue(i);
            }
            const gain = value - invested;
            return { invested, value, gain, gainPct: invested > 0 ? (gain / invested) * 100 : null, unknown, balances };
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
        // Weighed on today's value. `amount` was read here, which is a cost for
        // some rows and a stale value for others, and NaN for a row without one.
        get concentrationWarnings() {
            const total = this.investments.reduce((s, i) => s + this.getInvCurrentValue(i), 0);
            if (!(total > 0)) return [];
            const byIssuer = {};
            this.investments.forEach(inv => {
                const key = inv.issuer || inv.name;
                byIssuer[key] = (byIssuer[key] || 0) + this.getInvCurrentValue(inv);
            });
            return Object.entries(byIssuer)
                .filter(([, amt]) => (amt / total) > 0.5)
                .map(([name, amt]) => ({
                    name,
                    pct: ((amt / total) * 100).toFixed(0)
                }));
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
                if (inv.type === 'Recurring Deposit') return sum; // projected, not verified interest
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
                 + Number(this.tax.otherIncome)
                 + (this.tax.gainsSource === 'sales' ? this.saleTaxSummary.slabGain : 0);
        },

        get currentTaxFy() { return window.CorpusTaxLedger?.financialYear(this.localDateKey()) || ''; },
        get saleTaxSummary() { return window.CorpusTaxLedger?.summarize(this.tax.sales || [], this.currentTaxFy) || { amounts: {}, review: [], sales: [], specialTax: 0, slabGain: 0 }; },
        get saleYears() {
            const years = [...new Set((this.tax.sales || []).map(s => s.fy).filter(Boolean))].sort().reverse();
            return years.map(fy => window.CorpusTaxLedger.summarize(this.tax.sales, fy));
        },
        get unrealizedTaxPreview() {
            const unsold = (this.investments || []).filter(i => this.isMarketLinked(i));
            const known = unsold.filter(i => this.hasKnownCost(i));
            return { movement: known.reduce((n, i) => n + this.getInvCurrentValue(i) - this.getInvInvestedCost(i), 0),
                unknown: unsold.filter(i => !this.hasKnownCost(i)).map(i => i.name) };
        },
        get legacyGainsPending() { return Number(this.tax.realizedEquityLTCG) !== 0 || Number(this.tax.realizedEquitySTCG) !== 0; },

        openSale(inv) {
            this.saleHolding = inv;
            this.saleForm = { date: this.localDateKey(), quantity: '', proceeds: '', fees: 0,
                sttEligible: false, fundTaxClass: inv.fundTaxClass || '', bondListing: '', proceedsDestination: 'cash' };
            this.saleError = '';
        },

        openAcquisition(inv) {
            this.acquisitionHolding = inv;
            this.acquisitionForm = { date: '', quantity: '', cost: '' };
            this.acquisitionError = '';
        },

        recordAcquisition() {
            const inv = this.acquisitionHolding;
            const f = this.acquisitionForm;
            const qty = Number(f.quantity), cost = Number(f.cost);
            const purchase = new Date(`${f.date}T00:00:00Z`);
            const validDate = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '')
                && Number.isFinite(purchase.getTime()) && purchase.toISOString().slice(0, 10) === f.date;
            const accounted = (inv?.taxLots || []).reduce((n, lot) => n + (Number(lot.quantityRemaining) || 0), 0);
            if (!inv || !validDate || f.date > this.localDateKey() || !(qty > 0) || !(cost > 0)
                || accounted + qty > Number(inv.units) + 1e-5) {
                this.acquisitionError = 'Enter a real purchase date, units and cost for units still held. The total cannot exceed the holding.';
                return;
            }
            inv.taxLots = [...(inv.taxLots || []), { id: this.newId('buy'), date: f.date, quantity: qty,
                quantityRemaining: qty, cost }];
            if (Math.abs(accounted + qty - Number(inv.units)) <= 1e-5) inv.taxBasisNeedsReconciliation = false;
            this.investments = [...this.investments];
            this.acquisitionHolding = null;
            this.acquisitionError = '';
            this.saveData();
        },

        recordSale() {
            const inv = this.saleHolding;
            if (!inv) return;
            try {
                const { lots, sale } = window.CorpusTaxLedger.allocateSale(inv, this.saleForm);
                sale.id = this.newId('sale');
                const remaining = Math.round((Number(inv.units) - sale.quantity) * 1e6) / 1e6;
                inv.taxLots = lots;
                if (sale.basisUnknown) inv.taxBasisNeedsReconciliation = true;
                inv.units = Math.max(0, remaining);
                const remainingCost = lots.reduce((n, lot) => n + (Number(lot.cost) || 0) * (Number(lot.quantityRemaining) || 0) / (Number(lot.quantity) || 1), 0);
                inv.buyPrice = inv.units > 0 ? remainingCost / inv.units : 0;
                // Unknown historical cost must not turn the remaining holding
                // into a fictitious zero-cost winner in the P&L preview.
                inv.amount = sale.basisUnknown ? 0 : remainingCost;
                inv.currentValue = 0;
                inv.currentValue = this.getInvCurrentValue(inv);
                if (this.saleForm.proceedsDestination === 'cash') {
                    this.networth.cash = Math.round(((Number(this.networth.cash) || 0) + sale.proceeds - sale.fees) * 100) / 100;
                }
                this.tax.sales = [...(this.tax.sales || []), sale];
                if (!this.legacyGainsPending) this.tax.gainsSource = 'sales';
                this.investments = [...this.investments];
                this.saleHolding = null;
                this.saleError = '';
                this.saveData();
                this.queueNwSnapshot('recorded-sale');
            } catch (error) { this.saleError = error.message || 'Could not record this sale.'; }
        },

        reconcileLegacyGains() {
            if (!confirm('Use dated sales instead of the old manually entered gains? The old figures remain in the backup for reference. Check that every sale has been recorded first.')) return;
            this.tax.legacyManualGains = { ltcg: Number(this.tax.realizedEquityLTCG) || 0, stcg: Number(this.tax.realizedEquitySTCG) || 0, reconciledAt: new Date().toISOString() };
            this.tax.realizedEquityLTCG = 0;
            this.tax.realizedEquitySTCG = 0;
            this.tax.gainsSource = 'sales';
            this.saveData();
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
            const totalGains = Math.max(0, this.tax.gainsSource === 'sales' ? Number(this.saleTaxSummary.amounts['112A']) || 0 : Number(this.tax.realizedEquityLTCG) || 0);
            const exemptionLimit = 125000;
            const exemptionUsed = Math.min(totalGains, exemptionLimit);
            const taxableGains = Math.max(0, totalGains - exemptionLimit);
            const tax = Math.round(taxableGains * 0.125 * 1.04); // 12.5% + 4% cess
            return { totalGains, exemptionUsed, taxableGains, tax };
        },

        get equitySTCG() {
            const totalGains = Math.max(0, this.tax.gainsSource === 'sales' ? Number(this.saleTaxSummary.amounts['111A']) || 0 : Number(this.tax.realizedEquitySTCG) || 0);
            const tax = Math.round(totalGains * 0.20 * 1.04); // 20% + 4% cess
            return { totalGains, tax };
        },

        get totalCapitalGainsTax() {
            if (this.tax.capitalGainsOverride !== null && this.tax.capitalGainsOverride !== undefined && this.tax.capitalGainsOverride !== '') {
                return Number(this.tax.capitalGainsOverride);
            }
            if (this.tax.gainsSource === 'sales') return this.saleTaxSummary.specialTax;
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
        // New Regime (FY 2025-26 onward, Budget 2025): Standard deduction ₹75K. No other deductions.
        // Slabs: 0-4L: 0%, 4-8L: 5%, 8-12L: 10%, 12-16L: 15%, 16-20L: 20%, 20-24L: 25%, >24L: 30%
        // Rebate u/s 87A: taxable income ≤ ₹12L pays no slab tax, with marginal relief just above.
        // Was still on the FY 2024-25 table (₹7L rebate, 3/7/10/12/15L slabs), which billed
        // someone at ₹10L taxable ~₹52,000 they do not owe.
        get newRegimeTax() {
            const gross = this.grossAnnualIncome;
            const stdDeduction = Math.min(75000, this.salaryAndPensionIncome); // Sec 16(ia), new regime
            const taxableIncome = Math.max(0, gross - stdDeduction);

            const SLABS = [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15],
                           [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]];
            let tax = 0, floor = 0;
            for (const [ceil, rate] of SLABS) {
                if (taxableIncome <= floor) break;
                tax += (Math.min(taxableIncome, ceil) - floor) * rate;
                floor = ceil;
            }

            const REBATE_LIMIT = 1200000;
            if (taxableIncome <= REBATE_LIMIT) tax = 0;
            else if (tax > taxableIncome - REBATE_LIMIT) tax = taxableIncome - REBATE_LIMIT;

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

        // Dark only for now, so the status bar always carries light icons on the dark ground.
        syncNativeChrome() {
            try {
                const P = window.AppPlugins;
                if (!P || !P.Capacitor || !P.Capacitor.isNativePlatform()) return;
                P.StatusBar.setStyle({ style: P.Style.Dark });
            } catch (e) {}
        },

        /* ── CORPUS shell ────────────────────────────────────────────────
           Four destinations replace the previous fifteen pages. Every old page
           id still resolves — it simply belongs to a surface now, so existing
           `activePage = 'x'` writes keep working and deep links stay valid. */
        SURFACES: [
            { id: 'home',      label: 'Overview',  icon: 'grid_view',  root: 'home',        views: ['home', 'settings', 'notifications'] },
            { id: 'portfolio', label: 'Holdings',  icon: 'folder',     root: 'investments', views: ['investments','holding','maturity','import'] },
            { id: 'planning',  label: 'Planning',  icon: 'pie_chart',  root: 'cashflow',    views: ['cashflow','income','pension','emergency','goals','networth','tax'] },
            { id: 'insights',  label: 'Insights',  icon: 'insights',   root: 'regen',       views: ['regen'] },
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
                goals: 'Goals', networth: 'Assets and debts', tax: 'Tax',
                regen: 'Insights', settings: 'Settings', notifications: 'Notifications',
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
            return { stale: false, label: close ? `Synced ${t}, ${close} at last close` : `Synced ${t}` };
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
                const known = items.filter(i => this.hasKnownCost(i));
                const cost = known.reduce((a, i) => a + this.getInvInvestedCost(i), 0);
                const knownValue = known.reduce((a, i) => a + this.getInvCurrentValue(i), 0);
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
                    pnlPct: cost > 0 ? ((knownValue - cost) / cost) * 100 : null,
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
            // Gold is Holdings' call (_chipOf), so a gold ETF sits under Gold on
            // every screen and in the AI reading, not Gold here and Stocks there.
            if (this._chipOf(inv) === 'gold') return 'gold';
            if (this._chipOf(inv) === 'metals') return 'metals';
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
            if (t === 'Mutual Fund') return 'Mutual funds';
            if (t === 'Bank FD')     return 'Fixed deposits';
            if (t === 'Bond')        return 'Bonds';
            if (t === 'Gold')        return 'Gold';
            if (t === 'Real Estate') return 'Property';
            return ((inv && inv.name) || '').trim() || t;
        },

        HOLDING_CLASSES: [
            { key: 'equity',   label: 'Stocks and ETFs',             short: 'Stocks' },
            { key: 'mf',       label: 'Mutual funds',                short: 'Mutual funds' },
            { key: 'debt',     label: 'Deposits, bonds and schemes', short: 'Deposits' },
            { key: 'us',       label: 'US equities',                 short: 'Stocks (US)' },
            { key: 'gold',     label: 'Gold',                        short: 'Gold' },
            { key: 'metals',   label: 'Other metals',                short: 'Metals' },
            { key: 'property', label: 'Property',                    short: 'Property' },
        ],

        // The debit day as it falls in a given month. A SIP set for the 31st debits on
        // the 30th in September and the 28th or 29th in February; treating every month as
        // 31 days long meant it was never "due" in those months at all.
        _sipDayIn(sip, year, month) {
            const want = Number(sip.dayOfMonth) || 5;
            return Math.min(want, new Date(year, month + 1, 0).getDate());
        },

        // Whole days from today to the next debit, honouring each month's real length.
        _sipDaysToNext(sip) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            let y = now.getFullYear(), m = now.getMonth();
            let next = new Date(y, m, this._sipDayIn(sip, y, m));
            if (next < today) { m += 1; if (m > 11) { m = 0; y += 1; } next = new Date(y, m, this._sipDayIn(sip, y, m)); }
            return Math.round((next - today) / 86400000);
        },

        sipDaysUntil(sip) {
            if (!Number(sip.dayOfMonth)) return null;
            return this._sipDaysToNext(sip);
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
            return t.includes('Stock') || t.includes('ETF') || t === 'Mutual Fund' || t === 'Gold' || t === 'Physical Metal';
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
            this.detailRange = this._chipOf(inv) === 'equity' ? '6M' : '1Y';
            this.activePage = 'holding';
            if (ranges) this.loadDetailData(inv);
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
            const kind = { equity: 'st', mf: 'mf', debt: 'fd', deposits: 'fd', schemes: 'sc', gold: 'go', bonds: 'bd' }[ctx] || 'st';
            this.newInv = {
                name: '', type: 'Stock', issuer: '', amount: '', rate: '', payout: 'Monthly', rating: '',
                maturityDate: '', startDate: '', ticker: '', units: '', buyPrice: '', currentPrice: '',
                schemeCode: '', annualDeposit: '', monthlyDeposit: '', epfKind: 'PPF', schemeId: '', currency: 'INR', purchaseDate: '',
                metal: 'gold', metalUnit: 'g', purity: 100, metalValuationMode: 'benchmark', manualPrice: ''
            };
            this.addKind = '';
            this.setAddKind(kind, true);

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
            ['bajaj finserv',         'BAJAJFINSV'],
            ['franklin',              'BEN', 'us'],
            ['invesco',               'IVZ', 'us'],
            ['sundaram',              'SUNDARMFIN'],
            ['bandhan',               'BANDHANBNK'],
            ['union',                 'UNIONBANK'],
            ['hsbc',                  'HSBC', 'us'],
            ['lic ',                  'LICI'],
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
            for (const [prefix, ticker, host] of this.AMC_TICKERS) {
                if (n.startsWith(prefix)) return { ticker, host: host || 'nse' };
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
                if (!amc) return null;
                return this.logoHost(amc.host) + amc.ticker + (amc.host === 'us' ? '.png' : '.svg');
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

        get hasAnalyzablePosition() {
            return (this.investments || []).some(inv => this.getInvCurrentValue(inv) > 0)
                || ['bank', 'cash', 'property', 'otherAsset'].some(key => Number(this.networth?.[key]) > 0)
                || Number(this.emergency?.efCurrent) > 0;
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
                return `${d.getDate()} ${this.MONTHS[d.getMonth()]} ${d.getFullYear()}`;
            } catch (e) {
                return dateStr;
            }
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
            if (this.addKind === 'epf') {
                this.newInv.name = this.newInv.epfKind === 'EPF' ? 'Employees\u2019 Provident Fund (EPF)' : 'Public Provident Fund (PPF)';
                this.newInv.payout = 'Cumulative / On Maturity';
            }
            if (!this.newInv.name) return;
            if (this.newInv.type === 'Physical Metal' && (!(Number(this.newInv.units) > 0)
                || !(Number(this.newInv.buyPrice) > 0) || !(Number(this.newInv.purity) > 0)
                || Number(this.newInv.purity) > 100 || !['g', 'kg'].includes(this.newInv.metalUnit)
                || (this.newInv.metalValuationMode === 'manual' && !(Number(this.newInv.manualPrice) > 0)))) return;
            const isEquity = ['Stock', 'Stock (IND)', 'Stock (US)', 'Equity', 'Mutual Fund', 'ETF', 'ETF (IND)', 'ETF (US)', 'Physical Metal'].includes(this.newInv.type);
            const isUS     = ['Stock (US)', 'ETF (US)'].includes(this.newInv.type);
            const units    = Number(this.newInv.units) || 0;
            const buyPrice = Number(this.newInv.buyPrice) || 0;
            const currentPrice = this.newInv.type === 'Physical Metal' && this.newInv.metalValuationMode === 'manual'
                ? Number(this.newInv.manualPrice) || buyPrice || 0
                : Number(this.newInv.currentPrice) || buyPrice || 0;
            
            let amount = Number(this.newInv.amount) || 0;
            if (isEquity && units > 0 && (currentPrice > 0 || buyPrice > 0)) {
                const usdRate = isUS ? this.fxUsdInr : 1;
                amount = units * (currentPrice || buyPrice) * usdRate;
            }

            const { epfKind, schemeId, ...form } = this.newInv;
            const createdInv = {
                ...form,
                id:           this.newId('inv'),
                amount:       amount,
                units:        units,
                buyPrice:     buyPrice,
                currentPrice: currentPrice || buyPrice,
                currentValue: amount,
                rate:         this.isRateBearing(this.newInv.type) ? (Number(this.newInv.rate) || 0) : 0
            };
            if (createdInv.type === 'Physical Metal') {
                createdInv.metalPriceSource = this.newInv.metalValuationMode === 'manual' ? 'user-entered valuation' : 'purchase cost pending benchmark';
                createdInv.metalQuoteAt = this.newInv.metalValuationMode === 'manual' ? this.localDateKey() : null;
            }

            // Only an explicit real acquisition date creates an eligible lot.
            // Imported rows without a date keep unknown history.
            if (/^\d{4}-\d{2}-\d{2}$/.test(form.purchaseDate || '') && units > 0 && buyPrice > 0 && !isUS) {
                createdInv.taxLots = [{ id: this.newId('buy'), date: form.purchaseDate, quantity: units,
                    quantityRemaining: units, cost: Math.round(units * buyPrice * 100) / 100 }];
            }

            this.investments.push(createdInv);

            if (createdInv.type === 'Physical Metal' && createdInv.metalValuationMode === 'benchmark' && ['gold', 'silver'].includes(createdInv.metal)) {
                this.fetchSinglePrice(createdInv).catch(() => {});
            }

            if (this.addKind === 'rd' && Number(this.newInv.monthlyDeposit) > 0) {
                const schedule = (this.sips || []).find(s => s.type === 'RD' && !s.linkedInvestmentId
                    && s.name.trim().toLowerCase() === createdInv.name.trim().toLowerCase()) || {
                        id: this.newId('sip'), name: createdInv.name, type: 'RD',
                        monthlyAmount: Number(this.newInv.monthlyDeposit), dayOfMonth: new Date().getDate(),
                        status: 'Active', lastExecutedMonth: this.currentMonthKey, confirmedInstalments: []
                    };
                schedule.linkedInvestmentId = createdInv.id;
                createdInv.linkedSipId = schedule.id;
                if (!(this.sips || []).includes(schedule)) this.sips.push(schedule);
            }

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
                this._relinkSips();
                this.saveData();
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
                // Blank means "use the market price", as the field's hint says: the
                // last synced price, not the average paid.
                const prev = this.investments[idx];
                const currentPrice = Number(this.editForm.currentPrice) || Number(prev.currentPrice) || Number(prev.nav) || buyPrice || 0;

                this.editForm.units        = units;
                this.editForm.buyPrice     = buyPrice;
                this.editForm.currentPrice = currentPrice;
                if (isEquity && units > 0 && currentPrice > 0) {
                    this.editForm.currentValue = units * currentPrice * (isUS ? this.fxUsdInr : 1);
                } else if (this.editForm.type === 'Recurring Deposit') {
                    this.editForm.currentValue = Number(this.editForm.currentValue) || Number(this.editForm.amount) || 0;
                    this.editForm.balanceVerifiedAt = this.localDateKey();
                } else if (!(units > 0)) {
                    this.editForm.currentValue = Number(this.editForm.amount) || 0;
                }
                this.editForm.rate         = this.isRateBearing(this.editForm.type) ? (Number(this.editForm.rate) || 0) : 0;
                if (this.editForm.type === 'Physical Metal') {
                    this.editForm.currentValue = Math.round(units * currentPrice * 100) / 100;
                    if (this.editForm.metalValuationMode === 'manual') {
                        this.editForm.metalPriceSource = 'user-entered valuation';
                        this.editForm.metalQuoteAt = this.localDateKey();
                    }
                }

                this.investments[idx] = { ...this.editForm };
                this.investments = [...this.investments];

                if (this.editForm.ticker || this.editForm.schemeCode
                    || (this.editForm.type === 'Physical Metal' && this.editForm.metalValuationMode === 'benchmark')) {
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
            this.lotForm = { amount: '', timing: inv.type === 'Physical Metal' ? 'manual' : 'market',
                units: '', date: this.localDateKey() };
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

            if (inv.type === 'Physical Metal') {
                const units = Number(this.lotForm.units);
                if (!(units > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(this.lotForm.date || '') || this.lotForm.date > this.localDateKey()) return null;
                const price = amount / units;
                const newQty = qty + units;
                return { pending: false, amount, price, units, qty, avg, newQty,
                    newAvg: ((qty * avg) + amount) / newQty, priceAsOf: this.lotForm.date };
            }

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
        _applyLot(inv, amount, price, lotId, purchaseDate = null) {
            if (!inv || !(amount > 0) || !(price > 0)) return false;
            inv.settledLots = Array.isArray(inv.settledLots) ? inv.settledLots : [];
            if (lotId && inv.settledLots.includes(lotId)) return false;

            const qty = Number(inv.units) || 0;
            const avg = Number(inv.buyPrice) || 0;
            const units = amount / price;
            const newQty = qty + units;

            inv.units = newQty;
            // Units already held at an unknown average keep the average unknown:
            // averaging them in at 0 would call the whole holding's value profit.
            if (qty === 0 || avg > 0) inv.buyPrice = newQty > 0 ? ((qty * avg) + amount) / newQty : price;
            const live = Number(inv.currentPrice) || price;
            inv.currentValue = Math.round(newQty * live * (this.lotCurrency(inv) === 'USD' ? this.fxUsdInr : 1) * 100) / 100;
            if (lotId) inv.settledLots.push(lotId);
            if (purchaseDate && /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) && this.lotCurrency(inv) === 'INR') {
                inv.taxLots = [...(inv.taxLots || []), { id: lotId || this.newId('buy'), date: purchaseDate,
                    quantity: units, quantityRemaining: units, cost: amount }];
            }
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
            } else if (!this._applyLot(row, p.amount, p.price, null,
                row.type === 'Physical Metal' ? this.lotForm.date : this.localDateKey())) {
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

                if (this._applyLot(inv, lot.amount, opens[i], lot.id, this.localDateKey(new Date(times[i] * 1000)))) settled++;
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
            if (stuck) return `${stuck} purchase${stuck > 1 ? 's' : ''} could not be priced. Add ${stuck > 1 ? 'them' : 'it'} by hand`;
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
            if (file && (/\.(pdf|csv)$/i.test(file.name) || ['application/pdf', 'text/csv'].includes(file.type))) {
                this.importFile = file;
                this.importError = '';
                this.importPwError = false;
                this.importResults = null;
                this.bankImport = null;
                this.importStats = null;
                this.importState = 'idle';
                this.readImportMeta(file);
            } else if (file) {
                this.importError = 'Choose a PDF portfolio statement or a bank CSV export.';
            }
            if (event.target) event.target.value = '';
        },

        // What the file is, before any password is asked for (M13): its size, and
        // whether it is encrypted. An encrypted PDF declares /Encrypt in its
        // trailer, which sits in the last few kilobytes of the file.
        importMeta: null,
        importPwError: false,
        importShowPw: false,

        async readImportMeta(file) {
            const kb = Math.max(1, Math.round(file.size / 1024));
            const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
            if (/\.csv$/i.test(file.name)) { this.importMeta = { size, encrypted: false }; return; }
            this.importMeta = { size, encrypted: null };
            try {
                const tail = await file.slice(Math.max(0, file.size - 65536)).text();
                const head = /\/Encrypt\b/.test(tail) ? true : /\/Encrypt\b/.test(await file.slice(0, 65536).text());
                if (this.importFile === file) this.importMeta = { size, encrypted: head };
            } catch (e) {}
        },

        get importMode() {
            if (this.bankImport?.entries?.length) return 'ibank';
            if (this.statementDiff?.active && (this.statementDiff.matched || []).length) return 'imrv';
            if (this.importResults?.investments?.length) return 'ihf';
            return this.importPwError ? 'iw' : 'im';
        },

        get importGroups() {
            const list = this.importResults?.investments || [];
            const label = t => /mutual/i.test(t || '') ? 'Mutual funds' : /stock|equity|etf/i.test(t || '') ? 'Stocks'
                             : /bond/i.test(t || '') ? 'Bonds' : /gold/i.test(t || '') ? 'Gold' : 'Other holdings';
            const groups = [];
            list.forEach((r, i) => {
                const g = label(r.type);
                let hit = groups.find(x => x.label === g);
                if (!hit) { hit = { label: g, rows: [] }; groups.push(hit); }
                hit.rows.push({ r, i });
            });
            return groups;
        },

        get importAllOn() {
            const n = (this.importResults?.investments || []).length;
            return n > 0 && this.countSelectedImports() === n;
        },

        importRowLine(r) {
            const u = Number(r.units) || 0;
            if (!u) return r.type || '';
            const shares = /stock|equity/i.test(r.type || '') && !/etf/i.test(r.type || '');
            return shares ? `${u.toLocaleString('en-IN')} share${u === 1 ? '' : 's'}`
                          : `${u.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} units`;
        },

        importRowValue(r) {
            return this.formatCurrency(Number(r.currentValue) || (Number(r.units) * (Number(r.nav) || Number(r.currentPrice) || 0)) || Number(r.amount) || 0);
        },

        get importSource() {
            const d = this.statementDiff || {};
            const broker = d.broker || (this.importResults?.type || '').replace('_', ' ') || 'your';
            const when = d.asOfDate ? `, as of ${this.formatDate(d.asOfDate)}` : '';
            return { broker, when };
        },

        handleImportDrop(event) {
            const file = event.dataTransfer.files[0];
            if (file && /\.(pdf|csv)$/i.test(file.name)) {
                this.importFile = file;
                this.importError = '';
                this.importPwError = false;
                this.importResults = null;
                this.bankImport = null;
                this.importStats = null;
                this.importState = 'idle';
                this.readImportMeta(file);
            } else {
                this.importError = 'Please drop a PDF or CSV file.';
            }
        },

        async parseStatement() {
            if (!this.importFile) return;

            this.importState = 'loading';
            this.importError = '';
            this.importPwError = false;
            this.importResults = null;
            this.bankImport = null;
            this.importStats = null;
            this.statementDiff.active = false;

            try {
                if (/\.csv$/i.test(this.importFile.name)) {
                    if (this.importFile.size > 2_000_000) throw new Error('This CSV is too large. Export a shorter date range.');
                    const result = window.CorpusBank.parseCsv(await this.importFile.text(), this.bankImportAccount);
                    this.bankImport = result;
                    this.bankImportSelections = {};
                    result.entries.forEach((_, i) => { this.bankImportSelections[i] = true; });
                    this.importState = 'bank_review';
                    return;
                }
                const text = await this.extractPdfText(this.importFile, this.importPassword);

                if (!text || text.trim().length < 50) {
                    this.importError = 'Could not extract text from this PDF. It may be image-based or corrupted. Please use the original PDF from your email.';
                    this.importState = 'error';
                    return;
                }

                // Phase 5 regex-based parser
                const result = window.RFMParser.parseStatement(text);

                if (result.type === 'BANK_STATEMENT') {
                    this.importError = 'Bank PDF transaction layouts vary. Export a CSV transaction statement from your bank and import that instead; no balance was added as a deposit.';
                    this.importState = 'error';
                    return;
                }

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
                    this.importPwError = true;
                    this.importError = 'That password did not open the file. It is usually your PAN in capitals, for example ABCDE1234F.';
                } else {
                    this.importError = 'Could not read this statement: ' + (err.message || 'Unknown error');
                }
                this.importState = 'error';
            }
        },

        get bankMonthRows() {
            const month = this.localDateKey(new Date()).slice(0, 7);
            return (this.bankTransactions || []).filter(t => t.date?.startsWith(month));
        },
        get bankMonthSpend() {
            return this.bankMonthRows.filter(t => t.direction === 'debit' && t.category === 'spend')
                .reduce((total, t) => total + t.amount, 0);
        },
        get bankMonthReviewCount() {
            return this.bankMonthRows.filter(t => t.direction === 'debit' && t.category === 'review').length;
        },
        get bankActivityDays() {
            const groups = [];
            for (const transaction of this.bankMonthRows) {
                let group = groups.find(g => g.date === transaction.date);
                if (!group) { group = { date: transaction.date, rows: [], spent: 0 }; groups.push(group); }
                group.rows.push(transaction);
                if (transaction.direction === 'debit' && transaction.category === 'spend') group.spent += transaction.amount;
            }
            return groups.sort((a, b) => b.date.localeCompare(a.date));
        },
        setBankCategory(id, category) {
            if (!['spend', 'transfer', 'review'].includes(category)) return;
            const row = this.bankTransactions.find(t => t.id === id);
            if (!row || row.direction !== 'debit') return;
            row.category = category;
            this.bankTransactions = [...this.bankTransactions];
            this.saveData();
        },
        saveBankImport() {
            const chosen = (this.bankImport?.entries || []).filter((_, i) => this.bankImportSelections[i] !== false);
            if (!chosen.length) return;
            const result = window.CorpusBank.merge(this.bankTransactions, chosen);
            if (result.entries.length > 3000) {
                this.importError = 'Corpus can sync up to 3,000 imported bank transactions for now. Export a shorter period; nothing was saved.';
                return;
            }
            this.bankTransactions = result.entries;
            this.bankImport = null;
            this.importFile = null;
            this.importState = 'done';
            this.saveData();
            this.showSnack(`${result.added} transactions added · ${result.duplicates} already recorded`);
            this.activePage = 'income';
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
            return this._findStatementMatch(newItem);
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

            const matched = [];
            const newItems = [];
            const matchedExistingIds = new Set();

            const incomingHoldings = statementResult.investments || [];

            incomingHoldings.forEach(inc => {
                const match = this._findStatementMatch(inc, matchedExistingIds, appCategoryHoldings);

                if (match) {
                    matchedExistingIds.add(match.id);
                    const oldUnits = Number(match.units) || 0;
                    const newUnits = Number(inc.units) || 0;
                    const oldCost = Number(match.amount) || 0;
                    // Only a statement that states what was paid changes the cost.
                    const newCost = Number(inc.amount) > 0 ? Number(inc.amount) : oldCost;
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
                        amount: Number(inc.amount) || 0,
                        currentValue: Number(inc.currentValue) || (Number(inc.units) * Number(inc.nav)) || 0,
                        nav: Number(inc.nav) || Number(inc.currentPrice) || 0,
                        incomingHolding: inc
                    });
                }
            });

            // Omitted holdings in app for this category
            const omitted = appCategoryHoldings
                .filter(ex => !matchedExistingIds.has(ex.id) && !this._isUsdHolding(ex))
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
                    const stated = Number(inc.amount) > 0 ? Number(inc.amount) : 0;
                    this.investments[idx] = {
                        ...this.investments[idx],
                        units:        m.newUnits,
                        amount:       stated || this.investments[idx].amount,
                        buyPrice:     stated && m.newUnits ? stated / m.newUnits : this.investments[idx].buyPrice,
                        isin:         inc.isin || this.investments[idx].isin,
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
                this.investments.push({ ...this.migrateHolding(n.incomingHolding), id: this.newId('inv') });
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
                    // An Indian demat statement never lists US shares; replacing the
                    // "stock" category must not delete them.
                    if (this._isUsdHolding(inv)) return true;
                    return !(['Stock', 'Stock (IND)', 'ETF', 'ETF (IND)'].includes(inv.type) ||
                             (inv.type || '').toLowerCase().includes('stock'));
                }
            });

            // Add all incoming holdings
            (this.importResults?.investments || []).forEach(inc => {
                this.investments.push({ ...this.migrateHolding(inc), id: this.newId('inv') });
            });
            this._relinkSips();

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
            this.importMeta = null;
            this.importPwError = false;
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
            const usedIds = new Set();

            this.importResults.investments.forEach((inv, idx) => {
                // Skip unselected
                if (this.importSelections[idx] === false) {
                    skipped++;
                    return;
                }

                const existing = this._findStatementMatch(inv, usedIds);
                if (existing) usedIds.add(existing.id);

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
                            amount:       Number(inv.amount) > 0 ? inv.amount : this.investments[existIdx].amount,
                            units:        inv.units,
                            buyPrice:     inv.buyPrice || this.investments[existIdx].buyPrice,
                            nav:          inv.nav || this.investments[existIdx].nav,
                            currentPrice: inv.nav || this.investments[existIdx].currentPrice,
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
                    this.investments.push({ ...this.migrateHolding(inv), id: this.newId('inv') });
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
            if (!pool.length) {
                return { code: null, message: `No AMFI scheme matches "${name}" with that plan and option. Rename the holding to match its scheme exactly.` };
            }

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

            if (inv.type === 'Physical Metal') {
                if (inv.metalValuationMode === 'manual' || !['gold', 'silver'].includes(inv.metal)) return null;
                if (this.fxIsStale) await this.fetchUsdInrRate();
                if (this.fxIsStale) throw new Error('A verified USD/INR rate is required for the metal benchmark');
                const symbol = inv.metal === 'gold' ? 'XAU' : 'XAG';
                const quote = await this.httpGetJson(`https://api.gold-api.com/price/${symbol}`, 7000);
                const usdPerOunce = Number(quote.price);
                const at = Date.parse(quote.updatedAt || '');
                if (!(usdPerOunce > 0) || !Number.isFinite(at) || at > Date.now() + 300000 || Date.now() - at > 7 * 86400000)
                    throw new Error('Metal benchmark is unavailable or stale');
                const gramsPerUnit = inv.metalUnit === 'kg' ? 1000 : 1;
                const purity = Number(inv.purity);
                if (!(purity > 0 && purity <= 100)) throw new Error('Metal purity needs checking');
                // Gold API quotes USD per troy ounce. This is only an indicative
                // spot benchmark; local retail spread and workmanship are omitted.
                const inrPerUnit = usdPerOunce / 31.1034768 * this.fxUsdInr * gramsPerUnit * purity / 100;
                inv.currentPrice = Math.round(inrPerUnit * 100) / 100;
                inv.currentValue = Math.round(Number(inv.units || 0) * inrPerUnit * 100) / 100;
                inv.metalQuoteAt = quote.updatedAt;
                inv.metalPriceSource = 'Gold API spot · USD/INR conversion';
                inv.metalFxAt = this.usdInrAsOf || null;
                this.investments = [...this.investments];
                this.queueNwSnapshot('metal-quote');
                return inv.currentPrice;
            }

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
                    return { state: 'close', label: `NAV of ${this.formatDate(quoteAt)}, end of day` };
                }
                return { state: 'close', label: `Last close, ${this.formatDate(quoteAt)}` };
            }
            // Six hours, not twenty-four: an Indian close at 15:30 is still the
            // last close at 21:00 the same evening, and a quote minutes old
            // during the session is genuinely live.
            if (Date.now() - new Date(quoteAt).getTime() > 6 * 60 * 60 * 1000) {
                return { state: 'close', label: `Last close, ${this.formatDate(quoteAt)}` };
            }
            return { state: 'live', label: `${inv.priceSource || 'live'}` };
        },

        // Refresh eligible holdings concurrently with a small worker pool to protect public data APIs.
        async fetchAllPrices() {
            if (this.navFetchState === 'fetching') return;

            const holdings = (this.investments || []).filter(inv => inv.schemeCode || inv.ticker || inv.type === 'Mutual Fund'
                || (inv.type === 'Physical Metal' && inv.metalValuationMode === 'benchmark' && ['gold', 'silver'].includes(inv.metal)));
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
            if (localStorage.getItem('corpus_alerts_enabled') === 'false') {
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

                // 3. Maturity reminders: 30 days before, 7 days before, and on the day, at 9 am.
                const at9 = (d, offset) => { const t = new Date(d); t.setDate(t.getDate() - offset); t.setHours(9, 0, 0, 0); return t; };
                (this.investments || []).forEach((inv, i) => {
                    if (!inv.maturityDate) return;
                    const mat = new Date(inv.maturityDate);
                    const value = this.formatCurrency(this.getInvCurrentValue(inv) || inv.amount);
                    [[30, 12000, 'Matures in 30 days'], [7, 10000, 'Matures in 7 days'], [0, 11000, 'Matures today']].forEach(([days, base, title]) => {
                        const when = at9(mat, days);
                        if (when <= now) return;
                        alerts.push({
                            id: base + i,
                            title: `${inv.name}: ${title.toLowerCase()}`,
                            body: days
                                ? `${value} pays out on ${this.formatDate(inv.maturityDate)}. Decide where it goes, or it may renew at the rate on that day.`
                                : `${value} pays out today. Tell ${inv.issuer || 'the bank'} where it should go.`,
                            schedule: { at: when }, sound: 'default', smallIcon: 'ic_stat_notification', channelId: 'rfm_maturity',
                        });
                    });
                });

                // 3b. PPF: a yearly nudge before 31 March, when a PPF account exists (M7).
                if ((this.investments || []).some(inv => /\bppf\b|public provident/i.test(inv.name || ''))) {
                    const y = now.getMonth() > 2 || (now.getMonth() === 2 && now.getDate() > 20) ? now.getFullYear() + 1 : now.getFullYear();
                    alerts.push({
                        id: 13000, title: 'PPF deposit due before 31 Mar',
                        body: 'Deposit at least ₹500 this financial year to keep the account active.',
                        schedule: { at: new Date(y, 2, 20, 9, 0, 0, 0) }, sound: 'default', smallIcon: 'ic_stat_notification', channelId: 'rfm_maturity',
                    });
                }

                // 4. SIP Reminders — upcoming 1 debit reminder per active SIP
                (this.activeSips || []).forEach((sip, i) => {
                    const debitDay = Number(sip.dayOfMonth) || 5;
                    const dayIn = (y, m) => this._sipDayIn(sip, y, m);
                    let reminderAt = new Date(now.getFullYear(), now.getMonth(), dayIn(now.getFullYear(), now.getMonth()) - 1, 9, 0, 0, 0);
                    if (reminderAt <= now) {
                        const ny = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
                        const nm = (now.getMonth() + 1) % 12;
                        reminderAt = new Date(ny, nm, dayIn(ny, nm) - 1, 9, 0, 0, 0);
                    }
                    alerts.push({
                        id:    20000 + (i * 100),
                        title: `${sip.name} debits tomorrow`,
                        body:  `${this.formatCurrency(sip.monthlyAmount)} on the ${this.ordinal(debitDay)}. Keep the balance in your account.`,
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
            // A person who answered the first, one-answer version is asked once
            // more, on the new per-asset screens only, already filled in.
            if (this.profile.completedAt) {
                if (this.profile.version === 2) return false;
                const later = Date.parse(this.profile.catchUpSkippedAt || '');
                return !Number.isFinite(later) || Date.now() - later >= this.PROFILE_RETRY_MS;
            }
            const skipped = Date.parse(this.profile.skippedAt || '');
            return !Number.isFinite(skipped) || Date.now() - skipped >= this.PROFILE_RETRY_MS;
        },

        /* ── The questions ──────────────────────────────────────────────
           A book is not one person with one appetite. US shares can be money
           you would buy more of in a crash and trim within five years, while a
           fund is for retirement and a deposit is the emergency buffer. So
           everything about how money is treated is asked PER ASSET CLASS, and
           every answer, per class and overall, can be several at once. */
        PROFILE_CLASSES: [
            { k: 'in_stocks', t: 'Indian stocks', icon: 'candlestick_chart', market: true },
            { k: 'us_stocks', t: 'US stocks',     icon: 'public',            market: true },
            { k: 'mf',        t: 'Mutual funds',  icon: 'pie_chart',         market: true },
            { k: 'gold',      t: 'Gold',          icon: 'toll',              market: true },
            { k: 'metals',    t: 'Other metals',  icon: 'toll',              market: true },
            { k: 'fd_bonds',  t: 'FDs and bonds', icon: 'savings' },
            { k: 'schemes',   t: 'Government schemes', d: 'PPF, EPF, SCSS, post office', icon: 'account_balance' },
            { k: 'property',  t: 'Property',      icon: 'home' },
        ],

        PROFILE_ASK: {
            purpose: { title: 'What is each one for?', lead: 'Tick everything that applies. One asset can serve more than one goal.', market: false,
                opts: [{ v: 'grow', t: 'Grow wealth' }, { v: 'retirement', t: 'Retirement' }, { v: 'income', t: 'Regular income' },
                       { v: 'safe', t: 'Keep it safe' }, { v: 'emergency', t: 'Emergency money' }, { v: 'purchase', t: 'A big purchase' },
                       { v: 'children', t: 'Children’s future' }] },
            fall: { title: 'If it fell 20% in a month, what would you do?', lead: 'Per asset. Waiting and buying more can both be true.', market: true,
                opts: [{ v: 'sell', t: 'Sell some' }, { v: 'wait', t: 'Wait it out' }, { v: 'buy', t: 'Buy more' }] },
            horizon: { title: 'When might you need it?', lead: 'Per asset. Tick every timing that applies, like trimming along the way and a date for the rest.', market: false,
                opts: [{ v: 'trim', t: 'Trim along the way' }, { v: 'lt3', t: 'Within 3 yrs' }, { v: '3to7', t: '3 to 7 yrs' },
                       { v: '7to15', t: '7 to 15 yrs' }, { v: 'gt15', t: '15+ yrs' }] },
            payout: { title: 'Should any of it pay you?', lead: 'Per asset. Tick more than one if part of it pays out and part grows.', market: false,
                opts: [{ v: 'monthly', t: 'Monthly' }, { v: 'quarterly', t: 'Quarterly' }, { v: 'yearly', t: 'Yearly' }, { v: 'none', t: 'No, let it grow' }] },
            knows: { title: 'How well do you know each?', lead: 'Corpus explains more where you are newer.', market: false,
                opts: [{ v: 'new', t: 'New to it' }, { v: 'some', t: 'A few years' }, { v: 'long', t: 'Many years' }, { v: 'simple', t: 'Explain it simply' }] },
        },

        PROFILE_LISTS: {
            income: [
                { v: 'salary', t: 'Salary', icon: 'work' }, { v: 'business', t: 'Business or freelance', icon: 'storefront' },
                { v: 'rent', t: 'Rent', icon: 'real_estate_agent' }, { v: 'pension', t: 'Pension', icon: 'elderly' },
                { v: 'dividends', t: 'Interest and dividends', icon: 'payments' }, { v: 'none', t: 'Not earning yet', icon: 'school', only: true },
            ],
            dependents: [
                { v: 'partner', t: 'Partner', icon: 'favorite' }, { v: 'children', t: 'Children', icon: 'child_care' },
                { v: 'parents', t: 'Parents', icon: 'elderly_woman' }, { v: 'none', t: 'No one', icon: 'person', only: true },
            ],
            cover: [
                { v: 'emergency', t: 'Emergency fund', icon: 'savings' }, { v: 'health', t: 'Health insurance', icon: 'health_and_safety' },
                { v: 'term', t: 'Term life cover', icon: 'shield' }, { v: 'none', t: 'None yet', icon: 'block', only: true },
            ],
            plans: [
                { v: 'home', t: 'Home', icon: 'house' }, { v: 'education', t: 'Education', icon: 'school' },
                { v: 'wedding', t: 'Wedding', icon: 'celebration' }, { v: 'car', t: 'Car', icon: 'directions_car' },
                { v: 'travel', t: 'Travel', icon: 'flight' }, { v: 'nothing', t: 'Nothing planned', icon: 'check_circle', only: true },
            ],
        },
        PLAN_WHEN: [{ v: '1', t: 'In a year' }, { v: '2to3', t: '2 to 3 yrs' }, { v: '4to5', t: '4 to 5 yrs' }, { v: '5plus', t: '5+ yrs' }],

        // The profile class a holding belongs to, so answers meet the book.
        _profileClassOf(inv) {
            if (this._isUsdHolding(inv)) return 'us_stocks';
            const c = this._chipOf(inv);
            return c === 'equity' ? 'in_stocks' : c === 'mf' ? 'mf' : c === 'gold' ? 'gold' : c === 'metals' ? 'metals'
                 : c === 'schemes' ? 'schemes' : c === 'other' ? 'property' : 'fd_bonds';
        },

        // v1 held one goal, one risk, one horizon and a list of interests; carry
        // each onto every class as the starting answer rather than lose it.
        migrateProfile(p) {
            if (!p || p.version === 2 || !p.completedAt) return p;
            const held = new Set((this.investments || []).map(i => this._profileClassOf(i)));
            const fromInterest = { stocks: 'in_stocks', us: 'us_stocks', mf: 'mf', gold: 'gold', schemes: 'schemes', fdbonds: 'fd_bonds' };
            (p.interests || []).forEach(i => fromInterest[i] && held.add(fromInterest[i]));
            const holdings = this.PROFILE_CLASSES.map(c => c.k).filter(k => held.has(k));
            const goalTo = { grow: ['grow'], balanced: ['grow', 'safe'], safe: ['safe'], income: ['income'],
                             retirement: ['retirement'], retired: ['income', 'safe'] }[p.goal] || [];
            const fallTo = { low: ['sell'], medium: ['wait'], high: ['buy'] }[p.risk] || [];
            const each = (list, onlyMarket) => Object.fromEntries(holdings
                .filter(k => !onlyMarket || this.PROFILE_CLASSES.find(c => c.k === k).market)
                .map(k => [k, [...list]]).filter(([, v]) => v.length));
            return {
                name: p.name || '', age: p.age || null, holdings,
                purpose: each(goalTo), fall: each(fallTo, true),
                horizon: each(p.horizon ? [p.horizon] : []), payout: each(p.payout ? [p.payout] : []), knows: {},
                income: [], dependents: [], cover: [], plans: {},
                completedAt: p.completedAt, skippedAt: null, catchUpSkippedAt: p.catchUpSkippedAt || null, version: 1,
            };
        },

        get onboardingSteps() {
            const d = this.onboarding.draft || {};
            const steps = ['name', 'age', 'holdings', 'purpose'];
            if (this.onboardingClasses('fall').length) steps.push('fall');
            steps.push('horizon', 'payout', 'income', 'family', 'plans', 'knows');
            return steps;
        },
        get onboardingStep() { return this.onboardingSteps[this.onboarding.step] || 'name'; },

        // Which approved question screen draws this step: the two text answers
        // keep theirs, and every multi-answer step uses the multi-select screen.
        get onboardingScreen() {
            return { name: 'q1', age: 'q2' }[this.onboardingStep] || 'q7';
        },

        // The classes a per-class question asks about: the ones ticked, and for
        // "a 20% fall" only those whose price moves.
        onboardingClasses(field) {
            const held = (this.onboarding.draft && this.onboarding.draft.holdings) || [];
            const onlyMarket = field && this.PROFILE_ASK[field] && this.PROFILE_ASK[field].market;
            return this.PROFILE_CLASSES.filter(c => held.includes(c.k) && (!onlyMarket || c.market));
        },

        get onboardingCanNext() {
            const d = this.onboarding.draft || {};
            const step = this.onboardingStep;
            switch (step) {
                case 'name': return String(d.name || '').trim().length > 0;
                case 'age': { const a = Number(d.age); return Number.isFinite(a) && a >= 12 && a <= 110; }
                case 'holdings': return (d.holdings || []).length > 0;
                case 'income': return (d.income || []).length > 0;
                case 'family': return (d.dependents || []).length > 0 && (d.cover || []).length > 0;
                case 'plans': {
                    const keys = Object.keys(d.plans || {});
                    return keys.length > 0 && keys.every(k => k === 'nothing' || (d.plans[k] || []).length > 0);
                }
                default:
                    if (this.PROFILE_ASK[step]) return this.onboardingClasses(step).every(c => ((d[step] || {})[c.k] || []).length > 0);
                    return true;
            }
        },

        openOnboarding(editing = false, catchUp = false) {
            const p = this.profile || {};
            const copy = o => JSON.parse(JSON.stringify(o || {}));
            let holdings = [...(p.holdings || [])];
            // First time: tick what the book already holds.
            if (!holdings.length) {
                const held = new Set((this.investments || []).map(i => this._profileClassOf(i)));
                holdings = this.PROFILE_CLASSES.map(c => c.k).filter(k => held.has(k));
            }
            this.onboarding.draft = {
                name: p.name || '', age: p.age || '', holdings,
                purpose: copy(p.purpose), fall: copy(p.fall), horizon: copy(p.horizon), payout: copy(p.payout), knows: copy(p.knows),
                income: [...(p.income || [])], dependents: [...(p.dependents || [])], cover: [...(p.cover || [])], plans: copy(p.plans),
            };
            this.onboarding.catchUp = catchUp;
            this.onboarding.editing = editing || catchUp;
            this.onboarding.step = catchUp ? Math.max(0, this.onboardingSteps.indexOf('purpose')) : 0;
            this.onboarding.open = true;
        },

        _tapped() { if (window.RFMMotion?.Haptics && this.haptics) window.RFMMotion.Haptics.tap(); },

        // One toggle for every multi-answer list. An "only" answer ("No one",
        // "None yet") stands alone: picking it clears the rest, and picking
        // anything else clears it.
        onboardingToggle(field, v, only = []) {
            const list = this.onboarding.draft[field] = [...(this.onboarding.draft[field] || [])];
            const i = list.indexOf(v);
            if (i >= 0) list.splice(i, 1);
            else if (only.includes(v)) list.splice(0, list.length, v);
            else { list.push(v); only.forEach(o => { const j = list.indexOf(o); if (j >= 0) list.splice(j, 1); }); }
            this.onboarding.draft[field] = list;
            this._tapped();
        },

        onboardingOnly(field) {
            return (this.PROFILE_LISTS[field] || []).filter(o => o.only).map(o => o.v);
        },

        onboardingToggleClass(field, cls, v) {
            const all = { ...(this.onboarding.draft[field] || {}) };
            const list = [...(all[cls] || [])];
            const i = list.indexOf(v);
            if (i >= 0) list.splice(i, 1); else list.push(v);
            // A growth-only answer cannot coexist with a requested payout.
            all[cls] = field === 'payout'
                ? (v === 'none' && i < 0 ? ['none'] : list.filter(x => x !== 'none'))
                : list;
            this.onboarding.draft[field] = all;
            this._tapped();
        },

        onboardingHas(field, cls, v) {
            return (((this.onboarding.draft || {})[field] || {})[cls] || []).includes(v);
        },

        onboardingTogglePlan(k) {
            const plans = { ...(this.onboarding.draft.plans || {}) };
            if (plans[k]) delete plans[k];
            else if (k === 'nothing') { Object.keys(plans).forEach(x => delete plans[x]); plans.nothing = []; }
            else { delete plans.nothing; plans[k] = []; }
            this.onboarding.draft.plans = plans;
            this._tapped();
        },

        onboardingTogglePlanWhen(k, w) {
            const plans = { ...(this.onboarding.draft.plans || {}) };
            const list = [...(plans[k] || [])];
            const i = list.indexOf(w);
            if (i >= 0) list.splice(i, 1); else list.push(w);
            plans[k] = list;
            this.onboarding.draft.plans = plans;
            this._tapped();
        },

        onboardingNext() {
            if (!this.onboardingCanNext) return;
            if (this.onboarding.step < this.onboardingSteps.length - 1) this.onboarding.step++;
            else this.finishOnboarding();
        },

        onboardingBack() {
            const first = this.onboarding.catchUp ? this.onboardingSteps.indexOf('purpose') : 0;
            if (this.onboarding.step > first) this.onboarding.step--;
        },

        finishOnboarding() {
            const d = this.onboarding.draft;
            const age = Math.round(Number(d.age));
            const held = new Set(d.holdings);
            // Answers for a class that was later unticked are dropped.
            const keep = (obj, field) => Object.fromEntries(Object.entries(obj || {})
                .filter(([k, v]) => held.has(k) && v.length && this.onboardingClasses(field).some(c => c.k === k)));
            this.profile = {
                version: 2,
                name: String(d.name || '').trim().slice(0, 40), age,
                holdings: this.PROFILE_CLASSES.map(c => c.k).filter(k => held.has(k)),
                purpose: keep(d.purpose, 'purpose'), fall: keep(d.fall, 'fall'), horizon: keep(d.horizon, 'horizon'),
                payout: keep(d.payout, 'payout'), knows: keep(d.knows, 'knows'),
                income: [...d.income], dependents: [...d.dependents], cover: [...d.cover],
                plans: JSON.parse(JSON.stringify(d.plans || {})),
                completedAt: new Date().toISOString(), skippedAt: null, catchUpSkippedAt: null,
            };
            // Age decides the tax slabs and 80TTB; the person just told us it.
            this.tax.seniorCitizen = age >= 60;
            this.onboarding.open = false;
            this.onboarding.catchUp = false;
            if (window.RFMMotion?.Haptics && this.haptics) window.RFMMotion.Haptics.success();
            // A new profile is a new brief — the cached one was written for someone else.
            this.maybeRunDaily(true);
        },

        skipOnboarding() {
            if (this.onboarding.catchUp) this.profile.catchUpSkippedAt = new Date().toISOString();
            else if (!this.onboarding.editing) this.profile.skippedAt = new Date().toISOString();
            this.onboarding.open = false;
            this.onboarding.catchUp = false;
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
            news: { icon: 'newspaper' }, rate: { icon: 'account_balance' }, price: { icon: 'savings' },
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
                    document.dispatchEvent(new Event('corpus:data-saved'));
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
        /* The same fund, however it was named. A statement writes "Quant Small
           Cap Fund Direct Plan Growth"; AMFI's list says "Quant Small Cap Fund -
           Direct Plan - Growth"; another says "Midcap" for "Mid Cap". A plain
           substring test missed all of these, so a SIP added from the AMFI search
           created a second, empty copy of a fund already held. */
        _fundKey(name) {
            const s = String(name || '').toLowerCase().replace(/&/g, ' and ')
                .replace(/\b(mid|small|large|multi|flexi|micro)[\s-]+cap\b/g, '$1cap')
                .replace(/[^a-z0-9]+/g, ' ');
            const drop = new Set(['fund', 'plan', 'option', 'scheme', 'the', 'of', 'mutual', 'mf',
                                  'ltd', 'limited', 'inc', 'corp', 'corporation', 'co', 'company']);
            const words = s.split(' ').filter(w => w && !drop.has(w));
            return words.length >= 2 ? [...new Set(words)].sort().join(' ') : '';
        },

        _matchHolding({ schemeCode, ticker, name, isin }) {
            const all = this.investments || [];
            const code = String(schemeCode || '').trim();
            if (code) { const h = all.find(i => String(i.schemeCode || '') === code); if (h) return h; }
            if (isin) { const h = all.find(i => i.isin && i.isin === isin); if (h) return h; }
            const t = String(ticker || '').trim().toUpperCase();
            if (t) { const h = all.find(i => (i.ticker || '').toUpperCase() === t); if (h) return h; }
            return name ? all.find(i => this._sameFund(i.name, name)) || null : null;
        },

        /* Two names for one fund. Equal keys match; so do keys whose core words
           agree when only one side names its plan (Direct/Regular) or option
           (Growth/IDCW). When both name them and they differ, they are different
           schemes with different NAVs and never match. */
        _sameFund(a, b) {
            const ka = this._fundKey(a), kb = this._fundKey(b);
            if (!ka || !kb) return false;
            if (ka === kb) return true;
            const OPT = new Set(['growth', 'idcw', 'dividend', 'payout', 'reinvestment', 'reinvest', 'bonus']);
            const PLAN = new Set(['direct', 'regular']);
            const split = k => { const w = k.split(' ');
                return { core: w.filter(x => !OPT.has(x) && !PLAN.has(x)).join(' '),
                         opt: w.filter(x => OPT.has(x)).join(' '), plan: w.filter(x => PLAN.has(x)).join(' ') }; };
            const x = split(ka), y = split(kb);
            if (!x.core || x.core !== y.core) return false;
            if (x.plan && y.plan && x.plan !== y.plan) return false;
            if (x.opt && y.opt && x.opt !== y.opt) return false;
            return true;
        },

        _isUsdHolding(i) {
            return !!i && (i.currency === 'USD' || ['Stock (US)', 'ETF (US)'].includes(i.type));
        },

        /* The holding an incoming statement row is. ISIN first, then folio AND
           fund name together (one folio holds several schemes), then the fund
           name within the statement's category. A dollar holding is never a
           match for an Indian statement row, and a holding already matched by an
           earlier row is not matched again. */
        _findStatementMatch(inc, used = new Set(), categoryPool = null) {
            const pool = (this.investments || []).filter(i => !this._isUsdHolding(i) && !used.has(i.id));
            const isin = String(inc.isin || '').trim();
            if (isin) { const h = pool.find(i => String(i.isin || '').trim() === isin); if (h) return h; }
            const folio = String(inc.folioNumber || '').trim();
            if (folio.length > 4) {
                const h = pool.find(i => String(i.folioNumber || '').trim() === folio && this._sameFund(i.name, inc.name));
                if (h) return h;
            }
            const names = (categoryPool || pool).filter(i => !this._isUsdHolding(i) && !used.has(i.id));
            return names.find(i => this._sameFund(i.name, inc.name)) || null;
        },

        // SIPs whose holding is gone are re-pointed at the same fund if it is
        // still held, and otherwise unlinked, never left pointing at nothing.
        _relinkSips() {
            const ids = new Set((this.investments || []).map(i => i.id));
            let changed = false;
            for (const sip of this.sips || []) {
                if (!sip.linkedInvestmentId || ids.has(sip.linkedInvestmentId)) continue;
                const h = this._matchHolding({ schemeCode: sip.schemeCode, ticker: sip.ticker, name: sip.name });
                sip.linkedInvestmentId = h ? h.id : null;
                changed = true;
            }
            if (changed) this.sips = [...this.sips];
        },

        // Which holding a SIP adds to, said on the SIP's own row.
        sipLink(sip) {
            const h = this._linkedHolding(sip);
            if (!h) return { ok: false, text: 'Not linked to a holding' };
            if (sip.type === 'RD') return { ok: true, text: `Linked RD · ${this.formatCurrency(Number(h.amount) || 0)} confirmed principal` };
            const units = Number(h.units) || 0;
            return units > 0
                ? { ok: true, text: `Adds to your ${units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units` }
                : { ok: true, text: 'Adds to a new holding, no units yet' };
        },

        /* One-off repair for SIPs made before the matcher above: a SIP pointing
           at an empty copy of a fund you already hold is moved onto the real one,
           and the empty copy is removed. Only a copy with no units, no cost and
           no other SIP on it is ever removed. */
        _repairSipLinks() {
            let changed = false;
            for (const sip of this.sips || []) {
                if (sip.type !== 'SIP') continue;
                const linked = (this.investments || []).find(i => i.id === sip.linkedInvestmentId);
                if (linked && (Number(linked.units) || 0) > 0) continue;
                const others = (this.investments || []).filter(i => i !== linked && (Number(i.units) || 0) > 0);
                const code = String(sip.schemeCode || (linked && linked.schemeCode) || '');
                const key = this._fundKey(sip.name);
                const real = others.find(i => code && String(i.schemeCode || '') === code)
                          || (key ? others.find(i => this._fundKey(i.name) === key) : null);
                if (!real) continue;
                sip.linkedInvestmentId = real.id;
                if (code && !real.schemeCode) real.schemeCode = code;
                changed = true;
                if (linked && !(Number(linked.amount) > 0) && !(this.sips || []).some(s => s !== sip && s.linkedInvestmentId === linked.id)) {
                    this.investments = this.investments.filter(i => i !== linked);
                }
            }
            if (changed) { this.sips = [...this.sips]; this.saveData(); }
            return changed;
        },

        async addSip() {
            if (!this.newSip.name || !this.newSip.monthlyAmount) return;

            const name = this.newSip.name.trim();
            const schemeCode = (this.newSip.schemeCode || '').trim();
            const ticker = (this.newSip.ticker || '').trim();

            // 1. Intelligent Holding Resolution: Check if this MF/Stock is already registered in investments
            let existingHolding = this.newSip.type === 'RD'
                ? (this.investments || []).find(i => i.type === 'Recurring Deposit' && i.id === this.newSip.linkedInvestmentId)
                  || (this.investments || []).find(i => i.type === 'Recurring Deposit' && i.name.trim().toLowerCase() === name.toLowerCase())
                : this._matchHolding({ schemeCode, ticker, name });
            // A fund you already hold without its AMFI code gains it here, so its
            // NAV syncs from now on.
            if (existingHolding && schemeCode && !existingHolding.schemeCode) existingHolding.schemeCode = schemeCode;

            // 2. If not found in investments, automatically register a new Mutual Fund / Stock holding!
            // A recurring deposit, a PPF contribution or an EMI is not a share or a
            // fund. Making a 0-share "Stock (IND)" for it put a fake stock in the
            // book whose instalments could never be recorded. Only a fund chosen
            // from the AMFI list (it carries a scheme code) gets a holding made.
            if (!existingHolding && this.newSip.type !== 'RD' && !(this.newSip.type === 'SIP' && schemeCode)) {
                const kind = inv => window.CorpusSchemes ? window.CorpusSchemes.match(inv) : null;
                const sc = kind({ name });
                existingHolding = sc ? (this.investments || []).find(i => kind(i) === sc) || null : null;
            }
            if (!existingHolding && this.newSip.type === 'SIP' && schemeCode) {
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

            if (!existingHolding && this.newSip.type === 'RD') {
                existingHolding = {
                    id: this.newId('inv'), name, type: 'Recurring Deposit', amount: 0,
                    currentValue: 0, rate: 0, payout: 'Cumulative / On Maturity', confirmedInstalments: []
                };
                this.investments.push(existingHolding);
            }

            const createdSip = {
                ...this.newSip,
                id:                 this.newId('sip'),
                monthlyAmount:      Number(this.newSip.monthlyAmount),
                dayOfMonth:         Number(this.newSip.dayOfMonth) || 5,
                linkedInvestmentId: existingHolding ? existingHolding.id : null,
                schemeCode:         schemeCode || (existingHolding && existingHolding.schemeCode) || '',
                ticker:             ticker || (existingHolding && existingHolding.ticker) || '',
                // Starts settled for the current month. Creating a plan on the 20th is not
                // evidence that this month's instalment was paid, and the old code bought a
                // month of units the instant the form was submitted.
                lastExecutedMonth:  this.currentMonthKey
            };

            if (this.newSip.type === 'RD' && existingHolding) {
                createdSip.confirmedInstalments = [];
                existingHolding.linkedSipId = createdSip.id;
            }

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
                today >= this._sipDayIn(sip, new Date().getFullYear(), new Date().getMonth()) && sip.lastExecutedMonth !== monthKey
            );
        },

        _linkedHolding(sip) {
            return (this.investments || []).find(inv => inv.id === sip.linkedInvestmentId)
                || this._matchHolding({ schemeCode: sip.schemeCode, ticker: sip.ticker, name: sip.name });
        },

        /* The user confirms the money left their account. Only then do units appear — and
           only at a price that actually came from a provider. Without one there is nothing
           honest to write, so it says so and stops rather than guessing. */
        async confirmSipDebit(sip) {
            if (sip.lastExecutedMonth === this.currentMonthKey) return false;
            const holding = this._linkedHolding(sip);
            if (!holding) {
                this.sipDebitError = `${sip.name} is not linked to a holding yet. Open it and pick one first.`;
                return false;
            }

            if (sip.type === 'RD') {
                if (holding.type !== 'Recurring Deposit') {
                    this.sipDebitError = 'Link this schedule to an RD holding first.';
                    return false;
                }
                const amount = Number(sip.monthlyAmount);
                if (!(amount > 0)) return false;
                const entry = { id: this.newId('rd'), date: this.localDateKey(), amount };
                holding.confirmedInstalments = [...(holding.confirmedInstalments || []), entry];
                holding.amount = Math.round(((Number(holding.amount) || 0) + amount) * 100) / 100;
                holding.currentValue = Math.round(((Number(holding.currentValue) || 0) + amount) * 100) / 100;
                sip.confirmedInstalments = [...(sip.confirmedInstalments || []), entry];
                sip.lastExecutedMonth = this.currentMonthKey;
                sip.lastRecordedMonth = this.currentMonthKey;
                this.sipDebitError = '';
                this.investments = [...this.investments];
                this.sips = [...this.sips];
                this.saveData();
                this.queueNwSnapshot('rd-instalment');
                return true;
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

            const priorUnits = Number(holding.units) || 0;
            // What the existing units cost, from the one valuation the app uses.
            // `amount` was read here before, and after an edit it holds the
            // current value, which would have averaged in a price never paid.
            const priorKnown = priorUnits === 0 || this.hasKnownCost(holding);
            const totalUnits = priorUnits + addedUnits;
            const totalCost  = (priorUnits > 0 ? this.getInvInvestedCost(holding) : 0) + debitAmount;

            holding.units        = Math.round(totalUnits * 1000) / 1000;
            holding.amount       = Math.round(totalCost * 100) / 100;
            if (priorKnown) holding.buyPrice = Math.round((totalCost / totalUnits / (isUsd ? this.fxUsdInr : 1)) * 10000) / 10000;
            holding.currentValue = Math.round(totalUnits * priceInInr * 100) / 100;

            sip.lastExecutedMonth = this.currentMonthKey;
            // Only a confirmed debit counts as "recorded"; a skip or a new plan does not.
            sip.lastRecordedMonth = this.currentMonthKey;
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
            if (sip.lastExecutedMonth === this.currentMonthKey) return;
            sip.lastExecutedMonth = this.currentMonthKey;
            sip.skippedInstalments = [...(sip.skippedInstalments || []), { month: this.currentMonthKey, date: this.localDateKey() }];
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

        openSipHoldingPicker() {
            const f = this.editSipForm;
            const pool = (this.investments || []).filter(i => ['equity', 'mf', 'gold'].includes(this._chipOf(i)));
            this.openPicker({
                title: 'Adds to', value: f.linkedInvestmentId || '', search: pool.length > 8, searchHint: 'Search holdings',
                options: pool.map(i => ({ value: i.id, label: i.name, meta: this.holdingLine(i) })),
                onPick: v => { f.linkedInvestmentId = v; const h = pool.find(i => i.id === v); if (h && h.schemeCode) f.schemeCode = h.schemeCode; },
            });
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
            const diff = this._sipDaysToNext(sip);
            return diff === 0 ? 'today' : `in ${diff} day${diff !== 1 ? 's' : ''}`;
        },

        /* ════════════════════════════════════════════════════════════
           CORPUS 3.0 — what the approved screens read.
           Presentation only: every figure below is derived from the stores and
           getters above, so a screen can never disagree with the logic.
           ════════════════════════════════════════════════════════════ */

        // Compact rupees the way the designs write them: ₹1.54 Cr, ₹52.4 L.
        inrShort(v) {
            const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '−' : '';
            const trim = x => String(+x);
            if (a >= 1e7) return `${s}₹${trim((a / 1e7).toFixed(2))} Cr`;
            if (a >= 1e5) return `${s}₹${trim((a / 1e5).toFixed(1))} L`;
            return s + this.formatCurrency(a);
        },

        // Chrome's en-IN writes September as "Sept"; the designs, and everyone, write "Sep".
        MONTHS: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],

        shortDate(d) {
            const t = d instanceof Date ? d : new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
            return Number.isNaN(t.getTime()) ? '' : `${t.getDate()} ${this.MONTHS[t.getMonth()]}`;
        },

        get avatarInitials() {
            const parts = String(this.profile?.name || '').trim().split(/\s+/).filter(Boolean);
            if (!parts.length) return '';
            return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
        },

        get firstName() {
            return String(this.profile?.name || '').trim().split(/\s+/)[0] || '';
        },

        // Which Overview the approved set draws: the new user's, the first day's, or the full one.
        get overviewMode() {
            if (!this.hasAnyPortfolioData) return 'nu';
            return (this.nwHistory || []).length < 2 ? 'ofd' : 'ov';
        },

        // "Synced 2:14 pm" today; "Synced 16 Sep" when the newest price is older.
        get syncedLabel() {
            if (this.pullToRefresh.isRefreshing) return 'Syncing\u2026';
            const priced = (this.investments || []).map(i => i.lastNavUpdate || i.priceAsOf).filter(Boolean)
                .map(t => new Date(t)).filter(d => !Number.isNaN(d.getTime())).sort((a, b) => b - a);
            if (!priced.length) return (this.investments || []).length ? 'Not synced yet' : '';
            const d = priced[0];
            const today = new Date().toDateString() === d.toDateString();
            return today ? `Synced ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`
                         : `Synced ${this.shortDate(d)}`;
        },

        // The hero tag: the change over the last month, beside the words "this month".
        get nwMonthChange() {
            const all = this.nwHistory || [];
            if (all.length < 2) return null;
            const now = new Date();
            const from = this.localDateKey(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()));
            const inWin = all.filter(p => p.date >= from);
            const pts = inWin.length >= 2 ? inWin : all.slice(-2);
            const a = Number(pts[0].value), b = Number(pts[pts.length - 1].value);
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            const d = b - a, pct = a > 0 ? (d / a) * 100 : null;
            const pctPart = pct !== null && Math.abs(pct) < 1000 ? ` (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%)` : '';
            return { up: d >= 0, label: `${d >= 0 ? '↑' : '↓'} ${this.formatCurrency(Math.abs(d))}${pctPart}` };
        },

        RANGE_WORDS: { '1W': 'a week', '1M': 'a month', '3M': '3 months', '6M': '6 months', '1Y': 'a year', 'ALL': 'all time' },

        // "Up ₹8.6 L over 6 months, from ₹1.45 Cr on 24 Mar."
        get nwSummary() {
            const c = this.nwRangeChange, pts = this.nwChartData;
            if (!c || pts.length < 2) return null;
            const over = this.nwChartRange === 'ALL' ? 'since records began' : `over ${this.RANGE_WORDS[this.nwChartRange]}`;
            return { word: c.up ? 'Up' : 'Down', amount: this.inrShort(Math.abs(c.delta)),
                     rest: ` ${over}, from ${this.inrShort(pts[0].value)} on ${this.shortDate(pts[0].date)}.` };
        },

        /* The chart, drawn as the design draws it: an SVG line and fill in a
           350×170 box. The line is monotone, so it never dips below a real low
           or overshoots a real high between two observations. */
        NW_BOX: { w: 350, h: 170, x0: 0, x1: 346, top: 44, bottom: 150 },
        nwHoverIdx: -1,
        nwDrawKey: 0,

        get nwSvg() {
            const pts = this.nwChartSeries.map(p => ({ date: p.date, v: Number(p.value) })).filter(p => Number.isFinite(p.v));
            if (pts.length < 2) return null;
            const B = this.NW_BOX;
            const lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
            const span = hi - lo || Math.abs(hi) || 1;
            const t0 = new Date(`${pts[0].date}T00:00:00`).getTime();
            const t1 = new Date(`${pts[pts.length - 1].date}T00:00:00`).getTime();
            const xy = pts.map((p, i) => {
                const t = new Date(`${p.date}T00:00:00`).getTime();
                const fx = t1 > t0 ? (t - t0) / (t1 - t0) : i / (pts.length - 1);
                return [B.x0 + fx * (B.x1 - B.x0), B.bottom - ((p.v - lo) / span) * (B.bottom - B.top)];
            });
            const f = n => Math.round(n * 10) / 10;
            // Fritsch–Carlson tangents.
            const n = xy.length, d = [], m = [];
            for (let i = 0; i < n - 1; i++) d.push((xy[i + 1][1] - xy[i][1]) / ((xy[i + 1][0] - xy[i][0]) || 1));
            m[0] = d[0]; m[n - 1] = d[n - 2];
            for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
            let line = `M${f(xy[0][0])},${f(xy[0][1])}`;
            for (let i = 0; i < n - 1; i++) {
                const [xa, ya] = xy[i], [xb, yb] = xy[i + 1], h = (xb - xa) / 3;
                line += ` C${f(xa + h)},${f(ya + m[i] * h)} ${f(xb - h)},${f(yb - m[i + 1] * h)} ${f(xb)},${f(yb)}`;
            }
            const [ex, ey] = xy[n - 1];
            return {
                line, area: `${line} L${f(ex)},${B.h} L${f(xy[0][0])},${B.h} Z`,
                pts: xy.map(([x, y], i) => ({ x: (x / B.w) * 100, y: (y / B.h) * 100, date: pts[i].date, v: pts[i].v })),
                end: { x: (ex / B.w) * 100, y: (ey / B.h) * 100 },
                tag: this.inrShort(pts[n - 1].v),
            };
        },

        // Up to four month names spread under the line (M14).
        get nwXLabels() {
            const pts = this.nwChartSeries;
            if (pts.length < 2) return [];
            const long = this.nwChartRange === '1W' || this.nwChartRange === '1M';
            const fmt = k => {
                const d = new Date(`${k}T00:00:00`);
                return long ? this.shortDate(d) : this.MONTHS[d.getMonth()];
            };
            const out = [];
            for (let i = 0; i < 4; i++) {
                const p = pts[Math.round((i / 3) * (pts.length - 1))];
                const label = fmt(p.date);
                if (!out.includes(label)) out.push(label);
            }
            return out;
        },

        nwScrub(ev) {
            const s = this.nwSvg;
            if (!s) return;
            const r = ev.currentTarget.getBoundingClientRect();
            const x = (((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width) * 100;
            let best = 0;
            s.pts.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(s.pts[best].x - x)) best = i; });
            this.nwHoverIdx = best;
            const p = s.pts[best];
            this.nwHoverLabel = `${this.formatObsDate(p.date)}, ${this.formatIndianShort(p.v)}`;
        },

        nwScrubEnd() { this.nwHoverIdx = -1; this.nwHoverLabel = ''; },

        setNwRange(r) {
            this.nwChartRange = r;
            this.nwScrubEnd();
            this.nwDrawKey += 1;
            if (window.RFMMotion?.Haptics) window.RFMMotion.Haptics.tap();
        },

        // Designed tile colours, keyed by allocation bucket.
        ALLOC_COLORS: { equity: '#5577CC', mf: '#14A391', debt: '#3A9FCC', us: '#CF6A86', gold: '#B08A22', metals: '#B4A189',
                        property: '#9068E0', cash: '#7F97C2', realty: '#9068E0' },

        allocPct(k) {
            const p = Number(k.pct) || 0;
            return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
        },

        openAllocation(k) {
            const chip = { equity: 'equity', us: 'equity', mf: 'mf', gold: 'gold', metals: 'metals' }[k.key] || 'all';
            this.invFilter = chip;
            this.activePage = k.page || 'investments';
        },

        /* Coming up, as the design lists it: one icon, one line, one amount and
           date, and at most one action. Money that moves on its own and things
           that need a decision share the card, in date order. */
        get comingUp() {
            const out = [];
            for (const inv of (this.maturingInvestments || [])) {
                const days = Math.ceil((new Date(inv.maturityDate) - Date.now()) / 864e5);
                if (days < 0 || days > 120) continue;
                out.push({ id: 'm' + inv.id, icon: 'event', sort: days,
                           title: days === 0 ? `${inv.name} matures today` : `${inv.name} matures in ${days} day${days === 1 ? '' : 's'}`,
                           amount: this.formatCurrency(this.getInvCurrentValue(inv)), when: `on ${this.shortDate(inv.maturityDate)}`,
                           action: 'Plan it', go: () => { this.activePage = 'maturity'; } });
            }
            for (const sip of this.dueSipDebits) {
                out.push({ id: 'due' + sip.id, icon: 'task_alt', sort: -1,
                           title: `${sip.name} was due on the ${this.ordinal(sip.dayOfMonth)}`,
                           amount: this.formatCurrency(sip.monthlyAmount), when: 'confirm it went through',
                           action: 'Confirm', go: () => { this.activePage = 'income'; } });
            }
            for (const sip of (this.activeSips || [])) {
                const days = this.sipDaysUntil(sip);
                if (days === null || days > 30 || this.dueSipDebits.some(d => d.id === sip.id)) continue;
                out.push({ id: 's' + sip.id, icon: 'autorenew', sort: days,
                           title: days === 0 ? `${sip.name} debits today` : `${sip.name} debits in ${days} day${days === 1 ? '' : 's'}`,
                           amount: this.formatCurrency(sip.monthlyAmount), when: `on the ${this.ordinal(sip.dayOfMonth)}`,
                           action: null });
            }
            if (Number(this.efGap) > 0 && Number(this.emergency.efMonthly) > 0) {
                out.push({ id: 'ef', icon: 'savings', sort: 999, title: 'Emergency fund is short',
                           amount: this.formatCurrency(this.efGap), when: `below a ${this.emergency.efMonths}-month buffer`,
                           action: 'Plan it', go: () => { this.activePage = 'emergency'; } });
            }
            return out.sort((a, b) => a.sort - b.sort).slice(0, 4);
        },

        /* ── Holdings, as the approved screen groups them ─────────────── */
        HOLDING_CHIPS: [
            { key: 'all', label: 'All' }, { key: 'equity', label: 'Stocks' }, { key: 'mf', label: 'Mutual funds' },
            { key: 'deposits', label: 'Deposits' }, { key: 'schemes', label: 'Government schemes' },
            { key: 'gold', label: 'Gold' }, { key: 'metals', label: 'Metals' }, { key: 'bonds', label: 'Bonds' },
        ],

        _isScheme(inv) {
            const t = (inv.type || '').toLowerCase(), n = (inv.name || '').toLowerCase();
            return t.includes('government') || /\b(epf|ppf|nps|scss|ssy|nsc|kvp|post office|senior citizen|sukanya|mis)\b/.test(n);
        },

        _chipOf(inv) {
            const t = inv.type || '';
            if (t === 'Physical Metal') return inv.metal === 'gold' ? 'gold' : 'metals';
            if (t.includes('Stock') || t.includes('ETF')) return (inv.ticker || '').toUpperCase().includes('GOLD') ? 'gold' : 'equity';
            if (t === 'Mutual Fund') return 'mf';
            if (t === 'Gold') return 'gold';
            if (t === 'Bond') return 'bonds';
            if (this._isScheme(inv)) return 'schemes';
            if (t === 'Real Estate') return 'other';
            return 'deposits';
        },

        get holdingChips() {
            const all = this.investments || [];
            const chips = this.HOLDING_CHIPS.map(c => c.key === 'all' ? { ...c, label: `All (${all.length})` } : c);
            if (all.some(i => this._chipOf(i) === 'other')) chips.push({ key: 'other', label: 'Other' });
            return chips;
        },

        get chipHoldings() {
            const all = this.investments || [];
            const f = this.invFilter;
            if (!f || f === 'all') return all;
            if (f === 'debt') return all.filter(i => ['deposits', 'schemes', 'bonds'].includes(this._chipOf(i)));
            return all.filter(i => this._chipOf(i) === f);
        },

        _sectionOf(inv) {
            const c = this._chipOf(inv);
            if (c === 'equity') return this._marketBand(inv) === 'US' ? 'us' : 'ind';
            if (['deposits', 'schemes', 'bonds'].includes(c)) return 'fixed';
            return c;
        },

        get holdingSections() {
            const order = [
                { key: 'ind', title: 'Indian stocks', c: '#5577CC' }, { key: 'us', title: 'US stocks', c: '#CF6A86' },
                { key: 'mf', title: 'Mutual funds', c: '#14A391' }, { key: 'fixed', title: '', c: '#3A9FCC' },
                { key: 'gold', title: 'Gold', c: '#B08A22' }, { key: 'other', title: 'Property and other', c: '#9068E0' },
            ];
            const items = this.chipHoldings;
            return order.map(s => {
                const list = items.filter(i => this._sectionOf(i) === s.key);
                let title = s.title;
                if (s.key === 'fixed') {
                    const kinds = new Set(list.map(i => this._chipOf(i)));
                    const names = [kinds.has('schemes') && 'Government schemes', kinds.has('deposits') && 'deposits', kinds.has('bonds') && 'bonds'].filter(Boolean);
                    title = names.length === 3 ? 'Deposits, schemes and bonds' : names.join(' and ');
                    title = title.charAt(0).toUpperCase() + title.slice(1);
                }
                return { ...s, title, items: list, count: `${list.length} holding${list.length === 1 ? '' : 's'}` };
            }).filter(s => s.items.length);
        },

        get holdingsTotal() {
            return (this.investments || []).reduce((a, i) => a + this.getInvCurrentValue(i), 0);
        },

        get holdingsMeta() {
            const n = (this.investments || []).length;
            const tail = this.syncedLabel.replace(/^Synced/, 'synced').replace('Not synced yet', 'not synced yet').replace('Syncing', 'syncing');
            return `${n} holding${n === 1 ? '' : 's'}${tail ? ', ' + tail : ''}`;
        },

        // The square to the left of a row: a monogram for anything with a ticker, an icon otherwise.
        holdingWell(inv) {
            const c = this._chipOf(inv);
            if (c === 'equity') {
                const s = String(inv.ticker || inv.name || '?').toUpperCase().replace(/[^A-Z0-9]/g, '');
                return { text: this._marketBand(inv) === 'US' ? s.slice(0, 2) : s.slice(0, 1) };
            }
            const n = (inv.name || '').toLowerCase();
            const pick = c === 'mf' ? { icon: 'pie_chart' } : c === 'gold' ? { icon: 'toll' } : c === 'bonds' ? { icon: 'receipt_long' }
                       : c === 'other' ? { icon: 'home' } : c === 'schemes' ? (/post office|mis/.test(n) ? { icon: 'mail' } : { icon: 'account_balance' }) : { icon: 'savings' };
            return { icon: pick.icon, gold: c === 'gold' };
        },

        holdingLine(inv) {
            const c = this._chipOf(inv);
            const u = Number(inv.units) || 0;
            const fmtU = (x, d = 3) => Number(x).toLocaleString('en-IN', { maximumFractionDigits: d });
            if (c === 'equity') return `${inv.ticker || inv.name}, ${fmtU(u, 4)} share${u === 1 ? '' : 's'}`;
            if (c === 'mf') return `${fmtU(u)} units`;
            if (c === 'gold') return (inv.type || '').includes('ETF') || inv.ticker ? `${inv.ticker || 'Gold ETF'}, ${fmtU(u)} units` : `${fmtU(u)} g`;
            const rate = Number(inv.rate) || 0;
            const pay = (inv.payout || '').toLowerCase();
            const payout = /month/.test(pay) ? 'pays monthly' : /quarter/.test(pay) ? 'pays quarterly'
                         : /half/.test(pay) ? 'pays twice a year' : /annual|year/.test(pay) ? 'pays yearly' : '';
            if (inv.maturityDate && (c === 'deposits' || c === 'bonds' || !payout)) {
                return `${rate ? rate + '%, ' : ''}matures ${this.formatDate(inv.maturityDate)}`;
            }
            return [rate ? `${rate}%` : '', payout].filter(Boolean).join(', ') || inv.issuer || inv.type || '';
        },

        // US holdings show their dollar value; the rupee figure goes on a second line.
        holdingValue(inv) {
            if (this.lotCurrency(inv) === 'USD') {
                const usd = (Number(inv.units) || 0) * (Number(inv.currentPrice) || Number(inv.buyPrice) || 0);
                return this.formatNative(inv, usd);
            }
            return this.formatCurrency(this.getInvCurrentValue(inv));
        },

        holdingTag(inv) {
            if (this.isRateBearing(inv.type) || this.getInvInvestedCost(inv) <= 0) return null;
            const p = Number(this.getInvPnLPct(inv));
            if (!Number.isFinite(p)) return null;
            const a = Math.abs(p);
            return { up: p >= 0, label: `${p >= 0 ? '↑' : '↓'} ${a >= 10 ? a.toFixed(1) : a.toFixed(2)}%` };
        },

        holdingNote(inv) {
            if (!inv.maturityDate) return '';
            const days = Math.ceil((new Date(inv.maturityDate) - Date.now()) / 864e5);
            if (days < 0 || days > 60) return '';
            return days === 0 ? 'Matures today' : `Matures in ${days} day${days === 1 ? '' : 's'}`;
        },

        // What the filter-empty screen says for each chip.
        get filterEmpty() {
            const m = {
                equity:   { icon: 'candlestick_chart', t: 'No stocks yet', d: 'Indian and US shares and ETFs show here. Tap Add to add one.', a: 'Add a stock', ctx: 'equity' },
                mf:       { icon: 'pie_chart', t: 'No mutual funds yet', d: 'Any scheme listed with AMFI, valued at its NAV each evening. Tap Add to add one.', a: 'Add a fund', ctx: 'mf' },
                deposits: { icon: 'savings', t: 'No deposits yet', d: 'Bank and company fixed deposits show here. Tap Add to add one.', a: 'Add a deposit', ctx: 'deposits' },
                schemes:  { icon: 'account_balance', t: 'No government schemes yet', d: 'SCSS, POMIS, NSC, EPF and PPF show here. Tap Add to add one.', a: 'Add a scheme', ctx: 'schemes' },
                gold:     { icon: 'toll', t: 'No gold yet', d: 'Gold ETFs, sovereign gold bonds and physical gold show here. Tap Add to add one.', a: 'Add gold', ctx: 'gold' },
                bonds:    { icon: 'receipt_long', t: 'No bonds yet', d: 'Tax-free, 54EC and company bonds show here. Tap Add to add one.', a: 'Add a bond', ctx: 'bonds' },
                other:    { icon: 'home', t: 'Nothing else yet', d: 'Property and anything that fits no other group shows here. Tap Add to add one.', a: 'Add a holding', ctx: 'all' },
            };
            return m[this.invFilter] || m.other;
        },

        get holdingsMode() {
            if (!(this.investments || []).length) return 'hoem';
            return this.chipHoldings.length ? 'ho' : 'hofe';
        },

        /* ── Holding detail ───────────────────────────────────────────────
           One route, five approved layouts: a share or ETF, a fund, a deposit
           or bond, a government scheme, and gold. */
        get detailVariant() {
            const i = this.detailHolding;
            if (!i) return 'hd-fd';
            const c = this._chipOf(i);
            return c === 'equity' ? 'hd-st' : c === 'mf' ? 'hd-mf' : c === 'gold' || c === 'metals' ? 'hd-go' : c === 'schemes' ? 'hd-sc' : 'hd-fd';
        },

        // Price history, fetched when a quoted holding is opened and kept for the day (M1).
        detailHist: { id: null, loading: false, error: '', series: [], meta: null, fund: null, analyst: null },

        async loadDetailData(inv) {
            if (!inv) return;
            const h = { id: inv.id, loading: true, error: '', series: [], meta: null, fund: null, analyst: null };
            this.detailHist = h;
            const day = this.localDateKey(new Date());
            const key = `corpus_px_${inv.id}`;
            try {
                const hit = JSON.parse(localStorage.getItem(key) || 'null');
                if (hit && hit.day === day && (hit.series || []).length) {
                    this.detailHist = { ...h, ...hit, id: inv.id, loading: false };
                    return;
                }
            } catch (e) {}
            const c = this._chipOf(inv);
            try {
                if (c === 'mf' && inv.schemeCode) {
                    const data = await this.fetchMarketJson(`https://api.mfapi.in/mf/${encodeURIComponent(inv.schemeCode)}`, 10000);
                    const rows = (data?.data || []).map(r => {
                        const [dd, mm, yy] = String(r.date).split('-');
                        return { date: `${yy}-${mm}-${dd}`, v: Number(r.nav) };
                    }).filter(r => Number.isFinite(r.v) && r.v > 0 && r.date.length === 10).reverse();
                    const fund = window.CorpusResearch ? await window.CorpusResearch.studyFund(this, inv).catch(() => null) : null;
                    h.series = rows.slice(-1300);
                    h.fund = { ...(fund || {}), category: data?.meta?.scheme_category || fund?.category || null };
                    const last = rows[rows.length - 1];
                    h.meta = last ? { price: last.v, date: last.date, currency: 'INR' } : null;
                } else if (inv.ticker) {
                    const clean = String(inv.ticker).trim().toUpperCase().replace(/\.(NS|BO)$/, '');
                    const sym = this._marketBand(inv) === 'US' ? clean : `${clean}.NS`;
                    const data = await this.fetchMarketJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y`, 10000);
                    const res = data?.chart?.result?.[0];
                    const ts = res?.timestamp || [], cl = res?.indicators?.quote?.[0]?.close || [];
                    h.series = ts.map((t, i) => ({ date: this.localDateKey(new Date(t * 1000)), v: Number(cl[i]) }))
                                 .filter(p => Number.isFinite(p.v) && p.v > 0);
                    const yearAgo = this.localDateKey(new Date(Date.now() - 365 * 864e5));
                    const yr = h.series.filter(p => p.date >= yearAgo).map(p => p.v);
                    const m = res?.meta || {};
                    h.meta = {
                        price: Number(m.regularMarketPrice) || (h.series.length ? h.series[h.series.length - 1].v : null),
                        time: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
                        currency: m.currency || (this.lotCurrency(inv) === 'USD' ? 'USD' : 'INR'),
                        exchange: m.fullExchangeName || m.exchangeName || null,
                        high52: Number(m.fiftyTwoWeekHigh) || (yr.length ? Math.max(...yr) : null),
                        low52: Number(m.fiftyTwoWeekLow) || (yr.length ? Math.min(...yr) : null),
                    };
                    if (this._marketBand(inv) === 'US' && window.CorpusResearch) {
                        h.analyst = await window.CorpusResearch.fundamentals(this, inv).catch(() => null);
                    }
                }
                if (!h.series.length) h.error = 'offline';
            } catch (e) {
                h.error = 'offline';
            }
            h.loading = false;
            if (this.detailHist.id !== inv.id) return;
            this.detailHist = { ...h };
            if (h.series.length) {
                try { localStorage.setItem(key, JSON.stringify({ day, series: h.series, meta: h.meta, fund: h.fund, analyst: h.analyst })); } catch (e) {}
            }
        },

        DETAIL_RANGES: ['1M', '3M', '6M', '1Y', 'ALL'],

        get detailSeries() {
            const all = this.detailHist.id === this.detailHoldingId ? this.detailHist.series : [];
            if (!all.length) return [];
            const now = new Date();
            const back = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[this.detailRange];
            const from = back ? this.localDateKey(new Date(now.getFullYear(), now.getMonth() - back, now.getDate())) : '';
            const pts = from ? all.filter(p => p.date >= from) : all;
            if (pts.length <= 90) return pts;
            const step = pts.length / 90, out = [];
            for (let i = 0; i < 90; i++) out.push(pts[Math.floor(i * step)]);
            out.push(pts[pts.length - 1]);
            return out;
        },

        // The detail chart: the same monotone line, plus a dashed line at your average cost.
        get detailSvg() {
            const pts = this.detailSeries;
            const inv = this.detailHolding;
            if (pts.length < 2 || !inv) return null;
            const avg = Number(inv.buyPrice) || 0;
            const vals = pts.map(p => p.v).concat(avg > 0 ? [avg] : []);
            const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || hi || 1;
            const W = 350, H = 160, top = 14, bottom = 146;
            const y = v => bottom - ((v - lo) / span) * (bottom - top);
            const xy = pts.map((p, i) => [(i / (pts.length - 1)) * 346, y(p.v)]);
            const f = n => Math.round(n * 10) / 10;
            const n = xy.length, d = [], m = [];
            for (let i = 0; i < n - 1; i++) d.push((xy[i + 1][1] - xy[i][1]) / ((xy[i + 1][0] - xy[i][0]) || 1));
            m[0] = d[0]; m[n - 1] = d[n - 2];
            for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
            let line = `M${f(xy[0][0])},${f(xy[0][1])}`;
            for (let i = 0; i < n - 1; i++) {
                const [xa, ya] = xy[i], [xb, yb] = xy[i + 1], h = (xb - xa) / 3;
                line += ` C${f(xa + h)},${f(ya + m[i] * h)} ${f(xb - h)},${f(yb - m[i + 1] * h)} ${f(xb)},${f(yb)}`;
            }
            const [ex, ey] = xy[n - 1];
            const labels = [];
            for (let i = 0; i < 4; i++) {
                const dt = new Date(`${pts[Math.round((i / 3) * (n - 1))].date}T00:00:00`);
                const l = this.detailRange === '1M' ? this.shortDate(dt) : this.MONTHS[dt.getMonth()];
                if (!labels.includes(l)) labels.push(l);
            }
            return {
                line, area: `${line} L${f(ex)},${H} L0,${H} Z`, avgY: avg > 0 ? f(y(avg)) : null,
                end: { x: (ex / W) * 100, y: (ey / H) * 100 }, labels,
                spoken: `${inv.name} price over ${this.RANGE_WORDS[this.detailRange]}, from ${this.formatNative(inv, pts[0].v)} to ${this.formatNative(inv, pts[n - 1].v)}`
                        + (avg > 0 ? `, against your average of ${this.formatNative(inv, avg)}` : ''),
            };
        },

        setDetailRange(r) { this.detailRange = r; if (window.RFMMotion?.Haptics) window.RFMMotion.Haptics.tap(); },

        // Native-currency position figures for the detail hero and tiles.
        get detailPos() {
            const i = this.detailHolding;
            if (!i) return null;
            const usd = this.lotCurrency(i) === 'USD';
            const units = Number(i.units) || 0;
            const price = Number(i.currentPrice) || Number(i.nav) || Number(i.buyPrice) || 0;
            const avg = Number(i.buyPrice) || 0;
            const valueNative = units > 0 ? units * price : this.getInvCurrentValue(i);
            const costNative = units > 0 ? units * avg : this.getInvInvestedCost(i);
            const gain = valueNative - costNative;
            const pct = costNative > 0 ? (gain / costNative) * 100 : null;
            const nat = v => usd ? this.formatNative(i, v) : this.formatCurrency(v);
            const mf = this._chipOf(i) === 'mf';
            return {
                usd, units, price, avg,
                value: nat(valueNative), valueInr: this.formatCurrency(this.getInvCurrentValue(i)),
                invested: this.formatCurrency(this.getInvInvestedCost(i)),
                avgNative: avg > 0 ? (usd ? this.formatNative(i, avg) : '₹' + avg.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : '',
                avgInr: usd && avg > 0 ? this.formatCurrency(avg * this.fxUsdInr) : '',
                unitsLabel: units.toLocaleString('en-IN', { maximumFractionDigits: mf ? 3 : 4, minimumFractionDigits: mf ? 3 : 0 }),
                tag: costNative > 0 ? { up: gain >= 0, label: `${gain >= 0 ? '↑' : '↓'} ${nat(Math.abs(gain))}${pct !== null ? ` (${gain >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)` : ''}` } : null,
                pct,
            };
        },

        get detailSub() {
            const i = this.detailHolding;
            if (!i) return '';
            const v = this.detailVariant;
            if (v === 'hd-st' || (v === 'hd-go' && i.ticker)) {
                const ex = String(this.detailHist.meta?.exchange || (this._marketBand(i) === 'US' ? 'NASDAQ' : 'NSE'));
                const name = /nasdaq/i.test(ex) ? 'NASDAQ' : /nyse/i.test(ex) ? 'NYSE' : /bse|bombay/i.test(ex) ? 'BSE'
                           : this._marketBand(i) === 'US' ? ex : 'NSE';
                return `${String(i.ticker || '').toUpperCase().replace(/\.(NS|BO)$/, '')} on ${name}`;
            }
            if (v === 'hd-mf') {
                const cat = (this.detailHist.fund?.category || '').replace(/^.*?-\s*/, '').replace(/\s*Fund$/i, '').toLowerCase();
                return [this.fundPlan.short, cat].filter(Boolean).join(', ');
            }
            if (v === 'hd-go') return `${Number(i.units) || 0} g of gold`;
            const rate = Number(i.rate) || 0;
            if (v === 'hd-sc') {
                const issuer = /post office|scss|senior citizen|\bmis\b|nsc|kvp/i.test(`${i.name} ${i.issuer || ''}`) ? 'Post office' : (i.issuer || 'Government');
                return `${issuer}${rate ? `, ${rate}% a year` : ''}`;
            }
            const pay = this.payoutWords(i);
            return `${rate ? `${rate}% a year` : (i.issuer || i.type || '')}${pay && pay !== 'at maturity' ? `, interest paid ${pay}` : pay ? ', paid at maturity' : ''}`;
        },

        get fundPlan() {
            const n = (this.detailHolding?.name || '').toLowerCase();
            const direct = /direct/.test(n) ? 'Direct' : /regular/.test(n) ? 'Regular' : '';
            const idcw = /idcw|dividend/.test(n);
            const kind = idcw ? 'income' : 'growth';
            const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
            return { short: direct ? `${direct} ${kind}` : cap(kind), title: direct ? `${direct}, ${kind}` : cap(kind),
                     note: idcw ? 'Pays out income when the fund declares it.' : 'No payouts. Gains stay invested.' };
        },

        // "Up 18.3% on your average and 14% below its 52-week high of $412."
        get detailSummary() {
            const i = this.detailHolding, p = this.detailPos, m = this.detailHist.meta;
            if (!i || !p || p.pct === null) return null;
            const out = { lead: p.pct >= 0 ? 'Up' : 'Down', pct: `${Math.abs(p.pct).toFixed(1)}%`, rest: ' on your average', pct2: '', tail: '' };
            if (this.detailVariant === 'hd-mf') { out.tail = ' cost.'; return out; }
            if (m && m.high52 && m.price) {
                const below = ((m.high52 - m.price) / m.high52) * 100;
                if (below >= 0.5) {
                    out.rest += ' and ';
                    out.pct2 = `${Math.round(below)}%`;
                    out.tail = ` below its 52-week high${this.detailVariant === 'hd-st' ? ` of ${this.formatNative(i, Math.round(m.high52))}` : ''}.`;
                } else out.tail = ', at its 52-week high.';
                return out;
            }
            out.tail = '.';
            return out;
        },

        get detailMarket() {
            const i = this.detailHolding, m = this.detailHist.meta;
            if (!i || !m || !m.price) return null;
            const t = m.time ? new Date(m.time) : null;
            const lo = Number(m.low52), hi = Number(m.high52);
            return {
                price: this.formatNative(i, m.price),
                at: t ? `at ${t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}${new Date().toDateString() === t.toDateString() ? '' : ` on ${this.shortDate(t)}`}` : '',
                range: hi > lo ? { pos: Math.max(0, Math.min(100, ((m.price - lo) / (hi - lo)) * 100)),
                                   lo: `${this.formatNative(i, lo)} low`, hi: `${this.formatNative(i, hi)} high` } : null,
            };
        },

        // US listings only: Nasdaq publishes analyst counts and targets, nothing free does for NSE (M2).
        get detailAnalyst() {
            const a = this.detailHist.analyst, i = this.detailHolding, m = this.detailHist.meta;
            if (!a || !i || !(a.buy || a.hold || a.sell) || !a.targetMean) return null;
            const up = m?.price ? ((a.targetMean - m.price) / m.price) * 100 : null;
            const view = a.consensus || (a.buy >= (a.hold || 0) + (a.sell || 0) ? 'Buy' : a.sell > a.buy ? 'Sell' : 'Hold');
            const v = String(view).toLowerCase();
            return { view: v.charAt(0).toUpperCase() + v.slice(1),
                     counts: `${a.buy || 0} buy, ${a.hold || 0} hold, ${a.sell || 0} sell`,
                     target: this.formatNative(i, a.targetMean),
                     tag: up === null ? null : { up: up >= 0, label: `${up >= 0 ? '↑' : '↓'} ${Math.abs(up).toFixed(1)}%` } };
        },

        payoutWords(inv) {
            const p = String(inv?.payout || inv?.payoutFrequency || '').toLowerCase();
            if (/month/.test(p)) return 'monthly';
            if (/quarter/.test(p)) return 'quarterly';
            if (/half/.test(p)) return 'twice a year';
            if (/cumulative|maturity/.test(p)) return 'at maturity';
            if (/annual|year/.test(p)) return 'yearly';
            return '';
        },

        PAYOUTS_PER_YEAR: { monthly: 12, quarterly: 4, 'twice a year': 2, yearly: 1 },

        // One payout's size: amount × rate ÷ payouts a year (M9).
        payoutAmount(inv) {
            const n = this.PAYOUTS_PER_YEAR[this.payoutWords(inv)];
            const amt = Number(inv?.amount) || 0, rate = Number(inv?.rate) || 0;
            return n && amt && rate ? Math.round((amt * rate) / 100 / n) : 0;
        },

        /* Payout dates for anything that pays out (M6). SCSS pays on the first of
           Apr, Jul, Oct and Jan; anything else pays on its anniversary day,
           stepped from the start date. With no start date there is no schedule,
           and the screen says so rather than inventing one. */
        payoutSchedule(inv) {
            const n = this.PAYOUTS_PER_YEAR[this.payoutWords(inv)];
            if (!inv || !n) return [];
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const step = 12 / n;
            const start = inv.startDate ? new Date(inv.startDate) : null;
            let anchor;
            if (/scss|senior citizen/i.test(inv.name || '')) anchor = new Date(today.getFullYear() - 1, 0, 1);
            else if (start && !Number.isNaN(start.getTime())) anchor = new Date(start.getFullYear(), start.getMonth() + step, start.getDate());
            else return [];
            const dates = [];
            for (let guard = 0; guard < 400 && dates.length < 60; guard++) {
                dates.push(new Date(anchor));
                anchor = new Date(anchor.getFullYear(), anchor.getMonth() + step, anchor.getDate());
                if (dates.length > 2 && dates[dates.length - 3] > today) break;
            }
            const mat = inv.maturityDate ? new Date(inv.maturityDate) : null;
            const valid = dates.filter(d => !mat || d <= mat);
            const nextIdx = valid.findIndex(d => d >= today);
            if (nextIdx < 0) return [];
            const from = Math.max(0, nextIdx - 2);
            return valid.slice(from, from + 4).map((d, k) => {
                const days = Math.round((d - today) / 864e5);
                const isNext = from + k === nextIdx;
                return { key: d.toISOString(), label: this.shortDate(d), done: days < 0, next: isNext,
                         status: days < 0 ? 'Paid' : isNext ? (days === 0 ? 'Today' : `In ${days} day${days === 1 ? '' : 's'}`) : 'Due' };
            });
        },

        get detailScheme() {
            const i = this.detailHolding;
            if (!i) return null;
            const s = window.CorpusSchemes ? window.CorpusSchemes.match(i) : null;
            const sched = this.payoutSchedule(i);
            const next = sched.find(q => q.next) || null;
            const per = this.payoutAmount(i);
            const n = this.PAYOUTS_PER_YEAR[this.payoutWords(i)] || 0;
            const yearly = per * n || Math.round((Number(i.amount) || 0) * (Number(i.rate) || 0) / 100);
            const lockBase = s?.lockIn ? s.lockIn.split(' (')[0] : '';
            return { scheme: s, sched, next, per, yearly,
                     lock: lockBase ? `Locked in for ${lockBase}.` : '',
                     tax: s?.tax ? `${s.tax.split(/;\s*/).map(x => x.charAt(0).toUpperCase() + x.slice(1)).join('. ')}.` : '',
                     rateNote: s?.rateLocks && lockBase ? `fixed for ${lockBase}` : (s?.rateNote || ''),
                     extend: s?.lockIn && /extendable by/.test(s.lockIn) ? `can be extended by ${s.lockIn.replace(/^.*extendable by\s*([^)]*)\).*$/, '$1').replace(/(\d)$/, '$1 years')}` : '' };
        },

        // A deposit's tenure and interest, for the fixed deposit design.
        get detailDeposit() {
            const i = this.detailHolding;
            if (!i) return null;
            const amt = Number(i.amount) || 0, rate = Number(i.rate) || 0;
            const words = this.payoutWords(i), per = this.payoutAmount(i);
            const start = i.startDate ? new Date(i.startDate) : null, end = i.maturityDate ? new Date(i.maturityDate) : null;
            const years = start && end ? (end - start) / (365.25 * 864e5) : null;
            const accrued = start ? Math.round(amt * rate / 100 * Math.max(0, (Date.now() - start) / (365.25 * 864e5))) : 0;
            const earned = i.type === 'Recurring Deposit' ? Math.max(0, this.getInvCurrentValue(i) - amt)
                : Math.max(0, this.getInvCurrentValue(i) - amt) || accrued;
            const unit = { monthly: 'month', quarterly: 'quarter', 'twice a year': 'half year', yearly: 'year' }[words];
            return { p: this.depositProgress, amt, rate, earned,
                     perLabel: i.type === 'Recurring Deposit' ? 'Projected interest a year (not counted)' : unit ? `Interest each ${unit}` : 'Interest a year',
                     perValue: per || Math.round(amt * rate / 100),
                     tenure: years ? (Math.abs(years - Math.round(years)) < 0.1 ? `${Math.round(years)} year${Math.round(years) === 1 ? '' : 's'}` : `${Math.round(years * 12)} months`) : '',
                     issuer: i.issuer || String(i.name || '').split(/\s+(fixed|fd|bond)\b/i)[0] };
        },

        /* ── Add holding: seven approved sheets, one per asset type ───────── */
        ADD_KINDS: [
            [{ k: 'st', l: 'Stock' }, { k: 'mf', l: 'Mutual fund' }, { k: 'fd', l: 'FD' }, { k: 'rd', l: 'RD' }, { k: 'go', l: 'Gold ETF' }],
            [{ k: 'pm', l: 'Physical metal' }, { k: 'sc', l: 'Govt scheme' }, { k: 'epf', l: 'EPF/PPF' }, { k: 'bd', l: 'Bond' }],
        ],

        setAddKind(k, silent = false) {
            if (this.addKind === k) return;
            this.addKind = k;
            const f = this.newInv;
            const type = { st: 'Stock', mf: 'Mutual Fund', fd: 'Bank FD', rd: 'Recurring Deposit', go: 'ETF (IND)', pm: 'Physical Metal', sc: 'Government Scheme', epf: 'Government Scheme', bd: 'Bond' }[k];
            f.type = type;
            if (k === 'pm' && !f.name) f.name = 'Physical gold';
            f.currency = 'INR';
            f.ticker = ''; f.schemeCode = '';
            f.payout = { fd: 'Monthly', rd: 'Cumulative / On Maturity', sc: 'Quarterly', bd: 'Annual', epf: 'Cumulative / On Maturity' }[k] || f.payout;
            if (k === 'sc') this.pickScheme(f.schemeId || 'scss');
            if (k === 'epf') this.pickEpf(f.epfKind || 'PPF');
            if (k !== 'sc' && k !== 'epf' && (f.schemeId || /provident fund/i.test(f.name))) { f.name = ''; f.rate = ''; f.schemeId = ''; }
            if (this.symbolSearch) { this.symbolSearch.results = []; this.symbolSearch.error = ''; }
            this.mfSearchResults = [];
            if (!silent && window.RFMMotion?.Haptics) window.RFMMotion.Haptics.tap();
        },

        // ── Picker ────────────────────────────────────────────────────
        // One list chooser for the whole app, in its own design, so no field
        // ever opens Android's system select dialog or datalist popup.
        picker: { open: false, title: '', options: [], value: '', search: false, searchHint: '', q: '',
                  other: false, otherLabel: '', otherHint: '', otherText: '', onPick: null },

        openPicker(cfg) {
            Object.assign(this.picker, { search: false, searchHint: 'Search', other: false, otherLabel: '', otherHint: '',
                                         otherText: '', q: '', value: '', ...cfg, open: true });
            if (window.RFMMotion?.Haptics) window.RFMMotion.Haptics.tap();
        },

        closePicker() {
            this.picker.open = false;
            this.picker.onPick = null;
        },

        choosePick(v) {
            if (!v) return;
            const done = this.picker.onPick;
            this.closePicker();
            if (done) done(v);
        },

        get pickerOptions() {
            const q = (this.picker.q || '').trim().toLowerCase();
            const all = this.picker.options || [];
            return q ? all.filter(o => (o.label + ' ' + (o.meta || '')).toLowerCase().includes(q)) : all;
        },

        FD_BANKS: ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank',
                   'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'Union Bank of India',
                   'IDFC First Bank', 'Bajaj Finance', 'India Post'],

        openBankPicker() {
            this.openPicker({
                title: 'Bank', value: this.newInv.issuer || '', search: true, searchHint: 'Search banks',
                options: this.FD_BANKS.map(b => ({ value: b, label: b })),
                other: true, otherLabel: 'Another bank or lender', otherHint: 'Name as on the receipt',
                onPick: v => { this.newInv.issuer = v; this.newInv.name = v + ' Fixed Deposit'; },
            });
        },

        openSchemePicker() {
            this.openPicker({
                title: 'Scheme', value: this.newInv.schemeId,
                options: this.schemeChoices.map(s => ({ value: s.id, label: s.name,
                    meta: [s.rate ? `${s.rate}% a year` : '', s.payout ? `paid ${String(s.payout).split(/\s+[(—-]/)[0].toLowerCase()}` : ''].filter(Boolean).join(', ') })),
                onPick: v => this.pickScheme(v),
            });
        },

        // Schemes the Govt scheme sheet offers; EPF, PPF and gold bonds have sheets of their own.
        get schemeChoices() {
            const all = window.CorpusSchemes ? window.CorpusSchemes.SCHEMES : [];
            return all.filter(x => !['epf', 'ppf', 'sgb', 'posb'].includes(x.id));
        },

        pickScheme(id) {
            const sc = this.schemeChoices.find(x => x.id === id) || this.schemeChoices[0];
            if (!sc) return;
            const f = this.newInv;
            f.schemeId = sc.id;
            f.name = sc.name;
            f.issuer = /post office|senior citizen|monthly income|kisan|national savings|time deposit|recurring/i.test(sc.name) ? 'India Post' : 'Government of India';
            if (sc.rate) f.rate = sc.rate;
            const pay = String(sc.payout || '').toLowerCase();
            f.payout = /month/.test(pay) ? 'Monthly' : /quarter/.test(pay) ? 'Quarterly' : 'Cumulative / On Maturity';
        },

        pickEpf(kind) {
            const f = this.newInv;
            f.epfKind = kind;
            const sc = window.CorpusSchemes ? window.CorpusSchemes.SCHEMES.find(x => x.id === (kind === 'EPF' ? 'epf' : 'ppf')) : null;
            if (sc?.rate) f.rate = sc.rate;
        },

        get schemeRateNote() {
            const st = window.CorpusSchemes ? window.CorpusSchemes.status() : null;
            if (!st) return '';
            const q = String(st.quarter).replace('\u2013', ' to ').replace(/[\u2013-]/g, ' to ').replace(/July/, 'Jul').replace(/September/, 'Sep');
            return st.current ? `Current rate for ${q}` : `Rate for ${q}. It may have changed, so check it.`;
        },

        get epfRateNote() {
            if (this.newInv.epfKind === 'EPF') return 'EPF rate for FY 2025-26, declared once a year.';
            const st = window.CorpusSchemes ? window.CorpusSchemes.status() : null;
            const q = st ? String(st.quarter).replace(/[\u2013-]/g, ' to ').replace(/July/, 'Jul').replace(/September/, 'Sep') : '';
            return `Current PPF rate${q ? ` for ${q}` : ''}. Interest is added once a year, on 31 Mar.`;
        },

        // The payout seg on the FD, scheme and bond sheets.
        payoutOptions(kind) {
            return kind === 'bd'
                ? [{ v: 'Annual', l: 'Yearly' }, { v: 'Half-yearly', l: 'Half-yearly' }, { v: 'Cumulative / On Maturity', l: 'At maturity' }]
                : [{ v: 'Monthly', l: 'Monthly' }, { v: 'Quarterly', l: 'Quarterly' }, { v: 'Cumulative / On Maturity', l: 'At maturity' }];
        },

        // "You will receive, every quarter ₹20,500" (M9). At maturity, the total instead.
        get addPayout() {
            const f = this.newInv, words = this.payoutWords(f);
            const amt = Number(f.amount) || 0, rate = Number(f.rate) || 0;
            if (!amt || !rate) return null;
            if (words === 'at maturity') {
                const start = f.startDate ? new Date(f.startDate) : new Date(), end = f.maturityDate ? new Date(f.maturityDate) : null;
                if (!end || end <= start) return null;
                const years = (end - start) / (365.25 * 864e5);
                return { label: 'You will receive, at maturity', fig: this.formatCurrency(amt * Math.pow(1 + rate / 100 / 4, 4 * years)) };
            }
            const per = this.payoutAmount(f);
            const unit = { monthly: 'month', quarterly: 'quarter', 'twice a year': 'half year', yearly: 'year' }[words];
            return per && unit ? { label: `You will receive, every ${unit}`, fig: this.formatCurrency(per) } : null;
        },

        // "You invested ₹47,200. Worth today ₹49,320"
        get addSummary() {
            const f = this.newInv;
            const units = Number(f.units) || 0, avg = Number(f.buyPrice) || 0;
            if (!units || !avg) return null;
            const fx = f.currency === 'USD' ? this.fxUsdInr : 1;
            const invested = units * avg * fx;
            const price = Number(f.currentPrice) || 0;
            return price ? { lead: `You invested ${this.formatCurrency(invested)}. Worth today`, fig: this.formatCurrency(units * price * fx) }
                         : { lead: 'You invested', fig: this.formatCurrency(invested) };
        },

        // A price of zero is an error; a blank price means "use the market price".
        get editPriceInvalid() {
            const v = this.editForm?.currentPrice;
            return this.isUnitPriced(this.editForm?.type) && v !== '' && v !== null && v !== undefined && !(Number(v) > 0);
        },

        get editSub() {
            const i = this.editForm;
            if (!i || !i.type) return '';
            const c = this._chipOf(i);
            if (c === 'equity') {
                const us = this._marketBand(i) === 'US';
                const t = String(i.ticker || '').toUpperCase().replace(/\.(NS|BO)$/, '');
                const kind = (i.type || '').includes('ETF') ? 'ETF' : 'stock';
                const where = this.detailHolding && this.detailHolding.id === i.id ? this.detailSub : (t ? `${t} on ${us ? 'a US exchange' : 'NSE'}` : '');
                return `${where ? where + ', ' : ''}${us ? 'a US' : 'an Indian'} ${kind}.`;
            }
            return { mf: 'A mutual fund.', gold: 'Gold.', deposits: 'A fixed deposit.', schemes: 'A government scheme.', bonds: 'A bond.' }[c] || 'Something you own.';
        },

        /* ── Planning v4.1 ─────────────────────────────────────────────── */
        get planFlow() {
            const inc = this.totalIncome, out = this.totalExpense, max = Math.max(inc, out, 1);
            const gap = inc - out;
            const src = ((this.cashflow || {}).incomes || []).filter(i => Number(i.amount) > 0)
                .sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 3)
                .map(i => ({ id: i.id, name: i.name || 'Income', value: this.formatCurrency(i.amount) }));
            return { inc, out, inPct: (inc / max) * 100, outPct: (out / max) * 100, gap, src,
                     tag: { up: gap >= 0, label: `${gap >= 0 ? '↑' : '↓'} ${this.formatCurrency(Math.abs(gap))} a month` },
                     word: gap >= 0 ? 'left over' : 'shortfall' };
        },

        // "Fully funded, enough for 6 months" (M15).
        get planBuffer() {
            const monthly = Number(this.emergency.efMonthly) || 0, have = Number(this.emergency.efCurrent) || 0;
            if (!monthly) return { state: 'unset', icon: 'info', flag: 'Not sized yet', have, text: 'Set what a month of essentials costs you.' };
            const months = have / monthly;
            const m = months >= 10 ? Math.round(months) : Math.round(months * 10) / 10;
            const full = have >= this.efRequired && this.efRequired > 0;
            return { state: full ? 'full' : 'short', icon: full ? 'check_circle' : 'warning', flag: full ? 'Fully funded' : 'Short', have,
                     text: ` set aside, enough for ${m} month${m === 1 ? '' : 's'} of spending.` };
        },

        // Payouts, maturities and the PPF deposit, in date order (M6, M7).
        get planComingUp() {
            const out = [], today = new Date(); today.setHours(0, 0, 0, 0);
            for (const inv of (this.investments || [])) {
                const per = this.payoutAmount(inv);
                if (!per) continue;
                const next = this.payoutSchedule(inv).find(q => q.next);
                if (!next) continue;
                const d = new Date(next.key);
                if ((d - today) / 864e5 > 60) continue;
                const short = /scss|senior citizen/i.test(inv.name) ? 'SCSS' : /monthly income|mis|pomis/i.test(inv.name) ? 'Post Office MIS' : inv.name;
                out.push({ id: 'p' + inv.id, icon: 'payments', title: `${short} payout`, when: next.label, sort: +d, tag: `↑ ${this.formatCurrency(per)}` });
            }
            for (const inv of (this.maturingInvestments || [])) {
                const d = new Date(inv.maturityDate), days = (d - today) / 864e5;
                if (days < 0 || days > 120) continue;
                const short = String(inv.name).replace(/\s*Fixed Deposit$/i, ' FD');
                out.push({ id: 'm' + inv.id, icon: 'savings', title: `${short} matures`, when: this.shortDate(d), sort: +d,
                           value: this.formatCurrency(this.getInvCurrentValue(inv)), link: true });
            }
            if ((this.investments || []).some(i => /ppf|public provident/i.test(i.name || ''))) {
                const y = today.getMonth() > 2 ? today.getFullYear() + 1 : today.getFullYear();
                const d = new Date(y, 2, 31);
                out.push({ id: 'ppf', icon: 'event', title: 'PPF deposit due', when: '31 Mar', sort: +d, note: 'Before year end' });
            }
            return out.sort((a, b) => a.sort - b.sort).slice(0, 4);
        },

        /* ── Income and spending v4 ─────────────────────────────────────── */
        editingFlow: null,   // the id of the income or expense row open for editing

        FLOW_ICONS: [
            { re: /scss|senior citizen|scheme|payout/i, icon: 'payments' },
            { re: /mis|post office|pomis/i, icon: 'mail' },
            { re: /fd|deposit|interest|bond/i, icon: 'savings' },
            { re: /pension/i, icon: 'elderly' },
            { re: /salary|wage|consult|business/i, icon: 'work' },
            { re: /rent/i, icon: 'real_estate_agent' },
            { re: /house|home|grocer|food|kitchen/i, icon: 'home' },
            { re: /help|maid|driver|cook|staff/i, icon: 'person' },
            { re: /medic|health|doctor|hospital|pharma/i, icon: 'medication' },
            { re: /electric|water|power|bill|gas|phone|internet/i, icon: 'bolt' },
            { re: /travel|car|fuel|transport/i, icon: 'directions_car' },
            { re: /insur/i, icon: 'shield' },
        ],

        flowIcon(name) {
            const hit = this.FLOW_ICONS.find(x => x.re.test(name || ''));
            return hit ? hit.icon : 'more_horiz';
        },

        get expenseRowsTotal() {
            return ((this.cashflow || {}).expenses || []).reduce((a, e) => a + (Number(e.amount) || 0), 0);
        },

        get flowGap() {
            const gap = this.totalIncome - this.totalExpense;
            return { up: gap >= 0, label: `${gap >= 0 ? '↑' : '↓'} ${this.formatCurrency(Math.abs(gap))}`,
                     word: gap >= 0 ? 'left over each month' : 'short each month',
                     spoken: `${gap >= 0 ? 'Left over' : 'Shortfall of'} ${this.formatIndianSpoken(Math.abs(gap))}` };
        },

        addFlow(kind) {
            if (kind === 'income') this.addIncomeStream('', 0); else this.addExpenseItem('', 0);
            const list = kind === 'income' ? this.cashflow.incomes : this.cashflow.expenses;
            this.editingFlow = list[list.length - 1].id;
            this.$nextTick(() => { const el = document.getElementById('flow-name-' + this.editingFlow); if (el) el.focus(); });
        },

        closeFlow(kind, item) {
            if (item && !String(item.name || '').trim() && !(Number(item.amount) > 0)) {
                if (kind === 'income') this.deleteIncomeStream(item.id); else this.deleteExpenseItem(item.id);
            } else this.saveData();
            this.editingFlow = null;
        },

        removeFlow(kind, id) {
            if (kind === 'income') this.deleteIncomeStream(id); else this.deleteExpenseItem(id);
            this.editingFlow = null;
        },

        sipIcon(sip) {
            return (/ppf|rd|recurring|deposit/i.test(`${sip.type} ${sip.name}`) ? { icon: 'calendar_month' } : { icon: 'pie_chart' }).icon;
        },

        sipLine(sip) {
            const d = this.sipDaysUntil(sip);
            const when = d === null ? '' : d === 0 ? ', today' : d <= 20 ? `, in ${d} day${d === 1 ? '' : 's'}` : '';
            return `The ${this.ordinal(sip.dayOfMonth)} of every month${when}`;
        },

        /* ── Goals v4 ───────────────────────────────────────────────────── */
        GOAL_ICONS: {
            'Emergency Fund': { icon: 'health_and_safety' }, 'Retirement': { icon: 'elderly' }, 'House': { icon: 'home' },
            'Education': { icon: 'school' }, 'Travel': { icon: 'flight' }, 'New Car': { icon: 'directions_car' }, 'Other': { icon: 'flag' },
        },

        goalIcon(g) {
            const byType = this.GOAL_ICONS[g.type];
            if (byType && g.type !== 'Other') return byType.icon;
            const n = (g.name || '').toLowerCase();
            const hit = [[/school|college|educat|study/, { icon: 'school' }], [/car|bike|scooter/, { icon: 'directions_car' }],
                         [/trip|travel|yatra|holiday|tour|flight/, { icon: 'flight' }], [/house|home|flat|repair|renovat/, { icon: 'home' }],
                         [/wedding|marriage/, { icon: 'favorite' }], [/medical|health|surgery/, { icon: 'health_and_safety' }]]
                        .find(([re]) => re.test(n));
            return hit ? hit[1].icon : 'flag';
        },

        get goalsView() {
            const all = this.goalsProgress;
            const open = all.filter(g => g.pct < 100);
            const done = all.filter(g => g.pct >= 100);
            const dated = open.filter(g => g.targetDate).sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate));
            const featured = dated[0] || open[0] || null;
            return { featured, others: open.filter(g => g !== featured), done };
        },

        goalWhen(g, long = false) {
            if (!g.targetDate) return 'No date set';
            const d = new Date(g.targetDate);
            return long ? `By ${this.MONTHS[d.getMonth()]} ${d.getFullYear()}` : `By ${d.getFullYear()}`;
        },

        /* ── Emergency fund v4 ─────────────────────────────────────────── */
        get efView() {
            const monthly = Number(this.emergency.efMonthly) || 0, want = Math.max(1, Number(this.emergency.efMonths) || 6);
            const have = Number(this.emergency.efCurrent) || 0;
            const months = monthly ? have / monthly : 0;
            const m = months >= 10 ? Math.round(months) : Math.round(months * 10) / 10;
            const target = this.efRequired, diff = have - target;
            return {
                monthly, want, have, target,
                sized: monthly > 0,
                full: monthly > 0 && have >= target,
                covered: Math.min(want, Math.floor(months)),
                pips: Array.from({ length: Math.min(want, 12) }, (_, i) => i < Math.min(want, Math.floor(months))),
                enough: monthly ? `set aside, enough for ${m} month${m === 1 ? '' : 's'}` : 'set aside so far',
                diffLabel: diff >= 0 ? 'Beyond target' : 'Still to go',
                diffTag: { up: diff >= 0, label: `${diff >= 0 ? '↑' : '↓'} ${this.formatCurrency(Math.abs(diff))}` },
                note: !monthly ? 'Set what a month of essentials costs to size the buffer.'
                    : diff > 0 ? 'The extra could earn more in a sweep FD. Keep this part where you can reach it.'
                    : diff < 0 ? `Setting aside ${this.formatCurrency(Math.ceil(-diff / 6 / 100) * 100)} a month closes the gap in six months.`
                    : 'Exactly on target.',
            };
        },

        stepEfMonths(d) {
            this.emergency.efMonths = Math.max(1, Math.min(24, (Number(this.emergency.efMonths) || 6) + d));
            this.saveData();
            if (window.RFMMotion?.Haptics) window.RFMMotion.Haptics.tap();
        },

        /* ── Assets and debts v4.1 ─────────────────────────────────────── */
        get assetsView() {
            const hold = this.holdingsTotal;
            const prop = (Number(this.networth.property) || 0) + (Number(this.networth.otherAsset) || 0);
            const cash = (Number(this.networth.bank) || 0) + (Number(this.networth.cash) || 0);
            const owed = this.totalLiabilities;
            const card = Number(this.networth.credit) || 0;
            return {
                hold, prop, cash, owed,
                owedWhat: owed === card ? 'owed on your card' : card > 0 ? 'owed on loans and cards' : 'owed on loans',
                split: [
                    { k: 'hold', label: 'Your holdings', v: hold, c: '#C0A04A', bar: 'linear-gradient(90deg,#9A7B2C,#C0A04A)' },
                    { k: 'prop', label: 'Property', v: prop, c: '#7F97C2', bar: '#7F97C2' },
                    { k: 'cash', label: 'Bank and cash', v: cash, c: '#A1A1AA', bar: '#A1A1AA' },
                ].filter(x => x.v > 0),
            };
        },

        /* ── Maturities v4.1 ───────────────────────────────────────────── */
        get maturityView() {
            const up = (this.maturingInvestments || []).filter(i => i.daysLeft >= 0);
            return { next: up[0] || null, later: up.slice(1) };
        },

        maturityLine(inv) {
            const rate = Number(inv.rate) || 0, pay = this.payoutWords(inv);
            const s = window.CorpusSchemes ? window.CorpusSchemes.match(inv) : null;
            const extra = s && /extendable/.test(s.lockIn || '') ? `can be extended by ${String(s.lockIn).replace(/^.*extendable by\s*([^)]*)\).*$/, '$1').replace(/(\d)$/, '$1 years')}`
                        : pay === 'at maturity' ? 'paid at maturity' : pay ? (/^(monthly|quarterly|yearly)$/.test(pay) ? `pays ${pay}` : `interest paid ${pay}`) : '';
            return [rate ? `${rate}% a year` : '', extra].filter(Boolean).join(', ');
        },

        renewSentence(inv) {
            if (!inv) return '';
            if (inv.type === 'Bank FD' || /fd|fixed deposit/i.test(inv.name || '')) {
                const who = inv.issuer || String(inv.name || '').split(/\s+(fixed|fd)/i)[0] || 'the bank';
                return `If you do nothing, ${who} renews it at the rate on that day.`;
            }
            return 'The money is paid back to your bank on that day.';
        },

        /* ── Tax v4 ────────────────────────────────────────────────────── */
        get taxView() {
            const o = this.oldRegimeTax.tax, n = this.newRegimeTax.tax, save = this.taxSavingByOptimalRegime;
            const best = o === n ? null : (o < n ? 'old' : 'new');
            let tag = null, words = '';
            if (o === 0 && n === 0) words = 'No tax due either way';
            else if (!best || save === 0) words = 'Both regimes cost the same';
            else { tag = `↑ ${this.formatCurrency(save)} saved`; words = `with the ${best} regime`; }
            return { o, n, best, tag, words };
        },

        get isSenior() {
            const age = Number(this.profile?.age);
            return Number.isFinite(age) && age > 0 ? age >= 60 : !!this.tax.seniorCitizen;
        },

        /* ── Insights v6 and its three states ──────────────────────────── */
        get insightsMode() {
            const r = this.regenWealth;
            if (r.loading) return 'inld';
            if (r.error && !this.readingErrorDismissed) return 'iner';
            return r.analysis ? 'in' : 'id';
        },
        readingErrorDismissed: false,
        readingDrawerOpen: false,
        readingRefreshing: false,

        runReading(force = false) {
            if (!this.hasAnalyzablePosition) return;
            this.readingErrorDismissed = false;
            this.readingRefreshing = true;
            setTimeout(() => { this.readingRefreshing = false; }, 800);
            this.runRegenWealthAnalysis(force);
        },

        get holdingCountWords() {
            const n = (this.investments || []).length;
            return `${n} holding${n === 1 ? '' : 's'}`;
        },

        // Which of the three designed steps the reading is on, from its own progress messages.
        get readingStep() {
            const m = String(this.regenWealth.progressMsg || '').toLowerCase();
            if (/analy|writing|model|reading the evidence/.test(m)) return 2;
            if (/research|price|news|rate|market|fund|gold|scheme|headline/.test(m)) return 1;
            return 0;
        },

        get readingUpdated() {
            const a = this.regenWealth.analysis;
            if (!a) return '';
            const t = a.timestamp ? new Date(a.timestamp) : null;
            const when = t && !Number.isNaN(t.getTime())
                ? (new Date().toDateString() === t.toDateString()
                    ? t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
                    : this.shortDate(t))
                : '';
            const cov = a.research?.coverage;
            const read = cov ? `${cov.studied} of ${cov.requested} holdings read` : '';
            return ['Updated ' + when, read].filter(x => x && x !== 'Updated ').join(', ');
        },

        get readingSources() {
            const a = this.regenWealth.analysis;
            const names = [...new Set((a?.newsSources || []).filter(x => x.count).map(x => String(x.source).split(/[(:]/)[0].trim()))].slice(0, 3);
            const read = names.length ? `Read from ${names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]}. ` : '';
            return `${read}Educational only, not investment advice. Anything acted on should go past a SEBI-registered adviser.`;
        },

        get lastReadingDate() {
            const t = this.regenWealth.analysis?.timestamp;
            return t ? this.shortDate(new Date(t)) : '';
        },

        get briefDate() {
            const at = Date.parse(this.daily.brief?.preparedAt || '') || Date.now();
            const d = new Date(at);
            return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${this.shortDate(d)}`;
        },

        verdictPill(v) {
            return { Buy: 'healthy', Keep: 'healthy', Hold: 'neutral', Review: 'review', Trim: 'review' }[v] || 'neutral';
        },

        /* ── Settings v4 ────────────────────────────────────────────────── */
        // "Retired. Wants steady income and safety, waits out a fall, paid monthly." (M12)
        /* One line per asset you hold, in your own answers: what it is for and
           when you need it. Two classes are spelled out; the rest are counted. */
        get profileSentence() {
            const p = this.profile || {};
            if (!p.completedAt) return 'Answer eleven questions so every reading is written for you.';
            if (p.version !== 2) return 'Corpus now asks per asset. Update your answers so each one is judged on its own terms.';
            const word = (field, v) => ((this.PROFILE_ASK[field] || {}).opts || []).find(o => o.v === v)?.t || '';
            const parts = (p.holdings || []).map(k => {
                const cls = this.PROFILE_CLASSES.find(c => c.k === k);
                const forWhat = (p.purpose[k] || []).map(v => word('purpose', v).toLowerCase()).join(' and ');
                const when = (p.horizon[k] || []).map(v => word('horizon', v).toLowerCase()).join(', ');
                return `${cls ? cls.t : k}${forWhat ? ' for ' + forWhat : ''}${when ? ', ' + when : ''}`;
            });
            const shown = parts.slice(0, 2).join('. ');
            return shown + (parts.length > 2 ? `. And ${parts.length - 2} more.` : '.');
        },

        get profileTitle() {
            const p = this.profile || {};
            const name = String(p.name || '').trim();
            if (!name) return 'About you';
            return p.age ? `${name}, ${p.age}` : name;
        },

        textSize: (function () { try { const v = localStorage.getItem('corpus_text'); return v === 'large' || v === 'small' ? v : 'standard'; } catch (e) { return 'standard'; } })(),

        setTextSize(v) {
            this.textSize = v;
            try { localStorage.setItem('corpus_text', v); } catch (e) {}
            if (window.RFMMotion?.Haptics) window.RFMMotion.Haptics.tap();
            // A new layout width only applies when the page is laid out again.
            try { sessionStorage.setItem('corpus_return', this.activePage); } catch (e) {}
            setTimeout(() => location.reload(), 120);
        },

        alertsOn: (function () { try { return localStorage.getItem('corpus_alerts_enabled') !== 'false'; } catch (e) { return true; } })(),

        toggleAlerts() {
            this.alertsOn = !this.alertsOn;
            try { localStorage.setItem('corpus_alerts_enabled', this.alertsOn ? 'true' : 'false'); } catch (e) {}
            if (this.alertsOn) this.scheduleMaturityAlerts().catch(() => {});
            else {
                const LN = window.AppPlugins?.LocalNotifications;
                if (LN) LN.getPending().then(r => r.notifications?.length && LN.cancel({ notifications: r.notifications })).catch(() => {});
            }
        },

        /* ── Notifications v4 ──────────────────────────────────────────── */
        notiSeen: (function () { try { return JSON.parse(localStorage.getItem('corpus_noti_seen') || '[]'); } catch (e) { return []; } })(),

        get notiView() {
            const needs = [], coming = [];
            for (const sip of this.dueSipDebits) {
                needs.push({ id: 'due' + sip.id + this.currentMonthKey, tone: 'due', icon: 'help', title: `Did your ${sip.name} go through?`,
                             meta: `${this.formatCurrency(sip.monthlyAmount)} was due on the ${this.ordinal(sip.dayOfMonth)}. Confirm it in Income and spending.`, page: 'income' });
            }
            if (this.portfolioFreshness.stale) {
                needs.push({ id: 'stale' + this.localDateKey(), tone: 'warn', icon: 'sync_problem', title: 'Prices need a refresh',
                             meta: `${this.syncedLabel.replace('Synced', 'Last synced')}. Open Holdings and pull down to refresh.`, page: 'investments' });
            }
            if (Number(this.efGap) > 0 && Number(this.emergency.efMonthly) > 0) {
                needs.push({ id: 'ef' + this.currentMonthKey, tone: 'warn', icon: 'savings', title: 'Emergency fund is short',
                             meta: `${this.formatCurrency(this.efGap)} below a ${this.emergency.efMonths}-month buffer.`, page: 'emergency' });
            }
            for (const inv of (this.maturingInvestments || [])) {
                if (inv.daysLeft < 0 || inv.daysLeft > 90) continue;
                coming.push({ id: 'm' + inv.id, icon: 'savings', sort: inv.daysLeft,
                              title: inv.daysLeft === 0 ? `${inv.name} matures today` : `${inv.name} matures in ${inv.daysLeft} day${inv.daysLeft === 1 ? '' : 's'}`,
                              meta: `${this.formatCurrency(this.getInvCurrentValue(inv))} on ${this.shortDate(inv.maturityDate)}. Decide where it goes.`, page: 'maturity' });
            }
            for (const e of this.planComingUp) {
                if (e.id.startsWith('m')) continue;
                const days = Math.round((e.sort - new Date().setHours(0, 0, 0, 0)) / 864e5);
                coming.push({ id: e.id, icon: e.id === 'ppf' ? 'event_repeat' : 'payments', sort: days,
                              title: e.id === 'ppf' ? 'PPF deposit due before 31 Mar' : `${e.title} in ${days} day${days === 1 ? '' : 's'}`,
                              meta: e.id === 'ppf' ? 'Deposit at least ₹500 this year to keep the account active.' : `${e.tag.replace('↑ ', '')} on ${e.when}.`,
                              page: e.id === 'ppf' ? 'investments' : 'cashflow' });
            }
            coming.sort((a, b) => a.sort - b.sort);
            const all = [...needs, ...coming];
            return { needs, coming, unseen: all.filter(n => !this.notiSeen.includes(n.id)).length };
        },

        markNotiSeen() {
            this.notiSeen = [...this.notiView.needs, ...this.notiView.coming].map(n => n.id);
            try { localStorage.setItem('corpus_noti_seen', JSON.stringify(this.notiSeen)); } catch (e) {}
        },

        /* ── Goal and recurring sheets ──────────────────────────────────── */
        GOAL_KINDS: [{ v: 'Retirement', l: 'Retirement' }, { v: 'House', l: 'House' }, { v: 'Education', l: 'Education' },
                     { v: 'Travel', l: 'Travel' }, { v: 'New Car', l: 'New car' }, { v: 'Emergency Fund', l: 'Emergency fund' }, { v: 'Other', l: 'Other' }],

        monthLabel(d) {
            if (!d) return 'Pick a month';
            const t = new Date(String(d).length === 7 ? `${d}-01T00:00:00` : d);
            return Number.isNaN(t.getTime()) ? 'Pick a month' : `${this.MONTHS[t.getMonth()]} ${t.getFullYear()}`;
        },

        // What to put aside each month to reach a goal by its date.
        goalNeed(g) {
            const target = Number(g?.target) || 0, have = Number(g?.current) || 0;
            if (!g?.targetDate || have >= target) return 0;
            const now = new Date(), end = new Date(g.targetDate);
            const months = Math.max(1, (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth()));
            return Math.ceil((target - have) / months / 100) * 100;
        },

        get editGoalPct() {
            const t = Number(this.editGoalForm?.target) || 0, c = Number(this.editGoalForm?.current) || 0;
            return t > 0 ? Math.min(100, Math.round((c / t) * 100)) : 0;
        },

        SIP_KINDS: ['SIP', 'RD', 'PPF', 'Other'],

        nextDebitLabel(sip) {
            if (!Number(sip?.dayOfMonth)) return '';
            const d = this._sipDaysToNext(sip);
            const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + d);
            return this.shortDate(t);
        },

        sipRecorded(sip) {
            const k = sip?.lastRecordedMonth;
            if (!k) return 'Not recorded yet. Corpus asks on each debit day.';
            const [y, m] = k.split('-').map(Number);
            const name = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
            return `Last recorded in ${name}${y !== new Date().getFullYear() ? ' ' + y : ''}.`;
        },

        stopSip(id) {
            const before = this.sips.length;
            this.deleteSip(id);
            if (this.sips.length < before) this.cancelSipEdit();
        },

        removeHolding(id) {
            const before = (this.investments || []).length;
            this.deleteInvestment(id);
            if ((this.investments || []).length < before) this.activePage = 'investments';
        }

    }));
});
