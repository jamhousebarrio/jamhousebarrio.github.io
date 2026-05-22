// One-shot: clear user_metadata.must_change_password for a given email.
// Use when an Observer was invited before we stopped setting that flag
// (it traps them on /admin/profile per admin-auth.js:105-108).
//
// Usage: node --env-file=.env --env-file=.env.supabase scripts/clear-must-change-password.mjs <email>

import { createClient } from '@supabase/supabase-js';

const email = process.argv[2];
if (!email) {
  console.error('usage: node --env-file=.env --env-file=.env.supabase scripts/clear-must-change-password.mjs <email>');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
if (listError) { console.error(listError); process.exit(1); }
const target = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
if (!target) { console.error('no user found'); process.exit(1); }

const { error } = await supabase.auth.admin.updateUserById(target.id, {
  user_metadata: { ...target.user_metadata, must_change_password: false },
});
if (error) { console.error(error); process.exit(1); }
console.log('Cleared must_change_password for', email);
