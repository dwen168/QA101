const { callDeepSeek } = require('../../../backend/lib/llm');
const { loadSkills } = require('../../../backend/lib/skill-loader');
const { normalizeTicker, parseJsonResponse } = require('../../../backend/lib/utils');
const config = require('../../../backend/lib/config');
const { calculateAllIndicators } = require('../../../backend/lib/technical-indicators');

const skills = loadSkills();

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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

// LLM batch sentiment scorer — scores all headlines in one API call
async function scoreSentimentsWithLLM(headlines) {
  if (!headlines || headlines.length === 0) return [];
  try {
    const numbered = headlines.map((h, i) => `${i + 1}. ${h}`).join('\n');
    const system = 'You are a financial news sentiment analyst. For each headline, return a sentiment score between -1.0 (very negative) and +1.0 (very positive) from an equity investor perspective. 0 is neutral.';
    const user = `Score each headline. Return ONLY a JSON array of numbers in the same order, e.g. [0.6, -0.3, 0.1].\n\n${numbered}`;
    const raw = await callDeepSeek(system, user, 0.1, 200);
    const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
    const scores = JSON.parse(cleaned);
    if (!Array.isArray(scores)) return headlines.map(() => 0);
    return scores.map(s => Math.max(-1, Math.min(1, Number(s) || 0)));
  } catch {
    // Fallback: neutral if LLM fails
    return headlines.map(() => 0);
  }
}

