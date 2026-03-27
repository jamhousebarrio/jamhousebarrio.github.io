(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');
  var approvedMembers = members.filter(function (m) {
    return (m['Status'] || '').toLowerCase() === 'approved';
  });

  var state = { shifts: [], slots: [], assignments: [], memberMeta: [], myName: null };

  // ── Name selector ─────────────────────────────────────────────────────────

  state.myName = sessionStorage.getItem('jh_member_name');

  var nameModal = document.getElementById('name-modal');
  var nameSelect = document.getElementById('name-select');
  var nameConfirmBtn = document.getElementById('name-confirm-btn');

  if (state.myName) {
    nameModal.classList.remove('active');
  } else {
    approvedMembers.forEach(function (m) {
      var name = m['Playa Name'] || m['Name'] || '';
      if (!name) return;
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      nameSelect.appendChild(opt);
    });
    nameModal.classList.add('active');
  }

  nameConfirmBtn.addEventListener('click', function () {
    var val = nameSelect.value;
    if (!val) return;
    state.myName = val;
    sessionStorage.setItem('jh_member_name', val);
    nameModal.classList.remove('active');
    render();
  });

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    if (!res.ok) { console.error('shifts fetch failed'); return; }
    var data = await res.json();
    state.shifts = data.shifts || [];
    state.slots = data.slots || [];
    state.assignments = data.assignments || [];
    state.memberMeta = data.memberMeta || [];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sortedSlots() {
    return state.slots.slice().sort(function (a, b) {
      var da = (a.Date || '') + (a.StartTime || 'z');
      var db = (b.Date || '') + (b.StartTime || 'z');
      return da < db ? -1 : da > db ? 1 : 0;
    });
  }

  // ── Grid rendering ────────────────────────────────────────────────────────

  function renderGrid() {
    var slots = sortedSlots();
    var wrap = document.getElementById('shifts-grid-wrap');

    if (!state.shifts.length || !slots.length) {
      wrap.innerHTML = '<div class="empty-state">No shifts configured yet.' +
        (isAdmin ? ' Use "Manage Shifts" and "Configure Slots" to get started.' : ' Check back later.') + '</div>';
      return;
    }

    var html = '<div style="overflow-x:auto"><table class="shifts-table"><thead><tr>';
    html += '<th class="shift-name-col">Shift</th>';
    slots.forEach(function (slot) { html += '<th>' + esc(slot.Label) + '</th>'; });
    html += '</tr></thead><tbody>';

    state.shifts.forEach(function (shift) {
      html += '<tr><td class="shift-name-col"><a class="shift-name-link" data-shift-id="' + esc(shift.ShiftID) + '">' + esc(shift.Name) + '</a>';
      if (shift.Description) html += '<div class="shift-desc">' + esc(shift.Description) + '</div>';
      html += '</td>';

      slots.forEach(function (slot) {
        html += '<td class="slot-cell" data-shift-id="' + esc(shift.ShiftID) + '" data-slot-id="' + esc(slot.SlotID) + '">';

        var cellAssignments = state.assignments.filter(function (a) {
          return a.ShiftID === shift.ShiftID && a.SlotID === slot.SlotID;
        });

        cellAssignments.forEach(function (a) {
          var cls = 'chip chip-' + (a.Status || 'requested');
          var isMine = state.myName && a.MemberName === state.myName;
          if (isMine) cls += ' my-chip';
          html += '<span class="' + cls + '" data-assignment-id="' + esc(a.AssignmentID) + '" data-status="' + esc(a.Status) + '" data-member="' + esc(a.MemberName) + '">' + esc(a.MemberName) + '</span>';
        });

        // Request button: show unless current member already has a non-bailed assignment in this cell
        if (state.myName) {
          var alreadyMine = cellAssignments.some(function (a) { return a.MemberName === state.myName && a.Status !== 'bailed'; });
          if (!alreadyMine) {
            html += '<button class="request-btn" data-shift-id="' + esc(shift.ShiftID) + '" data-slot-id="' + esc(slot.SlotID) + '">+</button>';
          }
        }

        if (isAdmin) {
          html += '<button class="add-btn" data-shift-id="' + esc(shift.ShiftID) + '" data-slot-id="' + esc(slot.SlotID) + '" title="Add assignment">&#10010;</button>';
        }

        html += '</td>';
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;
    bindGridEvents();
  }

  // ── Summary panel rendering ───────────────────────────────────────────────

  function renderSummary() {
    var wrap = document.getElementById('summary-wrap');
    var confirmedCounts = {};
    state.assignments.forEach(function (a) {
      if (a.Status === 'confirmed') confirmedCounts[a.MemberName] = (confirmedCounts[a.MemberName] || 0) + 1;
    });
    var bailedSet = {};
    state.assignments.forEach(function (a) { if (a.Status === 'bailed') bailedSet[a.MemberName] = true; });

    if (!state.memberMeta.length) {
      wrap.innerHTML = '<div class="empty-state">No member data yet.</div>';
      return;
    }

    var html = '<table class="data-table" style="font-size:0.82rem">';
    html += '<thead><tr><th>Member</th><th>Shifts</th><th>Other</th></tr></thead><tbody>';

    state.memberMeta.forEach(function (m) {
      var count = confirmedCounts[m.MemberName] || 0;
      var warn = count === 0 || bailedSet[m.MemberName];
      html += '<tr' + (warn ? ' class="summary-warn"' : '') + '>';
      html += '<td class="name">' + esc(m.MemberName) + '</td>';
      html += '<td>' + count + '</td>';
      html += '<td>';
      if (isAdmin) {
        html += '<span class="resp-text" data-member="' + esc(m.MemberName) + '">' + esc(m.OtherResponsibilities) + '</span>';
      } else {
        html += esc(m.OtherResponsibilities);
      }
      html += '</td></tr>';
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
    if (isAdmin) bindSummaryEditEvents();
  }

  // ── KB panel ──────────────────────────────────────────────────────────────

  var currentKBShift = null;

  function openKB(shift) {
    currentKBShift = shift;
    document.getElementById('kb-title').textContent = shift.Name;
    document.getElementById('kb-meta').textContent = shift.TimeExpectation ? 'Time: ' + shift.TimeExpectation : '';
    document.getElementById('kb-text').textContent = shift.KBText || '';

    var linksEl = document.getElementById('kb-links');
    linksEl.innerHTML = '';
    if (shift.KBLinks) {
      shift.KBLinks.split('\n').forEach(function (line) {
        line = line.trim();
        if (!line) return;
        var parts = line.split('|');
        if (parts.length >= 2) {
          var a = document.createElement('a');
          a.href = parts.slice(1).join('|');
          a.textContent = parts[0];
          a.target = '_blank';
          linksEl.appendChild(a);
        }
      });
    }

    if (isAdmin) {
      document.getElementById('kb-edit-text').value = shift.KBText || '';
      document.getElementById('kb-edit-links').value = shift.KBLinks || '';
      document.getElementById('kb-edit-area').style.display = '';
    }

    document.getElementById('kb-panel').classList.add('active');
    document.getElementById('kb-overlay').classList.add('active');
  }

  function closeKB() {
    document.getElementById('kb-panel').classList.remove('active');
    document.getElementById('kb-overlay').classList.remove('active');
  }

  document.getElementById('kb-close').addEventListener('click', closeKB);
  document.getElementById('kb-overlay').addEventListener('click', closeKB);

  // ── Render coordinator ────────────────────────────────────────────────────

  async function render() {
    await fetchData();
    renderGrid();
    renderSummary();
    if (isAdmin) document.getElementById('admin-controls').style.display = '';
  }

  // ── Grid event bindings ───────────────────────────────────────────────────

  function bindGridEvents() {
    document.querySelectorAll('.shift-name-link').forEach(function (el) {
      el.addEventListener('click', function () {
        var shift = state.shifts.find(function (s) { return s.ShiftID === el.dataset.shiftId; });
        if (shift) openKB(shift);
      });
    });

    document.querySelectorAll('.request-btn').forEach(function (el) {
      el.addEventListener('click', function () {
        doMemberAction('request', el.dataset.shiftId, el.dataset.slotId, null);
      });
    });

    document.querySelectorAll('.chip.my-chip').forEach(function (el) {
      el.addEventListener('click', function () {
        var status = el.dataset.status;
        var aId = el.dataset.assignmentId;
        var action = status === 'requested' ? 'cancel' : status === 'confirmed' ? 'bail' : null;
        if (!action) return;
        var msg = action === 'cancel' ? 'Cancel your request for this shift?' : 'Bail on this shift? The slot will reopen for others.';
        if (!confirm(msg)) return;
        doMemberAction(action, null, null, aId);
      });
    });

    if (isAdmin) {
      document.querySelectorAll('.chip').forEach(function (el) {
        el.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          showChipMenu(e.clientX, e.clientY, el.dataset.assignmentId, el.dataset.status);
        });
      });

      document.querySelectorAll('.add-btn').forEach(function (el) {
        el.addEventListener('click', function () {
          showAddModal(el.dataset.shiftId, el.dataset.slotId);
        });
      });
    }
  }

  // ── Member actions ────────────────────────────────────────────────────────

  async function doMemberAction(action, shiftId, slotId, assignmentId) {
    var body = { password: pass, action: action, memberName: state.myName };
    if (shiftId) body.shiftId = shiftId;
    if (slotId) body.slotId = slotId;
    if (assignmentId) body.assignmentId = assignmentId;

    var res = await fetch('/api/shifts-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) { alert('You are already signed up for this slot. Refreshing...'); }
    else if (!res.ok) { var d = await res.json().catch(function () { return {}; }); alert(d.error || 'Something went wrong.'); }
    render();
  }

  // ── Summary edit (admin) ──────────────────────────────────────────────────

  function bindSummaryEditEvents() {
    document.querySelectorAll('.resp-text').forEach(function (el) {
      el.addEventListener('click', function () {
        var memberName = el.dataset.member;
        var input = document.createElement('input');
        input.className = 'resp-input';
        input.value = el.textContent;
        el.replaceWith(input);
        input.focus();
        input.select();

        async function save() {
          var val = input.value;
          var span = document.createElement('span');
          span.className = 'resp-text';
          span.dataset.member = memberName;
          span.textContent = val;
          input.replaceWith(span);
          bindSummaryEditEvents();
          await fetch('/api/shifts-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass, action: 'update-member-meta', memberName: memberName, otherResponsibilities: val }),
          });
          var meta = state.memberMeta.find(function (m) { return m.MemberName === memberName; });
          if (meta) meta.OtherResponsibilities = val;
        }

        input.addEventListener('blur', save);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
      });
    });
  }

  // ── KB save (admin) ───────────────────────────────────────────────────────

  if (isAdmin) document.getElementById('kb-save-btn').addEventListener('click', async function () {
    if (!currentKBShift) return;
    var kbText = document.getElementById('kb-edit-text').value;
    var kbLinks = document.getElementById('kb-edit-links').value;
    var btn = this;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass,
        action: 'upsert-shift',
        shiftId: currentKBShift.ShiftID,
        name: currentKBShift.Name,
        description: currentKBShift.Description,
        timeExpectation: currentKBShift.TimeExpectation,
        kbText: kbText,
        kbLinks: kbLinks,
      }),
    });
    currentKBShift.KBText = kbText;
    currentKBShift.KBLinks = kbLinks;
    document.getElementById('kb-text').textContent = kbText;
    btn.textContent = 'Saved';
    setTimeout(function () { btn.textContent = 'Save'; btn.disabled = false; }, 1500);
  });

  // ── Admin: chip context menu ──────────────────────────────────────────────

  var chipMenu = document.getElementById('chip-menu');
  var activeChipId = null;

  function showChipMenu(x, y, assignmentId, status) {
    activeChipId = assignmentId;
    chipMenu.style.left = x + 'px';
    chipMenu.style.top = y + 'px';
    chipMenu.style.display = '';
    document.getElementById('chip-confirm-btn').style.display = status === 'confirmed' ? 'none' : '';
  }

  document.addEventListener('click', function (e) {
    if (!chipMenu.contains(e.target)) chipMenu.style.display = 'none';
  });

  document.getElementById('chip-confirm-btn').addEventListener('click', async function () {
    chipMenu.style.display = 'none';
    if (!activeChipId) return;
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, action: 'confirm-assignment', assignmentId: activeChipId }),
    });
    render();
  });

  document.getElementById('chip-remove-btn').addEventListener('click', async function () {
    chipMenu.style.display = 'none';
    if (!activeChipId) return;
    if (!confirm('Remove this assignment?')) return;
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, action: 'remove-assignment', assignmentId: activeChipId }),
    });
    render();
  });

  // ── Admin: add assignment modal ───────────────────────────────────────────

  var addModal = document.getElementById('add-modal');
  var addModalShiftId = null;
  var addModalSlotId = null;

  function showAddModal(shiftId, slotId) {
    addModalShiftId = shiftId;
    addModalSlotId = slotId;
    var sel = document.getElementById('add-member-select');
    sel.innerHTML = '<option value="">Select member...</option>';
    approvedMembers.forEach(function (m) {
      var name = m['Playa Name'] || m['Name'] || '';
      if (!name) return;
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    addModal.classList.add('active');
  }

  document.getElementById('add-confirm-btn').addEventListener('click', async function () {
    var name = document.getElementById('add-member-select').value;
    if (!name) return;
    addModal.classList.remove('active');
    var newId = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass,
        action: 'admin-add-assignment',
        assignmentId: newId,
        slotId: addModalSlotId,
        shiftId: addModalShiftId,
        memberName: name,
      }),
    });
    render();
  });

  document.getElementById('add-cancel-btn').addEventListener('click', function () {
    addModal.classList.remove('active');
  });

  // ── Admin: Manage Shifts modal ────────────────────────────────────────────

  document.getElementById('btn-manage-shifts').addEventListener('click', function () {
    renderShiftsList();
    document.getElementById('manage-shifts-modal').classList.add('active');
  });

  function renderShiftsList() {
    var wrap = document.getElementById('shifts-list-wrap');
    if (!state.shifts.length) { wrap.innerHTML = '<div class="empty-state">No shifts yet.</div>'; return; }
    wrap.innerHTML = state.shifts.map(function (s) {
      return '<div class="shift-list-item"><span>' + esc(s.Name) + ' <small style="color:var(--text-muted)">(' + esc(s.ShiftID) + ')</small></span>' +
        '<div class="shift-list-actions">' +
        '<button class="btn-secondary edit-shift-btn" data-shift-id="' + esc(s.ShiftID) + '">Edit</button>' +
        '<button class="btn-danger delete-shift-btn" data-shift-id="' + esc(s.ShiftID) + '">Delete</button>' +
        '</div></div>';
    }).join('');

    wrap.querySelectorAll('.edit-shift-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var shift = state.shifts.find(function (s) { return s.ShiftID === btn.dataset.shiftId; });
        if (!shift) return;
        document.getElementById('sf-id').value = shift.ShiftID;
        document.getElementById('sf-id').disabled = true;
        document.getElementById('sf-name').value = shift.Name;
        document.getElementById('sf-time').value = shift.TimeExpectation;
        document.getElementById('sf-desc').value = shift.Description;
        document.getElementById('sf-kb-text').value = shift.KBText;
        document.getElementById('sf-kb-links').value = shift.KBLinks;
        document.getElementById('shift-form').style.display = '';
      });
    });

    wrap.querySelectorAll('.delete-shift-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete shift "' + btn.dataset.shiftId + '"? Existing assignments will be orphaned.')) return;
        await fetch('/api/shifts-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete-shift', shiftId: btn.dataset.shiftId }),
        });
        await render();
        renderShiftsList();
      });
    });
  }

  document.getElementById('add-shift-btn').addEventListener('click', function () {
    document.getElementById('sf-id').disabled = false;
    document.getElementById('sf-id').value = '';
    document.getElementById('sf-name').value = '';
    document.getElementById('sf-time').value = '';
    document.getElementById('sf-desc').value = '';
    document.getElementById('sf-kb-text').value = '';
    document.getElementById('sf-kb-links').value = '';
    document.getElementById('shift-form').style.display = '';
  });

  document.getElementById('sf-save-btn').addEventListener('click', async function () {
    var shiftId = document.getElementById('sf-id').value.trim();
    var name = document.getElementById('sf-name').value.trim();
    if (!shiftId || !name) { alert('ID and name are required.'); return; }
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass, action: 'upsert-shift', shiftId: shiftId, name: name,
        description: document.getElementById('sf-desc').value,
        timeExpectation: document.getElementById('sf-time').value,
        kbText: document.getElementById('sf-kb-text').value,
        kbLinks: document.getElementById('sf-kb-links').value,
      }),
    });
    document.getElementById('shift-form').style.display = 'none';
    await render();
    renderShiftsList();
  });

  document.getElementById('sf-cancel-btn').addEventListener('click', function () {
    document.getElementById('shift-form').style.display = 'none';
  });

  // ── Admin: Configure Slots modal ──────────────────────────────────────────

  document.getElementById('btn-manage-slots').addEventListener('click', function () {
    renderSlotsList();
    document.getElementById('manage-slots-modal').classList.add('active');
  });

  function renderSlotsList() {
    var wrap = document.getElementById('slots-list-wrap');
    var slots = sortedSlots();
    if (!slots.length) { wrap.innerHTML = '<div class="empty-state">No slots yet.</div>'; return; }
    wrap.innerHTML = slots.map(function (s) {
      var timeStr = s.StartTime ? ' ' + s.StartTime + (s.EndTime ? '–' + s.EndTime : '') : '';
      return '<div class="slot-list-item"><span>' + esc(s.Label) + timeStr + ' <small style="color:var(--text-muted)">(' + esc(s.SlotID) + ')</small></span>' +
        '<div class="shift-list-actions">' +
        '<button class="btn-secondary edit-slot-btn" data-slot-id="' + esc(s.SlotID) + '">Edit</button>' +
        '<button class="btn-danger delete-slot-btn" data-slot-id="' + esc(s.SlotID) + '">Delete</button>' +
        '</div></div>';
    }).join('');

    wrap.querySelectorAll('.edit-slot-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var slot = state.slots.find(function (s) { return s.SlotID === btn.dataset.slotId; });
        if (!slot) return;
        document.getElementById('sl-id').value = slot.SlotID;
        document.getElementById('sl-id').disabled = true;
        document.getElementById('sl-label').value = slot.Label;
        document.getElementById('sl-date').value = slot.Date;
        document.getElementById('sl-start').value = slot.StartTime;
        document.getElementById('sl-end').value = slot.EndTime;
        document.getElementById('slot-form').style.display = '';
      });
    });

    wrap.querySelectorAll('.delete-slot-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete slot "' + btn.dataset.slotId + '"? Existing assignments will be orphaned.')) return;
        await fetch('/api/shifts-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete-slot', slotId: btn.dataset.slotId }),
        });
        await render();
        renderSlotsList();
      });
    });
  }

  document.getElementById('add-slot-btn').addEventListener('click', function () {
    document.getElementById('sl-id').disabled = false;
    document.getElementById('sl-id').value = '';
    document.getElementById('sl-label').value = '';
    document.getElementById('sl-date').value = '';
    document.getElementById('sl-start').value = '';
    document.getElementById('sl-end').value = '';
    document.getElementById('slot-form').style.display = '';
  });

  document.getElementById('sl-save-btn').addEventListener('click', async function () {
    var slotId = document.getElementById('sl-id').value.trim();
    var label = document.getElementById('sl-label').value.trim();
    var date = document.getElementById('sl-date').value.trim();
    if (!slotId || !label || !date) { alert('ID, label, and date are required.'); return; }
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass, action: 'upsert-slot', slotId: slotId, label: label, date: date,
        startTime: document.getElementById('sl-start').value,
        endTime: document.getElementById('sl-end').value,
      }),
    });
    document.getElementById('slot-form').style.display = 'none';
    await render();
    renderSlotsList();
  });

  document.getElementById('sl-cancel-btn').addEventListener('click', function () {
    document.getElementById('slot-form').style.display = 'none';
  });

  // ── Modal close buttons ───────────────────────────────────────────────────

  document.querySelectorAll('.modal-close[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.getElementById(btn.dataset.close).classList.remove('active');
    });
  });

  // ── Init ──────────────────────────────────────────────────────────────────

  if (state.myName) render();

})();
