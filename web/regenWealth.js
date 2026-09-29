// ══════════════════════════════════════════════════════════════════════════════
// regenWealth.js — Regenerative Wealth Analysis Engine
// Architecture Layer : Intelligence / Advisory Layer
// Depends on        : OpenRouter-compatible or direct LLM API, RSS bridge
// Client mode is suitable for a personal prototype. Production needs a secure backend.
// ══════════════════════════════════════════════════════════════════════════════

window.RegenWealth = (() => {

    // ── Constants ──────────────────────────────────────────────────────────────
    // A new key prevents the old, multi-page readings from resurfacing as cache hits.
    const CACHE_KEY    = 'rfm_regen_cache_findings_v2';
    const PENDING_KEY  = 'rfm_regen_pending_brief_v1';
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // Six hours, and invalidated on portfolio changes.
    const DAILY_KEY    = 'rfm_daily_brief_v1';
    // Outwaits the gateway's 85s budget; must match the native read timeout.
    const GATEWAY_WAIT_MS = 95000;

    /* First line of every brief. The gateway refuses anything without one, so
       it cannot be used as a general chatbot on the shared key. */
    const MARK_ANALYSIS = 'CORPUS-BRIEF: analysis-v2';
    const MARK_DAILY    = 'CORPUS-BRIEF: daily-v1';

    /* The RSS feeds and their fetcher moved to research.js, and not only to tidy
       up. The version that lived here used bare `fetch`, so on Android it was a
       WebView cross-origin request to rss2json with no CORS header — it threw
       every time, the throw was swallowed, and the prompt silently fell back to
       "no market context". The phone was getting an AI reading with no news in
       it at all. research.js goes through fetchMarketJson, which is
       CapacitorHttp on native and our own gateway in the browser. */

    // ── Portfolio Snapshot Builder ─────────────────────────────────────────────
    // Distills app state into a lean snapshot with values calculated from holdings,
    // rather than from stale display fields.
    function buildPortfolioSnapshot(appData) {
        const investments = appData.investments || [];
        // `|| 1` here meant that whenever no rate was loaded, every US holding was valued
        // at $1 = ₹1 — understating the US book ~88x — and that figure was then sent to the
        // model as fact. Read the app's single FX source instead, which is never unset.
        const fxRate = Number(appData.fxUsdInr) || Number(appData.usdInrRate) || 88.0;
        const number = value => Number(value) || 0;
        const isUsdHolding = investment => investment.currency === 'USD'
            || investment.type === 'Stock (US)'
            || investment.type === 'ETF (US)';
        /* The app's own valuation, never a copy of it. A private copy here once
           counted an imported fund as ₹0 invested but at its full value, so a
           reading reported the funds' entire worth as profit. The fallbacks only
           serve callers that pass plain data (the tests); they follow the same
           rules: cost is what was paid or unknown, never today's price. */
        const own = name => typeof appData[name] === 'function' ? appData[name].bind(appData) : null;
        const holdingValue = own('getInvCurrentValue') || (investment => {
            if (number(investment.units) > 0) {
                const price = number(investment.currentPrice) || number(investment.nav) || number(investment.buyPrice);
                return number(investment.units) * price * (isUsdHolding(investment) ? fxRate : 1);
            }
            return number(investment.currentValue) || number(investment.amount);
        });
        const holdingCostOrZero = own('getInvInvestedCost') || (investment => number(investment.units) > 0
            ? number(investment.units) * number(investment.buyPrice) * (isUsdHolding(investment) ? fxRate : 1)
            : number(investment.amount));
        const marketLinked = own('isMarketLinked') || (investment => {
            const t = investment.type || '';
            return t.includes('Stock') || t.includes('ETF') || t === 'Mutual Fund' || t === 'Gold' || t === 'Physical Metal';
        });

        const holdings = investments.map(investment => {
            const linked = marketLinked(investment);
            const paid = holdingCostOrZero(investment);
            const value = holdingValue(investment);
            // A balance (EPF, FD, scheme) is not an investment with a gain; a
            // market holding with no recorded buy price has an unknown one.
            const cost = linked && paid > 0 ? paid : null;
            const pnl = cost === null ? null : value - cost;
            return {
                name: investment.name || investment.ticker || 'Unnamed holding',
                type: investment.type || 'Other',
                ticker: investment.ticker || '',
                marketLinked: linked,
                invested: cost === null ? null : Math.round(cost),
                marketValue: Math.round(value),
                pnl: pnl === null ? null : Math.round(pnl),
                pnlPct: cost > 0 ? Number(((pnl / cost) * 100).toFixed(2)) : null,
                lastUpdated: investment.lastNavUpdate || ''
            };
        });
        const priced = holdings.filter(h => h.marketLinked && h.invested !== null);
        const totalInvested = priced.reduce((sum, h) => sum + h.invested, 0);
        const pricedValue = priced.reduce((sum, h) => sum + h.marketValue, 0);
        const marketGain = pricedValue - totalInvested;
        const marketGainPct = totalInvested > 0 ? Number(((marketGain / totalInvested) * 100).toFixed(2)) : null;
        const costUnknown = holdings.filter(h => h.marketLinked && h.invested === null).map(h => h.name);
        const balancesValue = holdings.filter(h => !h.marketLinked).reduce((sum, h) => sum + h.marketValue, 0);
        const totalMarketValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);

        // Split by the app's own classes, so "Stocks (US)" is one line however
        // its holdings happen to be typed.
        const breakdown = {};
        const classes = Array.isArray(appData.HOLDING_CLASSES) && own('_classOf') ? appData.HOLDING_CLASSES : null;
        investments.forEach((investment, i) => {
            const key = classes
                ? ((c => c && (c.key === 'equity' ? 'Stocks (India)' : c.short))(classes.find(c => c.key === appData._classOf(investment)))) || holdings[i].type
                : holdings[i].type;
            breakdown[key] = (breakdown[key] || 0) + holdings[i].marketValue;
        });
        const allocationPct = {};
        Object.entries(breakdown).forEach(([type, amt]) => {
            allocationPct[type] = totalMarketValue > 0
                ? Math.round((amt / totalMarketValue) * 100)
                : 0;
        });

        const concentrationRisks = Object.entries(allocationPct)
            .filter(([, pct]) => pct > 40)
            .map(([type, pct]) => `${type} (${pct}%)`);

        const pension = number(appData.pension?.monthlyAmount);
        const cf          = appData.cashflow || {};
        const incomeStreams = Array.isArray(cf.incomes) ? cf.incomes : [];
        const expenseStreams = Array.isArray(cf.expenses) ? cf.expenses : [];
        const streamedIncome = incomeStreams.reduce((sum, stream) => sum + number(stream.amount), 0);
        const hasPensionStream = incomeStreams.some(stream => (stream.category || '').toLowerCase() === 'pension');
        const totalIncome = incomeStreams.length
            ? streamedIncome + (hasPensionStream ? 0 : pension)
            : pension + number(cf.project) + number(cf.otherIncome);
        const totalExpense = expenseStreams.length
            ? expenseStreams.reduce((sum, stream) => sum + number(stream.amount), 0)
            : number(cf.housing) + number(cf.food) + number(cf.medical) + number(cf.otherExpense);
        // The Income screen's own figures when the app is present, so the reading
        // and the screen never disagree on income, spending or the surplus.
        const appNum = k => (typeof appData[k] === 'number' && Number.isFinite(appData[k])) ? appData[k] : null;
        const incomeOut = appNum('totalIncome') ?? totalIncome;
        const expenseOut = appNum('totalExpense') ?? totalExpense;
        const monthlySurplus = incomeOut - expenseOut;

        const nw = appData.networth || {};
        const totalAssets      = number(nw.bank) + number(nw.cash)
                               + number(nw.property) + number(nw.otherAsset)
                               + totalMarketValue;
        const totalLiabilities = number(nw.homeLoan) + number(nw.personalLoan)
                               + number(nw.credit) + number(nw.otherDebt);

        const ef = appData.emergency || {};
        const efTarget = appNum('efRequired') ?? number(ef.efMonthly) * number(ef.efMonths || 12);
        const efCurrent = number(ef.efCurrent);
        const efCoverageMonths = number(ef.efMonthly) > 0
            ? Math.round(efCurrent / number(ef.efMonthly))
            : 0;

        const payouts = payoutPicture(investments, holdingValue);
        const profile = normProfile(appData.profile);
        const payoutFit = [];
        if (profile && typeof appData._profileClassOf === 'function') {
            for (const [cls, requested] of Object.entries(profile.payout || {})) {
                if (requested.includes('none')) continue;
                const inClass = investments.filter(inv => appData._profileClassOf(inv) === cls);
                const terms = inClass.map(inv => ({ name: inv.name, term: String(inv.payout || inv.payoutFrequency || '').toLowerCase() }));
                for (const frequency of requested) {
                    const matches = terms.filter(x => frequency === 'yearly' ? /year|annual/.test(x.term) : x.term.includes(frequency));
                    payoutFit.push(`${CLASSES[cls] || cls}: wants ${frequency}; ${matches.length ? 'recorded terms match on ' + matches.map(x => x.name).join(', ') : 'no holding with that recorded payout frequency'}. Actual cash paid is not verified.`);
                }
            }
        }

        // Value and share per profile class, from the app's own classifier.
        const classShares = {};
        if (typeof appData._profileClassOf === 'function') {
            investments.forEach((investment, i) => {
                const k = appData._profileClassOf(investment);
                classShares[k] = classShares[k] || { value: 0, pct: 0 };
                classShares[k].value += holdings[i].marketValue;
            });
            for (const k of Object.keys(classShares)) {
                classShares[k].pct = totalMarketValue > 0 ? Math.round((classShares[k].value / totalMarketValue) * 100) : 0;
            }
        }

        return {
            totalInvested,
            totalMarketValue,
            pricedValue,
            marketGain,
            marketGainPct,
            costUnknown,
            balancesValue,
            payouts,
            payoutFit,
            cpi: appData.cpi && Number.isFinite(Number(appData.cpi.rate)) ? {
                rate: Number(appData.cpi.rate), referenceMonth: appData.cpi.referenceMonth,
                releasedOn: appData.cpi.releasedOn, stale: !!appData.cpiStale || !!appData.cpiOffline
            } : null,
            holdingsCount: investments.length,
            holdings: holdings.sort((a, b) => b.marketValue - a.marketValue).slice(0, 8),
            allocationPct,
            breakdown,
            concentrationRisks,
            monthlyPension: pension,
            monthlyIncome: incomeOut,
            monthlyExpense: expenseOut,
            monthlySurplus,
            totalAssets,
            totalLiabilities,
            netWorth: totalAssets - totalLiabilities,
            efCoverageMonths,
            efTarget,
            efCurrent,
            efMonthlyNeeded: number(ef.efMonthly),
            taxRegime:   appData.tax?.regime || 'new',
            is80CUsed:   (appData.tax?.deduction80C || 0) > 0,
            goals: (appData.goals || []).map(g => ({
                name:    g.name,
                target:  number(g.target),
                current: number(g.current),
                gap: Math.max(0, number(g.target) - number(g.current))
            })),
            lastPriceSync: appData.lastNavFetchTime || '',
            profile,
            classShares,
            capturedAt: new Date().toISOString()
        };
    }

    // ── What the book pays out ────────────────────────────────────────────────
    /* For an income goal this is THE number, and the prompt never had it: the
       only "income" it saw was the pension, so a reading told a retired saver
       that a maturing MIS "threatens the ₹22,000 monthly income" — which was
       the pension. Each payout is stated per its real period, with a monthly
       equivalent; anything that pays only at maturity is named as such; and a
       holding whose payout was never recorded is listed as unknown rather
       than guessed at. */
    const PERIODS = { monthly: 12, quarterly: 4, 'half-yearly': 2, halfyearly: 2, yearly: 1, annual: 1, annually: 1 };
    function payoutPicture(investments, valueOf) {
        const paying = [], atMaturity = [], unknown = [];
        for (const inv of investments) {
            if (inv.type === 'Recurring Deposit') continue; // only principal is confirmed
            const rate = Number(inv.rate) || 0;
            const scheme = window.CorpusSchemes?.match(inv) || null;
            const recorded = String(inv.payout || inv.payoutFrequency || '').toLowerCase();
            const schemeTerms = String(scheme?.payout || '').toLowerCase();
            const cumulative = /cumulative|maturity/.test(recorded) || (!recorded && /maturity/.test(schemeTerms));
            if (!rate && !scheme) continue;                       // not an interest-bearing holding
            if (cumulative) { atMaturity.push(inv.name); continue; }
            const periodKey = Object.keys(PERIODS).find(k => recorded.includes(k))
                           || (!recorded ? Object.keys(PERIODS).find(k => schemeTerms.startsWith(k)) : null);
            if (!periodKey || !rate) { unknown.push(inv.name); continue; }
            const perYear = PERIODS[periodKey];
            const principal = Number(inv.amount) || valueOf(inv) || 0;
            const perPeriod = Math.round(principal * rate / 100 / perYear);
            paying.push({ name: inv.name, perPeriod, period: periodKey.replace('annually', 'yearly').replace('annual', 'yearly'),
                          monthlyEq: Math.round(perPeriod * perYear / 12) });
        }
        return { paying, atMaturity, unknown, monthlyTotal: paying.reduce((a, p) => a + p.monthlyEq, 0) };
    }

    function payoutLines(snapshot) {
        const po = snapshot.payouts;
        if (!po || (!po.paying.length && !po.atMaturity.length && !po.unknown.length)) return '- **Indicative payouts from stated terms:** none recorded';
        const out = [`- **Indicative payouts from stated terms, NOT verified cash received:** about ₹${fmtIn(po.monthlyTotal)} a month equivalent`];
        for (const p of po.paying) out.push(`  - ${p.name}: ₹${fmtIn(p.perPeriod)} ${p.period} (≈ ₹${fmtIn(p.monthlyEq)} a month)`);
        if (po.atMaturity.length) out.push(`  - Pays only at maturity, not as income: ${po.atMaturity.join(', ')}`);
        if (po.unknown.length) out.push(`  - Payout frequency not recorded (do not assume one): ${po.unknown.join(', ')}`);
        return out.join('\n');
    }
    const fmtIn = n => Number(n || 0).toLocaleString('en-IN');

    // ── The person ─────────────────────────────────────────────────────────────
    /* Every reading used to be written for one imagined reader: a young equity
       investor. The same Broadcom verdict went to a retired parent whose money
       is in SCSS and a post office MIS and who wanted to know whether their
       monthly income is safe. The profile is what the reading is FOR. */
    // Profile v2: every money answer is per asset class, and several at once.
    const CLASSES = {
        in_stocks: 'Indian stocks', us_stocks: 'US stocks', mf: 'Mutual funds', gold: 'Gold', metals: 'Other metals',
        fd_bonds: 'FDs and bonds', schemes: 'Government schemes (PPF, EPF, SCSS, post office)', property: 'Property',
    };
    const MARKET = new Set(['in_stocks', 'us_stocks', 'mf', 'gold', 'metals']);
    const PURPOSE = { grow: 'growth', retirement: 'retirement', income: 'regular income', safe: 'keeping it safe',
                      emergency: 'emergency money', purchase: 'a big purchase', children: 'children’s future' };
    const FALL = { sell: 'sells some', wait: 'waits it out', buy: 'buys more' };
    const HORIZON = { trim: 'trimmed along the way', lt3: 'within 3 years', '3to7': 'in 3 to 7 years', '7to15': 'in 7 to 15 years', gt15: 'in 15+ years' };
    const PAYOUT = { monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly', none: 'none, let it grow' };
    const KNOWS = { new: 'new to it', some: 'a few years', long: 'many years', simple: 'wants it explained simply' };
    const INCOME = { salary: 'salary', business: 'business or freelance', rent: 'rent', pension: 'pension', dividends: 'interest and dividends', none: 'not earning yet' };
    const DEPENDENTS = { partner: 'partner', children: 'children', parents: 'parents', none: 'no one' };
    const COVER = { emergency: 'emergency fund', health: 'health insurance', term: 'term life cover', none: 'none yet' };
    const PLANS = { home: 'a home', education: 'education', wedding: 'a wedding', car: 'a car', travel: 'travel', nothing: 'nothing planned' };
    const PLAN_WHEN = { '1': 'in about a year', '2to3': 'in 2 to 3 years', '4to5': 'in 4 to 5 years', '5plus': 'in 5+ years' };
    // Kept for the exports other code imports.
    const GOALS = PURPOSE;

    function normProfile(p) {
        if (!p || !p.completedAt) return null;
        const age = Number(p.age);
        const list = (v, table) => (Array.isArray(v) ? v : []).filter(x => table[x]);
        const per = (obj, table, onlyMarket) => {
            const out = {};
            for (const k of Object.keys(CLASSES)) {
                if (onlyMarket && !MARKET.has(k)) continue;
                const v = list((obj || {})[k], table);
                if (v.length) out[k] = v;
            }
            return out;
        };
        const plans = {};
        for (const [k, v] of Object.entries(p.plans || {})) if (PLANS[k]) plans[k] = list(v, PLAN_WHEN);
        const payout = per(p.payout, PAYOUT);
        for (const [key, values] of Object.entries(payout)) if (values.length > 1) payout[key] = values.filter(x => x !== 'none');
        return {
            name: String(p.name || '').trim().slice(0, 40) || null,
            age: Number.isFinite(age) && age > 0 ? Math.round(age) : null,
            holdings: list(p.holdings, CLASSES),
            purpose: per(p.purpose, PURPOSE), fall: per(p.fall, FALL, true), horizon: per(p.horizon, HORIZON),
            payout, knows: per(p.knows, KNOWS),
            income: list(p.income, INCOME), dependents: list(p.dependents, DEPENDENTS), cover: list(p.cover, COVER), plans,
        };
    }

    const words = (vals, table) => (vals || []).map(v => table[v]).filter(Boolean);
    const joinAnd = arr => arr.length <= 1 ? (arr[0] || '') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;

    /* What "good" means for this person, asset by asset. The same holding is a
       fine position for one reader and a problem for another, and for one
       reader it can be fine in US shares and wrong in the emergency money. */
    function judgeRules(p, shares) {
        if (!p) return ['- No profile was given. Assume a balanced Indian investor, and say once that the reading would be sharper with their goals.'];
        const out = [];
        const share = k => (shares && shares[k] ? shares[k].pct : 0);
        for (const k of p.holdings) {
            const name = CLASSES[k].replace(/ \(.*\)$/, '');
            const purpose = p.purpose[k] || [], fall = p.fall[k] || [], when = p.horizon[k] || [], knows = p.knows[k] || [];
            if (fall.includes('sell') && share(k) > 30) out.push(`- ${name}: they would sell some after a 20% fall and it is ${share(k)}% of the book. Judge its drawdown risk first.`);
            if (fall.includes('buy')) out.push(`- ${name}: they would buy more after a fall. A drawdown in a well-supported holding here is an opportunity to name, not only a risk.`);
            if (MARKET.has(k) && k !== 'gold' && when.includes('lt3')) out.push(`- ${name}: some of it is needed within 3 years while it sits in a market-linked asset. Say how much a fall would cost that part.`);
            if (when.includes('trim')) out.push(`- ${name}: they trim along the way. Judge rebalancing points and the capital-gains tax on each trim.`);
            if (when.filter(w => w !== 'trim').length > 1) out.push(`- ${name}: it serves more than one date (${joinAnd(words(when, HORIZON))}). Split the judgment by date rather than averaging.`);
            if (purpose.includes('emergency') && MARKET.has(k)) out.push(`- ${name}: they count it as emergency money, but it moves with a market. Flag it.`);
            if (purpose.includes('income') || (p.payout[k] || []).some(v => v !== 'none')) out.push(`- ${name}: it should pay them ${joinAnd(words((p.payout[k] || []).filter(v => v !== 'none'), PAYOUT)) || 'regularly'}. Judge whether it reliably does, and what happens at a maturity or rate reset.`);
            if (purpose.includes('safe') && MARKET.has(k) && k !== 'gold') out.push(`- ${name}: they want it kept safe. A large or concentrated position here is a finding even when it is doing well.`);
            if (knows.includes('new') || knows.includes('simple')) out.push(`- ${name}: they are newer to it or want it simple. Define any term you use about it in plain words.`);
            else if (knows.includes('long')) out.push(`- ${name}: they have many years with it. Skip the basics.`);
        }
        if (p.dependents.some(d => d !== 'none') && !p.cover.includes('term')) out.push(`- ${joinAnd(words(p.dependents, DEPENDENTS))} depend on them and there is no term life cover. State that gap before anything about returns.`);
        if (!p.cover.includes('emergency')) out.push('- They have no emergency fund in place. Say how much of the book could serve as one without selling at a loss.');
        if (!p.cover.includes('health')) out.push('- No health insurance is in place. Name it as a gap once.');
        const soon = Object.entries(p.plans).filter(([k, v]) => k !== 'nothing' && v.some(w => w === '1' || w === '2to3'));
        if (soon.length) out.push(`- Coming up soon: ${joinAnd(soon.map(([k, v]) => `${PLANS[k]} ${joinAnd(words(v, PLAN_WHEN))}`))}. Check how much of the book can be reached by then without selling a fallen asset.`);
        if (p.income.includes('none')) out.push('- They are not earning yet: nothing new is coming in to top up the book.');
        else if (p.income.includes('business')) out.push('- Business or freelance income is uneven: weigh liquidity higher.');
        if (p.age && p.age >= 60) out.push('- They are a senior citizen: SCSS eligibility, the 80TTB deduction on interest, and liquidity for health costs are relevant.');
        if (p.holdings.includes('gold')) out.push('- They hold or want gold: use the metals data below whenever it bears on their position.');
        return out;
    }

    // The profile, printed next to what they actually hold in each class.
    function profileBlock(p, shares) {
        if (!p) return '## WHO THIS IS FOR\n- No profile given.\n' + judgeRules(null).join('\n');
        const lines = ['## WHO THIS IS FOR'];
        // The name is deliberately NOT sent. The screens promise "a summary,
        // never your name or account numbers", and nothing the model writes
        // needs it: a greeting is composed on the phone.
        if (p.age) lines.push(`- Age: ${p.age}`);
        if (p.income.length) lines.push(`- Income from: ${joinAnd(words(p.income, INCOME))}`);
        if (p.dependents.length) lines.push(`- Depend on them: ${joinAnd(words(p.dependents, DEPENDENTS))}`);
        if (p.cover.length) lines.push(`- Already in place: ${joinAnd(words(p.cover, COVER))}`);
        const plans = Object.entries(p.plans);
        if (plans.length) lines.push(`- Coming up: ${plans.map(([k, v]) => k === 'nothing' ? 'nothing planned' : `${PLANS[k]}${v.length ? ' ' + joinAnd(words(v, PLAN_WHEN)) : ''}`).join('; ')}`);
        lines.push('\n## EACH ASSET, AS THEY DESCRIBED IT (their answers, beside what they hold)');
        for (const k of p.holdings) {
            const s = shares && shares[k];
            const held = s && s.value > 0 ? `${s.pct}% of the book (₹${fmtIn(Math.round(s.value))})` : 'not held yet (they want it)';
            const bits = [];
            if ((p.purpose[k] || []).length) bits.push(`For: ${joinAnd(words(p.purpose[k], PURPOSE))}`);
            if ((p.fall[k] || []).length) bits.push(`After a 20% fall: ${joinAnd(words(p.fall[k], FALL))}`);
            if ((p.horizon[k] || []).length) bits.push(`Needed: ${joinAnd(words(p.horizon[k], HORIZON))}`);
            if ((p.payout[k] || []).length) bits.push(`Payouts: ${joinAnd(words(p.payout[k], PAYOUT))}`);
            if ((p.knows[k] || []).length) bits.push(`Knows it: ${joinAnd(words(p.knows[k], KNOWS))}`);
            lines.push(`- ${CLASSES[k]}: ${held}. ${bits.join('. ')}${bits.length ? '.' : ''}`);
        }
        lines.push('\n## HOW TO JUDGE THIS BOOK FOR THEM');
        lines.push(...judgeRules(p, shares));
        return lines.join('\n');
    }

    // ── Prompt Builder ─────────────────────────────────────────────────────────
    /* Every measured number the app could gather goes in here, and everything
       it could NOT gather is printed as "unavailable" rather than omitted.
       Omission is what invites a model to fill the gap from memory; a stated
       absence is a fact it can reason about. */

    const say = v => (v === null || v === undefined || v === '') ? 'unavailable' : v;
    const sign = v => (v === null || v === undefined) ? 'unavailable' : `${v >= 0 ? '+' : ''}${v}%`;
    const inr = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;

    /* Every price carries its currency. The dossier used to print bare numbers
       — "Price 362.66 | 200DMA 311.30" — next to a position line in rupees, and
       the model did the only thing it could: it put a rupee sign on all of
       them and reported Broadcom trading at ₹45,304. The symbol now comes from
       the exchange (meta.currency), not from the holding's type. */
    const sym = cur => cur === 'USD' ? '$' : cur === 'INR' ? '₹' : (cur ? cur + ' ' : '');
    const price = (v, cur) => (v === null || v === undefined) ? 'unavailable' : `${sym(cur)}${v}`;

    function newsLines(h) {
        return (h.news && h.news.length)
            ? `- Recent headlines:\n${h.news.map(n => `    • ${n.title}${n.at ? ` (${n.at}${n.publisher ? ', ' + n.publisher : ''})` : ''}`).join('\n')}`
            : '- Recent headlines: none retrieved';
    }

    function holdingDossier(h) {
        const p = h.price, f = h.fundamentals;
        const cur = p?.currency || (h.market === 'US' ? 'USD' : 'INR');
        const lines = [`### ${h.name}${h.ticker ? ` (${h.ticker}, ${h.market})` : ''} — quoted in ${cur}`];
        lines.push(`- Position: ${Number(h.invested) > 0 ? `invested ${inr(h.invested)}` : 'cost basis pending'}, now worth ${inr(h.value)} (portfolio values are always INR)`);
        if (p) {
            lines.push(`- Price ${price(p.last, cur)} | 50DMA ${price(p.ma50, cur)} (${sign(p.vsMa50)}) | 200DMA ${price(p.ma200, cur)} (${sign(p.vsMa200)})`);
            lines.push(`- 52-week ${price(p.low52, cur)}–${price(p.high52, cur)}; sitting at ${say(p.bandPos)}% of that band; ${sign(p.drawdown)} from the high`);
            lines.push(`- Momentum: 30d ${sign(p.ret30)}, 90d ${sign(p.ret90)}; annualised volatility ${say(p.volatility)}%`);
        } else {
            lines.push('- Price history: unavailable (do not infer trend, momentum or moving averages)');
        }
        if (h.benchmark) {
            lines.push(`- Its market over the same year: ${h.benchmark.name} ${sign(h.benchmark.ret1y)}`);
        }
        if (f) {
            lines.push(`- Business: ${say(f.sector)} / ${say(f.industry)}; revenue ${f.revenue ? '$' + (f.revenue / 1e6).toFixed(1) + 'B' : 'unavailable'}, growth ${sign(f.revenueGrowth)}, gross margin ${sign(f.grossMargin)}`);
            lines.push(`- Valuation: market cap ${say(f.marketCap)}, dividend ${price(f.dividend, cur)}, yield ${sign(f.yield)}`);
            // The line whose absence produced the wrong answer.
            lines.push((f.buy !== null || f.consensus)
                ? `- **Analyst view: ${say(f.consensus)}** — ${say(f.buy)} buy, ${say(f.hold)} hold, ${say(f.sell)} sell. `
                  + `Mean target ${price(f.targetMean, cur)} (range ${price(f.targetLow, cur)}–${price(f.targetHigh, cur)}). `
                  + `${say(f.analystNote)}${f.brokers.length ? ' Covering: ' + f.brokers.join(', ') + '.' : ''}`
                : '- Analyst view: unavailable');
        } else {
            lines.push(h.market === 'US'
                ? '- Fundamentals and analyst view: could not be retrieved for this holding (do not state a PE, margin, growth rate, price target or rating)'
                : '- Fundamentals and analyst view: NOT AVAILABLE for Indian listings in this app (do not state a PE, margin, growth rate, price target or rating, and do not substitute the price trend for a rating)');
        }
        lines.push(newsLines(h));
        return lines.join('\n');
    }

    /* A fund is not a thin stock. It has no PE and no analyst rating, but it
       has thirteen years of NAV and a benchmark, which together answer the only
       question that matters about it: did it beat the market it invests in. */
    function fundDossier(h) {
        const n = h.nav;
        const lines = [`### ${h.name} (mutual fund, INR)`];
        lines.push(`- Position: ${Number(h.invested) > 0 ? `invested ${inr(h.invested)}` : 'cost basis pending'}, now worth ${inr(h.value)}`);
        if (!n) {
            lines.push('- NAV history: unavailable (do not state returns, ranking or performance)');
            lines.push(newsLines(h));
            return lines.join('\n');
        }
        lines.push(`- Category: ${say(n.category)} · ${say(n.house)}`);
        lines.push(`- NAV ₹${n.nav} as of ${n.navDate} (AMFI publishes once per business day, after close — an older date is the calendar, not a failure)`);
        lines.push(`- Returns: 1M ${sign(n.ret1m)}, 3M ${sign(n.ret3m)}, 6M ${sign(n.ret6m)}, 1Y ${sign(n.ret1y)}`);
        lines.push(`- Longer run (CAGR, not total): 3Y ${sign(n.cagr3y)}, 5Y ${sign(n.cagr5y)}`);
        lines.push(`- ${sign(n.drawdown)} from its all-time NAV peak; annualised volatility ${say(n.volatility)}%`);
        if (h.benchmark) {
            const diff = (n.ret1y !== null && h.benchmark.ret1y !== null)
                ? Math.round((n.ret1y - h.benchmark.ret1y) * 10) / 10 : null;
            lines.push(`- **Against its market: ${h.benchmark.name} ${sign(h.benchmark.ret1y)} over the same year`
                     + `${diff === null ? '' : ` — this fund is ${diff >= 0 ? 'ahead by' : 'behind by'} ${Math.abs(diff)} points`}.**`);
        } else {
            lines.push('- Benchmark comparison: unavailable this run');
        }
        lines.push(newsLines(h));
        return lines.join('\n');
    }

    function researchBlock(pack) {
        if (!pack) {
            return '## RESEARCH\nNo research could be gathered this run (the device may be offline). '
                 + 'Do NOT supply prices, valuations, moving averages, price targets or news from memory. '
                 + 'Restrict the analysis to the portfolio structure above and say plainly that market research was unavailable.';
        }
        const out = [];
        const t = pack.tilt;
        out.push('## WHERE THIS PORTFOLIO LIVES');
        out.push(`- ${t.indianPct}% of value is Indian, ${t.usPct}% is US. Tilt: **${t.tilt}**.`);
        out.push(t.tilt === 'india'
            ? '- Weight the macro reasoning toward India: RBI policy, the Budget and tax rules, SEBI changes, and domestic sector news.'
            : t.tilt === 'international'
                ? '- Weight the macro reasoning toward the US: Fed policy, the dollar, and US sector news. Note INR/USD exposure explicitly.'
                : '- The book straddles both markets, so cover Indian AND US drivers, and say which side each point applies to.');

        if (pack.holdings.length || (pack.funds || []).length) {
            out.push('\n## HOLDING-BY-HOLDING EVIDENCE');
            out.push('Every figure below was measured. A field marked "unavailable" was NOT measured — treat it as unknown, never as zero, never as average, and never as a reason to reach for the price trend instead.');
            out.push('Prices are stated in the currency the exchange quotes them in, marked on each heading. Portfolio values are INR.');
            if (pack.holdings.length) out.push(pack.holdings.map(holdingDossier).join('\n\n'));
            if ((pack.funds || []).length) out.push(pack.funds.map(fundDossier).join('\n\n'));
        }
        if (pack.unquoted.length) {
            out.push('\n## HOLDINGS WITH NO MARKET QUOTE');
            out.push('These do not trade, so they have no price, PE, moving average, momentum or benchmark. Reason about them on rate, tenure, payout and liquidity ONLY, and do not give them a market verdict they cannot have.');
            out.push(pack.unquoted.map(unquotedLine).join('\n'));
        }
        out.push(schemesBlock(pack));
        if (pack.metals) out.push(metalsBlock(pack.metals));

        const macroFeeds = [...(pack.macro.india || []), ...(pack.macro.profile || []), ...(pack.macro.international || [])]
            .filter(f => f.items.length);
        out.push('\n## MARKET AND POLICY NEWS');
        out.push(macroFeeds.length
            ? macroFeeds.map(f => `### ${f.source}\n${f.items.map(i => `- ${i.title}${i.at ? ` (${i.at})` : ''}`).join('\n')}`).join('\n\n')
            : 'None retrieved. Say so rather than describing the macro backdrop from memory.');

        out.push(`\n_Research coverage: ${pack.coverage.studied}/${pack.coverage.requested} holdings priced, `
               + `${pack.coverage.withFundamentals} with fundamentals, ${pack.coverage.withAnalystView} with an analyst view, `
               + `${pack.coverage.withNews} with headlines, ${pack.coverage.withBenchmark} benchmark(s)._`);
        return out.join('\n');
    }

    function unquotedLine(u) {
        const parts = [`- ${u.name} (${u.type}): ₹${Number(u.value || 0).toLocaleString('en-IN')}`];
        if (u.rate) parts.push(`rate ${u.rate}%`);
        if (u.payout) parts.push(`pays ${String(u.payout).toLowerCase()}`);
        if (u.maturityDate) parts.push(`matures ${u.maturityDate}${Number.isFinite(u.daysToMaturity) ? ` (${u.daysToMaturity < 0 ? 'already matured' : `in ${u.daysToMaturity} days`})` : ''}`);
        if (u.scheme) {
            const sc = u.scheme;
            parts.push(`— this is ${sc.name}: the government rate today is ${sc.currentRate === null ? (sc.note || 'market-linked') : sc.currentRate + '%'}`
                + `${sc.rateLocks ? ' (locked at opening, so a newer rate does not change this holding)' : ' (floats — a rate change applies to the whole balance)'}`
                + `, ${sc.payout}, lock-in ${sc.lockIn}`);
        }
        return parts.join(', ');
    }

    /* The small-savings table, so a reading can say "you qualify for SCSS at
       8.2%, paid quarterly" instead of nothing — and, when the quarter has
       passed, says the rates may have changed rather than quoting them. */
    function schemesBlock(pack) {
        const S = window.CorpusSchemes;
        if (!S) return '';
        const st = pack.schemes || S.status();
        const rows = S.SCHEMES.filter(x => x.rate !== null).map(x =>
            `- ${x.name}: ${x.rate}% · ${x.payout} · lock-in ${x.lockIn} · ${x.limit}${x.eligibility ? ` · ${x.eligibility}` : ''}${x.rateNote ? ` · ${x.rateNote}` : ''}`);
        return `\n## GOVERNMENT SCHEMES — CURRENT TERMS\n${st.note}${st.current ? '' : ' Say so if you cite any of these.'}\n${rows.join('\n')}`;
    }

    function metalsBlock(m) {
        const lines = ['\n## GOLD AND SILVER TODAY'];
        const fxNote = m.fxEstimated ? ' (the USD/INR rate is an estimate today)' : '';
        if (m.gold) lines.push(`- Gold (international spot): $${m.gold.usdPerOz}/oz ≈ ₹${m.gold.inrPer10g ? m.gold.inrPer10g.toLocaleString('en-IN') : 'unavailable'} per 10g at ₹${m.fx}/$${fxNote}; 30d ${sign(m.gold.ret30)}, 1y ${sign(m.gold.ret1y)}, ${sign(m.gold.drawdown)} from its 52-week high, ${sign(m.gold.vsMa200)} vs its 200DMA`);
        if (m.silver) lines.push(`- Silver (international spot): $${m.silver.usdPerOz}/oz ≈ ₹${m.silver.inrPerKg ? m.silver.inrPerKg.toLocaleString('en-IN') : 'unavailable'} per kg; 30d ${sign(m.silver.ret30)}, 1y ${sign(m.silver.ret1y)}, ${sign(m.silver.drawdown)} from its 52-week high`);
        if (m.goldEtf) lines.push(`- GOLDBEES (tracks the Indian gold price): ₹${m.goldEtf.last}; 30d ${sign(m.goldEtf.ret30)}, 1y ${sign(m.goldEtf.ret1y)}`);
        if (m.silverEtf) lines.push(`- SILVERBEES (tracks the Indian silver price): ₹${m.silverEtf.last}; 30d ${sign(m.silverEtf.ret30)}, 1y ${sign(m.silverEtf.ret1y)}`);
        lines.push('- Spot converted at the exchange rate runs BELOW what an Indian buyer pays, because the Indian price carries import duty and GST. Quote the ₹ figure as "about", and use the ETF moves for the Indian trend.');
        return lines.join('\n');
    }

    // Constructs structured decision support from the current portfolio and verified headlines.
    function buildPrompt(snapshot, pack) {
        const fmt = n => Number(n || 0).toLocaleString('en-IN');

        // Portfolio allocation narrative
        const allocationLines = Object.entries(snapshot.allocationPct)
            .map(([t, pct]) => `  - ${t}: ${pct}% (₹${fmt(snapshot.breakdown[t])})`)
            .join('\n') || '  - No investments recorded yet';
        const holdingLines = snapshot.holdings
            .map(holding => `  - ${holding.name}${holding.ticker ? ` (${holding.ticker})` : ''}: current ₹${fmt(holding.marketValue)}, ${!holding.marketLinked ? 'a balance (no gain to report)' : holding.invested === null ? 'buy price not recorded, so no gain is known' : `invested ₹${fmt(holding.invested)}, gain ${holding.pnlPct >= 0 ? '+' : ''}${holding.pnlPct}%`}`)
            .join('\n') || '  - No holdings recorded yet';

        return `${MARK_ANALYSIS}
You are a concise research analyst for an Indian investor. Consider all supplied evidence before deciding. Never invent a price, analyst forecast, revenue figure, interest rate, company outlook, product innovation, or news item.

${profileBlock(snapshot.profile, snapshot.classShares)}

## USER PORTFOLIO PROFILE
- **Market-linked holdings (stocks, ETFs, funds, gold) with a recorded buy price:** invested ₹${fmt(snapshot.totalInvested)}, worth ₹${fmt(snapshot.pricedValue)} now, ${snapshot.marketGain >= 0 ? 'a gain' : 'a loss'} of ₹${fmt(Math.abs(Math.round(snapshot.marketGain)))}${snapshot.marketGainPct === null ? '' : ` (${snapshot.marketGainPct >= 0 ? '+' : ''}${snapshot.marketGainPct}%)`}. These are computed exactly; quote them as given and never recompute invested, value or gain from other lines.
${snapshot.costUnknown.length ? `- **Left out of that gain (no buy price recorded):** ${snapshot.costUnknown.join(', ')}. Do not guess their gain.
` : ''}- **Balances (EPF, PPF, deposits, schemes, bonds):** ₹${fmt(snapshot.balancesValue)}. These are savings balances, not money invested for a gain; never add them to the invested total.
- **Everything held, at today's value:** ₹${fmt(snapshot.totalMarketValue)}
- **Number of Holdings:** ${snapshot.holdingsCount}
- **Asset Allocation:**
${allocationLines}
- **Largest Holdings:**
${holdingLines}
- **Concentration Risks:** ${snapshot.concentrationRisks.length > 0 ? snapshot.concentrationRisks.join(', ') : 'None detected'}
- **Monthly Pension Income:** ₹${fmt(snapshot.monthlyPension)}
- **Monthly Total Income (salary, pension and other recorded income):** ₹${fmt(snapshot.monthlyIncome)}
${payoutLines(snapshot)}
- **Requested payout frequencies versus recorded holdings:** ${snapshot.payoutFit.length ? snapshot.payoutFit.join(' | ') : 'No payout frequency requested or profile unavailable'}. Name any gap briefly; do not invent paid income or promise a return.
- **India inflation planning assumption:** ${snapshot.cpi ? `${snapshot.cpi.rate}% for ${snapshot.cpi.referenceMonth}, published ${snapshot.cpi.releasedOn}${snapshot.cpi.stale ? ' (stale/offline last available)' : ''}` : 'Unavailable'}. Monthly official CPI is a context assumption, not measured real portfolio return.
- **Monthly Expenses:** ₹${fmt(snapshot.monthlyExpense)}
- **Monthly surplus from recorded income alone:** ₹${fmt(snapshot.monthlySurplus)}
- **Hypothetical surplus IF all stated payout terms are honored:** ₹${fmt(snapshot.monthlySurplus + (snapshot.payouts?.monthlyTotal || 0))}. Do not call this confirmed cash flow or use it to dismiss an income gap.
- **Net Worth:** ₹${fmt(snapshot.netWorth)} (Assets ₹${fmt(snapshot.totalAssets)} − Liabilities ₹${fmt(snapshot.totalLiabilities)})
- **Emergency Fund:** ${snapshot.efCoverageMonths} months covered (target: ${Math.round(snapshot.efTarget / Math.max(snapshot.efMonthlyNeeded, 1))} months)
- **Tax Regime:** ${snapshot.taxRegime}
- **Section 80C Utilised:** ${snapshot.is80CUsed ? 'Yes' : 'No'}
- **Other deductions (80TTB, 80D, 80CCD and so on):** NOT recorded in this app. Never state that one is or is not being claimed; say "check whether" instead.
- **Active Financial Goals:** ${snapshot.goals.length > 0 ? snapshot.goals.map(g => `${g.name} (target ₹${fmt(g.target)}, saved ₹${fmt(g.current)})`).join('; ') : 'None set'}

${researchBlock(pack)}

## WHAT TO RETURN
1. "fit": one sentence on how this book serves THIS person's goals overall, and a status: on-track, drifting or off-track.
1b. "classFit": one entry per asset class listed under EACH ASSET, judged against THAT class's own answers (its purpose, what they would do in a fall, when it is needed, payouts), not the average. Use the class name exactly as listed, a status, and one sentence of at most 25 words that cites what they hold.
2. "findings": the things that genuinely matter for them, most important first. THE BAR: include a finding only if it would change a decision toward or away from their goal — a payout at risk, a deposit maturing or a rate resetting, a concentration, a clear analyst or price signal, a scheme they qualify for and are not using, a tax point. Anything that clears the bar MUST be included, however many that is; anything that does not clear it is left out. No filler, no generic advice ("diversify", "review regularly"), no restating the numbers without a consequence. Each finding cites the measured fact it rests on and names the holdings it concerns.
3. "holdings": one short line per holding — Buy, Hold or Trim for traded holdings and funds, from their evidence; Keep or Review for deposits and schemes, from rate, tenure and payout. This list sits collapsed under the findings, so keep each line under 20 words.
HOW TO WEIGH THE EVIDENCE: for stocks, weigh analyst consensus and target, revenue and margins, company outlook and innovation, recent verified news, valuation and price risk. For funds, weigh NAV history against the benchmark. For deposits and schemes, weigh rate, payout, lock-in and maturity against the government terms. For gold and silver, weigh the price trend and the share of the book. Use only fields actually supplied; if a factor is missing, omit it, and do not infer analyst sentiment from a price fall. Price units must match the quoted currency.

Respond ONLY with compact valid JSON:
{"fit":{"status":"on-track|drifting|off-track","line":"One sentence against their goals"},"classFit":[{"class":"Exact class name from EACH ASSET","status":"on-track|drifting|off-track","line":"At most 25 words"}],"findings":[{"priority":1,"kind":"risk|opportunity|income|allocation|tax|rate","figure":"The one number the finding turns on, as the reader would say it (94%, ₹6.2 L, 23 days), or empty string","title":"At most 8 words, reading on from the figure when there is one","why":"At most 40 words, citing the measured fact","consider":"At most 25 words: what to weigh, not an order","holdings":["names it concerns"],"evidence":["up to two measured facts"]}],"holdings":[{"name":"Exact holding name","verdict":"Buy|Hold|Trim","summary":"At most 20 words"}],"macroContext":"One short sentence grounded in supplied news, or empty string"}`;
    }

    // ── The daily brief ────────────────────────────────────────────────────────
    /* The card under the AI card. One request per person per day, prepared on
       the first open of the day: neither a web app nor a closed Android app can
       wake itself at a fixed hour, so it says when it was prepared instead of
       claiming "this morning". */
    function trendLines(history) {
        const pts = (Array.isArray(history) ? history : [])
            .filter(h => h && h.date && Number.isFinite(Number(h.value)))
            .sort((a, b) => a.date < b.date ? -1 : 1);
        if (pts.length < 2) return '- Not enough history yet to say how the book moved.';
        const last = pts[pts.length - 1];
        const before = pts[pts.length - 2];
        const back = days => {
            const cut = new Date(Date.parse(last.date) - days * 86400000).toISOString().slice(0, 10);
            return [...pts].reverse().find(p => p.date <= cut) || null;
        };
        const move = p => p && Number(p.value) > 0
            ? `${Number(last.value) >= Number(p.value) ? '+' : ''}${(((Number(last.value) - Number(p.value)) / Number(p.value)) * 100).toFixed(2)}% (₹${Math.round(Number(last.value) - Number(p.value)).toLocaleString('en-IN')}) since ${p.date}`
            : null;
        // Change in the TOTAL corpus, contributions included — the same honesty
        // rule as the chart: a deposit is not growth.
        return [`- Total corpus on ${last.date}: ₹${Math.round(Number(last.value)).toLocaleString('en-IN')} (contributions included, so a rise may be new money, not growth)`,
                move(before) && `- ${move(before)}`, move(back(7)) && `- ${move(back(7))}`, move(back(30)) && `- ${move(back(30))}`]
            .filter(Boolean).join('\n');
    }

    function buildDailyPrompt(snapshot, pack, history, today) {
        const p = snapshot.profile;
        const allocation = Object.entries(snapshot.allocationPct).map(([t, pct]) => `${t} ${pct}%`).join(', ') || 'no holdings yet';
        const maturing = (pack?.unquoted || []).filter(u => Number.isFinite(u.daysToMaturity) && u.daysToMaturity <= 60);
        return `${MARK_DAILY}
You write a short morning brief for one Indian investor, from the evidence below only. Never invent a price, rate or news item.

${profileBlock(p, snapshot.classShares)}

## THEIR BOOK TODAY (${today})
- Value ₹${Math.round(snapshot.totalMarketValue).toLocaleString('en-IN')} across ${snapshot.holdingsCount} holdings: ${allocation}
${payoutLines(snapshot)}
${trendLines(history)}
${maturing.length ? maturing.map(u => `- MATURING: ${u.name} ${u.daysToMaturity < 0 ? 'has matured' : `in ${u.daysToMaturity} days`} (₹${Number(u.value || 0).toLocaleString('en-IN')})`).join('\n') : '- Nothing matures in the next 60 days.'}
${pack ? researchBlock(pack) : '## RESEARCH\nNo research could be gathered today. Do not describe markets, prices or news from memory.'}

## WHAT TO WRITE
A short greeting line with no name in it, then the few items that matter TODAY for their goal — usually three to five. Prefer: what changed since yesterday; a price or rate that bears on something they hold or asked to watch (gold, schemes, FDs); a maturity coming up; a scheme they qualify for; one concrete step toward their goal. If little happened, write fewer items rather than filler. Each body is at most 30 words and states the measured fact.

Respond ONLY with compact valid JSON:
{"greeting":"One line","items":[{"kind":"news|rate|price|action|reminder","title":"At most 8 words","body":"At most 30 words"}]}`;
    }

    // ── Helper: JSON Response Cleaner & Parser ────────────────────────────────
    function parseJSONResponse(text) {
        if (!text) throw new Error('AI returned an empty response. Please retry.');
        const clean = text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .trim();
        try {
            return JSON.parse(clean);
        } catch (e) {
            const first = firstObject(clean);
            if (first) {
                try { return JSON.parse(first); } catch (_) {}
            }
            throw new Error(`Corpus AI did not return usable JSON. Please re-run: ${e.message}`);
        }
    }

    /* The first COMPLETE top-level object in a reply. "First { to last }" was
       the old fallback, and a model that wrote its JSON and then a second
       object or a closing remark after it produced a slice containing both —
       measured live: "Unexpected non-whitespace character after JSON at
       position 4396". Braces inside strings are skipped. */
    function firstObject(text) {
        const start = text.indexOf('{');
        if (start < 0) return null;
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < text.length; i++) {
            const c = text[i];
            if (inStr) {
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === '"') inStr = false;
            } else if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
        }
        return null;
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = 35000) {
        // The Android service owns the POST after it starts. Its result is
        // stored natively, so minimizing the Activity does not lose the reply
        // even if the WebView's JavaScript is suspended until the user returns.
        if (options.method === 'POST' && window.AppPlugins?.AnalysisJob
            && window.AppPlugins?.Capacitor?.isNativePlatform?.()) {
            const job = await window.AppPlugins.AnalysisJob.start({
                url, body: options.body, headers: options.headers || {}
            });
            options.onStarted?.(job.id);
            const deadline = Date.now() + timeoutMs + 10000;
            while (true) {
                const state = await window.AppPlugins.AnalysisJob.status();
                if (state.id !== job.id) throw new Error('A newer AI analysis replaced this request.');
                if (state.state === 'done' || state.state === 'error') {
                    return {
                        ok: state.state === 'done' && state.statusCode < 400,
                        status: state.statusCode,
                        json: async () => state.body ? JSON.parse(state.body) : { error: { message: state.error } },
                        text: async () => state.body || state.error || ''
                    };
                }
                if (Date.now() > deadline) throw new Error('AI request timed out. Try a faster model.');
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        // When running in Capacitor on native Android, use CapacitorHttp to eliminate CORS / Origin blocks
        if (window.AppPlugins?.CapacitorHttp && window.AppPlugins?.Capacitor?.isNativePlatform?.()) {
            try {
                const method = (options.method || 'GET').toUpperCase();
                const headers = options.headers || {};
                let data = undefined;
                if (options.body) {
                    try {
                        data = JSON.parse(options.body);
                    } catch {
                        data = options.body;
                    }
                }
                let timer;
                const res = await Promise.race([window.AppPlugins.CapacitorHttp.request({
                    url,
                    method,
                    headers,
                    data,
                    connectTimeout: timeoutMs,
                    readTimeout: timeoutMs
                }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('AI request timed out. Try a faster model.')), timeoutMs); })]);
                clearTimeout(timer);
                return {
                    ok: res.status >= 200 && res.status < 300,
                    status: res.status,
                    json: async () => res.data,
                    text: async () => typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
                };
            } catch (nativeErr) {
                throw nativeErr;
            }
        }

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            return await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
        } catch (error) {
            if (controller?.signal.aborted) throw new Error('AI request timed out. Try a faster model.');
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function managedEndpoint() {
        const endpoint = String(window.CorpusAiConfig?.endpoint || '').trim();
        if (!/^https:\/\//i.test(endpoint) || endpoint.includes('YOUR-WORKER') || endpoint.includes('YOUR_SUBDOMAIN')) {
            throw new Error('Corpus AI is being set up. Please try again after the app service is connected.');
        }
        return endpoint;
    }

    async function callManagedLLM(prompt, options = {}) {
        const res = await fetchWithTimeout(managedEndpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Corpus-Client': 'android-webview' },
            onStarted: options.onStarted,
            body: JSON.stringify({ prompt })
        // The gateway may spend up to 85s across two model batches, so the
        // phone must outwait it; at 35s it gave up while a model was still
        // writing the answer.
        }, GATEWAY_WAIT_MS);
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            if (err?.error?.detail) console.warn('[RegenWealth] gateway detail:', JSON.stringify(err.error.detail));
            throw new Error(err?.error?.message || 'Corpus AI is temporarily unavailable. Please try again shortly.');
        }
        const data = await res.json();
        return parseJSONResponse(data?.choices?.[0]?.message?.content);
    }

    async function analyzeManaged(appData, onProgress = () => {}, opts = {}) {
        if (window.AppPlugins?.AnalysisJob && window.AppPlugins?.Capacitor?.isNativePlatform?.()) {
            try { await window.AppPlugins.AnalysisJob.prepare(); }
            catch (e) { console.warn('[RegenWealth] background preparation unavailable:', e); }
        }

        onProgress('Reading your portfolio snapshot...');
        const snapshot = buildPortfolioSnapshot(appData);
        onProgress('Researching your holdings — prices, valuation, news…');
        let pack = null;
        try {
            if (window.CorpusResearch) pack = await window.CorpusResearch.buildPack(appData, onProgress,
                { profile: snapshot.profile, reuse: !!opts.reuse });
        } catch (e) {
            console.warn('[RegenWealth] research pass failed:', e && e.message);
        }

        const cov = pack ? pack.coverage : null;
        onProgress(cov
            ? `Building the brief (${cov.studied}/${cov.requested} holdings studied, ${cov.withNews} with news)…`
            : 'Building the brief (no research available)…');
        const prompt = buildPrompt(snapshot, pack);
        onProgress('Analyzing your portfolio...');

        let startedJobId = null;
        try {
            const result = await callManagedLLM(prompt, {
                onStarted: id => {
                    startedJobId = id;
                    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ id, provider: 'managed', snapshot, pack, providerLabel: 'Corpus AI', startedAt: Date.now() })); }
                    catch (_) { /* The active session can still finish. */ }
                }
            });
            return finishAnalysis(result, snapshot, pack, 'Corpus AI', appData);
        } finally {
            try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
            if (startedJobId) {
                try { await window.AppPlugins.AnalysisJob.clear({ id: startedJobId }); } catch (_) {}
            }
        }
    }

    /* A verdict on something the person does not own is worse than no verdict:
       measured live, a book with no PPF came back with "Public Provident Fund —
       Keep", taken from the scheme table in the prompt. Names are matched
       loosely (the model writes "Broadcom (AVGO)" for "Broadcom"), but a name
       that matches nothing held is dropped. */
    function ownedMatcher(appData, snapshot, pack) {
        const owned = (appData?.investments || []).map(i => ({
            name: String(i.name || '').toLowerCase().trim(), ticker: String(i.ticker || '').toLowerCase().replace(/\.(ns|bo)$/, ''),
        })).filter(o => o.name || o.ticker);
        // Recovery after the app was reopened has no app data: the research
        // pack lists every holding, the snapshot only the largest eight.
        if (!owned.length) [...(pack?.holdings || []), ...(pack?.funds || []), ...(pack?.unquoted || []), ...(snapshot?.holdings || [])]
            .forEach(h => owned.push({ name: String(h.name || '').toLowerCase(), ticker: String(h.ticker || '').toLowerCase() }));
        // Nothing known to compare against: this check cannot judge, so it
        // must not delete a real answer.
        if (!owned.length) return () => true;
        return label => {
            const l = String(label || '').toLowerCase().trim();
            if (!l) return false;
            return owned.some(o => (o.name && (l.includes(o.name) || o.name.includes(l)))
                                || (o.ticker && new RegExp(`\\b${o.ticker.replace(/[^a-z0-9]/g, '')}\\b`).test(l)));
        };
    }

    function finishAnalysis(raw, snapshot, pack, providerLabel, appData) {
        const result = validateAnalysis(raw);
        const owns = ownedMatcher(appData, snapshot, pack);
        result.holdings = result.holdings.filter(h => owns(h.name) || owns(h.ticker));
        for (const f of result.findings) f.holdings = f.holdings.filter(owns);
        if (result.holdings.length && pack) {
            const weight = new Map([...(pack.holdings || []), ...(pack.funds || [])]
                .map(h => [String(h.name || '').toLowerCase(), h.value || 0]));
            result.holdings.sort((a, b) =>
                (weight.get(String(b.name || '').toLowerCase()) || 0)
              - (weight.get(String(a.name || '').toLowerCase()) || 0));
        }
        const analysis = {
            ...result, portfolioSnapshot: snapshot, research: pack,
            newsSources: pack ? researchSources(pack) : [], providerUsed: providerLabel,
            portfolioFingerprint: snapshotFingerprint(snapshot, pack),
            timestamp: new Date().toISOString()
        };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(analysis)); } catch (_) {}
        return analysis;
    }

    // A WebView recreated while the native request was running can still read
    // the finished result. The pending record holds context, never the API key.
    async function recoverPending(onProgress = () => {}) {
        if (!window.AppPlugins?.AnalysisJob || !window.AppPlugins?.Capacitor?.isNativePlatform?.()) return null;
        let pending;
        try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (_) { return null; }
        if (!pending?.id) return null;
        try {
            onProgress('Finishing your analysis…');
            // Matches the native read timeout, which outwaits both gateway batches.
            const deadline = pending.startedAt + GATEWAY_WAIT_MS + 10000;
            while (true) {
                const state = await window.AppPlugins.AnalysisJob.status();
                if (state.id !== pending.id) throw new Error('Analysis was interrupted. Please run it again.');
                if (state.state === 'error') throw new Error(state.error || 'AI provider returned an error. Please retry.');
                if (state.state === 'done') {
                    let body = {};
                    try { body = JSON.parse(state.body || '{}'); } catch (_) { /* reported below */ }
                    // The gateway's own sentence, not a bare status code: it
                    // distinguishes "busy" from "limit reached" from "update the app".
                    if (state.statusCode >= 400) throw new Error(body?.error?.message || 'Corpus AI is temporarily unavailable. Please try again shortly.');
                    return finishAnalysis(parseJSONResponse(body.choices?.[0]?.message?.content), pending.snapshot, pending.pack, pending.providerLabel);
                }
                if (Date.now() > deadline) throw new Error('Analysis timed out. Please run it again.');
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } finally {
            try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
            try { await window.AppPlugins.AnalysisJob.clear({ id: pending.id }); } catch (_) {}
        }
    }

    /* What the pack actually managed to gather, for the UI to show under the
       reading. "3 sources" is worth nothing if two of them returned nothing. */
    function researchSources(pack) {
        const out = [];
        for (const f of (pack.macro?.india || [])) out.push({ source: f.source, count: f.items.length });
        for (const f of (pack.macro?.profile || [])) out.push({ source: f.source, count: f.items.length });
        for (const f of (pack.macro?.international || [])) out.push({ source: f.source, count: f.items.length });
        const tickerNews = (pack.holdings || []).reduce((n, h) => n + (h.news || []).length, 0);
        if (tickerNews) out.push({ source: 'Holding headlines', count: tickerNews });
        return out;
    }

    /* The parser used to accept anything JSON-shaped. A model returning `{}`,
       or an object with no recommendations, rendered as a blank card with no
       error — indistinguishable from a working app with nothing to say. */
    const VERDICTS = ['Buy', 'Hold', 'Trim', 'Keep', 'Review'];
    const FIT = ['on-track', 'drifting', 'off-track'];
    const KINDS = ['risk', 'opportunity', 'income', 'allocation', 'tax', 'rate'];
    const brief = (value, words) => String(value || '').trim().split(/\s+/).slice(0, words).join(' ');

    function validateAnalysis(result) {
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            throw new Error('The model did not return an analysis object. Please re-run.');
        }
        /* Every valid finding is kept, however many there are: the prompt sets
           an importance bar rather than a count, and trimming here would drop
           exactly the item the bar said must be included. A finding without a
           reason is not a finding and is dropped. */
        const findings = (Array.isArray(result.findings) ? result.findings : [])
            .filter(f => f && typeof f === 'object' && (f.title || f.why) && f.why)
            .map((f, i) => ({
                priority: Number.isFinite(Number(f.priority)) ? Number(f.priority) : i + 1,
                kind: KINDS.includes(f.kind) ? f.kind : 'allocation',
                figure: typeof f.figure === 'string' && f.figure.trim().length <= 14 ? f.figure.trim() : '',
                title: brief(f.title || f.why, 10),
                why: brief(f.why, 45),
                consider: brief(f.consider, 28),
                holdings: (Array.isArray(f.holdings) ? f.holdings : []).filter(h => typeof h === 'string').slice(0, 4),
                evidence: (Array.isArray(f.evidence) ? f.evidence : []).slice(0, 2).map(e => brief(e, 12)),
            }))
            .sort((x, y) => x.priority - y.priority);

        const holdings = (Array.isArray(result.holdings) ? result.holdings : [])
            .filter(h => h && typeof h === 'object' && (h.name || h.ticker) && (h.summary || h.rationale))
            .map(h => {
                let v = h.verdict;
                if (v === 'Add') v = 'Buy';
                if (v === 'Watch') v = 'Hold';
                if (v === 'Exit') v = 'Trim';
                return { name: h.name || h.ticker, ticker: h.ticker || '', verdict: VERDICTS.includes(v) ? v : 'Hold',
                         summary: brief(h.summary || h.rationale, 22) };
            });

        if (!findings.length && !holdings.length) {
            throw new Error('The model returned no readable analysis. Please re-run.');
        }
        const fit = result.fit && typeof result.fit === 'object' && result.fit.line
            ? { status: FIT.includes(result.fit.status) ? result.fit.status : null, line: brief(result.fit.line, 30) }
            : null;
        // One verdict per asset class, named as the prompt listed them.
        const byName = Object.fromEntries(Object.entries(CLASSES).flatMap(([k, t]) => [[t.toLowerCase(), k], [t.replace(/ \(.*\)$/, '').toLowerCase(), k], [k, k]]));
        const seen = new Set();
        const classFit = (Array.isArray(result.classFit) ? result.classFit : [])
            .map(c => c && typeof c === 'object' ? { key: byName[String(c.class || '').trim().toLowerCase()], status: c.status, line: c.line } : null)
            .filter(c => c && c.key && c.line && !seen.has(c.key) && seen.add(c.key))
            .map(c => ({ key: c.key, label: CLASSES[c.key].replace(/ \(.*\)$/, ''), status: FIT.includes(c.status) ? c.status : null, line: brief(c.line, 28) }));
        return { fit, classFit, findings, holdings, macroContext: brief(result.macroContext, 25) };
    }

    function validateDaily(result) {
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            throw new Error('The daily brief did not come back readable.');
        }
        const items = (Array.isArray(result.items) ? result.items : [])
            .filter(i => i && typeof i === 'object' && i.title && i.body)
            .map(i => ({ kind: ['news', 'rate', 'price', 'action', 'reminder'].includes(i.kind) ? i.kind : 'news',
                         title: brief(i.title, 10), body: brief(i.body, 34) }));
        if (!items.length) throw new Error('The daily brief came back empty.');
        return { greeting: brief(result.greeting, 16), items };
    }

    // ── Cache Utilities ────────────────────────────────────────────────────────
    /* The fingerprint now covers the RESEARCH as well as the portfolio. It used
       to cover only portfolio values, so a book whose prices were not syncing
       had a fingerprint that never changed — and the same six-hour-cached
       reading came back again and again, looking like a model with one idea. */
    function snapshotFingerprint(snapshot, pack) {
        return JSON.stringify({
            totalInvested: snapshot.totalInvested,
            totalMarketValue: snapshot.totalMarketValue,
            monthlySurplus: snapshot.monthlySurplus,
            netWorth: snapshot.netWorth,
            holdings: snapshot.holdings.map(holding => [holding.name, holding.invested, holding.marketValue, holding.lastUpdated]),
            goals: snapshot.goals.map(goal => [goal.name, goal.target, goal.current]),
            profile: snapshot.profile,
            research: pack ? {
                // The newest headline the pack saw. New news ⇒ new reading.
                news: (pack.holdings || []).flatMap(h => (h.news || []).map(n => n.title)).sort().slice(0, 20),
                macro: [...(pack.macro?.india || []), ...(pack.macro?.international || [])]
                    .flatMap(f => f.items.map(i => i.title)).sort().slice(0, 20),
                prices: (pack.holdings || []).map(h => [h.ticker, h.price?.last ?? null]),
            } : null,
        });
    }

    function loadCached(appData) {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const cached = JSON.parse(raw);
            const ageMs  = Date.now() - new Date(cached.timestamp).getTime();
            if (ageMs >= CACHE_TTL_MS) return null;
            // Compared against the SAME research the cached run used, so a
            // cache hit means "nothing has moved", not "we did not look".
            if (appData && cached.portfolioFingerprint
                !== snapshotFingerprint(buildPortfolioSnapshot(appData), cached.research)) return null;
            return cached;
        } catch {
            return null;
        }
    }

    function clearCache() {
        localStorage.removeItem(CACHE_KEY);
    }

    // ── Daily brief: cache and runner ──────────────────────────────────────────
    const localDay = (d = new Date()) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Who the brief was for, and whether they held anything yet. The second
    // half exists because a brief prepared the moment the questions were
    // answered — before a single holding was added — said "no holdings yet"
    // for the rest of the day. An empty book turning non-empty earns one new
    // brief; ordinary edits after that do not spend the allowance.
    const briefKey = appData => JSON.stringify([normProfile(appData?.profile), (appData?.investments || []).length > 0]);

    // Today's brief, for this person — or null. A new day, or a changed
    // profile, is a new brief.
    function loadDaily(appData) {
        try {
            const cached = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null');
            if (!cached || cached.day !== localDay()) return null;
            if (cached.briefKey !== briefKey(appData)) return null;
            return cached;
        } catch (_) { return null; }
    }

    let dailyInFlight = null;
    async function runDaily(appData, opts = {}) {
        if (!opts.force) {
            const cached = loadDaily(appData);
            if (cached) return cached;
        }
        // One pass at a time: a resume and a boot inside the same second
        // must not buy the same brief twice.
        if (dailyInFlight) return dailyInFlight;
        dailyInFlight = (async () => {
            const snapshot = buildPortfolioSnapshot(appData);
            let pack = null;
            try {
                if (window.CorpusResearch) pack = await window.CorpusResearch.buildPack(appData, null,
                    { profile: snapshot.profile, metals: true, reuse: true });
            } catch (e) { console.warn('[RegenWealth] daily research failed:', e && e.message); }
            const day = localDay();
            const prompt = buildDailyPrompt(snapshot, pack, appData.nwHistory, day);
            const res = await fetchWithTimeout(managedEndpoint(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Corpus-Client': 'daily-brief' },
                body: JSON.stringify({ prompt })
            }, GATEWAY_WAIT_MS);
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error?.message || 'The daily brief is unavailable right now.');
            }
            const data = await res.json();
            const brief = validateDaily(parseJSONResponse(data?.choices?.[0]?.message?.content));
            const out = { day, briefKey: briefKey(appData), preparedAt: new Date().toISOString(),
                          ...brief, sources: pack ? researchSources(pack) : [] };
            try { localStorage.setItem(DAILY_KEY, JSON.stringify(out)); } catch (_) {}
            return out;
        })();
        try { return await dailyInFlight; }
        finally { dailyInFlight = null; }
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    const hasPending = () => !!(window.AppPlugins?.AnalysisJob && localStorage.getItem(PENDING_KEY));
    // Legacy direct callers remain test-only compatibility paths. The rendered
    // application exclusively uses analyzeManaged, which never reads a user key.
    return { callManagedLLM, analyzeManaged, recoverPending, hasPending, loadCached, clearCache, buildPortfolioSnapshot,
             runDaily, loadDaily, normProfile, GOALS };

})();

