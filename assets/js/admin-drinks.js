(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var state = { items: [], logistics: [] };
  var activeFilter = 'all';

  function getHeadcount(dateStr) {
    return JH.getHeadcount(state.logistics, dateStr);
  }

  function getAllDates() {
    return JH.getAllDates(state.logistics);
  }

  function getPeakHeadcount() {
    var peak = 0;
    getAllDates().forEach(function (d) {
      var hc = getHeadcount(d);
      if (hc > peak) peak = hc;
    });
    return peak;
  }

  function formatNum(n) {
    return n === Math.floor(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  }

  function categoryClass(cat) {
    var c = (cat || '').toLowerCase();
    if (c === 'drinks') return 'cat-drinks';
    if (c === 'snacks') return 'cat-snacks';
    return '';
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await JH.apiFetch('/api/drinks', {});
    if (!res.ok) { console.error('drinks fetch failed'); return; }
    var data = await res.json();
    state.items = data.items || [];
    state.logistics = data.logistics || [];
  }

  // ── Headcount chart ──────────────────────────────────────────────────────

  var headcountChart = null;

  function renderHeadcountChart() {
    var dates = getAllDates();
    if (!dates.length) return;

    var labels = dates.map(function (d) { return JH.formatDateLong(d); });
    var counts = dates.map(function (d) { return getHeadcount(d); });

    var ctx = document.getElementById('headcount-chart');
    if (headcountChart) headcountChart.destroy();

    headcountChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'People',
          data: counts,
          backgroundColor: '#e8a84c88',
          borderColor: '#e8a84c',
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8a8580', maxRotation: 45, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: '#8a8580', stepSize: 1 }, grid: { color: '#2a2a2a22' }, beginAtZero: true }
        }
      }
    });
  }

  // ── Render stats ────────────────────────────────────────────────────────

  function renderStats() {
    document.getElementById('stat-items').textContent = state.items.length;
  }

  // ── Render items table ─────────────────────────────────────────────────

  function renderItems() {
    var tbody = document.getElementById('drinks-tbody');
    var dates = getAllDates();
    var peak = getPeakHeadcount();

    var filtered = activeFilter === 'all' ? state.items : state.items.filter(function (i) {
      return (i.Category || '').toLowerCase() === activeFilter.toLowerCase();
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">' +
        (state.items.length ? 'No items in this category.' : 'No items yet.' + (isAdmin ? ' Click "+ Add Item" to get started.' : '')) +
        '</td></tr>';
      return;
    }

    var sorted = filtered.slice().sort(function (a, b) {
      var ca = (a.Category || '').toLowerCase();
      var cb = (b.Category || '').toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (a.Name || '').toLowerCase() < (b.Name || '').toLowerCase() ? -1 : 1;
    });

    var html = '';
    sorted.forEach(function (item) {
      var rate = parseFloat(item.PerPersonPerDay) || 0;
      var peakDaily = peak * rate;
      var eventTotal = 0;
      dates.forEach(function (d) { eventTotal += getHeadcount(d) * rate; });

      html += '<tr>';
      html += '<td><strong>' + JH.esc(item.Name) + '</strong>';
      if (item.Notes) html += '<br><span style="font-size:0.78rem;color:var(--text-muted);font-style:italic">' + JH.esc(item.Notes) + '</span>';
      html += '</td>';
      html += '<td><span class="item-category ' + categoryClass(item.Category) + '">' + JH.esc(item.Category || 'Other') + '</span></td>';
      html += '<td>' + JH.esc(item.Unit) + '</td>';
      html += '<td class="num-col">' + formatNum(rate) + '</td>';
      html += '<td class="num-col"><strong>' + formatNum(peakDaily) + '</strong></td>';
      html += '<td class="num-col"><strong>' + formatNum(eventTotal) + '</strong></td>';
      if (isAdmin) {
        html += '<td><div style="display:flex;gap:4px">' +
          '<button class="btn-secondary btn-sm edit-item-btn" data-name="' + JH.esc(item.Name) + '">Edit</button>' +
          '<button class="btn-danger btn-sm delete-item-btn" data-name="' + JH.esc(item.Name) + '">Delete</button>' +
          '</div></td>';
      } else {
        html += '<td></td>';
      }
      html += '</tr>';
    });

    tbody.innerHTML = html;
    bindItemEvents();
  }

  function bindItemEvents() {
    if (!isAdmin) return;

    document.querySelectorAll('.edit-item-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = state.items.find(function (i) { return i.Name === btn.dataset.name; });
        if (item) openModal(item);
      });
    });

    document.querySelectorAll('.delete-item-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var item = state.items.find(function (i) { return i.Name === btn.dataset.name; });
        if (!item) return;
        if (!confirm('Delete "' + item.Name + '"? This cannot be undone.')) return;
        var r = await JH.apiFetch('/api/drinks', { action: 'delete', name: item.Name });
        if (!r.ok) { alert('Delete failed.'); return; }
        await reload();
      });
    });
  }

  // ── Filter buttons ────────────────────────────────────────────────────

  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderItems();
    });
  });

  // ── Modal ─────────────────────────────────────────────────────────────────

  var modal = document.getElementById('drink-modal');
  var editingName = null;

  function openModal(item) {
    editingName = item ? item.Name : null;
    document.getElementById('drink-modal-title').innerHTML = (item ? 'Edit Item' : 'Add Item') +
      ' <button class="modal-close" data-close="drink-modal">&times;</button>';
    bindCloseButtons();

    document.getElementById('drink-name').value = item ? item.Name : '';
    document.getElementById('drink-category').value = item ? item.Category : '';
    document.getElementById('drink-unit').value = item ? item.Unit : '';
    document.getElementById('drink-per-person').value = item ? item.PerPersonPerDay : '';
    document.getElementById('drink-notes').value = item ? item.Notes : '';

    modal.classList.add('active');
    document.getElementById('drink-name').focus();
  }

  function closeModal() {
    modal.classList.remove('active');
    editingName = null;
  }

  function bindCloseButtons() {
    document.querySelectorAll('[data-close="drink-modal"]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(); });
    });
  }
  bindCloseButtons();

  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  document.getElementById('add-item-btn').addEventListener('click', function () {
    openModal(null);
  });

  document.getElementById('drink-save-btn').addEventListener('click', async function () {
    var name = document.getElementById('drink-name').value.trim();
    if (!name) { alert('Name is required.'); return; }

    var btn = this;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    var r = await JH.apiFetch('/api/drinks', {
      action: 'upsert',
      name: name,
      category: document.getElementById('drink-category').value,
      unit: document.getElementById('drink-unit').value,
      perPersonPerDay: document.getElementById('drink-per-person').value,
      notes: document.getElementById('drink-notes').value,
    });

    btn.textContent = 'Save Item';
    btn.disabled = false;

    if (!r.ok) { var d = await r.json().catch(function () { return {}; }); alert(d.error || 'Save failed.'); return; }
    closeModal();
    await reload();
  });

  // ── Reload ─────────────────────────────────────────────────────────────────

  async function reload() {
    await fetchData();
    renderStats();
    renderHeadcountChart();
    renderItems();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  if (isAdmin) document.getElementById('add-item-btn').style.display = '';

  await reload();

})();
