(async function () {
  var session = await JH.authenticate();
  if (!session) return;

  var pass = sessionStorage.getItem('jh_pass');
  var state = { items: [], filter: 'all' };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function categoryClass(cat) {
    var map = { Materials: 'cat-materials', Tools: 'cat-tools', Instruments: 'cat-instruments', Other: 'cat-other' };
    return map[cat] || 'cat-other';
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchItems() {
    var res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    if (!res.ok) { console.error('inventory fetch failed'); return; }
    var data = await res.json();
    state.items = data.items || [];
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function filteredItems() {
    if (state.filter === 'all') return state.items;
    return state.items.filter(function (item) { return item.Category === state.filter; });
  }

  function renderGrid() {
    var grid = document.getElementById('inventory-grid');
    var items = filteredItems();

    if (!items.length) {
      grid.innerHTML = '<div class="empty-state">' +
        (state.items.length ? 'No items in this category.' : 'No inventory items yet. Click "+ Add Item" to get started.') +
        '</div>';
      return;
    }

    grid.innerHTML = items.map(function (item) {
      var photoHtml = item.PhotoURL
        ? '<a href="' + esc(item.PhotoURL) + '" target="_blank"><img class="item-photo" src="' + esc(item.PhotoURL) + '" alt="' + esc(item.Name) + '" onerror="this.parentNode.outerHTML=\'<div class=\\\"item-photo-placeholder\\\">&#128230;</div>\'"></a>'
        : '<div class="item-photo-placeholder">&#128230;</div>';

      var catClass = categoryClass(item.Category);
      var catLabel = item.Category || 'Other';

      var metaHtml = '';
      if (item.Quantity) metaHtml += '<span><strong>Qty:</strong> ' + esc(item.Quantity) + '</span>';
      if (item.Location) metaHtml += '<span><strong>Loc:</strong> ' + esc(item.Location) + '</span>';

      return '<div class="item-card" data-item-id="' + esc(item.ItemID) + '">' +
        photoHtml +
        '<div class="item-body">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<p class="item-name">' + esc(item.Name) + '</p>' +
        '<span class="item-category ' + catClass + '">' + esc(catLabel) + '</span>' +
        '</div>' +
        (item.Description ? '<p class="item-desc">' + esc(item.Description) + '</p>' : '') +
        (metaHtml ? '<div class="item-meta">' + metaHtml + '</div>' : '') +
        (item.Notes ? '<p style="font-size:0.78rem;color:var(--text-muted);margin:2px 0 0;font-style:italic">' + esc(item.Notes) + '</p>' : '') +
        '</div>' +
        '<div class="item-actions">' +
        '<button class="btn-edit" data-edit="' + esc(item.ItemID) + '">Edit</button>' +
        '<button class="btn-delete" data-delete="' + esc(item.ItemID) + '">Delete</button>' +
        '</div>' +
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
        var r = await fetch('/api/inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete', itemId: item.ItemID }),
        });
        if (!r.ok) { var d = await r.json().catch(function () { return {}; }); alert(d.error || 'Delete failed.'); return; }
        await reload();
      });
    });
  }

  async function reload() {
    await fetchItems();
    renderGrid();
  }

  // ── Category filter ───────────────────────────────────────────────────────

  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderGrid();
    });
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
    document.getElementById('field-category').value = item ? item.Category : '';
    document.getElementById('field-description').value = item ? item.Description : '';
    document.getElementById('field-photo').value = item ? item.PhotoURL : '';
    document.getElementById('field-quantity').value = item ? item.Quantity : '';
    document.getElementById('field-location').value = item ? item.Location : '';
    document.getElementById('field-notes').value = item ? item.Notes : '';

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

    var r = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass,
        action: 'upsert',
        itemId: itemId,
        name: name,
        category: document.getElementById('field-category').value,
        description: document.getElementById('field-description').value,
        photoUrl: document.getElementById('field-photo').value,
        quantity: document.getElementById('field-quantity').value,
        location: document.getElementById('field-location').value,
        notes: document.getElementById('field-notes').value,
      }),
    });

    btn.textContent = 'Save Item';
    btn.disabled = false;

    if (!r.ok) { var d = await r.json().catch(function () { return {}; }); alert(d.error || 'Save failed.'); return; }
    closeModal();
    await reload();
  });

  // ── Init ──────────────────────────────────────────────────────────────────

  await fetchItems();
  renderGrid();

})();
