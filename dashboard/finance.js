let financeBarRef = null, revenueLineRef = null, expensePieRef = null;

async function loadFinance() {
  const year = Number(document.getElementById('financeYear').value) || new Date().getFullYear();
  const [orderStats, expenseStats, monthlyData, expensesByCategory] = await Promise.all([
    DB.getOrderStats(),
    DB.getExpenseStats(),
    DB.getMonthlyData(year),
    DB.getExpensesByCategory(year),
  ]);
  const net = orderStats.allRevenue - expenseStats.total;
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // Stats cards
  document.getElementById('financeStats').innerHTML = `
    ${statCard('Ingresos brutos', formatPrice(orderStats.allRevenue), 'fa-arrow-trend-up', 'green', `${orderStats.total} pedidos (excl. cancelados)`)}
    ${statCard('Gastos totales', formatPrice(expenseStats.total), 'fa-arrow-trend-down', 'red', `${expenseStats.count} registros de gasto`)}
    ${statCard('Utilidad neta', formatPrice(net), 'fa-coins', net >= 0 ? 'green' : 'red', net >= 0 ? 'Balance positivo' : 'Balance negativo')}
    ${statCard('Pedidos entregados', formatPrice(orderStats.revenue), 'fa-box-open', 'blue', `${orderStats.delivered} pedidos entregados`)}
    ${statCard('Ticket promedio', formatPrice(orderStats.total ? Math.round(orderStats.allRevenue / orderStats.total) : 0), 'fa-calculator', 'purple', 'Por pedido')}`;

  // Bar chart: Ingresos vs Gastos por mes
  if (financeBarRef) financeBarRef.destroy();
  const barCtx = document.getElementById('financeBarChart');
  if (barCtx) {
    financeBarRef = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          {
            label: 'Ingresos',
            data: monthlyData.map(m => m.revenue),
            backgroundColor: 'rgba(26,92,46,.8)',
            borderRadius: 6,
          },
          {
            label: 'Gastos',
            data: monthlyData.map(m => m.expenses),
            backgroundColor: 'rgba(220,38,38,.7)',
            borderRadius: 6,
          },
          {
            label: 'Utilidad',
            data: monthlyData.map(m => m.revenue - m.expenses),
            type: 'line',
            borderColor: 'rgba(201,169,110,1)',
            backgroundColor: 'rgba(201,169,110,.1)',
            borderWidth: 2.5,
            pointBackgroundColor: 'rgba(201,169,110,1)',
            pointRadius: 4,
            fill: true,
            tension: 0.4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index' },
        plugins: {
          legend: { position: 'top' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatPrice(ctx.raw)}` } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => '$ ' + v.toLocaleString('es-MX') } }
        }
      }
    });
  }

  // Line chart: Ingresos por mes
  if (revenueLineRef) revenueLineRef.destroy();
  const lineCtx = document.getElementById('revenueLineChart');
  if (lineCtx) {
    revenueLineRef = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: 'Ingresos',
          data: monthlyData.map(m => m.revenue),
          borderColor: 'rgba(26,92,46,1)',
          backgroundColor: 'rgba(26,92,46,.1)',
          borderWidth: 2.5,
          pointBackgroundColor: 'rgba(26,92,46,1)',
          fill: true,
          tension: 0.4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatPrice(ctx.raw) } } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString('es-MX') } } }
      }
    });
  }

  // Pie chart: gastos por categoría
  if (expensePieRef) expensePieRef.destroy();
  const pieCtx = document.getElementById('expensePieChart');
  if (pieCtx) {
    const catLabels = expensesByCategory.map(e => EXPENSE_CATEGORIES[e.category] || e.category);
    const catValues = expensesByCategory.map(e => e.total);

    if (catValues.length === 0) {
      pieCtx.parentNode.innerHTML = '<p style="text-align:center;color:var(--gray-400);padding:40px 0;font-size:13px">Sin gastos registrados aún.</p>';
    } else {
      expensePieRef = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
          labels: catLabels,
          datasets: [{
            data: catValues,
            backgroundColor: ['#1a5c2e','#c9a96e','#3b82f6','#f59e0b','#8b5cf6'],
            borderWidth: 0,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatPrice(ctx.raw)}` } }
          }
        }
      });
    }
  }
}
