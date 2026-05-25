import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLabels, serializeLabels, itemHasLabel, labelSuggestions } from '../assets/js/inventory-labels.js';

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

test('labelSuggestions: matches by case-insensitive substring, excludes added', () => {
  assert.deepEqual(
    labelSuggestions('wood', ['Wood', 'Kitchen'], []),
    { matches: ['Wood'], create: 'wood' }
  );
  assert.deepEqual(
    labelSuggestions('', ['Wood', 'Kitchen'], ['Wood']),
    { matches: ['Kitchen'], create: null }
  );
});

test('labelSuggestions: offers create only for a novel, non-empty, non-added query', () => {
  assert.deepEqual(labelSuggestions('new', ['Wood'], []), { matches: [], create: 'new' });
  assert.deepEqual(labelSuggestions('Kitchen', ['Wood', 'Kitchen'], []), { matches: ['Kitchen'], create: null });
  assert.deepEqual(labelSuggestions('  Wood  ', ['Wood'], []), { matches: ['Wood'], create: null });
  assert.deepEqual(labelSuggestions('   ', ['Wood'], []), { matches: ['Wood'], create: null });
  assert.deepEqual(labelSuggestions('wood', ['Wood'], ['wood']), { matches: ['Wood'], create: null });
});
