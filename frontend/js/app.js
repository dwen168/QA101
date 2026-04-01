function toggleTheme() {
  const body = document.body;
  const isLight = body.getAttribute('data-theme') === 'light';
  if (isLight) {
    body.removeAttribute('data-theme');
    localStorage.setItem('quantbot.theme', 'dark');
    document.getElementById('theme-icon-light').style.display = 'block';
    document.getElementById('theme-icon-dark').style.display = 'none';
  } else {
    body.setAttribute('data-theme', 'light');
    localStorage.setItem('quantbot.theme', 'light');
    document.getElementById('theme-icon-light').style.display = 'none';
    document.getElementById('theme-icon-dark').style.display = 'block';
  }
}

// Ensure theme is set immediately on load
(function() {
  const saved = localStorage.getItem('quantbot.theme');
  if (saved === 'light') {
    document.body.setAttribute('data-theme', 'light');
  }
})();

function detectDevice() {
  const isMobile = window.innerWidth <= 900 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    document.body.classList.add('is-mobile');
    document.body.classList.remove('is-desktop');
    if (!document.body.classList.contains('show-chat') && !document.body.classList.contains('show-analysis')) {
      document.body.classList.add('show-chat');
    }
  } else {
    document.body.classList.add('is-desktop');
    document.body.classList.remove('is-mobile');
    document.body.classList.remove('show-chat', 'show-analysis');
  }
}

function setMobileTab(tab) {
  if (tab === 'chat') {
    document.body.classList.add('show-chat');
    document.body.classList.remove('show-analysis');
  } else {
    document.body.classList.add('show-analysis');
    document.body.classList.remove('show-chat');
  }
  document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  detectDevice();
  window.addEventListener('resize', detectDevice);

  const saved = localStorage.getItem('quantbot.theme');
  if (saved === 'light') {
    const lightIcon = document.getElementById('theme-icon-light');
    const darkIcon = document.getElementById('theme-icon-dark');
    if (lightIcon) lightIcon.style.display = 'none';
    if (darkIcon) darkIcon.style.display = 'block';
  }
});

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const API_BASE = '/api';
const DEFAULT_MODELS = {
  deepseek: 'deepseek-chat',
  gemini: 'gemma-3-12b-it',
  ollama: 'qwen3.5:9b',
};
const MODEL_PRESETS = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  gemini: ['gemma-3-12b-it', 'gemma-3-27b-it'],
  ollama: [],
};
const STORAGE_KEYS = {
  provider: 'quantbot.llm.provider',
  model: 'quantbot.llm.model',
};
let chatHistory = [];
let currentCharts = {};
let currentRequestController = null;
let isProcessingRequest = false;
let llmConfig = {
  provider: 'deepseek',
  model: DEFAULT_MODELS.deepseek,
};
let llmModelCache = {
  deepseek: [...MODEL_PRESETS.deepseek],
  gemini: [...MODEL_PRESETS.gemini],
  ollama: [...MODEL_PRESETS.ollama],
};

function getLlmHeaders(includeJson = true) {
  const headers = {};
  if (includeJson) headers['Content-Type'] = 'application/json';
  headers['x-llm-provider'] = llmConfig.provider;
  if (String(llmConfig.model || '').trim()) {
    headers['x-llm-model'] = String(llmConfig.model).trim();
  }
  return headers;
}

function saveLlmConfig() {
  localStorage.setItem(STORAGE_KEYS.provider, llmConfig.provider);
  localStorage.setItem(STORAGE_KEYS.model, llmConfig.model);
}

function updateLlmControls() {
  const providerEl = document.getElementById('llm-provider');
  const modelEl = document.getElementById('llm-model');
  const statusEl = document.getElementById('llm-status');

  if (providerEl) providerEl.value = llmConfig.provider;
  updateModelOptions(llmConfig.provider);
  if (modelEl) modelEl.value = llmConfig.model;
  if (statusEl) statusEl.textContent = `${llmConfig.provider} · ${llmConfig.model}`;
}

function updateModelOptions(provider) {
  const modelSelect = document.getElementById('llm-model');
  if (!modelSelect) return;

  let options = [];
  if (provider === 'ollama') {
    options = Array.from(new Set((llmModelCache.ollama || []).filter(Boolean)));
    if (options.length === 0 && llmConfig.provider === 'ollama' && llmConfig.model) {
      options = [llmConfig.model];
    }
  } else if (provider === 'gemini') {
    options = Array.from(new Set([
      ...(llmModelCache.gemini || []),
      llmConfig.model,
    ].filter(Boolean)));
  } else {
    options = Array.from(new Set([
      ...(llmModelCache.deepseek || []),
      llmConfig.model,
    ].filter(Boolean)));
  }

  if (options.length === 0) {
    options = [DEFAULT_MODELS[provider]];
  }

  modelSelect.innerHTML = options
    .map((model) => `<option value="${model}">${model}</option>`)
    .join('');
}

