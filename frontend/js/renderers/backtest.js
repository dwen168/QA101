function renderBacktestReport(report, panel) {
  const metrics = report.performanceMetrics || {};
  const cap = report.capital || {};
  const signalDist = report.signalDistribution || {};
  const recommendations = report.recommendations || [];
  const warnings = report.warnings || [];
  const horizonProfile = report.horizonProfile || {};
  const equity = report.equityCurve || [];
  const trades = report.tradeLog || [];
  const drawdown = report.drawdownAnalysis || {};
  const risk = report.riskAnalysis || {};
  const dataSource = String(report.dataSource || '').toLowerCase();

  const section = document.createElement('div');
  section.className = 'section-divider fade-in';
  section.innerHTML = `<div class="section-divider-line"></div><span class="section-divider-text">④ backtesting</span><div class="section-divider-line"></div>`;
  panel.appendChild(section);

  const sourceCard = document.createElement('div');
  sourceCard.className = 'fade-in';
  const isLive = dataSource === 'alpha-vantage' || dataSource === 'yahoo-finance';
  const isUnavailable = dataSource === 'unavailable' || !dataSource;
  const statusLabel = isLive ? 'LIVE' : isUnavailable ? 'UNAVAILABLE' : 'MIXED';
  const sourceLabel = dataSource || 'unknown';
  const color = isLive ? 'var(--green)' : isUnavailable ? 'var(--amber)' : 'var(--cyan)';
  const bg = isLive
    ? 'rgba(16,185,129,0.1)'
    : isUnavailable
      ? 'rgba(245,158,11,0.1)'
      : 'rgba(59,130,246,0.1)';
  const border = isLive
    ? 'rgba(16,185,129,0.25)'
    : isUnavailable
      ? 'rgba(245,158,11,0.25)'
      : 'rgba(59,130,246,0.25)';
  sourceCard.style.cssText = `background:${bg};border:1px solid ${border};border-radius:var(--radius);padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px`;
  sourceCard.innerHTML = `
    <div style="font-size:12px;font-weight:500;color:${color}">Data Source: ${statusLabel}</div>
    <div style="font-size:11px;color:var(--text2);font-family:var(--mono)">${sourceLabel}</div>
  `;
  panel.appendChild(sourceCard);

  const summary = document.createElement('div');
  summary.className = 'card fade-in';
  summary.innerHTML = `
    <div class="card-header">
      <span class="card-title">Backtest Summary</span>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span style="font-size:11px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:rgba(59,130,246,0.08);color:var(--cyan);border:1px solid rgba(59,130,246,0.2)">${report.strategyName}</span>
        ${report.timeHorizon ? `<span style="font-size:11px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:rgba(16,185,129,0.08);color:var(--green);border:1px solid rgba(16,185,129,0.25)">${report.timeHorizon} horizon</span>` : ''}
      </div>
    </div>
    <div class="ticker-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-item"><span class="stat-label">TOTAL RETURN</span><span class="stat-value">${(cap.totalReturn ?? 0).toFixed(2)}%</span></div>
      <div class="stat-item"><span class="stat-label">FINAL CAPITAL</span><span class="stat-value">$${(cap.final ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></div>
      <div class="stat-item"><span class="stat-label">SHARPE</span><span class="stat-value">${(metrics.sharpeRatio ?? 0).toFixed(2)}</span></div>
      <div class="stat-item"><span class="stat-label">MAX DD</span><span class="stat-value">${(metrics.maxDrawdown ?? 0).toFixed(1)}%</span></div>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--text2)">${report.ticker} · ${report.period.startDate} to ${report.period.endDate} · ${report.period.tradingDays} trading days</div>
    ${horizonProfile.label ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px"><span class="detail-chip">${horizonProfile.label}</span><span class="detail-chip">Hold: ${horizonProfile.holdingPeriod || '—'}</span><span class="detail-chip">SL: ${horizonProfile.stopLossPercent ?? '—'}%</span><span class="detail-chip">TP: ${horizonProfile.takeProfitPercent ?? '—'}%</span><span class="detail-chip">Max hold: ${horizonProfile.maxHoldingDays ?? '—'}d</span></div>` : ''}
  `;
  panel.appendChild(summary);

  const metricsCard = document.createElement('div');
  metricsCard.className = 'card fade-in';
  metricsCard.innerHTML = `
    <div class="card-header"><span class="card-title">Performance Metrics</span></div>
    <div class="ticker-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-item"><span class="stat-label">TRADES</span><span class="stat-value">${metrics.totalTrades ?? 0}</span></div>
      <div class="stat-item"><span class="stat-label">WIN RATE</span><span class="stat-value">${(metrics.winRate ?? 0).toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-label">PROFIT FACTOR</span><span class="stat-value">${(metrics.profitFactor ?? 0).toFixed(2)}</span></div>
      <div class="stat-item"><span class="stat-label">CAGR</span><span class="stat-value">${(metrics.cagr ?? 0).toFixed(1)}%</span></div>
    </div>
    <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
      <span class="detail-chip">Buy signals: ${signalDist.buySignals ?? 0}</span>
      <span class="detail-chip">Sell signals: ${signalDist.sellSignals ?? 0}</span>
      <span class="detail-chip">Hold days: ${signalDist.holdDays ?? 0}</span>
      <span class="detail-chip">Avg trade: ${(metrics.avgTradeReturn ?? 0).toFixed(2)}%</span>
    </div>
  `;
  panel.appendChild(metricsCard);

  const riskCard = document.createElement('div');
  riskCard.className = 'card fade-in';
  riskCard.innerHTML = `
    <div class="card-header"><span class="card-title">Drawdown & Risk</span></div>
    <div class="ticker-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-item"><span class="stat-label">MAX DD</span><span class="stat-value">${(drawdown.maxDrawdownPercent ?? 0).toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-label">RECOVERY DAYS</span><span class="stat-value">${drawdown.recoveryDays ?? '—'}</span></div>
      <div class="stat-item"><span class="stat-label">MAX LOSS TRADE</span><span class="stat-value">${(risk.maxSingleTradeLoss ?? 0).toFixed(2)}%</span></div>
      <div class="stat-item"><span class="stat-label">MAX LOSS STREAK</span><span class="stat-value">${risk.maxConsecutiveLosses ?? 0}</span></div>
    </div>
    <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
      <span class="detail-chip">Avg win: ${(risk.avgWinSize ?? 0).toFixed(2)}%</span>
      <span class="detail-chip">Avg loss: ${(risk.avgLossSize ?? 0).toFixed(2)}%</span>
      <span class="detail-chip">P/L ratio: ${risk.profitToLossRatio ?? '—'}</span>
      <span class="detail-chip">Drawdown periods: ${(drawdown.drawdownPeriods || []).length}</span>
    </div>
    ${(drawdown.drawdownPeriods || []).length ? `
      <div style="margin-top:12px">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Major Drawdown Periods</div>
        ${(drawdown.drawdownPeriods || []).slice(0, 3).map(period => `
          <div class="risk-flag" style="margin-bottom:6px">
            Peak ${String(period.startDate).slice(0,10)} -> Bottom ${String(period.bottomDate).slice(0,10)} · ${period.maxLoss}% ${period.recoveryDate ? `· Recovered ${String(period.recoveryDate).slice(0,10)}` : '· Not yet recovered'}
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
  panel.appendChild(riskCard);

  // Candlestick chart with buy / sell markers
  const chartCard = document.createElement('div');
  chartCard.className = 'chart-full fade-in';
  chartCard.innerHTML = `<div class="chart-title">Price Chart · Buy &amp; Sell Signals</div><div id="chart-backtest-candle" style="height:320px"></div>`;
  panel.appendChild(chartCard);

  setTimeout(() => {
    const container = document.getElementById('chart-backtest-candle');
    if (!container || typeof LightweightCharts === 'undefined') return;

    const btChart = LightweightCharts.createChart(container, {
      autoSize: true,
      height: 320,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#7a8fb8', fontFamily: "'DM Mono', monospace", fontSize: 11 },
      grid: { vertLines: { color: 'rgba(59,130,246,0.04)' }, horzLines: { color: 'rgba(59,130,246,0.04)' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(59,130,246,0.1)' },
      timeScale: { borderColor: 'rgba(59,130,246,0.1)', timeVisible: false },
      handleScroll: true, handleScale: true,
    });

    const btCandles = btChart.addCandlestickSeries({
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });

    const priceHistory = (report.priceHistory || []).map(p => ({
      time: String(p.date).slice(0, 10),
      open: p.open, high: p.high, low: p.low, close: p.close,
    }));
    if (priceHistory.length) btCandles.setData(priceHistory);

    const btMarkers = [];
    trades.forEach(t => {
      btMarkers.push({
        time: String(t.entryDate).slice(0, 10),
        position: 'belowBar', color: '#10b981', shape: 'arrowUp',
        text: `BUY $${t.entryPrice}`,
      });
      const isWin = (t.pnlDollars ?? t.pnlPercent) >= 0;
      const pnlAbs = Math.abs(t.pnlDollars ?? 0).toFixed(2);
      btMarkers.push({
        time: String(t.exitDate).slice(0, 10),
        position: 'aboveBar',
        color: isWin ? '#10b981' : '#ef4444',
        shape: 'arrowDown',
        text: `${isWin ? '+' : '-'}$${pnlAbs}`,
      });
    });
    btMarkers.sort((a, b) => (a.time < b.time ? -1 : 1));
    if (btMarkers.length) btCandles.setMarkers(btMarkers);

    btChart.timeScale().fitContent();
    currentCharts['backtest-candle'] = btChart;
  }, 50);

  // Portfolio balance line
  const eqCard = document.createElement('div');
  eqCard.className = 'chart-full fade-in';
  eqCard.innerHTML = `<div class="chart-title">Portfolio Balance</div><div class="chart-canvas-wrap" style="height:160px"><canvas id="chart-backtest-equity"></canvas></div>`;
  panel.appendChild(eqCard);
  setTimeout(() => {
    const ctx = document.getElementById('chart-backtest-equity')?.getContext('2d');
    if (!ctx) return;
    currentCharts['backtest-equity'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: equity.map(p => String(p.date).slice(0, 10)),
        datasets: [{
          label: 'Balance',
          data: equity.map(p => p.capital),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          fill: true, tension: 0.2, pointRadius: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#7a8fb8', font: { size: 11, family: "'DM Mono', monospace" } } } },
        scales: {
          x: { ticks: { color: '#3d5080', maxTicksLimit: 8 }, grid: { color: 'rgba(59,130,246,0.04)' }, border: { color: 'rgba(59,130,246,0.1)' } },
          y: { ticks: { color: '#3d5080', callback: v => '$' + Number(v).toFixed(0) }, grid: { color: 'rgba(59,130,246,0.04)' }, border: { color: 'rgba(59,130,246,0.1)' } },
        },
      },
    });
  }, 100);

  if (recommendations.length) {
    const recoCard = document.createElement('div');
    recoCard.className = 'card fade-in';
    recoCard.innerHTML = `
      <div class="card-header"><span class="card-title">Backtest Interpretation</span></div>
      <div class="insight-list">${recommendations.map(r => `<div class="insight-item"><div class="insight-dot"></div><span>${r}</span></div>`).join('')}</div>
    `;
    panel.appendChild(recoCard);
  }

  if (warnings.length) {
    const warningCard = document.createElement('div');
    warningCard.className = 'card fade-in';
    warningCard.innerHTML = `
      <div class="card-header"><span class="card-title">Data Quality Notes</span></div>
      <div style="display:flex;flex-direction:column;gap:6px">${warnings.map(w => `<div class="risk-flag">⚠ ${w}</div>`).join('')}</div>
    `;
    panel.appendChild(warningCard);
  }

  if (trades.length) {
    const tradesCard = document.createElement('div');
    tradesCard.className = 'card fade-in';
    const COL = '36px 94px 68px 94px 68px 60px 82px 90px 80px';
    const MIN_W = '680px';
    tradesCard.innerHTML = `
      <div class="card-header">
        <span class="card-title">Trade Log</span>
        <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${trades.length} trades · initial $${(cap.initial ?? 1000).toLocaleString()}</span>
      </div>
      <div style="overflow-x:auto">
        <div style="display:grid;grid-template-columns:${COL};gap:8px;font-size:10px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:0.08em;padding:0 0 6px;border-bottom:1px solid var(--border);min-width:${MIN_W}">
          <span>#</span><span>Entry</span><span>Buy $</span><span>Exit</span><span>Sell $</span><span>%</span><span>$ P&amp;L</span><span>Balance</span><span>Reason</span>
        </div>
        ${trades.slice(0, 12).map(t => {
          const win = t.pnlPercent >= 0;
          const clr = win ? 'var(--green)' : 'var(--red)';
          const pnlDollar = t.pnlDollars != null ? `${win ? '+' : '-'}$${Math.abs(t.pnlDollars).toFixed(2)}` : '—';
          const balance = t.balanceAfter != null ? `$${t.balanceAfter.toFixed(2)}` : '—';
          return `
            <div style="display:grid;grid-template-columns:${COL};gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:11px;font-family:var(--mono);min-width:${MIN_W}">
              <span style="color:var(--text3)">${t.tradeId}</span>
              <span>${String(t.entryDate).slice(0,10)}</span>
              <span style="color:var(--text2)">$${t.entryPrice != null ? t.entryPrice.toFixed(2) : '—'}</span>
              <span>${String(t.exitDate).slice(0,10)}</span>
              <span style="color:var(--text2)">$${t.exitPrice != null ? t.exitPrice.toFixed(2) : '—'}</span>
              <span style="color:${clr}">${win ? '+' : ''}${t.pnlPercent}%</span>
              <span style="color:${clr}">${pnlDollar}</span>
              <span style="color:var(--text2)">${balance}</span>
              <span style="color:var(--text3);font-size:10px">${t.reason.replace(/_/g,' ')}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
    panel.appendChild(tradesCard);
  }

  panel.scrollTop = 0;
}

window.renderBacktestReport = renderBacktestReport;
