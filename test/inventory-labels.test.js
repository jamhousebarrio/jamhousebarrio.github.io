import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLabels, serializeLabels, itemHasLabel } from '../assets/js/inventory-labels.js';

test('parseLabels splits, trims, drops empties, dedupes', () => {
  assert.deepEqual(parseLabels('wood, kitchen'), ['wood', 'kitchen']);
  assert.deepEqual(parseLabels('  wood ,, kitchen ,wood '), ['wood', 'kitchen']);
  assert.deepEqual(parseLabels(''), []);
  assert.deepEqual(parseLabels(undefined), []);
  assert.deepEqual(parseLabels(['a', 'b']), ['a', 'b']);
});

test('serializeLabels joins normalized labels with ", "', () => {
  assert.equal(serializeLabels(['wood', 'kitchen']), 'wood, kitchen');
  assert.equal(serializeLabels('wood,kitchen'), 'wood, kitchen');
  assert.equal(serializeLabels([]), '');
});

test('itemHasLabel checks membership against the Labels field', () => {
  assert.equal(itemHasLabel({ Labels: 'wood, kitchen' }, 'kitchen'), true);
  assert.equal(itemHasLabel({ Labels: 'wood' }, 'kitchen'), false);
  assert.equal(itemHasLabel({}, 'x'), false);
});
