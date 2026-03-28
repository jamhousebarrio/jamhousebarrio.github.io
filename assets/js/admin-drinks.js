(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');
  var state = { items: [], logistics: [] };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getHeadcount(dateStr) {
    return state.logistics.filter(function (l) {
      if (!l.ArrivalDate || !l.DepartureDate) return false;
      return l.ArrivalDate <= dateStr && l.DepartureDate >= dateStr;
    }).length;
  }

  function getAllDates() {
    var dateSet = {};
    state.logistics.forEach(function (l) {
      if (!l.ArrivalDate || !l.DepartureDate) return;
      var d = new Date(l.ArrivalDate + 'T00:00:00');
      var end = new Date(l.DepartureDate + 'T00:00:00');
      while (d <= end) {
        var ds = d.toISOString().slice(0, 10);
        dateSet[ds] = true;
        d.setDate(d.getDate() + 1);
      }
    });
    return Object.keys(dateSet).sort();
  }

  function getTotalEventDays() {
    return getAllDates().length;
  }

  function getPeakHeadcount() {
    var dates = getAllDates();
    var peak = 0;
    dates.forEach(function (d) {
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
    return 'cat-other';
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await fetch('/api/drinks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
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

    var labels = dates.map(function (d) {
      var parts = d.split('-');
      var dt = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      return dt.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    });
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
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterBody: function (items) {
                var idx = items[0].dataIndex;
                var count = counts[idx];
                return [count + ' people on site'];
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#8a8580', maxRotation: 45, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: '#8a8580', stepSize: 1 }, grid: { color: '#2a2a2a22' }, beginAtZero: true, title: { display: true, text: 'People', color: '#8a8580', font: { size: 11 } } }
        }
      }
    });
  }

  // ── Render stats ────────────────────────────────────────────────────────

  function renderStats() {
    var totalItems = state.items.length;
    var peak = getPeakHeadcount();

    var statsEl = document.getElementById('stats-cards');
    statsEl.innerHTML =
      '<div class="stat-card"><div class="stat-value">' + totalItems + '</div><div class="stat-label">Items Tracked</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + peak + '</div><div class="stat-label">Peak Daily Headcount</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + getTotalEventDays() + '</div><div class="stat-label">Event Days</div></div>';
  }

  // ── Render items table ─────────────────────────────────────────────────

  function renderItems() {
    var wrap = document.getElementById('items-wrap');
    var dates = getAllDates();
    var peak = getPeakHeadcount();

    if (!state.items.length) {
      wrap.innerHTML = '<div class="empty-state">No drinks or snacks tracked yet.' +
        (isAdmin ? ' Use "+ Add Item" to get started.' : ' Check back later.') + '</div>';
      return;
    }

    // Sort by category then name
    var sorted = state.items.slice().sort(function (a, b) {
      var ca = (a.Category || '').toLowerCase();
      var cb = (b.Category || '').toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (a.Name || '').toLowerCase() < (b.Name || '').toLowerCase() ? -1 : 1;
    });

    var html = '<div style="overflow-x:auto"><table class="items-table"><thead><tr>';
    html += '<th>Name</th><th>Category</th><th>Unit</th><th>Per person/day</th><th>Peak daily need</th><th>Event total</th>';
    if (isAdmin) html += '<th></th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function (item) {
      var rate = parseFloat(item.PerPersonPerDay) || 0;
      var peakDaily = peak * rate;
      var eventTotal = 0;
      dates.forEach(function (d) {
        eventTotal += getHeadcount(d) * rate;
      });

      var catClass = categoryClass(item.Category);

      html += '<tr>';
      html += '<td><strong>' + esc(item.Name) + '</strong>';
      if (item.Notes) html += '<br><span style="font-size:0.78rem;color:var(--text-muted);font-style:italic">' + esc(item.Notes) + '</span>';
      html += '</td>';
      html += '<td><span class="item-category ' + catClass + '">' + esc(item.Category || 'Other') + '</span></td>';
      html += '<td>' + esc(item.Unit) + '</td>';
      html += '<td>' + esc(formatNum(rate)) + '</td>';
      html += '<td><strong>' + formatNum(peakDaily) + '</strong></td>';
      html += '<td><strong>' + formatNum(eventTotal) + '</strong></td>';
      if (isAdmin) {
        html += '<td><div class="item-actions-inline">' +
          '<button class="btn-secondary btn-sm edit-item-btn" data-name="' + esc(item.Name) + '">Edit</button>' +
          '<button class="btn-danger btn-sm delete-item-btn" data-name="' + esc(item.Name) + '">Delete</button>' +
          '</div></td>';
      }
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;

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
        var r = await fetch('/api/drinks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete', name: item.Name }),
        });
        if (!r.ok) { alert('Delete failed. Please try again.'); return; }
        await reload();
      });
    });
  }

  // ── Copy shopping list ──────────────────────────────────────────────────

  document.getElementById('copy-shopping-list').addEventListener('click', function () {
    var dates = getAllDates();
    var lines = [];

    var sorted = state.items.slice().sort(function (a, b) {
      var ca = (a.Category || '').toLowerCase();
      var cb = (b.Category || '').toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (a.Name || '').toLowerCase() < (b.Name || '').toLowerCase() ? -1 : 1;
    });

    var currentCat = '';
    sorted.forEach(function (item) {
      var rate = parseFloat(item.PerPersonPerDay) || 0;
      var eventTotal = 0;
      dates.forEach(function (d) {
        eventTotal += getHeadcount(d) * rate;
      });

      var cat = item.Category || 'Other';
      if (cat !== currentCat) {
        if (lines.length) lines.push('');
        lines.push('--- ' + cat + ' ---');
        currentCat = cat;
      }

      lines.push(formatNum(eventTotal) + ' ' + (item.Unit || '') + ' ' + item.Name);
    });

    if (!lines.length) return;

    var text = 'Drinks & Snacks Shopping List\n' + '='.repeat(30) + '\n' + lines.join('\n');
    navigator.clipboard.writeText(text).then(function () {
      var btn = document.getElementById('copy-shopping-list');
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = 'Copy shopping list'; }, 2000);
    });
  });

  // ── Modal ─────────────────────────────────────────────────────────────────

  var modal = document.getElementById('item-modal');
  var editingName = null;

  function openModal(item) {
    editingName = item ? item.Name : null;
    document.getElementById('modal-title').innerHTML = (item ? 'Edit Item' : 'Add Item') +
      ' <button class="modal-close" id="modal-close-x">&times;</button>';
    document.getElementById('modal-close-x').addEventListener('click', closeModal);

    document.getElementById('field-name').value = item ? item.Name : '';
    document.getElementById('field-category').value = item ? item.Category : 'Drinks';
    document.getElementById('field-unit').value = item ? item.Unit : '';
    document.getElementById('field-rate').value = item ? item.PerPersonPerDay : '';
    document.getElementById('field-notes').value = item ? item.Notes : '';

    modal.classList.add('active');
    document.getElementById('field-name').focus();
  }

  function closeModal() {
    modal.classList.remove('active');
    editingName = null;
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
    if (!name) { alert('Name is required.'); return; }

    var btn = this;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    var r = await fetch('/api/drinks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass,
        action: 'upsert',
        name: name,
        originalName: editingName,
        category: document.getElementById('field-category').value,
        unit: document.getElementById('field-unit').value,
        perPersonPerDay: document.getElementById('field-rate').value,
        notes: document.getElementById('field-notes').value,
      }),
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
