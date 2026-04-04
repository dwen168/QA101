function renderPortfolioOptimization(result, panel) {
  const metrics = result.portfolioMetrics || {};
  const ranked = result.rankedTickers || [];
  const sectors = result.sectorAnalysis || [];
  const div = result.diversificationMetrics || {};
  const narrative = result.portfolioNarrative || result.llmNarrative || {};
  const macro = result.macroRegime || {};
  const eventOverlay = result.eventRegimeOverlay || {};
  const dataSources = result.dataSources || {};

  const section = document.createElement('div');
  section.className = 'section-divider fade-in';
  section.innerHTML = `<div class="section-divider-line"></div><span class="section-divider-text">portfolio-optimization</span><div class="section-divider-line"></div>`;
  panel.appendChild(section);

  const sourceStatus = String(dataSources.status || '').toUpperCase();
  if (sourceStatus) {
    const sourceCard = document.createElement('div');
    sourceCard.className = 'fade-in';

    const isLive = sourceStatus === 'LIVE';
    const isMock = sourceStatus === 'MOCK';
    const background = isLive
      ? 'rgba(16,185,129,0.1)'
      : isMock
        ? 'rgba(245,158,11,0.1)'
        : 'rgba(59,130,246,0.1)';
    const border = isLive
      ? 'rgba(16,185,129,0.25)'
      : isMock
        ? 'rgba(245,158,11,0.25)'
        : 'rgba(59,130,246,0.25)';
    const color = isLive ? 'var(--green)' : isMock ? 'var(--amber)' : 'var(--cyan)';

    sourceCard.style.cssText = `background:${background};border:1px solid ${border};border-radius:var(--radius);padding:12px 14px;display:flex;flex-direction:column;gap:8px`;
    sourceCard.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="font-size:12px;font-weight:500;color:${color}">Data Source: ${sourceStatus}</div>
        <div style="font-size:10px;font-family:var(--mono);color:var(--text3)">live ${dataSources.sourceBreakdown?.live || 0} · mock ${dataSources.sourceBreakdown?.mock || 0} · unknown ${dataSources.sourceBreakdown?.unknown || 0}</div>
      </div>
      <div style="font-size:11px;color:var(--text2)">${dataSources.message || ''}</div>
      ${(dataSources.details || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${dataSources.details.map((item) => {
        const itemColor = item.usedFallback ? 'var(--amber)' : (item.source === 'alpha-vantage' || item.source === 'yahoo-finance') ? 'var(--green)' : 'var(--text2)';
        const reasonText = item.fallbackReason ? ` · ${item.fallbackReason}` : '';
        return `<span class="detail-chip" style="border-color:rgba(59,130,246,0.2);color:${itemColor}">${item.ticker}: ${item.source}${reasonText}</span>`;
      }).join('')}</div>` : ''}
    `;

    panel.appendChild(sourceCard);
  }

  const summary = document.createElement('div');
  summary.className = 'card fade-in';
  summary.innerHTML = `
    <div class="card-header">
      <span class="card-title">Portfolio Summary</span>
      <span style="font-size:11px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:rgba(59,130,246,0.08);color:var(--cyan);border:1px solid rgba(59,130,246,0.2)">${result.timeHorizon || 'MEDIUM'} term · ${metrics.optimizationMethod || 'rule-based'}</span>
    </div>
    <div class="ticker-stats" style="grid-template-columns:repeat(6,1fr)">
      <div class="stat-item"><span class="stat-label">TOTAL ALLOCATION</span><span class="stat-value">${(metrics.totalAllocation ?? 0).toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-label">CASH BUFFER</span><span class="stat-value">${(metrics.cashBuffer ?? 0).toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-label">EXPECTED RETURN</span><span class="stat-value">${(metrics.expectedReturn ?? 0).toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-label">EXPECTED VOL</span><span class="stat-value">${(metrics.expectedVolatility ?? 0).toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-label">SHARPE</span><span class="stat-value">${(metrics.sharpeRatio ?? 0).toFixed(2)}</span></div>
      <div class="stat-item"><span class="stat-label">AVG PAIRWISE CORR</span><span class="stat-value">${(div.avgPairwiseCorrelation ?? 0).toFixed(3)}</span></div>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--text2)"><strong>Diversification:</strong> ${div.riskAssessment || 'N/A'} · sector max ${((div.sectorConcentration ?? 0) * 100).toFixed(1)}% · max position ${(metrics.maxPositionWeight ?? 0).toFixed(1)}%</div>
  `;
  panel.appendChild(summary);

  if (Array.isArray(metrics.riskContribution) && metrics.riskContribution.length) {
    const riskRows = [...metrics.riskContribution]
      .sort((left, right) => Number(right.contributionPct || 0) - Number(left.contributionPct || 0))
      .map((item) => {
        const contribution = Number(item.contributionPct || 0);
        const width = Math.max(0, Math.min(100, contribution));
        return `
          <div style="display:grid;grid-template-columns:72px 1fr 56px;gap:8px;align-items:center">
            <span style="font-size:11px;font-family:var(--mono);color:var(--text2)">${item.ticker}</span>
            <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden">
              <div style="height:100%;width:${width.toFixed(1)}%;background:linear-gradient(90deg, rgba(59,130,246,0.85), rgba(16,185,129,0.8));border-radius:999px"></div>
            </div>
            <span style="font-size:11px;font-family:var(--mono);color:var(--text)">${contribution.toFixed(1)}%</span>
          </div>
        `;
      }).join('');

    const riskCard = document.createElement('div');
    riskCard.className = 'card fade-in';
    riskCard.innerHTML = `
      <div class="card-header">
        <span class="card-title">Risk Contribution by Asset</span>
        <span style="font-size:10px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:rgba(59,130,246,0.08);color:var(--cyan);border:1px solid rgba(59,130,246,0.2)">MARGINAL RISK SHARE</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">${riskRows}</div>
      <div style="margin-top:8px;font-size:11px;color:var(--text3)">Shares may not sum to exactly 100% due to rounding.</div>
    `;
    panel.appendChild(riskCard);
  }

  if (macro.available) {
    const macroCard = document.createElement('div');
    macroCard.className = 'card fade-in';
    const macroColor = macro.riskLevel === 'HIGH' ? 'var(--red)' : macro.riskLevel === 'LOW' ? 'var(--green)' : 'var(--amber)';
    macroCard.innerHTML = `
      <div class="card-header">
        <span class="card-title">Portfolio Macro Regime</span>
        <span style="font-size:10px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:${macro.riskLevel === 'HIGH' ? 'rgba(239,68,68,0.1)' : macro.riskLevel === 'LOW' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)'};color:${macroColor};border:1px solid ${macro.riskLevel === 'HIGH' ? 'rgba(239,68,68,0.2)' : macro.riskLevel === 'LOW' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}">${macro.riskLevel} RISK</span>
      </div>
      <div class="ticker-stats" style="margin-top:0;padding-top:0;border-top:none;grid-template-columns:repeat(3,1fr)">
        <div class="stat-item"><span class="stat-label">MACRO TONE</span><span class="stat-value" style="color:${macroColor}">${macro.sentimentLabel} (${macro.sentimentScore > 0 ? '+' : ''}${(macro.sentimentScore ?? 0).toFixed(2)})</span></div>
        <div class="stat-item"><span class="stat-label">DOMINANT THEMES</span><span class="stat-value">${(macro.dominantThemes || []).slice(0, 3).map(item => String(item.theme || '').replace(/_/g, ' ')).join(' · ') || 'None'}</span></div>
        <div class="stat-item"><span class="stat-label">SOURCES</span><span class="stat-value">${macro.sourceCount || 0} ticker feeds</span></div>
      </div>
      <p style="margin-top:10px;font-size:12px;color:var(--text2)">${macro.marketContext || ''}</p>
    `;
    panel.appendChild(macroCard);
  }

  if (eventOverlay.available) {
    const eventCard = document.createElement('div');
    eventCard.className = 'card fade-in';

    const regimeChips = (eventOverlay.regimes || []).map((regime) => {
      const conf = Number(regime.confidence || 0);
      const intensity = Number(regime.intensity || 1);
      return `<span class="detail-chip">${regime.name} · conf ${(conf * 100).toFixed(0)}% · x${intensity.toFixed(1)}</span>`;
    }).join('');

    const sectorBiasChips = Object.entries(eventOverlay.sectorBias || {})
      .sort((left, right) => Number(right[1]) - Number(left[1]))
      .slice(0, 8)
      .map(([sector, bias]) => {
        const val = Number(bias || 0);
        const color = val > 0 ? 'var(--green)' : val < 0 ? 'var(--red)' : 'var(--text2)';
        return `<span class="detail-chip" style="color:${color}">${sector}: ${val > 0 ? '+' : ''}${val.toFixed(2)}</span>`;
      }).join('');

    eventCard.innerHTML = `
      <div class="card-header">
        <span class="card-title">Portfolio Event Regime Overlay</span>
        <span style="font-size:10px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:rgba(59,130,246,0.08);color:var(--cyan);border:1px solid rgba(59,130,246,0.2)">ACTIVE</span>
      </div>
      <p style="font-size:12px;color:var(--text2);line-height:1.55">${eventOverlay.summary || 'Event regime overlay active.'}</p>
      <p style="font-size:11px;color:var(--text3);margin-top:4px">Sector biases shown below are baseline estimates. Per-ticker adjustments in the ranking table reflect each company's actual business activities.</p>
      ${regimeChips ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${regimeChips}</div>` : ''}
      ${sectorBiasChips ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${sectorBiasChips}</div>` : ''}
    `;

    panel.appendChild(eventCard);
  }

  const ranking = document.createElement('div');
  ranking.className = 'card fade-in';
  ranking.innerHTML = `
    <div class="card-header"><span class="card-title">Ranked Tickers</span></div>
    <div style="display:grid;grid-template-columns:50px 88px 88px 96px 84px 84px 78px 88px;gap:8px;font-size:10px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:0.08em;padding:0 0 6px;border-bottom:1px solid var(--border)">
      <span>Rank</span><span>Ticker</span><span>Action</span><span>Score</span><span>Macro</span><span>Event</span><span>Alloc</span><span>Exp Ret</span>
    </div>
    ${(ranked || []).map(r => `
      <div style="display:grid;grid-template-columns:50px 88px 88px 96px 84px 84px 78px 88px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;font-family:var(--mono)">
        <span style="color:var(--text3)">#${r.rank}</span>
        <span style="color:var(--cyan)">${r.ticker}</span>
        <span style="color:${r.action && r.action.includes('BUY') ? 'var(--green)' : r.action === 'SELL' ? 'var(--red)' : 'var(--amber)'}">${r.action || 'HOLD'}</span>
        <span>${(r.compositeScore ?? 0).toFixed(1)} <span style="color:var(--text3)">(${(r.baseCompositeScore ?? r.compositeScore ?? 0).toFixed(1)})</span></span>
        <span style="color:${(r.macroAdjustment ?? 0) < 0 ? 'var(--red)' : (r.macroAdjustment ?? 0) > 0 ? 'var(--green)' : 'var(--text2)'}">${(r.macroAdjustment ?? 0) > 0 ? '+' : ''}${(r.macroAdjustment ?? 0).toFixed(1)}</span>
        <span style="color:${(r.eventAdjustment ?? 0) < 0 ? 'var(--red)' : (r.eventAdjustment ?? 0) > 0 ? 'var(--green)' : 'var(--text2)'}">${(r.eventAdjustment ?? 0) > 0 ? '+' : ''}${(r.eventAdjustment ?? 0).toFixed(1)}</span>
        <span>${(r.allocation ?? 0).toFixed(1)}%</span>
        <span style="color:${(r.expectedReturn ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'}">${(r.expectedReturn ?? 0) > 0 ? '+' : ''}${(r.expectedReturn ?? 0).toFixed(1)}%</span>
      </div>
      ${Array.isArray(r.eventReasons) && r.eventReasons.length ? `<div style="margin:-2px 0 8px 58px;font-size:11px;color:var(--text3)">${r.eventReasons.map(reason => `<span class="detail-chip">${reason}</span>`).join(' ')}</div>` : ''}
    `).join('')}
  `;
  panel.appendChild(ranking);

  if (sectors.length) {
    const sectorCard = document.createElement('div');
    sectorCard.className = 'card fade-in';
    sectorCard.innerHTML = `
      <div class="card-header"><span class="card-title">Sector Analysis</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${sectors.map(s => `<span class="detail-chip">${s.sector}: ${s.sectorStrength} (${s.allocation}%)</span>`).join('')}
      </div>
    `;
    panel.appendChild(sectorCard);
  }

  if (narrative.executiveSummary || (narrative.recommendations && narrative.recommendations.length)) {
    const narrativeCard = document.createElement('div');
    narrativeCard.className = 'card fade-in';
    narrativeCard.innerHTML = `
      <div class="card-header"><span class="card-title">Portfolio Narrative</span></div>
      ${narrative.executiveSummary ? `<p style="font-size:13px;line-height:1.6;color:var(--text2)">${narrative.executiveSummary}</p>` : ''}
      ${narrative.recommendations && narrative.recommendations.length ? `<div style="margin-top:10px">${narrative.recommendations.map(r => `<div class="insight-item"><div class="insight-dot"></div><span>${r}</span></div>`).join('')}</div>` : ''}
    `;
    panel.appendChild(narrativeCard);
  }

  panel.scrollTop = 0;
}

window.renderPortfolioOptimization = renderPortfolioOptimization;
