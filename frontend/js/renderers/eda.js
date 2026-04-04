function renderEDA(charts, edaInsights, marketData, panel) {
  const priceHistoryPoints = Array.isArray(marketData.priceHistory) ? marketData.priceHistory.length : 0;
  const rawHistorySource = String(marketData.priceHistorySource || marketData.dataSource || 'unknown').toLowerCase();
  const historySourceLabelMap = {
    'finnhub': 'Finnhub',
    'yahoo-finance-history': 'Yahoo Finance',
    'yahoo-finance': 'Yahoo Finance',
    'alpha-vantage-history': 'Alpha Vantage',
    'alpha-vantage': 'Alpha Vantage',
    'mock-history': 'Mock',
    'mock': 'Mock',
  };
  const historySourceLabel = historySourceLabelMap[rawHistorySource] || marketData.priceHistorySource || marketData.dataSource || 'Unknown';
  const sentimentNews = Array.isArray(marketData.news) ? marketData.news : [];
  const overallSentiment = sentimentNews.length
    ? sentimentNews.reduce((sum, item) => sum + Number(item.sentiment || 0), 0) / sentimentNews.length
    : 0;
  const overallSentimentLabel = overallSentiment > 0.1 ? 'BULLISH' : overallSentiment < -0.1 ? 'BEARISH' : 'NEUTRAL';
  // escapeHtml is defined globally
  const sentimentCellBackground = (value) => {
    const score = Number.isFinite(Number(value)) ? Number(value) : 0;
    const intensity = Math.min(0.9, 0.25 + Math.abs(score) * 0.55);
    return score >= 0
      ? `rgba(16,185,129,${intensity.toFixed(2)})`
      : `rgba(239,68,68,${intensity.toFixed(2)})`;
  };

  const fmtLegendNum = (value) => Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
  const fmtLegendVolume = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    if (numeric >= 1e9) return `${(numeric / 1e9).toFixed(2)}B`;
    if (numeric >= 1e6) return `${(numeric / 1e6).toFixed(2)}M`;
    if (numeric >= 1e3) return `${(numeric / 1e3).toFixed(1)}K`;
    return Math.round(numeric).toLocaleString('en-US');
  };
  const updatePriceLegend = ({ date, candle, volume, ma10, ma20 }) => {
    const legendDate = document.getElementById('tv-legend-date');
    const legendOhlc = document.getElementById('tv-legend-ohlc');
    const legendVolume = document.getElementById('tv-legend-volume');
    const legendMa10 = document.getElementById('tv-legend-ma10');
    const legendMa20 = document.getElementById('tv-legend-ma20');
    if (legendDate) legendDate.textContent = date || '—';
    if (legendOhlc) {
      legendOhlc.textContent = candle
        ? `O ${fmtLegendNum(candle.open)} H ${fmtLegendNum(candle.high)} L ${fmtLegendNum(candle.low)} C ${fmtLegendNum(candle.close)}`
        : '—';
    }
    if (legendVolume) legendVolume.textContent = fmtLegendVolume(volume);
    if (legendMa10) legendMa10.textContent = fmtLegendNum(ma10);
    if (legendMa20) legendMa20.textContent = fmtLegendNum(ma20);
  };

  // Divider
  const div1 = document.createElement('div');
  div1.className = 'section-divider fade-in';
  div1.innerHTML = `<div class="section-divider-line"></div><span class="section-divider-text">② eda-visual-analysis</span><div class="section-divider-line"></div>`;
  panel.appendChild(div1);

  const chartDefaults = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#7a8fb8', font: { size: 11, family: "'DM Mono', monospace" }, boxWidth: 12, padding: 8 } } },
    scales: {
      x: { ticks: { color: '#3d5080', font: { size: 10, family: "'DM Mono', monospace" }, maxRotation: 0, maxTicksLimit: 8 }, grid: { color: 'rgba(59,130,246,0.04)' }, border: { color: 'rgba(59,130,246,0.1)' } },
      y: { ticks: { color: '#3d5080', font: { size: 10, family: "'DM Mono', monospace" } }, grid: { color: 'rgba(59,130,246,0.04)' }, border: { color: 'rgba(59,130,246,0.1)' } },
    },
  };

  // Price chart (full width — TradingView Lightweight Charts)
  const priceWrap = document.createElement('div');
  priceWrap.className = 'chart-full fade-in';
  priceWrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="chart-title-group">
        <div class="chart-title" style="margin-bottom:0">${marketData.ticker} — Candlestick &amp; Volume · up to 2Y</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">History Source: ${historySourceLabel} · Points: ${priceHistoryPoints}</div>
        <div class="chart-legend">
          <span class="chart-legend-item"><span class="chart-legend-swatch candle"></span>Price Candles</span>
          <span class="chart-legend-item"><span class="chart-legend-swatch volume"></span>Volume</span>
          <button type="button" class="chart-legend-item" id="tv-toggle-ma10"><span class="chart-legend-swatch ma10"></span>MA10 (10-day average)</button>
          <button type="button" class="chart-legend-item" id="tv-toggle-ma20"><span class="chart-legend-swatch ma20"></span>MA20 (20-day average)</button>
        </div>
        <div class="chart-legend-values">
          <span class="chart-legend-value chart-legend-date">Date: <strong id="tv-legend-date">—</strong></span>
          <span class="chart-legend-value">OHLC: <strong id="tv-legend-ohlc">—</strong></span>
          <span class="chart-legend-value">Volume: <strong id="tv-legend-volume">—</strong></span>
          <span class="chart-legend-value">MA10: <strong id="tv-legend-ma10">—</strong></span>
          <span class="chart-legend-value">MA20: <strong id="tv-legend-ma20">—</strong></span>
        </div>
      </div>
      <div class="range-selector">
        <button class="range-btn" onclick="setTVRange(7,this)">1W</button>
        <button class="range-btn" onclick="setTVRange(30,this)">1M</button>
        <button class="range-btn" onclick="setTVRange(90,this)">3M</button>
        <button class="range-btn" onclick="setTVRange(180,this)">6M</button>
        <button class="range-btn" onclick="setTVRange(365,this)">1Y</button>
        <button class="range-btn active" id="tv-default-range-btn" onclick="setTVRange(730,this)">2Y</button>
      </div>
    </div>
    <div id="tv-price-container" style="height:280px"></div>
  `;
  panel.appendChild(priceWrap);
  setTimeout(() => {
    const tvContainer = document.getElementById('tv-price-container');
    const tvChart = LightweightCharts.createChart(tvContainer, {
      autoSize: true,
      height: 280,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#7a8fb8', fontFamily: "'DM Mono', monospace", fontSize: 11 },
      grid: { vertLines: { color: 'rgba(59,130,246,0.04)' }, horzLines: { color: 'rgba(59,130,246,0.04)' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(59,130,246,0.1)' },
      timeScale: { borderColor: 'rgba(59,130,246,0.1)', timeVisible: false },
      handleScroll: true, handleScale: true,
    });

    const candleSeries = tvChart.addCandlestickSeries({
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });
    const volSeries = tvChart.addHistogramSeries({
      color: 'rgba(59,130,246,0.25)', priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    });
    tvChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const ma10S = tvChart.addLineSeries({ color: '#f59e0b', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    const ma20S = tvChart.addLineSeries({ color: '#10b981', lineWidth: 1, lineStyle: 3, priceLineVisible: false, lastValueVisible: false });
    const ma10Toggle = document.getElementById('tv-toggle-ma10');
    const ma20Toggle = document.getElementById('tv-toggle-ma20');
    let ma10Visible = true;
    let ma20Visible = true;
    const syncSeriesToggle = (button, isVisible, series) => {
      button?.classList.toggle('is-off', !isVisible);
      series.applyOptions({ visible: isVisible });
    };
    ma10Toggle?.addEventListener('click', () => {
      ma10Visible = !ma10Visible;
      syncSeriesToggle(ma10Toggle, ma10Visible, ma10S);
    });
    ma20Toggle?.addEventListener('click', () => {
      ma20Visible = !ma20Visible;
      syncSeriesToggle(ma20Toggle, ma20Visible, ma20S);
    });

    const sorted = [...(marketData.priceHistory || [])].sort((a, b) => a.date < b.date ? -1 : 1);
    const tvCandleData = sorted.map(d => {
      const o = d.open || d.close, c = d.close;
      return { time: d.date, open: o, high: Math.max(d.high || c, o, c), low: Math.min(d.low || c, o, c), close: c };
    });
    const tvVolData = sorted.map(d => ({
      time: d.date, value: d.volume,
      color: d.close >= d.open ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)',
    }));
    const tvVolMap = new Map(tvVolData.map((item) => [item.time, item.value]));
    const closes = sorted.map(d => d.close);
    const tvMa10 = [], tvMa20 = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i >= 9) tvMa10.push({ time: sorted[i].date, value: parseFloat((closes.slice(i-9,i+1).reduce((s,v)=>s+v,0)/10).toFixed(2)) });
      if (i >= 19) tvMa20.push({ time: sorted[i].date, value: parseFloat((closes.slice(i-19,i+1).reduce((s,v)=>s+v,0)/20).toFixed(2)) });
    }
    const tvMa10Map = new Map(tvMa10.map((item) => [item.time, item.value]));
    const tvMa20Map = new Map(tvMa20.map((item) => [item.time, item.value]));

    candleSeries.setData(tvCandleData);
    volSeries.setData(tvVolData);
    ma10S.setData(tvMa10);
    ma20S.setData(tvMa20);
    const latestCandle = tvCandleData[tvCandleData.length - 1] || null;
    updatePriceLegend({
      date: latestCandle?.time,
      candle: latestCandle,
      volume: latestCandle ? tvVolMap.get(latestCandle.time) : null,
      ma10: latestCandle ? tvMa10Map.get(latestCandle.time) : null,
      ma20: latestCandle ? tvMa20Map.get(latestCandle.time) : null,
    });
    tvChart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        updatePriceLegend({
          date: latestCandle?.time,
          candle: latestCandle,
          volume: latestCandle ? tvVolMap.get(latestCandle.time) : null,
          ma10: latestCandle ? tvMa10Map.get(latestCandle.time) : null,
          ma20: latestCandle ? tvMa20Map.get(latestCandle.time) : null,
        });
        return;
      }

      const candleData = param.seriesData.get(candleSeries);
      const ma10Data = param.seriesData.get(ma10S);
      const ma20Data = param.seriesData.get(ma20S);
      const time = typeof param.time === 'string'
        ? param.time
        : param.time?.year
          ? `${param.time.year}-${String(param.time.month).padStart(2, '0')}-${String(param.time.day).padStart(2, '0')}`
          : latestCandle?.time;

      updatePriceLegend({
        date: time,
        candle: candleData || latestCandle,
        volume: tvVolMap.get(time),
        ma10: ma10Data?.value ?? tvMa10Map.get(time),
        ma20: ma20Data?.value ?? tvMa20Map.get(time),
      });
    });
    setTVRange(730, document.getElementById('tv-default-range-btn'));
    currentCharts['tv-price'] = tvChart;
    currentCharts['tv-price-data'] = tvCandleData;
  }, 50);

  // Analyst + Sentiment grid
  const chartGrid = document.createElement('div');
  chartGrid.className = 'chart-grid fade-in';
  chartGrid.innerHTML = `
    <div class="chart-wrap"><div class="chart-title">${charts.analystChart.title}</div><div class="chart-canvas-wrap"><canvas id="chart-analyst"></canvas></div></div>
    <div class="chart-wrap">
      <div class="chart-title">${marketData.ticker} - News Sentiment Heatmap</div>
      <div class="news-heatmap-summary">Overall Sentiment: <strong style="color:${overallSentiment > 0.1 ? 'var(--green)' : overallSentiment < -0.1 ? 'var(--red)' : 'var(--amber)'}">${overallSentiment > 0 ? '+' : ''}${overallSentiment.toFixed(2)} (${overallSentimentLabel})</strong></div>
      <div class="news-heatmap" id="news-heatmap">
        ${sentimentNews.length > 0 ? sentimentNews.map((item, index) => {
          const score = Number(item.sentiment || 0);
          return `<button type="button" class="news-heatmap-cell" data-index="${index}" style="background:${sentimentCellBackground(score)}">${score > 0 ? '+' : ''}${score.toFixed(2)}</button>`;
        }).join('') : `<div class="news-heatmap-hover" style="grid-column:1/-1;margin-top:0">No news sentiment data available.</div>`}
      </div>
      <div class="news-heatmap-hover" id="news-heatmap-hover">Hover a cell to view headline and sentiment score.</div>
    </div>
  `;
  panel.appendChild(chartGrid);
  setTimeout(() => {
    const ctxA = document.getElementById('chart-analyst').getContext('2d');
    currentCharts['analyst'] = new Chart(ctxA, { type: 'doughnut', data: charts.analystChart.data, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#7a8fb8', font: { size: 10, family: "'DM Mono', monospace" }, boxWidth: 10, padding: 6 } } }, cutout: '65%' } });
    const heatmapHover = document.getElementById('news-heatmap-hover');
    const heatmapCells = Array.from(document.querySelectorAll('#news-heatmap .news-heatmap-cell'));
    heatmapCells.forEach((cell) => {
      cell.addEventListener('mouseenter', () => {
        const index = Number(cell.getAttribute('data-index'));
        const item = sentimentNews[index];
        if (!item || !heatmapHover) return;
        const score = Number(item.sentiment || 0);
        heatmapHover.innerHTML = `<strong>${score > 0 ? '+' : ''}${score.toFixed(2)}</strong> · ${escapeHtml(item.title || 'Untitled')} <span style="color:var(--text3)">(${escapeHtml(item.source || 'Unknown')})</span>`;
      });
    });
  }, 50);

  // RSI gauge (standalone)
  const rsiCard = document.createElement('div');
  rsiCard.className = 'chart-wrap fade-in';
  const rsiColor = marketData.rsi > 70 ? 'var(--red)' : marketData.rsi < 30 ? 'var(--cyan)' : 'var(--green)';
  const rsiLabel = marketData.rsi > 70 ? 'OVERBOUGHT' : marketData.rsi < 30 ? 'OVERSOLD' : 'NEUTRAL';
  rsiCard.style.cssText = 'display:flex;flex-direction:column;justify-content:center';
  rsiCard.innerHTML = `
    <div class="chart-title">RSI Indicator</div>
    <div class="rsi-gauge">
      <div class="rsi-number" style="color:${rsiColor}">${marketData.rsi}</div>
      <div class="rsi-label" style="background:rgba(0,0,0,0.2);color:${rsiColor}">${rsiLabel}</div>
      <div class="rsi-bar-track" style="width:100%">
        <div class="rsi-marker" style="left:${marketData.rsi}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;width:100%;font-size:10px;color:var(--text3);font-family:var(--mono)"><span>0</span><span>30</span><span>70</span><span>100</span></div>
    </div>
  `;
  panel.appendChild(rsiCard);

  // EDA insights
  const insightCard = document.createElement('div');
  insightCard.className = 'card fade-in';
  insightCard.innerHTML = `
    <div class="card-header">
      <span class="card-title">EDA Insights</span>
      <span style="font-size:11px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:rgba(16,185,129,0.1);color:var(--green)">Momentum: ${edaInsights.momentumSignal || 'N/A'}</span>
    </div>
    <div class="insight-list">${(edaInsights.insights || []).map(i => `<div class="insight-item"><div class="insight-dot"></div><span>${i}</span></div>`).join('')}</div>
    ${(edaInsights.riskFlags || []).length ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">${(edaInsights.riskFlags || []).map(r => `<div class="risk-flag">⚠ ${r}</div>`).join('')}</div>` : ''}
  `;
  panel.appendChild(insightCard);
}

window.renderEDA = renderEDA;