function applyLlmConfig(provider, model) {
  const resolvedProvider = ['deepseek', 'ollama', 'gemini'].includes(provider) ? provider : 'deepseek';
  const resolvedModel = String(model || '').trim() || DEFAULT_MODELS[resolvedProvider];

  llmModelCache[resolvedProvider] = Array.from(new Set([
    ...(llmModelCache[resolvedProvider] || []),
    resolvedModel,
  ]));

  llmConfig = {
    provider: resolvedProvider,
    model: resolvedModel,
  };
  updateLlmControls();
  saveLlmConfig();
}

async function refreshModelsForProvider(provider) {
  try {
    const response = await fetch(`${API_BASE}/llm/models?provider=${encodeURIComponent(provider)}`);
    if (!response.ok) return;
    const payload = await response.json();
    const models = Array.isArray(payload?.models)
      ? payload.models.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    if (models.length > 0) {
      llmModelCache[provider] = Array.from(new Set([...(llmModelCache[provider] || []), ...models]));
    }
  } catch {
    // Use local presets only when backend model list is unavailable.
  }
}

async function handleLlmProviderChange() {
  const providerEl = document.getElementById('llm-provider');
  const nextProvider = ['deepseek', 'ollama', 'gemini'].includes(providerEl?.value)
    ? providerEl.value
    : 'deepseek';
  await refreshModelsForProvider(nextProvider);
  const candidates = llmModelCache[nextProvider] || [];
  const nextModel = candidates[0]
    || (nextProvider === 'ollama' ? llmConfig.model : DEFAULT_MODELS[nextProvider]);
  applyLlmConfig(nextProvider, nextModel);
}

function handleLlmModelChange() {
  const selectedProvider = document.getElementById('llm-provider')?.value;
  const provider = ['deepseek', 'ollama', 'gemini'].includes(selectedProvider) ? selectedProvider : 'deepseek';
  const model = document.getElementById('llm-model')?.value;
  applyLlmConfig(provider, model);
}

