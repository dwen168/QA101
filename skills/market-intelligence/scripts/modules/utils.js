const config = require('../../../../backend/lib/config');

const REAL_DATA_TIMEOUT_MS = config.realDataTimeoutMs;
const ENRICHMENT_TIMEOUT_MS = Math.min(5000, REAL_DATA_TIMEOUT_MS);

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dedupeArticlesByTitle(articles) {
  const seen = new Set();
  return (articles || []).filter((article) => {
    const key = String(article?.title || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hoursAgoFromDate(value) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.round((Date.now() - timestamp) / 3600000));
}

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '').trim();
}

function hostnameToSourceLabel(hostname, fallbackSource = 'Unknown') {
  const host = normalizeHostname(hostname);
  if (!host) return fallbackSource;
  if (host.includes('fool.com')) return 'The Motley Fool';
  if (host.includes('reuters.com')) return 'Reuters';
  if (host.includes('bloomberg.com')) return 'Bloomberg';
  if (host.includes('wsj.com')) return 'WSJ';
  if (host.includes('cnbc.com')) return 'CNBC';
  if (host.includes('finance.yahoo.com') || host === 'yahoo.com' || host.endsWith('.yahoo.com')) return 'Yahoo Finance';
  if (host.includes('marketwatch.com')) return 'MarketWatch';
  return host;
}

async function resolveArticleSourceLabel(articleUrl, fallbackSource = 'Unknown') {
  const rawUrl = String(articleUrl || '').trim();
  if (!rawUrl) return fallbackSource;

  try {
    const initial = new URL(rawUrl);
    const initialHost = normalizeHostname(initial.hostname);
    if (initialHost && initialHost !== 'finnhub.io') {
      return hostnameToSourceLabel(initialHost, fallbackSource);
    }
  } catch {
    return fallbackSource;
  }

  try {
    const response = await withTimeout(
      fetch(rawUrl, { method: 'HEAD', redirect: 'follow' }),
      ENRICHMENT_TIMEOUT_MS,
      `Resolve article source for ${rawUrl}`
    );
    const finalHost = normalizeHostname(new URL(response.url).hostname);
    return hostnameToSourceLabel(finalHost, fallbackSource);
  } catch {
    try {
      const response = await withTimeout(
        fetch(rawUrl, { method: 'GET', redirect: 'follow' }),
        ENRICHMENT_TIMEOUT_MS,
        `Resolve article source (GET fallback) for ${rawUrl}`
      );
      const finalHost = normalizeHostname(new URL(response.url).hostname);
      return hostnameToSourceLabel(finalHost, fallbackSource);
    } catch {
      return fallbackSource;
    }
  }
}

function normalizeArticleKey(title) {
  return String(title || '').trim().toLowerCase();
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parseFloat(clamp(parsed, 0, 1).toFixed(2)) : null;
}

function sanitizeShortText(value, maxLength = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

async function withTimeout(promise, timeoutMs, label = 'operation') {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  REAL_DATA_TIMEOUT_MS,
  ENRICHMENT_TIMEOUT_MS,
  safeNumber,
  clamp,
  average,
  dedupeArticlesByTitle,
  hoursAgoFromDate,
  normalizeHostname,
  hostnameToSourceLabel,
  resolveArticleSourceLabel,
  normalizeArticleKey,
  normalizeConfidence,
  sanitizeShortText,
  withTimeout,
};
