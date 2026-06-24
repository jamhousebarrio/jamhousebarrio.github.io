(async function () {
  var members = await JH.authenticate();
  if (!members) return;
  if (!JH.isAdmin()) {
    document.querySelector('.main').innerHTML = '<div class="empty-state" style="padding:48px 20px;">Admin only.</div>';
    return;
  }

  var esc = JH.esc;
  function val(m, key) { return JH.val(m, key); }

  var approved = members.filter(function (m) {
    return (val(m, 'Status') || '').toLowerCase() === 'approved';
  });

  function renderTable(filter) {
    var q = (filter || '').toLowerCase().trim();
    var rows = approved.filter(function (m) {
      if (!q) return true;
      return ['Playa Name', 'Name', 'Phone', 'Telegram', 'Medical Conditions', 'Emergency Contact Name', 'Emergency Contact Phone', 'Emergency Contact Relation']
        .some(function (k) { return ((val(m, k) || '').toLowerCase()).indexOf(q) !== -1; });
    });
    rows.sort(function (a, b) {
      var na = (val(a, 'Playa Name') || val(a, 'Name') || '').toLowerCase();
      var nb = (val(b, 'Playa Name') || val(b, 'Name') || '').toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });

    document.getElementById('emerg-summary').textContent = rows.length + ' of ' + approved.length + ' approved members';

    if (!rows.length) {
      document.getElementById('emerg-content').innerHTML = '<div class="empty-state">No matches.</div>';
      return;
    }

    function cell(text) {
      var t = (text || '').toString().trim();
      if (!t) return '<td class="dim">—</td>';
      return '<td>' + esc(t) + '</td>';
    }

    var html = '<div style="overflow-x:auto"><table class="emerg-table"><thead><tr>' +
      '<th>Playa Name</th><th>Name</th><th>Phone / Telegram</th>' +
      '<th>Medical conditions</th>' +
      '<th>Emergency contact</th>' +
      '<th>Phone</th>' +
      '<th>Relation</th>' +
      '</tr></thead><tbody>';

    rows.forEach(function (m) {
      var playa = val(m, 'Playa Name');
      var name = val(m, 'Name');
      var phone = val(m, 'Phone');
      var telegram = val(m, 'Telegram');
      var icons = JH.contactLinks(phone || '', telegram || '');
      var contactCell = '';
      if (phone) contactCell += esc(phone);
      if (telegram) contactCell += (contactCell ? '<br>' : '') + '<span class="emerg-meta">@' + esc(telegram.replace(/^@/, '')) + '</span>';
      if (!contactCell) contactCell = '<span class="dim">—</span>';
      else contactCell += icons;
      var emergName = val(m, 'Emergency Contact Name');
      var missing = !emergName || !emergName.trim();
      html += '<tr' + (missing ? ' class="emerg-missing"' : '') + '>' +
        '<td class="emerg-name">' + esc(playa || '—') + '</td>' +
        cell(name) +
        '<td>' + contactCell + '</td>' +
        cell(val(m, 'Medical Conditions')) +
        (missing ? '<td class="emerg-missing-cell">missing</td>' : cell(emergName)) +
        cell(val(m, 'Emergency Contact Phone')) +
        cell(val(m, 'Emergency Contact Relation')) +
      '</tr>';
    });

    html += '</tbody></table></div>';
    document.getElementById('emerg-content').innerHTML = html;
  }

  renderTable('');

  document.getElementById('emerg-search').addEventListener('input', function (e) {
    renderTable(e.target.value);
  });
  document.getElementById('emerg-print-btn').addEventListener('click', function () {
    window.print();
  });
})();
