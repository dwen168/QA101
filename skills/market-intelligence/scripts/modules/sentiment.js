const { callDeepSeek } = require('../../../../backend/lib/llm');
const { parseJsonResponse } = require('../../../../backend/lib/utils');
const { 
  safeNumber, 
  dedupeArticlesByTitle, 
  normalizeArticleKey, 
  normalizeConfidence, 
  sanitizeShortText 
} = require('./utils');
const { 
  normalizeMacroScore, 
  normalizeMacroTone, 
  normalizeMacroTheme 
} = require('./macro');

const POSITIVE_NEWS_KEYWORDS = [
  'beats', 'beat', 'surge', 'rally', 'gain', 'gains', 'upgrade', 'upgraded', 'strong', 'record', 'growth',
  'breakthrough', 'profit', 'profits', 'bullish', 'optimistic', 'recover', 'recovery', 'rebound', 'outperform',
  'approval', 'expansion', 'tailwind', 'improves', 'improvement', 'cut rates', 'rate cut', 'easing',
  // ASX / biotech / resources
  'phase 3', 'phase iii', 'fda approval', 'tga approval', 'positive data', 'positive results', 'efficacy',
  'clinical success', 'milestone', 'contract win', 'offtake', 'maiden', 'resource upgrade', 'reserve upgrade',
  'high grade', 'significant intercept', 'production beat', 'dividend', 'buyback', 'capital return',
  'merger', 'acquisition', 'takeover bid', 'strategic review', 'placement completed', 'oversubscribed',
];

const NEGATIVE_NEWS_KEYWORDS = [
  'miss', 'misses', 'plunge', 'drop', 'falls', 'fall', 'downgrade', 'downgraded', 'weak', 'loss', 'losses',
  'bearish', 'risk-off', 'selloff', 'recession', 'inflation', 'war', 'conflict', 'sanction', 'tariff',
  'lawsuit', 'probe', 'investigation', 'default', 'stress', 'volatility', 'headwind', 'cuts outlook',
  'delay', 'delays', 'layoff', 'layoffs', 'hawkish', 'rate hike', 'higher for longer',
  // ASX / biotech / resources
  'trial failure', 'failed trial', 'rejected', 'clinical hold', 'safety concern', 'adverse event',
  'production miss', 'grade decline', 'impairment', 'write-down', 'write-off', 'capital raise', 'dilution',
  'trading halt', 'suspension', 'winding up', 'administration', 'receivership', 'shortfall',
];

function scoreHeadlineSentimentFallback(headline) {
  const text = String(headline || '').toLowerCase();
  if (!text) return 0;

  let score = 0;
  for (const keyword of POSITIVE_NEWS_KEYWORDS) {
    if (text.includes(keyword)) score += 0.18;
  }
  for (const keyword of NEGATIVE_NEWS_KEYWORDS) {
    if (text.includes(keyword)) score -= 0.18;
  }

  return Math.max(-1, Math.min(1, parseFloat(score.toFixed(2))));
}

// Rule-based headline sentiment scorer (no LLM dependency)
function scoreSentimentsWithRules(headlines) {
  if (!headlines || headlines.length === 0) return [];
  return headlines.map((headline) => scoreHeadlineSentimentFallback(headline));
}

