(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var val = JH.val;
  var isAdmin = JH.isAdmin();
  var allMembers = members.map(function(m, i) { m._row = i + 2; return m; });
  var ALL_STATUSES = ['Pending', 'Review', 'Vibe Check', 'Team Discussion', 'On-boarding', 'Approved', 'Rejected'];
  var STATUS_IDS = { 'Pending': 'stat-pending', 'Review': 'stat-review', 'Vibe Check': 'stat-vibe-check', 'Team Discussion': 'stat-team-discussion', 'On-boarding': 'stat-on-boarding', 'Approved': 'stat-approved', 'Rejected': 'stat-rejected' };

  function normalizeStatus(s) {
    s = (s || '').toLowerCase();
    for (var i = 0; i < ALL_STATUSES.length; i++) {
      if (ALL_STATUSES[i].toLowerCase() === s) return ALL_STATUSES[i];
    }
    return 'Pending';
  }

  function refreshStats() {
    document.getElementById('stat-total').textContent = allMembers.length;
    ALL_STATUSES.forEach(function(status) {
      var count = allMembers.filter(function(x) { return normalizeStatus(val(x, 'Status')) === status; }).length;
      document.getElementById(STATUS_IDS[status]).textContent = count;
    });
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
        Telegram: val(m, 'Telegram'),
        Admin: val(m, 'Admin'),
        Nationality: val(m, 'Nationality'),
        Gender: val(m, 'Gender'),
        Age: val(m, 'Age'),
        'First Burn': val(m, 'First Burn'),
        'Has Ticket': val(m, 'Has Ticket'),
        Volunteer: val(m, 'Volunteer'),
        'Responsible HR': val(m, 'Responsible HR'),
        Status: normalizeStatus(val(m, 'Status'))
      };
    });
  }

  function StatusCellRenderer() {}
  StatusCellRenderer.prototype.init = function(params) {
    var v = normalizeStatus(params.value);
    if (isAdmin) {
      this.eGui = document.createElement('select');
      this.eGui.style.cssText = 'background:#0a0a0a;color:#e0e0e0;border:1px solid #2a2a2a;border-radius:4px;padding:2px 4px;font-size:0.8rem;cursor:pointer;width:100%;';
      var self = this;
      ALL_STATUSES.forEach(function(opt) {
        var o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (opt === v) o.selected = true;
        self.eGui.appendChild(o);
      });
      this.eGui.addEventListener('change', function() {
        updateStatus(params.data, self.eGui.value);
      });
    } else {
      this.eGui = document.createElement('span');
      this.eGui.className = 'status-' + v.toLowerCase().replace(/\s+/g, '-');
      this.eGui.textContent = v;
    }
  };
  StatusCellRenderer.prototype.getGui = function() { return this.eGui; };

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

  function InviteBtnRenderer() {}
  InviteBtnRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('span');
    if (normalizeStatus(params.data.Status) !== 'Approved') return;
    var btn = document.createElement('button');
    btn.textContent = 'Invite';
    btn.style.cssText = 'background:transparent;color:#e8a84c;border:1px solid #e8a84c;border-radius:4px;padding:2px 10px;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;';
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var member = allMembers.find(function(m) { return m._row === params.data._row; });
      if (member) sendInvite(member);
    });
    this.eGui.appendChild(btn);
  };
  InviteBtnRenderer.prototype.getGui = function() { return this.eGui; };

  // Shared invite flow — used by status change to Approved AND the Invite button.
  async function sendInvite(member) {
    var memberEmail = val(member, 'Email');
    var memberName = val(member, 'Name') || 'this member';
    if (!memberEmail) { alert('No email on file for ' + memberName); return; }
    if (!confirm('Send invite email to ' + memberName + ' at ' + memberEmail + '?')) return;
    try {
      var inviteRes = await JH.apiFetch('/api/auth', { action: 'invite', email: memberEmail });
      if (inviteRes.status === 409) {
        if (confirm(memberName + ' already has an account. Send them a password reset email instead?')) {
          var resetRes = await JH.apiFetch('/api/auth', { action: 'resend-invite', email: memberEmail });
          if (!resetRes.ok) {
            var resetErr = await resetRes.json().catch(function() { return {}; });
            if (confirm('Resend failed: ' + (resetErr.error || 'Unknown error') + '\n\nGenerate a one-time recovery link instead?')) {
              await offerManualLink(memberEmail, memberName, 'recovery');
            }
          }
        }
      } else if (!inviteRes.ok) {
        var inviteErr = await inviteRes.json().catch(function() { return {}; });
        if (confirm('Invite email failed: ' + (inviteErr.error || 'Unknown error') + '\n\nGenerate a one-time invite link you can send manually?')) {
          await offerManualLink(memberEmail, memberName, 'invite');
        }
      } else {
        alert('Invite email sent to ' + memberEmail);
      }
    } catch (inviteEx) {
      alert('Failed to send invite: ' + inviteEx.message);
    }
  }

  async function offerManualLink(email, name, type) {
    var linkRes = await JH.apiFetch('/api/auth', { action: 'generate-link', email: email, type: type });
    var linkData = await linkRes.json().catch(function() { return {}; });
    if (linkRes.ok && linkData.link) {
      try { await navigator.clipboard.writeText(linkData.link); } catch (e) {}
      prompt('Link (copied to clipboard) — send to ' + name + ':', linkData.link);
    } else {
      alert('Could not generate link: ' + (linkData.error || 'Unknown error'));
    }
  }

  var columnDefs = [
    { headerName: '', field: '_view', cellRenderer: ViewBtnRenderer, valueGetter: function() { return ''; }, width: 70, maxWidth: 70, sortable: false, filter: false, resizable: false, suppressSizeToFit: true },
    { headerName: '', field: '_invite', cellRenderer: InviteBtnRenderer, valueGetter: function() { return ''; }, width: 80, maxWidth: 80, sortable: false, filter: false, resizable: false, suppressSizeToFit: true, hide: !isAdmin },
    { field: 'Name', sortable: true, filter: true },
    { field: 'Playa Name', sortable: true, filter: true },
    { field: 'Location', sortable: true, filter: true },
    { field: 'Email', sortable: true, filter: true, hide: true },
    { field: 'Phone', sortable: true, filter: true, cellRenderer: JH.PhoneCellRenderer },
    { field: 'Admin', sortable: true, filter: true, hide: true },
    { field: 'Nationality', sortable: true, filter: true, hide: true },
    { field: 'Gender', sortable: true, filter: true, hide: true },
    { field: 'Age', sortable: true, filter: true, hide: true },
    { field: 'First Burn', sortable: true, filter: true, hide: true },
    { field: 'Has Ticket', sortable: true, filter: true, hide: true },
    { field: 'Volunteer', sortable: true, filter: true, hide: true },
    { field: 'Responsible HR', sortable: true, filter: true, editable: isAdmin },
    { field: 'Status', sortable: true, filter: true, cellRenderer: StatusCellRenderer }
  ];

  var gridOptions = {
    columnDefs: columnDefs,
    rowData: getRowData(),
    defaultColDef: { resizable: !JH.isMobile, flex: 1, minWidth: 100, suppressMovable: JH.isMobile },
    pagination: true,
    paginationPageSize: JH.isMobile ? 15 : 25,
    suppressCellFocus: true,
    onModelUpdated: function() {
      var count = gridApi ? gridApi.getDisplayedRowCount() : 0;
      document.getElementById('filter-count').textContent = count + ' applications';
    },
    onCellValueChanged: function(event) {
      if (event.colDef.field === 'Responsible HR') {
        var member = allMembers.find(function(m) { return m._row === event.data._row; });
        if (!member) return;
        var updates = {};
        updates['Responsible HR'] = event.newValue || '';
        JH.apiFetch('/api/members', { action: 'update', row: event.data._row, updates: updates }).then(function(res) {
          if (res.ok) member['Responsible HR'] = event.newValue || '';
        });
      }
    }
  };

  // Mobile: fewer columns, Name as link, Phone as icons only
  JH.mobileColumns(columnDefs, ['Name', 'Phone', 'Status']);
  if (JH.isMobile) {
    var nameCol = columnDefs.find(function(c) { return c.field === 'Name'; });
    if (nameCol) nameCol.cellRenderer = JH.NameLinkRenderer;
    var phoneCol = columnDefs.find(function(c) { return c.field === 'Phone'; });
    if (phoneCol) JH.mobilePhoneColumn(phoneCol);
  }

  var gridDiv = document.getElementById('app-grid');
  var gridApi = agGrid.createGrid(gridDiv, gridOptions);

  // Mobile: tap row to open detail modal
  if (JH.isMobile) {
    gridApi.addEventListener('rowClicked', function(event) {
      var member = allMembers.find(function(m) { return m._row === event.data._row; });
      if (member) openModal(member);
    });
  }

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
    var oldStatus = val(member, 'Status') || '';
    var memberName = val(member, 'Name') || 'this member';

    // Demoting away from Approved revokes portal access — confirm first.
    if (normalizeStatus(oldStatus) === 'Approved' && normalizeStatus(newStatus) !== 'Approved') {
      var ok = confirm(
        'Changing ' + memberName + ' from Approved to "' + newStatus + '" will revoke their access to the portal.\n\n' +
        'Their Supabase account will remain (so re-approving later restores access without a new invite), but they will be locked out until then.\n\n' +
        'Continue?'
      );
      if (!ok) {
        gridApi.setGridOption('rowData', getRowData());
        return;
      }
    }

    try {
      var res = await JH.apiFetch('/api/members', { action: 'update-status', row: data._row, status: newStatus });
      if (!res.ok) throw new Error('Failed');
      member['Status'] = newStatus;
      refreshStats();

      // Refresh the row so the Invite button appears for the new Approved status
      gridApi.setGridOption('rowData', getRowData());

      if (newStatus === 'Approved') {
        await sendInvite(member);
      }

    } catch (err) {
      // revert on failure
      gridApi.setGridOption('rowData', getRowData());
    }
  }

  // Modal — keys that should not be editable
  var readonlyKeys = ['_row', 'Timestamp', '', 'Admin'];

  function openModal(m) {
    document.getElementById('modal-title').textContent = val(m, 'Name') || 'Application';
    var skipKeys = ['_row', '_date'];
    var html = Object.keys(m).filter(function(k) {
      return skipKeys.indexOf(k) === -1;
    }).map(function(k) {
      var v = val(m, k);
      var escaped = v ? v.replace(/</g, '&lt;') : '';
      var links = (k === 'Phone') ? JH.contactLinks(v, val(m, 'Telegram')) : '';
      // Timestamp: human-friendly
      if (k === 'Timestamp' || k === '') {
        var display = '<span style="color:#555;">—</span>';
        if (v) {
          var d = new Date(v);
          display = isNaN(d.getTime()) ? escaped : d.toLocaleString('en-GB', { hour12: false });
        }
        return '<div class="detail-row"><div class="detail-label">Submitted</div><div class="detail-value">' + display + '</div></div>';
      }
      // Status: dropdown
      if (k === 'Status' && isAdmin) {
        var s = normalizeStatus(v);
        var sel = '<select class="field-input" data-key="Status">';
        ALL_STATUSES.forEach(function(opt) {
          sel += '<option value="' + opt + '"' + (opt === s ? ' selected' : '') + '>' + opt + '</option>';
        });
        sel += '</select>';
        return '<div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">' + sel + '</div></div>';
      }
      // Read-only fields
      if (!isAdmin || readonlyKeys.indexOf(k) !== -1) {
        var display = escaped || '<span style="color:#555;">—</span>';
        return '<div class="detail-row"><div class="detail-label">' + k + '</div><div class="detail-value">' + display + links + '</div></div>';
      }
      // Long text: textarea
      if (v.length > 60) {
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
          var res = await JH.apiFetch('/api/members', { action: 'update', row: m._row, updates: updates });
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
