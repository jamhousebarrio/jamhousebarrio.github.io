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

  // Column definitions
  var columnDefs = [
    { title: 'Name', field: 'Name', visible: true },
    { title: 'Playa Name', field: 'Playa Name', visible: true },
    { title: 'Location', field: 'Location', visible: true },
    { title: 'Email', field: 'Email', visible: false },
    { title: 'Phone', field: 'Phone', visible: false },
    { title: 'Nationality', field: 'Nationality', visible: false },
    { title: 'Gender', field: 'Gender', visible: false },
    { title: 'Age', field: 'Age', visible: false },
    { title: 'First Burn', field: 'First Burn', visible: true },
    { title: 'Has Ticket', field: 'Has Ticket', visible: true },
    { title: 'Volunteer', field: 'Volunteer', visible: false },
    { title: 'Date', field: '_date', visible: true },
    {
      title: 'Status', field: 'Status', visible: true,
      formatter: function(cell) {
        var v = (cell.getValue() || 'Pending').toLowerCase();
        var cls = v === 'approved' ? 'status-approved' : v === 'rejected' ? 'status-rejected' : 'status-pending';
        if (!isAdmin) {
          return '<span class="' + cls + '">' + v.charAt(0).toUpperCase() + v.slice(1) + '</span>';
        }
        var sel = document.createElement('select');
        ['Pending', 'Approved', 'Rejected'].forEach(function(opt) {
          var o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          if (opt.toLowerCase() === v) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function(e) {
          e.stopPropagation();
          updateStatus(cell.getRow().getData(), sel.value, sel);
        });
        sel.addEventListener('click', function(e) { e.stopPropagation(); });
        return sel;
      }
    }
  ];

  // Prepare table data
  function getTableData() {
    return allMembers.map(function(m) {
      var obj = Object.assign({}, m);
      var ts = val(m, 'Timestamp');
      obj._date = ts ? new Date(ts).toLocaleDateString() : '';
      obj.Status = val(m, 'Status') || 'Pending';
      return obj;
    });
  }

  var table = new Tabulator('#app-grid', {
    data: getTableData(),
    columns: columnDefs,
    layout: 'fitColumns',
    pagination: true,
    paginationSize: 25,
    movableColumns: true,
    headerSort: true,
    selectable: false,
    rowClick: function(e, row) {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
      var data = row.getData();
      var member = allMembers.find(function(m) { return m._row === data._row; });
      if (member) openModal(member);
    }
  });

  // Column toggles
  var togglesEl = document.getElementById('colToggles');
  columnDefs.forEach(function(col) {
    var label = document.createElement('label');
    label.className = 'col-toggle' + (col.visible ? ' active' : '');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = col.visible;
    cb.addEventListener('change', function() {
      label.className = 'col-toggle' + (this.checked ? ' active' : '');
      if (this.checked) {
        table.showColumn(col.field);
      } else {
        table.hideColumn(col.field);
      }
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(col.title));
    togglesEl.appendChild(label);
  });

  // Status filter
  document.getElementById('statusFilter').addEventListener('change', function() {
    var filter = this.value;
    if (filter === 'all') {
      table.clearFilter();
    } else {
      table.setFilter(function(data) {
        return (data.Status || 'Pending').toLowerCase() === filter;
      });
    }
    updateCount();
  });

  function updateCount() {
    var count = table.getDataCount('active');
    document.getElementById('filter-count').textContent = count + ' applications';
  }
  table.on('dataLoaded', updateCount);
  table.on('dataFiltered', updateCount);

  // Inline status update
  async function updateStatus(data, newStatus, selectEl) {
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
      selectEl.value = val(member, 'Status') || 'Pending';
    }
  }

  // Modal
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
          table.replaceData(getTableData());
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
