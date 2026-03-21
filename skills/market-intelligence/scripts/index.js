const { callDeepSeek } = require('../../../backend/lib/llm');
const { normalizeTicker, parseJsonResponse } = require('../../../backend/lib/utils');
const config = require('../../../backend/lib/config');
const { calculateAllIndicators } = require('../../../backend/lib/technical-indicators');

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

const MACRO_THEME_RULES = [
  {
    theme: 'GEOPOLITICS',
    keywords: ['war', 'conflict', 'missile', 'iran', 'israel', 'ukraine', 'russia', 'china', 'taiwan', 'sanction', 'ceasefire', 'military'],
  },
  {
    theme: 'MONETARY_POLICY',
    keywords: ['fed', 'federal reserve', 'interest rate', 'rate cut', 'rate hike', 'powell', 'ecb', 'boj', 'inflation', 'cpi', 'pce', 'yield'],
  },
  {
    theme: 'POLITICS_POLICY',
    keywords: ['white house', 'president', 'trump', 'biden', 'election', 'tariff', 'trade policy', 'congress', 'tax', 'regulation'],
  },
  {
    theme: 'ENERGY_COMMODITIES',
    keywords: ['oil', 'crude', 'gas', 'opec', 'commodity', 'gold', 'copper', 'shipping', 'strait of hormuz'],
  },
  {
    theme: 'MARKET_STRESS',
    keywords: ['selloff', 'risk-off', 'recession', 'volatility', 'vix', 'downgrade', 'credit spread', 'default', 'banking stress'],
  },
  {
    theme: 'SUPPLY_CHAIN',
    keywords: ['supply chain', 'factory', 'chip', 'semiconductor', 'shipping lane', 'port', 'export control'],
  },
];

const MACRO_THEME_VALUES = new Set([
  ...MACRO_THEME_RULES.map((rule) => rule.theme),
  'GENERAL_MACRO',
]);

const SECTOR_THEME_HINTS = {
  Technology: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'MONETARY_POLICY'],
  Semiconductors: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'GEOPOLITICS'],
  Financials: ['MONETARY_POLICY', 'MARKET_STRESS', 'POLITICS_POLICY'],
  Energy: ['ENERGY_COMMODITIES', 'GEOPOLITICS', 'POLITICS_POLICY'],
  'Automotive/EV': ['SUPPLY_CHAIN', 'ENERGY_COMMODITIES', 'POLITICS_POLICY'],
  Industrials: ['SUPPLY_CHAIN', 'GEOPOLITICS', 'ENERGY_COMMODITIES'],
  Healthcare: ['POLITICS_POLICY', 'MARKET_STRESS'],
};

function detectMacroTheme(text) {
  const lower = String(text || '').toLowerCase();
  for (const rule of MACRO_THEME_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      return rule.theme;
    }
  }
  return 'GENERAL_MACRO';
}

function normalizeArticleKey(title) {
  return String(title || '').trim().toLowerCase();
}

function normalizeMacroTheme(theme, fallbackText) {
  const raw = String(theme || '').trim().toUpperCase();
  if (MACRO_THEME_VALUES.has(raw)) {
    return raw;
  }
  return detectMacroTheme(fallbackText);
}

function normalizeMacroTone(value, fallbackScore = 0) {
  const raw = String(value || '').trim().toUpperCase();
  if (['RISK_ON', 'RISK_OFF', 'BALANCED'].includes(raw)) {
    return raw;
  }
  return fallbackScore >= 0.25 ? 'RISK_ON' : fallbackScore <= -0.25 ? 'RISK_OFF' : 'BALANCED';
}

function normalizeMacroScore(value, fallbackValue = 0) {
  const parsed = Number(value);
  const score = Number.isFinite(parsed) ? parsed : fallbackValue;
  return parseFloat(clamp(score, -1, 1).toFixed(2));
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parseFloat(clamp(parsed, 0, 1).toFixed(2)) : null;
}

function sanitizeShortText(value, maxLength = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function summarizeThemeImpact(theme, sector, ticker) {
  const sectorHints = SECTOR_THEME_HINTS[sector] || [];
  const tickerLabel = ticker || 'this stock';
  if (sectorHints.includes(theme)) {
    switch (theme) {
      case 'GEOPOLITICS':
        return `${tickerLabel} may be sensitive to cross-border risk, sanctions, or defense-driven market repricing.`;
      case 'MONETARY_POLICY':
        return `${tickerLabel} may react to rate expectations, discount-rate changes, and liquidity conditions.`;
      case 'POLITICS_POLICY':
        return `${tickerLabel} may be exposed to regulatory, tariff, or election-policy shifts.`;
      case 'ENERGY_COMMODITIES':
        return `${tickerLabel} may feel margin pressure or support from commodity and energy moves.`;
      case 'MARKET_STRESS':
        return `${tickerLabel} may trade with broader risk appetite as volatility and drawdown pressure rise.`;
      case 'SUPPLY_CHAIN':
        return `${tickerLabel} may face delivery, sourcing, or export-control pressure through supply chains.`;
      default:
        return `${tickerLabel} may be influenced by the broader macro narrative.`;
    }
  }
  return `${tickerLabel} has secondary exposure to the current ${theme.toLowerCase().replace(/_/g, ' ')} narrative.`;
}

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

// Fetch news from Finnhub
async function fetchFinnhubNews(ticker, context = {}, dependencies = {}) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return null;

  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data)) return null;

    const articles = data.slice(0, 5);
    const headlines = articles.map(a => a.headline || '');
    const scores = scoreSentimentsWithRules(headlines);
    const resolvedSources = await Promise.all(
      articles.map((article) => resolveArticleSourceLabel(article.url || '', article.source || 'Finnhub'))
    );

    const ruleScoredNews = articles.map((article, i) => ({
      title: article.headline || '',
      summary: (article.summary || article.description || article.lead_image || article.text || '').substring(0, 200), // Try multiple fields, cap at 200 chars
      url: article.url || '',
      source: resolvedSources[i] || article.source || 'Finnhub',
      sentiment: scores[i] ?? 0,
      hoursAgo: Math.round((Date.now() - (article.datetime * 1000)) / 3600000),
    }));

    // Filter to only send relevant company news to LLM
    const companyName = context.companyName || `${ticker} Corp.`;
    const searchTerms = [
      ticker.toUpperCase(),
      ticker.split('.')[0].toUpperCase(), // Base ticker without exchange code
      ...(companyName.split(' ').slice(0, 3)), // First 3 words of company name
    ];
    const relevantNews = ruleScoredNews.filter((news) => {
      const headline = (news.title || '').toUpperCase();
      return searchTerms.some((term) => headline.includes(term.toUpperCase()));
    });

    // Only score relevant company news with LLM
    if (relevantNews.length > 0) {
      const llmScored = await scoreCompanyNewsWithLlm(relevantNews, {
        ticker,
        sector: context.sector,
        companyName: context.companyName,
      }, dependencies);
      // Merge LLM-scored news back into full list
      return ruleScoredNews.map((news) => {
        const llmVersion = llmScored.find((n) => n.title === news.title);
        return llmVersion || news;
      });
    }

    return ruleScoredNews;
  } catch (error) {
    console.error('Finnhub news fetch failed:', error.message);
    return null;
  }
}

