// Frontend UI LLM provider/model controls and API base config.

const API_BASE = '/api';
const DEFAULT_MODELS = {
  deepseek: 'deepseek-chat',
  gemini: 'gemma-3-27b-it',
  ollama: 'qwen3.5:9b',
};
const MODEL_PRESETS = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  gemini: ['gemma-3-27b-it'],
  ollama: [],
};
const STORAGE_KEYS = {
  provider: 'quantbot.llm.provider',
  model: 'quantbot.llm.model',
};

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

window.handleLlmProviderChange = handleLlmProviderChange;
window.handleLlmModelChange = handleLlmModelChange;
window.getLlmHeaders = getLlmHeaders;
window.initializeLlmConfig = initializeLlmConfig;
