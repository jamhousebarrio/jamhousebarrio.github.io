import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldInvite, diffMissingInvites, PORTAL_STATUSES, assertPortalEligible } from '../api/_lib/invite.js';

// Fake Google Sheets client: getMemberByEmail reads range 'Sheet1' and expects
// rows[0] to be headers. We hand it Name/Email/Status columns.
function fakeSheets(rows) {
  const headers = ['Name', 'Email', 'Status'];
  const values = [headers, ...rows.map(r => [r.Name || '', r.Email || '', r.Status || ''])];
  return { spreadsheets: { values: { get: async () => ({ data: { values } }) } } };
}

const ELIGIBILITY_ROSTER = [
  { Name: 'Ann', Email: 'ann@x.com', Status: 'Approved' },
  { Name: 'Obs', Email: 'obs@x.com', Status: 'Observer' },
  { Name: 'Vic', Email: 'vic@x.com', Status: 'Vibe Check' },
  { Name: 'Pat', Email: 'pat@x.com', Status: 'Pending' },
];
const SHEET = 'sheet-id';

test('assertPortalEligible passes for Approved and returns the member', async () => {
  const m = await assertPortalEligible(fakeSheets(ELIGIBILITY_ROSTER), SHEET, 'ann@x.com');
  assert.equal(m.Status, 'Approved');
});

test('assertPortalEligible passes for Observer', async () => {
  const m = await assertPortalEligible(fakeSheets(ELIGIBILITY_ROSTER), SHEET, 'obs@x.com');
  assert.equal(m.Status, 'Observer');
});

test('assertPortalEligible blocks a non-portal status with 403 (and names the status)', async () => {
  await assert.rejects(
    () => assertPortalEligible(fakeSheets(ELIGIBILITY_ROSTER), SHEET, 'vic@x.com'),
    (e) => e.status === 403 && /Vibe Check/.test(e.message),
  );
  await assert.rejects(
    () => assertPortalEligible(fakeSheets(ELIGIBILITY_ROSTER), SHEET, 'pat@x.com'),
    (e) => e.status === 403,
  );
});

test('assertPortalEligible returns 404 for an unknown email', async () => {
  await assert.rejects(
    () => assertPortalEligible(fakeSheets(ELIGIBILITY_ROSTER), SHEET, 'nobody@x.com'),
    (e) => e.status === 404,
  );
});

test('assertPortalEligible matches email case-insensitively', async () => {
  const m = await assertPortalEligible(fakeSheets(ELIGIBILITY_ROSTER), SHEET, 'ANN@X.com');
  assert.equal(m.Status, 'Approved');
});

test('shouldInvite fires on any → Approved', () => {
  assert.equal(shouldInvite('Pending', 'Approved'), true);
  assert.equal(shouldInvite('On-boarding', 'Approved'), true);
  assert.equal(shouldInvite('', 'Approved'), true);
});

test('shouldInvite fires on non-portal → Observer', () => {
  assert.equal(shouldInvite('Pending', 'Observer'), true);
  assert.equal(shouldInvite('Rejected', 'Observer'), true);
});

test('shouldInvite does NOT fire when already in portal access', () => {
  assert.equal(shouldInvite('Approved', 'Approved'), false);
  // Approved → Observer is a demotion, not a new grant
  assert.equal(shouldInvite('Approved', 'Observer'), false);
  assert.equal(shouldInvite('Observer', 'Observer'), false);
});

test('shouldInvite does NOT fire on demotions / non-portal targets', () => {
  assert.equal(shouldInvite('Approved', 'Rejected'), false);
  assert.equal(shouldInvite('Pending', 'Review'), false);
});

test('shouldInvite is case/whitespace insensitive', () => {
  assert.equal(shouldInvite(' pending ', 'approved'), true);
  assert.equal(shouldInvite('APPROVED', 'approved'), false);
});

test('diffMissingInvites returns roster members with no Supabase user (case-insensitive)', () => {
  const roster = [
    { email: 'A@x.com', status: 'Approved' },
    { email: 'b@x.com', status: 'Observer' },
    { email: 'c@x.com', status: 'Approved' },
  ];
  const existing = new Set(['a@x.com', 'c@x.com']);
  const missing = diffMissingInvites(roster, existing);
  assert.deepEqual(missing.map(m => m.email), ['b@x.com']);
});

test('diffMissingInvites skips rows with blank email', () => {
  const roster = [{ email: '', status: 'Approved' }, { email: '  ', status: 'Approved' }];
  assert.deepEqual(diffMissingInvites(roster, new Set()), []);
});

test('PORTAL_STATUSES contains approved and observer', () => {
  assert.ok(PORTAL_STATUSES.has('approved'));
  assert.ok(PORTAL_STATUSES.has('observer'));
});
