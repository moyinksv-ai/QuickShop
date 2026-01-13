/* report.js - implements renderReportsChart using Chart.js */
(function(){
  'use strict';
  
  const $ = id => document.getElementById(id);

  window.renderReportsChart = function(buckets){
    try {
      if (!buckets || !Array.isArray(buckets)) return;
      // detect canvas
      const canvas = document.getElementById('reportChart');
      if (!canvas) return;
      
      // prepare labels and datasets - using window.n for safety
      const labels = buckets.map(b => b.label || (new Date(b.start)).toLocaleDateString());
      const units = buckets.map(b => window.n(b.units || 0));
      const revenue = buckets.map(b => window.n(b.revenue || 0));
      
      // destroy previous instance safely
      try { if (window._reportsChartInstance && window._reportsChartInstance.destroy) window._reportsChartInstance.destroy(); } catch(e){}
      
      const ctx = canvas.getContext('2d');
      // create chart
      window._reportsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              type: 'bar',
              label: 'Units',
              data: units,
              yAxisID: 'y-left', // Left Y-axis
              backgroundColor: 'rgba(6, 182, 212, 0.6)',
              borderColor: 'rgba(6, 182, 212, 1)',
              borderWidth: 1,
              borderRadius: 4,
              barPercentage: 0.6,
              categoryPercentage: 0.6
            },
            {
              type: 'line',
              label: 'Revenue',
              data: revenue,
              yAxisID: 'y-right', // Right Y-axis
              borderColor: 'rgba(18, 183, 106, 1)',
              backgroundColor: 'rgba(18, 183, 106, 0.1)',
              tension: 0.3,
              pointRadius: 3,
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            'y-left': { // Left Y-axis (Units)
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              title: { display: true, text: 'Units' },
              grid: {
                drawOnChartArea: false // Only draw grid for one axis
              }
            },
            'y-right': { // Right Y-axis (Revenue)
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              title: { display: true, text: 'Revenue' },
              grid: { drawOnChartArea: true } // Draw grid for this axis
            }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: function(context){
                  const idx = context.dataIndex;
                  const dsLabel = context.dataset.label || '';
                  const v = context.dataset.data[idx] || 0;
                  // Use window.fmt for currency
                  if (dsLabel === 'Revenue') return dsLabel + ': ' + window.fmt(v);
                  return dsLabel + ': ' + parseInt(v,10);
                }
              }
            },
            legend: { position: 'top' }
          }
        }
      });

      const updatedEl = $('reportChartUpdated');
      if (updatedEl) {
        updatedEl.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
      }

    } catch(e){ console.error('renderReportsChart error', e); }
  };
})();
