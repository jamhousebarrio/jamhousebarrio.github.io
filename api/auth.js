import { createClient } from '@supabase/supabase-js';
import { verifyToken, getMemberByEmail, getMemberRowAnyStatus, isAdmin } from './_lib/auth.js';
import { getSheets, colToLetter } from './_lib/sheets.js';
import { logError } from './_lib/error-log.js';
import { sendEmail, tplInvite, tplRecovery, tplMagicLink } from './_lib/email.js';

// Pull Playa Name + Name out of the Members sheet (any Status). Falls back to
// empty strings if the email isn't in Sheet1 — the templates handle that
// gracefully by defaulting to "friend".
async function personaliseFor(sheets, spreadsheetId, email) {
  try {
    const r = await getMemberRowAnyStatus(sheets, spreadsheetId, email);
    if (!r) return { playaName: '', name: '' };
    return {
      playaName: r.member['Playa Name'] || '',
      name: r.member['Name'] || '',
    };
  } catch {
    return { playaName: '', name: '' };
  }
}

function getSupabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action, ...payload } = req.body || {};

  try {
    // ── Invite: create Supabase user + send branded invite email ────────
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

      // Create the user (idempotent: "already registered" falls through to link mint).
      const createRes = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { must_change_password: true },
      });
      if (createRes.error && !/already.*registered|already.*exists/i.test(createRes.error.message || '')) {
        console.error('Invite createUser error:', createRes.error);
        return res.status(500).json({ error: createRes.error.message || 'Failed to create user' });
      }

      const linkRes = await supabase.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo: `${siteUrl}/admin`, data: { must_change_password: true } },
      });
      if (linkRes.error || !linkRes.data?.properties?.action_link) {
        console.error('Invite generateLink error:', linkRes.error);
        return res.status(500).json({ error: linkRes.error?.message || 'Failed to generate invite link' });
      }

      const { playaName, name } = await personaliseFor(sheets, process.env.SHEET_ID, email);
      const tpl = tplInvite({ playaName, name, actionLink: linkRes.data.properties.action_link });
      await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });
      return res.status(200).json({ success: true });
    }

    // ── Generate link (returns link directly — bypasses Supabase email) ──
    if (action === 'generate-link') {
      const user = verifyToken(req);
      const sheets = getSheets(true);
      const result = await getMemberByEmail(sheets, process.env.SHEET_ID, user.email);
      if (!result || !isAdmin(result.member)) {
        return res.status(403).json({ error: 'Admin required' });
      }

      const { email: targetEmail, type: linkType } = payload;
      if (!targetEmail) return res.status(400).json({ error: 'email required' });

      const supabase = getSupabaseAdmin();
      const siteUrl = process.env.SITE_URL || 'https://jamhouse.space';
      const type = linkType || 'invite';
      const redirectTo = type === 'recovery'
        ? `${siteUrl}/admin/profile`
        : `${siteUrl}/admin`;
      const { data, error } = await supabase.auth.admin.generateLink({
        type,
        email: targetEmail,
        options: { redirectTo, data: { must_change_password: true } },
      });
      if (error) {
        console.error('Generate link error:', error);
        return res.status(500).json({ error: error.message || 'Failed to generate link' });
      }
      return res.status(200).json({
        success: true,
        link: data?.properties?.action_link,
        type,
      });
    }

    // ── List last sign-in time for all Supabase users (admin only) ──────
    if (action === 'list-last-signin') {
      const user = verifyToken(req);
      const sheets = getSheets(true);
      const result = await getMemberByEmail(sheets, process.env.SHEET_ID, user.email);
      if (!result || !isAdmin(result.member)) {
        return res.status(403).json({ error: 'Admin required' });
      }
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (error) {
        console.error('List signins error:', error);
        return res.status(500).json({ error: error.message || 'Failed to list users' });
      }
      const signins = (data?.users || []).map(u => ({
        email: (u.email || '').toLowerCase(),
        lastSignInAt: u.last_sign_in_at || null,
      }));
      return res.status(200).json({ signins });
    }

    // ── Resend invite (password reset for existing user) ─────────────────
    if (action === 'resend-invite') {
      const user = verifyToken(req);
      const sheets = getSheets(true);
      const result = await getMemberByEmail(sheets, process.env.SHEET_ID, user.email);
      if (!result || !isAdmin(result.member)) {
        return res.status(403).json({ error: 'Admin required' });
      }

      const { email: targetEmail } = payload;
      if (!targetEmail) return res.status(400).json({ error: 'email required' });

      const supabase = getSupabaseAdmin();
      const siteUrl = process.env.SITE_URL || 'https://jamhouse.space';
      const linkRes = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: targetEmail,
        options: { redirectTo: `${siteUrl}/admin/profile` },
      });
      if (linkRes.error || !linkRes.data?.properties?.action_link) {
        console.error('Resend invite error:', linkRes.error);
        return res.status(500).json({ error: linkRes.error?.message || 'Failed to resend' });
      }

      const { playaName, name } = await personaliseFor(sheets, process.env.SHEET_ID, targetEmail);
      const tpl = tplRecovery({ playaName, name, actionLink: linkRes.data.properties.action_link, reason: 'password-reset' });
      await sendEmail({ to: targetEmail, subject: tpl.subject, html: tpl.html });
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

    // ── Bulk-prompt approved members missing dietary info ───────────────
    if (action === 'prompt-dietary-bulk') {
      const user = verifyToken(req);
      const sheets = getSheets(true);
      const result = await getMemberByEmail(sheets, process.env.SHEET_ID, user.email);
      if (!result || !isAdmin(result.member)) {
        return res.status(403).json({ error: 'Admin required' });
      }

      const spreadsheetId = process.env.SHEET_ID;
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
      const rows = r.data.values || [];
      if (rows.length < 2) return res.status(200).json({ sent: [], skipped: [] });

      // Ensure the dietary columns exist before we read/write them
      let headers = rows[0];
      const needed = ['FoodType', 'DietaryNotes', 'LastDietaryPromptedAt'];
      const missing = needed.filter(c => headers.indexOf(c) === -1);
      if (missing.length) {
        headers = headers.concat(missing);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Sheet1!A1:' + colToLetter(headers.length - 1) + '1',
          valueInputOption: 'RAW',
          requestBody: { values: [headers] },
        });
      }

      const statusCol = headers.indexOf('Status');
      const emailCol = headers.indexOf('Email');
      const foodCol = headers.indexOf('FoodType');
      const promptedCol = headers.indexOf('LastDietaryPromptedAt');
      const playaCol = headers.indexOf('Playa Name');
      const nameCol = headers.indexOf('Name');

      const supabase = getSupabaseAdmin();
      const siteUrl = process.env.SITE_URL || 'https://jamhouse.space';
      const now = new Date();
      const dayMs = 24 * 60 * 60 * 1000;
      const sent = [];
      const skipped = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if ((row[statusCol] || '').toLowerCase() !== 'approved') continue;
        if ((row[foodCol] || '').trim()) continue; // already filled
        const email = (row[emailCol] || '').trim();
        if (!email) continue;

        const label = (row[playaCol] || row[nameCol] || email).toString();
        const lastPrompted = (row[promptedCol] || '').trim();
        if (lastPrompted) {
          const t = Date.parse(lastPrompted);
          if (!isNaN(t) && (now.getTime() - t) < dayMs) {
            skipped.push({ email, name: label, reason: 'prompted in last 24h' });
            continue;
          }
        }

        try {
          const linkRes = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email,
            options: { redirectTo: `${siteUrl}/admin/profile?prompt=dietary` },
          });
          if (linkRes.error || !linkRes.data?.properties?.action_link) {
            skipped.push({ email, name: label, reason: linkRes.error?.message || 'no action link' });
            continue;
          }
          const playaName = (row[playaCol] || '').toString();
          const nm = (row[nameCol] || '').toString();
          const tpl = tplRecovery({
            playaName, name: nm,
            actionLink: linkRes.data.properties.action_link,
            reason: 'dietary-prompt',
          });
          await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });

          const sheetRow = i + 1;
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Sheet1!' + colToLetter(promptedCol) + sheetRow,
            valueInputOption: 'RAW',
            requestBody: { values: [[now.toISOString()]] },
          });
          sent.push({ email, name: label });
        } catch (e) {
          skipped.push({ email, name: label, reason: e.message || 'failed' });
        }
        // Stay under Resend's 2 req/s free-tier limit.
        await new Promise(r => setTimeout(r, 120));
      }
      return res.status(200).json({ sent, skipped });
    }

    // ── Delete user (remove Supabase account) ───────────────────────────
    if (action === 'delete-user') {
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
      if (target) {
        const { error } = await supabase.auth.admin.deleteUser(target.id);
        if (error) {
          console.error('Delete user error:', error);
          return res.status(500).json({ error: 'Failed to delete user account' });
        }
      }
      return res.status(200).json({ success: true });
    }

    // ── Public: send a magic-link email to an approved member ───────────
    // Always returns { success: true } regardless of outcome to prevent
    // user enumeration. Failure modes (no such email, not approved, send
    // error) are silently logged via logError.
    if (action === 'magic-link') {
      const { email: targetEmail } = payload;
      if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return res.status(200).json({ success: true });
      }
      try {
        const sheets = getSheets(true);
        const row = await getMemberRowAnyStatus(sheets, process.env.SHEET_ID, targetEmail);
        if (!row || (row.member.Status || '').toLowerCase() !== 'approved') {
          await logError(req, new Error('magic-link denied'), {
            action: 'magic-link', email: targetEmail,
            reason: row ? 'not-approved' : 'not-found',
          });
          return res.status(200).json({ success: true });
        }
        const supabase = getSupabaseAdmin();
        const siteUrl = process.env.SITE_URL || 'https://jamhouse.space';
        const linkRes = await supabase.auth.admin.generateLink({
          type: 'magiclink',
          email: targetEmail,
          options: { redirectTo: `${siteUrl}/admin` },
        });
        if (linkRes.error || !linkRes.data?.properties?.action_link) {
          await logError(req, new Error('magic-link generateLink failed'), {
            action: 'magic-link', email: targetEmail, error: linkRes.error?.message,
          });
          return res.status(200).json({ success: true });
        }
        const tpl = tplMagicLink({
          playaName: row.member['Playa Name'] || '',
          name: row.member['Name'] || '',
          actionLink: linkRes.data.properties.action_link,
        });
        await sendEmail({ to: targetEmail, subject: tpl.subject, html: tpl.html });
      } catch (e) {
        await logError(req, e, { action: 'magic-link', email: targetEmail });
      }
      return res.status(200).json({ success: true });
    }

    // ── Public: send a password-reset email ─────────────────────────────
    // Same enumeration-safe contract as magic-link.
    if (action === 'password-reset') {
      const { email: targetEmail } = payload;
      if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return res.status(200).json({ success: true });
      }
      try {
        const sheets = getSheets(true);
        const row = await getMemberRowAnyStatus(sheets, process.env.SHEET_ID, targetEmail);
        if (!row || (row.member.Status || '').toLowerCase() !== 'approved') {
          await logError(req, new Error('password-reset denied'), {
            action: 'password-reset', email: targetEmail,
            reason: row ? 'not-approved' : 'not-found',
          });
          return res.status(200).json({ success: true });
        }
        const supabase = getSupabaseAdmin();
        const siteUrl = process.env.SITE_URL || 'https://jamhouse.space';
        const linkRes = await supabase.auth.admin.generateLink({
          type: 'recovery',
          email: targetEmail,
          options: { redirectTo: `${siteUrl}/admin/profile` },
        });
        if (linkRes.error || !linkRes.data?.properties?.action_link) {
          await logError(req, new Error('password-reset generateLink failed'), {
            action: 'password-reset', email: targetEmail, error: linkRes.error?.message,
          });
          return res.status(200).json({ success: true });
        }
        const tpl = tplRecovery({
          playaName: row.member['Playa Name'] || '',
          name: row.member['Name'] || '',
          actionLink: linkRes.data.properties.action_link,
          reason: 'password-reset',
        });
        await sendEmail({ to: targetEmail, subject: tpl.subject, html: tpl.html });
      } catch (e) {
        await logError(req, e, { action: 'password-reset', email: targetEmail });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Auth API error:', e);
    await logError(req, e, { status: 500 });
    return res.status(500).json({ error: e.message || 'Failed', detail: e.stack });
  }
}
