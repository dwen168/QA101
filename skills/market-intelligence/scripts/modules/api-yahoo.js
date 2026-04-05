const { 
  withTimeout, 
  ENRICHMENT_TIMEOUT_MS, 
  REAL_DATA_TIMEOUT_MS, 
  safeNumber,
  resolveArticleSourceLabel
} = require('./utils');
const { scoreSentimentsWithRules, scoreCompanyNewsWithLlm } = require('./sentiment');

let _yf = null;
function getYahooFinance() {
  if (!_yf) {
    const YF = require('yahoo-finance2').default;
    _yf = new YF({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
  }
  return _yf;
}

function parseYahooPublishTime(value) {
  if (!value) return 0;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  if (typeof value === 'number') {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) {
      const numericTs = Number(value);
      return numericTs > 1e12 ? numericTs : numericTs * 1000;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function fetchYahooSummaryProfile(ticker) {
  try {
    const yf = getYahooFinance();
    const summary = await withTimeout(
      yf.quoteSummary(ticker, { modules: ['summaryProfile', 'assetProfile'] }),
      ENRICHMENT_TIMEOUT_MS,
      `Yahoo summaryProfile fetch for ${ticker}`
    );
    const sp = summary?.summaryProfile || summary?.assetProfile || {};
    return {
      description: (sp.longBusinessSummary || '').substring(0, 500) || null,
      industry: sp.industry || null,
      employees: sp.fullTimeEmployees || null,
      website: sp.website || null,
      country: sp.country || null,
    };
  } catch {
    return null;
  }
}

async function fetchYahooCompanyNewsFallback(ticker, { companyName = '', sector = 'Unknown' } = {}, dependencies = {}) {
  try {
    const yf = getYahooFinance();
    const searchResult = await withTimeout(
      yf.search(ticker, { newsCount: 8, quotesCount: 0 }),
      ENRICHMENT_TIMEOUT_MS,
      `Yahoo company news fallback for ${ticker}`
    );

    const yahooItems = Array.isArray(searchResult?.news) ? searchResult.news.slice(0, 8) : [];
    if (!yahooItems.length) {
      return [];
    }

    const scores = scoreSentimentsWithRules(yahooItems.map((item) => item.title || ''));
    const baseNewsPromises = yahooItems.map(async (item, index) => {
      const publishMs = parseYahooPublishTime(item.providerPublishTime);

      const url = item.link || item.clickThroughUrl?.url || '';
      return {
        title: item.title || '',
        summary: (item.summary || item.description || '').substring(0, 200),
        sentiment: scores[index] ?? 0,
        source: item.publisher || 'Yahoo Finance',
        url,
        hoursAgo: Number.isFinite(publishMs) && publishMs > 0
          ? Math.max(0, Math.round((Date.now() - publishMs) / 3600000))
          : 0,
        publishedAt: Number.isFinite(publishMs) && publishMs > 0 ? new Date(publishMs).toISOString() : null,
      };
    });
    const baseNews = await Promise.all(baseNewsPromises);

    const llmCandidates = baseNews.slice(0, 6);
    if (llmCandidates.length === 0) {
      return baseNews;
    }

    const llmScored = await scoreCompanyNewsWithLlm(
      llmCandidates,
      {
        ticker,
        sector,
        companyName: companyName || ticker,
      },
      dependencies
    );

    return baseNews.map((article) => {
      const llmVersion = llmScored.find((item) => item.title === article.title);
      return llmVersion
        ? {
            ...article,
            ...llmVersion,
            url: article.url || llmVersion.url || '',
            source: article.source || llmVersion.source || '',
            publishedAt: article.publishedAt || llmVersion.publishedAt || null,
          }
        : article;
    });
  } catch {
    return [];
  }
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

module.exports = {
  getYahooFinance,
  fetchYahooSummaryProfile,
  fetchYahooCompanyNewsFallback,
  fetchYahooFinancePriceHistory,
};
