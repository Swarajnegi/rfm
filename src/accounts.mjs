import { createClient } from '@supabase/supabase-js';
import { SyncEngine, META_KEY, DATA_KEYS, PRIVATE_CACHE_KEYS, readDocument, validateDocument, canonical } from './account-sync.mjs';

const STAGE = 'corpus_account_stage_v1';
// Apply a staged account boundary BEFORE Alpine reads the portfolio. Never merge
// a new person's data into a previous person's live reactive objects.
const staged = localStorage.getItem(STAGE);
if (staged) {
  try {
    const change = JSON.parse(staged);
    if (change.document) validateDocument(change.document);
    for (const key of [...DATA_KEYS, ...PRIVATE_CACHE_KEYS]) localStorage.removeItem(key);
    localStorage.removeItem(META_KEY);
    if (change.document) {
      localStorage.setItem('rfm_v1', JSON.stringify(change.document.portfolio));
      localStorage.setItem('rfm_nw_history', JSON.stringify(change.document.history));
      localStorage.setItem(META_KEY, JSON.stringify(change.meta));
    }
    localStorage.removeItem(STAGE);
  } catch (_) { /* Keep stage for recovery; never upload an incomplete swap. */ }
}

document.addEventListener('alpine:init', () => {
  let client, engine, timer, app, remote, callbackBusy = false;
  const cfg = window.CORPUS_ACCOUNT_CONFIG || {};
  const native = () => !!window.AppPlugins?.Capacitor?.isNativePlatform();
  const transport = () => ({
    async read() {
      const { data, error } = await client.from('corpus_portfolios').select('*').maybeSingle();
      if (error) throw error;
      if (data) validateDocument(data.document);
      return data;
    },
    async write(revision, document) {
      const { data, error } = await client.rpc('corpus_save_portfolio', {
        expected_revision: revision, new_document: document
      });
      if (error) throw error;
      return data?.[0] || null;
    }
  });
  const vault = {
    async getItem(key) { return (await window.AppPlugins.SessionVault.get({ key })).value ?? null; },
    async setItem(key, value) { await window.AppPlugins.SessionVault.set({ key, value }); },
    async removeItem(key) { await window.AppPlugins.SessionVault.remove({ key }); }
  };
  const message = error => error?.status === 429 ? 'Too many attempts. Please wait before trying again.'
    : error?.status === 401 ? 'Please sign in again. Your local portfolio is safe.'
    : 'Could not reach your account. Your local portfolio is safe; try again when connected.';
  Alpine.store('account', {
    enabled: !!(cfg.googleEnabled || cfg.emailEnabled),
    googleEnabled: !!cfg.googleEnabled, emailEnabled: !!cfg.emailEnabled,
    email: '', code: '', codeSent: false, retryAt: 0, user: null,
    busy: false, status: 'local', notice: '', error: '', consent: false,
    async init() {
      if (!this.enabled) return;
      try {
        client = createClient(cfg.url, cfg.publishableKey, { auth: {
          flowType: 'pkce', storageKey: 'corpus-auth-v1', persistSession: true,
          detectSessionInUrl: false, storage: native() ? vault : localStorage
        }});
        client.auth.onAuthStateChange((_event, session) => {
          // Supabase warns against awaiting auth calls inside this callback.
          setTimeout(() => this.sessionChanged(session), 0);
        });
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        this.sessionChanged(data.session);
        if (native()) {
          await window.AppPlugins.App.addListener('appUrlOpen', ({ url }) => this.callback(url));
          const launch = await window.AppPlugins.App.getLaunchUrl();
          if (launch?.url) await this.callback(launch.url);
        } else await this.callback(location.href);
        window.addEventListener('online', () => this.sync());
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') this.sync();
        });
        document.addEventListener('corpus:data-saved', () => {
          if (!engine || ['conflict', 'pull', 'unlinked', 'missing'].includes(this.status)) return;
          this.status = 'pending';
          clearTimeout(timer); timer = setTimeout(() => this.sync(), 1500);
        });
        setInterval(() => {
          if (document.visibilityState === 'visible') this.sync();
        }, 60000);
      } catch (e) { this.error = message(e); }
    },
    attach(component) { app = component; },
    sessionChanged(session) {
      const id = session?.user?.id;
      if (this.user?.id === id) return;
      clearTimeout(timer);
      this.user = session?.user ? { id, email: session.user.email } : null;
      engine = id ? new SyncEngine({ storage: localStorage, transport: transport(), userId: id }) : null;
      this.status = id ? 'unlinked' : 'local';
      if (id) this.sync();
    },
    async action(fn) {
      if (this.busy) return;
      this.busy = true; this.error = '';
      try { await fn(); } catch (e) { this.error = e?.publicMessage || message(e); }
      finally { this.busy = false; }
    },
    async google() {
      if (!this.googleEnabled || !this.consent) return;
      await this.action(async () => {
        const redirectTo = native() ? cfg.nativeRedirect : location.origin + location.pathname;
        const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: {
          redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' }
        }});
        if (error) throw error;
        if (native()) await window.AppPlugins.Browser.open({ url: data.url });
        else location.assign(data.url);
      });
    },
    async callback(raw) {
      if (callbackBusy || !client) return;
      const url = new URL(raw);
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) return;
      const expected = native() ? new URL(cfg.nativeRedirect) : new URL(location.origin + location.pathname);
      if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname) return;
      callbackBusy = true;
      try {
        if (url.searchParams.has('error')) throw new Error('Sign-in cancelled');
        const { error } = await client.auth.exchangeCodeForSession(url.searchParams.get('code'));
        if (error) throw error;
      } catch (_) { this.error = 'Sign-in did not finish. Please try again.'; }
      finally {
        if (native()) await window.AppPlugins.Browser.close().catch(() => {});
        else { url.searchParams.delete('code'); url.searchParams.delete('error'); url.searchParams.delete('error_description'); history.replaceState({}, '', url); }
        callbackBusy = false;
      }
    },
    async sendCode() {
      if (!this.emailEnabled || !this.consent) return;
      if (Date.now() < this.retryAt) { this.error = 'Wait one minute before requesting another code.'; return; }
      const email = this.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.error = 'Enter a valid email address.'; return; }
      await this.action(async () => {
        const { error } = await client.auth.signInWithOtp({ email });
        if (error) throw error;
        this.email = email; this.codeSent = true; this.code = ''; this.retryAt = Date.now() + 60000;
        this.notice = 'Check your email for a one-time code.';
      });
    },
    async verifyCode() {
      if (!this.emailEnabled || !this.codeSent || !/^\d{6,10}$/.test(this.code.trim())) {
        this.error = 'Enter the code from your email.'; return;
      }
      await this.action(async () => {
        const { error } = await client.auth.verifyOtp({ email: this.email, token: this.code.trim(), type: 'email' });
        this.code = '';
        if (error) throw { publicMessage: 'That code is invalid or expired. Request a new code.' };
        this.codeSent = false; this.notice = '';
      });
    },
    async sync() {
      if (!engine || this.busy || engine.busy || ['conflict', 'pull', 'missing'].includes(this.status)) return;
      if (localStorage.getItem(STAGE)) { this.error = 'A portfolio switch needs recovery. Sync is paused.'; return; }
      if (!navigator.onLine) { this.notice = 'Offline — changes stay on this device until it reconnects.'; return; }
      const current = engine;
      try {
        const result = await current.sync();
        if (current !== engine) return;
        remote = result.remote;
        this.status = result.state; this.error = '';
        this.notice = ({ saved: 'Synced securely to your account.', equal: 'Up to date.',
          pending: 'Saving your latest changes…', unlinked: 'Choose which portfolio to connect.',
          conflict: 'Both devices changed. No data has been overwritten.',
          pull: 'An updated portfolio is ready from your other device.',
          missing: 'The cloud copy is missing. Automatic upload is paused.' })[result.state] || '';
        if (result.state === 'pending') { clearTimeout(timer); timer = setTimeout(() => this.sync(), 1500); }
      } catch (e) { this.error = message(e); }
    },
    async safeBoundary() {
      if (engine?.busy || app?.regenWealth?.loading || app?.daily?.loading || app?.navFetchState === 'fetching')
        throw { publicMessage: 'Wait for the current analysis or price refresh to finish first.' };
      if (native()) {
        const job = await window.AppPlugins.AnalysisJob.status();
        if (job.state === 'running') throw { publicMessage: 'Wait for the background analysis to finish first.' };
        if (job.id) await window.AppPlugins.AnalysisJob.clear({ id: job.id });
        const alerts = await window.AppPlugins.LocalNotifications.getPending();
        if (alerts.notifications?.length) await window.AppPlugins.LocalNotifications.cancel({ notifications: alerts.notifications });
      }
    },
    async connect() {
      if (!this.user || !engine) return;
      await this.action(async () => {
        const meta = engine.metadata();
        if (meta && meta.userId !== this.user.id)
          throw { publicMessage: 'This device belongs to a different account. Sign out and clear its local copy before switching.' };
        const existing = await transport().read();
        if (existing) { remote = existing; this.status = 'conflict'; this.notice = 'Your account already has a portfolio. Choose which copy to use.'; return; }
        if (!confirm('Upload this device’s holdings, balances, history, profile and any imported bank transactions to your account for device sync?')) return;
        localStorage.setItem(META_KEY, JSON.stringify({ userId: this.user.id, revision: 0, base: null }));
        this.status = 'pending';
      });
      if (this.status === 'pending') this.sync();
    },
    async useCloud() {
      await this.action(async () => {
        if (!remote || !this.user) return;
        const owner = engine?.metadata()?.userId;
        if (owner && owner !== this.user.id)
          throw { publicMessage: 'Sign in to the account that owns this local portfolio before switching.' };
        if (!confirm('Replace this device’s portfolio with the cloud copy? A recovery copy will be kept on this device until you sign out.')) return;
        await this.safeBoundary();
        validateDocument(remote.document);
        localStorage.setItem('corpus_sync_recovery_v1', JSON.stringify({ userId: this.user.id, document: readDocument(localStorage) }));
        localStorage.setItem(STAGE, JSON.stringify({ document: remote.document, meta: {
          userId: this.user.id, revision: remote.revision, base: remote.document, syncedAt: remote.updated_at
        }}));
        location.reload();
      });
    },
    async useLocal() {
      await this.action(async () => {
        if (!remote || !engine) return;
        const meta = engine.metadata();
        if (meta && meta.userId !== this.user.id) throw { publicMessage: 'Sign in to the account that owns this local portfolio.' };
        if (!confirm('Replace your cloud portfolio with this device’s copy? Other devices will need to load it.')) return;
        const saved = await transport().write(remote.revision, readDocument(localStorage));
        if (!saved) { remote = await transport().read(); this.notice = 'The cloud copy changed again. Review your choice before retrying.'; return; }
        localStorage.setItem('corpus_sync_recovery_v1', JSON.stringify({ userId: this.user.id, document: remote.document }));
        engine.remember(saved); remote = null; this.status = 'pending';
      });
      if (this.status === 'pending') this.sync();
    },
    async exportRecovery() {
      const raw = localStorage.getItem('corpus_sync_recovery_v1');
      if (!raw) { this.notice = 'No recovery copy on this device.'; return; }
      const recovery = JSON.parse(raw);
      if (recovery.userId !== this.user?.id) return;
      const d = validateDocument(recovery.document);
      const json = JSON.stringify({ format: 'rfm-backup', formatVersion: 2, exportedAt: new Date().toISOString(), keys: {
        rfm_v1: JSON.stringify(d.portfolio), rfm_nw_history: JSON.stringify(d.history)
      }});
      if (native()) {
        await this.action(async () => {
          const { Filesystem, Directory, Share } = window.AppPlugins;
          const file = await Filesystem.writeFile({ path: 'corpus-sync-recovery.json', data: json, directory: Directory.Cache, encoding: 'utf8' });
          await Share.share({ title: 'Corpus recovery backup', url: file.uri });
        });
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'corpus-sync-recovery.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async signOut() {
      await this.action(async () => {
        await this.safeBoundary();
        const meta = engine?.metadata();
        if (meta && canonical(readDocument(localStorage)) !== canonical(meta.base)
            && !confirm('There are UNSYNCED changes. Signing out removes them from this device. Cancel and export a backup first, or continue to discard them.')) return;
        if (!confirm('Sign out and remove the linked portfolio and recovery copies from this device? Your cloud portfolio stays safe.')) return;
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
        localStorage.removeItem('corpus_sync_recovery_v1');
        if (meta) { localStorage.setItem(STAGE, JSON.stringify({ document: null })); location.reload(); }
      });
    },
    async deleteAccount() {
      if (!this.user) return;
      await this.action(async () => {
        if (prompt('This permanently deletes your Corpus account and synced portfolio. Export a backup first if needed. Type DELETE to continue.') !== 'DELETE') return;
        await this.safeBoundary();
        const { error } = await client.functions.invoke('delete-account', { body: { confirmation: 'DELETE' } });
        if (error) throw { publicMessage: 'Deletion was not confirmed. Sign in again, then retry within five minutes. Your local copy has not been removed.' };
        // Once the server confirms deletion, discard the local session even if
        // revocation reports the now-deleted user as missing.
        await client.auth.signOut({ scope: 'local' });
        if (native()) await vault.removeItem('corpus-auth-v1');
        else localStorage.removeItem('corpus-auth-v1');
        localStorage.removeItem('corpus_sync_recovery_v1');
        localStorage.setItem(STAGE, JSON.stringify({ document: null }));
        location.reload();
      });
    }
  });
});
