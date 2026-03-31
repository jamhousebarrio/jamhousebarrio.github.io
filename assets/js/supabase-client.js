// Supabase client — initialized after CDN script loads
// SUPABASE_URL and SUPABASE_ANON_KEY are public by design
(function() {
  window.JH = window.JH || {};

  var SUPABASE_URL = 'https://gtyogyuwuwuxorchfhbo.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_J4iU0HzzkTR58-ffM7cGcA_poxz_KgJ';

  if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
    JH.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
})();
