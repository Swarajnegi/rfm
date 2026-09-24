/**
 * ═══════════════════════════════════════════════════════════════
 *  RFM Statement Parser — Phase 5
 *  Client-side CAS / MF statement parser
 *  Extracts structured investment data from PDF text
 * ═══════════════════════════════════════════════════════════════
 *
 *  Architecture:
 *    pdf.js extracts raw text → detectStatementType() routes it
 *    → specific parser (CDSL/NSDL/CAMS/KFintech)
 *    → normalizeToInvestments() maps to our app's shape
 *
 *  This file has ZERO dependencies on Alpine, Capacitor, or DOM.
 *  It is a pure function library: text in → structured data out.
 */

// ════════════════════════════════════════════════════════════════
//  DETECTION — What type of statement is this?
// ════════════════════════════════════════════════════════════════

function detectStatementType(text) {
    const t = text.toUpperCase();

    // CDSL CAS
    if (t.includes('CONSOLIDATED ACCOUNT STATEMENT') &&
        (t.includes('CDSL') || t.includes('CENTRAL DEPOSITORY'))) {
        return 'CDSL_CAS';
    }

    // NSDL CAS
    if (t.includes('CONSOLIDATED ACCOUNT STATEMENT') &&
        (t.includes('NSDL') || t.includes('NATIONAL SECURITIES'))) {
        return 'NSDL_CAS';
    }

    // CAMS Mutual Fund
    if ((t.includes('COMPUTER AGE MANAGEMENT') || t.includes('CAMS')) &&
        t.includes('MUTUAL FUND')) {
        return 'CAMS_MF';
    }

    // KFintech Mutual Fund
    if ((t.includes('KFIN TECHNOLOGIES') || t.includes('KFINTECH') || t.includes('KARVY')) &&
        t.includes('STATEMENT')) {
        return 'KFINTECH_MF';
    }

    // Bank Account Statement (ICICI, SBI, HDFC, Axis, PNB, Bank Passbook / Transaction History)
    if (t.includes('STATEMENT OF TRANSACTIONS') ||
        t.includes('SAVING ACCOUNT') ||
        t.includes('SAVINGS ACCOUNT') ||
        t.includes('ACCOUNT STATEMENT') ||
        t.includes('WITHDRAWAL AMOUNT') ||
        t.includes('DEPOSIT AMOUNT') ||
        t.includes('TRANSACTION REMARKS') ||
        t.includes('CHEQUE NUMBER')) {
        return 'BANK_STATEMENT';
    }

    // Groww Mutual Fund Portfolio
    if ((t.includes('GROWW') || t.includes('NEXTBILLION')) &&
        (t.includes('HOLDINGS AS ON') || t.includes('HOLDING SUMMARY') || t.includes('SCHEME NAME') || t.includes('MUTUAL FUND'))) {
        return 'GROWW_MF';
    }
    // Broker Mutual Fund statement with "HOLDINGS AS ON" + "SCHEME NAME"
    if (t.includes('HOLDINGS AS ON') && t.includes('SCHEME NAME') && (t.includes('AMC') || t.includes('FOLIO'))) {
        return 'GROWW_MF';
    }

    // Groww Stock / Demat Statement
    if ((t.includes('GROWW') || t.includes('NEXTBILLION')) &&
        (t.includes('DEMAT') || t.includes('EQUITY HOLDING') || t.includes('STOCK HOLDING') || t.includes('STOCKS') || t.includes('SHARES'))) {
        return 'GROWW_STOCKS';
    }

    // Generic fallback for any financial document with balances or holdings
    if (t.includes('BALANCE') || t.includes('VALUATION') || t.includes('AMOUNT') || t.includes('STATEMENT')) {
        return 'GENERIC_STATEMENT';
    }

    return 'UNKNOWN';
}


// ════════════════════════════════════════════════════════════════
//  COMMON REGEX PATTERNS
// ════════════════════════════════════════════════════════════════

const ISIN_REGEX = /\b(IN[A-Z0-9]{10})\b/g;
const PAN_REGEX  = /PAN\s*[:\-]?\s*([A-Z]{5}\d{4}[A-Z])/i;
const NAME_REGEX = /(?:Name|Holder)\s*[:\-]?\s*(.+)/i;
const ORG_WORDS  = /PRIVATE|LIMITED|\bLTD\b|\bPVT\b|BANK|SERVICES?|TECHNOLOG|SOLUTIONS?|BRANCH|STATEMENT/i;

// Parse Indian number format: "1,23,456.78" → 123456.78
function parseIndianNumber(str) {
    if (!str) return 0;
    return parseFloat(String(str).replace(/,/g, '').trim()) || 0;
}