async function initializeLlmConfig() {
  const savedProvider = localStorage.getItem(STORAGE_KEYS.provider);
  const savedModel = localStorage.getItem(STORAGE_KEYS.model);

  if (savedProvider || savedModel) {
    const provider = ['deepseek', 'ollama', 'gemini'].includes(savedProvider) ? savedProvider : 'deepseek';
    await refreshModelsForProvider(provider);
    applyLlmConfig(savedProvider, savedModel);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    const provider = ['deepseek', 'ollama', 'gemini'].includes(data.llm?.provider)
      ? data.llm.provider
      : 'deepseek';
    await refreshModelsForProvider(provider);
    applyLlmConfig(data.llm?.provider, data.llm?.model);
  } catch {
    await refreshModelsForProvider('deepseek');
    applyLlmConfig('deepseek', DEFAULT_MODELS.deepseek);
  }
}

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDurationMs(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.max(1, Math.round(value))}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function addMessage(role, content, skillBadge = null) {
  const container = document.getElementById('chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `msg ${role} fade-in`;
  let html = '';
  if (skillBadge) html += `<div class="skill-badge ${skillBadge.cls}">${skillBadge.label}</div>`;
  html += `<div class="msg-bubble">${content}</div>`;
  html += `<span class="msg-time">${role === 'user' ? 'You' : 'QuantBot'} · ${formatTime()}</span>`;
  msgDiv.innerHTML = html;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function addLoadingMsg(text) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.id = 'loading-msg';
  div.className = 'msg bot fade-in';
  div.innerHTML = `<div class="msg-bubble" style="display:flex;align-items:center;gap:8px;"><div class="spin"></div>${text}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function removeLoadingMsg() {
  const el = document.getElementById('loading-msg');
  if (el) el.remove();
}

function isAbortError(error) {
  return error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted');
}

function updateStopButtonState() {
  const stopBtn = document.getElementById('stop-btn');
  if (stopBtn) stopBtn.disabled = !isProcessingRequest;
}

function beginRequestSession() {
  if (currentRequestController) {
    currentRequestController.abort();
  }
  currentRequestController = new AbortController();
  isProcessingRequest = true;
  updateStopButtonState();
}

function endRequestSession() {
  isProcessingRequest = false;
  currentRequestController = null;
  updateStopButtonState();
}

function cancelCurrentRequest() {
  if (!currentRequestController) return;
  currentRequestController.abort();
  removeLoadingMsg();
  resetPills();
  addMessage('bot', '⏹ Current request cancelled.');
  endRequestSession();
}

async function apiFetch(url, options = {}) {
  const signal = options.signal || currentRequestController?.signal;
  return fetch(url, { ...options, signal });
}

async function readApiJson(response) {
  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      const preview = rawText.slice(0, 120).replace(/\s+/g, ' ').trim();
      throw new Error(`Backend returned non-JSON response (status ${response.status}). ${preview}`);
    }
  }

  if (!response.ok) {
    const errorMessage = String(payload?.error || payload?.message || `Request failed with status ${response.status}`);
    throw new Error(errorMessage);
  }

  if (payload && typeof payload === 'object' && payload.error) {
    throw new Error(String(payload.error));
  }

  return payload;
}

function setPillState(n, state) {
  const pill = document.getElementById(`pill-${n}`);
  pill.className = `skill-pill ${state}`;
}
function resetPills() {
  [1,2,3,4].forEach(n => setPillState(n, ''));
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  await processMessage(text);
}

async function quickAnalyze(ticker) {
  const text = `Analyze ${ticker}`;
  addMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  await processMessage(text);
}

async function quickPortfolio(tickers) {
  const text = `Optimize portfolio ${tickers.join(', ')}`;
  addMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  await processMessage(text);
}

async function quickBacktest(ticker) {
  const text = `Backtest ${ticker} from 2025-01-01 to 2026-03-18`;
  addMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  await processMessage(text);
}

async function processMessage(text) {
  const loadEl = addLoadingMsg('Thinking...');
  resetPills();
  beginRequestSession();

  try {
    const res = await apiFetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: getLlmHeaders(),
      body: JSON.stringify({ message: text, history: chatHistory.slice(-6) }),
    });
    const data = await readApiJson(res);
    removeLoadingMsg();

    if (data.action === 'ANALYZE_STOCK' && data.ticker) {
      addMessage('bot', data.message || `Running analysis on <strong>${data.ticker}</strong>...`);
      chatHistory.push({ role: 'assistant', content: data.message });
      if (document.body.classList.contains('is-mobile')) setMobileTab('analysis');
      await runSkillPipeline(data.ticker, data.timeHorizon || 'MEDIUM');
    } else if (data.action === 'RUN_BACKTEST' && data.ticker) {
      addMessage('bot', data.message || `Running backtest on <strong>${data.ticker}</strong>...`);
      chatHistory.push({ role: 'assistant', content: data.message || 'Running backtest...' });
      if (document.body.classList.contains('is-mobile')) setMobileTab('analysis');
      await runBacktestPipeline(data.ticker, data.startDate, data.endDate, data.strategyName || 'trade-recommendation', data.timeHorizon || 'MEDIUM');
    } else if (data.action === 'OPTIMIZE_PORTFOLIO') {
      const tickers = Array.isArray(data.tickers) ? data.tickers : [];
      if (tickers.length >= 2) {
        addMessage('bot', data.message || `Running portfolio optimization on <strong>${tickers.join(', ')}</strong>...`);
        chatHistory.push({ role: 'assistant', content: data.message || 'Running portfolio optimization...' });
        if (document.body.classList.contains('is-mobile')) setMobileTab('analysis');
        await runPortfolioPipeline(tickers, data.timeHorizon || 'MEDIUM');
      } else {
        addMessage('bot', data.message || 'Please provide at least 2 tickers, e.g. "Optimize portfolio AAPL, MSFT, NVDA".');
        chatHistory.push({ role: 'assistant', content: data.message || 'Please provide at least 2 tickers.' });
      }
    } else {
      addMessage('bot', data.message || 'How can I help?');
      chatHistory.push({ role: 'assistant', content: data.message });
    }
  } catch (err) {
    if (isAbortError(err)) {
      return;
    }
    removeLoadingMsg();
    const detail = String(err?.message || '').trim();
    addMessage('bot', detail || 'Request failed. Please retry in a moment.');
  } finally {
    endRequestSession();
  }
}

async function runSkillPipeline(ticker, timeHorizon = 'MEDIUM') {
  const pipelineStartedAt = performance.now();
  // Clear previous analysis
  const panel = document.getElementById('analysis-panel');
  panel.innerHTML = '';
  destroyCharts();

  // ── SKILL 1 ──
  setPillState(1, 'active');
  const l1 = addLoadingMsg('⟳ Running market-intelligence skill...');

  let marketData, llmAnalysis, dataSource, usedFallback, fallbackReason;
  try {
    const skillStartedAt = performance.now();
    const r1 = await apiFetch(`${API_BASE}/skills/market-intelligence`, {
      method: 'POST', headers: getLlmHeaders(),
      body: JSON.stringify({ ticker }),
    });
    const d1 = await readApiJson(r1);
    marketData = d1.marketData;
    llmAnalysis = d1.llmAnalysis;
    dataSource = d1.dataSource || d1.marketData.dataSource || 'unknown';
    usedFallback = d1.usedFallback || false;
    fallbackReason = d1.fallbackReason;
    setPillState(1, 'done');
    removeLoadingMsg();
    addMessage('bot', `✓ Market intelligence collected for <strong>${ticker}</strong> <span style="color:var(--text3);font-family:var(--mono)">(${formatDurationMs(performance.now() - skillStartedAt)})</span>`, { cls: 's1', label: '① market-intelligence' });
    renderMarketIntelligence(marketData, llmAnalysis, panel, dataSource, usedFallback, fallbackReason);
  } catch (err) {
    if (isAbortError(err)) return;
    setPillState(1, '');
    removeLoadingMsg();
    addMessage('bot', String(err?.message || 'Market intelligence failed.'));
    return;
  }

  // ── SKILL 2 ──
  setPillState(2, 'active');
  const l2 = addLoadingMsg('⟳ Running eda-visual-analysis skill...');

  let charts, edaInsights;
  try {
    const skillStartedAt = performance.now();
    const r2 = await apiFetch(`${API_BASE}/skills/eda-visual-analysis`, {
      method: 'POST', headers: getLlmHeaders(),
      body: JSON.stringify({ marketData }),
    });
    const d2 = await readApiJson(r2);
    charts = d2.charts;
    edaInsights = d2.edaInsights;
    setPillState(2, 'done');
    removeLoadingMsg();
    addMessage('bot', `✓ Visual EDA complete — ${edaInsights.insights?.length || 4} key insights found <span style="color:var(--text3);font-family:var(--mono)">(${formatDurationMs(performance.now() - skillStartedAt)})</span>`, { cls: 's2', label: '② eda-visual-analysis' });
    renderEDA(charts, edaInsights, marketData, panel);
  } catch (err) {
    if (isAbortError(err)) return;
    setPillState(2, '');
    removeLoadingMsg();
    addMessage('bot', String(err?.message || 'EDA analysis failed.'));
  }

  // ── SKILL 3 ──
  setPillState(3, 'active');
  const l3 = addLoadingMsg('⟳ Running trade-recommendation skill...');

  try {
    const skillStartedAt = performance.now();
    const r3 = await apiFetch(`${API_BASE}/skills/trade-recommendation`, {
      method: 'POST', headers: getLlmHeaders(),
      body: JSON.stringify({ marketData, edaInsights, timeHorizon }),
    });
    const d3 = await readApiJson(r3);
    setPillState(3, 'done');
    removeLoadingMsg();
    const rec = d3.recommendation;
    addMessage('bot', `✓ <strong style="color:${rec.actionColor}">${rec.action}</strong> — ${rec.confidence}% confidence <span style="color:var(--text3);font-family:var(--mono)">(${formatDurationMs(performance.now() - skillStartedAt)})</span>`, { cls: 's3', label: '③ trade-recommendation' });
    renderRecommendation(rec, panel);
    addMessage('bot', `⏱ Total pipeline time: <strong>${formatDurationMs(performance.now() - pipelineStartedAt)}</strong>`);
  } catch (err) {
    if (isAbortError(err)) return;
    setPillState(3, '');
    removeLoadingMsg();
    addMessage('bot', `Recommendation engine failed.`);
  }
}

async function runPortfolioPipeline(tickers, timeHorizon = 'MEDIUM') {
  const pipelineStartedAt = performance.now();
  const panel = document.getElementById('analysis-panel');
  panel.innerHTML = '';
  destroyCharts();
  resetPills();

  const loading = addLoadingMsg('⟳ Running portfolio-optimization skill...');
  try {
    const skillStartedAt = performance.now();
    const r = await apiFetch(`${API_BASE}/skills/portfolio-optimization`, {
      method: 'POST',
      headers: getLlmHeaders(),
      body: JSON.stringify({ tickers, timeHorizon }),
    });
    const d = await r.json();
    removeLoadingMsg();

    if (!r.ok || d.error) {
      addMessage('bot', d.error || 'Portfolio optimization failed.');
      return;
    }

    addMessage(
      'bot',
      `✓ Portfolio optimization complete for <strong>${tickers.join(', ')}</strong> <span style="color:var(--text3);font-family:var(--mono)">(${formatDurationMs(performance.now() - skillStartedAt)})</span>`,
      { cls: 's2', label: 'portfolio-optimization' }
    );
    addMessage('bot', `⏱ Total pipeline time: <strong>${formatDurationMs(performance.now() - pipelineStartedAt)}</strong>`);
    renderPortfolioOptimization(d, panel);
  } catch (err) {
    if (isAbortError(err)) return;
    removeLoadingMsg();
    addMessage('bot', 'Could not run portfolio optimization. Please check deployment logs and API routes.');
  }
}

async function runBacktestPipeline(ticker, startDate, endDate, strategyName = 'trade-recommendation', timeHorizon = 'MEDIUM') {
  const pipelineStartedAt = performance.now();
  const panel = document.getElementById('analysis-panel');
  panel.innerHTML = '';
  destroyCharts();
  resetPills();

  setPillState(4, 'active');
  const loading = addLoadingMsg('⟳ Running backtesting skill...');
  try {
    const skillStartedAt = performance.now();
    const r = await apiFetch(`${API_BASE}/skills/backtesting`, {
      method: 'POST',
      headers: getLlmHeaders(),
      body: JSON.stringify({ ticker, startDate, endDate, strategyName, timeHorizon, initialCapital: 100000 }),
    });
    const d = await r.json();
    removeLoadingMsg();

    if (!r.ok || d.error) {
      setPillState(4, '');
      const availableRange = d?.availableRange;
      const rangeHint = availableRange?.startDate && availableRange?.endDate
        ? `<br><span style="color:var(--text3);font-family:var(--mono)">Available range: ${availableRange.startDate} to ${availableRange.endDate}</span>`
        : '';
      addMessage('bot', `${d.error || 'Backtesting failed.'}${rangeHint}`);
      return;
    }

    setPillState(4, 'done');
    addMessage('bot', `✓ Backtest complete for <strong>${ticker}</strong> <span style="color:var(--text3);font-family:var(--mono)">(${formatDurationMs(performance.now() - skillStartedAt)})</span>`, { cls: 's2', label: '④ backtesting' });
    addMessage('bot', `⏱ Total pipeline time: <strong>${formatDurationMs(performance.now() - pipelineStartedAt)}</strong>`);
    renderBacktestReport(d.backtestReport, panel);
  } catch (err) {
    if (isAbortError(err)) return;
    setPillState(4, '');
    removeLoadingMsg();
    addMessage('bot', 'Could not run backtest. Make sure backend is running and API keys are configured.');
  }
}

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
      <span style="font-size:11px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:rgba(59,130,246,0.08);color:var(--cyan);border:1px solid rgba(59,130,246,0.2)">${result.timeHorizon || 'MEDIUM'} term</span>
    </div>
    <div class="ticker-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-item"><span class="stat-label">TOTAL ALLOCATION</span><span class="stat-value">${(metrics.totalAllocation ?? 0).toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-label">CASH BUFFER</span><span class="stat-value">${(metrics.cashBuffer ?? 0).toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-label">EXPECTED RETURN</span><span class="stat-value">${(metrics.expectedReturn ?? 0).toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-label">AVG PAIRWISE CORR</span><span class="stat-value">${(div.avgPairwiseCorrelation ?? 0).toFixed(3)}</span></div>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--text2)"><strong>Diversification:</strong> ${div.riskAssessment || 'N/A'}</div>
  `;
  panel.appendChild(summary);

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
    <div style="display:grid;grid-template-columns:50px 88px 88px 96px 84px 84px 78px;gap:8px;font-size:10px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:0.08em;padding:0 0 6px;border-bottom:1px solid var(--border)">
      <span>Rank</span><span>Ticker</span><span>Action</span><span>Score</span><span>Macro</span><span>Event</span><span>Alloc</span>
    </div>
    ${(ranked || []).map(r => `
      <div style="display:grid;grid-template-columns:50px 88px 88px 96px 84px 84px 78px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;font-family:var(--mono)">
        <span style="color:var(--text3)">#${r.rank}</span>
        <span style="color:var(--cyan)">${r.ticker}</span>
        <span style="color:${r.action && r.action.includes('BUY') ? 'var(--green)' : r.action === 'SELL' ? 'var(--red)' : 'var(--amber)'}">${r.action || 'HOLD'}</span>
        <span>${(r.compositeScore ?? 0).toFixed(1)} <span style="color:var(--text3)">(${(r.baseCompositeScore ?? r.compositeScore ?? 0).toFixed(1)})</span></span>
        <span style="color:${(r.macroAdjustment ?? 0) < 0 ? 'var(--red)' : (r.macroAdjustment ?? 0) > 0 ? 'var(--green)' : 'var(--text2)'}">${(r.macroAdjustment ?? 0) > 0 ? '+' : ''}${(r.macroAdjustment ?? 0).toFixed(1)}</span>
        <span style="color:${(r.eventAdjustment ?? 0) < 0 ? 'var(--red)' : (r.eventAdjustment ?? 0) > 0 ? 'var(--green)' : 'var(--text2)'}">${(r.eventAdjustment ?? 0) > 0 ? '+' : ''}${(r.eventAdjustment ?? 0).toFixed(1)}</span>
        <span>${(r.allocation ?? 0).toFixed(1)}%</span>
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

  const chartCard = document.createElement('div');
  chartCard.className = 'chart-full fade-in';
  chartCard.innerHTML = `<div class="chart-title">Equity Curve</div><div class="chart-canvas-wrap" style="height:260px"><canvas id="chart-backtest-equity"></canvas></div>`;
  panel.appendChild(chartCard);
  setTimeout(() => {
    const ctx = document.getElementById('chart-backtest-equity')?.getContext('2d');
    if (!ctx) return;
    currentCharts['backtest-equity'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: equity.map(p => String(p.date).slice(0, 10)),
        datasets: [{
          label: 'Capital',
          data: equity.map(p => p.capital),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          fill: true,
          tension: 0.2,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#7a8fb8', font: { size: 11, family: "'DM Mono', monospace" } } } },
        scales: {
          x: { ticks: { color: '#3d5080', maxTicksLimit: 8 }, grid: { color: 'rgba(59,130,246,0.04)' }, border: { color: 'rgba(59,130,246,0.1)' } },
          y: { ticks: { color: '#3d5080' }, grid: { color: 'rgba(59,130,246,0.04)' }, border: { color: 'rgba(59,130,246,0.1)' } },
        },
      },
    });
  }, 50);

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
    tradesCard.innerHTML = `
      <div class="card-header"><span class="card-title">Recent Trades</span></div>
      <div style="display:grid;grid-template-columns:70px 110px 90px 90px 100px;gap:8px;font-size:10px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:0.08em;padding:0 0 6px;border-bottom:1px solid var(--border)">
        <span>ID</span><span>Entry</span><span>Exit</span><span>PnL %</span><span>Reason</span>
      </div>
      ${trades.slice(0, 12).map(t => `
        <div style="display:grid;grid-template-columns:70px 110px 90px 90px 100px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;font-family:var(--mono)">
          <span>#${t.tradeId}</span>
          <span>${String(t.entryDate).slice(0,10)} @ $${t.entryPrice}</span>
          <span>${String(t.exitDate).slice(0,10)}</span>
          <span style="color:${t.pnlPercent >= 0 ? 'var(--green)' : 'var(--red)'}">${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent}%</span>
          <span style="color:var(--text2)">${t.reason}</span>
        </div>
      `).join('')}
    `;
    panel.appendChild(tradesCard);
  }

  panel.scrollTop = 0;
}

// ─────────────────────────────────────────
// RENDER: Market Intelligence
// ─────────────────────────────────────────
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

// ─────────────────────────────────────────
// RENDER: EDA
// ─────────────────────────────────────────
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

// ─────────────────────────────────────────
// RENDER: Recommendation
// ─────────────────────────────────────────
function renderRecommendation(rec, panel) {
  const renderDecisionTreeHtml = (tree) => {
    if (!tree || !Array.isArray(tree.pillars) || tree.pillars.length === 0) return '';

    const leaf = tree.leaf || {};

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
      const isRisk = !!pillar.inverse;
      const palette   = isRisk ? riskPalette(pillar.outcome) : pillarPalette(pillar.outcome);
      const topSignals = Array.isArray(pillar.topSignals) ? pillar.topSignals : [];
      const evidenceId = `factor-evidence-${String(pillar.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

      const scoreLabel = isRisk
        ? `${pillar.riskPressurePct ?? 0}% drag`
        : `${pillar.netScore >= 0 ? '+' : ''}${pillar.netScore} pts`;

      const barHtml = isRisk
        ? riskPressureBar(pillar.riskPressurePct ?? 0)
        : contributionBar(pillar.netScore);

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

    return `
      <div style="margin-top:16px;padding:12px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,0.02)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <div style="font-size:13px;color:var(--cyan);font-family:var(--mono);font-weight:700;text-transform:uppercase;letter-spacing:0.1em">Factor Contribution</div>
          <span class="detail-chip">${leaf.action || rec.action} · ${leaf.confidence ?? rec.confidence}% confidence</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${pillarCards}
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
    if (key === 'tv-price') { try { c.remove(); } catch(e) {} }
    else if (key !== 'tv-price-data') { try { c.destroy(); } catch(e) {} }
  });
  currentCharts = {};
}

function toggleExportMenu(event) {
  event.stopPropagation();
  closeInfoMenu();
  closeReportsMenu();
  const dropdown = document.getElementById('export-dropdown');
  dropdown.classList.toggle('open');
}

function closeExportMenu() {
  document.getElementById('export-dropdown')?.classList.remove('open');
}

function toggleInfoMenu(event) {
  event.stopPropagation();
  closeExportMenu();
  closeReportsMenu();
  const dropdown = document.getElementById('info-dropdown');
  dropdown.classList.toggle('open');
}

function closeInfoMenu() {
  document.getElementById('info-dropdown')?.classList.remove('open');
}

function toggleReportsMenu(event) {
  event.stopPropagation();
  closeExportMenu();
  closeInfoMenu();
  const dropdown = document.getElementById('reports-menu-dropdown');
  dropdown?.classList.toggle('open');
  if (dropdown?.classList.contains('open')) {
    loadReportsList();
  }
}

function closeReportsMenu() {
  document.getElementById('reports-menu-dropdown')?.classList.remove('open');
}

function hasExportableContent() {
  const panel = document.getElementById('analysis-panel');
  return !!panel && !panel.querySelector('#welcome-state') && panel.children.length > 0;
}

function buildExportFilename(extension) {
  const panel = document.getElementById('analysis-panel');
  const ticker = panel?.querySelector('.ticker-symbol')?.textContent?.trim();
  const section = panel?.querySelector('.section-divider-text')?.textContent?.trim();
  const label = (ticker || section || 'analysis')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const stamp = new Date().toISOString().slice(0, 10);
  return `quantbot-${label || 'analysis'}-${stamp}.${extension}`;
}

function clonePanelForExport() {
  const panel = document.getElementById('analysis-panel');
  const clone = panel.cloneNode(true);
  const sourceCanvases = Array.from(panel.querySelectorAll('canvas'));
  const cloneCanvases = Array.from(clone.querySelectorAll('canvas'));

  cloneCanvases.forEach((canvas, index) => {
    const sourceCanvas = sourceCanvases[index];
    const img = document.createElement('img');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    img.alt = 'Exported chart';

    try {
      img.src = sourceCanvas.toDataURL('image/png');
      canvas.replaceWith(img);
    } catch {
      const fallback = document.createElement('div');
      fallback.className = 'card';
      fallback.style.padding = '14px';
      fallback.style.fontSize = '12px';
      fallback.style.color = 'var(--text2)';
      fallback.textContent = 'Chart preview unavailable in export.';
      canvas.replaceWith(fallback);
    }
  });

  const tvContainerClone = clone.querySelector('#tv-price-container');
  const liveTvChart = currentCharts['tv-price'];
  if (tvContainerClone && liveTvChart && typeof liveTvChart.takeScreenshot === 'function') {
    try {
      const screenshot = liveTvChart.takeScreenshot();
      const img = document.createElement('img');
      img.src = screenshot.toDataURL('image/png');
      img.alt = 'Candlestick chart snapshot';
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.display = 'block';
      tvContainerClone.innerHTML = '';
      tvContainerClone.appendChild(img);
      tvContainerClone.style.height = 'auto';
      tvContainerClone.style.minHeight = '180px';
      tvContainerClone.style.overflow = 'hidden';
    } catch {
      // Keep cloned chart DOM if screenshot capture is unavailable.
    }
  }

  clone.id = 'export-analysis-panel';
  clone.querySelector('#reports-fab')?.remove();
  clone.querySelector('#reports-drawer')?.remove();
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  clone.style.padding = '0';
  clone.style.overflow = 'visible';
  return clone;
}

function buildSavableReportHtml() {
  const exportedPanel = clonePanelForExport();
  return exportedPanel.innerHTML;
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function collectExportStyles() {
  const styleChunks = [];

  for (const sheet of Array.from(document.styleSheets || [])) {
    try {
      const rules = Array.from(sheet.cssRules || []);
      if (rules.length) {
        styleChunks.push(rules.map((rule) => rule.cssText).join('\n'));
      }
    } catch {
      // Ignore stylesheets that cannot be read due to browser restrictions.
    }
  }

  return styleChunks.join('\n');
}

function buildBodyExportAttributes() {
  const attrs = [];
  const theme = document.body.getAttribute('data-theme');
  const bodyClass = (document.body.className || '').trim();

  if (theme) attrs.push(`data-theme="${escapeHtml(theme)}"`);
  if (bodyClass) attrs.push(`class="${escapeHtml(bodyClass)}"`);

  return attrs.length ? ` ${attrs.join(' ')}` : '';
}

async function buildExportDocument() {
  const styles = collectExportStyles();
  const exportedPanel = clonePanelForExport();
  const title = buildExportFilename('html').replace(/\.html$/, '');
  const bodyAttrs = buildBodyExportAttributes();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
${styles}
* { box-sizing: border-box; }
body { height: auto; overflow: visible; padding: 24px; background: var(--bg); }
.export-shell { max-width: 1280px; margin: 0 auto; }
.analysis-panel { padding: 0; overflow: visible; max-width: 100%; }
.chart-full, .chart-wrap, .card { max-width: 100%; overflow: hidden; }
.chart-title-group, .chart-legend, .chart-legend-values { min-width: 0; flex-wrap: wrap; }
.chart-canvas-wrap, .chart-full .chart-canvas-wrap { height: auto; min-height: 180px; }
canvas, img { max-width: 100%; width: 100%; height: auto; }
@media print {
  body { padding: 0; }
  .export-shell { max-width: none; }
  .card, .chart-wrap, .chart-full, .risk-flag { break-inside: avoid; page-break-inside: avoid; }
}
</style>
</head>
<body${bodyAttrs}>
  <div class="export-shell">
    ${exportedPanel.outerHTML}
  </div>
</body>
</html>`;
}

async function exportCurrentView(format) {
  closeExportMenu();

  if (!hasExportableContent()) {
    alert('Run an analysis, portfolio optimization, or backtest first.');
    return;
  }

  const exportHtml = await buildExportDocument();

  if (format === 'html') {
    const blob = new Blob([exportHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildExportFilename('html');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  if (format === 'pdf') {
    const existingFrame = document.getElementById('print-export-frame');
    if (existingFrame) existingFrame.remove();

    const frame = document.createElement('iframe');
    frame.id = 'print-export-frame';
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    document.body.appendChild(frame);

    const frameDoc = frame.contentWindow?.document;
    if (!frameDoc || !frame.contentWindow) {
      frame.remove();
      alert('PDF export is unavailable in this browser context.');
      return;
    }

    frameDoc.open();
    frameDoc.write(exportHtml);
    frameDoc.close();

    frame.onload = () => {
      setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      }, 300);

      const cleanup = () => setTimeout(() => frame.remove(), 1000);
      frame.contentWindow.onafterprint = cleanup;
      setTimeout(cleanup, 60000);
    };
  }
}

// Enter key sends
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

initializeLlmConfig();
document.addEventListener('click', closeExportMenu);
document.addEventListener('click', closeInfoMenu);
document.addEventListener('click', closeReportsMenu);

// ─────────────────────────────────────────────
//  Reports Library (localStorage-backed)
// ─────────────────────────────────────────────

const REPORTS_STORAGE_KEY = 'quantbot.reports.v1';

function readLocalReports() {
  try {
    const raw = localStorage.getItem(REPORTS_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalReports(reports) {
  localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
}

function updateReportsBadge(count) {
  const badge = document.getElementById('reports-count');
  if (!badge) return;

  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

function formatReportTimestamp(createdAt) {
  return new Date(createdAt).toLocaleString('en-AU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function renderReportsMenu(reports) {
  const container = document.getElementById('reports-menu-list');
  if (!container) return;

  if (!reports.length) {
    container.innerHTML = '<div class="reports-menu-empty">No saved reports yet.<br>Use Save to Reports Library after generating an analysis.</div>';
    return;
  }

  container.innerHTML = reports.map((report) => `
    <div class="report-menu-item">
      <div class="report-menu-meta">
        <div class="report-menu-ticker">${report.ticker}</div>
        <div class="report-menu-label" title="${report.label}">${report.label}</div>
        <div class="report-menu-date">${formatReportTimestamp(report.created_at)}</div>
      </div>
      <div class="report-menu-actions">
        <button class="report-menu-action load" onclick="event.stopPropagation();restoreReport(${report.id})">Load</button>
        <button class="report-menu-action delete" onclick="event.stopPropagation();deleteReport(${report.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

async function loadReportsList() {
  const menuContainer = document.getElementById('reports-menu-list');
  if (menuContainer) {
    menuContainer.innerHTML = '<div class="reports-menu-empty">Loading...</div>';
  }
  try {
    const reports = readLocalReports().sort((a, b) => Number(b.id) - Number(a.id));

    updateReportsBadge(reports.length);
    renderReportsMenu(reports);
  } catch (err) {
    if (menuContainer) {
      menuContainer.innerHTML = `<div class="reports-menu-empty" style="color:var(--red)">Error loading reports: ${err.message}</div>`;
    }
  }
}

async function saveCurrentReport() {
  if (!hasExportableContent()) {
    showToast('❌ Run an analysis before saving a report', 'error');
    return;
  }

  const panel = document.getElementById('analysis-panel');
  const html = buildSavableReportHtml();
  const payloadBytes = new Blob([html]).size;

  if (payloadBytes > 9 * 1024 * 1024) {
    showToast('❌ Report is too large to save', 'error');
    return;
  }

  // Try to extract ticker from the panel
  const tickerEl = panel.querySelector('.ticker-symbol');
  const ticker = tickerEl ? tickerEl.textContent.trim() : 'UNKNOWN';

  const label = prompt(`Save report label for ${ticker}:`, `${ticker} — ${new Date().toLocaleDateString('en-AU')}`);
  if (!label) return; // user cancelled

  try {
    const reports = readLocalReports();
    const nextId = reports.length ? Math.max(...reports.map((item) => Number(item.id) || 0)) + 1 : 1;
    const data = {
      id: nextId,
      ticker,
      label,
      html,
      created_at: new Date().toISOString(),
    };

    reports.push(data);
    writeLocalReports(reports);

    if (data.id) {
      showToast(`✅ Report saved (ID: ${data.id})`);
      closeExportMenu();
      await loadReportsList();

      const reportsDropdown = document.getElementById('reports-menu-dropdown');
      if (reportsDropdown && !reportsDropdown.classList.contains('open')) {
        reportsDropdown.classList.add('open');
      }
    } else {
      showToast(`❌ Save failed: ${data.error || 'unknown'}`, 'error');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

async function restoreReport(id) {
  try {
    const report = readLocalReports().find((item) => Number(item.id) === Number(id));
    if (!report) throw new Error('Report not found');

    const panel = document.getElementById('analysis-panel');
    const welcome = document.getElementById('welcome-state');
    if (welcome) welcome.style.display = 'none';

    panel.innerHTML = report.html;
    closeReportsMenu();
    showToast(`📂 Loaded: ${report.label}`);
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

async function deleteReport(id) {
  if (!confirm('Delete this saved report?')) return;
  try {
    const reports = readLocalReports();
    const nextReports = reports.filter((item) => Number(item.id) !== Number(id));

    if (nextReports.length !== reports.length) {
      writeLocalReports(nextReports);
      showToast('🗑 Report deleted');
      loadReportsList();
    } else {
      showToast('❌ Report could not be deleted', 'error');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

function showToast(message, type = 'success') {
  const existing = document.getElementById('qb-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'qb-toast';
  const bg = type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)';
  const border = type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)';
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:10px;font-size:13px;font-family:var(--mono);background:${bg};border:1px solid ${border};color:var(--text);backdrop-filter:blur(12px);box-shadow:0 8px 24px rgba(0,0,0,0.3);animation:fadeIn 0.3s ease;pointer-events:none`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Inject "Save Report" button into the export dropdown on startup
document.addEventListener('DOMContentLoaded', () => {
  const dropdown = document.getElementById('export-dropdown');
  if (dropdown) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'export-option';
    saveBtn.onclick = saveCurrentReport;
    saveBtn.innerHTML = `Save to Reports Library <span>Browser</span>`;
    dropdown.insertBefore(saveBtn, dropdown.firstChild);
  }

  loadReportsList().catch(() => {});
});