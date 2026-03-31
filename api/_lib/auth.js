import jwt from 'jsonwebtoken';
import { createPublicKey } from 'crypto';
import { getSheets, safeGet } from './sheets.js';

// Build PEM public key from JWK for ES256 verification
const jwk = JSON.parse(process.env.SUPABASE_JWT_PUBLIC_KEY || '{}');
const publicKey = jwk.kty ? createPublicKey({ key: jwk, format: 'jwk' }) : null;

/**
 * Verify Supabase JWT from Authorization header.
 * Returns { email, sub } or throws.
 */
export function verifyToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    const err = new Error('Missing authorization token');
    err.status = 401;
    throw err;
  }
  if (!publicKey) {
    const err = new Error('JWT public key not configured');
    err.status = 500;
    throw err;
  }
  try {
    const payload = jwt.verify(token, publicKey, { algorithms: ['ES256'] });
    if (!payload.email) {
      const err = new Error('Token missing email claim');
      err.status = 401;
      throw err;
    }
    return { email: payload.email, sub: payload.sub };
  } catch (e) {
    const err = new Error('Invalid or expired token');
    err.status = 401;
    throw err;
  }
}

/**
 * Look up a member by email in Sheet1. Returns { member, row, headers } or null.
 * Rejects non-Approved members.
 */
export async function getMemberByEmail(sheets, spreadsheetId, email) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
  const rows = res.data.values;
  if (!rows || rows.length < 2) return null;
  const headers = rows[0];
  const emailCol = headers.indexOf('Email');
  const statusCol = headers.indexOf('Status');
  if (emailCol === -1) return null;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][emailCol] || '').toLowerCase().trim() === email.toLowerCase().trim()) {
      const member = {};
      headers.forEach((h, j) => { member[h] = rows[i][j] || ''; });
      const status = (member.Status || '').toLowerCase();
      if (status !== 'approved') return null;
      return { member, row: i + 1, headers };
    }
  }
  return null;
}

/**
 * Check if a member has admin privileges.
 */
export function isAdmin(member) {
  return (member.Admin || '').toLowerCase() === 'yes';
}

/**
 * Authenticate a request: verify JWT, look up member, return auth context.
 * Throws with .status on failure.
 */
export async function authenticateRequest(req) {
  const user = verifyToken(req);
  const sheets = getSheets(true);
  const spreadsheetId = process.env.SHEET_ID;
  const result = await getMemberByEmail(sheets, spreadsheetId, user.email);
  if (!result) {
    const err = new Error('Member not found or not approved');
    err.status = 403;
    throw err;
  }
  return {
    email: user.email,
    sub: user.sub,
    member: result.member,
    row: result.row,
    headers: result.headers,
    admin: isAdmin(result.member),
    sheets,
    spreadsheetId,
  };
}
