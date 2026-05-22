// Resend HTTP API client + JamHouse-branded transactional email templates.
// All emails are sent directly from our serverless functions — we don't go
// through Supabase's email pipeline. Supabase only mints the action link via
// generateLink(); we wrap it in a personalised template and POST to Resend.

const RESEND_URL = 'https://api.resend.com/emails';
const EVENT_LABEL = 'July 7–12, 2026';
const EVENT_START = new Date('2026-07-07T00:00:00Z');

const COLORS = {
  page: '#fbf6ed',
  surface: '#ffffff',
  ink: '#1a1612',
  inkSoft: '#5c544a',
  accent: '#e8a84c',
  accentDark: '#c98a32',
  border: '#e8dcc4',
  panel: '#f4ecd9',
};

export async function sendEmail({ to, subject, html, text, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const err = new Error('RESEND_API_KEY not configured');
    err.status = 500;
    throw err;
  }
  const body = {
    from: process.env.EMAIL_FROM || 'JamHouse <noreply@jamhouse.space>',
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text: text || htmlToText(html),
    reply_to: replyTo || process.env.EMAIL_REPLY_TO || 'fanteevi@gmail.com',
  };
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    const err = new Error(`Resend send failed (${res.status})`);
    err.status = res.status;
    err.body = errBody;
    throw err;
  }
  return res.json();
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function daysUntilEvent() {
  const now = new Date();
  const days = Math.ceil((EVENT_START.getTime() - now.getTime()) / 86_400_000);
  if (days > 1) return `${days} days until Elsewhere · ${EVENT_LABEL}`;
  if (days === 1) return `Tomorrow! Elsewhere · ${EVENT_LABEL}`;
  if (days === 0) return `Today! Elsewhere · ${EVENT_LABEL}`;
  if (days > -7) return `Elsewhere is happening now · ${EVENT_LABEL}`;
  return `Elsewhere · ${EVENT_LABEL}`;
}

function getFeeConfig() {
  return {
    standard: process.env.BARRIO_FEE_STANDARD || '280',
    lowIncome: process.env.BARRIO_FEE_LOW_INCOME || '180',
    deadline: process.env.BARRIO_FEE_DEADLINE || 'mid-May 2026',
    covers: process.env.BARRIO_FEE_COVERS ||
      'wood for shade, storage and kitchen materials, sound + instrument upkeep, water refills, food, snacks, drinks, comfy pillows — and the rest of the barrio essentials',
  };
}

