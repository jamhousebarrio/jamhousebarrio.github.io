// Mint a fresh recovery action_link via Supabase admin, then follow the
// verify endpoint server-side to capture the session tokens, and emit a
// local http://localhost:3000/admin#<tokens> URL the user can paste.
// Workaround for the case where Supabase's allowlist refuses
// http://localhost:3000 as a redirect_to (so the link in the inbox
// always points at production).
//
// Usage: node --env-file=.env --env-file=.env.supabase scripts/local-login-link.mjs <email>

import { createClient } from '@supabase/supabase-js';

const email = process.argv[2];
if (!email) {
  console.error('usage: node --env-file=.env --env-file=.env.supabase scripts/local-login-link.mjs <email>');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// type='magiclink' fires SIGNED_IN on the client (recovery fires
// PASSWORD_RECOVERY, which admin.html doesn't auto-redirect on).
const linkRes = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo: 'http://localhost:3000/admin' },
});
if (linkRes.error || !linkRes.data?.properties?.action_link) {
  console.error('generateLink error:', linkRes.error);
  process.exit(1);
}

const actionLink = linkRes.data.properties.action_link;
console.error('action_link:', actionLink);

const verifyRes = await fetch(actionLink, { redirect: 'manual' });
const location = verifyRes.headers.get('location') || '';
console.error('verify status:', verifyRes.status, 'location:', location);

const hashIdx = location.indexOf('#');
if (hashIdx === -1) {
  console.error('No fragment in redirect. Supabase may have refused the redirect.');
  console.log(location);
  process.exit(2);
}
const fragment = location.slice(hashIdx + 1);
if (fragment.startsWith('error')) {
  console.error('Verify returned an error fragment:', fragment);
  process.exit(3);
}

console.log('\nPaste this URL into your browser:\n');
console.log(`http://localhost:3000/admin#${fragment}\n`);
