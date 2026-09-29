// Public identifiers only. Never add a service-role key, SMTP password or OAuth secret.
window.CORPUS_ACCOUNT_CONFIG = Object.freeze({
  url: 'https://rtoiizrwpzuywrwhoxjl.supabase.co',
  publishableKey: 'sb_publishable_G8_vBnvm5sDZmvTH-bWogg_-QvTFxJw',
  // Brevo SMTP delivery confirmed by the tester; credentials stay in Supabase.
  googleEnabled: true,
  emailEnabled: true,
  nativeRedirect: 'com.swarajnegi.corpus://auth/callback'
});
