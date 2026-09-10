// ══════════════════════════════════════════════════════════════════════════════
// regenWealth.js — Regenerative Wealth Analysis Engine
// Architecture Layer : Intelligence / Advisory Layer
// Depends on        : OpenRouter-compatible or direct LLM API, RSS bridge
// Client mode is suitable for a personal prototype. Production needs a secure backend.
// ══════════════════════════════════════════════════════════════════════════════

window.RegenWealth = (() => {

    // ── Constants ──────────────────────────────────────────────────────────────
    const CACHE_KEY    = 'rfm_regen_cache';
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // Six hours, and invalidated on portfolio changes.

    // Free RSS → JSON bridge (500 req/day free, no key needed)
    const RSS2JSON = 'https://api.rss2json.com/v1/api.json?count=8&rss_url=';

    // Indian financial news RSS feeds
    const NEWS_FEEDS = [
        {
            name: 'Economic Times Markets',
            url:  'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'
        },
        {
            name: 'Moneycontrol Top News',
            url:  'https://www.moneycontrol.com/rss/MCtopnews.xml'
        },
        {
            name: 'RBI Press Releases',
            url:  'https://www.rbi.org.in/Scripts/rss.aspx'
        }
    ];

    // ── News Fetcher ───────────────────────────────────────────────────────────
    // Fetches a single RSS feed via rss2json bridge.
    // Returns { source, headlines[] } — never throws.
    async function fetchNewsFeed(feed) {
        try {
            const res = await fetch(
                RSS2JSON + encodeURIComponent(feed.url),
                { signal: AbortSignal.timeout(4500) }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.status !== 'ok') throw new Error('Feed parse error');
            const headlines = (data.items || [])
                .map(i => i.title)
                .filter(Boolean)
                .slice(0, 6);
            return { source: feed.name, headlines };
        } catch (err) {
            console.warn(`[RegenWealth] Feed "${feed.name}" failed:`, err.message);
            return { source: feed.name, headlines: [] };
        }
    }

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
        const holdingCost = investment => {
            if (number(investment.units) > 0 && number(investment.buyPrice) > 0) {
                return number(investment.units) * number(investment.buyPrice) * (isUsdHolding(investment) ? fxRate : 1);
            }
            return number(investment.amount);
        };
        const holdingValue = investment => {
            if (number(investment.units) > 0 && number(investment.currentPrice) > 0) {
                return number(investment.units) * number(investment.currentPrice) * (isUsdHolding(investment) ? fxRate : 1);
            }
            return number(investment.currentValue) || number(investment.amount);
        };

        const holdings = investments.map(investment => {
            const cost = holdingCost(investment);
            const value = holdingValue(investment);
            const pnl = value - cost;
            return {
                name: investment.name || investment.ticker || 'Unnamed holding',
                type: investment.type || 'Other',
                ticker: investment.ticker || '',
                invested: Math.round(cost),
                marketValue: Math.round(value),
                pnl: Math.round(pnl),
                pnlPct: cost > 0 ? Number(((pnl / cost) * 100).toFixed(2)) : 0,
                lastUpdated: investment.lastNavUpdate || ''
            };
        });
        const totalInvested = holdings.reduce((sum, holding) => sum + holding.invested, 0);
        const totalMarketValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);

        const breakdown = {};
        holdings.forEach(holding => {
            breakdown[holding.type] = (breakdown[holding.type] || 0) + holding.marketValue;
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
        const monthlySurplus = totalIncome - totalExpense;

        const nw = appData.networth || {};
        const totalAssets      = number(nw.bank) + number(nw.cash)
                               + number(nw.property) + number(nw.otherAsset)
                               + totalMarketValue;
        const totalLiabilities = number(nw.homeLoan) + number(nw.personalLoan)
                               + number(nw.creditCard || nw.credit) + number(nw.otherLiability || nw.otherDebt);

        const ef = appData.emergency || {};
        const efTarget = number(ef.efMonthly) * number(ef.efMonths || 12);
        const efCurrent = number(ef.efCurrent);
        const efCoverageMonths = number(ef.efMonthly) > 0
            ? Math.round(efCurrent / number(ef.efMonthly))
            : 0;

        return {
            totalInvested,
            totalMarketValue,
            holdingsCount: investments.length,
            holdings: holdings.sort((a, b) => b.marketValue - a.marketValue).slice(0, 25),
            allocationPct,
            breakdown,
            concentrationRisks,
            monthlyPension: pension,
            monthlyIncome: totalIncome,
            monthlyExpense: totalExpense,
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
            capturedAt: new Date().toISOString()
        };
    }

    // ── Prompt Builder ─────────────────────────────────────────────────────────
    // Constructs structured decision support from the current portfolio and verified headlines.
    function buildPrompt(snapshot, newsFeeds) {
        const fmt = n => Number(n || 0).toLocaleString('en-IN');

        // Portfolio allocation narrative
        const allocationLines = Object.entries(snapshot.allocationPct)
            .map(([t, pct]) => `  - ${t}: ${pct}% (₹${fmt(snapshot.breakdown[t])})`)
            .join('\n') || '  - No investments recorded yet';
        const holdingLines = snapshot.holdings
            .map(holding => `  - ${holding.name}${holding.ticker ? ` (${holding.ticker})` : ''}: invested ₹${fmt(holding.invested)}, current ₹${fmt(holding.marketValue)}, P&L ${holding.pnlPct >= 0 ? '+' : ''}${holding.pnlPct}%`)
            .join('\n') || '  - No holdings recorded yet';

        // News headlines block
        const newsSections = newsFeeds
            .filter(f => f.headlines.length > 0)
            .map(f => `### ${f.source}\n${f.headlines.map((h, i) => `${i+1}. ${h}`).join('\n')}`)
            .join('\n\n');
        const hasNews = newsSections.length > 0;

        return `You are a financial-planning decision-support assistant for an Indian investor. Analyse the supplied portfolio precisely. Do not pretend to have live prices, news, tax facts, or account data that were not supplied.

## USER PORTFOLIO PROFILE
- **Total Invested:** ₹${fmt(snapshot.totalInvested)}
- **Current Portfolio Market Value:** ₹${fmt(snapshot.totalMarketValue)}
- **Number of Holdings:** ${snapshot.holdingsCount}
- **Asset Allocation:**
${allocationLines}
- **Largest Holdings:**
${holdingLines}
- **Concentration Risks:** ${snapshot.concentrationRisks.length > 0 ? snapshot.concentrationRisks.join(', ') : 'None detected'}
- **Monthly Pension Income:** ₹${fmt(snapshot.monthlyPension)}
- **Monthly Total Income:** ₹${fmt(snapshot.monthlyIncome)}
- **Monthly Expenses:** ₹${fmt(snapshot.monthlyExpense)}
- **Monthly Investable Surplus:** ₹${fmt(snapshot.monthlySurplus)}
- **Net Worth:** ₹${fmt(snapshot.netWorth)} (Assets ₹${fmt(snapshot.totalAssets)} − Liabilities ₹${fmt(snapshot.totalLiabilities)})
- **Emergency Fund:** ${snapshot.efCoverageMonths} months covered (target: ${Math.round(snapshot.efTarget / Math.max(snapshot.efMonthlyNeeded, 1))} months)
- **Tax Regime:** ${snapshot.taxRegime}
- **Section 80C Utilised:** ${snapshot.is80CUsed ? 'Yes' : 'No'}
- **Active Financial Goals:** ${snapshot.goals.length > 0 ? snapshot.goals.map(g => `${g.name} (target ₹${fmt(g.target)}, saved ₹${fmt(g.current)})`).join('; ') : 'None set'}

${hasNews
    ? `## VERIFIED MARKET CONTEXT (headlines may be incomplete)\n${newsSections}`
    : '## MARKET CONTEXT\nNo verified market headlines loaded. Keep the analysis portfolio-specific and say that macro context is unavailable.'}

## INSTRUCTIONS
1. Identify 4–6 decisions ranked by urgency, each anchored to a holding, cash-flow figure, goal, liquidity gap, or supplied headline.
2. Explain the evidence and trade-off for every recommendation. Do not repeat generic diversification advice.
3. Prioritise emergency liquidity, debt, concentration, drawdown, tax planning, and goals before return seeking.
4. Treat instruments as examples to research, not instructions to buy or sell. Flag items that need a SEBI-registered adviser or tax professional.
5. Tie any allocation range to the actual monthly surplus of ₹${fmt(snapshot.monthlySurplus)} and distinguish recurring from one-time actions.
6. If market context is unavailable, do not invent a macro rationale. State the limitation.
7. Include at least one measurable next review trigger, such as a rebalance threshold, cash reserve target, or tax deadline to verify.

## REQUIRED OUTPUT FORMAT — respond ONLY with valid JSON, no markdown fences:
{
  "macroContext": "2–3 sentence summary using only supplied market context, or clearly state that no verified macro context was available",
  "marketSentiment": "Bullish|Bearish|Neutral|Cautiously Optimistic",
  "portfolioHealthScore": 0-100,
  "portfolioHealthNote": "One sentence on overall portfolio health",
  "keyRisks": ["Risk 1", "Risk 2"],
  "recommendations": [
    {
      "id": "r1",
      "assetClass": "Gold|Bonds|Fixed Deposits|Mutual Funds|Equity|Real Estate|Sovereign Gold Bonds|PPF|SCSS|NPS|RBI Bonds|REITs|Other",
      "priority": "High|Medium|Low",
      "title": "Short decision-support title (max 8 words)",
      "rationale": "2–3 sentences citing a portfolio fact or supplied headline and its trade-off",
      "suggestedAllocation": "₹X – ₹Y (e.g. ₹25,000 – ₹50,000)",
      "timeHorizon": "e.g. 6–18 months",
      "risk": "Very Low|Low|Moderate|High",
      "urgencyScore": 0-100,
      "specificInstruments": ["Examples to research, or an adviser question"]
    }
  ]
}`;
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
            const firstBrace = clean.indexOf('{');
            const lastBrace = clean.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
                try {
                    return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
                } catch (_) {}
            }
            throw new Error(`The selected model did not return usable JSON. Choose another model or retry: ${e.message}`);
        }
    }

    // ── Provider Auto-Detector ────────────────────────────────────────────────
    function detectProvider(apiKey) {
        const key = (apiKey || '').trim();
        if (key.startsWith('sk-or-')) return 'openrouter';
        if (key.startsWith('AIza')) return 'gemini';
        if (key.startsWith('sk-')) return 'openai';
        return 'openrouter'; // Default fallback for OpenRouter or custom proxy keys
    }

    function modelForProvider(model, provider) {
        const value = (model || '').trim();
        if (provider === 'openai') return value.replace(/^openai\//, '') || 'gpt-4o-mini';
        if (provider === 'gemini') return value.replace(/^google\//, '') || 'gemini-2.0-flash';
        return value || 'openai/gpt-4o-mini';
    }

    async function fetchWithTimeout(url, options, timeoutMs = 45000) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            return await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    // ── Universal Multi-Provider LLM Caller ────────────────────────────────────
    // Supports:
    // 1. OpenRouter (sk-or-v1-...) -> https://openrouter.ai/api/v1/chat/completions
    // 2. Direct Gemini (AIzaSy...)  -> https://generativelanguage.googleapis.com/...
    // 3. Direct OpenAI (sk-...)     -> https://api.openai.com/v1/chat/completions
    async function callLLM(prompt, apiKey, options = {}) {
        const key = (apiKey || '').trim();
        if (!key) throw new Error('No API key provided.');

        const provider = options.provider && options.provider !== 'auto'
            ? options.provider
            : detectProvider(key);

        const temperature = typeof options.temperature === 'number' ? options.temperature : 0.3;

        // 1. OpenRouter API Call
        if (provider === 'openrouter') {
            const model = modelForProvider(options.model, provider);
            const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                    'HTTP-Referer': 'https://github.com/Swarajnegi/dadfinanceapp',
                    'X-Title': 'RFM Portfolio Advisor'
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: 'Return only the requested JSON. Provide precise financial-planning decision support, not trading instructions.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature
                })
            });

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                const msg = errBody?.error?.message || `HTTP ${res.status}`;
                const message = msg.toLowerCase();
                if (res.status === 401) throw new Error('Invalid OpenRouter API key. Check the saved key and retry.');
                if (res.status === 402) throw new Error('OpenRouter credits are unavailable for this request. Check account credits and model pricing.');
                if (res.status === 429) throw new Error('OpenRouter rate limit reached. Retry in a few seconds.');
                if (message.includes('no endpoints') || message.includes('no provider')) {
                    throw new Error(`The selected model "${model}" has no eligible OpenRouter endpoint right now. Refresh the live catalog and choose another model.`);
                }
                throw new Error(`OpenRouter could not run "${model}": ${msg}`);
            }

            const data = await res.json();
            return parseJSONResponse(data.choices?.[0]?.message?.content);
        }

        // 2. OpenAI API Call
        if (provider === 'openai') {
            const model = modelForProvider(options.model, provider);
            const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: 'Return only the requested JSON. Provide precise financial-planning decision support, not trading instructions.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: temperature
                })
            });

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                const msg = errBody?.error?.message || `HTTP ${res.status}`;
                throw new Error(`OpenAI API error: ${msg}`);
            }

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content;
            return parseJSONResponse(text);
        }

        // 3. Direct Gemini (Google AI Studio) Call
        const model = modelForProvider(options.model, provider);
        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        const res = await fetchWithTimeout(`${geminiEndpoint}?key=${key}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature:      temperature,
                    maxOutputTokens:  4096
                }
            })
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const msg = errBody?.error?.message || `HTTP ${res.status}`;
            if (res.status === 400) throw new Error(`Invalid Gemini key or request format: ${msg}`);
            if (res.status === 403) throw new Error('API key does not have Gemini access. Check AI Studio.');
            if (res.status === 429) throw new Error('Gemini rate limit hit. Wait 60 seconds.');
            throw new Error(`Gemini API error: ${msg}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return parseJSONResponse(text);
    }

    // ── Main Orchestrator ──────────────────────────────────────────────────────
    // Runs the full analysis pipeline: portfolio read → news fetch → AI call.
    // onProgress(msg) is called at each stage for UI feedback.
    async function analyze(appData, apiKey, options = {}, onProgress = () => {}) {
        if (!apiKey || apiKey.trim().length < 10) {
            throw new Error('Please enter a valid API key (OpenRouter, Gemini, or OpenAI).');
        }

        const key = apiKey.trim();
        const provider = (options.provider && options.provider !== 'auto')
            ? options.provider
            : detectProvider(key);

        const modelName = modelForProvider(options.model, provider);

        onProgress('Reading your portfolio snapshot...');
        const snapshot = buildPortfolioSnapshot(appData);

        onProgress('Fetching live market news from 3 RSS sources...');
        const newsResults = await Promise.all(NEWS_FEEDS.map(fetchNewsFeed));
        const successCount = newsResults.filter(f => f.headlines.length > 0).length;

        onProgress(`Building analysis prompt (${successCount}/3 news sources loaded)...`);
        const prompt = buildPrompt(snapshot, newsResults);

        const providerLabel = provider === 'openrouter' ? `OpenRouter (${modelName})` : provider === 'openai' ? `OpenAI (${modelName})` : `Gemini (${modelName})`;
        onProgress(`Running ${providerLabel} AI analysis...`);

        const result = await callLLM(prompt, key, { provider, model: modelName, temperature: 0.5 });

        // Sort by urgency score descending
        if (Array.isArray(result.recommendations)) {
            result.recommendations.sort((a, b) => (b.urgencyScore || 0) - (a.urgencyScore || 0));
        }

        const analysis = {
            ...result,
            portfolioSnapshot: snapshot,
            newsSources: newsResults.map(f => ({
                source: f.source,
                count:  f.headlines.length
            })),
            providerUsed: providerLabel,
            portfolioFingerprint: snapshotFingerprint(snapshot),
            timestamp: new Date().toISOString()
        };

        // Keep a short cache only while the underlying portfolio is unchanged.
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(analysis));
        } catch (_) { /* Storage full — skip caching */ }

        return analysis;
    }

    // ── Cache Utilities ────────────────────────────────────────────────────────
    function snapshotFingerprint(snapshot) {
        return JSON.stringify({
            totalInvested: snapshot.totalInvested,
            totalMarketValue: snapshot.totalMarketValue,
            monthlySurplus: snapshot.monthlySurplus,
            netWorth: snapshot.netWorth,
            holdings: snapshot.holdings.map(holding => [holding.name, holding.invested, holding.marketValue, holding.lastUpdated]),
            goals: snapshot.goals.map(goal => [goal.name, goal.target, goal.current])
        });
    }

    function loadCached(appData) {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const cached = JSON.parse(raw);
            const ageMs  = Date.now() - new Date(cached.timestamp).getTime();
            if (ageMs >= CACHE_TTL_MS) return null;
            if (appData && cached.portfolioFingerprint !== snapshotFingerprint(buildPortfolioSnapshot(appData))) return null;
            return cached;
        } catch {
            return null;
        }
    }

    function clearCache() {
        localStorage.removeItem(CACHE_KEY);
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    return { callLLM, analyze, detectProvider, loadCached, clearCache };

})();

