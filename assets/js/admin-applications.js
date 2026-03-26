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

  function ViewBtnRenderer() {}
  ViewBtnRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('button');
    this.eGui.textContent = 'View';
    this.eGui.style.cssText = 'background:#e8a84c;color:#0a0a0a;border:none;border-radius:4px;padding:2px 10px;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;';
    this.eGui.addEventListener('click', function(e) {
      e.stopPropagation();
      var member = allMembers.find(function(m) { return m._row === params.data._row; });
      if (member) openModal(member);
    });
  };
  ViewBtnRenderer.prototype.getGui = function() { return this.eGui; };

  var waIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path fill="#25D366" d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.613.613l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.352 0-4.55-.678-6.414-1.846l-.447-.283-3.167 1.062 1.062-3.167-.283-.447A9.96 9.96 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>';
  var tgIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#0088cc" d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';

  function PhoneCellRenderer() {}
  PhoneCellRenderer.prototype.init = function(params) {
    var v = (params.value || '').trim();
    this.eGui = document.createElement('span');
    if (!v) return;
    var digits = v.replace(/[^+\d]/g, '').replace('+', '');
    this.eGui.innerHTML = v.replace(/</g, '&lt;') +
      (digits ? ' &nbsp;<a href="https://wa.me/' + digits + '" target="_blank" title="WhatsApp" style="text-decoration:none;">' + waIcon + '</a>' +
      ' <a href="https://t.me/+' + digits + '" target="_blank" title="Telegram" style="text-decoration:none;">' + tgIcon + '</a>' : '');
  };
  PhoneCellRenderer.prototype.getGui = function() { return this.eGui; };

  var columnDefs = [
    { headerName: '', field: '_view', cellRenderer: ViewBtnRenderer, valueGetter: function() { return ''; }, width: 70, maxWidth: 70, sortable: false, filter: false, resizable: false, suppressSizeToFit: true },
    { field: 'Name', sortable: true, filter: true, editable: isAdmin },
    { field: 'Playa Name', sortable: true, filter: true, editable: isAdmin },
    { field: 'Location', sortable: true, filter: true, editable: isAdmin },
    { field: 'Email', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'Phone', sortable: true, filter: true, editable: isAdmin, cellRenderer: PhoneCellRenderer },
    { field: 'Nationality', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'Gender', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'Age', sortable: true, filter: true, hide: true, editable: isAdmin },
    { field: 'First Burn', sortable: true, filter: true, editable: isAdmin },
    { field: 'Has Ticket', sortable: true, filter: true, editable: isAdmin },
    { field: 'Volunteer', sortable: true, filter: true, hide: true, editable: isAdmin },
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
  columnDefs.filter(function(col) { return col.field && col.field !== '_view'; }).forEach(function(col) {
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
      links.push('<a href="https://wa.me/' + digits + '" target="_blank" title="WhatsApp" style="text-decoration:none;">' + waIcon + '</a>');
      links.push('<a href="https://t.me/+' + digits + '" target="_blank" title="Telegram" style="text-decoration:none;">' + tgIcon + '</a>');
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
