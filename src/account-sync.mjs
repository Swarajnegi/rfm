// No network or UI dependencies: the synchronization contract is testable offline.
export const META_KEY = 'corpus_sync_v1';
export const DATA_KEYS = ['rfm_v1', 'rfm_nw_history'];
export const PRIVATE_CACHE_KEYS = ['corpus_last_visit', 'corpus_noti_seen',
  'rfm_regen_cache_findings_v2', 'rfm_regen_pending_brief_v1', 'rfm_daily_brief_v1'];
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function validateDocument(d) {
  if (!d || d.schema !== 1 || !d.portfolio || typeof d.portfolio !== 'object'
      || Array.isArray(d.portfolio) || !Array.isArray(d.portfolio.investments)
      || !Array.isArray(d.history)) throw new Error('Unsupported portfolio backup. No data was replaced.');
  const p = d.portfolio;
  const date = s => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const parsed = new Date(s + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s;
  };
  const nonnegative = n => Number.isFinite(n) && n >= 0;
  if (p.tax?.sales !== undefined && (!Array.isArray(p.tax.sales) || p.tax.sales.some(s =>
      !s || !date(s.date) || !Number.isFinite(s.quantity) || s.quantity <= 0
      || !nonnegative(s.proceeds) || !nonnegative(s.fees) || !Array.isArray(s.allocations)
      || s.allocations.some(a => !a || !Number.isFinite(a.quantity) || a.quantity <= 0
        || (a.gain !== null && !Number.isFinite(a.gain))))))
    throw new Error('Invalid sales ledger. No data was replaced.');
  if (p.cpi !== undefined && p.cpi !== null
      && (typeof p.cpi !== 'object' || !Number.isFinite(p.cpi.rate) || Math.abs(p.cpi.rate) > 100
        || !/^\w+ \d{4}$/.test(p.cpi.referenceMonth || '')))
    throw new Error('Invalid CPI cache. No data was replaced.');
  if (p.bankTransactions !== undefined && (!Array.isArray(p.bankTransactions)
      || p.bankTransactions.length > 3000 || p.bankTransactions.some(t => !t
        || typeof t.id !== 'string' || !/^bank_[0-9a-f]{16}$/.test(t.id)
        || !date(t.date) || !['debit', 'credit'].includes(t.direction)
        || !Number.isFinite(t.amount) || t.amount <= 0 || t.amount > 1_000_000_000
        || typeof t.account !== 'string' || !t.account.trim() || t.account.length > 60
        || typeof t.description !== 'string' || !t.description.trim() || t.description.length > 240
        || !['spend', 'transfer', 'review', 'credit'].includes(t.category))))
    throw new Error('Invalid bank transaction ledger. No data was replaced.');
  if (p.bankImportAccount !== undefined && (typeof p.bankImportAccount !== 'string' || p.bankImportAccount.length > 60))
    throw new Error('Invalid bank account label. No data was replaced.');
  if (p.investments.some(i => !i || typeof i !== 'object' || Array.isArray(i)
      || (i.taxLots !== undefined && (!Array.isArray(i.taxLots) || i.taxLots.some(l => !l || !date(l.date)
        || !Number.isFinite(l.quantity) || l.quantity <= 0 || !nonnegative(l.quantityRemaining)
        || !nonnegative(l.cost))))
      || (i.confirmedInstalments !== undefined && (!Array.isArray(i.confirmedInstalments)
        || i.confirmedInstalments.some(x => !x || !date(x.date) || !nonnegative(x.amount))))))
    throw new Error('Invalid holding history. No data was replaced.');
  if (p.sips !== undefined && (!Array.isArray(p.sips) || p.sips.some(s => !s || typeof s !== 'object'
      || (s.confirmedInstalments !== undefined && (!Array.isArray(s.confirmedInstalments)
        || s.confirmedInstalments.some(x => !x || !date(x.date) || !nonnegative(x.amount)))))))
    throw new Error('Invalid recurring schedule. No data was replaced.');
  if (new TextEncoder().encode(JSON.stringify(d)).length > 2_000_000)
    throw new Error('This portfolio exceeds the sync size limit. Export a local backup.');
  return d;
}
export function readDocument(storage) {
  return validateDocument({ schema: 1, portfolio: JSON.parse(storage.getItem('rfm_v1') || '{"investments":[]}'),
    history: JSON.parse(storage.getItem('rfm_nw_history') || '[]') });
}
export function decision(local, base, remote, revision) {
  const here = canonical(local);
  if (!remote) return revision === 0 ? 'push' : 'missing';
  if (here === canonical(remote.document)) return 'equal';
  const dirty = !base || here !== canonical(base);
  if (remote.revision !== revision) return dirty ? 'conflict' : 'pull';
  return dirty ? 'push' : 'equal';
}
export class SyncEngine {
  constructor({ storage, transport, userId }) {
    this.storage = storage; this.transport = transport; this.userId = userId;
    this.busy = false;
  }
  metadata() { return JSON.parse(this.storage.getItem(META_KEY) || 'null'); }
  remember(row) {
    this.storage.setItem(META_KEY, JSON.stringify({ userId: this.userId,
      revision: row.revision, base: row.document, syncedAt: row.updated_at }));
  }
  async sync() {
    if (this.busy) return { state: 'busy' };
    const meta = this.metadata();
    // A session is NOT consent to upload an existing local portfolio.
    if (meta?.userId !== this.userId) return { state: 'unlinked' };
    this.busy = true;
    try {
      const remote = await this.transport.read();
      const local = readDocument(this.storage);
      const state = decision(local, meta.base, remote, meta.revision);
      if (state === 'equal') { this.remember(remote); return { state }; }
      if (state !== 'push') return { state, remote };
      const saved = await this.transport.write(meta.revision, local);
      if (!saved) return { state: 'conflict', remote: await this.transport.read() };
      // Remember exactly what was acknowledged, NOT later edits made in-flight.
      this.remember(saved);
      return { state: canonical(readDocument(this.storage)) === canonical(local) ? 'saved' : 'pending' };
    } finally { this.busy = false; }
  }
}