// Clean up extracted text lines
function cleanLine(line) {
    return line.replace(/\s+/g, ' ').trim();
}


// ════════════════════════════════════════════════════════════════
//  CDSL CAS PARSER
// ════════════════════════════════════════════════════════════════

function parseCDSL(text) {
    const result = {
        type: 'CDSL_CAS',
        investor: extractInvestorInfo(text),
        holdings: []
    };

    const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);

    // ── Strategy: Walk line-by-line, find ISINs, then extract surrounding context ──
    // CAS PDFs have holdings in tabular blocks. Each holding typically appears as:
    //   ISIN line → Security name → Quantity → Valuation

    let inHoldingsSection = false;
    let currentHolding = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect start of holdings section
        if (/demat\s+account|equity\s+&\s+mutual|securities\s+held/i.test(line)) {
            inHoldingsSection = true;
            continue;
        }

        // Detect end of holdings section (next major section)
        if (inHoldingsSection && /^\s*(transaction\s+statement|statement\s+of\s+transaction)/i.test(line)) {
            // Flush last holding
            if (currentHolding && currentHolding.isin) {
                result.holdings.push(currentHolding);
            }
            inHoldingsSection = false;
            continue;
        }

        if (!inHoldingsSection) continue;

        // Look for ISIN on this line
        const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/);

        if (isinMatch) {
            // Flush previous holding
            if (currentHolding && currentHolding.isin) {
                result.holdings.push(currentHolding);
            }

            currentHolding = {
                isin: isinMatch[1],
                name: '',
                units: 0,
                value: 0,
                type: inferTypeFromISIN(isinMatch[1]),
                folioNumber: '',
                dpId: ''
            };

            // The security name is often on the same line after the ISIN,
            // or on the next line
            const afterIsin = line.substring(line.indexOf(isinMatch[1]) + isinMatch[1].length).trim();
            if (afterIsin.length > 3 && !/^\d/.test(afterIsin)) {
                currentHolding.name = afterIsin;
            }
            continue;
        }

        // If we have a current holding and no name yet, this line might be the name
        if (currentHolding && !currentHolding.name) {
            // Skip purely numeric lines or very short lines
            if (line.length > 3 && !/^[\d,.\s₹]+$/.test(line)) {
                currentHolding.name = line;
                continue;
            }
        }

        // Look for quantity / units
        if (currentHolding) {
            const qtyMatch = line.match(/([\d,]+\.?\d*)\s*(?:units?|quantity|shares?|nos?\.?)/i);
            if (qtyMatch) {
                currentHolding.units = parseIndianNumber(qtyMatch[1]);
                continue;
            }

            // Look for valuation / market value
            const valMatch = line.match(/(?:valuation|market\s*value|value\s*in\s*inr|total\s*value)\s*[:\-]?\s*₹?\s*([\d,]+\.?\d*)/i);
            if (valMatch) {
                currentHolding.value = parseIndianNumber(valMatch[1]);
                continue;
            }

            // Folio number
            const folioMatch = line.match(/folio\s*(?:no\.?)?\s*[:\-]?\s*(\S+)/i);
            if (folioMatch) {
                currentHolding.folioNumber = folioMatch[1];
                continue;
            }

            // DP ID
            const dpMatch = line.match(/(?:dp\s*id|bo\s*id)\s*[:\-]?\s*(\d+)/i);
            if (dpMatch) {
                currentHolding.dpId = dpMatch[1];
                continue;
            }

            // Standalone number that might be value (last number on a line in holdings context)
            // Only grab if we already have an ISIN and name but no value
            if (currentHolding.name && currentHolding.value === 0) {
                const numMatch = line.match(/^₹?\s*([\d,]+\.\d{2})\s*$/);
                if (numMatch) {
                    currentHolding.value = parseIndianNumber(numMatch[1]);
                }
            }
        }
    }

    // Flush last holding
    if (currentHolding && currentHolding.isin) {
        result.holdings.push(currentHolding);
    }

    // ── Fallback: If section-based parsing found nothing, try ISIN-scanning ──
    if (result.holdings.length === 0) {
        result.holdings = fallbackISINScan(lines);
    }

    return result;
}


// ════════════════════════════════════════════════════════════════
//  NSDL CAS PARSER
// ════════════════════════════════════════════════════════════════