async function fetchFinnhubMacroNews() {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return [];

  try {
    const url = `https://finnhub.io/api/v1/news?category=general&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const filtered = data
      .filter((article) => {
        const text = `${article.headline || ''} ${article.summary || ''}`.toLowerCase();
        return MACRO_THEME_RULES.some((rule) => rule.keywords.some((keyword) => text.includes(keyword)));
      })
      .slice(0, 8);

    const scores = scoreSentimentsWithRules(filtered.map((article) => article.headline || ''));
    return filtered.map((article, index) => ({
      title: article.headline || '',
      summary: article.summary || '',
      url: article.url || '',
      source: article.source || 'Finnhub General',
      sentiment: scores[index] ?? 0,
      hoursAgo: Math.round((Date.now() - (safeNumber(article.datetime) * 1000)) / 3600000),
      theme: detectMacroTheme(`${article.headline || ''} ${article.summary || ''}`),
      scope: 'macro',
    }));
  } catch (error) {
    console.error('Finnhub macro news fetch failed:', error.message);
    return [];
  }
}

// Fetch ASX company announcements (price-sensitive and general) from the ASX public API
async function fetchAsxAnnouncements(ticker) {
  try {
    const code = ticker.split('.')[0].toUpperCase();
    const url = `https://www.asx.com.au/asx/1/company/${encodeURIComponent(code)}/announcements?count=10&market_sensitive=false`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return [];

    const data = await response.json();
    const items = Array.isArray(data?.data) ? data.data : [];
    if (items.length === 0) return [];

    const headlines = items.slice(0, 8).map((item) => item.header || '');
    const scores = scoreSentimentsWithRules(headlines);

    return items.slice(0, 8).map((item, i) => {
      const releasedAt = item.document_release_date ? Date.parse(item.document_release_date) : 0;
      const hoursAgo = releasedAt > 0 ? Math.max(0, Math.round((Date.now() - releasedAt) / 3600000)) : 0;
      const isSensitive = item.price_sensitive === true || String(item.market_sensitive || '').toLowerCase() === 'true';
      return {
        title: item.header || '(ASX Announcement)',
        summary: isSensitive ? '[Price-sensitive announcement]' : '',
        url: item.url ? `https://www.asx.com.au${item.url}` : '',
        source: 'ASX Announcements',
        sentiment: scores[i] ?? 0,
        hoursAgo,
      };
    });
  } catch (error) {
    console.error('ASX announcements fetch failed:', error.message);
    return [];
  }
}

// Fetch news from Google News RSS — covers AU media (AFR, SMH, The Australian) for ASX stocks
async function fetchGoogleNewsRss(ticker, companyName) {
  try {
    const code = ticker.split('.')[0].toUpperCase();
    const queryStr = companyName && companyName !== ticker
      ? `${code} OR "${companyName.split(' ').slice(0, 3).join(' ')}" ASX`
      : `${code} ASX`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(queryStr)}&hl=en-AU&gl=AU&ceid=AU:en`;
    const response = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;
    const linkRegex = /<link[^>]*>(.*?)<\/link>/;

    const items = [];
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 6) {
      const block = match[1];
      const title = (titleRegex.exec(block)?.[1] || '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
      const pubDate = pubDateRegex.exec(block)?.[1]?.trim() || '';
      const link = linkRegex.exec(block)?.[1]?.trim() || '';
      if (!title) continue;
      const publishMs = pubDate ? Date.parse(pubDate) : 0;
      const hoursAgo = publishMs > 0 ? Math.max(0, Math.round((Date.now() - publishMs) / 3600000)) : 0;
      items.push({ title, link, hoursAgo });
    }

    if (items.length === 0) return [];

    const scores = scoreSentimentsWithRules(items.map((item) => item.title));
    return items.map((item, i) => ({
      title: item.title,
      summary: '',
      url: item.link,
      source: 'Google News',
      sentiment: scores[i] ?? 0,
      hoursAgo: item.hoursAgo,
    }));
  } catch (error) {
    console.error('Google News RSS fetch failed:', error.message);
    return [];
  }
}

// Generate mock ASIC short data for resilience when real data is unavailable
function generateMockShortData(ticker) {
  const code = ticker.split('.')[0].toUpperCase();
  // Simulate realistic short interest distribution: most stocks 0-3%, small percentage >5%
  const rand = Math.random();
  const shortPercent = rand < 0.75
    ? parseFloat((Math.random() * 3).toFixed(1)) // 75% chance: 0-3%
    : parseFloat((3 + Math.random() * 7).toFixed(1)); // 25% chance: 3-10%
  
  return {
    shortPercent,
    shortTurnover: Math.floor(Math.random() * 5000000 + 100000),
    dataSource: 'Mock (ASIC unavailable)',
    available: true,
    isMock: true,
  };
}

// Fetch ASIC short selling data — weekly ASX report
// Data from https://asic.gov.au/regulatory-resources/markets/short-selling-ban-data
async function fetchAsicShortSellingData(ticker) {
  try {
    const code = ticker.split('.')[0].toUpperCase();

    const parseShortmanCurrentPosition = (html) => {
      const tableMatch = String(html || '').match(/<table[^>]*id=["']positionInfo["'][^>]*>[\s\S]*?<\/table>/i);
      const tableHtml = tableMatch ? tableMatch[0] : String(html || '');
      const compact = tableHtml.replace(/\s+/g, ' ');

      // Preferred: find "Current position" row then read the following value cell.
      const contextualMatch = compact.match(
        /Current\s*position[\s\S]*?<\/tr>\s*<tr[^>]*>[\s\S]*?<td[^>]*class=["'][^"']*\bca\b[^"']*["'][^>]*>\s*([0-9]+(?:\.[0-9]+)?)%/i
      );
      if (contextualMatch && contextualMatch[1]) {
        return safeNumber(contextualMatch[1], NaN);
      }

      // Fallback: first percentage in position table value cell.
      const genericMatch = compact.match(/<td[^>]*class=["'][^"']*\bca\b[^"']*["'][^>]*>\s*([0-9]+(?:\.[0-9]+)?)%/i);
      if (genericMatch && genericMatch[1]) {
        return safeNumber(genericMatch[1], NaN);
      }
      return NaN;
    };
    
    // Primary source: shortman.com.au (aggregates ASIC data with better UX)
    try {
      const shortmanUrl = `https://www.shortman.com.au/stock?q=${code.toLowerCase()}`;
      const shortmanResponse = await fetch(shortmanUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: ENRICHMENT_TIMEOUT_MS 
      });
      
      if (shortmanResponse.ok) {
        const html = await shortmanResponse.text();
        const shortPercent = parseShortmanCurrentPosition(html);
        if (Number.isFinite(shortPercent) && shortPercent >= 0) {
          return {
            shortPercent: parseFloat(shortPercent.toFixed(2)),
            shortTurnover: 0,
            dataSource: 'ShortMan (ASIC aggregated)',
            available: true,
          };
        }
      }
    } catch (shortmanError) {
      console.warn(`ShortMan fetch failed for ${code}, using mock short data:`, shortmanError.message);
    }

    // Fallback: return mock short data (2%)
    return {
      shortPercent: 2.0,
      shortTurnover: 0,
      dataSource: 'Mock (ShortMan unavailable)',
      isMock: true,
    };
  } catch (error) {
    console.error('Short data fetch failed:', error.message);
    // Final fallback in case of unexpected error
    return {
      shortPercent: 2.0,
      shortTurnover: 0,
      dataSource: 'Mock (Error)',
      isMock: true,
    };
  }
}

async function fetchNewsApiMacroNews() {
  const apiKey = config.newsApiKey;
  if (!apiKey) return [];

  try {
    const from = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const query = encodeURIComponent('((stock market OR equities OR s&p 500 OR nasdaq) AND (war OR fed OR inflation OR president OR tariff OR oil OR sanctions OR geopolitics))');
    const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=8&from=${encodeURIComponent(from)}&apiKey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const payload = await response.json();
    if (!Array.isArray(payload.articles)) return [];

    const articles = payload.articles.slice(0, 8);
    const scores = scoreSentimentsWithRules(articles.map((article) => article.title || ''));
    return articles.map((article, index) => ({
      title: article.title || '',
      summary: article.description || article.content || '',
      url: article.url || '',
      source: article.source?.name || 'NewsAPI',
      sentiment: scores[index] ?? 0,
      hoursAgo: hoursAgoFromDate(article.publishedAt),
      theme: detectMacroTheme(`${article.title || ''} ${article.description || ''}`),
      scope: 'macro',
    }));
  } catch (error) {
    console.error('NewsAPI macro news fetch failed:', error.message);
    return [];
  }
}

