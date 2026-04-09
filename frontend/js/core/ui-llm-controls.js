// Frontend UI LLM provider/model controls and API base config.

const API_BASE = '/api';
const DEFAULT_MODELS = {
  deepseek: 'deepseek-chat',
  gemini: 'gemini-2.5-flash',
  ollama: 'qwen3.5:9b',
};
const PROVIDER_LABELS = {
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  ollama: 'Ollama',
};
const MODEL_PRESETS = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  gemini: ['gemini-2.5-flash'],
  ollama: [],
};
const STORAGE_KEYS = {
  provider: 'quantbot.llm.provider',
  model: 'quantbot.llm.model',
};

let llmConfig = {
  provider: 'gemini',
  model: DEFAULT_MODELS.gemini,
};
let llmModelCache = {
  deepseek: [...MODEL_PRESETS.deepseek],
  gemini: [...MODEL_PRESETS.gemini],
  ollama: [...MODEL_PRESETS.ollama],
};

function getAllowedProviders() {
  if (typeof window.getAuthState === 'function') {
    const providers = window.getAuthState()?.providers;
    if (Array.isArray(providers) && providers.length > 0) {
      return providers;
    }
  }
  return ['gemini', 'ollama', 'deepseek'];
}

function resolveProvider(provider, allowedProviders = getAllowedProviders()) {
  const candidate = String(provider || '').trim().toLowerCase();
  if (allowedProviders.includes(candidate)) return candidate;
  if (allowedProviders.length > 0) return allowedProviders[0];
  return 'gemini';
}

function renderProviderOptions(allowedProviders = getAllowedProviders()) {
  const providerEl = document.getElementById('llm-provider');
  if (!providerEl) return;

  providerEl.innerHTML = allowedProviders
    .map((provider) => `<option value="${provider}">${PROVIDER_LABELS[provider] || provider}</option>`)
    .join('');
}

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

  const allowedProviders = getAllowedProviders();
  const resolvedProvider = resolveProvider(llmConfig.provider, allowedProviders);
  if (resolvedProvider !== llmConfig.provider) {
    llmConfig.provider = resolvedProvider;
    llmConfig.model = DEFAULT_MODELS[resolvedProvider] || llmConfig.model;
  }

  renderProviderOptions(allowedProviders);
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
  const resolvedProvider = resolveProvider(provider);
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
  const allowedProviders = getAllowedProviders();
  if (!allowedProviders.includes(provider)) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/llm/models?provider=${encodeURIComponent(provider)}`);
    if (!response.ok) {
      if (response.status === 403) return;
      return;
    }
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

async function refreshLlmAvailability() {
  const allowedProviders = getAllowedProviders();
  const provider = resolveProvider(llmConfig.provider, allowedProviders);
  await refreshModelsForProvider(provider);
  applyLlmConfig(provider, llmConfig.model);
}

async function handleLlmProviderChange() {
  const providerEl = document.getElementById('llm-provider');
  const allowedProviders = getAllowedProviders();
  const nextProvider = resolveProvider(providerEl?.value, allowedProviders);
  await refreshModelsForProvider(nextProvider);
  const candidates = llmModelCache[nextProvider] || [];
  const nextModel = candidates[0]
    || (nextProvider === 'ollama' ? llmConfig.model : DEFAULT_MODELS[nextProvider]);
  applyLlmConfig(nextProvider, nextModel);
}

function handleLlmModelChange() {
  const selectedProvider = document.getElementById('llm-provider')?.value;
  const provider = resolveProvider(selectedProvider);
  const model = document.getElementById('llm-model')?.value;
  applyLlmConfig(provider, model);
}

async function initializeLlmConfig() {
  const savedProvider = localStorage.getItem(STORAGE_KEYS.provider);
  const savedModel = localStorage.getItem(STORAGE_KEYS.model);

  if (savedProvider || savedModel) {
    const provider = resolveProvider(savedProvider);
    await refreshModelsForProvider(provider);
    applyLlmConfig(provider, savedModel);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    if (data?.auth && typeof window.setAuthState === 'function') {
      window.setAuthState(data.auth);
    }

    const provider = resolveProvider(data.llm?.provider);
    await refreshModelsForProvider(provider);
    applyLlmConfig(provider, data.llm?.model);
  } catch {
    const provider = resolveProvider('gemini');
    await refreshModelsForProvider(provider);
    applyLlmConfig(provider, DEFAULT_MODELS[provider]);
  }
}

window.handleLlmProviderChange = handleLlmProviderChange;
window.handleLlmModelChange = handleLlmModelChange;
window.getLlmHeaders = getLlmHeaders;
window.initializeLlmConfig = initializeLlmConfig;
window.refreshLlmAvailability = refreshLlmAvailability;