function parseNSDL(text) {
    // NSDL CAS structure is very similar to CDSL.
    // Key differences: uses "DP ID - Client ID" and slightly different headers.
    // We reuse the CDSL logic with minor adjustments.
    const result = parseCDSL(text);
    result.type = 'NSDL_CAS';

    // Fix DP ID extraction for NSDL format
    const dpMatch = text.match(/DP\s*ID\s*[-:]?\s*(\w+)\s*[-]?\s*Client\s*ID\s*[-:]?\s*(\w+)/i);
    if (dpMatch) {
        result.holdings.forEach(h => {
            if (!h.dpId) h.dpId = dpMatch[1] + '-' + dpMatch[2];
        });
    }

    return result;
}


// ════════════════════════════════════════════════════════════════
//  CAMS MUTUAL FUND PARSER
// ════════════════════════════════════════════════════════════════

function parseCAMS(text) {
    const result = {
        type: 'CAMS_MF',
        investor: extractInvestorInfo(text),
        holdings: []
    };

    const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);

    let currentFolio = '';
    let currentScheme = '';
    let currentHolding = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Folio number
        const folioMatch = line.match(/folio\s*(?:no\.?)?\s*[:\-]?\s*(\S+)/i);
        if (folioMatch) {
            // Flush previous
            if (currentHolding && currentHolding.name) {
                result.holdings.push(currentHolding);
            }
            currentFolio = folioMatch[1];
            currentScheme = '';
            currentHolding = null;
            continue;
        }

        // If we have a folio but no scheme yet, the next non-trivial line is the scheme name
        if (currentFolio && !currentScheme) {
            // Skip date lines, header lines, etc.
            if (line.length > 10 && !/^[\d\s\-\/]+$/.test(line) && !/^(date|transaction|amount|units|nav)/i.test(line)) {
                currentScheme = line;
                currentHolding = {
                    isin: '',
                    name: currentScheme,
                    units: 0,
                    value: 0,
                    nav: 0,
                    type: 'Mutual Fund',
                    folioNumber: currentFolio,
                    dpId: ''
                };

                // Try to extract ISIN from scheme line or nearby
                const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/);
                if (isinMatch) {
                    currentHolding.isin = isinMatch[1];
                    currentHolding.name = line.replace(isinMatch[0], '').trim();
                }
                continue;
            }
        }

        if (currentHolding) {
            // ISIN on a separate line
            const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/);
            if (isinMatch && !currentHolding.isin) {
                currentHolding.isin = isinMatch[1];
            }

            // Closing unit balance
            const unitsMatch = line.match(/(?:closing|balance)\s*(?:unit)?\s*[:\-]?\s*([\d,]+\.\d{3,4})/i);
            if (unitsMatch) {
                currentHolding.units = parseIndianNumber(unitsMatch[1]);
                continue;
            }

            // NAV
            const navMatch = line.match(/NAV\s*(?:on)?\s*[\d\-\/]*\s*[:\-]?\s*(?:INR\s*)?₹?\s*([\d,]+\.\d{2,4})/i);
            if (navMatch) {
                currentHolding.nav = parseIndianNumber(navMatch[1]);
                continue;
            }

            // Market / Valuation value
            const valMatch = line.match(/(?:market|valuation|value)\s*[:\-]?\s*₹?\s*(?:INR\s*)?([\d,]+\.?\d*)/i);
            if (valMatch) {
                currentHolding.value = parseIndianNumber(valMatch[1]);
                continue;
            }

            // Standalone units (3-4 decimal places is a strong MF signal)
            if (currentHolding.units === 0) {
                const standaloneUnits = line.match(/^([\d,]+\.\d{3,4})\s*$/);
                if (standaloneUnits) {
                    currentHolding.units = parseIndianNumber(standaloneUnits[1]);
                    continue;
                }
            }
        }
    }

    // Flush last
    if (currentHolding && currentHolding.name) {
        result.holdings.push(currentHolding);
    }

    // Calculate value from units × NAV if value is missing
    result.holdings.forEach(h => {
        if (h.value === 0 && h.units > 0 && h.nav > 0) {
            h.value = Math.round(h.units * h.nav * 100) / 100;
        }
    });

    return result;
}


// ════════════════════════════════════════════════════════════════
//  KFINTECH MUTUAL FUND PARSER
// ════════════════════════════════════════════════════════════════

function parseKFintech(text) {
    // KFintech format is structurally similar to CAMS.
    // Reuse CAMS parser with adjusted type.
    const result = parseCAMS(text);
    result.type = 'KFINTECH_MF';
    return result;
}


// ════════════════════════════════════════════════════════════════
//  GROWW MUTUAL FUND PARSER
// ════════════════════════════════════════════════════════════════

