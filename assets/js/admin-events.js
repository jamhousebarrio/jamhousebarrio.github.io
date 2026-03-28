(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');
  var state = { events: [] };
  var activeFilter = 'all';
  var viewYear = 2026;
  var viewMonth = 6; // July (0-indexed)

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusClass(status) {
    var s = (status || '').toLowerCase();
    if (s === 'confirmed') return 'status-confirmed';
    if (s === 'completed') return 'status-completed';
    if (s === 'cancelled') return 'status-cancelled';
    return '';
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    if (!res.ok) { console.error('events fetch failed'); return; }
    var data = await res.json();
    state.events = data.events || [];
  }

  // ── Filter buttons ────────────────────────────────────────────────────────

  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderCalendar();
    });
  });

  // ── Calendar rendering ────────────────────────────────────────────────────

  function getFilteredEvents() {
    if (activeFilter === 'all') return state.events;
    return state.events.filter(function (ev) {
      return (ev.Status || '').toLowerCase() === activeFilter;
    });
  }

  function renderCalendar() {
    var wrap = document.getElementById('events-wrap');
    var filtered = getFilteredEvents();
    var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    // Month nav
    var html = '<div class="cal-nav">';
    html += '<button class="cal-nav-btn" id="cal-prev">&lsaquo;</button>';
    html += '<span class="cal-month-label">' + monthNames[viewMonth] + ' ' + viewYear + '</span>';
    html += '<button class="cal-nav-btn" id="cal-next">&rsaquo;</button>';
    html += '</div>';

    // Day headers
    html += '<div class="cal-grid">';
    dayNames.forEach(function (d) {
      html += '<div class="cal-header">' + d + '</div>';
    });

    // First day of month (0=Sun, adjust to Mon=0)
    var firstDay = new Date(viewYear, viewMonth, 1).getDay();
    var startOffset = (firstDay === 0) ? 6 : firstDay - 1; // Monday-based
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    // Empty cells before first day
    for (var e = 0; e < startOffset; e++) {
      html += '<div class="cal-day empty"></div>';
    }

    // Day cells
    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = viewYear + '-' + String(viewMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var dayEvents = filtered.filter(function (ev) { return ev.Date === dateStr; });
      var hasEvents = dayEvents.length > 0;

      html += '<div class="cal-day' + (hasEvents ? ' has-events' : '') + '">';
      html += '<div class="cal-day-num">' + day + '</div>';

      dayEvents.forEach(function (ev) {
        var sClass = statusClass(ev.Status);
        var timeStr = '';
        if (ev.Time) {
          timeStr = JH.to24h(ev.Time);
          if (ev.EndTime) timeStr += ' - ' + JH.to24h(ev.EndTime);
        }

        html += '<div class="cal-event ' + sClass + '" data-name="' + esc(ev.Name) + '">';
        html += '<div class="cal-event-name">' + esc(ev.Name) + '</div>';
        if (timeStr) html += '<div class="cal-event-time">' + esc(timeStr) + '</div>';
        if (ev.Responsible) html += '<div class="cal-event-lead">' + esc(ev.Responsible) + '</div>';
        html += '</div>';
      });

      html += '</div>';
    }

    html += '</div>';
    wrap.innerHTML = html;

    // Bind nav
    document.getElementById('cal-prev').addEventListener('click', function () {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderCalendar();
    });
    document.getElementById('cal-next').addEventListener('click', function () {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderCalendar();
    });

    // Bind event clicks
    if (isAdmin) {
      document.querySelectorAll('.cal-event').forEach(function (el) {
        el.addEventListener('click', function () {
          var ev = state.events.find(function (e) { return e.Name === el.dataset.name; });
          if (ev) openModal(ev);
        });
      });
    }
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  var modal = document.getElementById('event-modal');
  var editingName = null;

  function openModal(event) {
    editingName = event ? event.Name : null;
    document.getElementById('event-modal-title').innerHTML = (event ? 'Edit Event' : 'Add Event') +
      ' <button class="modal-close" data-close="event-modal">&times;</button>';
    bindCloseButtons();

    document.getElementById('event-name').value = event ? event.Name : '';
    document.getElementById('event-date').value = event ? event.Date : '';
    document.getElementById('event-time').value = event ? event.Time : '';
    document.getElementById('event-end-time').value = event ? (event.EndTime || '') : '';
    document.getElementById('event-description').value = event ? event.Description : '';
    document.getElementById('event-responsible').value = event ? event.Responsible : '';
    document.getElementById('event-status').value = event ? event.Status : 'planned';
    document.getElementById('event-notes').value = event ? event.Notes : '';

    JH.initDate(document.getElementById('event-date'));
    JH.initTime(document.getElementById('event-time'));
    JH.initTime(document.getElementById('event-end-time'));

    modal.classList.add('active');
    document.getElementById('event-name').focus();

    // Delete button
    var actionsDiv = document.querySelector('#event-modal .modal-actions');
    var existingDelete = document.getElementById('event-delete-btn');
    if (existingDelete) existingDelete.remove();
    if (event && isAdmin) {
      var delBtn = document.createElement('button');
      delBtn.id = 'event-delete-btn';
      delBtn.className = 'btn-secondary';
      delBtn.style.cssText = 'color:#f44336;border-color:#f44336;margin-left:auto;';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async function () {
        if (!confirm('Delete "' + event.Name + '"?')) return;
        var r = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete', name: event.Name }),
        });
        if (!r.ok) { alert('Delete failed.'); return; }
        closeModal();
        await reload();
      });
      actionsDiv.appendChild(delBtn);
    }
  }

  function closeModal() {
    modal.classList.remove('active');
    editingName = null;
  }

  function bindCloseButtons() {
    document.querySelectorAll('[data-close="event-modal"]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(); });
    });
  }
  bindCloseButtons();

  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  document.getElementById('add-event-btn').addEventListener('click', function () {
    openModal(null);
  });

  document.getElementById('event-save-btn').addEventListener('click', async function () {
    var name = document.getElementById('event-name').value.trim();
    if (!name) { alert('Name is required.'); return; }

    var btn = this;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    var r = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass,
        action: 'upsert',
        name: name,
        originalName: editingName,
        date: document.getElementById('event-date').value,
        time: document.getElementById('event-time').value,
        endTime: document.getElementById('event-end-time').value,
        description: document.getElementById('event-description').value,
        responsible: document.getElementById('event-responsible').value,
        status: document.getElementById('event-status').value,
        notes: document.getElementById('event-notes').value,
      }),
    });

    btn.textContent = 'Save Event';
    btn.disabled = false;

    if (!r.ok) { var d = await r.json().catch(function () { return {}; }); alert(d.error || 'Save failed.'); return; }
    closeModal();
    await reload();
  });

  // ── Reload ────────────────────────────────────────────────────────────────

  async function reload() {
    await fetchData();
    renderCalendar();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  if (isAdmin) document.getElementById('add-event-btn').style.display = '';

  await reload();
})();
