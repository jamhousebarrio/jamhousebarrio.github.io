import { verifyToken, getMemberByEmail, isAdmin } from './_lib/auth.js';
import { getSheets, colToLetter } from './_lib/sheets.js';
import { logError } from './_lib/error-log.js';
import { sendEmail, tplPasswordReset, tplDietaryPrompt, tplMagicLink } from './_lib/email.js';
import { getSupabaseAdmin, sendMemberInvite, assertPortalEligible } from './_lib/invite.js';

const SITE_URL = process.env.SITE_URL || 'https://jamhouse.space';
// Resend free tier is 2 req/s; 500ms keeps us safely under.
const RESEND_RATE_LIMIT_MS = 500;
// Hard cap on bulk dietary prompts per call. Resend free tier is 100/day, and
// admins re-trigger this on a schedule — exceeding the cap returns early so
// they know to continue tomorrow.
const MAX_DIETARY_PROMPTS_PER_RUN = 50;

async function tgSend(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  try {
    const body = { chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' };
    if (process.env.TELEGRAM_TOPIC_ID) body.message_thread_id = parseInt(process.env.TELEGRAM_TOPIC_ID);
    await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (e) { console.error('Telegram send failed:', e); }
}

// Mints an action link via Supabase and dispatches a branded email through
// Resend. Runs generateLink + member-lookup in parallel since they're independent.
// Throws on link-mint failure; sendEmail throws on Resend failure (both are
// caught by the action's outer try-catch).
async function mintAndSendAuthEmail({ supabase, sheets, email, type, redirectTo, linkData, tplFn }) {
  const options = { redirectTo };
  if (linkData) options.data = linkData;
  const [linkRes, member] = await Promise.all([
    supabase.auth.admin.generateLink({ type, email, options }),
    getMemberByEmail(sheets, process.env.SHEET_ID, email, { anyStatus: true }).catch(() => null),
  ]);
  if (linkRes.error || !linkRes.data?.properties?.action_link) {
    throw new Error(linkRes.error?.message || 'Failed to generate action link');
  }
  const tpl = tplFn({
    playaName: member?.member?.['Playa Name'] || '',
    name: member?.member?.['Name'] || '',
    actionLink: linkRes.data.properties.action_link,
  });
  await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });
  return member;
}