function parseGrowwMF(text) {
    const investor = extractInvestorInfo(text);

    let asOfDate = '';
    const dateMatch = text.match(/HOLDINGS AS ON\s+([\d\-\/]+)/i);
    if (dateMatch) asOfDate = dateMatch[1];

    const summary = { totalInvested: 0, currentValue: 0, profitLoss: 0, xirr: 0 };
    const sumMatch = text.match(/Total Investments\s+Current Portfolio Value\s+Profit\/Loss\s*([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/i);
    if (sumMatch) {
        summary.totalInvested = parseIndianNumber(sumMatch[1]);
        summary.currentValue = parseIndianNumber(sumMatch[2]);
        summary.profitLoss = parseIndianNumber(sumMatch[3]);
    }
    const xirrMatch = text.match(/Profit\/Loss\s*%\s+XIRR\s+([\d,]+\.?\d*)%\s+([\d,]+\.?\d*)%/i) || text.match(/XIRR\s*([\d,]+\.?\d*)%/i);
    if (xirrMatch) {
        summary.xirr = parseIndianNumber(xirrMatch[2] || xirrMatch[1]);
    }

    const schemes = [];
    const values = [];
    const returns = [];

    // --- STRATEGY 1: Block Regex Extraction (handles pdf.js space-joined page text) ---
    if (/Scheme Name\s+AMC\s+Category/i.test(text)) {
        const afterHeader = text.split(/Scheme Name\s+AMC\s+Category/i)[1] || '';
        const schemesBlock = afterHeader.split(/--- PAGE|Sub-category|Profit\/Loss/i)[0] || afterHeader;
        const schemeRegex = /([A-Z][a-zA-Z0-9\s\-\.\(\)]+?\s+(?:Direct|Regular)\s+(?:Plan\s+)?(?:Growth|IDCW|Dividend|Option)(?:\s+Plan)?)\s+([A-Za-z0-9\s\.\-&]+?\s+(?:Mutual Fund|AMC))\s+(Equity|Debt|Hybrid|Solution Oriented|Other)/gi;
        let sm;
        while ((sm = schemeRegex.exec(schemesBlock)) !== null) {
            schemes.push({
                name: sm[1].trim(),
                amc: sm[2].trim(),
                category: sm[3].trim()
            });
        }
    }

    if (/Sub-category\s+Folio No/i.test(text)) {
        const afterHeader = text.split(/Sub-category\s+Folio No/i)[1] || '';
        const valuesSection = afterHeader.split(/Current Value/i)[1] || afterHeader;
        const valuesBlock = valuesSection.split(/--- PAGE|Returns|XIRR/i)[0] || valuesSection;
        const valRegex = /([A-Za-z\s\-]+?)\s+(\d{6,}[\d\/]*)\s+(?:Groww|External|[A-Za-z]+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/gi;
        let vm;
        while ((vm = valRegex.exec(valuesBlock)) !== null) {
            values.push({
                subCategory: vm[1].trim(),
                folioNumber: vm[2].trim(),
                units: parseIndianNumber(vm[3]),
                investedValue: parseIndianNumber(vm[4]),
                currentValue: parseIndianNumber(vm[5])
            });
        }
    }

    if (/Returns\s+XIRR/i.test(text)) {
        const afterHeader = text.split(/Returns\s+XIRR/i)[1] || '';
        const retBlock = afterHeader.split(/--- PAGE/i)[0] || afterHeader;
        const retRegex = /([\d,]+\.?\d*)\s+([\d,]+\.?\d*)%/gi;
        let rm;
        while ((rm = retRegex.exec(retBlock)) !== null) {
            returns.push({
                returns: parseIndianNumber(rm[1]),
                xirr: parseIndianNumber(rm[2])
            });
        }
    }

    // --- STRATEGY 2: Line-by-line fallback if Strategy 1 found nothing ---
    if (schemes.length === 0 || values.length === 0) {
        const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);
        let currentSection = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (/Scheme Name\s+AMC\s+Category/i.test(line)) {
                currentSection = 'SCHEMES';
                continue;
            } else if (/Sub-category\s+Folio No/i.test(line)) {
                currentSection = 'VALUES';
                continue;
            } else if (/Returns\s+XIRR/i.test(line)) {
                currentSection = 'RETURNS';
                continue;
            } else if (/HOLDING SUMMARY|Personal Details|Profit\/Loss\s+%|--- PAGE/i.test(line)) {
                if (currentSection === 'SCHEMES' && /Profit\/Loss/i.test(line)) {
                    currentSection = '';
                }
                continue;
            }

            if (currentSection === 'SCHEMES') {
                const catMatch = line.match(/\s+(Equity|Debt|Hybrid|Solution Oriented|Other)$/i);
                const category = catMatch ? catMatch[1].trim() : 'Equity';
                const beforeCat = catMatch ? line.slice(0, catMatch.index).trim() : line.trim();

                const amcMatch = beforeCat.match(/\b(?!(?:Direct|Regular|Plan|Growth|IDCW|Dividend|Option|Index|Cap|Fund)\b)([A-Z][a-zA-Z0-9&.\-']*(?:\s+[A-Z][a-zA-Z0-9&.\-']*){0,2}\s+(?:Mutual Fund|AMC))\b$/i);
                let schemeName = beforeCat;
                let amc = '';
                if (amcMatch) {
                    amc = amcMatch[1].trim();
                    schemeName = beforeCat.slice(0, amcMatch.index).trim();
                }

                if (schemeName.length > 3) {
                    schemes.push({
                        name: schemeName,
                        amc: amc,
                        category: category
                    });
                }
            } else if (currentSection === 'VALUES') {
                const m = line.match(/^(.*?)\s+(\d+[\d\/]*)\s+(?:Groww|External|\S+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/i);
                if (m) {
                    values.push({
                        subCategory: m[1].trim(),
                        folioNumber: m[2].trim(),
                        units: parseIndianNumber(m[3]),
                        investedValue: parseIndianNumber(m[4]),
                        currentValue: parseIndianNumber(m[5])
                    });
                }
            } else if (currentSection === 'RETURNS') {
                const m = line.match(/^([\d,]+\.?\d*)\s+([\d,]+\.?\d*)%?$/);
                if (m) {
                    returns.push({
                        returns: parseIndianNumber(m[1]),
                        xirr: parseIndianNumber(m[2])
                    });
                }
            }
        }
    }

    const holdings = [];
    const count = Math.max(schemes.length, values.length);
    for (let i = 0; i < count; i++) {
        const s = schemes[i] || { name: 'Unknown Scheme', amc: '', category: 'Equity' };
        const v = values[i] || { subCategory: '', folioNumber: '', units: 0, investedValue: 0, currentValue: 0 };
        const r = returns[i] || { returns: 0, xirr: 0 };

        const units = v.units;
        const curVal = v.currentValue;
        const nav = units > 0 && curVal > 0 ? Math.round((curVal / units) * 10000) / 10000 : 0;

        holdings.push({
            name: s.name,
            type: 'Mutual Fund',
            issuer: s.amc || 'Groww Mutual Fund',
            category: s.category,
            subCategory: v.subCategory,
            folioNumber: v.folioNumber,
            units: units,
            value: curVal,
            currentValue: curVal,
            amount: v.investedValue || curVal,
            nav: nav,
            returns: r.returns,
            xirr: r.xirr,
            isin: '',
            dpId: ''
        });
    }

    return {
        type: 'GROWW_MF',
        broker: 'Groww',
        documentCategory: 'Mutual Fund',
        asOfDate: asOfDate,
        investor: investor,
        summary: summary,
        holdings: holdings
    };
}

// ════════════════════════════════════════════════════════════════
//  GROWW STOCK / DEMAT PARSER
// ════════════════════════════════════════════════════════════════

function parseGrowwStocks(text) {
    const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);
    const investor = extractInvestorInfo(text);
    const holdings = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isinMatch = line.match(/\b(INE[A-Z0-9]{9}\d)\b/);
        if (isinMatch) {
            const isin = isinMatch[1];
            let name = line.replace(isin, '').replace(/\b(?:EQ|BE|SM)\b/g, '').trim();
            let units = 0;
            let val = 0;
            let avgPrice = 0;

            const nums = [...line.matchAll(/([\d,]+\.?\d*)/g)].map(m => parseIndianNumber(m[1])).filter(n => n > 0);
            if (nums.length >= 2) {
                units = nums[0];
                val = nums[nums.length - 1];
                if (nums.length >= 3) avgPrice = nums[1];
            }

            holdings.push({
                name: name || isin,
                type: 'Stock (IND)',
                issuer: name || 'Indian Equity',
                isin: isin,
                units: units,
                amount: avgPrice > 0 && units > 0 ? units * avgPrice : val,
                value: val,
                currentValue: val,
                nav: units > 0 && val > 0 ? val / units : avgPrice,
                folioNumber: '',
                dpId: ''
            });
        }
    }

    if (holdings.length === 0) {
        const generic = parseCDSL(text);
        if (generic.holdings.length > 0) {
            generic.type = 'GROWW_STOCKS';
            generic.broker = 'Groww';
            generic.documentCategory = 'Stock';
            return generic;
        }
    }

    return {
        type: 'GROWW_STOCKS',
        broker: 'Groww',
        documentCategory: 'Stock',
        investor: investor,
        holdings: holdings
    };
}


