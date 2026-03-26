(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var val = JH.val;
  var isAdmin = JH.isAdmin();
  var allMembers = members.map(function(m, i) { m._row = i + 2; return m; });

  function refreshStats() {
    var p = allMembers.filter(function(x) { return val(x, 'Status').toLowerCase() === 'pending'; }).length;
    var a = allMembers.filter(function(x) { return val(x, 'Status').toLowerCase() === 'approved'; }).length;
    var r = allMembers.filter(function(x) { return val(x, 'Status').toLowerCase() === 'rejected'; }).length;
    document.getElementById('stat-total').textContent = allMembers.length;
    document.getElementById('stat-pending').textContent = p;
    document.getElementById('stat-approved').textContent = a;
    document.getElementById('stat-rejected').textContent = r;
  }
  refreshStats();

  function getRowData() {
    return allMembers.map(function(m) {
      var ts = val(m, 'Timestamp');
      return {
        _row: m._row,
        Name: val(m, 'Name'),
        'Playa Name': val(m, 'Playa Name'),
        Location: val(m, 'Location'),
        Email: val(m, 'Email'),
        Phone: val(m, 'Phone'),
        Nationality: val(m, 'Nationality'),
        Gender: val(m, 'Gender'),
        Age: val(m, 'Age'),
        'First Burn': val(m, 'First Burn'),
        'Has Ticket': val(m, 'Has Ticket'),
        Volunteer: val(m, 'Volunteer'),
        Date: ts ? new Date(ts).toLocaleDateString() : '',
        Status: val(m, 'Status') || 'Pending'
      };
    });
  }

  function StatusCellRenderer() {}
  StatusCellRenderer.prototype.init = function(params) {
    var v = (params.value || 'Pending').toLowerCase();
    if (isAdmin) {
      this.eGui = document.createElement('select');
      this.eGui.style.cssText = 'background:#0a0a0a;color:#e0e0e0;border:1px solid #2a2a2a;border-radius:4px;padding:2px 4px;font-size:0.8rem;cursor:pointer;width:100%;';
      var self = this;
      ['Pending', 'Approved', 'Rejected'].forEach(function(opt) {
        var o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (opt.toLowerCase() === v) o.selected = true;
        self.eGui.appendChild(o);
      });
      this.eGui.addEventListener('change', function() {
        updateStatus(params.data, self.eGui.value);
      });
    } else {
      this.eGui = document.createElement('span');
      var cls = v === 'approved' ? 'status-approved' : v === 'rejected' ? 'status-rejected' : 'status-pending';
      this.eGui.className = cls;
      this.eGui.textContent = v.charAt(0).toUpperCase() + v.slice(1);
    }
  };
  StatusCellRenderer.prototype.getGui = function() { return this.eGui; };

  var editableFields = ['Name', 'Playa Name', 'Location', 'Email', 'Phone', 'Nationality', 'Gender', 'Age', 'First Burn', 'Has Ticket', 'Volunteer'];

  var columnDefs = [
    { field: 'Name', sortable: true, filter: true, editable: isAdmin },
    { field: 'Playa Name', sortable: true, filter: true, editable: isAdmin },
    { field: 'Location', sortable: true, filter: true, editable: isAdmin },
    { field: 'Email', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'Phone', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'Nationality', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'Gender', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'Age', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'First Burn', sortable: true, filter: true, editable: isAdmin },
    { field: 'Has Ticket', sortable: true, filter: true, editable: isAdmin },
    { field: 'Volunteer', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'Date', sortable: true, filter: true },
    { field: 'Status', sortable: true, filter: true, cellRenderer: StatusCellRenderer }
  ];

  var gridOptions = {
    columnDefs: columnDefs,
    rowData: getRowData(),
    defaultColDef: { resizable: true, flex: 1, minWidth: 100 },
    pagination: true,
    paginationPageSize: 25,
    rowSelection: 'single',
    suppressCellFocus: !isAdmin,
    singleClickEdit: true,
    onRowClicked: function(event) {
      if (event.event && event.event.target && (event.event.target.tagName === 'SELECT' || event.event.target.tagName === 'OPTION')) return;
      var col = event.colDef && event.colDef.field;
      if (col && editableFields.indexOf(col) !== -1 && isAdmin) return;
      var member = allMembers.find(function(m) { return m._row === event.data._row; });
      if (member) openModal(member);
    },
    onCellValueChanged: function(event) {
      if (!isAdmin) return;
      var field = event.colDef.field;
      var newVal = event.newValue || '';
      var member = allMembers.find(function(m) { return m._row === event.data._row; });
      if (!member) return;
      member[field] = newVal;
      var pass = sessionStorage.getItem('jh_pass');
      var updates = {};
      updates[field] = newVal;
      fetch('/api/update-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass, row: event.data._row, updates: updates })
      });
    },
    onModelUpdated: function() {
      var count = gridApi ? gridApi.getDisplayedRowCount() : 0;
      document.getElementById('filter-count').textContent = count + ' applications';
    }
  };

  var gridDiv = document.getElementById('app-grid');
  var gridApi = agGrid.createGrid(gridDiv, gridOptions);

  // Column toggles
  var togglesEl = document.getElementById('colToggles');
  columnDefs.forEach(function(col) {
    var label = document.createElement('label');
    label.className = 'col-toggle' + (col.hide ? '' : ' active');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !col.hide;
    cb.addEventListener('change', function() {
      label.className = 'col-toggle' + (this.checked ? ' active' : '');
      gridApi.setColumnsVisible([col.field], this.checked);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(col.field));
    togglesEl.appendChild(label);
  });

  // Status filter
  document.getElementById('statusFilter').addEventListener('change', function() {
    var filterVal = this.value;
    if (filterVal) {
      gridApi.setGridOption('quickFilterText', null);
      gridApi.setColumnFilterModel('Status', { type: 'equals', filter: filterVal }).then(function() {
        gridApi.onFilterChanged();
      });
    } else {
      gridApi.setColumnFilterModel('Status', null).then(function() {
        gridApi.onFilterChanged();
      });
    }
  });

  // Inline status update
  async function updateStatus(data, newStatus) {
    var member = allMembers.find(function(m) { return m._row === data._row; });
    if (!member) return;
    var pass = sessionStorage.getItem('jh_pass');
    try {
      var res = await fetch('/api/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass, row: data._row, status: newStatus })
      });
      if (!res.ok) throw new Error('Failed');
      member['Status'] = newStatus;
      refreshStats();
    } catch (err) {
      // revert on failure
      gridApi.setGridOption('rowData', getRowData());
    }
  }

  // Modal
  function contactLinks(v) {
    var phone = v.replace(/[^+\d]/g, '');
    var digits = phone.replace('+', '');
    var links = [];
    if (digits) {
      links.push('<a href="https://wa.me/' + digits + '" target="_blank" style="color:#25D366;">WhatsApp</a>');
      links.push('<a href="https://t.me/+' + digits + '" target="_blank" style="color:#0088cc;">Telegram</a>');
    }
    return links.length ? ' &nbsp; ' + links.join(' &nbsp; ') : '';
  }

  var readonlyKeys = ['_row', 'Timestamp'];

  function openModal(m) {
    document.getElementById('modal-title').textContent = val(m, 'Name') || 'Application';
    var skipKeys = ['_row', '_date'];
    var html = Object.keys(m).filter(function(k) {
      return skipKeys.indexOf(k) === -1;
    }).map(function(k) {
      var v = val(m, k);
      var escaped = v ? v.replace(/</g, '&lt;') : '';
      var isLong = v.length > 60;
      var links = (k === 'Phone') ? contactLinks(v) : '';
      if (!isAdmin || readonlyKeys.indexOf(k) !== -1) {
        var display = escaped || '<span style="color:#555;">—</span>';
        return '<div class="detail-row"><div class="detail-label">' + k + '</div><div class="detail-value">' + display + links + '</div></div>';
      }
      if (isLong) {
        return '<div class="detail-row"><div class="detail-label">' + k + '</div><div class="detail-value">' +
          '<textarea class="field-input" data-key="' + k + '">' + escaped + '</textarea>' + links + '</div></div>';
      }
      return '<div class="detail-row"><div class="detail-label">' + k + '</div><div class="detail-value">' +
        '<input class="field-input" data-key="' + k + '" value="' + escaped.replace(/"/g, '&quot;') + '">' + links + '</div></div>';
    }).join('');
    document.getElementById('modal-details').innerHTML = html;

    var statusActions = document.getElementById('status-actions');
    if (isAdmin) {
      statusActions.style.display = 'flex';
      document.getElementById('modal-save').textContent = 'Save All';
      document.getElementById('modal-msg').textContent = '';

      document.getElementById('modal-save').onclick = async function() {
        var pass = sessionStorage.getItem('jh_pass');
        var updates = {};
        document.querySelectorAll('.field-input').forEach(function(el) {
          var key = el.dataset.key;
          var newVal = el.value.trim();
          if (newVal !== val(m, key)) updates[key] = newVal;
        });
        if (Object.keys(updates).length === 0) {
          document.getElementById('modal-msg').textContent = 'No changes';
          document.getElementById('modal-msg').style.color = '#888';
          return;
        }
        document.getElementById('modal-msg').textContent = 'Saving...';
        document.getElementById('modal-msg').style.color = '#888';
        try {
          var res = await fetch('/api/update-member', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass, row: m._row, updates: updates })
          });
          if (!res.ok) {
            var err = await res.json().catch(function() { return {}; });
            throw new Error(err.error || 'Failed');
          }
          for (var key in updates) m[key] = updates[key];
          document.getElementById('modal-msg').textContent = 'Saved!';
          document.getElementById('modal-msg').style.color = '#4caf50';
          refreshStats();
          gridApi.setGridOption('rowData', getRowData());
        } catch (e) {
          document.getElementById('modal-msg').textContent = e.message;
          document.getElementById('modal-msg').style.color = '#f44336';
        }
      };
    } else {
      statusActions.style.display = 'none';
    }

    document.getElementById('modalOverlay').classList.add('active');
  }

  document.getElementById('modalClose').addEventListener('click', function() {
    document.getElementById('modalOverlay').classList.remove('active');
  });
  document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('active');
  });
})();