// Fetch news from Finnhub
async function fetchFinnhubNews(ticker) {
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
    const scores = await scoreSentimentsWithLLM(headlines);

    return articles.map((article, i) => ({
      title: article.headline || '',
      summary: article.summary || '',
      url: article.url || '',
      source: article.source || 'Finnhub',
      sentiment: scores[i] ?? 0,
      hoursAgo: Math.round((Date.now() - (article.datetime * 1000)) / 3600000),
    }));
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

    const scores = await scoreSentimentsWithLLM(filtered.map((article) => article.headline || ''));
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
    const scores = await scoreSentimentsWithLLM(articles.map((article) => article.title || ''));
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

async function fetchYahooFinanceData(ticker) {
  const yf = getYahooFinance();
  const to = new Date();
  const from = new Date(Date.now() - 120 * 24 * 3600 * 1000);

  const [chart, summary] = await Promise.all([
    yf.chart(ticker, {
      period1: from.toISOString().split('T')[0],
      period2: to.toISOString().split('T')[0],
      interval: '1d',
      events: '',
    }, {
      validateResult: false,
    }),
    yf.quoteSummary(ticker, {
      modules: ['price', 'summaryProfile', 'financialData', 'defaultKeyStatistics', 'recommendationTrend'],
    }),
  ]);

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
  const yahooNews = await (async () => {
    try {
      const results = await yf.search(ticker, { newsCount: 5, quotesCount: 0 });
      const items = (results.news || []).slice(0, 5);
      const headlines = items.map((n) => n.title || '');
      const scores = await scoreSentimentsWithLLM(headlines);
      return items.map((n, i) => ({
        title: n.title || '',
        summary: n.summary || n.description || '',
        url: n.link || '',
        source: n.publisher || 'Yahoo Finance',
        sentiment: scores[i] ?? 0,
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
    } catch {
      return [];
    }
  })();

  const [finnhubMacroNews, newsApiMacroNews] = await Promise.all([
    fetchFinnhubMacroNews(),
    fetchNewsApiMacroNews(),
  ]);

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
    macroContext: buildMacroContext({
      ticker,
      sector: sp.sector || sp.industry || 'Unknown',
      macroNews: [...finnhubMacroNews, ...newsApiMacroNews],
    }),
    priceHistory,
    technicalIndicators: calculateAllIndicators(priceHistory),
    collectedAt: new Date().toISOString(),
    dataSource: 'yahoo-finance',
    fallbackReason: null,
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

async function fetchAlphaVantageMarketData(ticker) {
  const apiKey = config.alphaVantageApiKey;
  if (!apiKey || apiKey === 'demo') {
    throw new Error('ALPHA_VANTAGE_API_KEY is missing or set to demo');
  }

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=compact&apikey=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (payload['Error Message']) {
    throw new Error(payload['Error Message']);
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

  const recentDatesAsc = allDates.slice(-100);
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

  if (config.finnhubApiKey) {
    [finnhubProfile, finnhubMetrics, finnhubNews, finnhubRecommendations, finnhubPriceTarget] = await Promise.all([
      fetchFinnhubProfile(ticker),
      fetchFinnhubMetrics(ticker),
      fetchFinnhubNews(ticker),
      fetchFinnhubRecommendations(ticker),
      fetchFinnhubPriceTarget(ticker),
    ]);
  }

  const [finnhubMacroNews, newsApiMacroNews] = await Promise.all([
    fetchFinnhubMacroNews(),
    fetchNewsApiMacroNews(),
  ]);

  // Use Finnhub data if available, otherwise use fallbacks
  const name = finnhubProfile?.name || `${ticker} Corp.`;
  const sector = finnhubProfile?.sector || 'Unknown';
  const pe = finnhubMetrics?.pe || 0;
  const eps = finnhubMetrics?.eps || 0;
  const marketCap = finnhubProfile?.marketCap || 0;

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
      macroNews: [...finnhubMacroNews, ...newsApiMacroNews],
    }),
    priceHistory,
    technicalIndicators: calculateAllIndicators(priceHistory),
    collectedAt: new Date().toISOString(),
    dataSource: 'alpha-vantage',
    finnhubData: {
      profile: !!finnhubProfile,
      metrics: !!finnhubMetrics,
      news: news.length,
      recommendations: !!finnhubRecommendations,
      priceTarget: !!finnhubPriceTarget,
    },
  };
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
    marketContext: `LLM analysis unavailable - check API key. ${macroText}`,
  };
}

async function runMarketIntelligence({ ticker }, dependencies = {}) {
  const cleanTicker = normalizeTicker(ticker);
  const isInternational = cleanTicker.includes('.');
  let marketData;
  try {
    if (isInternational) {
      marketData = await fetchYahooFinanceData(cleanTicker);
    } else {
      marketData = await fetchAlphaVantageMarketData(cleanTicker);
    }
  } catch (error) {
    marketData = generateMockMarketData(cleanTicker);
    marketData.fallbackReason = error && error.message ? error.message : 'Live market API failed';
  }
  const llm = dependencies.callDeepSeek || callDeepSeek;

  const systemPrompt = `You are an expert financial analyst. You have access to the following skill specification:\n\n${skills['market-intelligence']}\n\nYou are running the market-intelligence skill. Analyze the market data provided and return a structured intelligence report as JSON.`;
  const userMessage = `Analyze this market data for ${cleanTicker} and return a JSON object with keys: summary (string, 2-3 sentences), keyTrends (array of 3 strings), riskFlags (array of strings), marketContext (string). Data: ${JSON.stringify(marketData, null, 2)}`;

  try {
    const analysis = await llm(systemPrompt, userMessage);
    const llmAnalysis = parseJsonResponse(analysis, {
      summary: analysis,
      keyTrends: [],
      riskFlags: [],
      marketContext: '',
    });

    return {
      marketData,
      llmAnalysis,
      skillUsed: 'market-intelligence',
      dataSource: marketData.dataSource,
      usedFallback: marketData.dataSource === 'mock',
      fallbackReason: marketData.fallbackReason,
    };
  } catch {
    return {
      marketData,
      llmAnalysis: buildFallbackAnalysis(cleanTicker, marketData),
      skillUsed: 'market-intelligence',
      dataSource: marketData.dataSource,
      usedFallback: marketData.dataSource === 'mock',
      fallbackReason: marketData.fallbackReason,
    };
  }
}

module.exports = {
  generateMockMarketData,
  runMarketIntelligence,
};