// ════════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════

function extractInvestorInfo(text) {
    const investor = { name: '', pan: '', mobile: '' };

    const panMatch = text.match(PAN_REGEX) || text.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
    if (panMatch) investor.pan = panMatch[1];

    const mobMatch = text.match(/(?:Mobile\s*(?:Number)?|Phone)\s*[:\-]?\s*(\d{10})/i);
    if (mobMatch) investor.mobile = mobMatch[1];

    const nameMatch = text.match(/Name\s*[:\-]?\s*([A-Za-z\s]+?)(?=\s+(?:Mobile|PAN|Email|Phone|Folio|Account|HOLDING|\n|$))/i) ||
                      text.match(NAME_REGEX);
    if (nameMatch) investor.name = nameMatch[1].trim();

    return investor;
}

function inferTypeFromISIN(isin) {
    if (!isin) return 'Other';
    // Indian ISIN classification:
    // INF... → Mutual Fund (MF units are in INF* range)
    // INE... → Equity, Bond, ETF (most common prefix)
    // IN0... → Government Securities
    if (isin.startsWith('INF')) return 'Mutual Fund';
    if (isin.startsWith('IN0')) return 'Government Bond';
    // INE could be stock, bond, or ETF — we can't distinguish purely from ISIN
    // Name-based inference happens in normalizeToInvestments
    return 'Stock'; // Default for INE; refined later by name keywords
}

