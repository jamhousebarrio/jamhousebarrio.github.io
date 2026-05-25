import { parseLabels, itemHasLabel } from './inventory-labels.js';

(async function () {
  var session = await JH.authenticate();
  if (!session) return;

  var isAdmin = JH.isAdmin();
  var state = { items: [], filter: 'all', search: '' };

  // ── Helpers ───────────────────────────────────────────────────────────────

  var CAT_COLORS = ['#4caf50','#42a5f5','#e8a84c','#ce93d8','#26a69a','#ef5350','#78909c','#ffb74d','#29b6f6','#ab47bc','#8d6e63','#66bb6a'];
  var catColorMap = {};
  var catColorIdx = 0;
  function catColor(cat) {
    if (!cat) cat = 'Other';
    if (!catColorMap[cat]) catColorMap[cat] = CAT_COLORS[catColorIdx++ % CAT_COLORS.length];
    return catColorMap[cat];
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchItems() {
    var res = await JH.apiFetch('/api/inventory', {});
    if (!res.ok) { console.error('inventory fetch failed'); return; }
    var data = await res.json();
    state.items = data.items || [];
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function filteredItems() {
    var items = state.items;
    if (state.filter !== 'all') {
      items = items.filter(function (item) { return itemHasLabel(item, state.filter); });
    }
    if (state.search) {
      var q = state.search.toLowerCase();
      items = items.filter(function (item) {
        return (item.Name || '').toLowerCase().indexOf(q) !== -1 ||
               (item.Labels || '').toLowerCase().indexOf(q) !== -1 ||
               (item.Description || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    return items;
  }

  function renderList() {
    var container = document.getElementById('inventory-list');
    var items = filteredItems();
    document.getElementById('item-count').textContent = items.length + ' item' + (items.length !== 1 ? 's' : '');

    if (!items.length) {
      container.innerHTML = '<div class="empty-state">' +
        (state.items.length ? 'No items match.' : 'No inventory items yet. Click "+ Add Item" to get started.') +
        '</div>';
      return;
    }

    container.innerHTML = items.map(function (item) {
      var labels = parseLabels(item.Labels);
      var badges = labels.map(function (l) {
        var cc = catColor(l);
        return '<span class="item-label" style="background:' + cc + '20;color:' + cc + ';border-color:' + cc + '">' + JH.esc(l) + '</span>';
      }).join('');
      return '<div class="item-row" data-item-id="' + JH.esc(item.ItemID) + '">' +
        '<p class="item-name">' + JH.esc(item.Name) + '</p>' +
        '<span class="item-labels">' + badges + '</span>' +
        (item.Quantity ? '<span class="item-qty">' + JH.esc(item.Quantity) + '</span>' : '') +
        '<span class="item-desc">' + JH.esc(item.Description || '') + '</span>' +
        (isAdmin ? '<div class="item-actions">' +
        '<button class="btn-edit" data-edit="' + JH.esc(item.ItemID) + '">Edit</button>' +
        '<button class="btn-delete" data-delete="' + JH.esc(item.ItemID) + '">Del</button>' +
        '</div>' : '') +
        '</div>';
    }).join('');

    bindCardEvents();
  }

  function bindCardEvents() {
    document.querySelectorAll('.btn-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = state.items.find(function (i) { return i.ItemID === btn.dataset.edit; });
        if (item) openModal(item);
      });
    });

    document.querySelectorAll('.btn-delete').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var item = state.items.find(function (i) { return i.ItemID === btn.dataset.delete; });
        if (!item) return;
        if (!confirm('Delete "' + item.Name + '"? This cannot be undone.')) return;
        var r = await JH.apiFetch('/api/inventory', { action: 'delete', itemId: item.ItemID });
        if (!r.ok) { var d = await r.json().catch(function () { return {}; }); alert(d.error || 'Delete failed.'); return; }
        await reload();
      });
    });
  }

  async function reload() {
    await fetchItems();
    buildFilterButtons();
    renderList();
  }

  // ── Search ──────────────────────────────────────────────────────────────

  document.getElementById('search-box').addEventListener('input', function () {
    state.search = this.value.trim();
    renderList();
  });

  // ── Category filter ───────────────────────────────────────────────────────

  function buildFilterButtons() {
    var container = document.getElementById('filter-btns');
    container.innerHTML = '<button class="filter-btn active" data-filter="all">All</button>';
    var cats = [];
    state.items.forEach(function (item) {
      parseLabels(item.Labels).forEach(function (l) {
        if (cats.indexOf(l) === -1) cats.push(l);
      });
    });
    cats.sort();
    cats.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.className = 'filter-btn';
      if (cat === state.filter) btn.classList.add('active');
      btn.dataset.filter = cat;
      btn.textContent = cat;
      container.appendChild(btn);
    });
    if (state.filter !== 'all') {
      container.querySelector('[data-filter="all"]').classList.remove('active');
    }
    container.querySelectorAll('.filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.filter = btn.dataset.filter;
        renderList();
      });
    });
  }

  // ── Labels chip input ───────────────────────────────────────────────────
  var currentLabels = [];
  var activeSuggestion = -1;
  var chipsEl = document.getElementById('labels-chips');
  var labelText = document.getElementById('field-labels-text');
  var suggestionsEl = document.getElementById('labels-suggestions');

  function allKnownLabels() {
    var set = [];
    state.items.forEach(function (item) {
      parseLabels(item.Labels).forEach(function (l) { if (set.indexOf(l) === -1) set.push(l); });
    });
    return set.sort();
  }

  function renderChips() {
    chipsEl.innerHTML = currentLabels.map(function (l) {
      return '<span class="chip">' + JH.esc(l) +
        '<button type="button" data-remove="' + JH.esc(l) + '" aria-label="Remove">&times;</button></span>';
    }).join('');
    chipsEl.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () { removeLabel(btn.dataset.remove); });
    });
  }

  function addLabel(raw) {
    var label = (raw || '').trim();
    if (label && currentLabels.indexOf(label) === -1) currentLabels.push(label);
    labelText.value = '';
    renderChips();
    hideSuggestions();
  }

  function removeLabel(label) {
    currentLabels = currentLabels.filter(function (l) { return l !== label; });
    renderChips();
  }

  function hideSuggestions() {
    suggestionsEl.classList.remove('open');
    suggestionsEl.innerHTML = '';
    activeSuggestion = -1;
  }

  function showSuggestions() {
    var q = labelText.value.trim().toLowerCase();
    var matches = allKnownLabels().filter(function (l) {
      return currentLabels.indexOf(l) === -1 && (!q || l.toLowerCase().indexOf(q) !== -1);
    });
    if (!matches.length) { hideSuggestions(); return; }
    activeSuggestion = -1;
    suggestionsEl.innerHTML = matches.map(function (l, i) {
      return '<div class="chip-suggestion" data-idx="' + i + '" data-label="' + JH.esc(l) + '">' + JH.esc(l) + '</div>';
    }).join('');
    suggestionsEl.querySelectorAll('.chip-suggestion').forEach(function (el) {
      el.addEventListener('mousedown', function (e) { e.preventDefault(); addLabel(el.dataset.label); });
    });
    suggestionsEl.classList.add('open');
  }

  labelText.addEventListener('input', showSuggestions);
  labelText.addEventListener('focus', showSuggestions);
  labelText.addEventListener('blur', function () { setTimeout(hideSuggestions, 120); });
  labelText.addEventListener('keydown', function (e) {
    var opts = suggestionsEl.querySelectorAll('.chip-suggestion');
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (activeSuggestion >= 0 && opts[activeSuggestion]) addLabel(opts[activeSuggestion].dataset.label);
      else addLabel(labelText.value);
    } else if (e.key === 'Backspace' && !labelText.value && currentLabels.length) {
      removeLabel(currentLabels[currentLabels.length - 1]);
    } else if (e.key === 'ArrowDown' && opts.length) {
      e.preventDefault();
      activeSuggestion = Math.min(activeSuggestion + 1, opts.length - 1);
      opts.forEach(function (o, i) { o.classList.toggle('active', i === activeSuggestion); });
    } else if (e.key === 'ArrowUp' && opts.length) {
      e.preventDefault();
      activeSuggestion = Math.max(activeSuggestion - 1, 0);
      opts.forEach(function (o, i) { o.classList.toggle('active', i === activeSuggestion); });
    }
  });

  // ── Modal ─────────────────────────────────────────────────────────────────

  var modal = document.getElementById('item-modal');
  var editingId = null;

  function openModal(item) {
    editingId = item ? item.ItemID : null;
    document.getElementById('modal-title').innerHTML = (item ? 'Edit Item' : 'Add Item') +
      ' <button class="modal-close" id="modal-close">&times;</button>';
    document.getElementById('modal-close').addEventListener('click', closeModal);

    document.getElementById('field-name').value = item ? item.Name : '';
    currentLabels = item ? parseLabels(item.Labels) : [];
    labelText.value = '';
    hideSuggestions();
    renderChips();
    document.getElementById('field-description').value = item ? item.Description : '';
    document.getElementById('field-photo').value = item ? item.PhotoURL : '';
    document.getElementById('field-quantity').value = item ? item.Quantity : '';
    document.getElementById('field-location').value = item ? item.Location : '';

    modal.classList.add('active');
    document.getElementById('field-name').focus();
  }

  function closeModal() {
    modal.classList.remove('active');
    editingId = null;
  }

  document.getElementById('add-item-btn').addEventListener('click', function () {
    openModal(null);
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);

  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  document.getElementById('modal-save-btn').addEventListener('click', async function () {
    var name = document.getElementById('field-name').value.trim();
    var itemId = editingId || name;

    if (!name) { alert('Name is required.'); return; }

    var btn = this;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    if (labelText.value.trim()) addLabel(labelText.value);

    var r = await JH.apiFetch('/api/inventory', {
      action: 'upsert',
      itemId: itemId,
      name: name,
      labels: currentLabels,
      description: document.getElementById('field-description').value,
      photoUrl: document.getElementById('field-photo').value,
      quantity: document.getElementById('field-quantity').value,
      location: document.getElementById('field-location').value,
    });

    btn.textContent = 'Save Item';
    btn.disabled = false;

    if (!r.ok) { var d = await r.json().catch(function () { return {}; }); alert(d.error || 'Save failed.'); return; }
    closeModal();
    await reload();
  });

  // ── Init ──────────────────────────────────────────────────────────────────

  if (isAdmin) document.getElementById('add-item-btn').style.display = '';

  await fetchItems();
  buildFilterButtons();
  renderList();

})();
