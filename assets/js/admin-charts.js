window.JH = window.JH || {};

Chart.defaults.color = '#8a8580';
Chart.defaults.font.family = 'Inter';

JH.barOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#8a8580' }, grid: { display: false } },
    y: { ticks: { color: '#8a8580', stepSize: 1, precision: 0 }, grid: { color: '#2a2a2a22' }, beginAtZero: true }
  }
};

JH.makeBar = function(id, labels, data) {
  new Chart(document.getElementById(id), {
    type: 'bar',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: '#e8a84c', borderRadius: 4, maxBarThickness: 48 }] },
    options: JH.barOpts
  });
};

JH.budgetColors = ['#e8a84c','#4fc3f7','#f06292','#ab47bc','#66bb6a','#ff7043','#42a5f5','#ffca28','#26c6da','#ec407a','#8d6e63','#78909c'];