function inferTypeFromName(name, currentType) {
    if (!name) return currentType;
    const n = name.toUpperCase();

    // Bond keywords
    if (/\bNCD\b|DEBENTURE|BOND|\bBD\b/.test(n)) return 'Bond';
    // ETF keywords
    if (/\bETF\b|EXCHANGE\s*TRADED/.test(n)) return 'ETF';
    // FD keywords
    if (/\bFD\b|FIXED\s*DEPOSIT/.test(n)) return 'FD';
    // Government securities
    if (/\bGSEC\b|GOI|GOVERNMENT|TREASURY|SDL\b/.test(n)) return 'Government Bond';
    // SGB
    if (/SOVEREIGN\s*GOLD|SGB/.test(n)) return 'SGB';
    // ELSS
    if (/ELSS|TAX\s*SAVER/.test(n)) return 'ELSS';

    return currentType;
}

/**
 * Fallback: If section-based parsing fails, scan ALL lines for ISINs
 * and extract minimal data around each one.
 */
function fallbackISINScan(lines) {
    const holdings = [];
    const seenISINs = new Set();

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/\b(IN[A-Z0-9]{10})\b/);
        if (match && !seenISINs.has(match[1])) {
            seenISINs.add(match[1]);

            // Try to grab the name from adjacent lines
            let name = '';
            const afterIsin = lines[i].substring(lines[i].indexOf(match[1]) + match[1].length).trim();
            if (afterIsin.length > 3 && !/^[\d,.\s]+$/.test(afterIsin)) {
                name = afterIsin;
            } else if (i + 1 < lines.length && lines[i+1].length > 3 && !/^[\d,.\s₹]+$/.test(lines[i+1])) {
                name = lines[i+1];
            }

            // Scan nearby lines for a value
            let value = 0;
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
                const numMatch = lines[j].match(/₹?\s*([\d,]+\.\d{2})\s*$/);
                if (numMatch) {
                    value = parseIndianNumber(numMatch[1]);
                    break;
                }
            }

            holdings.push({
                isin: match[1],
                name: name || match[1],
                units: 0,
                value: value,
                type: inferTypeFromISIN(match[1]),
                folioNumber: '',
                dpId: ''
            });
        }
    }

    return holdings;
}


// ════════════════════════════════════════════════════════════════
//  BANK STATEMENT PARSER (ICICI, SBI, HDFC, Axis, etc.)
// ════════════════════════════════════════════════════════════════