async function scoreMacroNewsWithLlm(articles, { ticker, sector } = {}, dependencies = {}) {
  const llm = dependencies.callDeepSeek || callDeepSeek;
  if (!Array.isArray(articles) || articles.length === 0 || typeof llm !== 'function') {
    return articles;
  }

  const scopedArticles = dedupeArticlesByTitle(articles)
    .sort((left, right) => (left.hoursAgo ?? 0) - (right.hoursAgo ?? 0))
    .slice(0, 8)
    .filter((article) => normalizeArticleKey(article.title));

  if (scopedArticles.length === 0) {
    return articles;
  }

  const systemPrompt = [
    'You are a macro market headline classifier.',
    'Classify each headline using headline text only.',
    'Return JSON only in the format {"items":[{"id":number,"score":number,"theme":string,"marketTone":string,"confidence":number,"reason":string}]}',
    'score must be between -1 and 1 and represent first-order broad market impact.',
    'theme must be one of: GEOPOLITICS, MONETARY_POLICY, POLITICS_POLICY, ENERGY_COMMODITIES, MARKET_STRESS, SUPPLY_CHAIN, GENERAL_MACRO.',
    'marketTone must be RISK_ON, RISK_OFF, or BALANCED.',
    'Treat war escalation, sanctions, tariffs, persistent inflation, higher-for-longer rates, and oil supply disruptions as risk-off for broad equities unless the headline clearly indicates relief.',
    'Keep reason under 14 words.',
  ].join(' ');

  const userMessage = [
    `Ticker: ${ticker || 'UNKNOWN'}`,
    `Sector: ${sector || 'Unknown'}`,
    'Headlines:',
    ...scopedArticles.map((article, index) => `${index + 1}. ${article.title}`),
  ].join('\n');

  try {
    const response = await llm(systemPrompt, userMessage, 0.1, 800);
    const parsed = parseJsonResponse(response, { items: [] });
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : [];

    const byKey = new Map();
    for (let index = 0; index < scopedArticles.length; index += 1) {
      const article = scopedArticles[index];
      const item = items.find((candidate) => Number(candidate?.id) === index + 1) || items[index];
      if (!item) continue;

      const fallbackScore = safeNumber(article.sentiment);
      const score = normalizeMacroScore(
        item.score,
        item.marketTone === 'RISK_ON' ? 0.45 : item.marketTone === 'RISK_OFF' ? -0.45 : fallbackScore
      );

      byKey.set(normalizeArticleKey(article.title), {
        sentiment: score,
        theme: normalizeMacroTheme(item.theme, `${article.title || ''} ${article.summary || ''}`),
        marketTone: normalizeMacroTone(item.marketTone, score),
        llmConfidence: normalizeConfidence(item.confidence),
        llmReason: sanitizeShortText(item.reason),
      });
    }

    if (byKey.size === 0) {
      return articles;
    }

    return articles.map((article) => {
      const classified = byKey.get(normalizeArticleKey(article.title));
      if (!classified) {
        return article;
      }

      return {
        ...article,
        sentiment: classified.sentiment,
        theme: classified.theme,
        marketTone: classified.marketTone,
        llmConfidence: classified.llmConfidence,
        llmReason: classified.llmReason,
        sentimentMethod: 'llm',
      };
    });
  } catch {
    return articles;
  }
}

async function scoreCompanyNewsWithLlm(articles, { ticker, sector, companyName } = {}, dependencies = {}) {
  const llm = dependencies.callDeepSeek || callDeepSeek;
  if (!Array.isArray(articles) || articles.length === 0 || typeof llm !== 'function') {
    return articles;
  }

  const scopedArticles = dedupeArticlesByTitle(articles)
    .sort((left, right) => (left.hoursAgo ?? 0) - (right.hoursAgo ?? 0))
    .slice(0, 6)
    .filter((article) => normalizeArticleKey(article.title));

  if (scopedArticles.length === 0) {
    return articles;
  }

  const systemPrompt = [
    'You are an equity headline sentiment classifier.',
    'Judge each headline by its likely directional impact on the named stock, not the overall market.',
    'Use headline text only.',
    'Return JSON only in the format {"items":[{"id":number,"score":number,"confidence":number,"reason":string}]}',
    'score must be between -1 and 1 where positive is bullish for the stock and negative is bearish for the stock.',
    'Penalize misses, downgrades, legal risk, margin pressure, layoffs, demand weakness, and regulatory pressure.',
    'Reward beats, upgrades, new product wins, approvals, demand strength, expansion, and margin improvement.',
    'Keep reason under 12 words.',
  ].join(' ');

  const userMessage = [
    `Ticker: ${ticker || 'UNKNOWN'}`,
    `Company: ${companyName || ticker || 'Unknown company'}`,
    `Sector: ${sector || 'Unknown'}`,
    'Headlines:',
    ...scopedArticles.map((article, index) => `${index + 1}. ${article.title}`),
  ].join('\n');

  try {
    const response = await llm(systemPrompt, userMessage, 0.1, 700);
    const parsed = parseJsonResponse(response, { items: [] });
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : [];

    const byKey = new Map();
    for (let index = 0; index < scopedArticles.length; index += 1) {
      const article = scopedArticles[index];
      const item = items.find((candidate) => Number(candidate?.id) === index + 1) || items[index];
      if (!item) continue;

      byKey.set(normalizeArticleKey(article.title), {
        sentiment: normalizeMacroScore(item.score, safeNumber(article.sentiment)),
        llmConfidence: normalizeConfidence(item.confidence),
        llmReason: sanitizeShortText(item.reason),
      });
    }

    if (byKey.size === 0) {
      return articles;
    }

    return articles.map((article) => {
      const classified = byKey.get(normalizeArticleKey(article.title));
      if (!classified) {
        return article;
      }

      return {
        ...article,
        sentiment: classified.sentiment,
        llmConfidence: classified.llmConfidence,
        llmReason: classified.llmReason,
        sentimentMethod: 'llm',
      };
    });
  } catch {
    return articles;
  }
}

module.exports = {
  POSITIVE_NEWS_KEYWORDS,
  NEGATIVE_NEWS_KEYWORDS,
  scoreHeadlineSentimentFallback,
  scoreSentimentsWithRules,
  scoreMacroNewsWithLlm,
  scoreCompanyNewsWithLlm,
};
