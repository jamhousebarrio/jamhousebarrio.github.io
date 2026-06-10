// Send all three JamHouse transactional email templates to a test inbox so
// you can eyeball them in Gmail/Outlook before wiring the live flows over.
//
// Usage:
//   RESEND_API_KEY=re_xxx RESEND_TO=you@example.com node scripts/send-test-emails.mjs
//
// Required:
//   RESEND_TO=you@example.com             # recipient address (no default)
// Optional overrides:
//   ONLY=invite|password-reset|dietary|magic-link  # send just one template
//   EMAIL_FROM='JamHouse <noreply@jamhouse.space>'
//   BARRIO_FEE_STANDARD=280 BARRIO_FEE_LOW_INCOME=180 BARRIO_FEE_DEADLINE='mid-May 2026'
//   GROUP_CHAT_URL_TELEGRAM=... GROUP_CHAT_URL_WHATSAPP=...

import {
  sendEmail,
  tplInvite,
  tplPasswordReset,
  tplDietaryPrompt,
  tplMagicLink,
} from '../api/_lib/email.js';

const TO = process.env.RESEND_TO;
const ONLY = (process.env.ONLY || '').toLowerCase();

if (!TO) {
  console.error('Set RESEND_TO to the recipient address');
  process.exit(1);
}

if (!process.env.RESEND_API_KEY) {
  console.error('Missing RESEND_API_KEY. Re-run with:');
  console.error("  RESEND_API_KEY=re_xxx node scripts/send-test-emails.mjs");
  process.exit(2);
}

// In production personalisation comes from the Members sheet via
// getMemberByEmail({ anyStatus: true }); here we just hardcode a recipient.
const MOCK = {
  playaName: 'Frank',
  name: 'Frank',
};

// Fake action links so you can see the buttons render, but clicking them
// won't burn a real magic link (Supabase rejects bogus tokens cleanly).
const MOCK_LINKS = {
  invite: 'https://jamhouse.space/admin#preview=invite',
  password: 'https://jamhouse.space/admin/profile#preview=password-reset',
  dietary: 'https://jamhouse.space/admin/profile?prompt=dietary#preview',
  magic: 'https://jamhouse.space/admin#preview=magic-link',
};

const templates = {
  'invite': () => ({
    label: 'Invite (new approved member)',
    payload: tplInvite({ ...MOCK, actionLink: MOCK_LINKS.invite }),
  }),
  'password-reset': () => ({
    label: 'Password reset',
    payload: tplPasswordReset({ ...MOCK, actionLink: MOCK_LINKS.password }),
  }),
  'dietary': () => ({
    label: 'Dietary prompt (bulk)',
    payload: tplDietaryPrompt({ ...MOCK, actionLink: MOCK_LINKS.dietary }),
  }),
  'magic-link': () => ({
    label: 'Magic link sign-in',
    payload: tplMagicLink({ ...MOCK, actionLink: MOCK_LINKS.magic }),
  }),
};

const order = ['invite', 'password-reset', 'dietary', 'magic-link'];
const queue = ONLY ? order.filter(k => k === ONLY) : order;

if (queue.length === 0) {
  console.error(`Unknown ONLY=${ONLY}. Pick one of: ${order.join(', ')}`);
  process.exit(2);
}

console.log(`Sending ${queue.length} test email${queue.length === 1 ? '' : 's'} to ${TO}…\n`);

let okCount = 0;
let failCount = 0;
for (const key of queue) {
  const { label, payload } = templates[key]();
  process.stdout.write(`  • ${label.padEnd(34, ' ')} `);
  try {
    const res = await sendEmail({
      to: TO,
      subject: `[TEST] ${payload.subject}`,
      html: payload.html,
    });
    console.log(`✓ id=${res.id || '(no id)'}`);
    okCount++;
  } catch (e) {
    console.log(`✗ ${e.message}`);
    if (e.body) console.log(`    body: ${e.body.slice(0, 200)}`);
    failCount++;
  }
  // Stay well under Resend's 2 req/s free-tier limit.
  await new Promise(r => setTimeout(r, 600));
}

console.log(`\nDone. ${okCount} sent, ${failCount} failed.`);
console.log(`Check ${TO}'s inbox (and Junk on first send — fresh sender domain).`);
console.log(`Resend logs: https://resend.com/emails`);
process.exit(failCount === 0 ? 0 : 1);