function parseBankStatement(text) {
    const fullText = text;
    const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);

    let bankName = 'Bank Account';
    if (/ICICI\s*BANK/i.test(fullText)) bankName = 'ICICI Bank';
    else if (/STATE\s*BANK\s*OF\s*INDIA|SBI/i.test(fullText)) bankName = 'State Bank of India';
    else if (/HDFC\s*BANK/i.test(fullText)) bankName = 'HDFC Bank';
    else if (/AXIS\s*BANK/i.test(fullText)) bankName = 'Axis Bank';
    else if (/KOTAK/i.test(fullText)) bankName = 'Kotak Bank';
    else if (/PUNJAB\s*NATIONAL|PNB/i.test(fullText)) bankName = 'PNB';
    else if (/BANK\s*OF\s*BARODA/i.test(fullText)) bankName = 'Bank of Baroda';

    // Account Number
    let accountNo = '';
    const accMatch = fullText.match(/(?:Saving|Savings|Account)\s*(?:no\.?|number)?\s*[:\-]?\s*(\d{8,18})/i);
    if (accMatch) accountNo = accMatch[1];

    // Investor name. This used to hunt for ONE SPECIFIC PERSON — a hardcoded first name
    // and a list of nine surnames — and then fall back to that person's full name when
    // nothing matched, so every other user's statement was attributed to a stranger. The
    // label the bank itself prints is the only sound evidence here, so it is all this
    // reads, and an absent name now stays absent rather than being filled in with a guess.
    let investorName = '';
    const labelled = fullText.match(/(?:Account\s*Holder|Customer\s*Name|Holder|Name)\s*[:\-]\s*([A-Za-z][A-Za-z\s.]{2,40}?)(?=\s{2,}|\s+(?:Address|Mobile|PAN|Email|Phone|Account|Branch|IFSC|Statement)\b|$)/i);
    if (labelled && !ORG_WORDS.test(labelled[1])) {
        investorName = labelled[1].trim();
    }

    // Closing balance
    let closingBalance = 0;
    const balanceMatches = [...fullText.matchAll(/([\d,]+\.\d{2})/g)].map(m => parseIndianNumber(m[0]));
    if (balanceMatches.length > 0) {
        for (let i = balanceMatches.length - 1; i >= 0; i--) {
            if (balanceMatches[i] > 10 && balanceMatches[i] < 100000000) {
                closingBalance = balanceMatches[i];
                break;
            }
        }
    }

    // Salary detection. The narration keywords below are generic banking terms; the
    // employer's name is read OUT of the statement rather than matched against one
    // specific company that used to be written into this file. `NEFT` is deliberately no
    // longer a salary marker: it is the transport for most inbound transfers, so it
    // matched rent, refunds and family money and reported all of it as salary.
    let salaryIncome = 0;
    let salaryEmployer = '';

    const txnChunks = fullText.split(/\b\d{1,2}\s+\d{2}\.\d{2}\.\d{4}\b/);
    txnChunks.forEach(chunk => {
        const nums = [...chunk.matchAll(/([\d,]+\.\d{2})/g)].map(m => parseIndianNumber(m[1]));
        if (/\b(?:SALARY|PAYROLL|WAGES|REMUNERATION)\b/i.test(chunk) && nums.length >= 1) {
            const empMatch = chunk.match(/([A-Z][A-Za-z\s&.]{3,40}\s+(?:PRIVATE|LIMITED|PVT|LTD|CORP|INC|LLP))/i);
            if (nums[0] > 1000 && !salaryEmployer) {
                salaryEmployer = empMatch ? empMatch[1].trim() : '';
                salaryIncome = nums[0];
            }
        }
    });

    const shortAcc = accountNo ? `(a/c ...${accountNo.slice(-4)})` : '';
    const itemName = `${bankName} Savings ${shortAcc}`.trim();

    const holding = {
        name: itemName,
        type: 'Bank FD', // Mapped to Bank / Fixed Deposit asset class
        issuer: bankName,
        units: 1,
        value: closingBalance,
        nav: closingBalance,
        folioNumber: accountNo,
        dpId: '',
        isin: '',
        detectedSalary: salaryIncome,
        detectedEmployer: salaryEmployer
    };

    return {
        type: 'BANK_STATEMENT',
        investor: { name: investorName, pan: '' },
        holdings: [holding]
    };
}


// ════════════════════════════════════════════════════════════════
//  GENERIC FINANCIAL STATEMENT PARSER
// ════════════════════════════════════════════════════════════════

function parseGenericPdf(text) {
    const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);

    const isinHoldings = fallbackISINScan(lines);
    if (isinHoldings.length > 0) {
        return {
            type: 'GENERIC_STATEMENT',
            investor: extractInvestorInfo(text),
            holdings: isinHoldings
        };
    }

    const holdings = [];
    let lastFoundValue = 0;

    const valMatches = [...text.matchAll(/(?:Total|Valuation|Balance|Amount|Value|Sum)\s*[:\-]?\s*₹?\s*([\d,]+\.?\d*)/gi)];
    if (valMatches.length > 0) {
        lastFoundValue = parseIndianNumber(valMatches[valMatches.length - 1][1]);
    }

    if (lastFoundValue > 0) {
        holdings.push({
            name: 'Imported Financial Statement Holding',
            type: 'Mutual Fund',
            issuer: 'Imported Asset',
            units: 1,
            value: lastFoundValue,
            nav: lastFoundValue,
            folioNumber: '',
            dpId: '',
            isin: ''
        });
    }

    return {
        type: 'GENERIC_STATEMENT',
        investor: extractInvestorInfo(text),
        holdings: holdings
    };
}


