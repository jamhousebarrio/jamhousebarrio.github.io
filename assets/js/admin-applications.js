(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var val = JH.val;
  var allMembers = members.map(function(m, i) { m._row = i + 2; return m; });

  // Stats
  var pending = allMembers.filter(function(m) { return val(m, 'Status').toLowerCase() === 'pending'; }).length;
  var approved = allMembers.filter(function(m) { return val(m, 'Status').toLowerCase() === 'approved'; }).length;
  var rejected = allMembers.filter(function(m) { return val(m, 'Status').toLowerCase() === 'rejected'; }).length;
  document.getElementById('stat-total').textContent = allMembers.length;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-approved').textContent = approved;
  document.getElementById('stat-rejected').textContent = rejected;

  var detailFields = [
    ['Timestamp', 'Submitted'],
    ['Name', 'Name'],
    ['Playa Name', 'Playa Name'],
    ['Email', 'Email'],
    ['Phone', 'Phone'],
    ['Contact Methods', 'Contact Methods'],
    ['Contact Other', 'Other Contact'],
    ['Location', 'Location'],
    ['Nationality', 'Nationality'],
    ['Gender', 'Gender'],
    ['Age', 'Age'],
    ['Language', 'Language'],
    ['Other Languages', 'Other Languages'],
    ['First Burn', 'First Burn'],
    ['First Elsewhere/Nowhere', 'First Elsewhere'],
    ['Know Core Team', 'Know Core Team'],
    ['Leave No Trace', 'Leave No Trace'],
    ['Consent', 'Consent'],
    ['Why Elsewhere', 'Why Elsewhere'],
    ['Background', 'Background'],
    ['Art Project', 'Art Project'],
    ['Skills', 'Skills'],
    ['Lift Kg', 'Lift Kg'],
    ['Deepest Secrets', 'Deepest Secrets'],
    ['Talents', 'Talents'],
    ['Has Ticket', 'Has Ticket'],
    ['Can Build', 'Can Build'],
    ['Has Car', 'Has Car'],
    ['Moving Car', 'Moving Car'],
    ['Other Camp', 'Other Camp'],
    ['Volunteer', 'Volunteer'],
    ['How Heard', 'How Heard'],
    ['Special Needs', 'Special Needs'],
    ['Needs Description', 'Needs Description'],
  ];

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

    // Click handlers
    document.querySelectorAll('#app-tbody tr').forEach(function(tr) {
      tr.addEventListener('click', function() {
        var row = parseInt(this.dataset.row);
        var member = allMembers.find(function(m) { return m._row === row; });
        if (member) openModal(member);
      });
    });
  }

  function openModal(m) {
    document.getElementById('modal-title').textContent = val(m, 'Name') || 'Application';
    var html = detailFields.map(function(f) {
      var v = val(m, f[0]);
      if (!v) return '';
      return '<div class="detail-row"><div class="detail-label">' + f[1] + '</div><div class="detail-value">' + v.replace(/</g, '&lt;') + '</div></div>';
    }).join('');
    document.getElementById('modal-details').innerHTML = html;
    document.getElementById('modal-status').value = val(m, 'Status') || 'Pending';
    document.getElementById('modal-msg').textContent = '';
    document.getElementById('modalOverlay').classList.add('active');

    document.getElementById('modal-save').onclick = async function() {
      var newStatus = document.getElementById('modal-status').value;
      var adminPass = prompt('Enter admin password to update status:');
      if (!adminPass) return;
      document.getElementById('modal-msg').textContent = 'Saving...';
      try {
        var res = await fetch('/api/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPass, row: m._row, status: newStatus })
        });
        if (!res.ok) {
          var err = await res.json().catch(function() { return {}; });
          throw new Error(err.error || 'Failed');
        }
        m['Status'] = newStatus;
        document.getElementById('modal-msg').textContent = 'Updated!';
        document.getElementById('modal-msg').style.color = '#4caf50';
        // Refresh stats and table
        var p = allMembers.filter(function(x) { return val(x, 'Status').toLowerCase() === 'pending'; }).length;
        var a = allMembers.filter(function(x) { return val(x, 'Status').toLowerCase() === 'approved'; }).length;
        var r = allMembers.filter(function(x) { return val(x, 'Status').toLowerCase() === 'rejected'; }).length;
        document.getElementById('stat-pending').textContent = p;
        document.getElementById('stat-approved').textContent = a;
        document.getElementById('stat-rejected').textContent = r;
        renderTable(document.getElementById('statusFilter').value);
      } catch (e) {
        document.getElementById('modal-msg').textContent = e.message;
        document.getElementById('modal-msg').style.color = '#f44336';
      }
    };
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
