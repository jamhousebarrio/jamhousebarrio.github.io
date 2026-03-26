(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var val = JH.val;
  var isAdmin = JH.isAdmin();
  var allMembers = members.map(function(m, i) { m._row = i + 2; return m; });

  // Stats
  var pending = allMembers.filter(function(m) { return val(m, 'Status').toLowerCase() === 'pending'; }).length;
  var approved = allMembers.filter(function(m) { return val(m, 'Status').toLowerCase() === 'approved'; }).length;
  var rejected = allMembers.filter(function(m) { return val(m, 'Status').toLowerCase() === 'rejected'; }).length;
  document.getElementById('stat-total').textContent = allMembers.length;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-approved').textContent = approved;
  document.getElementById('stat-rejected').textContent = rejected;

  function refreshStats() {
    var p = allMembers.filter(function(x) { return val(x, 'Status').toLowerCase() === 'pending'; }).length;
    var a = allMembers.filter(function(x) { return val(x, 'Status').toLowerCase() === 'approved'; }).length;
    var r = allMembers.filter(function(x) { return val(x, 'Status').toLowerCase() === 'rejected'; }).length;
    document.getElementById('stat-total').textContent = allMembers.length;
    document.getElementById('stat-pending').textContent = p;
    document.getElementById('stat-approved').textContent = a;
    document.getElementById('stat-rejected').textContent = r;
  }

  function renderTable(filter) {
    var filtered = filter === 'all' ? allMembers : allMembers.filter(function(m) {
      return val(m, 'Status').toLowerCase() === filter;
    });
    document.getElementById('filter-count').textContent = filtered.length + ' applications';
    document.getElementById('app-tbody').innerHTML = filtered.map(function(m) {
      var status = val(m, 'Status').toLowerCase() || 'pending';
      var statusClass = status === 'approved' ? 'status-approved' : status === 'rejected' ? 'status-rejected' : 'status-pending';
      var statusText = status.charAt(0).toUpperCase() + status.slice(1);
      var ts = val(m, 'Timestamp');
      var date = ts ? new Date(ts).toLocaleDateString() : '';
      return '<tr data-row="' + m._row + '">' +
        '<td class="name">' + val(m, 'Name') + '</td>' +
        '<td>' + val(m, 'Playa Name') + '</td>' +
        '<td>' + val(m, 'Location') + '</td>' +
        '<td>' + val(m, 'First Burn') + '</td>' +
        '<td>' + val(m, 'Has Ticket') + '</td>' +
        '<td>' + date + '</td>' +
        '<td><span class="' + statusClass + '">' + statusText + '</span></td>' +
        '</tr>';
    }).join('');

    document.querySelectorAll('#app-tbody tr').forEach(function(tr) {
      tr.addEventListener('click', function() {
        var row = parseInt(this.dataset.row);
        var member = allMembers.find(function(m) { return m._row === row; });
        if (member) openModal(member);
      });
    });
  }

  function contactLinks(v) {
    var phone = v.replace(/[^+\d]/g, '');
    var links = [];
    if (phone) {
      links.push('<a href="https://wa.me/' + phone.replace('+', '') + '" target="_blank" style="color:#25D366;">WhatsApp</a>');
      links.push('<a href="https://t.me/' + phone + '" target="_blank" style="color:#0088cc;">Telegram</a>');
    }
    return links.length ? ' &nbsp; ' + links.join(' &nbsp; ') : '';
  }

  var contactKeys = ['Phone', 'Email', 'Contact Methods', 'Contact Other'];
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
          renderTable(document.getElementById('statusFilter').value);
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

  document.getElementById('statusFilter').addEventListener('change', function() {
    renderTable(this.value);
  });

  renderTable('all');
})();
