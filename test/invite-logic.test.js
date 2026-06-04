import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldInvite, diffMissingInvites, PORTAL_STATUSES } from '../api/_lib/invite.js';

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
