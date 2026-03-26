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
  agGrid.createGrid(document.getElementById('roster-grid'), {
    rowData: members.map(function(m) {
      return { Name: val(m, 'Name'), 'Playa Name': val(m, 'Playa Name'), Role: val(m, 'Role'), Phone: val(m, 'Phone') };
    }),
    columnDefs: [
      { field: 'Name', sortable: true, filter: true },
      { field: 'Playa Name', sortable: true, filter: true },
      { field: 'Role', sortable: true, filter: true },
      { field: 'Phone', sortable: true, filter: true, cellRenderer: JH.PhoneCellRenderer }
    ],
    defaultColDef: { resizable: true, flex: 1, minWidth: 100 },
    pagination: true,
    paginationPageSize: 25,
    suppressCellFocus: true
  });
})();
