(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');

  var approvedMembers = members.filter(function (m) {
    return (JH.val(m, 'Status') || '').toLowerCase() === 'approved';
  });

  var shifts = [];

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  async function fetchShifts() {
    var r = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    if (!r.ok) return;
    var data = await r.json();
    shifts = (data.shifts || []).sort(function (a, b) {
      var da = (a.Date || '') + (a.StartTime || '');
      var db = (b.Date || '') + (b.StartTime || '');
      return da < db ? -1 : da > db ? 1 : 0;
    });
  }

  function renderShifts() {
    var wrap = document.getElementById('shifts-wrap');
    if (!shifts.length) {
      wrap.innerHTML = '<div class="empty-state">No shifts yet.' + (isAdmin ? ' Click &ldquo;+ Add Shift&rdquo; to create one.' : '') + '</div>';
      return;
    }

    var html = '<table class="shifts-table"><thead><tr>'
      + '<th>Shift</th><th>Date</th><th>Time</th><th>Assigned to</th><th></th>'
      + '</tr></thead><tbody>';

    shifts.forEach(function (s) {
      var time = s.StartTime && s.EndTime ? s.StartTime + ' \u2013 ' + s.EndTime
               : s.StartTime ? s.StartTime : '';
      var assignedHtml = s.AssignedTo
        ? '<span class="assigned-chip">' + esc(s.AssignedTo) + '</span>'
        : '<span class="open-badge">Open</span>';

      var actions = '';
      if (!s.AssignedTo) {
        actions += '<button class="btn-sm assign-btn" data-id="' + esc(s.ShiftID) + '">Assign</button>';
      } else if (isAdmin) {
        actions += '<button class="btn-danger-sm unassign-btn" data-id="' + esc(s.ShiftID) + '">Unassign</button>';
      }
      if (isAdmin) {
        actions += ' <button class="btn-danger-sm delete-btn" data-id="' + esc(s.ShiftID) + '">Delete</button>';
      }

      html += '<tr>'
        + '<td><strong>' + esc(s.Name) + '</strong></td>'
        + '<td>' + esc(fmt(s.Date)) + '</td>'
        + '<td class="shift-time">' + esc(time) + '</td>'
        + '<td>' + assignedHtml + '</td>'
        + '<td style="white-space:nowrap">' + actions + '</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.assign-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openAssignModal(btn.dataset.id); });
    });

    wrap.querySelectorAll('.unassign-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Remove assignment for this shift?')) return;
        var r = await fetch('/api/shifts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'unassign', shiftId: btn.dataset.id }),
        });
        if (!r.ok) { alert('Failed. Please try again.'); return; }
        await fetchShifts(); renderShifts();
      });
    });

    wrap.querySelectorAll('.delete-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete this shift?')) return;
        var r = await fetch('/api/shifts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete', shiftId: btn.dataset.id }),
        });
        if (!r.ok) { alert('Failed. Please try again.'); return; }
        await fetchShifts(); renderShifts();
      });
    });
  }

  // Add shift modal (admin only)
  if (isAdmin) document.getElementById('add-shift-btn').style.display = '';

  var addModal = document.getElementById('add-modal');
  document.getElementById('add-shift-btn').addEventListener('click', function () {
    addModal.classList.add('active');
  });
  document.getElementById('add-modal-close').addEventListener('click', function () {
    addModal.classList.remove('active');
  });
  addModal.addEventListener('click', function (e) {
    if (e.target === addModal) addModal.classList.remove('active');
  });

  document.getElementById('add-shift-save').addEventListener('click', async function () {
    var name = document.getElementById('shift-name').value.trim();
    var date = document.getElementById('shift-date').value;
    var start = document.getElementById('shift-start').value;
    var end = document.getElementById('shift-end').value;
    var msg = document.getElementById('add-msg');

    if (!name || !date) { msg.textContent = 'Name and date required'; msg.style.color = '#f44336'; return; }
    msg.textContent = 'Saving...'; msg.style.color = '#888';

    var shiftId = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    var r = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, action: 'create', shiftId: shiftId, name: name, date: date, startTime: start, endTime: end }),
    });
    if (!r.ok) { msg.textContent = 'Failed. Try again.'; msg.style.color = '#f44336'; return; }

    addModal.classList.remove('active');
    document.getElementById('shift-name').value = '';
    document.getElementById('shift-date').value = '';
    document.getElementById('shift-start').value = '';
    document.getElementById('shift-end').value = '';
    msg.textContent = '';
    await fetchShifts(); renderShifts();
  });

  // Assign modal
  var assignModal = document.getElementById('assign-modal');
  var assignShiftId = null;

  function openAssignModal(shiftId) {
    assignShiftId = shiftId;
    var sel = document.getElementById('assign-select');
    sel.innerHTML = '<option value="">Select member...</option>';
    var myName = sessionStorage.getItem('jh_member_name');

    if (isAdmin) {
      approvedMembers.forEach(function (m) {
        var name = JH.val(m, 'Playa Name') || JH.val(m, 'Name') || '';
        if (!name) return;
        var opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        sel.appendChild(opt);
      });
    } else if (myName) {
      var opt = document.createElement('option');
      opt.value = myName; opt.textContent = myName; opt.selected = true;
      sel.appendChild(opt);
    } else {
      approvedMembers.forEach(function (m) {
        var name = JH.val(m, 'Playa Name') || JH.val(m, 'Name') || '';
        if (!name) return;
        var opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        sel.appendChild(opt);
      });
    }

    assignModal.classList.add('active');
  }

  document.getElementById('assign-modal-close').addEventListener('click', function () {
    assignModal.classList.remove('active');
  });
  assignModal.addEventListener('click', function (e) {
    if (e.target === assignModal) assignModal.classList.remove('active');
  });

  document.getElementById('assign-save').addEventListener('click', async function () {
    var name = document.getElementById('assign-select').value;
    var msg = document.getElementById('assign-msg');
    if (!name) { msg.textContent = 'Pick a name'; msg.style.color = '#f44336'; return; }
    msg.textContent = 'Saving...'; msg.style.color = '#888';

    var r = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, action: 'assign', shiftId: assignShiftId, memberName: name }),
    });
    if (!r.ok) { msg.textContent = 'Failed. Try again.'; msg.style.color = '#f44336'; return; }

    sessionStorage.setItem('jh_member_name', name);
    assignModal.classList.remove('active');
    msg.textContent = '';
    await fetchShifts(); renderShifts();
  });

  await fetchShifts();
  renderShifts();
})();
