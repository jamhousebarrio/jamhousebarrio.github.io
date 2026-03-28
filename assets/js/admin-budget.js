(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var esc = JH.esc;
  var pass = sessionStorage.getItem('jh_pass');

  // Fetch budget items
  var res = await fetch('/api/budget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pass, action: 'fetch-items' })
  });
  if (!res.ok) return;
  var data = await res.json();
  var items = data.items || [];
  var fees = data.fees || { expected: 0, paid: 0 };

  if (data.sheetUrl) {
    var subtitle = document.querySelector('.subtitle');
    if (subtitle) subtitle.innerHTML = 'Budget tracking by category &nbsp;·&nbsp; <a href="' + data.sheetUrl + '" target="_blank" rel="noopener" style="color:var(--accent);font-size:0.85rem;">Open spreadsheet ↗</a>';
  }

  function eur(n) { return '\u20AC' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // Calculate stats
  function calcStats() {
    var budgeted = 0, spent = 0;
    items.forEach(function(item) {
      var total = (parseFloat(item.Qty) || 0) * (parseFloat(item.Price) || 0);
      budgeted += total;
      var paid = item.Paid === true || item.Paid === 'TRUE' || item.Paid === 'true';
      if (paid) spent += total;
    });
    return { budgeted: budgeted, spent: spent, eventBudget: fees.expected };
  }

  function updateStats() {
    var s = calcStats();
    document.getElementById('stat-event-budget').textContent = eur(s.eventBudget);
    var budgetedEl = document.getElementById('stat-budgeted');
    budgetedEl.textContent = eur(s.budgeted);
    budgetedEl.style.color = s.budgeted > s.eventBudget ? '#f44336' : '#4caf50';
    document.getElementById('stat-spent').textContent = eur(s.spent);
    var remainingEl = document.getElementById('stat-remaining');
    var remaining = s.eventBudget - s.spent;
    remainingEl.textContent = eur(remaining);
    remainingEl.style.color = remaining < 0 ? '#f44336' : '#ff9800';
  }
  updateStats();

  // Charts
  var categoryColors = {
    'Barrio Costs': '#e8a84c',
    'Kitchen': '#4fc3f7',
    'Construction': '#f06292',
    'Music Equipment': '#ab47bc',
    'Logistics': '#66bb6a',
    'Deco': '#ff7043',
  };
  var categories = Object.keys(categoryColors);

  function getCategoryTotals() {
    var budgeted = {}, spent = {};
    categories.forEach(function(c) { budgeted[c] = 0; spent[c] = 0; });
    items.forEach(function(item) {
      var cat = item.Category || '';
      if (!budgeted.hasOwnProperty(cat)) return;
      var total = (parseFloat(item.Qty) || 0) * (parseFloat(item.Price) || 0);
      budgeted[cat] += total;
      var paid = item.Paid === true || item.Paid === 'TRUE' || item.Paid === 'true';
      if (paid) spent[cat] += total;
    });
    return { budgeted: budgeted, spent: spent };
  }

  var catTotals = getCategoryTotals();
  var barColors = categories.map(function(c) { return categoryColors[c]; });

  // Bar chart: budgeted vs spent
  var barChart = new Chart(document.getElementById('budget-bar-chart'), {
    type: 'bar',
    data: {
      labels: categories,
      datasets: [
        { label: 'Budgeted', data: categories.map(function(c) { return catTotals.budgeted[c]; }), backgroundColor: barColors.map(function(c) { return c + '88'; }), borderRadius: 4 },
        { label: 'Spent', data: categories.map(function(c) { return catTotals.spent[c]; }), backgroundColor: barColors, borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#e8e4df' } } },
      scales: {
        x: { ticks: { color: '#8a8580', maxRotation: 45, minRotation: 0, font: { size: JH.isMobile ? 9 : 12 } }, grid: { display: false } },
        y: { ticks: { color: '#8a8580', callback: function(v) { return '\u20AC' + v; } }, grid: { color: '#2a2a2a22' }, beginAtZero: true }
      }
    }
  });

  // Pie chart
  var pieChart = new Chart(document.getElementById('budget-pie-chart'), {
    type: 'doughnut',
    data: {
      labels: categories,
      datasets: [{ data: categories.map(function(c) { return catTotals.budgeted[c]; }), backgroundColor: barColors, borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: { legend: { position: 'bottom', labels: { color: '#e8e4df', padding: JH.isMobile ? 8 : 12, usePointStyle: true, pointStyle: 'circle', font: { size: JH.isMobile ? 9 : 11 } } } }
    }
  });

  function updateCharts() {
    var ct = getCategoryTotals();
    barChart.data.datasets[0].data = categories.map(function(c) { return ct.budgeted[c]; });
    barChart.data.datasets[1].data = categories.map(function(c) { return ct.spent[c]; });
    barChart.update();
    pieChart.data.datasets[0].data = categories.map(function(c) { return ct.budgeted[c]; });
    pieChart.update();
  }

  // AG Grid
  function PaidRenderer() {}
  PaidRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('input');
    this.eGui.type = 'checkbox';
    this.eGui.checked = params.value === true || params.value === 'TRUE' || params.value === 'true';
    this.eGui.style.accentColor = '#e8a84c';
    if (!isAdmin) this.eGui.disabled = true;
    var self = this;
    this.eGui.addEventListener('change', function() {
      var item = items.find(function(it) { return it._row === params.data._row; });
      if (item) item.Paid = self.eGui.checked ? 'TRUE' : 'FALSE';
      saveBudgetField(params.data._row, 'Paid', self.eGui.checked);
      updateStats();
      updateCharts();
    });
  };
  PaidRenderer.prototype.getGui = function() { return this.eGui; };

  function DiscussRenderer() {}
  DiscussRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('input');
    this.eGui.type = 'checkbox';
    this.eGui.checked = params.value === true || params.value === 'TRUE' || params.value === 'true';
    this.eGui.style.accentColor = '#ff9800';
    var self = this;
    this.eGui.addEventListener('change', function() {
      var item = items.find(function(it) { return it._row === params.data._row; });
      if (item) item.Discuss = self.eGui.checked ? 'TRUE' : 'FALSE';
      saveBudgetField(params.data._row, 'Discuss', self.eGui.checked);
      gridApi.refreshCells({ force: true });
    });
  };
  DiscussRenderer.prototype.getGui = function() { return this.eGui; };

  function TotalRenderer() {}
  TotalRenderer.prototype.init = function(params) {
    var qty = parseFloat(params.data.Qty) || 0;
    var price = parseFloat(params.data.Price) || 0;
    this.eGui = document.createElement('span');
    this.eGui.textContent = eur(qty * price);
  };
  TotalRenderer.prototype.getGui = function() { return this.eGui; };

  function DeleteBtnRenderer() {}
  DeleteBtnRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('button');
    this.eGui.textContent = '\u00D7';
    this.eGui.title = 'Delete item';
    this.eGui.style.cssText = 'background:none;border:none;color:#555;font-size:1.2rem;cursor:pointer;padding:0 4px;';
    this.eGui.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (!confirm('Delete "' + (params.data.Item || '') + '"?')) return;
      try {
        var res = await fetch('/api/budget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete', row: params.data._row })
        });
        if (!res.ok) throw new Error('Failed');
        var refreshRes = await fetch('/api/budget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'fetch-items' })
        });
        if (refreshRes.ok) {
          var refreshData = await refreshRes.json();
          items = refreshData.items;
          gridApi.setGridOption('rowData', items);
        }
        updateStats();
        updateCharts();
      } catch (err) { console.error('Delete error:', err); }
    });
  };
  DeleteBtnRenderer.prototype.getGui = function() { return this.eGui; };

  var columnDefs = [
    { field: 'Category', sortable: true, filter: true, editable: isAdmin, cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: categories }, width: 150, suppressSizeToFit: true },
    { field: 'Item', sortable: true, filter: true, editable: isAdmin, width: 250, suppressSizeToFit: true },
    { field: 'Qty', sortable: true, filter: true, editable: isAdmin, width: 80, suppressSizeToFit: true },
    { field: 'Price', sortable: true, filter: true, editable: isAdmin, width: 110, suppressSizeToFit: true,
      valueFormatter: function(p) { return p.value ? eur(parseFloat(p.value)) : ''; } },
    { headerName: 'Total', field: '_total', cellRenderer: TotalRenderer, width: 120, suppressSizeToFit: true, sortable: true,
      valueGetter: function(p) { return (parseFloat(p.data.Qty) || 0) * (parseFloat(p.data.Price) || 0); } },
    { field: 'Paid', cellRenderer: PaidRenderer, width: 80, suppressSizeToFit: true, sortable: true },
    { field: 'Discuss', cellRenderer: DiscussRenderer, width: 80, suppressSizeToFit: true, sortable: true, filter: true },
    { field: 'Paid by', sortable: true, filter: true, editable: isAdmin, width: 120, suppressSizeToFit: true },
    { field: 'Link', sortable: true, editable: isAdmin, width: 80, suppressSizeToFit: true,
      cellRenderer: function(params) {
        var v = (params.value || '').trim();
        if (!v) return isAdmin ? '<span style="color:#555;cursor:pointer;">+ link</span>' : '';
        return '<a href="' + v.replace(/"/g, '&quot;') + '" target="_blank" title="' + v.replace(/"/g, '&quot;') + '" style="color:#e8a84c;text-decoration:none;">Link</a>';
      }
    },
    { field: 'Comment', sortable: true, filter: true, editable: isAdmin, flex: 1, minWidth: 200,
      cellEditor: 'agLargeTextCellEditor', cellEditorPopup: true, cellEditorParams: { maxLength: 500 },
      tooltipField: 'Comment' },
  ];
  if (isAdmin) {
    columnDefs.push({ headerName: '', cellRenderer: DeleteBtnRenderer, width: 40, maxWidth: 40, sortable: false, filter: false, resizable: false, suppressMenu: true, suppressHeaderMenuButton: true, suppressColumnsToolPanel: true, suppressFiltersToolPanel: true, headerClass: 'no-menu' });
  }

  var gridOptions = {
    columnDefs: columnDefs,
    rowData: items,
    defaultColDef: { resizable: true, minWidth: 60 },
    tooltipShowDelay: 300,
    initialState: { sort: { sortModel: [{ colId: 'Category', sort: 'asc' }] } },
    pagination: true,
    paginationPageSize: 50,
    suppressCellFocus: !isAdmin,
    singleClickEdit: true,
    getRowClass: function(params) {
      var d = params.data.Discuss;
      return (d === true || d === 'TRUE' || d === 'true') ? 'row-discuss' : '';
    },
    onCellValueChanged: function(event) {
      if (!isAdmin) return;
      var field = event.colDef.field;
      if (field === '_total') return;
      var newVal = event.newValue || '';
      var item = items.find(function(it) { return it._row === event.data._row; });
      if (item) item[field] = newVal;
      saveBudgetField(event.data._row, field, newVal);
      if (field === 'Qty' || field === 'Price') {
        gridApi.refreshCells({ force: true });
        updateStats();
        updateCharts();
      }
    },
    onModelUpdated: function() {
      var count = gridApi ? gridApi.getDisplayedRowCount() : 0;
      document.getElementById('item-count').textContent = count + ' items';
    }
  };

  var gridApi = agGrid.createGrid(document.getElementById('budget-grid'), gridOptions);

  if (JH.isMobile) {
    var hideFields = columnDefs.filter(function(c) {
      var keep = (c.field && ['Item', '_total'].indexOf(c.field) !== -1) ||
                 (c.headerName && c.headerName === 'Total');
      return !keep;
    }).map(function(c) { return c.field || c.headerName || ''; }).filter(Boolean);
    gridApi.setColumnsVisible(hideFields, false);
    gridApi.setColumnsVisible(['Item', '_total'], true);
    columnDefs.forEach(function(col) { col.editable = false; });
    var itemCol = columnDefs.find(function(c) { return c.field === 'Item'; });
    if (itemCol) { itemCol.cellRenderer = JH.NameLinkRenderer; itemCol.flex = 2; }
    var totalCol = columnDefs.find(function(c) { return c.field === '_total'; });
    if (totalCol) { delete totalCol.flex; totalCol.width = 90; totalCol.maxWidth = 100; delete totalCol.suppressSizeToFit; }
    if (itemCol) { delete itemCol.width; delete itemCol.suppressSizeToFit; }
    gridApi.setGridOption('columnDefs', columnDefs);
    gridApi.sizeColumnsToFit();
  }

  gridApi.addEventListener('firstDataRendered', function() {
    gridApi.sizeColumnsToFit();
  });

  function updateCategorySummary(cat) {
    var el = document.getElementById('category-summary');
    if (!cat) { el.textContent = ''; return; }
    var budgeted = 0, spent = 0;
    items.forEach(function(item) {
      if (item.Category !== cat) return;
      var total = (parseFloat(item.Qty) || 0) * (parseFloat(item.Price) || 0);
      budgeted += total;
      var paid = item.Paid === true || item.Paid === 'TRUE' || item.Paid === 'true';
      if (paid) spent += total;
    });
    el.textContent = cat + ': Budgeted ' + eur(budgeted) + ' | Spent ' + eur(spent) + ' | Remaining ' + eur(budgeted - spent);
  }

  // Category filter
  document.getElementById('categoryFilter').addEventListener('change', function() {
    var val = this.value;
    updateCategorySummary(val);
    if (val) {
      gridApi.setColumnFilterModel('Category', { type: 'equals', filter: val }).then(function() {
        gridApi.onFilterChanged();
      });
    } else {
      gridApi.setColumnFilterModel('Category', null).then(function() {
        gridApi.onFilterChanged();
      });
    }
  });

  // Discuss filter
  document.getElementById('discussCheck').addEventListener('change', function() {
    var checked = this.checked;
    var label = document.getElementById('discussFilter');
    label.style.borderColor = checked ? '#ff9800' : '';
    label.style.color = checked ? '#ff9800' : '';
    if (checked) {
      gridApi.setColumnFilterModel('Discuss', { type: 'equals', filter: 'TRUE' }).then(function() {
        gridApi.onFilterChanged();
      });
    } else {
      gridApi.setColumnFilterModel('Discuss', null).then(function() {
        gridApi.onFilterChanged();
      });
    }
  });

  // Save helper
  function saveBudgetField(row, field, value) {
    var updates = {};
    updates[field] = value;
    fetch('/api/budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, action: 'update', row: row, data: updates })
    }).then(function(res) {
      if (!res.ok) console.error('Save failed:', field, res.status);
    }).catch(function(err) {
      console.error('Save error:', err);
    });
  }

  // Shared add-item logic
  async function doAddItem(cat, item, qty, price, msgEl, onSuccess) {
    if (!cat || !item) { msgEl.textContent = 'Category and Item required'; msgEl.style.color = '#f44336'; return; }
    msgEl.textContent = 'Adding...'; msgEl.style.color = '#888';
    try {
      var res = await fetch('/api/budget', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass, action: 'add', data: { Category: cat, Item: item, Qty: qty || '1', Price: price || '0' } })
      });
      if (!res.ok) throw new Error('Failed');
      var result = await res.json();
      items.push({ _row: result.row, Category: cat, Item: item, Qty: qty || '1', Price: price || '0', 'Total Actual': '', Paid: 'FALSE', Discuss: 'FALSE', 'Paid by': '', Link: '', Comment: '' });
      gridApi.setGridOption('rowData', items);
      updateStats(); updateCharts();
      msgEl.textContent = 'Added!'; msgEl.style.color = '#4caf50';
      if (onSuccess) onSuccess();
    } catch (e) { msgEl.textContent = 'Error adding item'; msgEl.style.color = '#f44336'; }
  }

  // Add item (admin only) — desktop
  if (isAdmin) {
    document.getElementById('add-bar').style.display = 'flex';
    document.getElementById('add-btn').addEventListener('click', function() {
      doAddItem(
        document.getElementById('add-category').value,
        document.getElementById('add-item').value.trim(),
        document.getElementById('add-qty').value,
        document.getElementById('add-price').value,
        document.getElementById('add-msg'),
        function() {
          document.getElementById('add-item').value = '';
          document.getElementById('add-qty').value = '';
          document.getElementById('add-price').value = '';
          setTimeout(function() { document.getElementById('add-msg').textContent = ''; }, 2000);
        }
      );
    });
  }
  // Budget detail modal (shared for edit + add)
  var detailOverlay = document.getElementById('budget-detail-overlay');
  var detailBody = document.getElementById('budget-detail-body');
  var detailTitle = document.getElementById('budget-detail-title');
  var inputStyle = 'background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;padding:4px 6px;';
  var btnStyle = 'padding:0.45rem 1rem;background:var(--accent);border:none;border-radius:6px;color:var(--bg);font-family:var(--heading);font-size:0.85rem;font-weight:600;cursor:pointer;';
  if (detailOverlay) {
    document.getElementById('budget-detail-close').addEventListener('click', function() {
      detailOverlay.classList.remove('active');
    });
    detailOverlay.addEventListener('click', function(e) {
      if (e.target === detailOverlay) detailOverlay.classList.remove('active');
    });
  }

  function buildModalFields(d, isNew) {
    var qty = parseFloat(d.Qty) || 0;
    var price = parseFloat(d.Price) || 0;
    var total = qty * price;
    var paid = d.Paid === true || d.Paid === 'TRUE' || d.Paid === 'true';
    var discuss = d.Discuss === true || d.Discuss === 'TRUE' || d.Discuss === 'true';
    var editable = isAdmin || isNew;
    var catOpts = categories.map(function(c) {
      return '<option' + (c === d.Category ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var s = inputStyle;
    var w = s + 'width:100%;box-sizing:border-box;';
    return '<div class="budget-detail-row"><span class="label">Category</span><span class="value">' + (editable ? '<select data-field="Category" style="' + s + '"><option value="">Select...</option>' + catOpts + '</select>' : esc(d.Category || '')) + '</span></div>' +
      '<div class="budget-detail-row"><span class="label">Item</span><span class="value">' + (editable ? '<input data-field="Item" value="' + esc(d.Item || '') + '" placeholder="Item name" style="' + w + '">' : esc(d.Item || '')) + '</span></div>' +
      '<div class="budget-detail-row"><span class="label">Qty</span><span class="value">' + (editable ? '<input data-field="Qty" type="number" value="' + (isNew ? 1 : qty) + '" style="' + s + 'width:70px;">' : esc(String(qty))) + '</span></div>' +
      '<div class="budget-detail-row"><span class="label">Price</span><span class="value">' + (editable ? '<input data-field="Price" type="number" step="0.01" value="' + (isNew ? '' : price) + '" placeholder="0.00" style="' + s + 'width:100px;">' : eur(price)) + '</span></div>' +
      '<div class="budget-detail-row"><span class="label">Total</span><span class="value" style="font-weight:600;color:var(--accent);">' + eur(total) + '</span></div>' +
      '<div class="budget-detail-row"><span class="label">Paid</span><span class="value"><input data-field="Paid" type="checkbox"' + (paid ? ' checked' : '') + (editable ? '' : ' disabled') + ' style="accent-color:var(--accent);width:18px;height:18px;"></span></div>' +
      '<div class="budget-detail-row"><span class="label">Discuss</span><span class="value"><input data-field="Discuss" type="checkbox"' + (discuss ? ' checked' : '') + (editable ? '' : ' disabled') + ' style="accent-color:#ff9800;width:18px;height:18px;"></span></div>' +
      '<div class="budget-detail-row"><span class="label">Paid by</span><span class="value">' + (editable ? '<input data-field="Paid by" value="' + esc(d['Paid by'] || '') + '" style="' + w + '">' : esc(d['Paid by'] || '')) + '</span></div>' +
      '<div class="budget-detail-row"><span class="label">Link</span><span class="value">' + (editable ? '<input data-field="Link" value="' + esc(d.Link || '') + '" style="' + w + '">' : (d.Link ? '<a href="' + esc(d.Link) + '" target="_blank" style="color:var(--accent);text-decoration:none;">Link ↗</a>' : '')) + '</span></div>' +
      '<div class="budget-detail-row"><span class="label">Comment</span><span class="value">' + (editable ? '<textarea data-field="Comment" style="' + w + 'min-height:50px;resize:vertical;">' + esc(d.Comment || '') + '</textarea>' : esc(d.Comment || '')) + '</span></div>' +
      (editable ? '<div style="margin-top:12px;display:flex;gap:8px;"><button id="budget-detail-save" style="' + btnStyle + '">' + (isNew ? 'Add Item' : 'Save') + '</button><span id="budget-detail-msg" style="font-size:0.8rem;color:#888;align-self:center;"></span></div>' : '');
  }

  // Mobile: "+ Add" opens detail modal in add mode
  if (isAdmin && JH.isMobile) {
    document.getElementById('mobile-add-btn').addEventListener('click', function() {
      detailTitle.textContent = 'Add Item';
      detailBody.innerHTML = buildModalFields({}, true);
      document.getElementById('budget-detail-save').onclick = function() {
        doAddItem(
          detailBody.querySelector('[data-field="Category"]').value,
          detailBody.querySelector('[data-field="Item"]').value.trim(),
          detailBody.querySelector('[data-field="Qty"]').value,
          detailBody.querySelector('[data-field="Price"]').value,
          document.getElementById('budget-detail-msg'),
          function() { setTimeout(function() { detailOverlay.classList.remove('active'); }, 600); }
        );
      };
      detailOverlay.classList.add('active');
    });
  }

  // Mobile: tap row opens detail modal in edit mode
  gridApi.addEventListener('rowClicked', function(event) {
    if (!JH.isMobile) return;
    var d = event.data;
    detailTitle.textContent = d.Item || '';
    detailBody.innerHTML = buildModalFields(d, false);
    if (isAdmin) document.getElementById('budget-detail-save').onclick = function() {
      var msg = document.getElementById('budget-detail-msg');
      var item = items.find(function(it) { return it._row === d._row; });
      if (!item) return;
      detailBody.querySelectorAll('[data-field]').forEach(function(el) {
        var field = el.dataset.field;
        var val = el.type === 'checkbox' ? (el.checked ? 'TRUE' : 'FALSE') : el.value;
        if (String(item[field] || '') !== String(val)) {
          item[field] = val;
          saveBudgetField(d._row, field, val);
        }
      });
      gridApi.setGridOption('rowData', items);
      updateStats();
      updateCharts();
      msg.textContent = 'Saved!';
      msg.style.color = '#4caf50';
      setTimeout(function() { detailOverlay.classList.remove('active'); }, 600);
    };
    detailOverlay.classList.add('active');
  });

  // Fullscreen toggle
  var panel = document.getElementById('budget-panel');
  var fsBtn = document.getElementById('fullscreenBtn');
  fsBtn.addEventListener('click', function() {
    panel.classList.toggle('fullscreen');
    var isFs = panel.classList.contains('fullscreen');
    fsBtn.textContent = isFs ? 'Exit' : 'Expand';
    gridApi.sizeColumnsToFit();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && panel.classList.contains('fullscreen')) {
      panel.classList.remove('fullscreen');
      fsBtn.textContent = 'Expand';
      gridApi.sizeColumnsToFit();
    }
  });

  // ── Shopping Requests ─────────────────────────────────────────────────────

  var shoppingRequests = data.shoppingRequests || [];

  // Populate submitter dropdown from approved members
  var reqSubmitter = document.getElementById('req-submitter');
  reqSubmitter.innerHTML = '<option value="">Select your name...</option>';
  members.filter(function(m) {
    return (JH.val(m, 'Status') || '').toLowerCase() === 'approved';
  }).forEach(function(m) {
    var name = JH.val(m, 'Playa Name') || JH.val(m, 'Name') || '';
    if (!name) return;
    var opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    reqSubmitter.appendChild(opt);
  });

  function renderShoppingRequests() {
    var wrap = document.getElementById('shopping-list-wrap');
    if (!shoppingRequests.length) {
      wrap.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;padding:12px 0">No requests yet.</p>';
      return;
    }
    wrap.innerHTML = shoppingRequests.map(function(r) {
      var statusClass = 'status-' + (r.Status || 'pending').toLowerCase();
      var linkHtml = r.Link ? '<a href="' + esc(r.Link) + '" target="_blank" rel="noopener" style="color:var(--accent);font-size:0.8rem;">View ↗</a>' : '';
      var adminBtns = isAdmin && (r.Status || 'pending') === 'pending' ?
        '<button class="approve-btn fullscreen-btn" data-id="' + esc(r.RequestID) + '" style="color:#4caf50;border-color:#4caf50;">Approve</button>' +
        '<button class="reject-btn fullscreen-btn" data-id="' + esc(r.RequestID) + '" style="color:#f44336;border-color:#f44336;margin-left:4px;">Reject</button>' : '';
      return '<div class="request-row">' +
        '<div>' +
          '<div style="font-weight:600">' + esc(r.Item) + '</div>' +
          (r.Description ? '<div style="color:var(--text-muted);font-size:0.8rem;margin-top:2px">' + esc(r.Description) + '</div>' : '') +
          '<div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">by ' + esc(r.SubmittedBy) + (r.Price ? ' · €' + esc(r.Price) : '') + ' ' + linkHtml + '</div>' +
        '</div>' +
        '<span class="request-status ' + statusClass + '">' + esc(r.Status || 'pending') + '</span>' +
        '<div>' + adminBtns + '</div>' +
      '</div>';
    }).join('');

    if (isAdmin) {
      wrap.querySelectorAll('.approve-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var id = btn.dataset.id;
          var r = await fetch('/api/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass, action: 'approve-request', requestId: id }) });
          if (!r.ok) { alert('Failed to approve'); return; }
          var req = shoppingRequests.find(function(x) { return x.RequestID === id; });
          if (req) req.Status = 'approved';
          renderShoppingRequests();
        });
      });
      wrap.querySelectorAll('.reject-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var id = btn.dataset.id;
          var r = await fetch('/api/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass, action: 'reject-request', requestId: id }) });
          if (!r.ok) { alert('Failed to reject'); return; }
          var req = shoppingRequests.find(function(x) { return x.RequestID === id; });
          if (req) req.Status = 'rejected';
          renderShoppingRequests();
        });
      });
    }
  }

  renderShoppingRequests();

  // Modal open/close
  document.getElementById('new-request-btn').addEventListener('click', function() {
    document.getElementById('request-modal').classList.add('active');
  });
  document.getElementById('request-modal-close').addEventListener('click', function() {
    document.getElementById('request-modal').classList.remove('active');
  });
  document.getElementById('request-modal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('active');
  });

  // Submit request
  document.getElementById('req-submit-btn').addEventListener('click', async function() {
    var submittedBy = document.getElementById('req-submitter').value;
    var item = document.getElementById('req-item').value.trim();
    var desc = document.getElementById('req-desc').value.trim();
    var link = document.getElementById('req-link').value.trim();
    var price = document.getElementById('req-price').value;
    var msg = document.getElementById('req-msg');

    if (!submittedBy || !item) {
      msg.textContent = 'Name and item are required'; msg.style.color = '#f44336'; return;
    }
    msg.textContent = 'Submitting...'; msg.style.color = '#888';
    var requestId = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    try {
      var r = await fetch('/api/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass, action: 'shopping-request', requestId: requestId, item: item, description: desc, link: link, price: price, submittedBy: submittedBy }) });
      if (!r.ok) throw new Error('Failed');
      shoppingRequests.push({ RequestID: requestId, Item: item, Description: desc, Link: link, Price: price, SubmittedBy: submittedBy, Status: 'pending' });
      renderShoppingRequests();
      document.getElementById('request-modal').classList.remove('active');
      document.getElementById('req-item').value = '';
      document.getElementById('req-desc').value = '';
      document.getElementById('req-link').value = '';
      document.getElementById('req-price').value = '';
      msg.textContent = '';
    } catch (e) {
      msg.textContent = 'Error submitting'; msg.style.color = '#f44336';
    }
  });
})();
