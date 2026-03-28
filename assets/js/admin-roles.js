(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');
  var state = { roles: [] };
  var approvedMembers = members.filter(function (m) {
    return (m['Status'] || '').toLowerCase() === 'approved';
  }).map(function (m) {
    return m['Playa Name'] || m['Name'] || '';
  }).filter(Boolean).sort();

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusClass(status) {
    var s = (status || '').toLowerCase();
    if (s === 'filled') return 'status-filled';
    if (s === 'needs-backup') return 'status-needs-backup';
    return 'status-open';
  }

  function statusLabel(status) {
    var s = (status || '').toLowerCase();
    if (s === 'filled') return 'Filled';
    if (s === 'needs-backup') return 'Needs Backup';
    return 'Open';
  }

  function statusOrder(status) {
    var s = (status || '').toLowerCase();
    if (s === 'open') return 0;
    if (s === 'filled') return 1;
    if (s === 'needs-backup') return 2;
    return 3;
  }

  function sortRoles(roles) {
    return roles.slice().sort(function (a, b) {
      var oa = statusOrder(a.Status);
      var ob = statusOrder(b.Status);
      if (oa !== ob) return oa - ob;
      return (a.Name || '').toLowerCase() < (b.Name || '').toLowerCase() ? -1 : 1;
    });
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    if (!res.ok) { console.error('roles fetch failed'); return; }
    var data = await res.json();
    state.roles = data.roles || [];
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  function renderSummary() {
    var total = state.roles.length;
    var filled = state.roles.filter(function (r) { return (r.Status || '').toLowerCase() === 'filled'; }).length;
    var open = state.roles.filter(function (r) { return (r.Status || '').toLowerCase() === 'open' || !r.Status; }).length;
    var el = document.getElementById('roles-summary');
    el.innerHTML = '<strong>' + total + '</strong> roles total &middot; <strong>' + filled + '</strong> filled &middot; <strong>' + open + '</strong> open';
  }

  // ── Render role cards ──────────────────────────────────────────────────

  function renderRoles() {
    var wrap = document.getElementById('roles-wrap');
    var sorted = sortRoles(state.roles);

    if (!sorted.length) {
      wrap.innerHTML = '<div class="empty-state">' +
        'No roles yet.' +
        (isAdmin ? ' Use "+ Add Role" to get started.' : ' Check back later.') +
        '</div>';
      return;
    }

    var html = '';
    sorted.forEach(function (role) {
      var sClass = statusClass(role.Status);
      var assigned = (role.AssignedTo || '').trim();

      html += '<div class="role-card">';
      html += '<div class="role-card-header">';
      html += '<h3 class="role-card-title">' + esc(role.Name) + '</h3>';
      html += '<span class="status-badge ' + sClass + '">' + esc(statusLabel(role.Status)) + '</span>';
      html += '</div>';

      if (role.Description) {
        html += '<div class="role-card-desc">' + esc(role.Description) + '</div>';
      }

      if (assigned) {
        var people = assigned.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        html += '<div class="role-card-assigned filled">' + people.map(function (p) {
          return '<span class="assigned-chip">' + esc(p) + '</span>';
        }).join(' ') + '</div>';
      } else {
        html += '<div class="role-card-assigned unassigned">Unassigned</div>';
      }

      if (role.Notes) {
        html += '<div class="role-card-notes">' + esc(role.Notes) + '</div>';
      }

      if (isAdmin) {
        html += '<div class="role-card-footer">';
        html += '<div class="role-card-actions">';
        html += '<button class="btn-secondary btn-sm edit-role-btn" data-name="' + esc(role.Name) + '">Edit</button>';
        html += '<button class="btn-danger btn-sm delete-role-btn" data-name="' + esc(role.Name) + '">Delete</button>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>';
    });

    wrap.innerHTML = html;
    bindCardEvents();
  }

  function bindCardEvents() {
    if (!isAdmin) return;

    document.querySelectorAll('.edit-role-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var role = state.roles.find(function (r) { return r.Name === btn.dataset.name; });
        if (role) openModal(role);
      });
    });

    document.querySelectorAll('.delete-role-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var role = state.roles.find(function (r) { return r.Name === btn.dataset.name; });
        if (!role) return;
        if (!confirm('Delete "' + role.Name + '"? This cannot be undone.')) return;
        var r = await fetch('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete', name: role.Name }),
        });
        if (!r.ok) { alert('Delete failed. Please try again.'); return; }
        await reload();
      });
    });
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  var modal = document.getElementById('role-modal');
  var editingName = null;

  function openModal(role) {
    editingName = role ? role.Name : null;
    document.getElementById('modal-title').innerHTML = (role ? 'Edit Role' : 'Add Role') +
      ' <button class="modal-close" id="modal-close-x">&times;</button>';
    document.getElementById('modal-close-x').addEventListener('click', closeModal);

    document.getElementById('field-name').value = role ? role.Name : '';
    document.getElementById('field-description').value = role ? role.Description : '';
    var sel = document.getElementById('field-assignedTo');
    sel.innerHTML = '';
    var currentAssigned = role ? (role.AssignedTo || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    approvedMembers.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (currentAssigned.indexOf(name) !== -1) opt.selected = true;
      sel.appendChild(opt);
    });
    document.getElementById('field-status').value = role ? (role.Status || 'open') : 'open';
    document.getElementById('field-notes').value = role ? role.Notes : '';

    modal.classList.add('active');
    document.getElementById('field-name').focus();
  }

  function closeModal() {
    modal.classList.remove('active');
    editingName = null;
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function saveRole() {
    var name = document.getElementById('field-name').value.trim();
    if (!name) { alert('Name is required.'); return; }

    var btn = document.getElementById('modal-save-btn');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    var r = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass,
        action: 'upsert',
        name: name,
        originalName: editingName,
        description: document.getElementById('field-description').value,
        assignedTo: Array.from(document.getElementById('field-assignedTo').selectedOptions).map(function (o) { return o.value; }).join(', '),
        status: document.getElementById('field-status').value,
        notes: document.getElementById('field-notes').value,
      }),
    });

    btn.textContent = 'Save Role';
    btn.disabled = false;

    if (!r.ok) { var d = await r.json().catch(function () { return {}; }); alert(d.error || 'Save failed.'); return; }
    closeModal();
    await reload();
  }

  // ── Reload ────────────────────────────────────────────────────────────────

  async function reload() {
    await fetchData();
    renderSummary();
    renderRoles();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  if (isAdmin) document.getElementById('add-role-btn').style.display = '';

  document.getElementById('add-role-btn').addEventListener('click', function () {
    openModal(null);
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);

  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  document.getElementById('modal-save-btn').addEventListener('click', saveRole);

  await reload();

})();
