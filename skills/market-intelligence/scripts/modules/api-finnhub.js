const config = require('../../../../backend/lib/config');
const { safeNumber, resolveArticleSourceLabel } = require('./utils');
const { scoreSentimentsWithRules, scoreCompanyNewsWithLlm } = require('./sentiment');
const { detectMacroTheme, MACRO_THEME_RULES } = require('./macro');

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

    const ruleScoredNewsPromises = articles.map(async (article, i) => ({
      title: article.headline || '',
      summary: (article.summary || article.description || article.lead_image || article.text || '').substring(0, 200),
      url: article.url || '',
      source: await resolveArticleSourceLabel(article.url, article.source || 'Finnhub'),
      sentiment: scores[i] ?? 0,
      hoursAgo: Math.round((Date.now() - (article.datetime * 1000)) / 3600000),
      publishedAt: safeNumber(article.datetime) > 0 ? new Date(safeNumber(article.datetime) * 1000).toISOString() : null,
    }));
    const ruleScoredNews = await Promise.all(ruleScoredNewsPromises);

    const companyName = context.companyName || `${ticker} Corp.`;
    const searchTerms = [
      ticker.toUpperCase(),
      ticker.split('.')[0].toUpperCase(),
      ...(companyName.split(' ').slice(0, 3)),
    ];
    const relevantNews = ruleScoredNews.filter((news) => {
      const headline = (news.title || '').toUpperCase();
      return searchTerms.some((term) => headline.includes(term.toUpperCase()));
    });

    if (relevantNews.length > 0) {
      const llmScored = await scoreCompanyNewsWithLlm(relevantNews, {
        ticker,
        sector: context.sector,
        companyName: context.companyName,
      }, dependencies);
      return ruleScoredNews.map((news) => {
        const llmVersion = llmScored.find((n) => n.title === news.title);
        return llmVersion
          ? {
              ...news,
              ...llmVersion,
              url: news.url || llmVersion.url || '',
              source: news.source || llmVersion.source || '',
              publishedAt: news.publishedAt || llmVersion.publishedAt || null,
            }
          : news;
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
    const macroNewsPromises = filtered.map(async (article, index) => ({
      title: article.headline || '',
      summary: article.summary || '',
      url: article.url || '',
      source: await resolveArticleSourceLabel(article.url, article.source || 'Finnhub General'),
      sentiment: scores[index] ?? 0,
      hoursAgo: Math.round((Date.now() - (safeNumber(article.datetime) * 1000)) / 3600000),
      publishedAt: safeNumber(article.datetime) > 0 ? new Date(safeNumber(article.datetime) * 1000).toISOString() : null,
      theme: detectMacroTheme(`${article.headline || ''} ${article.summary || ''}`),
      scope: 'macro',
    }));
    return await Promise.all(macroNewsPromises);
  } catch (error) {
    console.error('Finnhub macro news fetch failed:', error.message);
    return [];
  }
}

async function fetchFinnhubRecommendations(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return null;

  try {
    const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

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
      country: data.country || null,
      weburl: data.weburl || null,
    };
  } catch (error) {
    console.error('Finnhub profile fetch failed:', error.message);
    return null;
  }
}

async function fetchFinnhubQuote(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return null;

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
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
    const from = to - (730 * 24 * 3600);
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

async function fetchFinnhubEarningsSurprise(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return [];

  try {
    const url = `https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];
    
    // Sort descending by period, take last 4 quarters
    return data.sort((a, b) => new Date(b.period) - new Date(a.period)).slice(0, 4).map(e => ({
      period: e.period,
      actual: safeNumber(e.actual),
      estimate: safeNumber(e.estimate),
      surprise: safeNumber(e.surprise),
      surprisePercent: safeNumber(e.surprisePercent)
    }));
  } catch (error) {
    console.error('Finnhub earnings surprise fetch failed:', error.message);
    return [];
  }
}

async function fetchFinnhubPeers(ticker) {
  const apiKey = config.finnhubApiKey;
  if (!apiKey) return [];

  try {
    const url = `https://finnhub.io/api/v1/stock/peers?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];
    
    return data.filter(p => p !== ticker).slice(0, 5);
  } catch (error) {
    console.error('Finnhub peers fetch failed:', error.message);
    return [];
  }
}

module.exports = {
  fetchFinnhubNews,
  fetchFinnhubMacroNews,
  fetchFinnhubRecommendations,
  fetchFinnhubProfile,
  fetchFinnhubQuote,
  fetchFinnhubCandles,
  fetchFinnhubMetrics,
  fetchFinnhubPriceTarget,
  fetchFinnhubEarningsSurprise,
  fetchFinnhubPeers,
};
