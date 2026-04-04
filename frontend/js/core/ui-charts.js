// Shared frontend chart instances and chart interaction helpers.
let currentCharts = {};
function setTVRange(days, btn) {
  const tvChart = currentCharts['tv-price'];
  const tvData = currentCharts['tv-price-data'];
  if (!tvChart || !tvData || tvData.length === 0) return;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (days === 0) { tvChart.timeScale().fitContent(); return; }
  const toStr = tvData[tvData.length - 1].time;
  const fromDate = new Date(toStr);
  fromDate.setDate(fromDate.getDate() - days);
  const fromStr = fromDate.toISOString().split('T')[0];
  const firstStr = tvData[0].time;
  tvChart.timeScale().setVisibleRange({ from: fromStr < firstStr ? firstStr : fromStr, to: toStr });
}

function destroyCharts() {
  Object.entries(currentCharts).forEach(([key, c]) => {
    if (!c) return;
    if (key === 'tv-price' || key === 'backtest-candle') { try { c.remove(); } catch(e) {} }
    else if (key !== 'tv-price-data') { try { c.destroy(); } catch(e) {} }
  });
  currentCharts = {};
}

window.setTVRange = setTVRange;
window.destroyCharts = destroyCharts;
