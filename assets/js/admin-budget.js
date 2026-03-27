(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');

  // Fetch budget items
  var res = await fetch('/api/budget-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pass })
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
        x: { ticks: { color: '#8a8580' }, grid: { display: false } },
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
      plugins: { legend: { position: 'bottom', labels: { color: '#e8e4df', padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } } }
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
        var res = await fetch('/api/update-budget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete', row: params.data._row })
        });
        if (!res.ok) throw new Error('Failed');
        var refreshRes = await fetch('/api/budget-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass })
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

  // Save helper
  function saveBudgetField(row, field, value) {
    var updates = {};
    updates[field] = value;
    fetch('/api/update-budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, action: 'update', row: row, data: updates })
    }).then(function(res) {
      if (!res.ok) console.error('Save failed:', field, res.status);
    }).catch(function(err) {
      console.error('Save error:', err);
    });
  }

  // Add item (admin only)
  if (isAdmin) {
    document.getElementById('add-bar').style.display = 'flex';
    document.getElementById('add-btn').addEventListener('click', async function() {
      var cat = document.getElementById('add-category').value;
      var item = document.getElementById('add-item').value.trim();
      var qty = document.getElementById('add-qty').value;
      var price = document.getElementById('add-price').value;
      var msg = document.getElementById('add-msg');

      if (!cat || !item) {
        msg.textContent = 'Category and Item required';
        msg.style.color = '#f44336';
        return;
      }
      msg.textContent = 'Adding...';
      msg.style.color = '#888';

      try {
        var res = await fetch('/api/update-budget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: pass,
            action: 'add',
            data: { Category: cat, Item: item, Qty: qty || '1', Price: price || '0' }
          })
        });
        if (!res.ok) throw new Error('Failed');
        var result = await res.json();
        var newItem = {
          _row: result.row,
          Category: cat,
          Item: item,
          Qty: qty || '1',
          Price: price || '0',
          'Total Actual': '',
          Paid: 'FALSE',
          'Paid by': '',
          Link: '',
          Comment: ''
        };
        items.push(newItem);
        gridApi.setGridOption('rowData', items);
        updateStats();
        updateCharts();

        // Clear inputs
        document.getElementById('add-item').value = '';
        document.getElementById('add-qty').value = '';
        document.getElementById('add-price').value = '';
        msg.textContent = 'Added!';
        msg.style.color = '#4caf50';
        setTimeout(function() { msg.textContent = ''; }, 2000);
      } catch (e) {
        msg.textContent = 'Error adding item';
        msg.style.color = '#f44336';
      }
    });
  }
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
})();
