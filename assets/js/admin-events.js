(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');
  var state = { events: [] };
  var activeFilter = 'all';

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(dateStr) {
    return JH.formatDateLong(dateStr);
  }

  function statusClass(status) {
    var s = (status || '').toLowerCase();
    if (s === 'planned') return 'status-planned';
    if (s === 'confirmed') return 'status-confirmed';
    if (s === 'completed') return 'status-completed';
    if (s === 'cancelled') return 'status-cancelled';
    return 'status-planned';
  }

  function sortEvents(events) {
    return events.slice().sort(function (a, b) {
      var da = a.Date || '';
      var db = b.Date || '';
      if (da !== db) return da < db ? -1 : 1;
      var ta = a.Time || '';
      var tb = b.Time || '';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (a.Name || '').toLowerCase() < (b.Name || '').toLowerCase() ? -1 : 1;
    });
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
      renderEvents();
    });
  });

  // ── Render event cards ────────────────────────────────────────────────────

  function renderEvents() {
    var wrap = document.getElementById('events-wrap');

    var filtered;
    if (activeFilter === 'all') {
      filtered = state.events;
    } else {
      filtered = state.events.filter(function (ev) {
        return (ev.Status || '').toLowerCase() === activeFilter;
      });
    }

    var sorted = sortEvents(filtered);

    if (!sorted.length) {
      wrap.innerHTML = '<div class="empty-state">' +
        (state.events.length ? 'No events match this filter.' : 'No events yet.' +
        (isAdmin ? ' Use "+ Add Event" to get started.' : ' Check back later.')) +
        '</div>';
      return;
    }

    // Group by date
    var groups = [];
    var currentDate = null;
    sorted.forEach(function (ev) {
      var d = ev.Date || 'TBD';
      if (d !== currentDate) {
        groups.push({ date: d, events: [] });
        currentDate = d;
      }
      groups[groups.length - 1].events.push(ev);
    });

    var html = '';
    groups.forEach(function (group) {
      var dateLabel = group.date === 'TBD' ? 'Date TBD' : formatDate(group.date);
      html += '<div class="event-date-group">';
      html += '<h3 class="event-date-heading">' + esc(dateLabel) + '</h3>';

      group.events.forEach(function (ev) {
        var sClass = statusClass(ev.Status);

        html += '<div class="event-card">';
        html += '<div class="event-card-header">';
        html += '<h3 class="event-card-title">' + esc(ev.Name) + '</h3>';
        html += '<span class="event-status-badge ' + sClass + '">' + esc(ev.Status || 'Planned') + '</span>';
        html += '</div>';

        var dateTime = '';
        if (ev.Date) dateTime += formatDate(ev.Date);
        if (ev.Time) dateTime += (dateTime ? ' at ' : '') + JH.to24h(ev.Time);
        if (dateTime) {
          html += '<div class="event-datetime">' + dateTime + '</div>';
        }

        if (ev.Description) {
          html += '<p class="event-description">' + esc(ev.Description) + '</p>';
        }

        if (ev.Responsible) {
          html += '<div class="event-responsible"><strong>Lead:</strong> ' + esc(ev.Responsible) + '</div>';
        }

        if (ev.Notes) {
          html += '<p class="event-notes">' + esc(ev.Notes) + '</p>';
        }

        if (isAdmin) {
          html += '<div class="event-actions">' +
            '<button class="btn-secondary btn-sm edit-event-btn" data-name="' + esc(ev.Name) + '">Edit</button>' +
            '<button class="btn-danger btn-sm delete-event-btn" data-name="' + esc(ev.Name) + '">Delete</button>' +
            '</div>';
        }

        html += '</div>';
      });

      html += '</div>';
    });

    wrap.innerHTML = html;
    bindCardEvents();
  }

  function bindCardEvents() {
    if (!isAdmin) return;

    document.querySelectorAll('.edit-event-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ev = state.events.find(function (e) { return e.Name === btn.dataset.name; });
        if (ev) openModal(ev);
      });
    });

    document.querySelectorAll('.delete-event-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var ev = state.events.find(function (e) { return e.Name === btn.dataset.name; });
        if (!ev) return;
        if (!confirm('Delete "' + ev.Name + '"? This cannot be undone.')) return;
        var r = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete', name: ev.Name }),
        });
        if (!r.ok) { alert('Delete failed.'); return; }
        await reload();
      });
    });
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
    document.getElementById('event-description').value = event ? event.Description : '';
    document.getElementById('event-responsible').value = event ? event.Responsible : '';
    document.getElementById('event-status').value = event ? event.Status : 'planned';
    document.getElementById('event-notes').value = event ? event.Notes : '';

    // Init Flatpickr on date/time fields
    JH.initDate(document.getElementById('event-date'));
    JH.initTime(document.getElementById('event-time'));

    modal.classList.add('active');
    document.getElementById('event-name').focus();
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
    renderEvents();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  if (isAdmin) document.getElementById('add-event-btn').style.display = '';

  await reload();

})();
