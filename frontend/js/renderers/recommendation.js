function renderRecommendation(rec, panel) {
  const renderDecisionTreeHtml = (tree) => {
    if (!tree || !Array.isArray(tree.pillars) || tree.pillars.length === 0) return '';

    const leaf = tree.leaf || {};
    const risk = tree.risk || {};

    // ── Colour helpers ────────────────────────────────────────────────────────
    // For regular pillars: bullish=green, bearish=red, neutral=amber
    const pillarPalette = (outcome) => {
      if (outcome === 'bullish') return { color: 'var(--green)', border: 'rgba(16,185,129,0.25)', bg: 'rgba(16,185,129,0.07)', chip: 'BULLISH' };
      if (outcome === 'bearish') return { color: 'var(--red)',   border: 'rgba(239,68,68,0.25)',  bg: 'rgba(239,68,68,0.07)',  chip: 'BEARISH' };
      return { color: 'var(--amber)', border: 'rgba(245,158,11,0.25)', bg: 'rgba(245,158,11,0.07)', chip: 'NEUTRAL' };
    };
    // For Risk Penalty: low=green, moderate=amber, high=red
    const riskPalette = (outcome) => {
      if (outcome === 'low')      return { color: 'var(--green)', border: 'rgba(16,185,129,0.25)', bg: 'rgba(16,185,129,0.07)', chip: 'LOW RISK' };
      if (outcome === 'high')     return { color: 'var(--red)',   border: 'rgba(239,68,68,0.25)',  bg: 'rgba(239,68,68,0.07)',  chip: 'HIGH RISK' };
      return { color: 'var(--amber)', border: 'rgba(245,158,11,0.25)', bg: 'rgba(245,158,11,0.07)', chip: 'MOD RISK' };
    };

    // ── Contribution bar (centred, extends left or right) ─────────────────────
    const contributionBar = (netScore, maxAbsScore = 10) => {
      const capped = Math.min(Math.abs(netScore), maxAbsScore);
      const pct = (capped / maxAbsScore) * 50;   // max 50% each side
      const bullish = netScore >= 0;
      const fillColor = bullish ? 'rgba(16,185,129,0.65)' : 'rgba(239,68,68,0.65)';
      const leftPct  = bullish ? 50 : 50 - pct;
      const widthPct = pct;
      return `
        <div style="position:relative;height:6px;border-radius:999px;background:rgba(255,255,255,0.06);margin:8px 0 4px;overflow:hidden">
          <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(157,179,212,0.4)"></div>
          <div style="position:absolute;top:0;bottom:0;left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;background:${fillColor};border-radius:999px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;font-family:var(--mono);color:var(--text3);letter-spacing:0.05em"><span>Bearish</span><span>Neutral</span><span>Bullish</span></div>
      `;
    };

    // ── Risk pressure bar (0–100% drag) ──────────────────────────────────────
    const riskPressureBar = (pct) => {
      const fillColor = pct > 50 ? 'rgba(239,68,68,0.65)' : pct > 28 ? 'rgba(245,158,11,0.65)' : 'rgba(16,185,129,0.65)';
      return `
        <div style="position:relative;height:6px;border-radius:999px;background:rgba(255,255,255,0.06);margin:8px 0 4px;overflow:hidden">
          <div style="position:absolute;top:0;bottom:0;left:0;width:${pct.toFixed(1)}%;background:${fillColor};border-radius:999px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;font-family:var(--mono);color:var(--text3);letter-spacing:0.05em"><span>0%</span><span>Risk pressure</span><span>100%</span></div>
      `;
    };

    // ── Signal evidence row ───────────────────────────────────────────────────
    const signalRow = (signal) => {
      const pts = Number(signal.points || 0);
      const ptsColor = pts > 0 ? 'var(--green)' : pts < 0 ? 'var(--red)' : 'var(--amber)';
      return `
        <div style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.03);display:flex;gap:8px;align-items:flex-start">
          <span style="font-family:var(--mono);font-size:12px;font-weight:700;color:${ptsColor};min-width:32px;text-align:right;flex-shrink:0">${pts > 0 ? '+' : ''}${pts}</span>
          <div style="min-width:0">
            <div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${signal.name}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px;line-height:1.4">${signal.reason}</div>
          </div>
        </div>
      `;
    };

    // ── Render each pillar card ────────────────────────────────────────────────
    const pillarCards = tree.pillars.map((pillar) => {
      const palette = pillarPalette(pillar.outcome);
      const topSignals = Array.isArray(pillar.topSignals) ? pillar.topSignals : [];
      const evidenceId = `factor-evidence-${String(pillar.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      const scoreLabel = `${pillar.netScore >= 0 ? '+' : ''}${pillar.netScore} pts`;
      const barHtml = contributionBar(pillar.netScore);

      return `
        <div style="padding:11px 13px;border-radius:11px;border:1px solid ${palette.border};background:${palette.bg}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="font-size:12px;font-family:var(--mono);font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:${palette.color}">${pillar.label}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:12px;font-family:var(--mono);font-weight:700;color:${palette.color}">${scoreLabel}</span>
              <span style="padding:2px 6px;border-radius:999px;border:1px solid ${palette.border};font-size:9px;font-family:var(--mono);color:${palette.color}">${palette.chip}</span>
            </div>
          </div>
          <div style="font-size:11px;color:var(--text2);margin-top:5px;line-height:1.45">${pillar.description}</div>
          ${barHtml}
          ${topSignals.length ? `
            <div style="margin-top:8px">
              <button type="button" class="tree-evidence-toggle" data-target="${evidenceId}" aria-expanded="false" style="cursor:pointer;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:rgba(255,255,255,0.02);font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em">Show signals (${topSignals.length})</button>
              <div id="${evidenceId}" class="tree-evidence-body" style="display:none;margin-top:8px;flex-direction:column;gap:6px">
                ${topSignals.map(signalRow).join('')}
              </div>
            </div>
          ` : `<div style="margin-top:6px;font-size:11px;color:var(--text3)">No signals in this category.</div>`}
        </div>
      `;
    }).join('');

    const riskSignals = Array.isArray(risk.topSignals) ? risk.topSignals : [];
    const riskColors = riskPalette(risk.outcome);
    const riskEvidenceId = 'factor-evidence-bearish-pressure';
    const riskCard = `
      <div style="padding:11px 13px;border-radius:11px;border:1px solid ${riskColors.border};background:${riskColors.bg}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:12px;font-family:var(--mono);font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:${riskColors.color}">Bearish Pressure</div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;font-family:var(--mono);font-weight:700;color:${riskColors.color}">${risk.riskPressurePct ?? 0}% drag</span>
            <span style="padding:2px 6px;border-radius:999px;border:1px solid ${riskColors.border};font-size:9px;font-family:var(--mono);color:${riskColors.color}">${riskColors.chip}</span>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:5px;line-height:1.45">Cross-cutting summary of bearish signals. Displayed separately so it does not double-count against the pillar attribution above.</div>
        ${riskPressureBar(risk.riskPressurePct ?? 0)}
        ${riskSignals.length ? `
          <div style="margin-top:8px">
            <button type="button" class="tree-evidence-toggle" data-target="${riskEvidenceId}" aria-expanded="false" style="cursor:pointer;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:rgba(255,255,255,0.02);font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em">Show bearish signals (${riskSignals.length})</button>
            <div id="${riskEvidenceId}" class="tree-evidence-body" style="display:none;margin-top:8px;flex-direction:column;gap:6px">
              ${riskSignals.map(signalRow).join('')}
            </div>
          </div>
        ` : `<div style="margin-top:6px;font-size:11px;color:var(--text3)">No bearish signals recorded.</div>`}
      </div>
    `;

    return `
      <div style="margin-top:16px;padding:12px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,0.02)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <div style="font-size:13px;color:var(--cyan);font-family:var(--mono);font-weight:700;text-transform:uppercase;letter-spacing:0.1em">Factor Contribution</div>
          <span class="detail-chip">${leaf.action || rec.action} · ${leaf.confidence ?? rec.confidence}% confidence</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${pillarCards}
          ${riskCard}
        </div>
        ${leaf.summary ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--text2);line-height:1.5">${leaf.summary}</div>` : ''}
      </div>
    `;
  };

  const div2 = document.createElement('div');
  div2.className = 'section-divider fade-in';
  div2.innerHTML = `<div class="section-divider-line"></div><span class="section-divider-text">③ trade-recommendation</span><div class="section-divider-line"></div>`;
  panel.appendChild(div2);

  const rrColor = rec.riskReward >= 2 ? 'var(--green)' : rec.riskReward >= 1.5 ? 'var(--amber)' : 'var(--red)';
  const confidenceBreakdown = rec.confidenceBreakdown || null;
  const sortedSignals = [...(rec.signals || [])].sort((left, right) => {
    const leftPoints = Number(left?.points || 0);
    const rightPoints = Number(right?.points || 0);
    const leftAbs = Math.abs(leftPoints);
    const rightAbs = Math.abs(rightPoints);
    if (rightAbs !== leftAbs) return rightAbs - leftAbs;
    return rightPoints - leftPoints;
  });
  const positiveSignalPower = sortedSignals
    .filter((signal) => Number(signal?.points || 0) > 0)
    .reduce((sum, signal) => sum + Number(signal.points || 0), 0);
  const negativeSignalPower = sortedSignals
    .filter((signal) => Number(signal?.points || 0) < 0)
    .reduce((sum, signal) => sum + Math.abs(Number(signal.points || 0)), 0);
  const totalSignalPower = positiveSignalPower + negativeSignalPower;
  const positiveSignalPct = totalSignalPower > 0 ? (positiveSignalPower / totalSignalPower) * 100 : 50;
  const negativeSignalPct = totalSignalPower > 0 ? (negativeSignalPower / totalSignalPower) * 100 : 50;
  const signalDominance = positiveSignalPct >= 60
    ? 'Bullish Dominant'
    : negativeSignalPct >= 60
      ? 'Bearish Dominant'
      : 'Balanced';
  const signalDominanceColor = signalDominance === 'Bullish Dominant'
    ? 'var(--green)'
    : signalDominance === 'Bearish Dominant'
      ? 'var(--red)'
      : 'var(--amber)';
  const fmtAdj = (v) => {
    const n = Number(v || 0);
    return `${n > 0 ? '+' : ''}${n}`;
  };

  const recCard = document.createElement('div');
  recCard.className = 'rec-card fade-in';
  recCard.style.background = `linear-gradient(135deg, var(--bg2), ${rec.actionColor}15)`;
  recCard.style.borderColor = `${rec.actionColor}40`;
  recCard.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px">
      <div>
        <div class="rec-action" style="color:${rec.actionColor}">${rec.action}</div>
        <div class="rec-confidence" style="color:var(--text2)">${rec.ticker} · ${rec.confidence}% Confidence</div>
        <div style="width:180px">
          <div class="confidence-bar-wrap"><div class="confidence-bar" style="width:${rec.confidence}%;background:${rec.actionColor}"></div></div>
        </div>
        ${confidenceBreakdown ? `
          <details style="margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid var(--border);max-width:420px">
            <summary style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;cursor:pointer;list-style:none">Explain confidence (${rec.confidence}%)</summary>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
              <span class="detail-chip"><span>Base:</span>${confidenceBreakdown.base ?? '—'}</span>
              <span class="detail-chip"><span>Consistency:</span>${fmtAdj(confidenceBreakdown.consistencyAdjustment)}</span>
              <span class="detail-chip"><span>Conflict:</span>${fmtAdj(confidenceBreakdown.conflictPenalty)}</span>
              <span class="detail-chip"><span>Signal count:</span>${fmtAdj(confidenceBreakdown.signalCountAdjustment)}</span>
              <span class="detail-chip"><span>Macro:</span>${fmtAdj(confidenceBreakdown.macroAdjustment)}</span>
              <span class="detail-chip"><span>Alignment:</span>${confidenceBreakdown.alignment ?? '—'}%</span>
              <span class="detail-chip"><span>Final:</span>${confidenceBreakdown.final ?? rec.confidence}</span>
            </div>
            ${rec.confidenceExplanation ? `<div style="margin-top:8px;font-size:12px;line-height:1.5;color:var(--text2)">${rec.confidenceExplanation}</div>` : ''}
          </details>
        ` : ''}
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">Signal Score</div>
        <div style="font-size:28px;font-weight:600;font-family:var(--mono);color:${rec.score > 0 ? 'var(--green)' : rec.score < 0 ? 'var(--red)' : 'var(--amber)'}">${rec.score > 0 ? '+' : ''}${rec.score}</div>
      </div>
    </div>

    <div class="price-targets">
      <div class="target-item">
        <div class="target-label">ENTRY</div>
        <div class="target-value" style="color:var(--cyan)">$${rec.entry?.toFixed(2)}</div>
      </div>
      <div class="target-item">
        <div class="target-label">STOP LOSS</div>
        <div class="target-value" style="color:var(--red)">$${rec.stopLoss?.toFixed(2)}</div>
      </div>
      <div class="target-item">
        <div class="target-label">TAKE PROFIT</div>
        <div class="target-value" style="color:var(--green)">$${rec.takeProfit?.toFixed(2)}</div>
      </div>
    </div>
    <div class="rr-badge" style="background:${rrColor}15;color:${rrColor};border:1px solid ${rrColor}30">Risk/Reward: ${rec.riskReward}:1 · ${rec.timeHorizon} term</div>
    ${rec.objectiveProfile ? `<div class="rr-badge" style="margin-top:8px;background:rgba(59,130,246,0.08);color:var(--cyan);border:1px solid rgba(59,130,246,0.2)">Recommendation Lens: ${rec.objectiveProfile.label} · ${rec.objectiveProfile.holdingPeriod}</div>` : ''}
    ${rec.macroOverlay?.available ? `<div class="rr-badge" style="margin-top:8px;background:${rec.macroOverlay.riskLevel === 'HIGH' ? 'var(--red-dim)' : rec.macroOverlay.riskLevel === 'LOW' ? 'var(--green-dim)' : 'var(--amber-dim)'};color:${rec.macroOverlay.riskLevel === 'HIGH' ? 'var(--red)' : rec.macroOverlay.riskLevel === 'LOW' ? 'var(--green)' : 'var(--amber)'};border:1px solid ${rec.macroOverlay.riskLevel === 'HIGH' ? 'rgba(239,68,68,0.35)' : rec.macroOverlay.riskLevel === 'LOW' ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'}">Macro Overlay: ${rec.macroOverlay.riskLevel} · ${rec.macroOverlay.sentimentLabel}${(rec.macroOverlay.dominantThemes || []).length ? ` · ${rec.macroOverlay.dominantThemes.map(t => t.theme).join(', ')}` : ''}</div>` : ''}
    ${rec.eventRegimeOverlay?.available ? `<div class="rr-badge" style="margin-top:8px;background:${rec.eventRegimeOverlay.direction === 'TAILWIND' ? 'var(--green-dim)' : rec.eventRegimeOverlay.direction === 'HEADWIND' ? 'var(--red-dim)' : 'var(--amber-dim)'};color:${rec.eventRegimeOverlay.direction === 'TAILWIND' ? 'var(--green)' : rec.eventRegimeOverlay.direction === 'HEADWIND' ? 'var(--red)' : 'var(--amber)'};border:1px solid ${rec.eventRegimeOverlay.direction === 'TAILWIND' ? 'rgba(16,185,129,0.35)' : rec.eventRegimeOverlay.direction === 'HEADWIND' ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'}">Event Overlay: ${rec.eventRegimeOverlay.direction || 'NEUTRAL'} · Bias ${(Number(rec.eventRegimeOverlay.netBias || 0) > 0 ? '+' : '') + Number(rec.eventRegimeOverlay.netBias || 0).toFixed(2)} · ${rec.eventRegimeOverlay.sector || 'Unknown'}</div>` : ''}

    ${rec.eventRegimeOverlay?.available ? `
      <div style="margin-top:12px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em">Event Regime Impact</div>
          <span class="detail-chip" style="color:${rec.eventRegimeOverlay.direction === 'TAILWIND' ? 'var(--green)' : rec.eventRegimeOverlay.direction === 'HEADWIND' ? 'var(--red)' : 'var(--amber)'}">${rec.eventRegimeOverlay.summary || 'Event-regime impact applied'}</span>
        </div>
        <div style="height:8px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,0.05);margin-top:8px;position:relative">
          <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(157,179,212,0.45)"></div>
          <div style="position:absolute;top:0;bottom:0;${Number(rec.eventRegimeOverlay.netBias || 0) >= 0 ? 'left:50%' : `left:calc(50% - ${Math.min(50, Math.abs(Number(rec.eventRegimeOverlay.netBias || 0)) * 20).toFixed(1)}%)`};width:${Math.min(50, Math.abs(Number(rec.eventRegimeOverlay.netBias || 0)) * 20).toFixed(1)}%;background:${Number(rec.eventRegimeOverlay.netBias || 0) >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)'}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;font-family:var(--mono);color:var(--text3)"><span>Headwind</span><span>Neutral</span><span>Tailwind</span></div>
        ${(rec.eventRegimeOverlay.regimes || []).length ? `<div class="signal-detail" style="margin-left:0;margin-top:8px">${rec.eventRegimeOverlay.regimes.map(regime => {
          const bizMatches = Array.isArray(regime.companyKeywordMatches) ? regime.companyKeywordMatches : [];
          const overridden = regime.companyDirectMatch && regime.sectorBased !== regime.direction;
          const chipColor = regime.companyDirectMatch ? 'var(--green)' : 'var(--text2)';
          const bizTag = regime.companyDirectMatch
            ? ` · ★ ${bizMatches.slice(0,3).join(', ')}${overridden ? ' (override)' : ''}`
            : '';
          return `<span class="detail-chip" style="color:${chipColor}">${regime.name} · ${regime.direction} · conf ${(Number(regime.confidence || 0) * 100).toFixed(0)}%${bizTag}</span>`;
        }).join('')}</div>` : ''}
      </div>
    ` : ''}

    ${rec.objectiveProfile?.focus ? `<p style="font-size:13px;line-height:1.65;color:var(--text);margin-top:12px;padding:8px 10px;border-radius:8px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.18)"><span style="font-family:var(--mono);font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--cyan);font-weight:600">Objective Focus</span><br><span style="font-weight:600">${rec.objectiveProfile.focus}</span></p>` : ''}
    ${rec.objectiveProfile ? `
      <div style="margin-top:14px">
        <div style="font-size:13px;color:var(--cyan);font-family:var(--mono);font-weight:700;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.1em">Why This Lens</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div>
            <div style="font-size:12px;color:var(--text);font-weight:600;margin-bottom:6px">Amplified in this recommendation</div>
            <div class="signal-detail" style="margin-left:0">${(rec.objectiveProfile.amplifiedSignals || []).length ? rec.objectiveProfile.amplifiedSignals.map(name => `<span class="detail-chip"><span>+</span>${name}</span>`).join('') : `<span class="detail-chip"><span>+</span>Balanced weighting</span>`}</div>
          </div>
          <div>
            <div style="font-size:12px;color:var(--text);font-weight:600;margin-bottom:6px">De-emphasized in this recommendation</div>
            <div class="signal-detail" style="margin-left:0">${(rec.objectiveProfile.deemphasizedSignals || []).length ? rec.objectiveProfile.deemphasizedSignals.map(name => `<span class="detail-chip"><span>-</span>${name}</span>`).join('') : `<span class="detail-chip"><span>-</span>No major de-emphasis</span>`}</div>
          </div>
        </div>
      </div>
    ` : ''}
    ${rec.rationale ? `<p style="font-size:13px;line-height:1.6;color:var(--text2);margin-top:14px">${rec.rationale}</p>` : ''}
    ${renderDecisionTreeHtml(rec.decisionTree)}

    <div style="margin-top:16px">
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em">Signal Breakdown</div>
      <div style="margin-bottom:10px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;font-family:var(--mono);margin-bottom:6px;color:var(--text3)">
          <span style="color:var(--green)">Positive ${positiveSignalPower > 0 ? '+' : ''}${positiveSignalPower.toFixed(1)}</span>
          <span>Signal Tug-of-War</span>
          <span style="color:var(--red)">Negative -${negativeSignalPower.toFixed(1)}</span>
        </div>
        <div style="height:10px;border-radius:999px;overflow:hidden;display:flex;background:rgba(255,255,255,0.05)">
          <div style="width:${positiveSignalPct.toFixed(1)}%;background:rgba(16,185,129,0.75)"></div>
          <div style="width:${negativeSignalPct.toFixed(1)}%;background:rgba(239,68,68,0.75)"></div>
        </div>
        <div style="margin-top:7px;font-size:11px;font-family:var(--mono);font-weight:600;color:${signalDominanceColor}">${signalDominance}</div>
      </div>
      <div class="signal-grid">
        ${sortedSignals.map(s => `
          <div>
            <div class="signal-row">
              <span class="signal-pts ${s.points > 0 ? 'pos' : 'neg'}">${s.points > 0 ? '+' : ''}${s.points}</span>
              <span class="signal-name">${s.name}</span>
              <span class="signal-reason">${s.reason}</span>
            </div>
            ${s.detail && s.detail.length ? `<div class="signal-detail">${s.detail.map(d => `<span class="detail-chip"><span>${d.label}:</span>${d.value}</span>`).join('')}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    ${(rec.keyRisks || []).length ? `
      <div style="margin-top:14px">
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em">Key Risks</div>
        ${rec.keyRisks.map(r => `<div class="risk-flag" style="margin-bottom:5px">⚠ ${r}</div>`).join('')}
      </div>
    ` : ''}

    <div class="disclaimer">${rec.disclaimer}</div>
  `;
  panel.appendChild(recCard);

  recCard.addEventListener('click', (event) => {
    const toggle = event.target.closest('.tree-evidence-toggle');
    if (!toggle) return;

    const targetId = toggle.getAttribute('data-target');
    const target = recCard.querySelector(`#${targetId}`);
    if (!target) return;

    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
    const txt = String(toggle.textContent || '');
    toggle.textContent = isExpanded
      ? txt.replace('Hide', 'Show')
      : txt.replace('Show', 'Hide');
    target.style.display = isExpanded ? 'none' : 'flex';
  });

  // Historical Patterns card
  const hp = rec.historicalPatterns;
  if (hp && hp.instances && hp.instances.length > 0) {
    const s = hp.summary;
    const avg5Color = s.avg5d >= 0 ? 'var(--green)' : 'var(--red)';
    const avg10Color = s.avg10d >= 0 ? 'var(--green)' : 'var(--red)';
    const patternCard = document.createElement('div');
    patternCard.className = 'card fade-in';
    patternCard.innerHTML = `
      <div class="card-header">
        <span class="card-title">Historical Pattern Analogs</span>
        <span style="font-size:10px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:rgba(59,130,246,0.08);color:var(--cyan);border:1px solid rgba(59,130,246,0.15)">${hp.pattern}</span>
      </div>
      <p style="font-size:12px;color:var(--text3);margin-bottom:12px">
        Found <strong style="color:var(--text)">${s.count}</strong> past instances matching current RSI zone + MA50 position over the last <strong style="color:var(--text)">${hp.lookbackDays}</strong> trading days.
      </p>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
        <div class="pattern-stat">
          <span class="pattern-stat-label">Avg 5d Return</span>
          <span class="pattern-stat-value" style="color:${avg5Color}">${s.avg5d >= 0 ? '+' : ''}${s.avg5d}%</span>
        </div>
        <div class="pattern-stat">
          <span class="pattern-stat-label">5d Win Rate</span>
          <span class="pattern-stat-value" style="color:var(--cyan)">${s.winRate5d}</span>
        </div>
        <div class="pattern-stat">
          <span class="pattern-stat-label">Avg 10d Return</span>
          <span class="pattern-stat-value" style="color:${avg10Color}">${s.avg10d >= 0 ? '+' : ''}${s.avg10d}%</span>
        </div>
        <div class="pattern-stat">
          <span class="pattern-stat-label">10d Win Rate</span>
          <span class="pattern-stat-value" style="color:var(--cyan)">${s.winRate10d}</span>
        </div>
      </div>
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Recent Matches (most recent ${hp.instances.length})</div>
      <div class="analog-row" style="font-size:10px;color:var(--text3);border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:2px">
        <span>Date</span><span>Entry</span><span class="analog-ret">+5d Return</span><span class="analog-ret">+10d Return</span>
      </div>
      ${hp.instances.map(inst => `
        <div class="analog-row">
          <span class="analog-date">${inst.date}</span>
          <span style="color:var(--text2)">$${inst.entryPrice}</span>
          <span class="analog-ret ${inst.return5d >= 0 ? 'pos' : 'neg'}">${inst.return5d >= 0 ? '+' : ''}${inst.return5d}%</span>
          <span class="analog-ret ${inst.return10d >= 0 ? 'pos' : 'neg'}">${inst.return10d >= 0 ? '+' : ''}${inst.return10d}%</span>
        </div>
      `).join('')}
      <p style="font-size:10px;color:var(--text3);margin-top:10px">⚠ Past patterns are not predictive. Sample size may be small — treat as context, not signal.</p>
    `;
    panel.appendChild(patternCard);
  }

  panel.scrollTop = 0;
}

window.renderRecommendation = renderRecommendation;
