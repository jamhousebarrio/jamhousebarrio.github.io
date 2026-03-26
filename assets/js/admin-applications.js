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

  // All available columns
  var allColumns = [
    { key: 'Name', name: 'Name', on: true },
    { key: 'Playa Name', name: 'Playa Name', on: true },
    { key: 'Location', name: 'Location', on: true },
    { key: 'Email', name: 'Email', on: false },
    { key: 'Phone', name: 'Phone', on: false },
    { key: 'Nationality', name: 'Nationality', on: false },
    { key: 'Gender', name: 'Gender', on: false },
    { key: 'Age', name: 'Age', on: false },
    { key: 'First Burn', name: 'First Burn', on: true },
    { key: 'Has Ticket', name: 'Has Ticket', on: true },
    { key: 'Volunteer', name: 'Volunteer', on: false },
    { key: 'Timestamp', name: 'Date', on: true },
    { key: 'Status', name: 'Status', on: true }
  ];

  // Render column toggles
  var togglesEl = document.getElementById('colToggles');
  allColumns.forEach(function(col) {
    var label = document.createElement('label');
    label.className = 'col-toggle' + (col.on ? ' active' : '');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = col.on;
    cb.addEventListener('change', function() {
      col.on = this.checked;
      label.className = 'col-toggle' + (col.on ? ' active' : '');
      rebuildGrid();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(col.name));
    togglesEl.appendChild(label);
  });

  function statusHtml(status, row) {
    var s = (status || 'pending').toLowerCase();
    var cls = s === 'approved' ? 'status-approved' : s === 'rejected' ? 'status-rejected' : 'status-pending';
    if (!isAdmin) {
      return '<span class="' + cls + '">' + s.charAt(0).toUpperCase() + s.slice(1) + '</span>';
    }
    return '<select class="status-select ' + cls + '" data-row="' + row + '">' +
      '<option value="Pending"' + (s === 'pending' ? ' selected' : '') + '>Pending</option>' +
      '<option value="Approved"' + (s === 'approved' ? ' selected' : '') + '>Approved</option>' +
      '<option value="Rejected"' + (s === 'rejected' ? ' selected' : '') + '>Rejected</option>' +
      '</select>';
  }

  function getVisibleColumns() {
    var cols = allColumns.filter(function(c) { return c.on; }).map(function(c) {
      if (c.key === 'Status') {
        return { name: c.name, sort: true, formatter: function(cell, row) {
          var rowNum = row.cells[row.cells.length - 1].data;
          return gridjs.html(statusHtml(cell, rowNum));
        }};
      }
      return { name: c.name, sort: true };
    });
    cols.push({ name: 'row', hidden: true });
    return cols;
  }

  function getGridData(filter) {
    var filtered = filter === 'all' ? allMembers : allMembers.filter(function(m) {
      return val(m, 'Status').toLowerCase() === filter;
    });
    document.getElementById('filter-count').textContent = filtered.length + ' applications';
    var visibleKeys = allColumns.filter(function(c) { return c.on; });
    return filtered.map(function(m) {
      var row = visibleKeys.map(function(c) {
        if (c.key === 'Timestamp') {
          var ts = val(m, 'Timestamp');
          return ts ? new Date(ts).toLocaleDateString() : '';
        }
        if (c.key === 'Status') return val(m, 'Status') || 'Pending';
        return val(m, c.key);
      });
      row.push(m._row);
      return row;
    });
  }

  var grid;
  function rebuildGrid() {
    var filter = document.getElementById('statusFilter').value;
    if (grid) {
      document.getElementById('app-grid').innerHTML = '';
    }
    grid = new gridjs.Grid({
      columns: getVisibleColumns(),
      data: getGridData(filter),
      search: true,
      sort: true,
      pagination: { limit: 25 },
      className: { table: 'app-table' }
    }).render(document.getElementById('app-grid'));

    grid.on('rowClick', function(e, row) {
      if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION')) return;
      var rowNum = row.cells[row.cells.length - 1].data;
      var member = allMembers.find(function(m) { return m._row === rowNum; });
      if (member) openModal(member);
    });
  }
  rebuildGrid();

  // Handle inline status changes
  document.getElementById('app-grid').addEventListener('change', async function(e) {
    if (!e.target.classList.contains('status-select')) return;
    var rowNum = parseInt(e.target.dataset.row);
    var newStatus = e.target.value;
    var member = allMembers.find(function(m) { return m._row === rowNum; });
    if (!member) return;
    var pass = sessionStorage.getItem('jh_pass');
    try {
      var res = await fetch('/api/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass, row: rowNum, status: newStatus })
      });
      if (!res.ok) throw new Error('Failed');
      member['Status'] = newStatus;
      var s = newStatus.toLowerCase();
      var cls = s === 'approved' ? 'status-approved' : s === 'rejected' ? 'status-rejected' : 'status-pending';
      e.target.className = 'status-select ' + cls;
      refreshStats();
    } catch (err) {
      e.target.value = val(member, 'Status') || 'Pending';
    }
  });

  document.getElementById('statusFilter').addEventListener('change', function() {
    var filter = this.value;
    grid.updateConfig({ data: getGridData(filter) }).forceRender();
  });

  function contactLinks(v) {
    var phone = v.replace(/[^+\d]/g, '');
    var links = [];
    if (phone) {
      links.push('<a href="https://wa.me/' + phone.replace('+', '') + '" target="_blank" style="color:#25D366;">WhatsApp</a>');
      links.push('<a href="https://t.me/' + phone + '" target="_blank" style="color:#0088cc;">Telegram</a>');
    }
    return links.length ? ' &nbsp; ' + links.join(' &nbsp; ') : '';
  }

  var readonlyKeys = ['_row', 'Timestamp'];

  function openModal(m) {
    document.getElementById('modal-title').textContent = val(m, 'Name') || 'Application';
    var skipKeys = ['_row'];
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
          var currentFilter = document.getElementById('statusFilter').value;
          grid.updateConfig({ data: getGridData(currentFilter) }).forceRender();
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