// ════════════════════════════════════════════════════════════════
//  NORMALIZATION — Convert parsed holdings to our app's shape
// ════════════════════════════════════════════════════════════════

function normalizeToInvestments(parsed) {
    return parsed.holdings.map((h, idx) => {
        // Refine type using name-based heuristics
        const refinedType = inferTypeFromName(h.name, h.type);

        return {
            id: Date.now() + idx,
            name:           h.name || h.isin || 'Unknown',
            type:           refinedType,
            issuer:         h.issuer || extractIssuerFromName(h.name),
            amount:         (h.amount !== undefined && h.amount > 0) ? h.amount : (h.value || 0),        // Invested cost
            rate:           0,                    // Unknown from CAS — user can edit later
            payout:         refinedType === 'Mutual Fund' ? 'Cumulative' : 'Annual',
            rating:         '',                   // Not in CAS
            maturityDate:   '',                   // Not in CAS summary (only in transaction details)

            // ── Phase 5 extended fields ──
            isin:           h.isin || '',
            units:          h.units || 0,
            nav:            h.nav || 0,
            currentPrice:   h.nav || 0,
            currentValue:   h.value || (h.units && h.nav ? h.units * h.nav : (h.amount || 0)),
            folioNumber:    h.folioNumber || '',
            dpId:           h.dpId || '',
            importSource:   parsed.type,
            importDate:     new Date().toISOString().slice(0, 10),
            transactions:   []
        };
    });
}

/**
 * Extract a rough issuer name from the full security name.
 * E.g., "Bajaj Finance Limited 9.5% NCD" → "Bajaj Finance"
 */
function extractIssuerFromName(name) {
    if (!name) return '';
    // Remove common suffixes
    let issuer = name
        .replace(/\b(Limited|Ltd|Pvt|Private|Inc|Corp|NCD|Bond|ETF|Fund|Growth|Direct|Regular|Plan|Option|Dividend|IDCW)\b/gi, '')
        .replace(/\d+\.?\d*%/g, '')  // Remove rate percentages
        .replace(/\s{2,}/g, ' ')
        .trim();
    // Take first 2-3 words as issuer name
    const words = issuer.split(/\s+/);
    return words.slice(0, Math.min(3, words.length)).join(' ');
}


// ════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT — Called by app.js
// ════════════════════════════════════════════════════════════════

/**
 * Parse a PDF statement's text and return normalized investment data.
 * @param {string} text - Raw text extracted from PDF by pdf.js
 * @returns {{ type: string, investor: object, holdings: object[], investments: object[] }}
 */
function parseStatement(text) {
    const type = detectStatementType(text);

    if (type === 'UNKNOWN') {
        return {
            type: 'UNKNOWN',
            error: 'Could not identify this PDF. Supported formats: Groww Statements, CDSL CAS, NSDL CAS, CAMS MF, KFintech MF, Bank Statements.',
            investor: {},
            holdings: [],
            investments: []
        };
    }

    let parsed;
    switch (type) {
        case 'GROWW_MF':          parsed = parseGrowwMF(text);          break;
        case 'GROWW_STOCKS':      parsed = parseGrowwStocks(text);      break;
        case 'CDSL_CAS':          parsed = parseCDSL(text);             break;
        case 'NSDL_CAS':          parsed = parseNSDL(text);             break;
        case 'CAMS_MF':           parsed = parseCAMS(text);             break;
        case 'KFINTECH_MF':       parsed = parseKFintech(text);         break;
        case 'BANK_STATEMENT':    parsed = parseBankStatement(text);    break;
        case 'GENERIC_STATEMENT': parsed = parseGenericPdf(text);        break;
        default:                  parsed = { type, investor: {}, holdings: [] };
    }

    const investments = normalizeToInvestments(parsed);

    return {
        type: parsed.type,
        broker: parsed.broker || (type.startsWith('GROWW') ? 'Groww' : ''),
        documentCategory: parsed.documentCategory || (type.includes('MF') ? 'Mutual Fund' : (type.includes('STOCKS') || type.includes('CAS') ? 'Stock' : 'Investment')),
        asOfDate: parsed.asOfDate || '',
        summary: parsed.summary || {},
        investor: parsed.investor,
        holdings: parsed.holdings,
        investments: investments
    };
}

// Expose to global scope (loaded via <script> tag, not a module)
window.RFMParser = {
    parseStatement,
    detectStatementType,
    parseIndianNumber
};
