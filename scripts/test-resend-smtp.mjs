// One-shot diagnostic: speak raw SMTP to Resend with the same creds we'd
// paste into Supabase Auth → SMTP Settings. Prints the full conversation so
// we can see exactly where (or if) the exchange breaks.
//
// Usage:
//   RESEND_API_KEY=re_xxx \
//   RESEND_FROM='noreply@jamhouse.space' \
//   RESEND_TO='fanteevi@gmail.com' \
//   node scripts/test-resend-smtp.mjs
//
// Optional overrides: RESEND_HOST (default smtp.resend.com),
// RESEND_PORT (default 587), RESEND_USER (default 'resend').

import net from 'node:net';
import tls from 'node:tls';

const HOST = process.env.RESEND_HOST || 'smtp.resend.com';
const PORT = Number(process.env.RESEND_PORT || 587);
const USER = process.env.RESEND_USER || 'resend';
const PASS = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM;
const TO   = process.env.RESEND_TO;

if (!PASS || !FROM || !TO) {
  console.error('Missing env. Required: RESEND_API_KEY, RESEND_FROM, RESEND_TO');
  process.exit(2);
}

function wire(socket) {
  let buf = '';
  const queue = [];
  let waiter = null;
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buf += chunk;
    // SMTP multi-line responses: "250-foo\r\n250 bar\r\n" — last line has a space.
    while (true) {
      const m = buf.match(/^([0-9]{3})([ -])([^\r\n]*)\r?\n/);
      if (!m) break;
      process.stdout.write('S: ' + m[0]);
      queue.push({ code: m[1], last: m[2] === ' ', text: m[3] });
      buf = buf.slice(m[0].length);
      if (queue.some(l => l.last) && waiter) { const w = waiter; waiter = null; w(); }
    }
  });
  return {
    async read(expectCode) {
      while (!queue.some(l => l.last)) {
        await new Promise(r => { waiter = r; });
      }
      const idx = queue.findIndex(l => l.last);
      const resp = queue.splice(0, idx + 1);
      if (expectCode && !resp.every(l => l.code === expectCode)) {
        const got = resp.map(l => `${l.code} ${l.text}`).join(' | ');
        throw new Error(`expected ${expectCode}, got: ${got}`);
      }
      return resp;
    },
    write(line) {
      const safe = line.startsWith('AUTH ') || /^[A-Za-z0-9+/=]+$/.test(line.trim())
        ? '(redacted)'
        : line;
      process.stdout.write('C: ' + safe + '\r\n');
      socket.write(line + '\r\n');
    },
    raw(bytes) {
      process.stdout.write('C: <message body, ' + bytes.length + ' bytes>\r\n');
      socket.write(bytes);
    },
  };
}

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.once('connect', () => resolve(s));
    s.once('error', reject);
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket, servername: host });
    t.once('secureConnect', () => resolve(t));
    t.once('error', reject);
  });
}

async function main() {
  console.log(`Connecting to ${HOST}:${PORT} ...`);
  const tcp = await connect(HOST, PORT);
  console.log(`TCP open. remoteAddress=${tcp.remoteAddress}`);

  let s = wire(tcp);
  await s.read('220');                     // server greeting
  s.write('EHLO jamhouse.space');
  await s.read('250');
  s.write('STARTTLS');
  await s.read('220');

  // Stop the plaintext reader before upgrading the socket.
  tcp.removeAllListeners('data');
  const tlsSock = await upgradeToTls(tcp, HOST);
  console.log(`TLS up. protocol=${tlsSock.getProtocol()} cipher=${tlsSock.getCipher()?.name}`);
  s = wire(tlsSock);

  s.write('EHLO jamhouse.space');
  await s.read('250');

  s.write('AUTH LOGIN');
  await s.read('334');
  s.write(Buffer.from(USER).toString('base64'));
  await s.read('334');
  s.write(Buffer.from(PASS).toString('base64'));
  await s.read('235');                     // auth accepted
  console.log('AUTH succeeded.');

  s.write(`MAIL FROM:<${FROM}>`);
  await s.read('250');
  s.write(`RCPT TO:<${TO}>`);
  await s.read('250');
  s.write('DATA');
  await s.read('354');

  const stamp = new Date();
  const body = [
    `From: ${FROM}`,
    `To: ${TO}`,
    `Subject: Resend SMTP diagnostic ${stamp.toISOString()}`,
    `Date: ${stamp.toUTCString()}`,
    `Message-ID: <${Date.now()}.${process.pid}@jamhouse.space>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Diagnostic from scripts/test-resend-smtp.mjs.',
    'If you received this, Resend SMTP with these credentials works end-to-end.',
    '',
    '.',
    '',
  ].join('\r\n');
  s.raw(body);
  await s.read('250');                     // queued
  console.log('Resend accepted the message for delivery.');

  s.write('QUIT');
  try { await s.read('221'); } catch {}
  tlsSock.end();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