function buildMacroContext({ ticker, sector, macroNews = [] }) {
  const articles = dedupeArticlesByTitle(macroNews)
    .sort((left, right) => (left.hoursAgo ?? 0) - (right.hoursAgo ?? 0))
    .slice(0, 6);
  const score = parseFloat(average(articles.map((article) => safeNumber(article.sentiment))).toFixed(2));
  const sentimentLabel = score > 0.25 ? 'RISK_ON' : score < -0.25 ? 'RISK_OFF' : 'BALANCED';

  const themeCounts = articles.reduce((accumulator, article) => {
    const theme = article.theme || 'GENERAL_MACRO';
    accumulator[theme] = (accumulator[theme] || 0) + 1;
    return accumulator;
  }, {});

  const dominantThemes = Object.entries(themeCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([theme, count]) => ({ theme, count }));

  const primaryTheme = dominantThemes[0]?.theme || 'GENERAL_MACRO';
  const riskLevel = sentimentLabel === 'RISK_OFF' || ['GEOPOLITICS', 'MARKET_STRESS'].includes(primaryTheme)
    ? 'HIGH'
    : sentimentLabel === 'BALANCED'
      ? 'MEDIUM'
      : 'LOW';

  const headline = articles[0]?.title || 'No major macro headlines captured.';
  const marketContext = articles.length
    ? `Macro tone is ${sentimentLabel.toLowerCase().replace('_', '-')}, led by ${dominantThemes.map((item) => item.theme.toLowerCase().replace(/_/g, ' ')).join(', ')} headlines. Latest focus: ${headline}`
    : 'Macro feed unavailable; current view relies on ticker-specific news only.';

  const impactNotes = dominantThemes.map((item) => summarizeThemeImpact(item.theme, sector, ticker));

  return {
    available: articles.length > 0,
    sentimentScore: score,
    sentimentLabel,
    riskLevel,
    dominantThemes,
    marketContext,
    impactNotes,
    news: articles,
    sourceBreakdown: {
      articleCount: articles.length,
      hasFinnhubMacro: articles.some((article) => String(article.source || '').toLowerCase().includes('finnhub')),
      hasNewsApiMacro: articles.some((article) => String(article.source || '').toLowerCase().includes('newsapi')),
    },
  };
}

// Fetch analyst recommendation from Finnhub
async function fetchFinnhubRecommendations(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return null;

  try {
    const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    // Latest recommendation data
    const latest = data[0];
    return {
      strongBuy: safeNumber(latest.strongBuy),
      buy: safeNumber(latest.buy),
      hold: safeNumber(latest.hold),
      sell: safeNumber(latest.sell),
      strongSell: safeNumber(latest.strongSell),
    };
  } catch (error) {
    console.error('Finnhub recommendations fetch failed:', error.message);
    return null;
  }
}

// Fetch company profile and fundamentals from Finnhub
async function fetchFinnhubProfile(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return null;

  try {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    return {
      name: data.name || '',
      sector: data.finnhubIndustry || data.industry || '',
      marketCap: safeNumber(data.marketCapitalization) * 1e6 || 0,
    };
  } catch (error) {
    console.error('Finnhub profile fetch failed:', error.message);
    return null;
  }
}

// Fetch quote and metrics from Finnhub (includes PE, EPS via extended data)
async function fetchFinnhubQuote(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return null;

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    // Note: Finnhub quote endpoint has limited fundamental data; will combine with metrics endpoint
    return data;
  } catch (error) {
    console.error('Finnhub quote fetch failed:', error.message);
    return null;
  }
}

async function fetchFinnhubCandles(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return null;

  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - (730 * 24 * 3600);  // 2 years of daily data
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${from}&to=${to}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (data?.s !== 'ok' || !Array.isArray(data?.c) || !Array.isArray(data?.t)) {
      return null;
    }

    const length = Math.min(
      data.c.length,
      Array.isArray(data.o) ? data.o.length : 0,
      Array.isArray(data.h) ? data.h.length : 0,
      Array.isArray(data.l) ? data.l.length : 0,
      Array.isArray(data.v) ? data.v.length : 0,
      data.t.length,
    );

    const candles = [];
    for (let index = 0; index < length; index += 1) {
      const close = safeNumber(data.c[index]);
      if (close <= 0) continue;

      candles.push({
        date: new Date(safeNumber(data.t[index]) * 1000).toISOString().split('T')[0],
        open: parseFloat(safeNumber(data.o[index]).toFixed(2)),
        high: parseFloat(safeNumber(data.h[index]).toFixed(2)),
        low: parseFloat(safeNumber(data.l[index]).toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: Math.floor(safeNumber(data.v[index])),
      });
    }

    return candles.filter((bar) => bar.close > 0);
  } catch (error) {
    console.error('Finnhub candles fetch failed:', error.message);
    return null;
  }
}

// Fetch comprehensive metrics from Finnhub (includes PE, EPS) 
async function fetchFinnhubMetrics(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return null;

  try {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const metrics = data.metric || {};
    return {
      pe: safeNumber(metrics.peNormalizedAnnual),
      eps: safeNumber(metrics.epsBasicExclExtraordinaryAnnual),
    };
  } catch (error) {
    console.error('Finnhub metrics fetch failed:', error.message);
    return null;
  }
}

