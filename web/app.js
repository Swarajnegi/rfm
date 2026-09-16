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
                if (next === 'home') this.$nextTick(() => this.renderNwChart());
                try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
            };
            if (window.RFMMotion) {
                window.RFMMotion.Haptics.tap();
                window.RFMMotion.transition(apply);
            } else {
                apply();
            }
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
            otherIncome:      0,    // Interest, rent, consulting, etc.
            deduction80C:     0,    // LIC, PPF, ELSS, NSC, home loan principal (max ₹1.5L)
            deduction80D:     0,    // Medical insurance premium (max ₹50K senior)
            deduction80TTA:   0,    // Savings account interest (max ₹10K, not for seniors)
            deduction80TTB:   0,    // Bank/PO/FD interest for seniors (max ₹50K)
            hra:              0,    // House Rent Allowance exemption
            homeLoanInterest: 0,    // Section 24 interest deduction (max ₹2L)
            otherDeductions:  0,    // Any other eligible deductions
            regime:          'compare', // 'old' | 'new' | 'compare'
            // Defaults to false. The app was built for a 60+ user, so this was seeded true;
            // for a general release most users are not, and a wrong value silently changes
            // the slabs and unlocks 80TTB. Existing users keep their saved setting.
            seniorCitizen:    false, // Age 60+ — different slabs & deductions apply
            capitalGainsOverride: null // Manual override for total capital gains tax
        },

        goals: [],

        // ── SIP & Recurring Investments (Phase 9) ───────────────────
        sips: [],
        addingSip: false,
        editingSip: null,
        editSipForm: {},

        // ── Investment Edit State (Deliverable 1) ───────────────────
        editingInv: null,
        editForm: {},
        addingInv: false,
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

        // ── Phase 11: Live NAV & Stock Price Ingestion ──────────────
        navFetchState: 'idle', // 'idle' | 'fetching' | 'done' | 'error'
        navFetchError: '',
        lastNavFetchTime: null,
        navFetchProgress: { completed: 0, total: 0, updated: 0, failed: 0 },
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

        // ── Phase 13: Universal AI Statement Classifier ──────────────
        aiClassifier: {
            enabled:    false,    // becomes true once apiKey is verified
            status:     'idle',   // 'idle' | 'classifying' | 'done' | 'error'
            error:      '',
            usedAI:     false,    // marks if last import result came from AI
            docType:    '',       // AI-detected document type
            confidence: '',       // AI-stated confidence
        },

        // ── Regenerative Wealth State ────────────────────────────────
        regenWealth: {
            apiKey:       '',
            provider:     'auto', // 'auto' | 'gemini' | 'openrouter' | 'openai'
            model:        'openai/gpt-4o-mini',
            customModel:  '',
            modelCatalog: [],
            modelCatalogState: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
            modelCatalogError: '',
            activeTab:    null,   // 'key' | 'settings' | null
            apiKeySet:    false,
            showKeyInput: false,
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
        // Worth confirming against the live rate when you next look at this.
        FX_FALLBACK_USD_INR: 88.0,
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
                    window.AppPlugins.CapacitorHttp.get({ url, readTimeout: timeoutMs, connectTimeout: timeoutMs }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), timeoutMs + 500))
                ]);
                if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
                return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
            }
            return this.fetchJsonWithTimeout(url, timeoutMs);
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
            });
            window.addEventListener('pagehide', () => this.recordVisit());
            if (!this._visit.at) setTimeout(() => this.recordVisit(), 4000);

            // First-run tutorial. Deferred past the first paint so it anchors to
            // laid-out elements rather than a half-built DOM.
            setTimeout(() => { try { window.RFMMotion && window.RFMMotion.startTour(false); } catch (e) {} }, 1200);
            // Phase 12: Schedule native alerts after data loads (fire-and-forget, non-blocking)
            this.scheduleMaturityAlerts();
            this.$watch('investments',  () => {
                this.saveData({ rescheduleAlerts: true });
                this.queueNwSnapshot('portfolio-change');
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
            this.$watch('sips',         () => this.saveData({ rescheduleAlerts: true }), { deep: true });
            // ITR checklist state (UI-only, not persisted)
            this.itrCheckState = {};

            // ── Regenerative Wealth: restore API key, provider & model settings ──
            const savedKey = localStorage.getItem('rfm_api_key') || localStorage.getItem('rfm_gemini_key');
            if (savedKey) {
                this.regenWealth.apiKey       = savedKey;
                this.regenWealth.apiKeySet    = true;
                this.regenWealth.provider     = localStorage.getItem('rfm_api_provider') || 'auto';
                this.regenWealth.model        = localStorage.getItem('rfm_api_model') || 'openai/gpt-4o-mini';
                this.regenWealth.customModel = localStorage.getItem('rfm_api_custom_model') || '';
            }
            const cached = window.RegenWealth?.loadCached(this.$data);
            if (cached) this.regenWealth.analysis = cached;

            // Mobile Pull-to-Refresh touch gesture listener initialization
            this.initPullToRefresh();

            // Record the opening valuation. Subsequent edits and quote syncs update it.
            setTimeout(() => {
                this.saveNwSnapshot({ source: 'app-open' });
                this.renderNwChart();
            }, 1500);
        },

        // ════════════════════════════════════════════════════════════
        //  NET WORTH HISTORY — Daily valuation snapshot engine
        // ════════════════════════════════════════════════════════════

        /** Store the latest truthful value for today; never invent historical points. */
        saveNwSnapshot({ source = 'valuation' } = {}) {
            try {
                const today = new Date().toISOString().slice(0, 10);
                const nw = this.netWorthTotal;
                if (!nw || nw <= 0) return;

                const raw = localStorage.getItem('rfm_nw_history');
                let history = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(history)) history = [];

                // Legacy weekly records remain valid observations. New records are daily.
                history = history.filter(point => point && point.date && Number.isFinite(Number(point.value)));
                const idx = history.findIndex(point => point.date === today);
                const point = {
                    date: today,
                    capturedAt: new Date().toISOString(),
                    value: Math.round(nw),
                    source
                };
                if (idx >= 0) history[idx] = point;
                else history.push(point);

                // Retain two years of daily values. All points are values the app observed.
                history = history.sort((a, b) => a.date.localeCompare(b.date)).slice(-730);
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
                this.nwHistory = raw ? JSON.parse(raw) : [];
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

        /** Active chart time range: '1M' | '3M' | '6M' | '1Y' | 'ALL' */
        nwChartRange: '1M',

        /** Get filtered history based on selected range */
        get nwChartData() {
            const all = this.nwHistory || [];
            if (!all.length) return [];
            const now = new Date();
            const cutoff = {
                '1M':  new Date(now.getFullYear(), now.getMonth() - 1,  now.getDate()),
                '3M':  new Date(now.getFullYear(), now.getMonth() - 3,  now.getDate()),
                '6M':  new Date(now.getFullYear(), now.getMonth() - 6,  now.getDate()),
                '1Y':  new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
                'ALL': new Date(0),
            }[this.nwChartRange] || new Date(0);
            return all.filter(p => new Date(p.date) >= cutoff);
        },

        get nwChartChangePct() {
            const points = this.nwChartData;
            if (points.length < 2 || !points[0].value) return null;
            return ((points[points.length - 1].value - points[0].value) / points[0].value) * 100;
        },

        get nwChartChangeLabel() {
            const change = this.nwChartChangePct;
            if (change === null || !Number.isFinite(change)) return 'Tracking';
            return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
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
            const el = document.getElementById('nwChart');
            if (!el || !window.LW) return;

            // Lightweight Charts measures its container. Inside an x-show'd page
            // that is display:none the measurement is 0x0 and the chart renders
            // blank with no error, so defer until the element actually has a box.
            if (!el.clientWidth) {
                if (!this._nwChartRetry) {
                    this._nwChartRetry = true;
                    this.$nextTick(() => { this._nwChartRetry = false; this.renderNwChart(); });
                }
                return;
            }

            this.loadNwHistory();

            let data = [...(this.nwChartData.length ? this.nwChartData : this.nwHistory)];
            if (data.length === 0) {
                data = [{ date: new Date().toISOString().slice(0, 10), value: Math.round(this.netWorthTotal) }];
            }

            // The series must be ascending and unique on time, or the library throws.
            const byDate = new Map();
            for (const p of data) {
                const t = String(p.date).slice(0, 10);
                if (t) byDate.set(t, Number(p.value) || 0);
            }
            const points = [...byDate.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)
                                                .map(([time, value]) => ({ time, value }));

            const rising = points.length < 2 || points[points.length - 1].value >= points[0].value;
            const stroke = rising ? this._token('--jade', '#1F6B52') : this._token('--carnelian', '#A33B2A');
            const ink    = this._token('--ink-faint', '#74857D');

            if (window._rfmNwChart) { window._rfmNwChart.remove(); window._rfmNwChart = null; }

            const chart = window.LW.createChart(el, {
                width: el.clientWidth,
                height: el.clientHeight || 140,
                layout: { background: { color: 'transparent' }, textColor: ink, attributionLogo: false },
                grid: { vertLines: { visible: false }, horzLines: { visible: false } },
                rightPriceScale: { visible: false },
                leftPriceScale: { visible: false },
                timeScale: { visible: false, fixLeftEdge: true, fixRightEdge: true },
                handleScroll: false,
                handleScale: false,
                crosshair: {
                    vertLine: { color: stroke, width: 1, style: 3, labelVisible: false },
                    horzLine: { visible: false, labelVisible: false },
                },
                localization: { priceFormatter: (v) => this.formatIndianShort(v) },
            });

            const single = points.length === 1;
            const series = chart.addSeries(window.LW.AreaSeries, {
                lineColor: single ? 'rgba(0,0,0,0)' : stroke,
                lineWidth: single ? 0 : 2,
                topColor: single ? 'rgba(0,0,0,0)' : `color-mix(in srgb, ${stroke} 26%, transparent)`,
                bottomColor: 'rgba(0,0,0,0)',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerRadius: 4,
                crosshairMarkerBorderColor: stroke,
                crosshairMarkerBackgroundColor: stroke,
            });
            series.setData(points);
            chart.timeScale().fitContent();

            // A single observation is a point, not a fabricated flat line.
            if (single) {
                window.LW.createSeriesMarkers(series, [
                    { time: points[0].time, position: 'inBar', color: stroke, shape: 'circle' }
                ]);
            }

            window._rfmNwChart = chart;

            if (this._nwResizeBound) window.removeEventListener('resize', this._nwResizeBound);
            this._nwResizeBound = () => {
                if (window._rfmNwChart && el.clientWidth) {
                    window._rfmNwChart.applyOptions({ width: el.clientWidth });
                }
            };
            window.addEventListener('resize', this._nwResizeBound);
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

            let isPrompting = false;
            let isAuthenticated = false;
            // A failed or cancelled prompt used to re-fire every 500ms forever, with no exit
            // but force-closing the app. Attempts are capped and backed off; after the cap
            // the loop stops and biometricBlocked lets the UI offer a deliberate retry.
            let attempts = 0;
            const MAX_ATTEMPTS = 5;

            const enforceBiometric = async () => {
                if (isPrompting || isAuthenticated) return;
                isPrompting = true;

                try {
                    const result = await NativeBiometric.isAvailable();
                    if (result.isAvailable) {
                        await NativeBiometric.verifyIdentity({
                            reason: "Authenticate to access RFM",
                            title: "RFM Secure Login",
                            subtitle: "Confirm your fingerprint or face ID",
                            description: "Touch the sensor to continue",
                            negativeButtonText: "Cancel"
                        });
                        isAuthenticated = true;
                        attempts = 0;
                        this.biometricBlocked = false;
                    }
                } catch (e) {
                    console.error("Biometric authentication error:", e);
                    isPrompting = false;
                    isAuthenticated = false;
                    attempts += 1;

                    if (attempts >= MAX_ATTEMPTS) {
                        this.biometricBlocked = true;
                        return;
                    }

                    // Back off so a repeatedly-failing sensor cannot spin the UI.
                    setTimeout(() => { enforceBiometric(); }, 500 * Math.pow(2, attempts - 1));
                    return;
                }
                isPrompting = false;
            };

            // Retry deliberately, from a button, after the cap is hit.
            this.retryBiometric = () => {
                attempts = 0;
                this.biometricBlocked = false;
                enforceBiometric();
            };

            // Lock on cold start
            await enforceBiometric();

            // Lock on resume when returning from background
            App.addListener('appStateChange', ({ isActive }) => {
                if (this.isSelectingFile) {
                    if (isActive) {
                        setTimeout(() => { this.isSelectingFile = false; }, 2000);
                    }
                    return;
                }
                if (!isActive) {
                    isAuthenticated = false;
                } else if (isActive && !isAuthenticated && !isPrompting) {
                    // Returning to the app is an intentional act, so it earns a fresh
                    // set of attempts even if a previous run hit the cap.
                    attempts = 0;
                    this.biometricBlocked = false;
                    enforceBiometric();
                }
            });
        },

        // ════════════════════════════════════════════════════════════
        //  PULL-TO-REFRESH MOBILE SWIPE GESTURE ENGINE
        // ════════════════════════════════════════════════════════════
        initPullToRefresh() {
            let startY = 0;
            let isTracking = false;

            window.addEventListener('touchstart', (e) => {
                if (window.scrollY <= 0 && e.touches.length === 1) {
                    startY = e.touches[0].clientY;
                    isTracking = true;
                }
            }, { passive: true });

            window.addEventListener('touchmove', (e) => {
                if (!isTracking || this.pullToRefresh.isRefreshing) return;

                const currentY = e.touches[0].clientY;
                const diffY = currentY - startY;

                if (diffY > 0 && window.scrollY <= 0) {
                    // Damped physical resistance calculation
                    const damped = Math.min(Math.pow(diffY, 0.82) * 2.2, 110);
                    this.pullToRefresh.distance = damped;

                    // Haptic tactile feedback threshold at 70px pull
                    if (damped >= 70 && !this.pullToRefresh.thresholdReached) {
                        this.pullToRefresh.thresholdReached = true;
                        if (navigator.vibrate) {
                            try { navigator.vibrate(30); } catch (err) {}
                        }
                    } else if (damped < 70) {
                        this.pullToRefresh.thresholdReached = false;
                    }
                } else {
                    this.pullToRefresh.distance = 0;
                }
            }, { passive: true });

            const handleTouchEnd = async () => {
                if (!isTracking) return;
                isTracking = false;

                if (this.pullToRefresh.distance >= 70 && !this.pullToRefresh.isRefreshing) {
                    await this.triggerPullRefresh();
                } else {
                    this.pullToRefresh.distance = 0;
                    this.pullToRefresh.thresholdReached = false;
                }
            };

            window.addEventListener('touchend', handleTouchEnd, { passive: true });
            window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
        },

        async triggerPullRefresh() {
            this.pullToRefresh.isRefreshing = true;
            this.pullToRefresh.distance = 56;

            try {
                // 1. Refresh live Mutual Fund & Stock prices
                if (typeof this.fetchLivePrices === 'function') {
                    await this.fetchLivePrices();
                }

                // 2. Refresh native notifications schedule
                if (typeof this.scheduleMaturityAlerts === 'function') {
                    await this.scheduleMaturityAlerts();
                }

                // 3. Persist state
                this.saveData();

                // 4. Brief success state display
                this.pullToRefresh.completed = true;
                await new Promise(r => setTimeout(r, 600));

            } catch (err) {
                console.warn('Pull-to-refresh execution error:', err);
            } finally {
                this.pullToRefresh.distance = 0;
                this.pullToRefresh.isRefreshing = false;
                this.pullToRefresh.completed = false;
                this.pullToRefresh.thresholdReached = false;
            }
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
                    this.investments = p.investments || [];
                    this.goals       = p.goals       || [];
                    this.sips        = p.sips        || [];
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

                    this.networth  = { ...this.networth,  ...(p.networth  || {}) };
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
                this.checkSipDebits();
                return;
            }

            // A new user starts with an empty, explicit portfolio rather than another user's demo data.
            this.saveData();
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
                lastNavFetchTime: this.lastNavFetchTime
            }));
            // Notification work is native and expensive. Only holdings/SIP changes need it.
            if (rescheduleAlerts) {
                clearTimeout(this._alertDebounce);
                this._alertDebounce = setTimeout(() => this.scheduleMaturityAlerts(), 2000);
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
                id: 'inc_' + Date.now(),
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
                id: 'exp_' + Date.now(),
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
            const cc = Number(this.networth?.creditCard) || Number(this.networth?.credit) || 0;
            const od = Number(this.networth?.otherLiability) || Number(this.networth?.otherDebt) || 0;
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
                const rate = Number(inv.rate ?? inv.interestRate);
                if (!Number.isFinite(principal) || !Number.isFinite(rate)) return sum;
                return sum + (principal * rate / 100);
            }, 0);
        },

        // Total gross annual income for tax purposes
        get grossAnnualIncome() {
            return this.annualPension
                 + this.annualInterestIncome
                 + Number(this.tax.otherIncome);
        },

        get totalInterestIncome() { return this.annualInterestIncome; },
        
        // ── CAPITAL GAINS ENGINE (Phase 6) ───────────────────────────
        // FY 2024-25 Rules:
        // - Equity LTCG (>12m): 12.5% tax on gains exceeding ₹1.25L exemption
        // - Equity STCG (≤12m): 20% tax on full gains
        // - Debt LTCG/STCG: Taxed at slab rate
        get equityLTCG() {
            let totalGains = 0;
            const today = new Date();

            (this.investments || []).forEach(inv => {
                const isEquity = ['Stock', 'Mutual Fund', 'ETF'].includes(inv.type) || inv.assetClass === 'equity';
                if (!isEquity) return;

                let isLongTerm = true;
                if (inv.purchaseDate) {
                    const buyDate = new Date(inv.purchaseDate);
                    const days = (today - buyDate) / (1000 * 60 * 60 * 24);
                    isLongTerm = days > 365;
                }

                if (isLongTerm) {
                    const buyCost = (Number(inv.buyPrice) * Number(inv.units)) || Number(inv.amount);
                    const currentVal = Number(inv.currentValue) || Number(inv.amount);
                    const gain = Math.max(0, currentVal - buyCost);
                    totalGains += gain;
                }
            });

            const exemptionLimit = 125000;
            const exemptionUsed = Math.min(totalGains, exemptionLimit);
            const taxableGains = Math.max(0, totalGains - exemptionLimit);
            const tax = Math.round(taxableGains * 0.125 * 1.04); // 12.5% + 4% cess

            return { totalGains, exemptionUsed, taxableGains, tax };
        },

        get equitySTCG() {
            let totalGains = 0;
            const today = new Date();

            (this.investments || []).forEach(inv => {
                const isEquity = ['Stock', 'Mutual Fund', 'ETF'].includes(inv.type) || inv.assetClass === 'equity';
                if (!isEquity) return;

                let isShortTerm = false;
                if (inv.purchaseDate) {
                    const buyDate = new Date(inv.purchaseDate);
                    const days = (today - buyDate) / (1000 * 60 * 60 * 24);
                    isShortTerm = days <= 365;
                }

                if (isShortTerm) {
                    const buyCost = (Number(inv.buyPrice) * Number(inv.units)) || Number(inv.amount);
                    const currentVal = Number(inv.currentValue) || Number(inv.amount);
                    const gain = Math.max(0, currentVal - buyCost);
                    totalGains += gain;
                }
            });

            const tax = Math.round(totalGains * 0.20 * 1.04); // 20% + 4% cess

            return { totalGains, tax };
        },

        get debtCapitalGains() {
            let totalGains = 0;
            (this.investments || []).forEach(inv => {
                const isDebt = ['Bank FD', 'Bond', 'RBI Bond', 'Post Office', 'Government Scheme'].includes(inv.type) || inv.assetClass === 'debt';
                if (!isDebt) return;
                const buyCost = Number(inv.amount);
                const currentVal = Number(inv.currentValue) || Number(inv.amount);
                const gain = Math.max(0, currentVal - buyCost);
                totalGains += gain;
            });
            return { totalGains };
        },

        get totalCapitalGainsTax() {
            if (this.tax.capitalGainsOverride !== null && this.tax.capitalGainsOverride !== undefined && this.tax.capitalGainsOverride !== '') {
                return Number(this.tax.capitalGainsOverride);
            }
            return (this.equityLTCG?.tax || 0) + (this.equitySTCG?.tax || 0);
        },

        get totalTds() { return 0; },

        get netTaxPayable() {
            const incomeTax = Math.min(this.oldRegimeTax.tax, this.newRegimeTax.tax);
            return Math.max(0, incomeTax + this.totalCapitalGainsTax - this.totalTds);
        },

        // ── OLD REGIME CALCULATION ───────────────────────────────────
        // Old Regime: Standard deduction ₹50K for pension, then all applicable deductions.
        // Senior Citizen (60–79): No tax up to ₹3L, 5% on 3L-5L, 20% on 5L-10L, 30% above 10L
        // Super Senior Citizen (80+): No tax up to ₹5L
        get oldRegimeTax() {
            const gross = this.grossAnnualIncome;
            // Standard deduction: ₹50,000 for pension income
            const stdDeduction = Math.min(50000, gross);
            // Section 80C
            const ded80C  = Math.min(Number(this.tax.deduction80C),  150000);
            // Section 80D — Senior citizen premium limit ₹50K, self + parents max ₹1L
            const ded80D  = Math.min(Number(this.tax.deduction80D),  50000);
            // Section 80TTB (seniors) — interest income deduction up to ₹50K
            const ded80TTB = Math.min(Number(this.tax.deduction80TTB), 50000);
            // Section 24 — Home loan interest (max ₹2L)
            const dedHomeLoan = Math.min(Number(this.tax.homeLoanInterest), 200000);
            // HRA
            const dedHRA  = Number(this.tax.hra);
            // Other
            const dedOther = Number(this.tax.otherDeductions);

            const totalDeductions = stdDeduction + ded80C + ded80D + ded80TTB + dedHomeLoan + dedHRA + dedOther;
            const taxableIncome   = Math.max(0, gross - totalDeductions);

            // Senior Citizen slabs (FY 2024-25 / AY 2025-26)
            let tax = 0;
            if (taxableIncome <= 300000) {
                tax = 0;
            } else if (taxableIncome <= 500000) {
                tax = (taxableIncome - 300000) * 0.05;
            } else if (taxableIncome <= 1000000) {
                tax = 10000 + (taxableIncome - 500000) * 0.20;
            } else {
                tax = 110000 + (taxableIncome - 1000000) * 0.30;
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
                    stdDeduction, ded80C, ded80D, ded80TTB,
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
            const stdDeduction = Math.min(75000, gross); // New regime standard deduction
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

        theme: (function () {
            try { return localStorage.getItem('rfm_theme') || 'system'; } catch (e) { return 'system'; }
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
            { id: 'portfolio', label: 'Holdings',  icon: 'donut_small',              root: 'investments', views: ['investments','maturity','import'] },
            { id: 'planning',  label: 'Planning',  icon: 'calendar_month',           root: 'cashflow',    views: ['cashflow','income','pension','emergency','goals','networth','tax'] },
            { id: 'insights',  label: 'Insights',  icon: 'auto_awesome',             root: 'regen',       views: ['regen','more'] },
        ],

        get surface() {
            const p = this.activePage;
            const hit = this.SURFACES.find(s => s.views.includes(p));
            return hit ? hit.id : 'home';
        },

        /* One line describing how fresh the WHOLE portfolio is. The hero states
           it directly rather than making the user open each holding to find out,
           and it names the worst case — a portfolio is only as current as its
           stalest quote. */
        get portfolioFreshness() {
            const priced = (this.investments || []).filter(i => i.priceAsOf);
            if (!priced.length) return { stale: false, label: 'Not synced yet' };
            const states = priced.map(i => this.priceFreshness(i));
            const stale = states.filter(s => s.state === 'stale').length;
            const close = states.filter(s => s.state === 'close').length;
            if (stale) return { stale: true, label: `${stale} holding${stale > 1 ? 's' : ''} not refreshed today` };
            const newest = priced.map(i => new Date(i.priceAsOf).getTime()).sort((a, b) => b - a)[0];
            const t = new Date(newest).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
            return { stale: false, label: close ? `Valued ${t} · ${close} at closing price` : `Verified ${t}` };
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
        get allocationRows() {
            const total = this.totalAssets || 0;
            const defs = [
                { key: 'equity', label: 'Stocks',        filter: 'equity', value: this.totalStockValuation, pnlPct: this.totalStockPnLPct },
                { key: 'mf',     label: 'Mutual funds',  filter: 'mf',     value: this.totalMfValuation,    pnlPct: this.totalMfPnLPct },
                { key: 'gold',   label: 'Gold',          filter: 'gold',   value: this.totalGoldValuation,  pnlPct: this.totalGoldPnLPct },
                { key: 'debt',   label: 'Deposits and bonds', filter: 'debt', page: 'investments',
                  value: (this.debtAndEpfList || []).reduce((a, i) => a + this.getInvCurrentValue(i), 0), pnlPct: null },
                { key: 'cash',   label: 'Cash and bank',   page: 'networth', filter: 'all',
                  value: (Number(this.networth.bankBalance) || 0) + (Number(this.networth.cashOnHand) || 0), pnlPct: null },
            ];
            return defs
                .filter(d => Number(d.value) > 0)
                .map(d => ({ ...d, value: Number(d.value), pct: total ? (Number(d.value) / total) * 100 : 0,
                             pnlPct: d.pnlPct === null ? null : Number(d.pnlPct) }))
                .sort((a, b) => b.value - a.value);
        },

        _token(name, fallback) {
            try {
                const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
                return v || fallback;
            } catch (e) { return fallback; }
        },

        holdingFilters: [
            { key: 'all',    label: 'Everything' },
            { key: 'equity', label: 'Stocks' },
            { key: 'mf',     label: 'Mutual funds' },
            { key: 'debt',   label: 'Deposits and bonds' },
            { key: 'gold',   label: 'Gold' },
        ],

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
            const rate = inv.rate ?? inv.interestRate;
            if (Number(rate) > 0) {
                const m = inv.maturityDate ? ` \u00b7 matures ${this.formatDate(inv.maturityDate)}` : '';
                return `${rate}%${m}`;
            }
            return inv.issuer || t;
        },

        _classOf(inv) {
            const t = inv.type || '';
            if (t.includes('Stock') || t.includes('ETF')) return 'equity';
            if (t === 'Mutual Fund') return 'mf';
            if (t === 'Gold') return 'gold';
            return 'debt';
        },

        get visibleHoldings() {
            const all = this.investments || [];
            return this.invFilter === 'all' ? all : all.filter(i => this._classOf(i) === this.invFilter);
        },

        get groupedHoldings() {
            const defs = [
                { key: 'equity', label: 'Stocks and ETFs' },
                { key: 'mf',     label: 'Mutual funds' },
                { key: 'debt',   label: 'Deposits, bonds and schemes' },
                { key: 'gold',   label: 'Gold' },
            ];
            const vis = this.visibleHoldings;
            return defs.map(d => {
                const items = vis.filter(i => this._classOf(i) === d.key);
                return { ...d, items, total: items.reduce((a, i) => a + this.getInvCurrentValue(i), 0) };
            }).filter(g => g.items.length);
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

        /* The canonical instrument list, in the order an Indian investor is
           likely to hold them rather than alphabetically. */
        investmentTypes: [
            'Bank FD', 'Bond', 'Government Scheme', 'Mutual Fund',
            'Stock (IND)', 'Stock (US)', 'ETF (IND)', 'ETF (US)',
            'Gold', 'Real Estate', 'Other',
        ],

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
            return ({ '1M': 'past month', '3M': 'past 3 months', '6M': 'past 6 months',
                      '1Y': 'past year', 'ALL': 'all time' })[this.nwChartRange] || '';
        },

        /* Signed, unlike efGap which clamps at zero. Positive means over-funded,
           which is a real state worth naming: money sitting in a liquid account
           past what the buffer needs is money not working. */
        get efSurplus() {
            return (Number(this.emergency.efCurrent) || 0) - (Number(this.efRequired) || 0);
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
            const annualTax = Math.min(this.oldRegimeTax.tax, this.newRegimeTax.tax);
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
            if (this.tax.deduction80TTB > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: '80TTB Interest Income Statement (Senior)', note: `Claimed: ${this.formatCurrency(this.tax.deduction80TTB)}` });
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
            if (this.monthlySurplus > 0) s.push('Positive monthly cash flow');
            if (this.emergency.efCurrent >= this.emergency.efMonthly * 6) s.push('6-month emergency fund funded');
            else if (this.emergency.efCurrent >= this.emergency.efMonthly * 3) s.push('3-month emergency buffer exists');
            if (this.investments.length > 0) s.push('Active investment portfolio');
            if (this.concentrationWarnings.length === 0 && this.investments.length > 1) s.push('Diversified portfolio');
            return s;
        },

        get healthImprovements() {
            const i = [];
            if (this.emergency.efCurrent < this.emergency.efMonthly * 6)
                i.push('Increase emergency fund to 6 months');
            if (this.concentrationWarnings.length > 0)
                i.push('Reduce concentration risk — one issuer holds majority of portfolio');
            if (Number(this.savingsRate) < 20)
                i.push('Aim for a 20% savings rate');
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
                id:           Date.now(),
                amount:       amount,
                units:        units,
                buyPrice:     buyPrice,
                currentPrice: currentPrice || buyPrice,
                currentValue: amount,
                rate:         ['Bank FD', 'Bond', 'RBI Bond', 'Government Scheme', 'Post Office'].includes(this.newInv.type) ? (Number(this.newInv.rate) || 0) : 0
            };

            this.investments.push(createdInv);

            // Trigger single price fetch if ticker/schemeCode provided
            if (createdInv.ticker || createdInv.schemeCode) {
                this.fetchSinglePrice(createdInv);
            }

            this.newInv = {
                name: '', type: 'Stock (IND)', issuer: '', amount: '',
                rate: '', payout: 'Monthly', rating: '', maturityDate: '',
                ticker: '', units: '', buyPrice: '', currentPrice: '', schemeCode: ''
            };
            this.addingInv = false;
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
                this.editForm.rate         = ['Bank FD', 'Bond', 'RBI Bond', 'Government Scheme', 'Post Office'].includes(this.editForm.type) ? (Number(this.editForm.rate) || 0) : 0;

                this.investments[idx] = { ...this.editForm };
                this.investments = [...this.investments];

                if (this.editForm.ticker || this.editForm.schemeCode) {
                    this.fetchSinglePrice(this.investments[idx]);
                }
            }
            this.editingInv = null;
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
                id:      Date.now(),
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
                    // Phase 13: AI Classifier fallback — attempt Gemini 2.0 Flash zero-shot classification
                    const apiKey = localStorage.getItem('rfm_gemini_key');
                    if (!apiKey) {
                        // No API key — show helpful error pointing user to set one
                        this.importError = result.investments.length === 0
                            ? `Statement recognized as ${result.type.replace('_',' ')} but no holdings extracted. Try enabling AI Classifier (set your Gemini API key above) for unsupported formats.`
                            : 'Statement format not recognized by the built-in parser. Enable AI Classifier by adding your Gemini API key above to handle any bank/broker format.';
                        this.aiClassifier.status  = 'idle';
                        this.importState = 'error';
                        return;
                    }

                    // AI Classifier active
                    this.importState = 'ai_classifying';
                    this.aiClassifier.status  = 'classifying';
                    this.aiClassifier.error   = '';
                    this.aiClassifier.usedAI  = false;

                    try {
                        const aiResult = await this.classifyWithAI(text, apiKey);
                        if (!aiResult || !aiResult.investments || aiResult.investments.length === 0) {
                            throw new Error('AI returned no holdings. The PDF may be image-based or contain no financial data.');
                        }
                        // Merge AI result into the standard importResults shape
                        this.importResults      = aiResult;
                        this.aiClassifier.usedAI     = true;
                        this.aiClassifier.docType    = aiResult.type || 'Unknown';
                        this.aiClassifier.confidence = aiResult.aiConfidence || 'Medium';
                        this.aiClassifier.status     = 'done';
                        this.importSelections = {};
                        aiResult.investments.forEach((_, idx) => {
                            this.importSelections[idx] = true;
                        });
                        this.importState = 'parsed';
                        return;
                    } catch (aiErr) {
                        console.error('[Phase 13] AI Classifier failed:', aiErr);
                        this.aiClassifier.status  = 'error';
                        this.aiClassifier.error   = aiErr.message;
                        this.importError = 'AI Classifier failed: ' + aiErr.message;
                        this.importState = 'error';
                        return;
                    }
                }

                // Regex parser succeeded normally
                this.aiClassifier.usedAI = false;
                this.aiClassifier.status = 'idle';
                this.importResults = result;
                // Select all by default
                this.importSelections = {};
                result.investments.forEach((_, idx) => {
                    this.importSelections[idx] = true;
                });
                this.importState = 'parsed';

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

        // ════════════════════════════════════════════════════════════
        //  PHASE 13: UNIVERSAL AI STATEMENT CLASSIFIER
        //  Uses Gemini 2.0 Flash with JSON mode to zero-shot classify
        //  any bank statement, credit card, broker P&L, or insurance PDF
        // ════════════════════════════════════════════════════════════

        async classifyWithAI(rawText, apiKey) {
            // Trim text to keep within token limits (~12K chars ~ 3K tokens)
            const truncated = rawText.length > 12000
                ? rawText.slice(0, 12000) + '\n[...document truncated for analysis...]'
                : rawText;

            const prompt = `You are a financial document parser for an Indian personal finance app. Your ONLY task is to extract structured financial data from the document text below.

Classify the document and extract all financial holdings, transactions, or policies into structured JSON.

## DOCUMENT TEXT:
"""
${truncated}
"""

## CLASSIFICATION TYPES:
- BANK_STATEMENT — savings/current account transactions
- CREDIT_CARD_STATEMENT — credit card transactions and outstanding
- CAS_STATEMENT — CAMS/KFintech Consolidated Account Statement (mutual funds)
- BROKER_PL — broker P&L / capital gains statement
- INSURANCE_POLICY — LIC or other insurance policy document
- FD_RECEIPT — Fixed Deposit receipt or advice
- BOND_STATEMENT — government/corporate bond holding statement
- EPFO_STATEMENT — PF/EPF passbook statement
- NPS_STATEMENT — National Pension System statement

## OUTPUT FORMAT (strict JSON, no markdown):
{
  "type": "<one of the CLASSIFICATION TYPES above>",
  "aiConfidence": "High|Medium|Low",
  "aiDocumentSummary": "<1-2 sentence summary of what this document is>",
  "investor": {
    "name": "<account holder name if found, else null>",
    "accountNumber": "<masked account number if found, else null>",
    "pan": "<PAN if found, else null>"
  },
  "investments": [
    {
      "name": "<investment/scheme/FD name>",
      "type": "<Bank FD | Bond | Mutual Fund | Stock | ETF | Insurance | Post Office | Government Scheme | Other>",
      "issuer": "<bank/institution name>",
      "amount": 0,
      "rate": 0,
      "maturityDate": null,
      "units": 0,
      "buyPrice": 0,
      "currentPrice": 0,
      "purchaseDate": null,
      "assetClass": "<equity|debt|gold|realestate|insurance|other>"
    }
  ],
  "transactionSummary": {
    "totalCredits": 0,
    "totalDebits": 0,
    "period": null
  }
}

RULES: Return ONLY valid JSON. No markdown, no explanation. If a field is unknown use null or 0. Amount must be a number (rupees). Do NOT invent data not in the document.`;

            const activeModel = this.regenWealth.model === 'custom' ? this.regenWealth.customModel : this.regenWealth.model;
            const parsed = await window.RegenWealth.callLLM(prompt, apiKey, {
                provider:    this.regenWealth.provider,
                model:       activeModel,
                temperature: 0.1
            });

            // Normalise: ensure all investment fields are correctly typed
            if (parsed.investments) {
                parsed.investments = parsed.investments.map((inv, i) => ({
                    id:           `ai_${Date.now()}_${i}`,
                    name:         inv.name         || 'Unnamed Holding',
                    type:         inv.type         || 'Other',
                    issuer:       inv.issuer        || '',
                    amount:       Number(inv.amount) || 0,
                    rate:         Number(inv.rate)   || 0,
                    maturityDate: inv.maturityDate   || '',
                    units:        Number(inv.units)  || 0,
                    buyPrice:     Number(inv.buyPrice)     || 0,
                    currentPrice: Number(inv.currentPrice) || 0,
                    currentValue: (Number(inv.units) > 0 && Number(inv.currentPrice) > 0)
                                    ? Number(inv.units) * Number(inv.currentPrice)
                                    : Number(inv.amount) || 0,
                    purchaseDate: inv.purchaseDate || '',
                    assetClass:   inv.assetClass   || 'other',
                    payout: 'Monthly', rating: '', ticker: '', schemeCode: ''
                }));
            }

            return parsed;
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
                if (pdfjsLib.GlobalWorkerOptions) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@6.1.200/build/pdf.worker.min.mjs';
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
                fullText += pageText + '\n';
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
            if (!targetForm.name || targetForm.name === 'Stock' || targetForm.name === 'Mutual Fund') {
                targetForm.name = scheme.schemeName;
            }
            this.mfSearchResults = [];
            this.mfSearchQuery = '';
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

        // Fetch one instrument. A mutual fund must use an explicitly chosen AMFI scheme.
        async fetchSinglePrice(inv) {
            if (!inv) return null;

            if (inv.type === 'Mutual Fund' || inv.schemeCode) {
                if (!inv.schemeCode) {
                    throw new Error(`${inv.name || 'Mutual fund'} needs an AMFI scheme code before it can be synced.`);
                }

                const data = await this.httpGetJson(`https://api.mfapi.in/mf/${encodeURIComponent(inv.schemeCode)}`);
                const row = data?.data?.[0];
                const newNav = Number(row?.nav);
                if (!Number.isFinite(newNav) || newNav <= 0) throw new Error('No valid NAV was returned.');

                inv.currentPrice = newNav;
                if (Number(inv.units) > 0) {
                    inv.currentValue = Math.round(Number(inv.units) * newNav * 100) / 100;
                }
                // AMFI publishes one NAV per business day, so a fund is "as of" its own
                // declared date, not the moment we happened to fetch it.
                inv.priceSource   = 'AMFI';
                inv.priceAsOf     = this.parseAmfiDate(row?.date) || new Date().toISOString();
                inv.priceIsClose  = true;
                inv.lastNavUpdate = new Date().toISOString();
                return newNav;
            }

            if (!inv.ticker) return null;

            const isUS = inv.type === 'Stock (US)' || inv.type === 'ETF (US)' || inv.currency === 'USD';
            const cleanSymbol = inv.ticker.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
            const querySymbol = isUS ? cleanSymbol : `${cleanSymbol}.NS`;
            const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(querySymbol)}?interval=1d&range=5d`;

            // Native HTTP is not bound by CORS, so Android hits Yahoo directly — one request.
            // In a browser the direct call CANNOT succeed (Yahoo sends no CORS header) yet still
            // costs a full round trip, so it is omitted there and the proxies are RACED rather
            // than tried one after another.
            const data = this.canUseNativeHttp
                ? await this.httpGetJson(targetUrl)
                : await this.firstSuccessful([
                    () => this.httpGetJson(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`),
                    () => this.httpGetJson(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`)
                  ]);

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

        // AMFI returns "08-09-2026" (DD-MM-YYYY), which bare Date() misreads as Aug 9.
        // Anchored at UTC NOON, not local midnight: local midnight in IST is 18:30 UTC the
        // PREVIOUS day, so the ISO date component would be off by one and any date-string
        // comparison would silently use the wrong day.
        parseAmfiDate(s) {
            const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s || '').trim());
            if (!m) return null;
            const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
            if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2999) return null;
            // Local noon. Date.UTC would silently roll "99-99-2026" over into a valid date,
            // and a UTC anchor renders as the wrong day east of UTC+12. Noon local is stable
            // in every timezone for the viewer who is reading it, and the 12h offset is
            // irrelevant to staleness, which is measured in days.
            const d = new Date(year, month - 1, day, 12, 0, 0, 0);
            if (Number.isNaN(d.getTime()) || d.getDate() !== day || d.getMonth() !== month - 1) return null;
            return d.toISOString();
        },

        // Is this holding's price a live quote, or the last close / an old sync?
        priceFreshness(inv) {
            if (!inv?.priceAsOf) return { state: 'unknown', label: 'not synced' };
            const ageMs = Date.now() - new Date(inv.priceAsOf).getTime();
            if (inv.priceIsClose) {
                // A fund has no intraday price at all — its NAV is simply the day's value —
                // so calling that a "last close" would overstate the problem.
                const word = inv.priceSource === 'AMFI' ? 'NAV' : 'last close';
                return { state: 'close', label: `${word} · ${this.formatDate(inv.priceAsOf)}` };
            }
            if (ageMs > 24 * 60 * 60 * 1000) {
                return { state: 'stale', label: `${this.formatDate(inv.priceAsOf)}` };
            }
            return { state: 'live', label: `${inv.priceSource || 'live'}` };
        },

        // Refresh eligible holdings concurrently with a small worker pool to protect public data APIs.
        async fetchAllPrices() {
            if (this.navFetchState === 'fetching') return;

            const holdings = (this.investments || []).filter(inv => inv.schemeCode || inv.ticker || inv.type === 'Mutual Fund');
            if (!holdings.length) {
                this.navFetchState = 'done';
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
            // Only run on native Android/iOS — LocalNotifications plugin not available in browser
            const plugins = window.AppPlugins;
            if (!plugins || !plugins.Capacitor?.isNativePlatform() || !plugins.LocalNotifications) {
                this.alertsState = 'unsupported';
                return;
            }

            this.alertsState = 'scheduling';
            this.alertsError = '';

            try {
                const { LocalNotifications } = plugins;

                // 1. Request permission — required on Android 13+ (API 33+)
                const permResult = await LocalNotifications.requestPermissions();
                this.notifPermissionGranted = (permResult.display === 'granted');
                if (!this.notifPermissionGranted) {
                    this.alertsState = 'error';
                    this.alertsError = 'Notification permission denied. Enable in Android Settings → App Info → Notifications.';
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
                            schedule: { at: alertAt, allowWhileIdle: true },
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
                            schedule: { at: sameDayAlert, allowWhileIdle: true },
                            sound:    'default',
                            smallIcon: 'ic_stat_notification',
                            channelId: 'rfm_maturity'
                        });
                    }
                });

                // 4. SIP Reminders — 1 day before debit day, for next 12 months
                (this.activeSips || []).forEach((sip, i) => {
                    const debitDay = Number(sip.dayOfMonth) || 5;
                    for (let month = 0; month < 12; month++) {
                        const reminderAt = new Date(now.getFullYear(), now.getMonth() + month, debitDay - 1, 9, 0, 0, 0);
                        if (reminderAt > now) {
                            alerts.push({
                                id:    20000 + (i * 100) + month,
                                title: '💰 SIP Reminder — RFM',
                                body:  `₹${this.formatCurrency(sip.monthlyAmount)} for "${sip.name}" debits tomorrow (${debitDay}th). Ensure sufficient balance.`,
                                schedule: { at: reminderAt, allowWhileIdle: true },
                                sound:    'default',
                                smallIcon: 'ic_stat_notification',
                                channelId: 'rfm_sip'
                            });
                        }
                    }
                });

                // 5. Schedule all built notifications in one batch call
                if (alerts.length > 0) {
                    await LocalNotifications.schedule({ notifications: alerts });
                }

                this.scheduledAlertsCount = alerts.length;
                this.alertsState = 'scheduled';

            } catch (err) {
                console.error('[Phase 12] Failed to schedule notifications:', err);
                this.alertsState = 'error';
                this.alertsError = err.message || 'Unknown error scheduling notifications.';
            }
        },

        // ════════════════════════════════════════════════════════════
        //  UTILITIES (duplicate removed — canonical formatCurrency is at ~line 1636)
        // ════════════════════════════════════════════════════════════
        formatDate(str) {
            if (!str) return '—';
            return new Date(str).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        },

        // ════════════════════════════════════════════════════════════
        //  REGENERATIVE WEALTH METHODS
        // ════════════════════════════════════════════════════════════

        getActiveRegenModel() {
            const model = this.regenWealth.model === 'custom'
                ? this.regenWealth.customModel
                : this.regenWealth.model;
            return (model || '').trim();
        },

        async loadRegenModelCatalog() {
            const key = (this.regenWealth.apiKey || '').trim();
            const provider = this.regenWealth.provider === 'auto'
                ? window.RegenWealth?.detectProvider(key)
                : this.regenWealth.provider;

            if (provider !== 'openrouter') {
                this.regenWealth.modelCatalog = [];
                this.regenWealth.modelCatalogState = 'idle';
                this.regenWealth.modelCatalogError = 'The live catalog is available for OpenRouter keys only.';
                return;
            }

            this.regenWealth.modelCatalogState = 'loading';
            this.regenWealth.modelCatalogError = '';
            try {
                const data = await this.fetchJsonWithTimeout(
                    'https://openrouter.ai/api/v1/models?output_modalities=text&sort=latency-low-to-high',
                    6000
                );
                const models = (data?.data || [])
                    .filter(model => model?.id && model?.name)
                    .slice(0, 120)
                    .map(model => ({ id: model.id, name: model.name }));
                if (!models.length) throw new Error('No text models were returned.');

                this.regenWealth.modelCatalog = models;
                this.regenWealth.modelCatalogState = 'ready';
            } catch (error) {
                this.regenWealth.modelCatalogState = 'error';
                this.regenWealth.modelCatalogError = 'Could not load the live OpenRouter catalog. Use a custom model ID or retry.';
            }
        },

        // Save API key & provider/model settings
        saveRegenApiKey(closePanel = true) {
            const key = (this.regenWealth.apiKey || '').trim();
            if (key.length < 10) {
                this.regenWealth.error = 'Please enter a valid API key (OpenRouter, Gemini, or OpenAI).';
                return;
            }
            localStorage.setItem('rfm_api_key', key);
            localStorage.setItem('rfm_gemini_key', key); // Backward compatibility
            localStorage.setItem('rfm_api_provider', this.regenWealth.provider || 'auto');
            localStorage.setItem('rfm_api_model', this.regenWealth.model || 'openai/gpt-4o-mini');
            localStorage.setItem('rfm_api_custom_model', this.regenWealth.customModel || '');

            this.regenWealth.apiKeySet    = true;
            this.regenWealth.showKeyInput = false;
            if (closePanel) this.regenWealth.activeTab = null;
            this.regenWealth.error        = '';
            this.loadRegenModelCatalog();
        },

        // Remove stored API key & settings
        clearRegenApiKey() {
            localStorage.removeItem('rfm_api_key');
            localStorage.removeItem('rfm_gemini_key');
            localStorage.removeItem('rfm_api_provider');
            localStorage.removeItem('rfm_api_model');
            localStorage.removeItem('rfm_api_custom_model');
            this.regenWealth.apiKey       = '';
            this.regenWealth.apiKeySet    = false;
            this.regenWealth.showKeyInput = false;
            this.regenWealth.activeTab    = 'key';
            this.regenWealth.analysis     = null;
            window.RegenWealth?.clearCache();
        },

        // Clear cached analysis and force fresh fetch
        clearRegenCache() {
            window.RegenWealth?.clearCache();
            this.regenWealth.analysis = null;
        },

        // Main analysis runner — called by the Analyze button
        async runRegenWealthAnalysis() {
            if (!window.RegenWealth) {
                this.regenWealth.error = 'Analysis engine not loaded. Please refresh the page.';
                return;
            }
            if (!this.regenWealth.apiKeySet) {
                this.regenWealth.showKeyInput = true;
                this.regenWealth.activeTab    = 'key';
                return;
            }

            this.regenWealth.loading     = true;
            this.regenWealth.error       = '';
            this.regenWealth.progressMsg = 'Starting analysis...';

            const activeModel = this.getActiveRegenModel();
            if (!activeModel) {
                this.regenWealth.error = 'Choose a model from the live catalog or enter a custom model ID.';
                this.regenWealth.loading = false;
                if (this.regenWealth.analysis && window.RFMMotion) {
                    this.$nextTick(() => window.RFMMotion.revealInsights());
                }
                this.regenWealth.progressMsg = '';
                return;
            }

            try {
                const result = await window.RegenWealth.analyze(
                    this.$data,
                    this.regenWealth.apiKey,
                    {
                        provider: this.regenWealth.provider,
                        model:    activeModel
                    },
                    (msg) => { this.regenWealth.progressMsg = msg; }
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

        // Helper: priority badge colour class
        regenPriorityClass(priority) {
            if (priority === 'High')   return 'bg-[#d4af37]/20 text-[#d4af37] border-[#d4af37]/40';
            if (priority === 'Medium') return 'bg-primary-container/40 text-primary border-primary/30';
            return 'bg-white/10 text-on-surface-variant border-white/10';
        },

        // Helper: priority glow class for card border
        regenCardGlow(priority) {
            if (priority === 'High')   return 'border-[#d4af37]/40 shadow-[0_8px_30px_rgba(212,175,55,0.15)]';
            if (priority === 'Medium') return 'border-primary/30 shadow-[0_8px_30px_rgba(0,201,167,0.12)]';
            return 'border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]';
        },

        // Helper: asset class icon name
        regenAssetIcon(assetClass) {
            const map = {
                'Gold': 'diamond', 'Sovereign Gold Bonds': 'diamond',
                'Bonds': 'account_balance', 'RBI Bonds': 'account_balance',
                'Fixed Deposits': 'savings', 'SCSS': 'savings',
                'Mutual Funds': 'trending_up', 'PPF': 'savings',
                'Equity': 'candlestick_chart',
                'Real Estate': 'home', 'REITs': 'home',
                'NPS': 'shield',
            };
            return map[assetClass] || 'auto_awesome';
        },

        // Helper: sentiment colour
        regenSentimentClass(sentiment) {
            if (!sentiment) return 'text-on-surface-variant';
            const s = sentiment.toLowerCase();
            if (s.includes('bullish')) return 'text-primary';
            if (s.includes('bearish')) return 'text-red-400';
            if (s.includes('cautious')) return 'text-[#d4af37]';
            return 'text-on-surface-variant';
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — BACKUP & RESTORE (Phase 7)
        // ════════════════════════════════════════════════════════════
        // Everything a restore must carry. Backup previously exported rfm_v1 alone, so a
        // restore on a new phone silently dropped the entire net-worth history behind the
        // hero chart — with a "restored successfully" message. API keys are deliberately
        // NOT included: a backup is a plaintext file the user emails or copies around.
        BACKUP_KEYS: ['rfm_v1', 'rfm_nw_history', 'rfm_usd_inr_rate', 'rfm_api_provider', 'rfm_api_model', 'rfm_api_custom_model'],

        backupData() {
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
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rfm_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
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
                    id:            'inv_' + Date.now(),
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
                id:                 Date.now(),
                monthlyAmount:      Number(this.newSip.monthlyAmount),
                dayOfMonth:         Number(this.newSip.dayOfMonth) || 5,
                linkedInvestmentId: existingHolding.id,
                schemeCode:         schemeCode || existingHolding.schemeCode || '',
                ticker:             ticker || existingHolding.ticker || '',
                lastExecutedMonth:  ''
            };

            this.sips.push(createdSip);

            // Execute immediate debit check for current month
            await this.checkSipDebits();

            this.newSip = {
                name: '', type: 'SIP', monthlyAmount: '',
                dayOfMonth: 5, startDate: '', endDate: '',
                status: 'Active', linkedInvestmentId: null, ticker: '', schemeCode: ''
            };
            this.sipMfSearch = { query: '', results: [], loading: false, show: false, _timer: null };
            this.addingSip = false;
            this.saveData();
        },

        // ── AUTOMATED MONTHLY SIP EXECUTION ENGINE ─────────────────────
        // Checks active SIP debit dates against current date. When debit day passes,
        // automatically adds monthly capital to the linked holding, purchases units @ live NAV,
        // and updates Total Net Worth.
        async checkSipDebits() {
            if (!this.sips || this.sips.length === 0) return;

            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();
            const currentDay = now.getDate();
            const currentMonthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

            let executedCount = 0;

            for (const sip of this.sips) {
                if (sip.status !== 'Active') continue;
                const debitDay = Number(sip.dayOfMonth) || 5;

                // If current date >= debitDay and SIP hasn't executed for this month
                if (currentDay >= debitDay && sip.lastExecutedMonth !== currentMonthKey) {
                    let inv = (this.investments || []).find(i =>
                        i.id === sip.linkedInvestmentId ||
                        (sip.schemeCode && i.schemeCode === sip.schemeCode) ||
                        (i.name || '').toLowerCase() === (sip.name || '').toLowerCase()
                    );

                    if (!inv) {
                        inv = {
                            id:           'inv_' + Date.now(),
                            name:         sip.name,
                            type:         sip.schemeCode ? 'Mutual Fund' : 'Stock (IND)',
                            schemeCode:   sip.schemeCode || '',
                            units:        0,
                            buyPrice:     0,
                            currentPrice: 0,
                            amount:       0,
                            lastNavUpdate: now.toISOString()
                        };
                        this.investments.push(inv);
                        sip.linkedInvestmentId = inv.id;
                    }

                    const debitAmount = Number(sip.monthlyAmount) || 0;
                    if (debitAmount > 0) {
                        let price = Number(inv.currentPrice) || Number(inv.buyPrice) || 0;
                        if (price <= 0) {
                            price = await this.fetchSinglePrice(inv) || 100;
                        }

                        const isUsd = inv.currency === 'USD' || ['Stock (US)', 'ETF (US)'].includes(inv.type);
                        const rate = isUsd ? this.fxUsdInr : 1;
                        const priceInInr = price * rate;

                        const newUnits = debitAmount / priceInInr;
                        const oldUnits = Number(inv.units) || 0;
                        const oldCost = Number(inv.amount) || (oldUnits * (Number(inv.buyPrice) || 0) * rate);

                        const totalUnits = oldUnits + newUnits;
                        const totalCost = oldCost + debitAmount;

                        inv.units = Math.round(totalUnits * 1000) / 1000;
                        inv.amount = Math.round(totalCost * 100) / 100;
                        inv.buyPrice = Math.round((totalCost / totalUnits / rate) * 100) / 100;
                        inv.currentValue = Math.round(totalUnits * priceInInr * 100) / 100;
                        inv.lastNavUpdate = now.toISOString();

                        sip.lastExecutedMonth = currentMonthKey;
                        executedCount++;

                        console.log(`[SIP Engine] Executed ₹${debitAmount} SIP for ${inv.name}. Added ${newUnits.toFixed(3)} units @ NAV ₹${price}. Total units: ${inv.units}`);
                    }
                }
            }

            if (executedCount > 0) {
                this.saveData();
            }
        },

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
