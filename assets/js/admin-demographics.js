(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var val = JH.val;
  members = members.filter(function(m) { return val(m, 'Status').toLowerCase() === 'approved'; });

  // Stats
  document.getElementById('stat-total').textContent = members.length;
  var ages = members.map(function(m) { return parseInt(val(m, 'Age')); }).filter(function(a) { return !isNaN(a); });
  document.getElementById('stat-avg-age').textContent = ages.length ? Math.round(ages.reduce(function(a, b) { return a + b; }, 0) / ages.length) : '-';
  document.getElementById('stat-age-range').textContent = ages.length ? Math.min.apply(null, ages) + ' - ' + Math.max.apply(null, ages) : '-';

  var virgins = members.filter(function(m) { return val(m, 'First Burn').toLowerCase() === 'yes'; }).length;
  document.getElementById('stat-virgins').textContent = virgins + ' / ' + members.length;

  var nationalities = {};
  members.forEach(function(m) { var v = val(m, 'Nationality'); if (v) nationalities[v] = true; });
  document.getElementById('stat-countries').textContent = Object.keys(nationalities).length;

  // Age chart — bar
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

  // Gender — doughnut
  var genderCounts = {};
  members.forEach(function(m) { var v = val(m, 'Gender') || 'Not specified'; genderCounts[v] = (genderCounts[v] || 0) + 1; });
  var genderColors = { 'Male': '#4fc3f7', 'Female': '#f06292', 'Non-binary': '#ab47bc', 'Prefer not to say': '#78909c', 'Not specified': '#78909c' };
  var gLabels = Object.keys(genderCounts);
  new Chart(document.getElementById('gender-chart'), {
    type: 'doughnut',
    data: { labels: gLabels, datasets: [{ data: Object.values(genderCounts), backgroundColor: gLabels.map(function(l) { return genderColors[l] || '#e8a84c'; }), borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: { legend: { position: 'bottom', labels: { color: '#e8e4df', padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } } }
    }
  });

  // Burn experience — grouped horizontal bar (Any Burn vs This Event)
  var burnYes = 0, burnNo = 0, elseYes = 0, elseNo = 0;
  members.forEach(function(m) {
    var fb = val(m, 'First Burn').toLowerCase();
    var fe = val(m, 'First Elsewhere/Nowhere').toLowerCase();
    if (fb === 'yes') burnYes++; else if (fb) burnNo++;
    if (fe && fe !== 'no') elseYes++; else if (fe) elseNo++;
  });
  new Chart(document.getElementById('burns-chart'), {
    type: 'bar',
    data: {
      labels: ['Any Burn', 'This Event'],
      datasets: [
        { label: 'First time', data: [burnYes, elseYes], backgroundColor: '#ff9800', borderRadius: 4 },
        { label: 'Returning', data: [burnNo, elseNo], backgroundColor: '#4caf50', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { labels: { color: '#e8e4df', usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } } },
      scales: {
        x: { stacked: false, ticks: { color: '#8a8580', stepSize: 1 }, grid: { color: '#2a2a2a22' }, beginAtZero: true },
        y: { ticks: { color: '#8a8580' }, grid: { display: false } }
      }
    }
  });

  // Location — horizontal bar, dynamic height
  var locCounts = {};
  members.forEach(function(m) { var v = val(m, 'Location') || 'Unknown'; locCounts[v] = (locCounts[v] || 0) + 1; });
  var locSorted = Object.entries(locCounts).sort(function(a, b) { return b[1] - a[1]; });
  var locHeight = Math.max(180, locSorted.length * 32);
  document.getElementById('location-wrap').style.height = locHeight + 'px';
  new Chart(document.getElementById('location-chart'), {
    type: 'bar',
    data: {
      labels: locSorted.map(function(d) { return d[0]; }),
      datasets: [{ data: locSorted.map(function(d) { return d[1]; }), backgroundColor: '#e8a84c', borderRadius: 4, maxBarThickness: 24 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8a8580', stepSize: 1 }, grid: { color: '#2a2a2a22' }, beginAtZero: true },
        y: { ticks: { color: '#e0e0e0', font: { size: 12 } }, grid: { display: false } }
      }
    }
  });

  // Roster table
  agGrid.createGrid(document.getElementById('roster-grid'), {
    rowData: members.map(function(m) {
      return { 'Playa Name': val(m, 'Playa Name'), Role: val(m, 'Role'), Phone: val(m, 'Phone') };
    }),
    columnDefs: [
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
