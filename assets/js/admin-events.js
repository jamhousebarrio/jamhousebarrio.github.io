(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var isObserver = !!(JH.currentUser && JH.currentUser.observer);
  var canWrite = !isObserver;
  var state = { events: [] };
  var activeFilter = 'all';
  var viewYear = 2026;
  var viewMonth = 6; // July (0-indexed)

  function statusClass(status) {
    var s = (status || '').toLowerCase();
    if (s === 'confirmed') return 'status-confirmed';
    if (s === 'completed') return 'status-completed';
    if (s === 'cancelled') return 'status-cancelled';
    return '';
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await JH.apiFetch('/api/events', {});
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
    // Event week: July 7-12, 2026
    var eventDates = [
      '2026-07-07', '2026-07-08', '2026-07-09',
      '2026-07-10', '2026-07-11', '2026-07-12'
    ];

    var html = '<div class="cal-nav">';
    html += '<span class="cal-month-label">Event Week: 07/07 - 12/07/2026</span>';
    html += '</div>';

    html += '<div class="cal-grid" style="grid-template-columns:repeat(6,1fr)">';
    eventDates.forEach(function (dateStr) {
      html += '<div class="cal-header">' + JH.formatDateLong(dateStr) + '</div>';
    });

    eventDates.forEach(function (dateStr) {
      var dayEvents = filtered.filter(function (ev) { return ev.Date === dateStr; }).sort(function (a, b) {
        // Sort earliest-first. Normalize to 24h so "9:00 AM" sorts before "10:00".
        // Events without a time fall to the bottom of the day.
        var at = a.Time ? JH.to24h(a.Time) : '99:99';
        var bt = b.Time ? JH.to24h(b.Time) : '99:99';
        return at < bt ? -1 : at > bt ? 1 : 0;
      });
      var hasEvents = dayEvents.length > 0;
      var day = parseInt(dateStr.split('-')[2]);

      html += '<div class="cal-day' + (hasEvents ? ' has-events' : '') + '">';
      html += '<div class="cal-day-num">Day ' + (day - 6) + '</div>';

      dayEvents.forEach(function (ev) {
        var sClass = statusClass(ev.Status);
        var timeStr = '';
        if (ev.Time) {
          timeStr = JH.to24h(ev.Time);
          if (ev.EndTime) timeStr += ' - ' + JH.to24h(ev.EndTime);
        }

        html += '<div class="cal-event ' + sClass + '" data-id="' + JH.esc(ev.Id) + '">';
        html += '<div class="cal-event-name">' + JH.esc(ev.Name) + '</div>';
        if (timeStr) html += '<div class="cal-event-time">' + JH.esc(timeStr) + '</div>';
        if (ev.Responsible) html += '<div class="cal-event-lead">' + JH.esc(ev.Responsible) + '</div>';
        html += '</div>';
      });

      html += '</div>';
    });

    html += '</div>';
    wrap.innerHTML = html;

    // Bind event clicks — any approved (non-observer) member can edit.
    if (canWrite) {
      document.querySelectorAll('.cal-event').forEach(function (el) {
        el.addEventListener('click', function () {
          var ev = state.events.find(function (e) { return e.Id === el.dataset.id; });
          if (ev) openModal(ev);
        });
      });
    }
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  var modal = document.getElementById('event-modal');
  var editingId = null;

  function openModal(event) {
    editingId = event ? event.Id : null;
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
        var r = await JH.apiFetch('/api/events', { action: 'delete', id: event.Id });
        if (!r.ok) { alert('Delete failed.'); return; }
        closeModal();
        await reload();
      });
      actionsDiv.appendChild(delBtn);
    }
  }

  function closeModal() {
    modal.classList.remove('active');
    editingId = null;
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

    var r = await JH.apiFetch('/api/events', {
      action: 'upsert',
      id: editingId || crypto.randomUUID(),
      name: name,
      date: document.getElementById('event-date').value,
      time: document.getElementById('event-time').value,
      endTime: document.getElementById('event-end-time').value,
      description: document.getElementById('event-description').value,
      responsible: document.getElementById('event-responsible').value,
      status: document.getElementById('event-status').value,
      notes: document.getElementById('event-notes').value,
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

  if (canWrite) document.getElementById('add-event-btn').style.display = '';
  document.getElementById('export-csv-btn').addEventListener('click', exportCsv);

  await reload();

  // ── CSV export ──────────────────────────────────────────────────────────
  function exportCsv() {
    var headers = ['Name', 'Date', 'Time', 'EndTime', 'Description', 'Responsible', 'Status', 'Notes'];
    var rows = (state.events || []).slice().sort(function (a, b) {
      var ad = (a.Date || '') + ' ' + (a.Time || '');
      var bd = (b.Date || '') + ' ' + (b.Time || '');
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
    var csv = headers.join(',') + '\n' + rows.map(function (ev) {
      return headers.map(function (h) { return csvCell(ev[h]); }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'jamhouse-events-' + stamp + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    var s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
})();