// Fetch analyst price targets from Finnhub
async function fetchFinnhubPriceTarget(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return null;

  try {
    const url = `https://finnhub.io/api/v1/stock/price-target?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    return {
      targetHigh: safeNumber(data.targetHigh),
      targetLow: safeNumber(data.targetLow),
      targetMean: safeNumber(data.targetMean),
    };
  } catch (error) {
    console.error('Finnhub price target fetch failed:', error.message);
    return null;
  }
}

async function fetchFinnhubMarketData(ticker, dependencies = {}) {
  if (!config.finnhubApiKey) {
    throw new Error('FINNHUB_API_KEY is missing');
  }

  const [quoteResult, profileResult, metricsResult, candlesResult, recommendationsResult, priceTargetResult] = await Promise.allSettled([
    withTimeout(fetchFinnhubQuote(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub quote fetch for ${ticker}`),
    withTimeout(fetchFinnhubProfile(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub profile fetch for ${ticker}`),
    withTimeout(fetchFinnhubMetrics(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub metrics fetch for ${ticker}`),
    withTimeout(fetchFinnhubCandles(ticker), REAL_DATA_TIMEOUT_MS, `Finnhub candles fetch for ${ticker}`),
    withTimeout(fetchFinnhubRecommendations(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub recommendations fetch for ${ticker}`),
    withTimeout(fetchFinnhubPriceTarget(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub price target fetch for ${ticker}`),
  ]);

  const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
  const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null;
  let priceHistory = candlesResult.status === 'fulfilled' ? candlesResult.value : null;
  const recommendations = recommendationsResult.status === 'fulfilled' ? recommendationsResult.value : null;
  const priceTarget = priceTargetResult.status === 'fulfilled' ? priceTargetResult.value : null;
  let priceHistorySource = 'finnhub';

  if (!Array.isArray(priceHistory) || priceHistory.length < 252) {
    let yahooHistory = null;
    try {
      yahooHistory = await fetchYahooFinancePriceHistory(ticker, 730);
    } catch {
      yahooHistory = null;
    }

    if (Array.isArray(yahooHistory) && yahooHistory.length >= 252) {
      priceHistory = yahooHistory;
      priceHistorySource = 'yahoo-finance-history';
    } else {
      const alphaHistory = await fetchAlphaVantagePriceHistory(ticker);
      if (!Array.isArray(alphaHistory?.priceHistory) || alphaHistory.priceHistory.length < 252) {
        throw new Error('Finnhub returned insufficient price history');
      }

      priceHistory = alphaHistory.priceHistory;
      priceHistorySource = 'alpha-vantage-history';
    }
  }

  const closes = priceHistory.map((day) => day.close).filter((value) => value > 0);
  const volumes = priceHistory.map((day) => day.volume).filter((value) => value >= 0);
  const highs = priceHistory.map((day) => day.high).filter((value) => value > 0);
  const lows = priceHistory.map((day) => day.low).filter((value) => value > 0);

  const latestBar = priceHistory[priceHistory.length - 1];
  const previousBar = priceHistory[priceHistory.length - 2] || latestBar;
  const price = safeNumber(quote?.c, latestBar?.close);
  const prevClose = safeNumber(quote?.pc, previousBar?.close || price);
  const change = quote && Number.isFinite(Number(quote.d)) ? safeNumber(quote.d) : price - prevClose;
  const changePercent = quote && Number.isFinite(Number(quote.dp))
    ? safeNumber(quote.dp)
    : prevClose === 0
      ? 0
      : (change / prevClose) * 100;

  const ma20 = closes.slice(-20).reduce((sum, value) => sum + value, 0) / Math.min(20, closes.length);
  const ma50 = closes.slice(-50).reduce((sum, value) => sum + value, 0) / Math.min(50, closes.length);
  const ma200 = closes.length >= 200
    ? closes.slice(-200).reduce((sum, value) => sum + value, 0) / 200
    : ma50;

  const gains = [];
  const losses = [];
  for (let index = 1; index < closes.length; index += 1) {
    const diff = closes[index] - closes[index - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  const recentGains = gains.slice(-14);
  const recentLosses = losses.slice(-14);
  const avgGain = recentGains.reduce((sum, value) => sum + value, 0) / (recentGains.length || 1);
  const avgLoss = recentLosses.reduce((sum, value) => sum + value, 0) / (recentLosses.length || 1);
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = parseFloat((100 - 100 / (1 + rs)).toFixed(1));
  const avgVolume = volumes.slice(-20).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.min(volumes.length, 20));
  const trend = price > ma50 ? (price > ma20 ? 'BULLISH' : 'NEUTRAL') : 'BEARISH';

  const companyName = profile?.name || `${ticker} Corp.`;
  const sector = profile?.sector || 'Unknown';

  const [companyNewsResult, finnhubMacroNewsResult, newsApiMacroNewsResult] = await Promise.allSettled([
    withTimeout(fetchFinnhubNews(ticker, {
      sector,
      companyName,
    }, dependencies), ENRICHMENT_TIMEOUT_MS, `Finnhub company news fetch for ${ticker}`),
    withTimeout(fetchFinnhubMacroNews(), ENRICHMENT_TIMEOUT_MS, `Finnhub macro news for ${ticker}`),
    withTimeout(fetchNewsApiMacroNews(), ENRICHMENT_TIMEOUT_MS, `NewsAPI macro news for ${ticker}`),
  ]);

  const companyNews = companyNewsResult.status === 'fulfilled' ? companyNewsResult.value : [];
  const finnhubMacroNews = finnhubMacroNewsResult.status === 'fulfilled' ? finnhubMacroNewsResult.value : [];
  const newsApiMacroNews = newsApiMacroNewsResult.status === 'fulfilled' ? newsApiMacroNewsResult.value : [];
  const macroNews = await scoreMacroNewsWithLlm(
    [...finnhubMacroNews, ...newsApiMacroNews],
    { ticker, sector },
    dependencies
  );

  const sentimentScore = Array.isArray(companyNews) && companyNews.length > 0
    ? parseFloat((companyNews.reduce((sum, article) => sum + safeNumber(article.sentiment), 0) / companyNews.length).toFixed(2))
    : 0;
  const sentimentLabel = sentimentScore > 0.3 ? 'BULLISH' : sentimentScore < -0.3 ? 'BEARISH' : 'NEUTRAL';

  const consensus = recommendations || {
    strongBuy: 0,
    buy: 0,
    hold: 0,
    sell: 0,
    strongSell: 0,
  };

  let targetHigh;
  let targetLow;
  let targetMean;
  if (priceTarget && priceTarget.targetHigh > 0 && priceTarget.targetLow > 0) {
    targetHigh = priceTarget.targetHigh;
    targetLow = priceTarget.targetLow;
    targetMean = priceTarget.targetMean || (targetHigh + targetLow) / 2;
  } else {
    targetHigh = price * 1.12;
    targetLow = price * 0.9;
    targetMean = (targetHigh + targetLow) / 2;
  }

  return {
    ticker,
    name: companyName,
    sector,
    price: parseFloat(price.toFixed(2)),
    prevClose: parseFloat(prevClose.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePercent: parseFloat(changePercent.toFixed(2)),
    volume: Math.floor(safeNumber(quote?.v, latestBar?.volume)),
    avgVolume: Math.floor(avgVolume),
    high52w: parseFloat(Math.max(...highs).toFixed(2)),
    low52w: parseFloat(Math.min(...lows).toFixed(2)),
    marketCap: profile?.marketCap || 0,
    pe: metrics?.pe || 0,
    eps: metrics?.eps || 0,
    ma20: parseFloat(ma20.toFixed(2)),
    ma50: parseFloat(ma50.toFixed(2)),
    ma200: parseFloat(ma200.toFixed(2)),
    rsi,
    trend,
    sentimentScore,
    sentimentLabel,
    analystConsensus: {
      ...consensus,
      targetHigh: parseFloat(targetHigh.toFixed(2)),
      targetLow: parseFloat(targetLow.toFixed(2)),
      targetMean: parseFloat(targetMean.toFixed(2)),
      upside: parseFloat((((targetMean - price) / price) * 100).toFixed(1)),
    },
    news: Array.isArray(companyNews) ? companyNews : [],
    macroContext: buildMacroContext({
      ticker,
      sector,
      macroNews,
    }),
    priceHistory,
    technicalIndicators: calculateAllIndicators(priceHistory),
    collectedAt: new Date().toISOString(),
    dataSource: 'finnhub',
    fallbackReason: priceHistorySource === 'finnhub'
      ? null
      : priceHistorySource === 'yahoo-finance-history'
        ? 'Finnhub candle history unavailable; Yahoo Finance used for price history.'
        : 'Finnhub candle history unavailable; Alpha Vantage used for price history.',
    priceHistorySource,
    dataSourceBreakdown: {
      price: priceHistorySource === 'finnhub'
        ? 'Finnhub (Real)'
        : priceHistorySource === 'yahoo-finance-history'
          ? 'Yahoo Finance (Real fallback)'
          : 'Alpha Vantage (Real fallback)',
      technicals: priceHistorySource === 'finnhub'
        ? 'Finnhub (Real)'
        : priceHistorySource === 'yahoo-finance-history'
          ? 'Yahoo Finance (Real fallback)'
          : 'Alpha Vantage (Real fallback)',
      news: Array.isArray(companyNews) && companyNews.length > 0 ? 'Finnhub (Real)' : 'No news found',
      macro: macroNews.length > 0 ? 'Finnhub + NewsAPI (Real)' : 'No macro news',
    },
    finnhubData: {
      profile: !!profile,
      metrics: !!metrics,
      news: Array.isArray(companyNews) ? companyNews.length : 0,
      recommendations: !!recommendations,
      priceTarget: !!priceTarget,
      candles: priceHistory.length,
      quote: !!quote,
    },
  };
}


// Singleton Yahoo Finance instance
let _yf = null;
function getYahooFinance() {
  if (!_yf) {
    const path = require('path');
    // yahoo-finance2 is installed in backend/node_modules; resolve explicitly
    const yf2Path = path.resolve(__dirname, '../../../backend/node_modules/yahoo-finance2');
    const YF = require(yf2Path).default;
    _yf = new YF({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
  }
  return _yf;
}

async function fetchYahooFinancePriceHistory(ticker, lookbackDays = 730) {
  const yf = getYahooFinance();
  const to = new Date();
  const from = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);

  const chart = await withTimeout(yf.chart(ticker, {
    period1: from.toISOString().split('T')[0],
    period2: to.toISOString().split('T')[0],
    interval: '1d',
    events: '',
  }, {
    validateResult: false,
  }), REAL_DATA_TIMEOUT_MS, `Yahoo chart history fetch for ${ticker}`);

  const validHistory = (chart?.quotes || []).filter((bar) => bar && bar.date && safeNumber(bar.close) > 0);
  if (!validHistory || validHistory.length < 5) return null;

  return validHistory.map((bar) => ({
    date: new Date(bar.date).toISOString().split('T')[0],
    open: parseFloat(safeNumber(bar.open).toFixed(4)),
    high: parseFloat(safeNumber(bar.high).toFixed(4)),
    low: parseFloat(safeNumber(bar.low).toFixed(4)),
    close: parseFloat(safeNumber(bar.close).toFixed(4)),
    volume: Math.floor(safeNumber(bar.volume)),
  }));
}

async function fetchYahooFinanceData(ticker, dependencies = {}) {
  const perfMs = {};
  const startTotal = Date.now();

  const yf = getYahooFinance();
  const to = new Date();
  const from = new Date(Date.now() - 730 * 24 * 3600 * 1000);

  const startApi = Date.now();
  const [chart, summary] = await Promise.all([
    withTimeout(yf.chart(ticker, {
      period1: from.toISOString().split('T')[0],
      period2: to.toISOString().split('T')[0],
      interval: '1d',
      events: '',
    }, {
      validateResult: false,
    }), REAL_DATA_TIMEOUT_MS, `Yahoo chart fetch for ${ticker}`),
    withTimeout(yf.quoteSummary(ticker, {
      modules: ['price', 'summaryProfile', 'financialData', 'defaultKeyStatistics', 'recommendationTrend'],
    }), REAL_DATA_TIMEOUT_MS, `Yahoo quote summary fetch for ${ticker}`),
  ]);
  perfMs.yahooPriceApi = Date.now() - startApi;

  const validHistory = (chart?.quotes || []).filter((bar) => bar && bar.date && safeNumber(bar.close) > 0);

  if (!validHistory || validHistory.length < 5) {
    throw new Error(`Yahoo Finance returned insufficient history for ${ticker}`);
  }

  const priceMod = summary.price || {};
  const fd = summary.financialData || {};
  const ks = summary.defaultKeyStatistics || {};
  const sp = summary.summaryProfile || {};
  const rt = summary.recommendationTrend?.trend?.[0] || {};

  const priceHistory = validHistory.map((bar) => ({
    date: new Date(bar.date).toISOString().split('T')[0],
    open: parseFloat(safeNumber(bar.open).toFixed(4)),
    high: parseFloat(safeNumber(bar.high).toFixed(4)),
    low: parseFloat(safeNumber(bar.low).toFixed(4)),
    close: parseFloat(safeNumber(bar.close).toFixed(4)),
    volume: Math.floor(safeNumber(bar.volume)),
  }));

  const closes = priceHistory.map((d) => d.close);
  const volumes = priceHistory.map((d) => d.volume);
  const highs = priceHistory.map((d) => d.high);
  const lows = priceHistory.map((d) => d.low);

  const price = safeNumber(priceMod.regularMarketPrice || closes[closes.length - 1]);
  const prevClose = safeNumber(priceMod.regularMarketPreviousClose || closes[closes.length - 2] || price);
  const change = price - prevClose;
  const changePercent = prevClose === 0 ? 0 : (change / prevClose) * 100;

  const ma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, closes.length);
  const ma50 = closes.slice(-50).reduce((s, v) => s + v, 0) / Math.min(50, closes.length);
  const ma200 = closes.length >= 200
    ? closes.slice(-200).reduce((s, v) => s + v, 0) / 200
    : ma50;

  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  const avgGain = gains.slice(-14).reduce((s, v) => s + v, 0) / 14;
  const avgLoss = losses.slice(-14).reduce((s, v) => s + v, 0) / 14;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = parseFloat((100 - 100 / (1 + rs)).toFixed(1));
  const avgVolume = volumes.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, volumes.length);
  const trend = price > ma50 ? (price > ma20 ? 'BULLISH' : 'NEUTRAL') : 'BEARISH';

  // News from Finnhub is US-focused; for non-US tickers use Yahoo Finance search news fallback
  const startNews = Date.now();
  
  // Check if ASX ticker early (needed for both news and short data fetches)
  const isAsx = ticker.toUpperCase().endsWith('.AX');
  
  // parallelize company news, macro news, and ASX short metrics
  const [yahooNews, macroNews, shortMetrics] = await Promise.all([
    (async () => {
      try {
        const companyName = priceMod.longName || priceMod.shortName || ticker;

        const startYahooNews = Date.now();
        // For ASX tickers, fetch Yahoo News + ASX Announcements + Google News RSS in parallel
        const [yahooSearchResult, asxResult, googleRssResult] = await Promise.allSettled([
          withTimeout(
            yf.search(ticker, { newsCount: 5, quotesCount: 0 }),
            ENRICHMENT_TIMEOUT_MS,
            `Yahoo news search for ${ticker}`
          ),
          isAsx
            ? withTimeout(fetchAsxAnnouncements(ticker), ENRICHMENT_TIMEOUT_MS, `ASX announcements for ${ticker}`)
            : Promise.resolve([]),
          isAsx
            ? withTimeout(fetchGoogleNewsRss(ticker, companyName), ENRICHMENT_TIMEOUT_MS, `Google News RSS for ${ticker}`)
            : Promise.resolve([]),
        ]);
        perfMs.yahooNewsSearch = Date.now() - startYahooNews;

        const yahooItems = yahooSearchResult.status === 'fulfilled'
          ? (yahooSearchResult.value?.news || []).slice(0, 5)
          : [];
        const asxItems = asxResult.status === 'fulfilled' ? (asxResult.value || []) : [];
        const googleItems = googleRssResult.status === 'fulfilled' ? (googleRssResult.value || []) : [];

        const yahooScores = scoreSentimentsWithRules(yahooItems.map((n) => n.title || ''));
        const ruleScoredYahoo = yahooItems.map((n, i) => ({
          title: n.title || '',
          summary: (n.summary || n.description || '').substring(0, 200),
          sentiment: yahooScores[i] ?? 0,
          source: 'Yahoo Finance',
          hoursAgo: (() => {
            const ts = n.providerPublishTime;
            if (!ts) return 0;
            let publishMs = 0;
            if (typeof ts === 'number') {
              publishMs = ts > 1e12 ? ts : ts * 1000;
            } else if (typeof ts === 'string') {
              if (/^\d+$/.test(ts)) {
                const numericTs = Number(ts);
                publishMs = numericTs > 1e12 ? numericTs : numericTs * 1000;
              } else {
                publishMs = Date.parse(ts);
              }
            }
            if (!Number.isFinite(publishMs) || publishMs <= 0) return 0;
            return Math.max(0, Math.round((Date.now() - publishMs) / 3600000));
          })(),
        }));

        // Merge and deduplicate across all sources (Yahoo + ASX Announcements + Google News)
        const allNews = dedupeArticlesByTitle([...ruleScoredYahoo, ...asxItems, ...googleItems]);

        // For LLM scoring, prefer articles that explicitly mention the ticker/company
        const searchTerms = [
          ticker.toUpperCase(),
          ticker.split('.')[0].toUpperCase(),
          ...(companyName.split(' ').slice(0, 3)),
        ];
        const relevantNews = allNews.filter((news) => {
          const headline = (news.title || '').toUpperCase();
          return searchTerms.some((term) => term.length > 1 && headline.includes(term.toUpperCase()));
        });

        const startCompanyLlm = Date.now();
        // Fall back to all articles for LLM if no article explicitly names the company
        // (common for ASX small-caps in third-party news)
        const llmCandidates = relevantNews.length > 0 ? relevantNews : allNews.slice(0, 6);
        let result = allNews;
        if (llmCandidates.length > 0) {
          const llmScored = await scoreCompanyNewsWithLlm(llmCandidates, {
            ticker,
            sector: sp.sector || sp.industry || 'Unknown',
            companyName,
          }, dependencies);
          result = allNews.map((news) => {
            const llmVersion = llmScored.find((n) => n.title === news.title);
            return llmVersion || news;
          });
        }
        perfMs.companyNewsLlm = Date.now() - startCompanyLlm;
        return result;
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        const startMacroFetch = Date.now();
        const [finnhubMacroNewsResult, newsApiMacroNewsResult] = await Promise.allSettled([
          withTimeout(fetchFinnhubMacroNews(), ENRICHMENT_TIMEOUT_MS, `Finnhub macro news for ${ticker}`),
          withTimeout(fetchNewsApiMacroNews(), ENRICHMENT_TIMEOUT_MS, `NewsAPI macro news for ${ticker}`),
        ]);
        perfMs.macroNewsFetch = Date.now() - startMacroFetch;

        const finnhubMacroNews = finnhubMacroNewsResult.status === 'fulfilled' ? finnhubMacroNewsResult.value : [];
        const newsApiMacroNews = newsApiMacroNewsResult.status === 'fulfilled' ? newsApiMacroNewsResult.value : [];
        
        const startMacroLlm = Date.now();
        const result = await scoreMacroNewsWithLlm(
          [...finnhubMacroNews, ...newsApiMacroNews],
          { ticker, sector: sp.sector || sp.industry || 'Unknown' },
          dependencies
        );
        perfMs.macroNewsLlm = Date.now() - startMacroLlm;
        return result;
      } catch {
        return [];
      }
    })(),
    (async () => {
      if (!isAsx) return null;
      try {
        return await withTimeout(
          fetchAsicShortSellingData(ticker),
          ENRICHMENT_TIMEOUT_MS,
          `ASIC short data for ${ticker}`
        );
      } catch (error) {
        console.warn(`ASIC short data unavailable for ${ticker}, using mock:`, error.message);
        return {
          shortPercent: 2.0,
          shortTurnover: 0,
          dataSource: 'Mock (ShortMan timeout)',
          isMock: true,
        };
      }
    })(),
  ]);
  perfMs.newsTotal = Date.now() - startNews;

  const sentimentScore = yahooNews.length > 0
    ? parseFloat((yahooNews.reduce((s, n) => s + (n.sentiment || 0), 0) / yahooNews.length).toFixed(2))
    : 0;
  const sentimentLabel = sentimentScore > 0.3 ? 'BULLISH' : sentimentScore < -0.3 ? 'BEARISH' : 'NEUTRAL';

  const targetMean = safeNumber(fd.targetMeanPrice);
  const targetHigh = safeNumber(fd.targetHighPrice) || (price * 1.12);
  const targetLow = safeNumber(fd.targetLowPrice) || (price * 0.9);
  const effectiveTargetMean = targetMean || (targetHigh + targetLow) / 2;

  return {
    ticker,
    name: priceMod.longName || priceMod.shortName || `${ticker}`,
    sector: sp.sector || sp.industry || 'Unknown',
    currency: priceMod.currency || 'USD',
    exchange: priceMod.exchangeName || '',
    price: parseFloat(price.toFixed(4)),
    prevClose: parseFloat(prevClose.toFixed(4)),
    change: parseFloat(change.toFixed(4)),
    changePercent: parseFloat(changePercent.toFixed(2)),
    volume: Math.floor(safeNumber(priceMod.regularMarketVolume || volumes[volumes.length - 1])),
    avgVolume: Math.floor(avgVolume),
    high52w: parseFloat(Math.max(...highs).toFixed(4)),
    low52w: parseFloat(Math.min(...lows).toFixed(4)),
    marketCap: safeNumber(priceMod.marketCap),
    pe: safeNumber(ks.forwardPE || ks.trailingPE),
    eps: safeNumber(ks.trailingEps),
    ma20: parseFloat(ma20.toFixed(4)),
    ma50: parseFloat(ma50.toFixed(4)),
    ma200: parseFloat(ma200.toFixed(4)),
    rsi,
    trend,
    sentimentScore,
    sentimentLabel,
    analystConsensus: {
      strongBuy: safeNumber(rt.strongBuy),
      buy: safeNumber(rt.buy),
      hold: safeNumber(rt.hold),
      sell: safeNumber(rt.sell),
      strongSell: safeNumber(rt.strongSell),
      targetHigh: parseFloat(targetHigh.toFixed(4)),
      targetLow: parseFloat(targetLow.toFixed(4)),
      targetMean: parseFloat(effectiveTargetMean.toFixed(4)),
      upside: effectiveTargetMean > 0 ? parseFloat((((effectiveTargetMean - price) / price) * 100).toFixed(1)) : 0,
    },
    news: yahooNews,
    shortMetrics,
    macroContext: buildMacroContext({
      ticker,
      sector: sp.sector || sp.industry || 'Unknown',
      macroNews,
    }),
    priceHistory,
    priceHistorySource: 'yahoo-finance-history',
    technicalIndicators: calculateAllIndicators(priceHistory),
    collectedAt: new Date().toISOString(),
    dataSource: 'yahoo-finance',
    fallbackReason: null,
    // Data source breakdown for UI transparency
    dataSourceBreakdown: {
      price: 'Yahoo Finance (Real)',
      technicals: 'Yahoo Finance (Real)',
      news: yahooNews.length > 0 ? 'Yahoo + ASX + Google (Real)' : 'No news found',
      shortMetrics: shortMetrics && !shortMetrics.isMock
        ? (shortMetrics.dataSource || 'ASIC (Real)')
        : (shortMetrics?.dataSource || 'Mock'),
      macro: macroNews.length > 0 ? 'Finnhub + NewsAPI (Real)' : 'No macro news',
    },
    perfMs: {
      total: Date.now() - startTotal,
      yahooPriceApi: perfMs.yahooPriceApi,
      yahooNewsSearch: perfMs.yahooNewsSearch,
      companyNewsLlm: perfMs.companyNewsLlm,
      newsTotal: perfMs.newsTotal,
      macroNewsFetch: perfMs.macroNewsFetch,
      macroNewsLlm: perfMs.macroNewsLlm,
    },
  };
}

function generateMockMarketData(ticker) {
  const stocks = {
    AAPL: { base: 185.5, name: 'Apple Inc.', sector: 'Technology' },
    TSLA: { base: 248.2, name: 'Tesla Inc.', sector: 'Automotive/EV' },
    NVDA: { base: 875.3, name: 'NVIDIA Corp.', sector: 'Semiconductors' },
    MSFT: { base: 415.8, name: 'Microsoft Corp.', sector: 'Technology' },
    AMZN: { base: 188.4, name: 'Amazon.com Inc.', sector: 'E-Commerce/Cloud' },
    GOOGL: { base: 175.2, name: 'Alphabet Inc.', sector: 'Technology' },
    META: { base: 512.6, name: 'Meta Platforms', sector: 'Social Media' },
    BRK: { base: 380.5, name: 'Berkshire Hathaway', sector: 'Financials' },
  };

  const stockInfo = stocks[ticker] || {
    base: 100 + Math.random() * 400,
    name: `${ticker} Corp.`,
    sector: 'Unknown',
  };
  const base = stockInfo.base;
  const rand = (min, max) => min + Math.random() * (max - min);

  const price = base * (1 + rand(-0.03, 0.03));
  const prevClose = base * (1 + rand(-0.02, 0.02));
  const change = price - prevClose;
  const changePercent = (change / prevClose) * 100;

  const priceHistory = [];
  let syntheticPrice = base * 0.78;
  for (let index = 99; index >= 0; index -= 1) {
    syntheticPrice = syntheticPrice * (1 + rand(-0.025, 0.028));
    const date = new Date();
    date.setDate(date.getDate() - index);
    priceHistory.push({
      date: date.toISOString().split('T')[0],
      close: parseFloat(syntheticPrice.toFixed(2)),
      volume: Math.floor(rand(30000000, 90000000)),
      open: parseFloat((syntheticPrice * (1 + rand(-0.01, 0.01))).toFixed(2)),
      high: parseFloat((syntheticPrice * (1 + rand(0.005, 0.02))).toFixed(2)),
      low: parseFloat((syntheticPrice * (1 - rand(0.005, 0.02))).toFixed(2)),
    });
  }

  const closes = priceHistory.map((day) => day.close);
  const ma20 = closes.slice(-20).reduce((sum, value) => sum + value, 0) / 20;
  const ma50 = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const ma200 = ma50 * 0.95;

  const gains = [];
  const losses = [];
  for (let index = 1; index < closes.length; index += 1) {
    const diff = closes[index] - closes[index - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  const avgGain = gains.slice(-14).reduce((sum, value) => sum + value, 0) / 14;
  const avgLoss = losses.slice(-14).reduce((sum, value) => sum + value, 0) / 14;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = parseFloat((100 - 100 / (1 + rs)).toFixed(1));

  const sentimentScore = parseFloat(rand(-0.8, 0.9).toFixed(2));
  const trend = price > ma50 ? (price > ma20 ? 'BULLISH' : 'NEUTRAL') : 'BEARISH';

  const buyCount = Math.floor(rand(5, 20));
  const holdCount = Math.floor(rand(3, 15));
  const sellCount = Math.floor(rand(1, 8));
  const targetHigh = price * rand(1.1, 1.35);
  const targetLow = price * rand(0.8, 0.98);
  const targetMean = (targetHigh + targetLow) / 2;

  const news = [
    { title: `${stockInfo.name} Reports Strong Q4 Earnings, Beats Expectations`, source: 'Reuters', sentiment: 0.75, hoursAgo: 2 },
    { title: `Analysts Raise Price Target for ${ticker} Amid AI Expansion`, source: 'Bloomberg', sentiment: 0.6, hoursAgo: 5 },
    { title: `${stockInfo.sector} Sector Faces Regulatory Scrutiny`, source: 'WSJ', sentiment: -0.4, hoursAgo: 12 },
    { title: `${stockInfo.name} Announces New Product Line, Shares React`, source: 'CNBC', sentiment: 0.45, hoursAgo: 18 },
    { title: `Macro Headwinds Could Pressure ${ticker} in Near Term`, source: 'FT', sentiment: -0.3, hoursAgo: 24 },
  ];

  const macroNews = [
    {
      title: 'Oil climbs as Middle East tensions keep traders in risk-control mode',
      summary: 'Energy and freight-sensitive sectors are repricing geopolitical supply risk while broader equity futures trade cautiously.',
      url: '',
      source: 'Mock Macro Feed',
      sentiment: -0.45,
      hoursAgo: 3,
      theme: 'GEOPOLITICS',
      scope: 'macro',
    },
    {
      title: 'Fed officials signal patience as markets push back rate-cut timing',
      summary: 'Higher-for-longer rates are supporting the dollar and pressuring long-duration growth multiples.',
      url: '',
      source: 'Mock Macro Feed',
      sentiment: -0.2,
      hoursAgo: 9,
      theme: 'MONETARY_POLICY',
      scope: 'macro',
    },
    {
      title: 'Election rhetoric revives tariff and industrial-policy scenarios',
      summary: 'Investors are reassessing which sectors would benefit from domestic manufacturing support and which would absorb higher import costs.',
      url: '',
      source: 'Mock Macro Feed',
      sentiment: -0.1,
      hoursAgo: 16,
      theme: 'POLITICS_POLICY',
      scope: 'macro',
    },
  ];

  return {
    ticker,
    name: stockInfo.name,
    sector: stockInfo.sector,
    price: parseFloat(price.toFixed(2)),
    prevClose: parseFloat(prevClose.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePercent: parseFloat(changePercent.toFixed(2)),
    volume: Math.floor(rand(40000000, 80000000)),
    avgVolume: Math.floor(rand(55000000, 70000000)),
    high52w: parseFloat((base * rand(1.05, 1.25)).toFixed(2)),
    low52w: parseFloat((base * rand(0.65, 0.85)).toFixed(2)),
    marketCap: parseFloat((price * rand(100, 3000) * 1e6).toFixed(0)),
    pe: parseFloat(rand(15, 45).toFixed(1)),
    eps: parseFloat(rand(2, 15).toFixed(2)),
    ma20: parseFloat(ma20.toFixed(2)),
    ma50: parseFloat(ma50.toFixed(2)),
    ma200: parseFloat(ma200.toFixed(2)),
    rsi,
    trend,
    sentimentScore,
    sentimentLabel: sentimentScore > 0.3 ? 'BULLISH' : sentimentScore < -0.3 ? 'BEARISH' : 'NEUTRAL',
    analystConsensus: {
      strongBuy: Math.floor(buyCount * 0.4),
      buy: Math.ceil(buyCount * 0.6),
      hold: holdCount,
      sell: Math.ceil(sellCount * 0.7),
      strongSell: Math.floor(sellCount * 0.3),
      targetHigh: parseFloat(targetHigh.toFixed(2)),
      targetLow: parseFloat(targetLow.toFixed(2)),
      targetMean: parseFloat(targetMean.toFixed(2)),
      upside: parseFloat((((targetMean - price) / price) * 100).toFixed(1)),
    },
    news,
    macroContext: buildMacroContext({
      ticker,
      sector: stockInfo.sector,
      macroNews,
    }),
    priceHistory,
    technicalIndicators: calculateAllIndicators(priceHistory),
    collectedAt: new Date().toISOString(),
    dataSource: 'mock',
    fallbackReason: null,
  };
}

async function fetchAlphaVantageMarketData(ticker, dependencies = {}) {
  const { priceHistory, allDates, series } = await fetchAlphaVantagePriceHistory(ticker);

  const getVolume = (candle) => safeNumber(candle['6. volume'] ?? candle['5. volume']);

  const latestDate = allDates[allDates.length - 1];
  const prevDate = allDates[allDates.length - 2];
  const latest = series[latestDate] || {};
  const previous = series[prevDate] || {};

  const price = safeNumber(latest['4. close']);
  const prevClose = safeNumber(previous['4. close'], price);
  const change = price - prevClose;
  const changePercent = prevClose === 0 ? 0 : (change / prevClose) * 100;

  const closes = allDates.map((date) => safeNumber((series[date] || {})['4. close'])).filter((value) => value > 0);
  const volumes = allDates.map((date) => getVolume(series[date] || {})).filter((value) => value > 0);
  const highs = allDates.map((date) => safeNumber((series[date] || {})['2. high'])).filter((value) => value > 0);
  const lows = allDates.map((date) => safeNumber((series[date] || {})['3. low'])).filter((value) => value > 0);

  const ma20Slice = closes.slice(-20);
  const ma50Slice = closes.slice(-50);
  const ma20 = ma20Slice.reduce((sum, value) => sum + value, 0) / ma20Slice.length;
  const ma50 = ma50Slice.reduce((sum, value) => sum + value, 0) / ma50Slice.length;
  const ma200 = closes.length >= 200
    ? closes.slice(-200).reduce((sum, value) => sum + value, 0) / 200
    : ma50;

  const gains = [];
  const losses = [];
  for (let index = 1; index < closes.length; index += 1) {
    const diff = closes[index] - closes[index - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  const recentGains = gains.slice(-14);
  const recentLosses = losses.slice(-14);
  const avgGain = recentGains.reduce((sum, value) => sum + value, 0) / (recentGains.length || 1);
  const avgLoss = recentLosses.reduce((sum, value) => sum + value, 0) / (recentLosses.length || 1);
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = parseFloat((100 - 100 / (1 + rs)).toFixed(1));

  const avgVolume = volumes.slice(-20).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.min(volumes.length, 20));
  const trend = price > ma50 ? (price > ma20 ? 'BULLISH' : 'NEUTRAL') : 'BEARISH';

  // Fetch Finnhub data (news, sentiment, analyst consensus, fundamentals)
  let finnhubProfile = null;
  let finnhubMetrics = null;
  let finnhubNews = [];
  let finnhubRecommendations = null;
  let finnhubPriceTarget = null;

  let finnhubMacroNews = [];
  let newsApiMacroNews = [];

  if (config.finnhubApiKey) {
    const enrichmentResults = await Promise.allSettled([
      withTimeout(fetchFinnhubProfile(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub profile fetch for ${ticker}`),
      withTimeout(fetchFinnhubMetrics(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub metrics fetch for ${ticker}`),
      withTimeout(fetchFinnhubNews(ticker, {
        sector: finnhubProfile?.sector || 'Unknown',
        companyName: finnhubProfile?.name || `${ticker} Corp.`,
      }, dependencies), ENRICHMENT_TIMEOUT_MS, `Finnhub company news fetch for ${ticker}`),
      withTimeout(fetchFinnhubRecommendations(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub recommendations fetch for ${ticker}`),
      withTimeout(fetchFinnhubPriceTarget(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub price target fetch for ${ticker}`),
      withTimeout(fetchFinnhubMacroNews(), ENRICHMENT_TIMEOUT_MS, `Finnhub macro news for ${ticker}`),
      withTimeout(fetchNewsApiMacroNews(), ENRICHMENT_TIMEOUT_MS, `NewsAPI macro news for ${ticker}`),
    ]);

    finnhubProfile = enrichmentResults[0].status === 'fulfilled' ? enrichmentResults[0].value : null;
    finnhubMetrics = enrichmentResults[1].status === 'fulfilled' ? enrichmentResults[1].value : null;
    finnhubNews = enrichmentResults[2].status === 'fulfilled' ? enrichmentResults[2].value : [];
    finnhubRecommendations = enrichmentResults[3].status === 'fulfilled' ? enrichmentResults[3].value : null;
    finnhubPriceTarget = enrichmentResults[4].status === 'fulfilled' ? enrichmentResults[4].value : null;
    finnhubMacroNews = enrichmentResults[5].status === 'fulfilled' ? enrichmentResults[5].value : [];
    newsApiMacroNews = enrichmentResults[6].status === 'fulfilled' ? enrichmentResults[6].value : [];
  } else {
    const [finnhubMacroNewsResult, newsApiMacroNewsResult] = await Promise.allSettled([
      withTimeout(fetchFinnhubMacroNews(), ENRICHMENT_TIMEOUT_MS, `Finnhub macro news for ${ticker}`),
      withTimeout(fetchNewsApiMacroNews(), ENRICHMENT_TIMEOUT_MS, `NewsAPI macro news for ${ticker}`),
    ]);
    finnhubMacroNews = finnhubMacroNewsResult.status === 'fulfilled' ? finnhubMacroNewsResult.value : [];
    newsApiMacroNews = newsApiMacroNewsResult.status === 'fulfilled' ? newsApiMacroNewsResult.value : [];
  }

  // Use Finnhub data if available, otherwise use fallbacks
  const name = finnhubProfile?.name || `${ticker} Corp.`;
  const sector = finnhubProfile?.sector || 'Unknown';
  const pe = finnhubMetrics?.pe || 0;
  const eps = finnhubMetrics?.eps || 0;
  const marketCap = finnhubProfile?.marketCap || 0;
  const macroNews = await scoreMacroNewsWithLlm(
    [...finnhubMacroNews, ...newsApiMacroNews],
    { ticker, sector },
    dependencies
  );

  // Compute sentiment from news headlines (guard against null return from Finnhub)
  const news = Array.isArray(finnhubNews) && finnhubNews.length > 0 ? finnhubNews : [];
  const sentimentScore = news.length > 0
    ? parseFloat((news.reduce((sum, n) => sum + (n.sentiment || 0), 0) / news.length).toFixed(2))
    : 0;
  const sentimentLabel = sentimentScore > 0.3 ? 'BULLISH' : sentimentScore < -0.3 ? 'BEARISH' : 'NEUTRAL';

  // Use analyst recommendations if available
  const consensus = finnhubRecommendations || {
    strongBuy: 0,
    buy: 0,
    hold: 0,
    sell: 0,
    strongSell: 0,
  };

  // Use real price targets from Finnhub if available, otherwise use naive fallback
  let targetHigh, targetLow, targetMean;
  if (finnhubPriceTarget && finnhubPriceTarget.targetHigh > 0 && finnhubPriceTarget.targetLow > 0) {
    targetHigh = finnhubPriceTarget.targetHigh;
    targetLow = finnhubPriceTarget.targetLow;
    targetMean = finnhubPriceTarget.targetMean || (targetHigh + targetLow) / 2;
  } else {
    // Fallback: naive estimation based on current price
    targetHigh = price * 1.12;
    targetLow = price * 0.9;
    targetMean = (targetHigh + targetLow) / 2;
  }


  return {
    ticker,
    name,
    sector,
    price: parseFloat(price.toFixed(2)),
    prevClose: parseFloat(prevClose.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePercent: parseFloat(changePercent.toFixed(2)),
    volume: Math.floor(getVolume(latest)),
    avgVolume: Math.floor(avgVolume),
    high52w: parseFloat((Math.max(...highs)).toFixed(2)),
    low52w: parseFloat((Math.min(...lows)).toFixed(2)),
    marketCap,
    pe,
    eps,
    ma20: parseFloat(ma20.toFixed(2)),
    ma50: parseFloat(ma50.toFixed(2)),
    ma200: parseFloat(ma200.toFixed(2)),
    rsi,
    trend,
    sentimentScore,
    sentimentLabel,
    analystConsensus: {
      ...consensus,
      targetHigh: parseFloat(targetHigh.toFixed(2)),
      targetLow: parseFloat(targetLow.toFixed(2)),
      targetMean: parseFloat(targetMean.toFixed(2)),
      upside: parseFloat((((targetMean - price) / price) * 100).toFixed(1)),
    },
    news,
    macroContext: buildMacroContext({
      ticker,
      sector,
      macroNews,
    }),
    priceHistory,
    priceHistorySource: 'alpha-vantage-history',
    technicalIndicators: calculateAllIndicators(priceHistory),
    collectedAt: new Date().toISOString(),
    dataSource: 'alpha-vantage',
    dataSourceBreakdown: {
      price: 'Alpha Vantage (Real)',
      technicals: 'Alpha Vantage (Real)',
      news: news.length > 0 ? 'Finnhub (Real)' : 'No news found',
      macro: macroNews.length > 0 ? 'Finnhub + NewsAPI (Real)' : 'No macro news',
    },
    finnhubData: {
      profile: !!finnhubProfile,
      metrics: !!finnhubMetrics,
      news: news.length,
      recommendations: !!finnhubRecommendations,
      priceTarget: !!finnhubPriceTarget,
    },
  };
}

async function fetchAlphaVantagePriceHistory(ticker) {
  const apiKey = config.alphaVantageApiKey;
  if (!apiKey || apiKey === 'demo') {
    throw new Error('ALPHA_VANTAGE_API_KEY is missing or set to demo');
  }

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=full&apikey=${apiKey}`;
  const response = await withTimeout(fetch(url), REAL_DATA_TIMEOUT_MS, `Alpha Vantage core price fetch for ${ticker}`);

  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (payload['Error Message']) {
    throw new Error(payload['Error Message']);
  }
  if (payload.Information) {
    throw new Error(payload.Information);
  }
  if (payload.Note) {
    throw new Error(payload.Note);
  }

  const series = payload['Time Series (Daily)'];
  if (!series || typeof series !== 'object') {
    throw new Error('Missing time series data from Alpha Vantage');
  }

  const allDates = Object.keys(series).sort();
  if (allDates.length < 20) {
    throw new Error('Not enough history returned by Alpha Vantage');
  }

  const getVolume = (candle) => safeNumber(candle['6. volume'] ?? candle['5. volume']);
  const recentDatesAsc = allDates.slice(-500);  // Last 500 trading days (~2 years)
  const priceHistory = recentDatesAsc.map((date) => {
    const candle = series[date] || {};
    return {
      date,
      open: parseFloat(safeNumber(candle['1. open']).toFixed(2)),
      high: parseFloat(safeNumber(candle['2. high']).toFixed(2)),
      low: parseFloat(safeNumber(candle['3. low']).toFixed(2)),
      close: parseFloat(safeNumber(candle['4. close']).toFixed(2)),
      volume: Math.floor(getVolume(candle)),
    };
  });

  return { priceHistory, allDates, series };
}

function buildFallbackAnalysis(ticker, marketData) {
  const macroText = marketData?.macroContext?.marketContext || 'Macro context unavailable.';
  return {
    summary: `${ticker} is trading at $${marketData.price} with a ${marketData.trend} trend.`,
    keyTrends: [
      `RSI at ${marketData.rsi}`,
      `Sentiment: ${marketData.sentimentLabel}`,
      `Price vs MA50: ${((marketData.price / marketData.ma50 - 1) * 100).toFixed(1)}%`,
    ],
    riskFlags: marketData?.macroContext?.riskLevel === 'HIGH' ? ['Macro risk is elevated from current global headlines.'] : [],
    marketContext: macroText,
  };
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

async function runMarketIntelligence({ ticker }, dependencies = {}) {
  const cleanTicker = normalizeTicker(ticker);
  const isInternational = cleanTicker.includes('.');
  let marketData;
  try {
    if (isInternational) {
      marketData = await fetchYahooFinanceData(cleanTicker, dependencies);
    } else {
      try {
        marketData = await fetchFinnhubMarketData(cleanTicker, dependencies);
      } catch {
        marketData = await fetchAlphaVantageMarketData(cleanTicker, dependencies);
      }
    }
  } catch (error) {
    marketData = generateMockMarketData(cleanTicker);
    marketData.fallbackReason = error && error.message ? error.message : 'Live market API failed';
  }
  return {
    marketData,
    llmAnalysis: buildFallbackAnalysis(cleanTicker, marketData),
    skillUsed: 'market-intelligence',
    dataSource: marketData.dataSource,
    usedFallback: marketData.dataSource === 'mock',
    fallbackReason: marketData.fallbackReason,
  };
}

module.exports = {
  generateMockMarketData,
  runMarketIntelligence,
  scoreCompanyNewsWithLlm,
  scoreMacroNewsWithLlm,
};