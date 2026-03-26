(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var val = JH.val;

  // Filter to approved only
  members = members.filter(function(m) { return val(m, 'Status').toLowerCase() === 'approved'; });

  // Stats
  document.getElementById('stat-total').textContent = members.length;
  var ages = members.map(function(m) { return parseInt(val(m, 'Age')); }).filter(function(a) { return !isNaN(a); });
  document.getElementById('stat-avg-age').textContent = ages.length ? Math.round(ages.reduce(function(a, b) { return a + b; }, 0) / ages.length) : '-';

  // Age chart
  var ageBuckets = { '18-25': 0, '26-35': 0, '36-45': 0, '46-55': 0, '56+': 0 };
  members.forEach(function(m) {
    var age = parseInt(val(m, 'Age'));
    if (isNaN(age)) return;
    if (age <= 25) ageBuckets['18-25']++;
    else if (age <= 35) ageBuckets['26-35']++;
    else if (age <= 45) ageBuckets['36-45']++;
    else if (age <= 55) ageBuckets['46-55']++;
    else ageBuckets['56+']++;
  });
  JH.makeBar('age-chart', Object.keys(ageBuckets), Object.values(ageBuckets));

  // Gender chart
  var genderCounts = {};
  members.forEach(function(m) { var v = val(m, 'Gender') || 'Not specified'; genderCounts[v] = (genderCounts[v] || 0) + 1; });
  var genderColors = { 'Male': '#4fc3f7', 'Female': '#f06292', 'Non-binary': '#ab47bc', 'Prefer not to say': '#78909c', 'Not specified': '#78909c' };
  var gLabels = Object.keys(genderCounts);
  var gData = Object.values(genderCounts);
  var gColors = gLabels.map(function(l) { return genderColors[l] || '#e8a84c'; });
  new Chart(document.getElementById('gender-chart'), {
    type: 'doughnut',
    data: { labels: gLabels, datasets: [{ data: gData, backgroundColor: gColors, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: { legend: { position: 'bottom', labels: { color: '#e8e4df', padding: 16, usePointStyle: true, pointStyle: 'circle' } } }
    }
  });

  // Location chart
  var locCounts = {};
  members.forEach(function(m) { var v = val(m, 'Location') || 'Unknown'; locCounts[v] = (locCounts[v] || 0) + 1; });
  var locSorted = Object.entries(locCounts).sort(function(a, b) { return b[1] - a[1]; });
  JH.makeBar('location-chart', locSorted.map(function(d) { return d[0]; }), locSorted.map(function(d) { return d[1]; }));

  // Nationality chart
  var natCounts = {};
  members.forEach(function(m) { var v = val(m, 'Nationality') || 'Unknown'; natCounts[v] = (natCounts[v] || 0) + 1; });
  var natSorted = Object.entries(natCounts).sort(function(a, b) { return b[1] - a[1]; });
  JH.makeBar('nationality-chart', natSorted.map(function(d) { return d[0]; }), natSorted.map(function(d) { return d[1]; }));

  // First Burn / First Elsewhere chart
  var burnData = { 'First Burn - Yes': 0, 'First Burn - No': 0, 'First Elsewhere - Yes': 0, 'First Elsewhere - No': 0 };
  members.forEach(function(m) {
    var fb = val(m, 'First Burn');
    var fe = val(m, 'First Elsewhere/Nowhere');
    if (fb.toLowerCase() === 'yes') burnData['First Burn - Yes']++;
    else if (fb) burnData['First Burn - No']++;
    if (fe && fe.toLowerCase() !== 'no') burnData['First Elsewhere - Yes']++;
    else if (fe) burnData['First Elsewhere - No']++;
  });
  JH.makeBar('burns-chart', Object.keys(burnData), Object.values(burnData));

  // Roster table
  var membersByName = {};
  members.forEach(function(m) { membersByName[val(m, 'Name')] = m; });

  agGrid.createGrid(document.getElementById('roster-grid'), {
    rowData: members.map(function(m) {
      return { Name: val(m, 'Name'), Location: val(m, 'Location'), Nationality: val(m, 'Nationality'), Age: val(m, 'Age'), Gender: val(m, 'Gender'), 'First Burn': val(m, 'First Burn') };
    }),
    columnDefs: [
      { field: 'Name', sortable: true, filter: true },
      { field: 'Location', sortable: true, filter: true },
      { field: 'Nationality', sortable: true, filter: true },
      { field: 'Age', sortable: true, filter: true },
      { field: 'Gender', sortable: true, filter: true },
      { field: 'First Burn', sortable: true, filter: true }
    ],
    defaultColDef: { resizable: true, flex: 1, minWidth: 100 },
    pagination: true,
    paginationPageSize: 25,
    suppressCellFocus: true,
    onRowClicked: function(event) {
      var member = membersByName[event.data.Name];
      if (member) openModal(member);
    }
  });

  var waIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path fill="#25D366" d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.613.613l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.352 0-4.55-.678-6.414-1.846l-.447-.283-3.167 1.062 1.062-3.167-.283-.447A9.96 9.96 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>';
  var tgIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#0088cc" d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';

  function contactLinks(v) {
    var phone = v.replace(/[^+\d]/g, '');
    var digits = phone.replace('+', '');
    var links = [];
    if (digits) {
      links.push('<a href="https://wa.me/' + digits + '" target="_blank" title="WhatsApp" style="text-decoration:none;">' + waIcon + '</a>');
      links.push('<a href="https://t.me/+' + digits + '" target="_blank" title="Telegram" style="text-decoration:none;">' + tgIcon + '</a>');
    }
    return links.length ? ' &nbsp; ' + links.join(' &nbsp; ') : '';
  }

  function openModal(m) {
    document.getElementById('modal-title').textContent = val(m, 'Name') || 'Member';
    var skipKeys = ['_row'];
    var html = Object.keys(m).filter(function(k) {
      return skipKeys.indexOf(k) === -1;
    }).map(function(k) {
      var v = val(m, k);
      var escaped = v ? v.replace(/</g, '&lt;') : '';
      var links = (k === 'Phone') ? contactLinks(v) : '';
      var display = escaped || '<span style="color:#555;">—</span>';
      return '<div class="detail-row"><div class="detail-label">' + k + '</div><div class="detail-value">' + display + links + '</div></div>';
    }).join('');
    document.getElementById('modal-details').innerHTML = html;
    document.getElementById('modalOverlay').classList.add('active');
  }

  document.getElementById('modalClose').addEventListener('click', function() {
    document.getElementById('modalOverlay').classList.remove('active');
  });
  document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('active');
  });
})();