function getChatLinks() {
  return {
    telegram: process.env.GROUP_CHAT_URL_TELEGRAM || 'https://t.me/+m8IcFErlLtwwZmQ0',
    whatsapp: process.env.GROUP_CHAT_URL_WHATSAPP || 'https://chat.whatsapp.com/BVYTz7xiJCS61Dan7CEjna',
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function greet({ playaName, name }) {
  const who = (playaName && String(playaName).trim()) || (name && String(name).trim()) || 'friend';
  return `Hey ${escapeHtml(who)},`;
}

function cta(label, href) {
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px auto;">
    <tr>
      <td style="border-radius:8px; background:${COLORS.accent};">
        <a href="${escapeHtml(href)}"
           style="display:inline-block; padding:14px 28px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; font-weight:700; font-size:16px; color:#1a1612; text-decoration:none; border-radius:8px;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

function countdownLine() {
  return `<div style="margin:0 0 16px 0; padding:10px 14px; background:${COLORS.panel}; border-radius:8px; font-size:14px; color:${COLORS.inkSoft}; text-align:center;">
  <span style="font-weight:600; color:${COLORS.accentDark};">${escapeHtml(daysUntilEvent())}</span>
</div>`;
}

function helpLine() {
  const { telegram } = getChatLinks();
  return `<p style="margin:24px 0 0 0; font-size:14px; color:${COLORS.inkSoft};">
  Stuck? Reply to this email or hop into the
  <a href="${escapeHtml(telegram)}" style="color:${COLORS.accentDark}; font-weight:600;">JamHouse Telegram group</a>.
</p>`;
}

function sectionHeading(label) {
  return `<h3 style="font-size:13px; margin:24px 0 10px 0; color:${COLORS.ink}; letter-spacing:1px; text-transform:uppercase; font-weight:700;">${escapeHtml(label)}</h3>`;
}

function renderLayout({ preheader, bodyHtml }) {
  const safePre = escapeHtml(preheader || '');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>JamHouse</title>
  <!--[if mso]>
  <style>body, table, td, p, h1, h2, h3 { font-family: Arial, Helvetica, sans-serif !important; }</style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background:${COLORS.page}; color:${COLORS.ink}; -webkit-text-size-adjust:100%;">
  <span style="display:none !important; visibility:hidden; mso-hide:all; font-size:1px; color:${COLORS.page}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${safePre}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COLORS.page};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px; width:100%; background:${COLORS.surface}; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,0.06); overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 12px 40px;">
              <div style="font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-weight:800; font-size:24px; letter-spacing:0.5px; color:${COLORS.ink};">JamHouse</div>
              <div style="height:2px; background:${COLORS.accent}; width:48px; margin-top:6px;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px 32px 40px; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size:16px; line-height:1.55; color:${COLORS.ink};">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 28px 40px; border-top:1px solid ${COLORS.border}; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size:12px; line-height:1.5; color:${COLORS.inkSoft};">
              JamHouse — a barrio at Elsewhere · ${EVENT_LABEL} · <a href="https://jamhouse.space" style="color:${COLORS.inkSoft}; text-decoration:underline;">jamhouse.space</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function tplInvite({ playaName, name, actionLink }) {
  const fee = getFeeConfig();
  const { telegram, whatsapp } = getChatLinks();
  const bodyHtml = `
<p style="font-size:18px; margin:0 0 12px 0; font-weight:600;">${greet({ playaName, name })}</p>
<p style="margin:0 0 12px 0;">Your application was approved — welcome to the barrio.</p>
${countdownLine()}
<p style="margin:0 0 4px 0;">Click below to set your password and get into your member dashboard:</p>
${cta('Set your password', actionLink)}

${sectionHeading('First three things to do')}
<ol style="margin:0 0 8px 0; padding-left:22px; color:${COLORS.ink};">
  <li style="margin-bottom:6px;">Set your password (the button above).</li>
  <li style="margin-bottom:6px;">Fill in your <strong>dietary preferences</strong> — we plan meals around it.</li>
  <li>Confirm your <strong>arrival logistics</strong> — dates, transport, camping.</li>
</ol>

${sectionHeading('About the barrio fee')}
<p style="margin:0 0 10px 0;">The fee covers ${escapeHtml(fee.covers)}.</p>
<div style="margin:0 0 10px 0; padding:12px 14px; background:${COLORS.panel}; border-radius:8px; font-size:15px;">
  <div style="margin-bottom:4px;"><strong>Standard tier:</strong> €${escapeHtml(fee.standard)}</div>
  <div style="margin-bottom:4px;"><strong>Low-income tier:</strong> €${escapeHtml(fee.lowIncome)}</div>
  <div><strong>Due:</strong> ${escapeHtml(fee.deadline)}</div>
</div>
<p style="margin:0 0 8px 0; font-size:14px; color:${COLORS.inkSoft};">
  If it's a stretch right now, talk to us — we always figure something out together. No one stays out for money.
</p>

${sectionHeading('Join the conversation')}
<p style="margin:0 0 8px 0;">
  <a href="${escapeHtml(telegram)}" style="color:${COLORS.accentDark}; font-weight:600;">Telegram — main channel</a><br>
  <a href="${escapeHtml(whatsapp)}" style="color:${COLORS.accentDark}; font-weight:600;">WhatsApp — announcements</a>
</p>

${helpLine()}`;

  return {
    subject: 'Welcome to JamHouse — set up your account',
    html: renderLayout({
      preheader: 'Welcome to JamHouse — set your password and meet the barrio.',
      bodyHtml,
    }),
  };
}

export function tplObserverWelcome({ playaName, name, actionLink }) {
  const { telegram, whatsapp } = getChatLinks();
  const bodyHtml = `
<p style="font-size:18px; margin:0 0 12px 0; font-weight:600;">${greet({ playaName, name })}</p>
<p style="margin:0 0 12px 0;">You've been added to JamHouse as an <strong>Observer</strong> — read-only access to what we're cooking up for the barrio at Elsewhere.</p>
${countdownLine()}

${sectionHeading('What Observer access means')}
<p style="margin:0 0 10px 0;">You can see the planning side of the barrio — events, shifts, meal rota, logistics — but you can't sign up for things, edit member data, or commit to camp membership. It's a way for us to share openly without locking you in.</p>

${sectionHeading('Want to join us properly?')}
<p style="margin:0 0 10px 0;">If you'd like to be a <strong>full barrio member</strong> — shifts, fees, the works — please reach out to one of the leads. Once they update your status, you'll get the full welcome with everything you need to know.</p>
<p style="margin:0 0 12px 0;">The fastest way is the Telegram group below; otherwise just reply to this email.</p>

${cta('Set up access', actionLink)}

${sectionHeading('Join the conversation')}
<p style="margin:0 0 8px 0;">
  <a href="${escapeHtml(telegram)}" style="color:${COLORS.accentDark}; font-weight:600;">Telegram — main channel</a><br>
  <a href="${escapeHtml(whatsapp)}" style="color:${COLORS.accentDark}; font-weight:600;">WhatsApp — announcements</a>
</p>

${helpLine()}`;

  return {
    subject: 'Welcome to JamHouse — Observer access',
    html: renderLayout({
      preheader: 'You\'ve been added to JamHouse as an Observer — read-only access to the barrio planning.',
      bodyHtml,
    }),
  };
}

export function tplPasswordReset({ playaName, name, actionLink }) {
  const bodyHtml = `
<p style="font-size:18px; margin:0 0 12px 0; font-weight:600;">${greet({ playaName, name })}</p>
<p style="margin:0 0 12px 0;">Click the button below to set a new password for your JamHouse account.</p>
${cta('Reset password', actionLink)}
${countdownLine()}

${sectionHeading('While you’re back, useful pages')}
<ul style="margin:0 0 8px 0; padding-left:22px;">
  <li style="margin-bottom:4px;"><a href="https://jamhouse.space/admin/profile" style="color:${COLORS.accentDark}; font-weight:600;">Your profile</a> — dietary info, password</li>
  <li style="margin-bottom:4px;"><a href="https://jamhouse.space/admin/logistics" style="color:${COLORS.accentDark}; font-weight:600;">Logistics</a> — arrival, transport, camping</li>
  <li><a href="https://jamhouse.space/admin/meals" style="color:${COLORS.accentDark}; font-weight:600;">Meals</a> — meal rota and what we're cooking</li>
</ul>

${helpLine()}

<p style="margin:24px 0 0 0; font-size:13px; color:${COLORS.inkSoft};">
  If this wasn't you, you can safely ignore this email — your password stays the same.
</p>`;
  return {
    subject: 'Reset your JamHouse password',
    html: renderLayout({
      preheader: 'Reset your JamHouse password and catch up on what\'s new.',
      bodyHtml,
    }),
  };
}

export function tplDietaryPrompt({ playaName, name, actionLink }) {
  const bodyHtml = `
<p style="font-size:18px; margin:0 0 12px 0; font-weight:600;">${greet({ playaName, name })}</p>
<p style="margin:0 0 12px 0;">We're planning the meal rota for the barrio and your dietary preferences are still missing from your profile.</p>
${countdownLine()}
<p style="margin:0 0 8px 0;">It takes about ten seconds — pick one of:</p>
<ul style="margin:0 0 16px 0; padding-left:22px; color:${COLORS.ink};">
  <li>Carnivore</li>
  <li>Pescatarian</li>
  <li>Vegetarian</li>
  <li>Vegan</li>
</ul>
<p style="margin:0 0 8px 0;">…plus a notes field for allergies and "absolutely no" items.</p>
${cta('Open my profile', actionLink)}
<p style="margin:0 0 8px 0; font-size:14px; color:${COLORS.inkSoft};">
  We can't shop smart for the kitchen without it — and the meal rota gets a lot harder to balance when people are missing. Thanks for sorting it.
</p>
${helpLine()}`;
  return {
    subject: 'Quick favour — your dietary info',
    html: renderLayout({
      preheader: 'Quick favour — we need your dietary preferences for meal planning.',
      bodyHtml,
    }),
  };
}

export function tplMagicLink({ playaName, name, actionLink }) {
  const bodyHtml = `
<p style="font-size:18px; margin:0 0 12px 0; font-weight:600;">${greet({ playaName, name })}</p>
<p style="margin:0 0 12px 0;">Click below to sign in. The link expires in 1 hour.</p>
${cta('Sign in', actionLink)}
${countdownLine()}
<p style="margin:24px 0 0 0; font-size:13px; color:${COLORS.inkSoft};">
  If you didn't request this, ignore it — your account stays safe.
</p>
${helpLine()}`;
  return {
    subject: 'Your JamHouse login link',
    html: renderLayout({
      preheader: 'Your one-time login link for JamHouse.',
      bodyHtml,
    }),
  };
}
