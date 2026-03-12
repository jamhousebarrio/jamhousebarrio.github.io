(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var data = await JH.fetchBudget();
  var items = data.filter(function(d) { return d['Category'] && d['Budget Allowed']; });
  var parsed = items.map(function(d) {
    return {
      category: d['Category'].trim(),
      amount: parseFloat(d['Budget Allowed'].toString().replace(/[^0-9.-]/g, '')) || 0
    };
  }).filter(function(d) { return d.amount > 0; }).sort(function(a, b) { return b.amount - a.amount; });

  var total = parsed.reduce(function(s, d) { return s + d.amount; }, 0);
  document.getElementById('stat-budget-total').textContent = '\u20AC' + total.toLocaleString();
  document.getElementById('stat-budget-categories').textContent = parsed.length;
  document.getElementById('stat-budget-largest').textContent = parsed.length ? parsed[0].category : '-';
  document.getElementById('budget-item-count').textContent = parsed.length + ' categories';

  var barColors = parsed.map(function(_, i) { return JH.budgetColors[i % JH.budgetColors.length]; });

  // Horizontal bar chart
  new Chart(document.getElementById('budget-bar-chart'), {
    type: 'bar',
    data: { labels: parsed.map(function(d) { return d.category; }), datasets: [{ data: parsed.map(function(d) { return d.amount; }), backgroundColor: barColors, borderRadius: 4, maxBarThickness: 48 }] },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8a8580', callback: function(v) { return '\u20AC' + v; } }, grid: { color: '#2a2a2a22' }, beginAtZero: true },
        y: { ticks: { color: '#8a8580' }, grid: { display: false } }
      }
    }
  });

  // Doughnut chart
  new Chart(document.getElementById('budget-pie-chart'), {
    type: 'doughnut',
    data: { labels: parsed.map(function(d) { return d.category; }), datasets: [{ data: parsed.map(function(d) { return d.amount; }), backgroundColor: barColors, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: { legend: { position: 'bottom', labels: { color: '#e8e4df', padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } } }
    }
  });

  // Table
  document.getElementById('budget-tbody').innerHTML = parsed.map(function(d) {
    var pct = total > 0 ? ((d.amount / total) * 100).toFixed(1) : 0;
    return '<tr>' +
      '<td class="name">' + d.category + '</td>' +
      '<td style="text-align:right;">\u20AC' + d.amount.toLocaleString() + '</td>' +
      '<td style="text-align:right;">' + pct + '%</td>' +
      '</tr>';
  }).join('');
})();
