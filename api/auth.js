import { createClient } from '@supabase/supabase-js';
import { verifyToken, getMemberByEmail, isAdmin } from './_lib/auth.js';
import { getSheets } from './_lib/sheets.js';

function getSupabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action, ...payload } = req.body || {};

  try {
    // ── Invite: create Supabase user for newly approved member ──────────
    if (action === 'invite') {
      const user = verifyToken(req);
      const sheets = getSheets(true);
      const result = await getMemberByEmail(sheets, process.env.SHEET_ID, user.email);
      if (!result || !isAdmin(result.member)) {
        return res.status(403).json({ error: 'Admin required' });
      }

      const { email } = payload;
      if (!email) return res.status(400).json({ error: 'email required' });

      const supabase = getSupabaseAdmin();
      const siteUrl = process.env.SITE_URL || 'https://jamhouse.space';
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
        data: { must_change_password: true },
        redirectTo: `${siteUrl}/admin`,
      });
      if (error) {
        if (error.message && error.message.includes('already been registered')) {
          return res.status(409).json({ error: 'User already has an account' });
        }
        console.error('Invite error:', error);
        return res.status(500).json({ error: error.message || 'Failed to invite user' });
      }
      return res.status(200).json({ success: true });
    }

    // ── Clear must_change_password flag ─────────────────────────────────
    if (action === 'clear-password-flag') {
      const user = verifyToken(req);
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.auth.admin.updateUserById(user.sub, {
        user_metadata: { must_change_password: false },
      });
      if (error) {
        console.error('Clear flag error:', error);
        return res.status(500).json({ error: 'Failed to update user metadata' });
      }
      return res.status(200).json({ success: true });
    }

    // ── Disable user (when un-approved) ─────────────────────────────────
    if (action === 'disable') {
      const user = verifyToken(req);
      const sheets = getSheets(true);
      const result = await getMemberByEmail(sheets, process.env.SHEET_ID, user.email);
      if (!result || !isAdmin(result.member)) {
        return res.status(403).json({ error: 'Admin required' });
      }

      const { email: targetEmail } = payload;
      if (!targetEmail) return res.status(400).json({ error: 'email required' });

      const supabase = getSupabaseAdmin();
      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) {
        console.error('List users error:', listError);
        return res.status(500).json({ error: 'Failed to find user' });
      }
      const target = users.find(u => u.email.toLowerCase() === targetEmail.toLowerCase());
      if (!target) return res.status(404).json({ error: 'Supabase user not found' });

      const { error } = await supabase.auth.admin.updateUserById(target.id, {
        ban_duration: '876000h',
      });
      if (error) {
        console.error('Disable error:', error);
        return res.status(500).json({ error: 'Failed to disable user' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Auth API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
