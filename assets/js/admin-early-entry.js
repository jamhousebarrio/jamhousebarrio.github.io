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

    var tableWrap = document.getElementById('ee-table-wrap');
    var cardsWrap = document.getElementById('ee-cards');

    if (!early.length) {
      tableWrap.innerHTML = '<div class="empty-state">No early arrivals yet.</div>';
      cardsWrap.innerHTML = '<div class="empty-state">No early arrivals yet.</div>';
      return;
    }

    // Shared cell fragments so the table and mobile cards render the SAME
    // controls (classes + data-name) — wireRow binds both trees identically.
    function arrivesCell(r) {
      return r.arrival ? JH.esc(JH.formatDate(r.arrival)) : '<span class="muted">—</span>';
    }
    function setupCell(r) {
      return r.setupNoOrg ? '<span class="ee-badge">✓ setup</span>' : '<span class="muted">—</span>';
    }
    function sourceCell(r) {
      return sourceSelect(r) + (r.source ? '' : '<span class="ee-warn-tag">⚠</span>');
    }
    function notesCell(r) {
      return '<input class="ee-notes" data-name="' + JH.esc(r.name) + '" value="' + JH.esc(r.notes) + '" placeholder="optional">';
    }

    var html = '<table class="ee-table"><thead><tr>';
    html += '<th>Name</th><th>Arrives</th><th>NoOrg setup</th><th>EE source</th><th>Notes</th>';
    html += '</tr></thead><tbody>';
    var cardsHtml = '';
    early.forEach(function (r) {
      var cls = r.source ? '' : ' class="uncovered"';
      html += '<tr' + cls + ' data-name="' + JH.esc(r.name) + '">';
      html += '<td><strong>' + JH.esc(r.name) + '</strong></td>';
      html += '<td>' + arrivesCell(r) + '</td>';
      html += '<td>' + setupCell(r) + '</td>';
      html += '<td>' + sourceCell(r) + '</td>';
      html += '<td>' + notesCell(r) + '</td>';
      html += '</tr>';

      // Mobile dual-render: same data, same controls, card layout.
      cardsHtml += '<div class="m-card' + (r.source ? '' : ' uncovered') + '" data-name="' + JH.esc(r.name) + '">';
      cardsHtml += '<div class="m-card-title">' + JH.esc(r.name) + '</div>';
      cardsHtml += '<div class="m-card-row"><span class="m-card-label">Arrives</span><span class="m-card-val">' + arrivesCell(r) + '</span></div>';
      cardsHtml += '<div class="m-card-row"><span class="m-card-label">NoOrg setup</span><span class="m-card-val">' + setupCell(r) + '</span></div>';
      cardsHtml += '<div class="m-card-row"><span class="m-card-label">EE source</span><span class="m-card-val">' + sourceCell(r) + '</span></div>';
      cardsHtml += '<div class="m-card-row"><span class="m-card-label">Notes</span><span class="m-card-val">' + notesCell(r) + '</span></div>';
      cardsHtml += '</div>';
    });
    html += '</tbody></table>';
    tableWrap.innerHTML = html;
    cardsWrap.innerHTML = cardsHtml;

    wireRow(pool);
  }

  function renderUnknown(rows) {
    var unknown = rows.filter(function (r) { return !r.arrivalDate; });
    var wrap = document.getElementById('ee-unknown');
    if (!unknown.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<h2>Arrival unknown (chase these — no arrival date filled in)</h2>' +
      '<p class="muted">' + unknown.map(function (r) { return JH.esc(r.name); }).join(', ') + '</p>';
  }

  // Find the sibling control in the SAME tree (table row or mobile card) —
  // a document-wide lookup would always hit the desktop table's copy first,
  // reading stale values when the user is editing the mobile cards.
  function siblingControl(el, selector) {
    var scope = el.closest('tr, .m-card');
    return scope ? scope.querySelector(selector) : null;
  }

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
        var notesInp = siblingControl(sel, '.ee-notes');
        if (await save(name, source, notesInp ? notesInp.value : '')) await reload();
      });
    });
    document.querySelectorAll('.ee-notes').forEach(function (inp) {
      inp.addEventListener('blur', async function () {
        // Skip if the notes weren't actually edited (avoids a save on every blur).
        if (inp.value === inp.defaultValue) return;
        var name = inp.dataset.name;
        // Persist notes with whatever source is currently selected — including
        // none, so notes can be added before a pass type is picked.
        var sel = siblingControl(inp, '.ee-select');
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
