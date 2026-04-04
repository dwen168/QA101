function renderMarketIntelligence(d, llm, panel, dataSource = 'unknown', usedFallback = false, fallbackReason = null) {
  const normalizedDataSource = String(dataSource || '').toLowerCase();
  const changeClass = d.changePercent >= 0 ? 'up' : 'down';
  const changeSign = d.changePercent >= 0 ? '+' : '';

  const trendClass = d.trend === 'BULLISH' ? 'bullish' : d.trend === 'BEARISH' ? 'bearish' : 'neutral';
  const sentColor = d.sentimentScore > 0.1 ? 'var(--green)' : d.sentimentScore < -0.1 ? 'var(--red)' : 'var(--amber)';
  const sentPct = ((d.sentimentScore + 1) / 2 * 100).toFixed(0);
  const macro = d.macroContext || {};
  const macroScore = Number.isFinite(macro.sentimentScore) ? macro.sentimentScore : 0;
  const macroColor = macroScore > 0.1 ? 'var(--green)' : macroScore < -0.1 ? 'var(--red)' : 'var(--amber)';
  const macroPct = ((macroScore + 1) / 2 * 100).toFixed(0);
  const macroNews = Array.isArray(macro.news) ? macro.news : [];
  const sectorTrends = Array.isArray(d.sectorTrends) ? d.sectorTrends : [];
  const benchmarkTrend = d.benchmarkTrend && Array.isArray(d.benchmarkTrend.history) ? d.benchmarkTrend : null;
  const monetaryPolicy = macro.monetaryPolicy || {};
  const renderMacroThemeChip = (theme) => `<span class="detail-chip macro-theme-chip">${String(theme || 'GENERAL_MACRO').replace(/_/g, ' ')}</span>`;
  const renderPolicyChip = (policy) => {
    const bias = String(policy?.bias || 'WATCH').toUpperCase();
    const color = bias === 'EASING'
      ? 'var(--green)'
      : bias === 'TIGHTENING'
        ? 'var(--red)'
        : 'var(--cyan)';
    return `<span class="detail-chip macro-theme-chip" style="color:${color};border-color:${color === 'var(--green)' ? 'rgba(16,185,129,0.25)' : color === 'var(--red)' ? 'rgba(239,68,68,0.25)' : 'rgba(59,130,246,0.25)'}">${policy?.bank || 'POLICY'} · ${bias}</span>`;
  };
  const displayedMacroNews = (() => {
    const topSix = macroNews.slice(0, 6);
    const policyItem = macroNews.find((item) => String(item?.theme || '').toUpperCase() === 'MONETARY_POLICY');
    if (!policyItem || topSix.some((item) => item?.title === policyItem.title)) {
      return topSix;
    }
    return [policyItem, ...topSix.slice(0, 5)];
  })();
  const hasMonetaryTheme = (macro.dominantThemes || []).some((item) => String(item?.theme || '').toUpperCase() === 'MONETARY_POLICY')
    || macroNews.some((item) => String(item?.theme || '').toUpperCase() === 'MONETARY_POLICY');
  const dominantThemeChips = (macro.dominantThemes || []).slice(0, 3).map((item) => renderMacroThemeChip(item.theme)).join('');

  const fmtNum = (n) => n?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '—';
  const sourceBreakdown = d.dataSourceBreakdown || {};
  const isMockSource = (source) => /mock/i.test(String(source || ''));
  const nonShortKeys = ['price', 'technicals', 'news', 'macro'];
  const hasNonShortMock = nonShortKeys.some((key) => isMockSource(sourceBreakdown[key]));
  const suppressShortOnlyMockHeadline = normalizedDataSource !== 'mock' && !hasNonShortMock;
  const showMockHeadline = usedFallback && !suppressShortOnlyMockHeadline;

  // Data source banner
  if (showMockHeadline) {
    const banner = document.createElement('div');
    banner.className = 'fade-in';
    banner.style.cssText = 'background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px';
    banner.innerHTML = `
      <span style="font-size:16px">⚠️</span>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:500;color:var(--amber)">Using Mock Data</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;font-family:var(--mono)">${fallbackReason || 'Live API unavailable, using demo data'}</div>
      </div>
    `;
    panel.appendChild(banner);
  } else if (normalizedDataSource === 'alpha-vantage') {
    const banner = document.createElement('div');
    banner.className = 'fade-in';
    banner.style.cssText = 'background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px';
    banner.innerHTML = `
      <span style="font-size:16px">✓</span>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:500;color:var(--green)">Live Market Data</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;font-family:var(--mono)">Real-time data from Finnhub, Yahoo, Alpha</div>
      </div>
    `;
    panel.appendChild(banner);
  } else if (normalizedDataSource === 'yahoo-finance') {
    const banner = document.createElement('div');
    banner.className = 'fade-in';
    banner.style.cssText = 'background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px';
    banner.innerHTML = `
      <span style="font-size:16px">✓</span>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:500;color:var(--green)">Live Market Data</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;font-family:var(--mono)">Real-time data from Finnhub, Yahoo, Alpha</div>
      </div>
    `;
    panel.appendChild(banner);
  } else if (normalizedDataSource === 'finnhub') {
    const banner = document.createElement('div');
    banner.className = 'fade-in';
    banner.style.cssText = 'background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px';
    banner.innerHTML = `
      <span style="font-size:16px">✓</span>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:500;color:var(--green)">Live Market Data</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;font-family:var(--mono)">Real-time data from Finnhub, Yahoo, Alpha</div>
      </div>
    `;
    panel.appendChild(banner);
  } else if (normalizedDataSource === 'alpha-vantage-history') {
    const banner = document.createElement('div');
    banner.className = 'fade-in';
    banner.style.cssText = 'background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px';
    banner.innerHTML = `
      <span style="font-size:16px">ℹ</span>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:500;color:var(--cyan)">Live Market Data</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;font-family:var(--mono)">Real-time data from Finnhub, Yahoo, Alpha</div>
      </div>
    `;
    panel.appendChild(banner);
  }

  // Divider
  const div0 = document.createElement('div');
  div0.className = 'section-divider fade-in';
  div0.innerHTML = `<div class="section-divider-line"></div><span class="section-divider-text">① market-intelligence</span><div class="section-divider-line"></div>`;
  panel.appendChild(div0);

  // Ticker header
  const header = document.createElement('div');
  header.className = 'ticker-header fade-in';
  
  // Determine data source label and color
  let sourceLabel = 'unknown';
  let sourceColor = 'var(--text3)';
  if (showMockHeadline) {
    sourceLabel = 'mock data';
    sourceColor = 'var(--amber)';
  } else if (normalizedDataSource === 'alpha-vantage') {
    sourceLabel = 'alpha vantage';
    sourceColor = 'var(--green)';
  } else if (normalizedDataSource === 'yahoo-finance') {
    sourceLabel = 'yahoo finance';
    sourceColor = 'var(--green)';
  } else if (normalizedDataSource === 'finnhub') {
    sourceLabel = 'finnhub';
    sourceColor = 'var(--green)';
  } else if (normalizedDataSource === 'alpha-vantage-history') {
    sourceLabel = 'mixed live';
    sourceColor = 'var(--cyan)';
  }
  
  header.innerHTML = `
    <div class="ticker-main">
      <div class="ticker-left">
        <span class="ticker-symbol">${d.ticker}</span>
        <span class="ticker-name">${d.name}</span>
        <span class="ticker-sector">${d.sector}</span>
        ${d.industry && d.industry !== d.sector ? `<span class="ticker-sector" style="opacity:0.65">${d.industry}</span>` : ''}
        ${d.exchange ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono);padding:2px 5px;background:rgba(255,255,255,0.04);border-radius:3px;border:1px solid var(--border)">${d.exchange}</span>` : ''}
        <span style="font-size:10px;color:${sourceColor};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;margin-left:4px;padding:2px 6px;background:rgba(255,255,255,0.05);border-radius:3px">${sourceLabel}</span>
      </div>
      ${d.description ? `
      <div style="margin-top:8px;font-size:12px;color:var(--text2);line-height:1.6;max-width:720px;padding:8px 10px;border-left:2px solid rgba(59,130,246,0.35);background:rgba(59,130,246,0.04);border-radius:0 6px 6px 0">
        <span style="font-size:10px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;color:var(--cyan);font-weight:600">Business</span>
        <span style="margin-left:8px">${d.description}</span>
        ${d.employees ? `<span style="margin-left:10px;font-size:10px;font-family:var(--mono);color:var(--text3)">${Number(d.employees).toLocaleString()} employees</span>` : ''}
        ${d.website ? `<a href="${d.website}" target="_blank" rel="noopener noreferrer" style="margin-left:10px;font-size:10px;font-family:var(--mono);color:var(--cyan);text-decoration:none;opacity:0.7">${d.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>` : ''}
      </div>
      ` : ''}
      <div class="ticker-right">
        <div class="ticker-price">$${fmtNum(d.price)}</div>
        <div class="ticker-change ${changeClass}">${changeSign}${fmtNum(d.change)} (${changeSign}${d.changePercent.toFixed(2)}%)</div>
      </div>
    </div>
    <div class="ticker-stats">
      <span class="stat-label">52W HIGH</span>
      <span class="stat-label">52W LOW</span>
      <span class="stat-label">P/E RATIO</span>
      <span class="stat-label">EPS</span>
      <span class="stat-label">SHORT %</span>
      <span class="stat-value">$${fmtNum(d.high52w)}</span>
      <span class="stat-value">$${fmtNum(d.low52w)}</span>
      <span class="stat-value">${d.pe}x</span>
      <span class="stat-value">$${d.eps}</span>
      <span class="stat-value">${Number.isFinite(Number(d.shortMetrics?.shortPercent)) ? `${Number(d.shortMetrics.shortPercent).toFixed(2)}%` : '—'}</span>
    </div>
    ${d.dataSourceBreakdown ? `
    <div style="margin-top:8px;font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.5px">Data Source:</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1)">
      ${Object.entries(d.dataSourceBreakdown).map(([key, source]) => {
        const isReal = source && !source.includes('Mock') && !source.includes('unavailable') && source !== 'N/A';
        const isMock = source && source.includes('Mock');
        const isShortMetrics = key === 'shortMetrics';
        const color = isReal ? 'rgba(16,185,129,0.2)' : isMock ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)';
        const textColor = isReal ? 'var(--green)' : isMock ? 'var(--amber)' : 'var(--text3)';
        const label = key.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
        const sourceText = isShortMetrics && isMock ? `${source} (Only short data is mocked; core market data is live.)` : source;
        return `<div style="font-size:9px;padding:2px 6px;background:${color};color:${textColor};border-radius:3px;font-family:var(--mono)">${label}: ${sourceText}</div>`;
      }).join('')}
    </div>
    ` : ''}
  `;
  panel.appendChild(header);

  // Intel grid
  const grid = document.createElement('div');
  grid.className = 'intel-grid fade-in';
  grid.innerHTML = `
    <div class="intel-card">
      <div class="intel-label">Trend</div>
      <div class="trend-badge ${trendClass}">${d.trend === 'BULLISH' ? '▲' : d.trend === 'BEARISH' ? '▼' : '→'} ${d.trend}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">MA20: $${fmtNum(d.ma20)} · MA50: $${fmtNum(d.ma50)}</div>
    </div>
    <div class="intel-card">
      <div class="intel-label">Sentiment</div>
      <div class="intel-value" style="color:${sentColor}">${d.sentimentLabel} (${d.sentimentScore > 0 ? '+' : ''}${d.sentimentScore.toFixed(2)})</div>
      <div class="sentiment-bar"><div class="sentiment-fill" style="width:${sentPct}%;background:${sentColor}"></div></div>
    </div>
    <div class="intel-card">
      <div class="intel-label">Analyst Consensus</div>
      <div style="font-size:11px;margin-top:2px">
        <span style="color:var(--green)">▲ Buy: ${d.analystConsensus.strongBuy + d.analystConsensus.buy}</span> ·
        <span style="color:var(--amber)">Hold: ${d.analystConsensus.hold}</span> ·
        <span style="color:var(--red)">▼ Sell: ${d.analystConsensus.sell + d.analystConsensus.strongSell}</span>
      </div>
      <div style="margin-top:8px">
        <div class="target-range-labels"><span>$${fmtNum(d.analystConsensus.targetLow)}</span><span>Target Mean: $${fmtNum(d.analystConsensus.targetMean)}</span><span>$${fmtNum(d.analystConsensus.targetHigh)}</span></div>
        <div class="target-range-bar" style="margin:4px 0">
          <div class="target-range-fill" style="left:0;right:0"></div>
          <div class="target-range-current" style="left:${((d.price - d.analystConsensus.targetLow) / (d.analystConsensus.targetHigh - d.analystConsensus.targetLow) * 100).toFixed(0)}%"></div>
        </div>
        <div style="font-size:10px;color:var(--text3);text-align:center">Upside: <span style="color:${d.analystConsensus.upside > 0 ? 'var(--green)' : 'var(--red)'}">${d.analystConsensus.upside > 0 ? '+' : ''}${d.analystConsensus.upside}%</span></div>
      </div>
    </div>
    <div class="intel-card">
      <div class="intel-label">Volume</div>
      <div class="intel-value">${(d.volume / 1e6).toFixed(1)}M</div>
      <div style="font-size:11px;color:var(--text3);margin-top:3px">Avg: ${(d.avgVolume / 1e6).toFixed(1)}M · ${d.volume > d.avgVolume ? '<span style="color:var(--green)">+Above avg</span>' : '<span style="color:var(--amber)">Below avg</span>'}</div>
    </div>
  `;
  panel.appendChild(grid);

  const advCard = document.createElement('div');
  advCard.className = 'card fade-in';
  
  let netShares = 0;
  if (d.insiderTransactions) {
    d.insiderTransactions.forEach(t => {
      const shares = typeof t.shares === 'object' ? Number(t.shares?.raw || 0) : Number(t.shares || 0);
      const isPurchase = (t.transactionText || '').toLowerCase().includes('buy') || (t.transactionText || '').toLowerCase().includes('purchase') || (t.transactionText || '').toLowerCase().includes('award');
      const isSale = (t.transactionText || '').toLowerCase().includes('sale') || (t.transactionText || '').toLowerCase().includes('sell');
      if (isPurchase) netShares += shares;
      else if (isSale) netShares -= shares;
    });
  }

  const roe = Number(d.advancedFundamentals?.returnOnEquity || 0);
  const fcf = Number(d.advancedFundamentals?.freeCashflow || 0);
  
  const latestSurprise = d.earningsSurprise?.[0];
  const beatValue = latestSurprise ? (latestSurprise.surprisePercent || (latestSurprise.surprise / (latestSurprise.estimate || 1) * 100)) : null;
  const beatLabel = beatValue != null ? (beatValue > 0 ? `<span style="color:var(--green)">+${beatValue.toFixed(1)}%</span>` : `<span style="color:var(--red)">${beatValue.toFixed(1)}%</span>`) : '—';
  
  advCard.innerHTML = `
    <div class="card-header"><span class="card-title">Advanced Fundamentals & Flow</span></div>
    <div class="ticker-stats" style="grid-template-columns:repeat(5,1fr);margin-top:0;padding-top:0;border-top:none">
      <div class="stat-item"><span class="stat-label">ROE</span><span class="stat-value">${roe ? (roe * 100).toFixed(1) + '%' : '—'}</span></div>
      <div class="stat-item"><span class="stat-label">FREE CASH FLOW</span><span class="stat-value">${fcf ? '$' + (fcf >= 1e9 ? (fcf / 1e9).toFixed(2) + 'B' : (fcf / 1e6).toFixed(2) + 'M') : '—'}</span></div>
      <div class="stat-item"><span class="stat-label">EARNINGS SURPRISE</span><span class="stat-value">${beatLabel}</span></div>
      <div class="stat-item"><span class="stat-label">INSIDER (NET)</span><span class="stat-value">${netShares > 0 ? '<span style="color:var(--green)">+' + (netShares/1000).toFixed(1) + 'k</span>' : netShares < 0 ? '<span style="color:var(--red)">' + (netShares/1000).toFixed(1) + 'k</span>' : '—'}</span></div>
      <div class="stat-item"><span class="stat-label">PEERS</span><span class="stat-value" style="font-size:10px">${(d.peers || []).slice(0, 3).join(', ') || '—'}</span></div>
    </div>
  `;
  panel.appendChild(advCard);

  const peerComparisons = Array.isArray(d.peerComparisons) ? d.peerComparisons : [];
  const peerSymbols = Array.isArray(d.peers) ? d.peers.slice(0, 8) : [];
  if (peerComparisons.length > 0 || peerSymbols.length > 0) {
    const peerCompareWrap = document.createElement('div');
    peerCompareWrap.className = 'fade-in';
    peerCompareWrap.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-top:12px';
    const fmtCompact = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return '—';
      if (numeric >= 1e12) return `${(numeric / 1e12).toFixed(2)}T`;
      if (numeric >= 1e9) return `${(numeric / 1e9).toFixed(2)}B`;
      if (numeric >= 1e6) return `${(numeric / 1e6).toFixed(2)}M`;
      return Math.round(numeric).toLocaleString('en-US');
    };

    const fundamentalsSorted = [...peerComparisons]
      .sort((left, right) => Number(right.fundamentalScore || 0) - Number(left.fundamentalScore || 0))
      .slice(0, 6);

    const tradingSorted = [...peerComparisons]
      .sort((left, right) => Number(right.tradingScore || 0) - Number(left.tradingScore || 0))
      .slice(0, 6);

    const fallbackRows = peerSymbols
      .map((symbol, index) => `<div style="display:grid;grid-template-columns:26px 1fr 84px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)"><span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${index + 1}</span><span style="font-size:12px;color:var(--text);font-family:var(--mono)">${symbol}</span><span style="font-size:10px;color:var(--amber);font-family:var(--mono)">loading</span></div>`)
      .join('');

    const fundamentalRows = fundamentalsSorted.length > 0
      ? fundamentalsSorted.map((item, index) => `
        <div style="display:grid;grid-template-columns:26px 1fr 54px 54px 62px 54px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${index + 1}</span>
          <span style="display:flex;flex-direction:column;line-height:1.2">
            <span style="font-size:12px;color:var(--text);font-family:var(--mono)">${item.symbol}</span>
            <span style="font-size:10px;color:var(--text3)">${item.name || item.symbol}</span>
          </span>
          <span style="font-size:11px;color:var(--text2);font-family:var(--mono)">${Number(item.pe || 0) > 0 ? Number(item.pe).toFixed(1) : '—'}</span>
          <span style="font-size:11px;color:var(--text2);font-family:var(--mono)">${Number(item.eps || 0) !== 0 ? Number(item.eps).toFixed(2) : '—'}</span>
          <span style="font-size:11px;color:var(--text2);font-family:var(--mono)">${fmtCompact(item.marketCap)}</span>
          <span style="font-size:11px;color:${Number(item.roe || 0) >= 0.12 ? 'var(--green)' : 'var(--text2)'};font-family:var(--mono)">${Number(item.roe || 0) ? `${(Number(item.roe) * 100).toFixed(1)}%` : '—'}</span>
        </div>
      `).join('')
      : fallbackRows;

    const tradingRows = tradingSorted.length > 0
      ? tradingSorted.map((item, index) => `
        <div style="display:grid;grid-template-columns:26px 1fr 62px 54px 62px 62px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${index + 1}</span>
          <span style="display:flex;flex-direction:column;line-height:1.2">
            <span style="font-size:12px;color:var(--text);font-family:var(--mono)">${item.symbol}</span>
            <span style="font-size:10px;color:var(--text3)">${item.name || item.symbol}</span>
          </span>
          <span style="font-size:11px;color:${Number(item.return3m || 0) >= 0 ? 'var(--green)' : 'var(--red)'};font-family:var(--mono)">${Number(item.return3m || 0) >= 0 ? '+' : ''}${Number(item.return3m || 0).toFixed(2)}%</span>
          <span style="font-size:11px;color:var(--text2);font-family:var(--mono)">${Number.isFinite(Number(item.rsi)) ? Number(item.rsi).toFixed(1) : '—'}</span>
          <span style="font-size:11px;color:var(--text2);font-family:var(--mono)">${Number.isFinite(Number(item.sentiment)) ? `${Number(item.sentiment) > 0 ? '+' : ''}${Number(item.sentiment).toFixed(2)}` : '—'}</span>
          <span style="font-size:11px;color:${Number(item.volumeRatio || 0) >= 1 ? 'var(--green)' : 'var(--text2)'};font-family:var(--mono)">${Number(item.volumeRatio || 0) ? `${Number(item.volumeRatio).toFixed(2)}x` : '—'}</span>
        </div>
      `).join('')
      : fallbackRows;

    const cardLeft = document.createElement('div');
    cardLeft.className = 'card';
    cardLeft.innerHTML = `
      <div class="card-header">
        <span class="card-title">Peers Compare · Fundamentals</span>
        <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">ranked by fundamentalScore</span>
      </div>
      <div style="display:grid;grid-template-columns:26px 1fr 54px 54px 62px 54px;gap:8px;font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;padding:0 0 6px;border-bottom:1px solid var(--border)">
        <span>#</span><span>Ticker</span><span>PE</span><span>EPS</span><span>MCap</span><span>ROE</span>
      </div>
      <div>${fundamentalRows}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:10px;line-height:1.5">Use this view for valuation and earnings quality: lower PE, stronger ROE, and steadier EPS usually rank higher.</div>
    `;

    const cardRight = document.createElement('div');
    cardRight.className = 'card';
    cardRight.innerHTML = `
      <div class="card-header">
        <span class="card-title">Peers Compare · Trading</span>
        <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">ranked by tradingScore</span>
      </div>
      <div style="display:grid;grid-template-columns:26px 1fr 62px 54px 62px 62px;gap:8px;font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;padding:0 0 6px;border-bottom:1px solid var(--border)">
        <span>#</span><span>Ticker</span><span>3M</span><span>RSI</span><span>Sent</span><span>Vol/Avg</span>
      </div>
      <div>${tradingRows}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:10px;line-height:1.5">Use this view for short-term strength: 3M momentum, RSI, and volume expansion help identify crowded trading direction.</div>
    `;

    peerCompareWrap.appendChild(cardLeft);
    peerCompareWrap.appendChild(cardRight);
    panel.appendChild(peerCompareWrap);
  }

  if (sectorTrends.length > 0 || (benchmarkTrend && benchmarkTrend.history.length > 0)) {
    const sectorCard = document.createElement('div');
    sectorCard.className = 'card fade-in';
    sectorCard.innerHTML = `
      <div class="card-header">
        <span class="card-title">Sector vs Market (3-Month)</span>
        <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${benchmarkTrend ? `${benchmarkTrend.market} · ${benchmarkTrend.name}` : `${d.sector || 'Unknown'} Focus`}</span>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;margin-bottom:6px">
        <button id="chart-sector-show-all" style="font-size:10px;font-family:var(--mono);padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:rgba(59,130,246,0.12);color:var(--cyan);cursor:pointer">All</button>
        <button id="chart-sector-show-focus" style="font-size:10px;font-family:var(--mono);padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:rgba(255,255,255,0.03);color:var(--text2);cursor:pointer">Focus</button>
      </div>
      <div style="margin-top:2px;margin-bottom:8px;font-size:10px;color:var(--text3);font-family:var(--mono)">Click legend to show/hide benchmark or any sector line.</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;margin-bottom:10px">
        ${benchmarkTrend ? `
          <span class="detail-chip" style="border-color:rgba(59,130,246,0.25)">
            ${benchmarkTrend.name}: <span style="color:${Number(benchmarkTrend.changePercent || 0) >= 0 ? 'var(--green)' : 'var(--red)'}">${Number(benchmarkTrend.changePercent || 0) >= 0 ? '+' : ''}${Number(benchmarkTrend.changePercent || 0).toFixed(2)}%</span>
          </span>
        ` : ''}
        ${sectorTrends.map((item) => `
          <span class="detail-chip" style="border-color:rgba(59,130,246,0.2)">
            ${item.sector}: <span style="color:${Number(item.changePercent || 0) >= 0 ? 'var(--green)' : 'var(--red)'}">${Number(item.changePercent || 0) >= 0 ? '+' : ''}${Number(item.changePercent || 0).toFixed(2)}%</span>
          </span>
        `).join('')}
      </div>
      <div class="chart-canvas-wrap" style="height:280px"><canvas id="chart-sector-trends"></canvas></div>
    `;
    panel.appendChild(sectorCard);

    setTimeout(() => {
      const canvas = document.getElementById('chart-sector-trends');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const allDates = Array.from(new Set([
        ...sectorTrends.flatMap((item) => Array.isArray(item.history) ? item.history.map((point) => point.date) : []),
        ...(benchmarkTrend && Array.isArray(benchmarkTrend.history) ? benchmarkTrend.history.map((point) => point.date) : []),
      ])).sort();
      if (allDates.length === 0) return;

      const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#22c55e', '#f97316'];
      const datasets = [];

      if (benchmarkTrend && Array.isArray(benchmarkTrend.history) && benchmarkTrend.history.length > 0) {
        const benchmarkByDate = new Map(benchmarkTrend.history.map((point) => [point.date, Number(point.close)]));
        let benchmarkBaseline = null;
        const normalizedBenchmark = allDates.map((date) => {
          const close = benchmarkByDate.get(date);
          if (!Number.isFinite(close) || close <= 0) return null;
          if (!Number.isFinite(benchmarkBaseline) || benchmarkBaseline <= 0) benchmarkBaseline = close;
          return benchmarkBaseline > 0 ? ((close - benchmarkBaseline) / benchmarkBaseline) * 100 : 0;
        });

        const isUp = Number(benchmarkTrend.changePercent || 0) >= 0;
        const mountainColor = isUp ? '#10b981' : '#ef4444';
        const mountainFill = ctx.createLinearGradient(0, 0, 0, 280);
        mountainFill.addColorStop(0, isUp ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)');
        mountainFill.addColorStop(1, isUp ? 'rgba(16,185,129,0.01)' : 'rgba(239,68,68,0.01)');

        datasets.push({
          label: `${benchmarkTrend.name} (${benchmarkTrend.benchmarkTicker})`,
          data: normalizedBenchmark,
          borderColor: mountainColor,
          backgroundColor: mountainFill,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 2,
          tension: 0.22,
          fill: true,
          spanGaps: true,
        });
      }

      const sectorDatasets = sectorTrends.slice(0, 8).map((item, index) => {
        const history = Array.isArray(item.history) ? item.history : [];
        const byDate = new Map(history.map((point) => [point.date, Number(point.close)]));
        let baseline = null;
        const normalizedSeries = allDates.map((date) => {
          const close = byDate.get(date);
          if (!Number.isFinite(close) || close <= 0) return null;
          if (!Number.isFinite(baseline) || baseline <= 0) baseline = close;
          return baseline > 0 ? ((close - baseline) / baseline) * 100 : 0;
        });

        return {
          label: `${item.sector} (${item.proxyTicker})`,
          data: normalizedSeries,
          borderColor: palette[index % palette.length],
          backgroundColor: palette[index % palette.length],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 2,
          tension: 0.25,
          fill: false,
          spanGaps: true,
        };
      });

      datasets.push(...sectorDatasets);

      currentCharts['sector-trends'] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: allDates,
          datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: {
              position: 'bottom',
              onClick: (event, legendItem, legend) => {
                const chart = legend.chart;
                const datasetIndex = legendItem.datasetIndex;
                if (typeof datasetIndex !== 'number') return;
                const visible = chart.isDatasetVisible(datasetIndex);
                chart.setDatasetVisibility(datasetIndex, !visible);
                chart.update();
              },
              labels: {
                color: '#7a8fb8',
                font: { size: 10, family: "'DM Mono', monospace" },
                boxWidth: 10,
                padding: 8,
              },
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = Number(context.parsed.y);
                  if (!Number.isFinite(value)) return `${context.dataset.label}: —`;
                  return `${context.dataset.label}: ${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color: '#3d5080',
                font: { size: 10, family: "'DM Mono', monospace" },
                maxTicksLimit: 8,
              },
              grid: { color: 'rgba(59,130,246,0.04)' },
              border: { color: 'rgba(59,130,246,0.1)' },
            },
            y: {
              ticks: {
                color: '#3d5080',
                font: { size: 10, family: "'DM Mono', monospace" },
                callback: (value) => `${Number(value).toFixed(0)}%`,
              },
              grid: { color: 'rgba(59,130,246,0.04)' },
              border: { color: 'rgba(59,130,246,0.1)' },
            },
          },
        },
      });

      const toggleAllBtn = document.getElementById('chart-sector-show-all');
      const toggleFocusBtn = document.getElementById('chart-sector-show-focus');
      const normalizedPrimarySector = String(d.sector || '').toLowerCase();
      const hasBenchmark = !!(benchmarkTrend && benchmarkTrend.history && benchmarkTrend.history.length > 0);

      const setToggleStyle = (activeMode) => {
        if (toggleAllBtn) {
          toggleAllBtn.style.background = activeMode === 'all' ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)';
          toggleAllBtn.style.color = activeMode === 'all' ? 'var(--cyan)' : 'var(--text2)';
        }
        if (toggleFocusBtn) {
          toggleFocusBtn.style.background = activeMode === 'focus' ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)';
          toggleFocusBtn.style.color = activeMode === 'focus' ? 'var(--cyan)' : 'var(--text2)';
        }
      };

      const applyVisibilityAll = () => {
        const chart = currentCharts['sector-trends'];
        if (!chart) return;
        chart.data.datasets.forEach((_, datasetIndex) => chart.setDatasetVisibility(datasetIndex, true));
        chart.update();
        setToggleStyle('all');
      };

      const applyVisibilityFocus = () => {
        const chart = currentCharts['sector-trends'];
        if (!chart) return;

        chart.data.datasets.forEach((dataset, datasetIndex) => {
          const label = String(dataset?.label || '').toLowerCase();
          const isBenchmarkDataset = hasBenchmark && label.includes(String(benchmarkTrend?.benchmarkTicker || '').toLowerCase());
          const isPrimarySectorDataset = normalizedPrimarySector
            ? label.includes(`${normalizedPrimarySector} (`) || label.startsWith(normalizedPrimarySector)
            : false;
          chart.setDatasetVisibility(datasetIndex, isBenchmarkDataset || isPrimarySectorDataset);
        });

        const hasVisibleDataset = chart.data.datasets.some((_, datasetIndex) => chart.isDatasetVisible(datasetIndex));
        if (!hasVisibleDataset) {
          chart.data.datasets.forEach((_, datasetIndex) => chart.setDatasetVisibility(datasetIndex, true));
          setToggleStyle('all');
        } else {
          setToggleStyle('focus');
        }
        chart.update();
      };

      toggleAllBtn?.addEventListener('click', applyVisibilityAll);
      toggleFocusBtn?.addEventListener('click', applyVisibilityFocus);
    }, 60);
  }

  // LLM analysis summary
  if (llm?.summary) {
    const summary = document.createElement('div');
    summary.className = 'card fade-in';
    summary.innerHTML = `
      <div class="card-header">
        <span class="card-title">Market Summary</span>
        <span class="card-skill s1" style="background:rgba(59,130,246,0.1);color:var(--cyan);padding:2px 7px;border-radius:4px;font-size:10px;font-family:var(--mono)">RULES</span>
      </div>
      <p style="font-size:13px;line-height:1.6;color:var(--text2);margin-bottom:10px">${llm.summary}</p>
      ${llm.keyTrends?.length ? `<div style="display:flex;flex-direction:column;gap:5px">${llm.keyTrends.map(t => `<div class="insight-item"><div class="insight-dot"></div>${t}</div>`).join('')}</div>` : ''}
    `;
    panel.appendChild(summary);
  }

  const macroCard = document.createElement('div');
  macroCard.className = 'card fade-in';
  macroCard.innerHTML = `
    <div class="card-header">
      <span class="card-title">Macro Context</span>
      <span style="font-size:10px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:${macro.riskLevel === 'HIGH' ? 'rgba(239,68,68,0.1)' : macro.riskLevel === 'LOW' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)'};color:${macro.riskLevel === 'HIGH' ? 'var(--red)' : macro.riskLevel === 'LOW' ? 'var(--green)' : 'var(--amber)'};border:1px solid ${macro.riskLevel === 'HIGH' ? 'rgba(239,68,68,0.2)' : macro.riskLevel === 'LOW' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}">${macro.riskLevel || 'N/A'} RISK</span>
    </div>
    <div class="ticker-stats" style="margin-top:0;padding-top:0;border-top:none;grid-template-columns:repeat(3,1fr)">
      <div class="stat-item">
        <span class="stat-label">MACRO TONE</span>
        <span class="stat-value" style="color:${macroColor}">${macro.sentimentLabel || 'UNAVAILABLE'}${macro.available ? ` (${macroScore > 0 ? '+' : ''}${macroScore.toFixed(2)})` : ''}</span>
        <div class="sentiment-bar" style="margin-top:8px"><div class="sentiment-fill" style="width:${macro.available ? macroPct : 50}%;background:${macroColor}"></div></div>
      </div>
      <div class="stat-item">
        <span class="stat-label">DOMINANT THEMES</span>
        <span class="stat-value" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${dominantThemeChips || 'None'}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">MACRO FEED</span>
        <span class="stat-value">${macro.available ? `${macro.sourceBreakdown?.articleCount || 0} articles` : 'Unavailable'}</span>
      </div>
    </div>
    ${hasMonetaryTheme ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px"><span class="detail-chip macro-theme-chip" style="color:var(--cyan);border-color:rgba(59,130,246,0.25);background:rgba(59,130,246,0.08)">Latest FED/RBA Rate Decisions</span></div>` : ''}
    ${monetaryPolicy?.available ? `
      <div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
        ${[monetaryPolicy.fed, monetaryPolicy.rba].map(policy => `
          <div style="padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,0.02)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <div style="font-size:11px;font-family:var(--mono);letter-spacing:0.08em;text-transform:uppercase;color:var(--text3)">${policy?.bank || 'Policy'} Latest Decision</div>
              ${renderPolicyChip(policy)}
            </div>
            <div style="font-size:12px;color:var(--text);margin-top:8px;line-height:1.55">${policy?.impact || 'No policy impact summary available.'}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:8px;line-height:1.5">${policy?.headline || ''}</div>
            <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-top:6px">${Number.isFinite(Number(policy?.hoursAgo)) ? `${Number(policy.hoursAgo)}h ago` : 'Monitoring current policy window'}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    <p style="font-size:13px;line-height:1.6;color:var(--text2);margin-top:12px">${macro.marketContext || 'No macro context was returned.'}</p>
    ${(macro.impactNotes || []).length ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">${macro.impactNotes.map(note => `<div class="insight-item"><div class="insight-dot"></div>${note}</div>`).join('')}</div>` : ''}
    ${displayedMacroNews.length ? `
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Macro Headlines</div>
        ${displayedMacroNews.map(item => `
          <div class="news-item" style="padding:8px 0">
            <div>
              <div class="news-title">${item.url ? `<a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a>` : item.title}</div>
              <div class="news-meta">
                <span class="news-source">${item.source}</span>
                <span class="news-time">${item.hoursAgo}h ago</span>
                ${renderMacroThemeChip(item.theme)}
              </div>
            </div>
            <span class="news-sentiment ${item.sentiment > 0.1 ? 'pos' : item.sentiment < -0.1 ? 'neg' : 'neutral'}">${item.sentiment > 0 ? '+' : ''}${Number(item.sentiment || 0).toFixed(2)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
  panel.appendChild(macroCard);

  // News
  const newsCard = document.createElement('div');
  newsCard.className = 'card fade-in';
  const newsSourceFallbackMap = {
    'finnhub': 'Finnhub (Real)',
    'yahoo-finance': 'Yahoo + ASX + Google (Real)',
    'alpha-vantage': 'Finnhub (Real)',
    'mock': 'Mock News',
  };
  const newsSource = d.dataSourceBreakdown?.news || newsSourceFallbackMap[normalizedDataSource] || 'Unknown';
  const newsSourceColor = newsSource.includes('No news') ? 'var(--text3)' : 'var(--green)';
  newsCard.innerHTML = `
    <div class="card-header"><span class="card-title">Breaking News</span><span style="font-size:9px;color:${newsSourceColor};font-family:var(--mono);margin-left:auto">${newsSource}</span></div>
    ${d.news.map(n => `
      <div class="news-item">
        <div>
          <div class="news-title">${n.url ? `<a href="${n.url}" target="_blank" rel="noopener noreferrer">${n.title}</a>` : n.title}</div>
          ${n.summary ? `
            <div class="news-summary" style="margin-top:6px;font-size:12px;color:var(--text2);line-height:1.5">${n.summary}</div>
          ` : `<div class="news-summary" style="margin-top:6px;font-size:12px;color:var(--text3);font-style:italic">(No summary available)</div>`}
          <div class="news-meta"><span class="news-source">${n.source}</span><span class="news-time">${n.hoursAgo}h ago</span>${n.url ? `<a class="news-link" href="${n.url}" target="_blank" rel="noopener noreferrer">Read article</a>` : ''}</div>
        </div>
        <span class="news-sentiment ${n.sentiment > 0.1 ? 'pos' : n.sentiment < -0.1 ? 'neg' : 'neutral'}">${n.sentiment > 0 ? '+' : ''}${n.sentiment.toFixed(2)}</span>
      </div>
    `).join('')}
  `;
  panel.appendChild(newsCard);

  // Macro Anchors
  if (d.macroAnchors && d.macroAnchors.length > 0) {
    const anchorsCard = document.createElement('div');
    anchorsCard.className = 'card fade-in';
    anchorsCard.innerHTML = `
      <div class="card-header"><span class="card-title">Macro Anchors (3-Month Trend)</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:10px">
        ${d.macroAnchors.map(a => {
          const validHistory = a.history ? a.history.slice(-30).map(h => h.close).filter(v => typeof v === 'number' && v > 0) : [];
          const min = validHistory.length ? Math.min(...validHistory) : 0;
          const max = validHistory.length ? Math.max(...validHistory) : 1;
          const range = max - min || 1;
          const isUp = a.changePercent >= 0;
          
          return `
          <div style="padding:10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.02)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:12px;font-weight:600;color:var(--cyan)">${a.name}</div>
                <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${a.ticker}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:12px;font-family:var(--mono);color:${isUp ? 'var(--green)' : 'var(--red)'}">${isUp ? '+' : ''}${(a.changePercent || 0).toFixed(2)}%</div>
                <div style="font-size:10px;font-family:var(--mono);color:var(--text3)">${a.trend || 'NEUTRAL'}</div>
              </div>
            </div>
            <div style="height:30px;margin-top:12px;display:flex;align-items:flex-end;gap:1px;opacity:0.8">
              ${validHistory.map(val => `
                <div style="flex:1;background:${isUp ? 'var(--green)' : 'var(--red)'};height:${Math.max(5, ((val - min) / range) * 100)}%;border-radius:1px 1px 0 0"></div>
              `).join('')}
            </div>
          </div>
          `;
        }).join('')}
      </div>
    `;
    panel.appendChild(anchorsCard);
  }
}

window.renderMarketIntelligence = renderMarketIntelligence;
