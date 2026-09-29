/* Dated, conservative India-resident capital-gains preview. No filing claim:
   STT, scheme classification, foreign tax, exemptions and loss set-off need a
   statement/tax-professional check. Source: Income Tax Department capital-gain
   guidance and sections 50AA, 111A, 112 and 112A (reviewed Sep 2026). */
(function (root) {
    'use strict';
    const day = value => {
        const s = String(value || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
        const parsed = new Date(s + 'T00:00:00Z');
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s ? s : null;
    };
    const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
    const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const RULES = Object.freeze({
        '2024-25': { id: 'post-2024-07-23', equityStcg: .20, equityLtcg: .125, generalLtcg: .125, equityExemption: 125000 },
        '2025-26': { id: 'fy-2025-26', equityStcg: .20, equityLtcg: .125, generalLtcg: .125, equityExemption: 125000 },
        '2026-27': { id: 'fy-2026-27', equityStcg: .20, equityLtcg: .125, generalLtcg: .125, equityExemption: 125000 }
    });
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    function financialYear(date) {
        const d = day(date);
        if (!d) return null;
        const y = Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 4 ? 1 : 0);
        return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    }
    function heldLongerThan(bought, sold, months) {
        const a = new Date(bought + 'T00:00:00Z');
        const anniversary = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + months, a.getUTCDate()));
        return new Date(sold + 'T00:00:00Z') > anniversary;
    }
    function category(holding, sale, bought, sold) {
        if (!day(bought) || !day(sold) || bought > sold) return { code: 'review', reason: 'Purchase or sale date needs checking' };
        if (sold < '2024-07-23') return { code: 'review', reason: 'Pre-23 July 2024 rules need review' };
        if (!RULES[financialYear(sold)]) return { code: 'review', reason: 'No verified tax rule version for this financial year' };
        if (holding.currency === 'USD' || /\(US\)/.test(holding.type || '')) return { code: 'review', reason: 'Foreign asset and foreign tax need review' };
        const t = holding.type || '';
        const fund = sale.fundTaxClass || holding.fundTaxClass || '';
        const listedEquity = /Stock \(IND\)|^Stock$/.test(t) || (/ETF|Mutual Fund/.test(t) && fund === 'equity');
        if (listedEquity) {
            if (sale.sttEligible !== true) return { code: 'review', reason: '111A/112A eligibility and STT must be confirmed' };
            return { code: heldLongerThan(bought, sold, 12) ? '112A' : '111A' };
        }
        if (/ETF|Mutual Fund/.test(t)) {
            if (fund === 'specified-50aa') return bought >= '2023-04-01'
                ? { code: 'slab', reason: 'Specified fund, Section 50AA' }
                : { code: 'review', reason: 'Specified fund acquired before Section 50AA start; review treatment' };
            return { code: 'review', reason: 'Fund tax classification is not established' };
        }
        if (t === 'Bond') {
            if (sale.bondListing === 'unlisted') return { code: 'slab', reason: 'Unlisted bond, Section 50AA' };
            if (sale.bondListing !== 'listed') return { code: 'review', reason: 'Bond listing status is unknown' };
            return { code: heldLongerThan(bought, sold, 12) ? '112' : 'slab' };
        }
        if (t === 'Physical Metal') return { code: heldLongerThan(bought, sold, 24) ? '112' : 'slab' };
        return { code: 'review', reason: 'Asset tax treatment is not supported' };
    }
    function allocateSale(holding, form) {
        const sold = day(form.date), quantity = positive(form.quantity), proceeds = positive(form.proceeds), fees = Number(form.fees || 0);
        if (!sold || !quantity || !proceeds || !Number.isFinite(fees) || fees < 0 || fees >= proceeds) throw new Error('Enter a valid sale date, quantity, proceeds and fees.');
        if (sold > today()) throw new Error('Future sales cannot be recorded.');
        if (quantity > positive(holding.units) + 1e-8) throw new Error('Sale quantity exceeds units held.');
        const lots = (holding.taxLots || []).map(x => ({ ...x })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const recordedUnits = lots.reduce((n, lot) => n + positive(lot.quantityRemaining ?? lot.quantity), 0);
        if (Math.abs(recordedUnits - positive(holding.units)) > 1e-5) {
            // A disposal is still real when an imported holding has no dated
            // basis. Retain its old lots for reconciliation; do not pretend
            // they establish FIFO order or a gain for this sale.
            return { lots: [], sale: { date: sold, fy: financialYear(sold), holdingId: holding.id,
                holdingName: holding.name, holdingType: holding.type, quantity, proceeds, fees,
                proceedsDestination: form.proceedsDestination || 'cash', basisUnknown: true,
                priorTaxLots: lots, gain: null, allocations: [{ quantity, proceeds: round(proceeds - fees),
                    cost: null, gain: null, code: 'review', reason: 'Purchase basis or dated lots are missing; reconcile against the statement' }] } };
        }
        let remaining = quantity;
        const allocations = [];
        for (const lot of lots) {
            if (remaining <= 1e-8) break;
            const available = positive(lot.quantityRemaining ?? lot.quantity);
            if (!available) continue;
            const take = Math.min(available, remaining);
            const cost = positive(lot.cost) * take / positive(lot.quantity);
            allocations.push({ lotId: lot.id, purchaseDate: day(lot.date), quantity: Math.round(take * 1e6) / 1e6, cost: round(cost) });
            lot.quantityRemaining = Math.round((available - take) * 1e6) / 1e6;
            remaining -= take;
        }
        if (remaining > 1e-6) throw new Error('A dated purchase lot is missing for some units. Add the real acquisition first.');
        const parts = allocations.map(a => {
            const netProceeds = round((proceeds - fees) * a.quantity / quantity);
            const rule = category(holding, form, a.purchaseDate, sold);
            return { ...a, proceeds: netProceeds, gain: round(netProceeds - a.cost), ...rule };
        });
        return { lots, sale: { date: sold, fy: financialYear(sold), holdingId: holding.id,
            holdingName: holding.name, holdingType: holding.type, quantity, proceeds, fees,
            fundTaxClass: form.fundTaxClass || '', sttEligible: form.sttEligible === true,
            bondListing: form.bondListing || '', proceedsDestination: form.proceedsDestination || 'cash',
            allocations: parts, gain: round(parts.reduce((n, p) => n + p.gain, 0)) } };
    }
    function summarize(sales, fy) {
        const selected = (sales || []).filter(s => s.fy === fy);
        const amounts = { '111A': 0, '112A': 0, '112': 0, slab: 0 };
        const review = [];
        const rules = RULES[fy];
        for (const sale of selected) for (const p of sale.allocations || []) {
            if (p.gain == null || !Number.isFinite(Number(p.gain))) { review.push(`${sale.holdingName}: ${p.reason || 'purchase basis is unknown'}`); continue; }
            if (p.code === 'review' || !Object.hasOwn(amounts, p.code)) review.push(`${sale.holdingName}: ${p.reason || 'classification needs review'}`);
            else if (p.gain < 0) review.push(`${sale.holdingName}: loss set-off needs review`);
            else amounts[p.code] += p.gain;
        }
        const equityExempt = Math.min(amounts['112A'], rules?.equityExemption || 0);
        const specialTax = rules ? round((amounts['111A'] * rules.equityStcg + (amounts['112A'] - equityExempt) * rules.equityLtcg + amounts['112'] * rules.generalLtcg) * 1.04) : 0;
        return { fy, ruleVersion: rules?.id || null, sales: selected, amounts, review, equityExempt, specialTax, slabGain: amounts.slab,
            realizedGain: selected.some(s => s.gain == null) ? null : round(selected.reduce((n, s) => n + Number(s.gain || 0), 0)) };
    }
    root.CorpusTaxLedger = Object.freeze({ financialYear, category, allocateSale, summarize });
})(window);
