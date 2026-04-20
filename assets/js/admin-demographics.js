(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var val = JH.val;
  members.forEach(function(m, i) { m._row = i + 2; });
  members = members.filter(function(m) { return val(m, 'Status').toLowerCase() === 'approved'; });

  // Stats
  document.getElementById('stat-total').textContent = members.length;
  var ages = members.map(function(m) { return parseInt(val(m, 'Age')); }).filter(function(a) { return !isNaN(a); });
  document.getElementById('stat-avg-age').textContent = ages.length ? Math.round(ages.reduce(function(a, b) { return a + b; }, 0) / ages.length) : '-';
  document.getElementById('stat-age-range').textContent = ages.length ? Math.min.apply(null, ages) + ' - ' + Math.max.apply(null, ages) : '-';

  var virgins = members.filter(function(m) { return val(m, 'First Burn').toLowerCase() === 'yes'; }).length;
  document.getElementById('stat-virgins').textContent = virgins + ' / ' + members.length;

  var nationalities = {};
  members.forEach(function(m) { var v = val(m, 'Nationality'); if (v) nationalities[v] = true; });
  document.getElementById('stat-countries').textContent = Object.keys(nationalities).length;

  // Age chart — bar
  var ageBuckets = { '18-25': 0, '26-35': 0, '36-45': 0, '46-55': 0, '56+': 0 };
  members.forEach(function(m) {
    var age = parseInt(val(m, 'Age'));
    if (isNaN(age)) return;
    if (age <= 25) ageBuckets['18-25']++;
    else if (age <= 35) ageBuckets['26-35']++;
    else if (age <= 45) ageBuckets['36-45']++;
    else if (age <= 55) ageBuckets['46-55']++;
    else ageBuckets['56+']++;
  });
  JH.makeBar('age-chart', Object.keys(ageBuckets), Object.values(ageBuckets));

  // Gender — doughnut
  var genderCounts = {};
  members.forEach(function(m) { var v = val(m, 'Gender') || 'Not specified'; genderCounts[v] = (genderCounts[v] || 0) + 1; });
  var genderColors = { 'Male': '#4fc3f7', 'Female': '#f06292', 'Non-binary': '#ab47bc', 'Prefer not to say': '#78909c', 'Not specified': '#78909c' };
  var gLabels = Object.keys(genderCounts);
  new Chart(document.getElementById('gender-chart'), {
    type: 'doughnut',
    data: { labels: gLabels, datasets: [{ data: Object.values(genderCounts), backgroundColor: gLabels.map(function(l) { return genderColors[l] || '#e8a84c'; }), borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: { legend: { position: 'bottom', labels: { color: '#e8e4df', padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } } }
    }
  });

  // Burn experience — grouped horizontal bar (Any Burn vs This Event)
  var burnYes = 0, burnNo = 0, elseYes = 0, elseNo = 0;
  members.forEach(function(m) {
    var fb = val(m, 'First Burn').toLowerCase();
    var fe = val(m, 'First Elsewhere/Nowhere').toLowerCase();
    if (fb === 'yes') burnYes++; else if (fb) burnNo++;
    if (fe && fe !== 'no') elseYes++; else if (fe) elseNo++;
  });
  new Chart(document.getElementById('burns-chart'), {
    type: 'bar',
    data: {
      labels: ['Any Burn', 'This Event'],
      datasets: [
        { label: 'First time', data: [burnYes, elseYes], backgroundColor: '#ff9800', borderRadius: 4 },
        { label: 'Returning', data: [burnNo, elseNo], backgroundColor: '#4caf50', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { labels: { color: '#e8e4df', usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } } },
      scales: {
        x: { stacked: false, ticks: { color: '#8a8580', stepSize: 1 }, grid: { color: '#2a2a2a22' }, beginAtZero: true },
        y: { ticks: { color: '#8a8580' }, grid: { display: false } }
      }
    }
  });

  // Location — horizontal bar, dynamic height
  var locCounts = {};
  members.forEach(function(m) { var v = val(m, 'Location') || 'Unknown'; locCounts[v] = (locCounts[v] || 0) + 1; });
  var locSorted = Object.entries(locCounts).sort(function(a, b) { return b[1] - a[1]; });
  var locHeight = Math.max(180, locSorted.length * 32);
  document.getElementById('location-wrap').style.height = locHeight + 'px';
  new Chart(document.getElementById('location-chart'), {
    type: 'bar',
    data: {
      labels: locSorted.map(function(d) { return d[0]; }),
      datasets: [{ data: locSorted.map(function(d) { return d[1]; }), backgroundColor: '#e8a84c', borderRadius: 4, maxBarThickness: 24 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8a8580', stepSize: 1 }, grid: { color: '#2a2a2a22' }, beginAtZero: true },
        y: { ticks: { color: '#e0e0e0', font: { size: 12 } }, grid: { display: false } }
      }
    }
  });

  // Member profile panel
  var memberOverlay = document.getElementById('member-overlay');
  var memberPanel = document.getElementById('member-panel');
  var memberPanelTitle = document.getElementById('member-panel-title');
  var memberPanelBody = document.getElementById('member-panel-body');

  var esc = JH.esc;

  function openMemberPanel(m) {
    memberPanelTitle.textContent = val(m, 'Playa Name') || val(m, 'Name') || 'Member';
    var fields = [
      ['Real Name', val(m, 'Name')],
      ['Age', val(m, 'Age')],
      ['Gender', val(m, 'Gender')],
      ['Nationality', val(m, 'Nationality')],
      ['Location', val(m, 'Location')],
      ['Role', val(m, 'Role')],
      ['Phone', val(m, 'Phone')],
      ['Email', val(m, 'Email')],
      ['Admin', val(m, 'Admin')],
      ['First Burn', val(m, 'First Burn')],
      ['First Elsewhere', val(m, 'First Elsewhere/Nowhere')],
      ['Has Ticket', val(m, 'Has Ticket')],
      ['Volunteer', val(m, 'Volunteer')]
    ];
    memberPanelBody.innerHTML = fields.filter(function(f) { return f[1]; }).map(function(f) {
      return '<div class="member-field"><span class="member-field-label">' + esc(f[0]) + '</span><span class="member-field-value">' + esc(f[1]) + '</span></div>';
    }).join('');
    memberOverlay.classList.add('active');
    memberPanel.classList.add('active');
  }

  function closeMemberPanel() {
    memberOverlay.classList.remove('active');
    memberPanel.classList.remove('active');
  }

  document.getElementById('member-panel-close').addEventListener('click', closeMemberPanel);
  memberOverlay.addEventListener('click', closeMemberPanel);

  function NameCellRenderer() {}
  NameCellRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('a');
    this.eGui.className = 'name-link';
    this.eGui.textContent = params.value || '';
    this.eGui.href = '#';
    var memberData = params.data._member;
    this.eGui.addEventListener('click', function(e) {
      e.preventDefault();
      openMemberPanel(memberData);
    });
  };
  NameCellRenderer.prototype.getGui = function() { return this.eGui; };

  // Admin checkbox renderer
  function AdminCellRenderer() {}
  AdminCellRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('input');
    this.eGui.type = 'checkbox';
    this.eGui.checked = (params.value || '').toLowerCase() === 'yes';
    this.eGui.style.accentColor = 'var(--accent, #e8a84c)';
    this.eGui.style.width = '16px';
    this.eGui.style.height = '16px';
    this.eGui.style.cursor = 'pointer';
    var row = params.data._member._row;
    var self = this;
    this.eGui.addEventListener('change', async function() {
      var newVal = self.eGui.checked ? 'Yes' : '';
      try {
        var res = await JH.apiFetch('/api/members', { action: 'update', row: row, updates: { Admin: newVal } });
        if (!res.ok) throw new Error('Failed');
        params.data.Admin = newVal;
        params.data._member['Admin'] = newVal;
      } catch (e) {
        self.eGui.checked = !self.eGui.checked;
        alert('Failed to update admin status');
      }
    });
  };
  AdminCellRenderer.prototype.getGui = function() { return this.eGui; };

  // Delete button renderer (admin only)
  function DeleteCellRenderer() {}
  DeleteCellRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('button');
    this.eGui.innerHTML = '&#128465;';
    this.eGui.title = 'Remove member';
    this.eGui.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1rem;opacity:0.4;padding:4px;transition:opacity 0.15s;';
    this.eGui.addEventListener('mouseenter', function() { this.style.opacity = '1'; });
    this.eGui.addEventListener('mouseleave', function() { this.style.opacity = '0.4'; });
    var memberData = params.data._member;
    this.eGui.addEventListener('click', async function(e) {
      e.stopPropagation();
      var name = JH.val(memberData, 'Playa Name') || JH.val(memberData, 'Name');
      if (!confirm('Remove ' + name + ' from the barrio? This deletes their member record and Supabase account.')) return;
      try {
        var email = JH.val(memberData, 'Email');
        if (!email) { alert('Member has no email'); return; }
        // Delete from sheet
        var res = await JH.apiFetch('/api/members', { action: 'delete', email: email });
        if (!res.ok) throw new Error('Failed to delete member');
        // Delete Supabase account (best effort)
        if (email) {
          try { await JH.apiFetch('/api/auth', { action: 'delete-user', email: email }); } catch (e) {}
        }
        window.location.reload();
      } catch (err) {
        alert('Delete failed: ' + err.message);
      }
    });
  };
  DeleteCellRenderer.prototype.getGui = function() { return this.eGui; };

  // Roster table
  var rosterCols = [
    { field: 'Playa Name', sortable: true, filter: true, cellRenderer: NameCellRenderer },
    { field: 'Role', sortable: true, filter: true },
    { field: 'Phone', sortable: true, filter: true, cellRenderer: JH.PhoneCellRenderer }
  ];
  if (JH.isAdmin()) {
    rosterCols.push({ field: 'Admin', headerName: 'Admin', sortable: true, filter: true, cellRenderer: AdminCellRenderer, maxWidth: 90 });
    rosterCols.push({ headerName: '', cellRenderer: DeleteCellRenderer, maxWidth: 50, sortable: false, filter: false, suppressSizeToFit: true });
  }
  if (JH.isMobile) {
    var phoneCol = rosterCols.find(function(c) { return c.field === 'Phone'; });
    if (phoneCol) JH.mobilePhoneColumn(phoneCol);
  }
  var rosterGrid = agGrid.createGrid(document.getElementById('roster-grid'), {
    rowData: members.map(function(m) {
      return { 'Playa Name': val(m, 'Playa Name'), Role: val(m, 'Role'), Phone: val(m, 'Phone'), Telegram: val(m, 'Telegram'), Admin: val(m, 'Admin'), _member: m };
    }),
    columnDefs: rosterCols,
    defaultColDef: { resizable: true, flex: 1, minWidth: 100 },
    pagination: true,
    paginationPageSize: 25,
    suppressCellFocus: true,
    onRowClicked: JH.isMobile ? function(event) {
      if (event.data._member) openMemberPanel(event.data._member);
    } : undefined
  });
})();
