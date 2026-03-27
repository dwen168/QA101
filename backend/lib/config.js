const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const llmProvider = String(
  process.env.LLM_PROVIDER
    || (process.env.GEMINI_API_KEY ? 'gemini' : (process.env.OLLAMA_MODEL ? 'ollama' : 'deepseek'))
).toLowerCase();
const normalizeBaseUrl = (value, fallback) => String(value || fallback).replace(/\/+$/, '');
const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

module.exports = {
  port: Number(process.env.PORT || 3001),
  realDataTimeoutMs: parsePositiveInt(process.env.REAL_DATA_TIMEOUT_MS, 10000),
  llmTimeoutMs: parsePositiveInt(process.env.LLM_TIMEOUT_MS, 60000),
  llmProvider,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekBaseUrl: normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com/v1'),
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiBaseUrl: normalizeBaseUrl(process.env.GEMINI_BASE_URL, 'https://generativelanguage.googleapis.com/v1beta'),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
  ollamaBaseUrl: normalizeBaseUrl(process.env.OLLAMA_BASE_URL, 'http://127.0.0.1:11434'),
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3.5:9b',
  alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || 'demo',
  finnhubApiKey: process.env.FINNHUB_API_KEY || null,
  newsApiKey: process.env.NEWS_API_KEY || null,
};
