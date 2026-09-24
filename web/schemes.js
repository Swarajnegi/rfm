/* Government savings schemes — the facts the AI reasons from.

   No keyless API publishes small-savings rates, so they live here as a dated
   table. The Finance Ministry resets them every quarter, on or about the last
   working day of the previous one. A table like this is only honest while its
   quarter is current: `status()` reports when it has lapsed, and the prompt
   and the card then say "may have changed — verify" instead of quoting a
   stale rate as today's.

   Source: Department of Economic Affairs notification for July–September
   2026 (unchanged for nine quarters), cross-checked against India Post.
   EPF: 8.25% for FY 2025-26, ratified by the government in June 2026. */
(function () {
    'use strict';

    const QUARTER = { label: 'July–September 2026', from: '2026-07-01', to: '2026-09-30' };

    // `match` runs against the holding's name and type, lower-cased. Order
    // matters: the more specific patterns come first ("5 year" before "td").
    const SCHEMES = [
        { id: 'scss', name: 'Senior Citizens Savings Scheme', rate: 8.2, payout: 'Quarterly', lockIn: '5 years (extendable by 3)',
          limit: 'Up to ₹30 lakh per person', eligibility: 'Age 60+ (55+ for some retirees)', tax: 'Interest taxable; deposit qualifies for 80C',
          rateLocks: true, match: /\bscss\b|senior citizen/ },
        { id: 'pomis', name: 'Post Office Monthly Income Scheme', rate: 7.4, payout: 'Monthly', lockIn: '5 years',
          limit: '₹9 lakh single, ₹15 lakh joint', tax: 'Interest taxable', rateLocks: true,
          match: /\bpomis\b|\bmis\b|monthly income scheme/ },
        { id: 'ppf', name: 'Public Provident Fund', rate: 7.1, payout: 'At maturity (compounded yearly)', lockIn: '15 years',
          limit: '₹500 to ₹1.5 lakh a year', tax: 'Tax-free (EEE), 80C', rateLocks: false, match: /\bppf\b|public provident/ },
        { id: 'ssy', name: 'Sukanya Samriddhi Yojana', rate: 8.2, payout: 'At maturity (compounded yearly)', lockIn: '21 years from opening',
          limit: '₹250 to ₹1.5 lakh a year', eligibility: 'A girl child under 10', tax: 'Tax-free (EEE), 80C', rateLocks: false,
          match: /\bssy\b|sukanya/ },
        { id: 'nsc', name: 'National Savings Certificate', rate: 7.7, payout: 'At maturity (compounded yearly)', lockIn: '5 years',
          limit: 'No upper limit', tax: 'Deposit qualifies for 80C; interest taxable', rateLocks: true,
          match: /\bnsc\b|national savings certificate/ },
        { id: 'kvp', name: 'Kisan Vikas Patra', rate: 7.5, payout: 'At maturity — doubles in 115 months', lockIn: '2 years 6 months minimum',
          limit: 'No upper limit', tax: 'Interest taxable', rateLocks: true, match: /\bkvp\b|kisan vikas/ },
        { id: 'td5', name: 'Post Office Time Deposit (5 years)', rate: 7.5, payout: 'Yearly (compounded quarterly)', lockIn: '5 years',
          limit: 'No upper limit', tax: 'Deposit qualifies for 80C; interest taxable', rateLocks: true,
          match: /(5|five)[\s-]*(yr|year).*(time deposit|\btd\b)|(time deposit|\btd\b).*(5|five)[\s-]*(yr|year)/ },
        { id: 'td3', name: 'Post Office Time Deposit (3 years)', rate: 7.1, payout: 'Yearly (compounded quarterly)', lockIn: '3 years',
          limit: 'No upper limit', tax: 'Interest taxable', rateLocks: true,
          match: /(3|three)[\s-]*(yr|year).*(time deposit|\btd\b)|(time deposit|\btd\b).*(3|three)[\s-]*(yr|year)/ },
        { id: 'td2', name: 'Post Office Time Deposit (2 years)', rate: 7.0, payout: 'Yearly (compounded quarterly)', lockIn: '2 years',
          limit: 'No upper limit', tax: 'Interest taxable', rateLocks: true,
          match: /(2|two)[\s-]*(yr|year).*(time deposit|\btd\b)|(time deposit|\btd\b).*(2|two)[\s-]*(yr|year)/ },
        { id: 'td1', name: 'Post Office Time Deposit (1 year)', rate: 6.9, payout: 'Yearly (compounded quarterly)', lockIn: '1 year',
          limit: 'No upper limit', tax: 'Interest taxable', rateLocks: true,
          match: /(1|one)[\s-]*(yr|year).*(time deposit|\btd\b)|(time deposit|\btd\b).*(1|one)[\s-]*(yr|year)|post office (fd|time deposit)/ },
        { id: 'rd', name: 'Post Office Recurring Deposit (5 years)', rate: 6.7, payout: 'At maturity', lockIn: '5 years',
          limit: 'From ₹100 a month', tax: 'Interest taxable', rateLocks: true, match: /recurring deposit|\bpo ?rd\b|post office rd/ },
        { id: 'posb', name: 'Post Office Savings Account', rate: 4.0, payout: 'Yearly', lockIn: 'None',
          limit: 'No upper limit', tax: '80TTA/80TTB deduction on interest', rateLocks: false, match: /post office saving/ },
        { id: 'epf', name: 'Employees’ Provident Fund', rate: 8.25, payout: 'Credited yearly', lockIn: 'Until retirement or job change rules',
          limit: '12% of basic pay', tax: 'Tax-free within limits', rateLocks: false, rateNote: 'FY 2025-26 rate, declared yearly',
          yearly: true, match: /\bepf\b|provident fund|\bpf\b/ },
        { id: 'nps', name: 'National Pension System', rate: null, payout: 'Annuity and lump sum at 60', lockIn: 'Until 60',
          limit: 'No upper limit', tax: 'Extra ₹50,000 deduction under 80CCD(1B)', rateLocks: false,
          rateNote: 'Market-linked — no fixed rate', match: /\bnps\b|national pension/ },
        { id: 'sgb', name: 'Sovereign Gold Bond', rate: 2.5, payout: 'Half-yearly interest, plus the gold price at maturity', lockIn: '8 years (exit from year 5)',
          limit: 'Up to 4 kg a year', tax: 'Capital gain tax-free if held to maturity', rateLocks: true,
          rateNote: 'New issues have stopped; existing bonds keep paying', match: /\bsgb\b|sovereign gold/ },
    ];

    function localKey(d = new Date()) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Current while today is inside the quarter the table was written for.
    function status(now = new Date()) {
        const today = localKey(now);
        const current = today >= QUARTER.from && today <= QUARTER.to;
        return { current, quarter: QUARTER.label,
                 note: current ? `Rates for ${QUARTER.label}.`
                               : `These are the ${QUARTER.label} rates. The government resets them every quarter, so they may have changed — verify before acting.` };
    }

    function match(inv) {
        const text = `${inv?.name || ''} ${inv?.type || ''}`.toLowerCase();
        return SCHEMES.find(s => s.match.test(text)) || null;
    }

    window.CorpusSchemes = { QUARTER, SCHEMES, status, match };
})();