// Public-facing email actions (magic-link, password-reset) share the same
// enumeration-safe contract: validate email format, look up the member, gate
// on Approved status, log denials, and always return { success: true }.
async function handlePublicAuthEmailAction(req, res, { action, payload, email, type, redirectTo, tplFn }) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(200).json({ success: true });
  }
  try {
    const sheets = getSheets(true);
    const row = await getMemberByEmail(sheets, process.env.SHEET_ID, email, { anyStatus: true });
    const s = (row?.member?.Status || '').toLowerCase();
    if (!row || (s !== 'approved' && s !== 'observer')) {
      await logError(req, new Error(`${action} denied`), {
        action, email, reason: row ? 'not-portal-access' : 'not-found',
      });
      return res.status(200).json({ success: true });
    }
    await mintAndSendAuthEmail({
      supabase: getSupabaseAdmin(), sheets, email, type, redirectTo, tplFn,
    });
  } catch (e) {
    await logError(req, e, { action, email });
  }
  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action, ...payload } = req.body || {};

  try {
    // ── Invite: send a branded invite/recovery email + Telegram ─────────
    // generateLink(type:'invite') both creates the Supabase user and mints
    // a confirm link. For users who already exist it errors with
    // email_exists (422) — we fall back to type:'recovery' so the email
    // still goes out, just as a password-reset link. We use the fallback
    // outcome to detect isNewUser, which gates the "joined us as a lurker"
    // Telegram (first-contact only; re-invites stay silent).
    if (action === 'invite') {
      const user = verifyToken(req);
      const sheets = getSheets(true);
      const result = await getMemberByEmail(sheets, process.env.SHEET_ID, user.email);
      if (!result || !isAdmin(result.member)) {
        return res.status(403).json({ error: 'Admin required' });
      }

      const { email } = payload;
      if (!email) return res.status(400).json({ error: 'email required' });

      // Refuse to invite anyone who isn't Approved/Observer — minting a portal
      // link for a screening-stage member leaves them stuck once it expires
      // (the self-serve renew path is status-gated). Throws 403/404 → outer catch.
      const targetMember = await assertPortalEligible(sheets, process.env.SHEET_ID, email);
      const preStatus = (targetMember.Status || '').toString().toLowerCase().trim();

      // Shared helper mints the link (invite → recovery fallback for existing
      // users) and sends the branded invite/observer email.
      let invite;
      try {
        invite = await sendMemberInvite({
          supabase: getSupabaseAdmin(), sheets, email, status: preStatus, member: targetMember,
        });
      } catch (e) {
        console.error('Invite generateLink/send error:', e);
        return res.status(500).json({ error: e.message || 'Failed to send invite' });
      }

      const memberName = (targetMember['Playa Name'] || targetMember['Name'] || email).toString().trim() || email;
      let tgText = null;
      if (preStatus === 'observer') {
        if (invite.isNewUser) tgText = '👀 *' + memberName + '* joined us as a lurker.';
      } else if (preStatus === 'approved') {
        tgText = '🎉 Welcome to the barrio! *' + memberName + '* has been approved — say hi!';
      } else {
        tgText = '✉️ *' + memberName + '* was invited to the dashboard.';
      }
      if (tgText) await tgSend(tgText);

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

      // Same gate as the invite action — no portal links for non-Approved members.
      await assertPortalEligible(sheets, process.env.SHEET_ID, targetEmail);

      const supabase = getSupabaseAdmin();
      const type = linkType || 'invite';
      const redirectTo = type === 'recovery'
        ? `${SITE_URL}/admin/profile`
        : `${SITE_URL}/admin`;
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

      // Same gate — no portal links for non-Approved members.
      await assertPortalEligible(sheets, process.env.SHEET_ID, targetEmail);

      await mintAndSendAuthEmail({
        supabase: getSupabaseAdmin(), sheets, email: targetEmail,
        type: 'recovery',
        redirectTo: `${SITE_URL}/admin/profile`,
        tplFn: tplPasswordReset,
      });
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
      const now = new Date();
      const dayMs = 24 * 60 * 60 * 1000;
      const sent = [];
      const skipped = [];
      let stoppedAtCap = false;

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

        if (sent.length >= MAX_DIETARY_PROMPTS_PER_RUN) {
          stoppedAtCap = true;
          skipped.push({ email, name: label, reason: 'daily cap reached — retry tomorrow' });
          continue;
        }

        try {
          const linkRes = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email,
            options: { redirectTo: `${SITE_URL}/admin/profile?prompt=dietary` },
          });
          if (linkRes.error || !linkRes.data?.properties?.action_link) {
            skipped.push({ email, name: label, reason: linkRes.error?.message || 'no action link' });
            continue;
          }
          const tpl = tplDietaryPrompt({
            playaName: (row[playaCol] || '').toString(),
            name: (row[nameCol] || '').toString(),
            actionLink: linkRes.data.properties.action_link,
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
        await new Promise(r => setTimeout(r, RESEND_RATE_LIMIT_MS));
      }
      return res.status(200).json({ sent, skipped, stoppedAtCap });
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
      let target = null;
      for (let page = 1; page <= 20 && !target; page++) {
        const { data, error: listError } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (listError) {
          console.error('List users error:', listError);
          return res.status(500).json({ error: 'Failed to find user' });
        }
        target = (data.users || []).find(u => (u.email || '').toLowerCase() === targetEmail.toLowerCase()) || null;
        if ((data.users || []).length < 1000) break;
      }
      if (!target) {
        return res.status(200).json({ success: true, deleted: false });
      }
      // shouldSoftDelete=false → hard delete. Default behavior leaves the
      // email locked in auth.users, blocking re-invite of the same address.
      const { error } = await supabase.auth.admin.deleteUser(target.id, false);
      if (error) {
        console.error('Delete user error:', error);
        return res.status(500).json({ error: 'Failed to delete user account' });
      }
      return res.status(200).json({ success: true, deleted: true });
    }

    // ── Public email actions (enumeration-safe — always return success) ──
    if (action === 'magic-link') {
      return handlePublicAuthEmailAction(req, res, {
        action: 'magic-link', payload, email: payload.email,
        type: 'magiclink',
        redirectTo: `${SITE_URL}/admin`,
        tplFn: tplMagicLink,
      });
    }

    if (action === 'password-reset') {
      return handlePublicAuthEmailAction(req, res, {
        action: 'password-reset', payload, email: payload.email,
        type: 'recovery',
        redirectTo: `${SITE_URL}/admin/profile`,
        tplFn: tplPasswordReset,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Auth API error:', e);
    await logError(req, e, { status: 500 });
    return res.status(500).json({ error: e.message || 'Failed', detail: e.message });
  }
}
