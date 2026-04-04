  const decisionStepData = {
    step1: {
      title: 'STEP 1 · Data Ingestion',
      subtitle: 'High-level input groups',
      html: `
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="padding:10px;border:1px solid var(--border);border-radius:8px;background:rgba(59,130,246,0.07)">
            <div style="font-size:12px;color:var(--text)"><strong>Market Data</strong> · OHLCV candles, volume profile, MA/RSI/MACD source series</div>
          </div>
          <div style="padding:10px;border:1px solid var(--border);border-radius:8px;background:rgba(16,185,129,0.07)">
            <div style="font-size:12px;color:var(--text)"><strong>Fundamental Data</strong> · PE ratio, EPS trend, valuation baseline context</div>
          </div>
          <div style="padding:10px;border:1px solid var(--border);border-radius:8px;background:rgba(245,158,11,0.07)">
            <div style="font-size:12px;color:var(--text)"><strong>Sentiment Data</strong> · news headlines, tone scores, analyst rating revisions</div>
          </div>
          <div style="padding:10px;border:1px solid var(--border);border-radius:8px;background:rgba(139,92,246,0.07)">
            <div style="font-size:12px;color:var(--text)"><strong>Macro Anchors</strong> · VIX, TNX, CL=F and cross-asset stress regime tags</div>
          </div>
        </div>
      `,
      footnote: 'High-level view only: this panel summarizes the major input families, not every field used in scoring.'
    },
    step2: {
      title: 'STEP 2 · Signal Build',
      subtitle: 'Representative signal families',
      html: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="padding:9px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text)">trend_ma_alignment</div>
          <div style="padding:9px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text)">rsi_reversal_zone</div>
          <div style="padding:9px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text)">macd_momentum_shift</div>
          <div style="padding:9px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text)">bollinger_breakout_pressure</div>
          <div style="padding:9px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text)">valuation_discount_signal</div>
          <div style="padding:9px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text)">eps_growth_quality</div>
          <div style="padding:9px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text)">news_sentiment_score</div>
          <div style="padding:9px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text)">analyst_consensus_delta</div>
        </div>
      `,
      footnote: 'High-level view only: these are representative signal groups, not a complete or stable contract of every scoring feature.'
    },
    step3: {
      title: 'STEP 3 · Risk Overlay',
      subtitle: 'Controls that prevent overconfident calls',
      html: `
        <ul style="margin:0;padding-left:16px;display:flex;flex-direction:column;gap:8px;color:var(--text2);font-size:12px;line-height:1.5">
          <li><strong style="color:var(--text)">Volatility Regime Penalty</strong> lowers score during elevated VIX environments.</li>
          <li><strong style="color:var(--text)">Macro Conflict Check</strong> penalizes bullish calls under tightening-rate stress.</li>
          <li><strong style="color:var(--text)">Tug-of-War Filter</strong> dampens output when bull/bear factors strongly conflict.</li>
          <li><strong style="color:var(--text)">Confidence Calibration</strong> scales confidence using signal consistency, factor conflict, and regime quality checks.</li>
          <li><strong style="color:var(--text)">Risk Budgeting</strong> avoids aggressive bias when downside tail-risk is high.</li>
        </ul>
      `,
      footnote: 'High-level view only: the live implementation mixes explicit overlays with confidence heuristics and risk metrics.'
    },
    step4: {
      title: 'STEP 4 · Final Scoring',
      subtitle: 'Conceptual scoring example',
      html: `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px"><span>Technical Trend</span><span>78</span></div>
            <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden"><div class="factor-bar-fill" data-score="78" style="height:100%;width:0;background:var(--cyan);transition:width .35s ease"></div></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px"><span>Fundamental Value</span><span>64</span></div>
            <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden"><div class="factor-bar-fill" data-score="64" style="height:100%;width:0;background:var(--green);transition:width .35s ease"></div></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px"><span>Fundamental Momentum</span><span>55</span></div>
            <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden"><div class="factor-bar-fill" data-score="55" style="height:100%;width:0;background:#22c55e;transition:width .35s ease"></div></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px"><span>News & Sentiment</span><span>71</span></div>
            <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden"><div class="factor-bar-fill" data-score="71" style="height:100%;width:0;background:var(--amber);transition:width .35s ease"></div></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px"><span>Macro Context</span><span>58</span></div>
            <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden"><div class="factor-bar-fill" data-score="58" style="height:100%;width:0;background:#8b5cf6;transition:width .35s ease"></div></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px"><span>Bearish Pressure</span><span>42</span></div>
            <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden"><div class="factor-bar-fill" data-score="42" style="height:100%;width:0;background:var(--red);transition:width .35s ease"></div></div>
          </div>
        </div>
      `,
      footnote: 'Conceptual example only: live recommendations use dynamic signal weights, horizon-specific multipliers, and a separate bearish-pressure summary in the analysis panel.'
    },
    step5: {
      title: 'STEP 5 · Recommendation',
      subtitle: 'Final output delivered to user',
      html: `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="padding:12px;border:1px solid var(--border);border-radius:10px;background:rgba(59,130,246,0.08)">
            <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-bottom:6px">COMPOSITE OUTPUT</div>
            <div style="display:flex;justify-content:space-between;align-items:end">
              <div>
                <div style="font-size:20px;color:var(--text);font-weight:600;line-height:1">72 / 100</div>
                <div style="font-size:12px;color:var(--text2)">Confidence: Medium-High</div>
              </div>
              <div style="padding:5px 10px;border-radius:999px;background:rgba(16,185,129,0.14);color:var(--green);font-family:var(--mono);font-size:11px;border:1px solid rgba(16,185,129,0.25)">BUY BIAS</div>
            </div>
          </div>
          <ul style="margin:0;padding-left:16px;display:flex;flex-direction:column;gap:6px;color:var(--text2);font-size:12px;line-height:1.5">
            <li>Decision: Buy / Hold / Sell mapped from threshold bands.</li>
            <li>Confidence: calibrated from score strength, signal agreement, and factor conflict checks.</li>
            <li>Rationale: top positive and negative drivers surfaced to user.</li>
          </ul>
        </div>
      `,
      footnote: 'High-level view only: the output includes actionable levels and explanation, but this modal is not a formal algorithm specification.'
    }
  };

  function renderDecisionExplainBars() {
    const rows = document.querySelectorAll('.factor-bar-fill[data-score]');
    rows.forEach((el) => {
      const score = Number(el.dataset.score || 0);
      const normalized = Math.max(0, Math.min(100, score));
      el.style.width = `${normalized}%`;
    });
  }

  function selectDecisionStep(stepKey) {
    const content = decisionStepData[stepKey];
    if (!content) return;

    const title = document.getElementById('decision-panel-title');
    const subtitle = document.getElementById('decision-panel-subtitle');
    const body = document.getElementById('decision-panel-body');
    const footnote = document.getElementById('decision-panel-footnote');

    if (title) title.textContent = content.title;
    if (subtitle) subtitle.textContent = content.subtitle;
    if (body) body.innerHTML = content.html;
    if (footnote) footnote.textContent = content.footnote;

    const cards = document.querySelectorAll('.decision-step-card[data-step]');
    cards.forEach((card) => {
      card.classList.toggle('active', card.dataset.step === stepKey);
    });

    renderDecisionExplainBars();
  }

  function showMindmap() {
    const modal = document.getElementById('mindmap-modal');
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.zIndex = '9999';
    if (typeof closeInfoMenu === 'function') closeInfoMenu();
    renderDecisionExplainBars();
  }

  function hideMindmap() {
    const modal = document.getElementById('mindmap-modal');
    modal.style.visibility = 'hidden';
    modal.style.opacity = '0';
    modal.style.zIndex = '-1';
  }

  function showAlgorithmSpec() {
    const modal = document.getElementById('algorithm-modal');
    if (!modal) return;
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.zIndex = '9999';
    if (typeof closeInfoMenu === 'function') closeInfoMenu();
  }

  function hideAlgorithmSpec() {
    const modal = document.getElementById('algorithm-modal');
    if (!modal) return;
    modal.style.visibility = 'hidden';
    modal.style.opacity = '0';
    modal.style.zIndex = '-1';
  }

  window.addEventListener('DOMContentLoaded', () => {
    selectDecisionStep('step1');
    const modal = document.getElementById('mindmap-modal');
    if (modal) {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) hideMindmap();
      });
    }
    const algorithmModal = document.getElementById('algorithm-modal');
    if (algorithmModal) {
      algorithmModal.addEventListener('click', (event) => {
        if (event.target === algorithmModal) hideAlgorithmSpec();
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideMindmap();
        hideAlgorithmSpec();
      }
    });
  });
