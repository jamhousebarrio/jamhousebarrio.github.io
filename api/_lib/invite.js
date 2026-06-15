// Shared invite logic. Pure decision functions (unit-tested) + thin Supabase/
// Resend wrappers. One home for "who gets a welcome email and when", imported
// by both api/auth.js (manual Invite button) and api/members.js (automatic on
// status change + sync-invites reconciliation).

import { createClient } from '@supabase/supabase-js';
import { getMemberByEmail } from './auth.js';
import { sendEmail, tplInvite, tplObserverWelcome } from './email.js';

const SITE_URL = process.env.SITE_URL || 'https://jamhouse.space';

export const PORTAL_STATUSES = new Set(['approved', 'observer']);

const norm = (s) => (s == null ? '' : String(s)).toLowerCase().trim();

// True when a status change newly grants portal access:
//   any → Approved, or non-portal → Observer.
// Approved → Observer and Observer → Observer are NOT new grants.
export function shouldInvite(oldStatus, newStatus) {
  const o = norm(oldStatus);
  const n = norm(newStatus);
  if (n === 'approved') return o !== 'approved';
  if (n === 'observer') return !PORTAL_STATUSES.has(o);
  return false;
}

// Guard for the manual admin link-minting actions (invite / resend-invite /
// generate-link). Those verify the *caller* is an admin but, unlike the
// automatic paths (shouldInvite hook, sync-invites), never checked the
// *target's* status — so an admin could mint a portal link for someone still
// in screening (e.g. "Vibe Check"). That link then expires and the self-serve
// magic-link path correctly refuses to renew it, leaving the person stuck.
// Throws an Error with `.status` (caught by each handler's outer try/catch):
//   404 if no application exists, 403 if the member isn't Approved/Observer.
// Returns the member object on success. `sheets` is injected for testability.
export async function assertPortalEligible(sheets, spreadsheetId, email) {
  const row = await getMemberByEmail(sheets, spreadsheetId, email, { anyStatus: true });
  if (!row) {
    const e = new Error(`No application on file for ${email}.`);
    e.status = 404;
    throw e;
  }
  if (!PORTAL_STATUSES.has(norm(row.member.Status))) {
    const e = new Error(
      `${row.member.Name || email} is "${row.member.Status || 'unset'}" — approve them (or set Observer) before sending a portal link.`,
    );
    e.status = 403;
    throw e;
  }
  return row.member;
}

// Given a roster of {email, status, ...} and a Set of lowercased emails that
// already have a Supabase user, return the roster entries with no user.
export function diffMissingInvites(roster, existingEmails) {
  return roster.filter((m) => {
    const e = norm(m.email);
    return e && !existingEmails.has(e);
  });
}

export function getSupabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// All Supabase auth user emails, lowercased, as a Set. Paginates (1000/page).
export async function listUserEmails(supabase) {
  const emails = new Set();
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message || 'listUsers failed');
    for (const u of data.users) if (u.email) emails.add(u.email.toLowerCase().trim());
    if (data.users.length < 1000) break;
    page++;
  }
  return emails;
}

// Mints an action link and sends the branded invite/observer email. Mirrors the
// original inline logic in api/auth.js: generateLink(invite) creates the user +
// mints the link; for existing users it errors email_exists and we fall back to
// recovery so the email still goes out. Observers get no must_change_password
// (read-only, magic-link re-entry). Returns { ok, isNewUser }. Throws on hard
// failure (caller decides whether to surface or swallow).
export async function sendMemberInvite({ supabase, sheets, email, status, member }) {
  const isObserver = norm(status) === 'observer';
  const tplFn = isObserver ? tplObserverWelcome : tplInvite;
  const options = {
    redirectTo: `${SITE_URL}/admin`,
    data: isObserver ? {} : { must_change_password: true },
  };

  let isNewUser = true;
  let linkRes = await supabase.auth.admin.generateLink({ type: 'invite', email, options });
  if (linkRes.error) {
    const code = linkRes.error.code || '';
    const exists = code === 'email_exists' || /already.*(registered|exists)/i.test(linkRes.error.message || '');
    if (exists) {
      isNewUser = false;
      linkRes = await supabase.auth.admin.generateLink({ type: 'recovery', email, options });
    }
  }
  if (linkRes.error || !linkRes.data?.properties?.action_link) {
    throw new Error(linkRes.error?.message || 'Failed to generate action link');
  }

  // member may be passed in (caller already has it) or looked up here.
  let m = member;
  if (!m && sheets) {
    m = (await getMemberByEmail(sheets, process.env.SHEET_ID, email, { anyStatus: true }).catch(() => null))?.member;
  }
  const tpl = tplFn({
    playaName: m?.['Playa Name'] || '',
    name: m?.['Name'] || '',
    actionLink: linkRes.data.properties.action_link,
  });
  await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });
  return { ok: true, isNewUser };
}
