const config = require('../../../../backend/lib/config');
const { calculateAllIndicators } = require('../../../../backend/lib/technical-indicators');
const { 
  withTimeout, 
  ENRICHMENT_TIMEOUT_MS, 
  REAL_DATA_TIMEOUT_MS, 
  safeNumber, 
  average, 
  dedupeArticlesByTitle 
} = require('./utils');
const { buildMacroContext } = require('./macro');
const { 
  scoreSentimentsWithRules, 
  scoreCompanyNewsWithLlm, 
  scoreMacroNewsWithLlm 
} = require('./sentiment');

const { 
  fetchFinnhubQuote, 
  fetchFinnhubProfile, 
  fetchFinnhubMetrics, 
  fetchFinnhubCandles, 
  fetchFinnhubRecommendations, 
  fetchFinnhubPriceTarget, 
  fetchFinnhubNews, 
  fetchFinnhubMacroNews 
} = require('./api-finnhub');

const { 
  getYahooFinance, 
  fetchYahooSummaryProfile, 
  fetchYahooFinancePriceHistory, 
  fetchYahooCompanyNewsFallback 
} = require('./api-yahoo');

const { fetchAlphaVantagePriceHistory } = require('./api-alpha');

const { 
  fetchNewsApiMacroNews, 
  fetchLatestCentralBankDecision, 
  fetchAsicShortSellingData, 
  fetchAsxAnnouncements, 
  fetchGoogleNewsRss 
} = require('./api-news');


