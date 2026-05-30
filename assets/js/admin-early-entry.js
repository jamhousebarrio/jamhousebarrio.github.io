import { GATE, parseDate, isEarlyArrival, hasSetupNoOrg, barrioCap } from '/assets/js/early-entry-logic.js';

(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var approvedMembers = members.filter(function (m) {
    return (JH.val(m, 'Status') || '').toLowerCase() === 'approved';
  });

  var logistics = [];
  var earlyEntry = [];

  function norm(s) { return (s || '').toString().trim().toLowerCase(); }
  function displayName(m) { return JH.val(m, 'Playa Name') || JH.val(m, 'Name') || ''; }

  // Resolve a member's row in a name-keyed list, trying playa then legal name
  // (mirrors admin-logistics.js findLogisticsRow's playa<->legal fallback).
  function findByMemberName(list, m) {
    var playa = norm(JH.val(m, 'Playa Name'));
    var legal = norm(JH.val(m, 'Name'));
    return list.find(function (r) {
      var key = norm(r.MemberName);
      return (playa && key === playa) || (legal && key === legal);
    }) || null;
  }

  async function fetchAll() {
    var results = await Promise.all([
      JH.apiFetch('/api/logistics', {}),
      JH.apiFetch('/api/logistics', { action: 'early-entry-fetch' }),
    ]);
    var r1 = results[0], r2 = results[1];
    logistics = r1.ok ? ((await r1.json()).logistics || []) : [];
    earlyEntry = r2.ok ? ((await r2.json()).earlyEntry || []) : [];
  }

  function buildRows() {
    return approvedMembers.map(function (m) {
      var name = displayName(m);
      if (!name) return null;
      var log = findByMemberName(logistics, m) || {};
      var ee = findByMemberName(earlyEntry, m);
      return {
        name: name,
        arrival: log.ArrivalDate || '',
        arrivalDate: parseDate(log.ArrivalDate || ''),
        early: isEarlyArrival(log.ArrivalDate || '', GATE),
        setupNoOrg: hasSetupNoOrg(log.NoOrgDates || '', GATE),
        source: ee ? (ee.Source || '') : '',
        notes: ee ? (ee.Notes || '') : '',
      };
    }).filter(Boolean);
  }

  function renderStats(rows) {
    var early = rows.filter(function (r) { return r.early; });
    var covered = early.filter(function (r) { return r.source; }).length;
    var uncovered = early.length - covered;
    var cap = barrioCap(approvedMembers.length);
    // Count barrio passes from the EE rows directly, so an assignment still
    // counts against the pool even if its member is no longer in approvedMembers
    // (un-approved or a name edit that breaks the join).
    var barrioUsed = earlyEntry.filter(function (r) { return (r.Source || '') === 'barrio'; }).length;
    var remaining = cap - barrioUsed;
    var over = barrioUsed > cap;

    var html = '';
    html += '<div class="ee-stat"><div class="num">' + early.length + '</div><div class="lbl">Early arrivals</div></div>';
    html += '<div class="ee-stat"><div class="num">' + covered + '</div><div class="lbl">Covered</div></div>';
    html += '<div class="ee-stat' + (uncovered ? ' warn' : '') + '"><div class="num">' + uncovered + '</div><div class="lbl">Uncovered</div></div>';
    html += '<div class="ee-stat' + (over ? ' over warn' : '') + '"><div class="num">' + barrioUsed + ' / ' + cap + '</div><div class="lbl">Barrio pool' + (over ? ' (over!)' : ' (' + remaining + ' left)') + '</div></div>';
    document.getElementById('ee-stats').innerHTML = html;
    return { cap: cap, barrioUsed: barrioUsed };
  }

  var SOURCES = [['', '— none —'], ['barrio', 'Barrio'], ['noorg', 'NoOrg'], ['artist', 'Artist']];

  function sourceSelect(row) {
    var opts = SOURCES.map(function (s) {
      return '<option value="' + s[0] + '"' + (row.source === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
    }).join('');
    return '<select class="ee-select" data-name="' + JH.esc(row.name) + '">' + opts + '</select>';
  }

  function renderTable(rows, pool) {
    var early = rows.filter(function (r) { return r.early; })
      .sort(function (a, b) {
        var ta = a.arrivalDate ? a.arrivalDate.getTime() : Infinity;
        var tb = b.arrivalDate ? b.arrivalDate.getTime() : Infinity;
        return ta - tb;
      });

    if (!early.length) {
      document.getElementById('ee-table-wrap').innerHTML = '<div class="empty-state">No early arrivals yet.</div>';
      return;
    }

    var html = '<table class="ee-table"><thead><tr>';
    html += '<th>Name</th><th>Arrives</th><th>NoOrg setup</th><th>EE source</th><th>Notes</th>';
    html += '</tr></thead><tbody>';
    early.forEach(function (r) {
      var cls = r.source ? '' : ' class="uncovered"';
      html += '<tr' + cls + ' data-name="' + JH.esc(r.name) + '">';
      html += '<td><strong>' + JH.esc(r.name) + '</strong></td>';
      html += '<td>' + (r.arrival ? JH.esc(JH.formatDate(r.arrival)) : '<span class="muted">—</span>') + '</td>';
      html += '<td>' + (r.setupNoOrg ? '<span class="ee-badge">✓ setup</span>' : '<span class="muted">—</span>') + '</td>';
      html += '<td>' + sourceSelect(r) + (r.source ? '' : '<span class="ee-warn-tag">⚠</span>') + '</td>';
      html += '<td><input class="ee-notes" data-name="' + JH.esc(r.name) + '" value="' + JH.esc(r.notes) + '" placeholder="optional"></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('ee-table-wrap').innerHTML = html;

    wireRow(pool);
  }

  function renderUnknown(rows) {
    var unknown = rows.filter(function (r) { return !r.arrivalDate; });
    var wrap = document.getElementById('ee-unknown');
    if (!unknown.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<h2>Arrival unknown (chase these — no arrival date filled in)</h2>' +
      '<p class="muted">' + unknown.map(function (r) { return JH.esc(r.name); }).join(', ') + '</p>';
  }

  function notesValueFor(name) {
    var input = document.querySelector('.ee-notes[data-name="' + cssEscape(name) + '"]');
    return input ? input.value : '';
  }
  function cssEscape(s) { return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

  async function save(name, source, notes) {
    var r = await JH.apiFetch('/api/logistics', {
      action: 'set-early-entry', memberName: name, source: source, notes: notes,
    });
    if (!r.ok) {
      var msg = 'Save failed.';
      try { var j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
      alert(msg);
      return false;
    }
    return true;
  }

  function wireRow(pool) {
    document.querySelectorAll('.ee-select').forEach(function (sel) {
      // Stash the value before a change so we can restore it if the user
      // cancels the over-cap confirm (avoids a needless server reload).
      sel.addEventListener('focus', function () { sel.dataset.prev = sel.value; });
      sel.addEventListener('change', async function () {
        var name = sel.dataset.name;
        var source = sel.value;
        // Warn (but allow) if assigning Barrio would exceed the pool.
        if (source === 'barrio' && pool.barrioUsed >= pool.cap) {
          if (!confirm('Barrio pool is full (' + pool.barrioUsed + '/' + pool.cap + '). Assign anyway?')) {
            sel.value = sel.dataset.prev || '';
            return;
          }
        }
        if (await save(name, source, notesValueFor(name))) await reload();
      });
    });
    document.querySelectorAll('.ee-notes').forEach(function (inp) {
      inp.addEventListener('blur', async function () {
        // Skip if the notes weren't actually edited (avoids a save on every blur).
        if (inp.value === inp.defaultValue) return;
        var name = inp.dataset.name;
        // Persist notes with whatever source is currently selected — including
        // none, so notes can be added before a pass type is picked.
        var sel = document.querySelector('.ee-select[data-name="' + cssEscape(name) + '"]');
        var source = sel ? sel.value : '';
        if (await save(name, source, inp.value)) await reload();
      });
    });
  }

  async function reload() {
    await fetchAll();
    var rows = buildRows();
    var pool = renderStats(rows);
    renderTable(rows, pool);
    renderUnknown(rows);
  }

  await reload();
})();
