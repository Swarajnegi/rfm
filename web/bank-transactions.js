// Bank statement import is deliberately local and read-only. A bank feed can
// later produce these same records, but no CSV row moves money or changes the
// bank balance shown in Total corpus.
(function () {
    const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    const headers = {
        date: ['date', 'transaction date', 'txn date', 'value date', 'posting date'],
        description: ['narration', 'description', 'particulars', 'transaction details', 'remarks', 'details'],
        debit: ['debit', 'withdrawal', 'withdrawal amount', 'debit amount', 'paid out'],
        credit: ['credit', 'deposit', 'deposit amount', 'credit amount', 'paid in'],
        amount: ['amount', 'transaction amount'],
        direction: ['type', 'transaction type', 'dr cr', 'debit credit'],
        reference: ['reference', 'ref no', 'reference no', 'transaction id', 'utr', 'cheque no'],
        balance: ['balance', 'closing balance', 'running balance']
    };
    function csvRows(text) {
        const rows = [];
        let row = [], field = '', quoted = false;
        const source = String(text || '').replace(/^\uFEFF/, '');
        for (let i = 0; i < source.length; i++) {
            const c = source[i];
            if (quoted) {
                if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
                else if (c === '"') quoted = false;
                else field += c;
            } else if (c === '"') quoted = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n' || c === '\r') {
                if (c === '\r' && source[i + 1] === '\n') i++;
                row.push(field); field = '';
                if (row.some(v => clean(v))) rows.push(row);
                row = [];
            } else field += c;
        }
        if (quoted) throw new Error('The CSV has an unclosed quoted value. Export it again from your bank.');
        row.push(field);
        if (row.some(v => clean(v))) rows.push(row);
        return rows;
    }
    function date(value) {
        const s = clean(value).replace(/\s+\d{1,2}:\d{2}.*$/, '');
        let y, m, d;
        let hit = /^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)$/.exec(s);
        if (hit) [, y, m, d] = hit;
        else {
            hit = /^([0-3]?\d)[-/]([01]?\d)[-/](\d{4})$/.exec(s);
            if (hit) [, d, m, y] = hit;
            else {
                hit = /^([0-3]?\d)[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/.exec(s);
                if (!hit) return null;
                const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
                    .indexOf(hit[2].slice(0, 3).toLowerCase());
                if (month < 0) return null;
                d = hit[1]; m = month + 1; y = hit[3];
            }
        }
        const out = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const parsed = new Date(out + 'T00:00:00Z');
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === out ? out : null;
    }
    function money(value) {
        const raw = clean(value).replace(/[₹,\s]/g, '');
        if (!raw || raw === '-' || raw === '--') return null;
        const match = /^(\(?-?\d+(?:\.\d{1,2})?\)?)(CR|DR)?$/i.exec(raw);
        if (!match) return NaN;
        let n = Number(match[1].replace(/[()]/g, ''));
        if (match[1].startsWith('(') || match[2]?.toUpperCase() === 'DR') n = -Math.abs(n);
        return Number.isFinite(n) ? n : NaN;
    }
    function fingerprint(text) {
        // Two independent 32-bit hashes are enough for local duplicate detection;
        // the full fields remain in the review screen to resolve rare collisions.
        let a = 2166136261, b = 2246822519;
        for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i);
            a = Math.imul(a ^ c, 16777619);
            b = Math.imul(b ^ c, 3266489917);
        }
        return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
    }
    function classify(description, direction) {
        if (direction !== 'debit') return 'credit';
        const s = description.toUpperCase();
        if (/\b(SIP|MUTUAL FUND|BROKER|DEMAT|SELF TRANSFER|OWN ACCOUNT|ATM|CASH WITHDRAWAL|FD OPENING|RD INSTALLMENT)\b/.test(s)) return 'transfer';
        if (/\b(POS|ECOM|CARD PURCHASE|BILL PAYMENT|UTILITY BILL|GROCERY|RESTAURANT)\b/.test(s)) return 'spend';
        return 'review';
    }
    function parseCsv(text, accountLabel) {
        const account = clean(accountLabel).slice(0, 60);
        if (account.length < 3) throw new Error('Name the bank account first, for example HDFC •1234.');
        const rows = csvRows(text);
        if (rows.length > 10000) throw new Error('This file is too large. Export a shorter date range.');
        let headerRow = -1, cols = {};
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const candidate = {};
            rows[i].forEach((v, column) => {
                for (const [name, names] of Object.entries(headers)) {
                    if (candidate[name] === undefined && names.some(n => key(n) === key(v))) candidate[name] = column;
                }
            });
            if (candidate.date !== undefined && candidate.description !== undefined
                && ((candidate.debit !== undefined && candidate.credit !== undefined)
                    || candidate.amount !== undefined)) { headerRow = i; cols = candidate; break; }
        }
        if (headerRow < 0) throw new Error('This CSV needs date, description and debit/credit or signed amount columns. No data was saved.');
        const entries = [], issues = [], seen = new Map();
        for (let i = headerRow + 1; i < rows.length; i++) {
            const row = rows[i], at = name => row[cols[name]];
            if (!row.some(v => clean(v))) continue;
            const day = date(at('date'));
            if (!day) { issues.push(`Row ${i + 1}: date could not be read`); continue; }
            const description = clean(at('description')).slice(0, 240);
            if (!description) { issues.push(`Row ${i + 1}: no description`); continue; }
            let direction, amount;
            if (cols.debit !== undefined && cols.credit !== undefined) {
                const debit = money(at('debit')), credit = money(at('credit'));
                if (Number.isNaN(debit) || Number.isNaN(credit) || (debit && credit) || (!debit && !credit)) {
                    issues.push(`Row ${i + 1}: ambiguous debit or credit`); continue;
                }
                direction = debit ? 'debit' : 'credit'; amount = Math.abs(debit || credit);
            } else {
                const signed = money(at('amount'));
                const rawAmount = clean(at('amount'));
                const side = cols.direction === undefined ? '' : clean(at('direction')).toLowerCase();
                direction = /^(dr|debit|withdrawal)$/.test(side) ? 'debit'
                    : /^(cr|credit|deposit)$/.test(side) ? 'credit'
                    : /DR$/i.test(rawAmount) || signed < 0 ? 'debit'
                    : /CR$/i.test(rawAmount) ? 'credit' : null;
                if (!direction || !Number.isFinite(signed) || signed === 0) {
                    issues.push(`Row ${i + 1}: unsigned or ambiguous amount`); continue;
                }
                amount = Math.abs(signed);
            }
            if (!(amount > 0) || amount > 1_000_000_000) { issues.push(`Row ${i + 1}: invalid amount`); continue; }
            const reference = cols.reference === undefined ? '' : clean(at('reference')).slice(0, 80);
            const balance = cols.balance === undefined ? null : money(at('balance'));
            const basis = [account.toLowerCase(), day, direction, amount.toFixed(2), description.toLowerCase(), reference.toLowerCase(),
                Number.isFinite(balance) ? balance.toFixed(2) : ''].join('|');
            const occurrence = (seen.get(basis) || 0) + 1;
            seen.set(basis, occurrence);
            if (occurrence > 1 && !reference && !Number.isFinite(balance))
                issues.push(`Row ${i + 1}: identical transaction without a reference; check duplicates`);
            entries.push({ id: 'bank_' + fingerprint(`${basis}|${occurrence}`), account, date: day,
                direction, amount, description, reference, balance: Number.isFinite(balance) ? balance : null,
                category: classify(description, direction), source: 'statement-csv' });
        }
        if (!entries.length) throw new Error('No trustworthy transactions were found. Check the CSV columns and date format.');
        return { account, entries, issues, source: 'statement-csv' };
    }
    function merge(existing, incoming) {
        const out = Array.isArray(existing) ? [...existing] : [];
        const ids = new Set(out.map(x => x.id));
        let added = 0;
        for (const entry of incoming) {
            if (ids.has(entry.id)) continue;
            out.push(entry); ids.add(entry.id); added++;
        }
        out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
        return { entries: out, added, duplicates: incoming.length - added };
    }
    const api = { parseCsv, merge, classify, date, csvRows };
    if (typeof window !== 'undefined') window.CorpusBank = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
