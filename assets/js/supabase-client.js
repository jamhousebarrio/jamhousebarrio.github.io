// Supabase client — initialized after CDN script loads
// SUPABASE_URL and SUPABASE_ANON_KEY are public by design
(function() {
  window.JH = window.JH || {};

  var SUPABASE_URL = 'https://gtyogyuwuwuxorchfhbo.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0eW9neXV3dXd1eG9yY2hmaGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NTY2ODEsImV4cCI6MjA5MDUzMjY4MX0.NwaNImFF8zwQpMUdJIVBMSI61YuatRqQNcd6CIUwytI';

  if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
    JH.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
})();
