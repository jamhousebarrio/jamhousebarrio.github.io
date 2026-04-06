(async function () {
  var session = await JH.authenticate();
  if (!session) return;

  var isAdmin = JH.isAdmin();
  var state = { items: [], filter: 'all' };

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
      var photoSrc = item.PhotoURL || '';
      // Convert Google Drive links to direct thumbnail URLs
      var driveMatch = photoSrc.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([a-zA-Z0-9_-]+)/);
      if (driveMatch) {
        photoSrc = 'https://drive.google.com/thumbnail?id=' + driveMatch[1] + '&sz=w400';
      }
      var photoHtml = photoSrc
        ? '<a href="' + JH.esc(item.PhotoURL) + '" target="_blank"><img class="item-photo" src="' + JH.esc(photoSrc) + '" alt="' + JH.esc(item.Name) + '" onerror="this.parentNode.outerHTML=\'<div class=\\\"item-photo-placeholder\\\">&#128230;</div>\'"></a>'
        : '<div class="item-photo-placeholder">&#128230;</div>';

      var catLabel = item.Category || 'Other';
      var cc = catColor(catLabel);

      var metaHtml = '';
      if (item.Quantity) metaHtml += '<span><strong>Qty:</strong> ' + JH.esc(item.Quantity) + '</span>';
      if (item.Location) metaHtml += '<span><strong>Loc:</strong> ' + JH.esc(item.Location) + '</span>';

      return '<div class="item-card" data-item-id="' + JH.esc(item.ItemID) + '">' +
        photoHtml +
        '<div class="item-body">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<p class="item-name">' + JH.esc(item.Name) + '</p>' +
        '<span class="item-category" style="background:' + cc + '20;color:' + cc + ';border-color:' + cc + '">' + JH.esc(catLabel) + '</span>' +
        '</div>' +
        (item.Description ? '<p class="item-desc">' + JH.esc(item.Description) + '</p>' : '') +
        (metaHtml ? '<div class="item-meta">' + metaHtml + '</div>' : '') +
        (item.Notes ? '<p style="font-size:0.78rem;color:var(--text-muted);margin:2px 0 0;font-style:italic">' + JH.esc(item.Notes) + '</p>' : '') +
        '</div>' +
        (isAdmin ? '<div class="item-actions">' +
        '<button class="btn-edit" data-edit="' + JH.esc(item.ItemID) + '">Edit</button>' +
        '<button class="btn-delete" data-delete="' + JH.esc(item.ItemID) + '">Delete</button>' +
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
    renderGrid();
  }

  // ── Category filter ───────────────────────────────────────────────────────

  function buildFilterButtons() {
    var container = document.getElementById('filter-btns');
    container.innerHTML = '<button class="filter-btn active" data-filter="all">All</button>';
    var cats = [];
    state.items.forEach(function (item) {
      var c = item.Category || 'Other';
      if (cats.indexOf(c) === -1) cats.push(c);
    });
    cats.sort();
    cats.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.dataset.filter = cat;
      btn.textContent = cat;
      container.appendChild(btn);
    });
    container.querySelectorAll('.filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.filter = btn.dataset.filter;
        renderGrid();
      });
    });
  }

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

    var r = await JH.apiFetch('/api/inventory', {
      action: 'upsert',
      itemId: itemId,
      name: name,
      category: document.getElementById('field-category').value,
      description: document.getElementById('field-description').value,
      photoUrl: document.getElementById('field-photo').value,
      quantity: document.getElementById('field-quantity').value,
      location: document.getElementById('field-location').value,
      notes: document.getElementById('field-notes').value,
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
  renderGrid();

})();
