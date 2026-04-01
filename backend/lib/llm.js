const axios = require('axios');
const { AsyncLocalStorage } = require('async_hooks');
const config = require('./config');

const llmRequestContext = new AsyncLocalStorage();

function normalizeProvider(provider) {
  if (provider === 'ollama' || provider === 'gemini' || provider === 'deepseek') {
    return provider;
  }
  return 'deepseek';
}

function normalizeModel(model) {
  const trimmed = String(model || '').trim();
  return trimmed || null;
}

function runWithLlmContext(overrides, callback) {
  const provider = overrides?.provider ? normalizeProvider(String(overrides.provider).toLowerCase()) : null;
  const model = normalizeModel(overrides?.model);
  return llmRequestContext.run({ provider, model }, callback);
}

function getResolvedLlmConfig() {
  const context = llmRequestContext.getStore();
  const requestedProvider = context?.provider || normalizeProvider(config.llmProvider);
  const provider = (config.isVercel && requestedProvider === 'ollama')
    ? (config.geminiApiKey ? 'gemini' : 'deepseek')
    : requestedProvider;
  const model = context?.model
    || (provider === 'ollama'
      ? config.ollamaModel
      : (provider === 'gemini' ? config.geminiModel : config.deepseekModel));
  return { provider, model };
}

function getActiveProvider() {
  return getResolvedLlmConfig().provider;
}

function getActiveModel(provider = getActiveProvider()) {
  const resolved = getResolvedLlmConfig();
  if (provider === resolved.provider) {
    return resolved.model;
  }
  if (provider === 'ollama') return config.ollamaModel;
  if (provider === 'gemini') return config.geminiModel;
  return config.deepseekModel;
}

function getMessages(systemPrompt, userMessage, messages) {
  const systemMessage = { role: 'system', content: systemPrompt };

  if (Array.isArray(messages)) {
    return [systemMessage, ...messages.map((entry) => ({ role: entry.role, content: entry.content }))];
  }

  return [systemMessage, { role: 'user', content: userMessage }];
}

function formatProviderError(provider, error) {
  return 'This LLM is temporarily unavailable. Please try another LLM.';
}

async function callDeepSeekApi(messages, temperature, maxTokens, model) {
  if (!config.deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const response = await axios.post(
    `${config.deepseekBaseUrl}/chat/completions`,
    {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${config.deepseekApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: config.llmTimeoutMs,
    }
  );

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek response did not include message content');
  }

  return content;
}

async function callOllamaApi(messages, temperature, maxTokens, model) {
  const response = await axios.post(
    `${config.ollamaBaseUrl}/api/chat`,
    {
      model,
      messages,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: config.llmTimeoutMs,
    }
  );

  const content = response.data?.message?.content;
  if (!content) {
    throw new Error('Ollama response did not include message content');
  }

  return content;
}

function toGeminiContents(messages) {
  const conversation = [];

  for (const message of messages) {
    if (message.role === 'system') continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    conversation.push({
      role,
      parts: [{ text: String(message.content || '') }],
    });
  }

  return conversation.length ? conversation : [{ role: 'user', parts: [{ text: '' }] }];
}

function isGemmaModel(model) {
  return /^gemma-/i.test(String(model || '').trim());
}

async function callGeminiApi(messages, temperature, maxTokens, model) {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const systemText = messages.find((entry) => entry.role === 'system')?.content;
  const gemmaModel = isGemmaModel(model);
  const contents = toGeminiContents(messages);

  if (gemmaModel && systemText) {
    contents.unshift({
      role: 'user',
      parts: [{ text: `System instruction:\n${String(systemText)}` }],
    });
  }

  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };

  if (systemText && !gemmaModel) {
    body.systemInstruction = {
      parts: [{ text: String(systemText) }],
    };
  }

  const response = await axios.post(
    `${config.geminiBaseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`,
    body,
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: config.llmTimeoutMs,
    }
  );

  const parts = response.data?.candidates?.[0]?.content?.parts;
  const content = Array.isArray(parts)
    ? parts.map((part) => String(part?.text || '')).join('').trim()
    : '';

  if (!content) {
    throw new Error('Gemini response did not include message content');
  }

  return content;
}

async function callLlm({ systemPrompt, userMessage, messages, temperature = 0.3, maxTokens = 2000 }) {
  const { provider, model } = getResolvedLlmConfig();
  const resolvedMessages = getMessages(systemPrompt, userMessage, messages);

  if (config.isVercel && provider === 'ollama') {
    throw new Error('This LLM is temporarily unavailable. Please try another LLM.');
  }

  try {
    if (provider === 'ollama') {
      return await callOllamaApi(resolvedMessages, temperature, maxTokens, model);
    }

    if (provider === 'gemini') {
      return await callGeminiApi(resolvedMessages, temperature, maxTokens, model);
    }

    return await callDeepSeekApi(resolvedMessages, temperature, maxTokens, model);
  } catch (error) {
    throw new Error(formatProviderError(provider, error));
  }
}

async function callDeepSeek(systemPrompt, userMessage, temperature = 0.3, maxTokens = 2000) {
  return callLlm({ systemPrompt, userMessage, temperature, maxTokens });
}

module.exports = {
  callLlm,
  callDeepSeek,
  getActiveProvider,
  getActiveModel,
  normalizeProvider,
  runWithLlmContext,
};
