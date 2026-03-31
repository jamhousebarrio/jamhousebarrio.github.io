// Supabase client — initialized after CDN script loads
// SUPABASE_URL and SUPABASE_ANON_KEY are public by design
(function() {
  window.JH = window.JH || {};

  // These will be set per-environment. For production, hardcode after Supabase project setup.
  // For local dev, the dev server could inject these, but since they're public keys,
  // hardcoding is the standard Supabase pattern.
  var SUPABASE_URL = window.__SUPABASE_URL || '';
  var SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY || '';

  if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
    JH.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
})();