async function fetchFinnhubMarketData(ticker, dependencies = {}) {
  if (!config.finnhubApiKey) {
    throw new Error('FINNHUB_API_KEY is missing');
  }

  const [quoteResult, profileResult, metricsResult, candlesResult, recommendationsResult, priceTargetResult, yahooProfileResult] = await Promise.allSettled([
    withTimeout(fetchFinnhubQuote(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub quote fetch for ${ticker}`),
    withTimeout(fetchFinnhubProfile(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub profile fetch for ${ticker}`),
    withTimeout(fetchFinnhubMetrics(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub metrics fetch for ${ticker}`),
    withTimeout(fetchFinnhubCandles(ticker), REAL_DATA_TIMEOUT_MS, `Finnhub candles fetch for ${ticker}`),
    withTimeout(fetchFinnhubRecommendations(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub recommendations fetch for ${ticker}`),
    withTimeout(fetchFinnhubPriceTarget(ticker), ENRICHMENT_TIMEOUT_MS, `Finnhub price target fetch for ${ticker}`),
    withTimeout(fetchYahooSummaryProfile(ticker), ENRICHMENT_TIMEOUT_MS, `Yahoo summary profile for ${ticker}`),
  ]);

  const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
  const yahooProfile = yahooProfileResult?.status === 'fulfilled' ? yahooProfileResult.value : null;
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

  const [companyNewsResult, finnhubMacroNewsResult, newsApiMacroNewsResult, fedDecisionResult, rbaDecisionResult] = await Promise.allSettled([
    withTimeout(fetchFinnhubNews(ticker, {
      sector,
      companyName,
    }, dependencies), ENRICHMENT_TIMEOUT_MS, `Finnhub company news fetch for ${ticker}`),
    withTimeout(fetchFinnhubMacroNews(), ENRICHMENT_TIMEOUT_MS, `Finnhub macro news for ${ticker}`),
    withTimeout(fetchNewsApiMacroNews(), ENRICHMENT_TIMEOUT_MS, `NewsAPI macro news for ${ticker}`),
    withTimeout(fetchLatestCentralBankDecision('FED'), ENRICHMENT_TIMEOUT_MS, `FED rate decision fetch for ${ticker}`),
    withTimeout(fetchLatestCentralBankDecision('RBA'), ENRICHMENT_TIMEOUT_MS, `RBA rate decision fetch for ${ticker}`),
  ]);

  let companyNews = companyNewsResult.status === 'fulfilled' ? companyNewsResult.value : [];
  let companyNewsSource = 'finnhub';

  if (!Array.isArray(companyNews) || companyNews.length === 0) {
    const yahooFallbackNews = await fetchYahooCompanyNewsFallback(
      ticker,
      { companyName, sector },
      dependencies
    );
    if (Array.isArray(yahooFallbackNews) && yahooFallbackNews.length > 0) {
      companyNews = yahooFallbackNews;
      companyNewsSource = 'yahoo-fallback';
    } else {
      companyNews = [];
      companyNewsSource = 'none';
    }
  }

  const finnhubMacroNews = finnhubMacroNewsResult.status === 'fulfilled' ? finnhubMacroNewsResult.value : [];
  const newsApiMacroNews = newsApiMacroNewsResult.status === 'fulfilled' ? newsApiMacroNewsResult.value : [];
  const policyDecisions = {
    fed: fedDecisionResult.status === 'fulfilled' ? fedDecisionResult.value : null,
    rba: rbaDecisionResult.status === 'fulfilled' ? rbaDecisionResult.value : null,
  };
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
    description: yahooProfile?.description || null,
    industry: yahooProfile?.industry || null,
    employees: yahooProfile?.employees || null,
    website: yahooProfile?.website || profile?.weburl || null,
    country: yahooProfile?.country || profile?.country || null,
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
      policyDecisions,
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
      news: companyNewsSource === 'finnhub'
        ? 'Finnhub (Real)'
        : companyNewsSource === 'yahoo-fallback'
          ? 'Yahoo Finance (Real fallback)'
          : 'No news found',
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

  const startNews = Date.now();
  const isAsx = ticker.toUpperCase().endsWith('.AX');
  
  const [yahooNews, macroNews, shortMetrics, fedDecision, rbaDecision] = await Promise.all([
    (async () => {
      try {
        const companyName = priceMod.longName || priceMod.shortName || ticker;

        const startYahooNews = Date.now();
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
          source: n.publisher || 'Yahoo Finance',
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

        const allNews = dedupeArticlesByTitle([...ruleScoredYahoo, ...asxItems, ...googleItems]);

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
    (async () => {
      try {
        return await withTimeout(fetchLatestCentralBankDecision('FED'), ENRICHMENT_TIMEOUT_MS, `FED rate decision fetch for ${ticker}`);
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        return await withTimeout(fetchLatestCentralBankDecision('RBA'), ENRICHMENT_TIMEOUT_MS, `RBA rate decision fetch for ${ticker}`);
      } catch {
        return null;
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
    description: (sp.longBusinessSummary || '').substring(0, 500) || null,
    sector: sp.sector || sp.industry || 'Unknown',
    industry: sp.industry || null,
    currency: priceMod.currency || 'USD',
    exchange: priceMod.exchangeName || '',
    employees: sp.fullTimeEmployees || null,
    website: sp.website || null,
    country: sp.country || null,
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
      policyDecisions: { fed: fedDecision, rba: rbaDecision },
    }),
    priceHistory,
    priceHistorySource: 'yahoo-finance-history',
    technicalIndicators: calculateAllIndicators(priceHistory),
    collectedAt: new Date().toISOString(),
    dataSource: 'yahoo-finance',
    fallbackReason: null,
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

  let finnhubProfile = null;
  let finnhubMetrics = null;
  let finnhubNews = [];
  let finnhubRecommendations = null;
  let finnhubPriceTarget = null;

  let finnhubMacroNews = [];
  let newsApiMacroNews = [];
  let fedDecision = null;
  let rbaDecision = null;

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
      withTimeout(fetchLatestCentralBankDecision('FED'), ENRICHMENT_TIMEOUT_MS, `FED rate decision fetch for ${ticker}`),
      withTimeout(fetchLatestCentralBankDecision('RBA'), ENRICHMENT_TIMEOUT_MS, `RBA rate decision fetch for ${ticker}`),
    ]);

    finnhubProfile = enrichmentResults[0].status === 'fulfilled' ? enrichmentResults[0].value : null;
    finnhubMetrics = enrichmentResults[1].status === 'fulfilled' ? enrichmentResults[1].value : null;
    finnhubNews = enrichmentResults[2].status === 'fulfilled' ? enrichmentResults[2].value : [];
    finnhubRecommendations = enrichmentResults[3].status === 'fulfilled' ? enrichmentResults[3].value : null;
    finnhubPriceTarget = enrichmentResults[4].status === 'fulfilled' ? enrichmentResults[4].value : null;
    finnhubMacroNews = enrichmentResults[5].status === 'fulfilled' ? enrichmentResults[5].value : [];
    newsApiMacroNews = enrichmentResults[6].status === 'fulfilled' ? enrichmentResults[6].value : [];
    fedDecision = enrichmentResults[7].status === 'fulfilled' ? enrichmentResults[7].value : null;
    rbaDecision = enrichmentResults[8].status === 'fulfilled' ? enrichmentResults[8].value : null;
  } else {
    const [finnhubMacroNewsResult, newsApiMacroNewsResult, fedDecisionResult, rbaDecisionResult] = await Promise.allSettled([
      withTimeout(fetchFinnhubMacroNews(), ENRICHMENT_TIMEOUT_MS, `Finnhub macro news for ${ticker}`),
      withTimeout(fetchNewsApiMacroNews(), ENRICHMENT_TIMEOUT_MS, `NewsAPI macro news for ${ticker}`),
      withTimeout(fetchLatestCentralBankDecision('FED'), ENRICHMENT_TIMEOUT_MS, `FED rate decision fetch for ${ticker}`),
      withTimeout(fetchLatestCentralBankDecision('RBA'), ENRICHMENT_TIMEOUT_MS, `RBA rate decision fetch for ${ticker}`),
    ]);
    finnhubMacroNews = finnhubMacroNewsResult.status === 'fulfilled' ? finnhubMacroNewsResult.value : [];
    newsApiMacroNews = newsApiMacroNewsResult.status === 'fulfilled' ? newsApiMacroNewsResult.value : [];
    fedDecision = fedDecisionResult.status === 'fulfilled' ? fedDecisionResult.value : null;
    rbaDecision = rbaDecisionResult.status === 'fulfilled' ? rbaDecisionResult.value : null;
  }

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

  const news = Array.isArray(finnhubNews) && finnhubNews.length > 0 ? finnhubNews : [];
  const sentimentScore = news.length > 0
    ? parseFloat((news.reduce((sum, n) => sum + (n.sentiment || 0), 0) / news.length).toFixed(2))
    : 0;
  const sentimentLabel = sentimentScore > 0.3 ? 'BULLISH' : sentimentScore < -0.3 ? 'BEARISH' : 'NEUTRAL';

  const consensus = finnhubRecommendations || {
    strongBuy: 0,
    buy: 0,
    hold: 0,
    sell: 0,
    strongSell: 0,
  };

  let targetHigh, targetLow, targetMean;
  if (finnhubPriceTarget && finnhubPriceTarget.targetHigh > 0 && finnhubPriceTarget.targetLow > 0) {
    targetHigh = finnhubPriceTarget.targetHigh;
    targetLow = finnhubPriceTarget.targetLow;
    targetMean = finnhubPriceTarget.targetMean || (targetHigh + targetLow) / 2;
  } else {
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
      policyDecisions: { fed: fedDecision, rba: rbaDecision },
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

module.exports = {
  fetchFinnhubMarketData,
  fetchYahooFinanceData,
  fetchAlphaVantageMarketData,
};
