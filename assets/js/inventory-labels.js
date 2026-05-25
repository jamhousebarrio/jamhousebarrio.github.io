// Pure helpers for inventory labels. No browser or node globals — safe to
// import both in the browser (admin-inventory.js, loaded as a module) and in
// Node tests (test/inventory-labels.test.js via `node --test`).
//
// Labels are stored in the sheet as a comma-separated string in the `Labels`
// column. A label value cannot contain a comma. De-duplication is exact-string
// (case-sensitive): "Wood" and "wood" are distinct labels.

export function parseLabels(value) {
  const str = Array.isArray(value) ? value.join(',') : String(value || '');
  const out = [];
  for (const part of str.split(',')) {
    const label = part.trim();
    if (label && out.indexOf(label) === -1) out.push(label);
  }
  return out;
}

export function serializeLabels(value) {
  return parseLabels(value).join(', ');
}

export function itemHasLabel(item, label) {
  return parseLabels(item && item.Labels).indexOf(label) !== -1;
}
