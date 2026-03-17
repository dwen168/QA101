const { callDeepSeek } = require('../../../backend/lib/llm');
const { loadSkills } = require('../../../backend/lib/skill-loader');
const { normalizeTicker, parseJsonResponse } = require('../../../backend/lib/utils');
const config = require('../../../backend/lib/config');

const skills = loadSkills();

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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
  let syntheticPrice = base * 0.92;
  for (let index = 30; index >= 0; index -= 1) {
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
    priceHistory,
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

  const recentDatesAsc = allDates.slice(-31);
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

  // We only fetch price candles here; sentiment/news/consensus remain placeholders unless another provider is wired.
  const sentimentScore = 0;
  const targetHigh = price * 1.12;
  const targetLow = price * 0.9;
  const targetMean = (targetHigh + targetLow) / 2;

  return {
    ticker,
    name: `${ticker} Corp.`,
    sector: 'Unknown',
    price: parseFloat(price.toFixed(2)),
    prevClose: parseFloat(prevClose.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePercent: parseFloat(changePercent.toFixed(2)),
    volume: Math.floor(getVolume(latest)),
    avgVolume: Math.floor(avgVolume),
    high52w: parseFloat((Math.max(...highs)).toFixed(2)),
    low52w: parseFloat((Math.min(...lows)).toFixed(2)),
    marketCap: 0,
    pe: 0,
    eps: 0,
    ma20: parseFloat(ma20.toFixed(2)),
    ma50: parseFloat(ma50.toFixed(2)),
    ma200: parseFloat(ma200.toFixed(2)),
    rsi,
    trend,
    sentimentScore,
    sentimentLabel: 'NEUTRAL',
    analystConsensus: {
      strongBuy: 0,
      buy: 0,
      hold: 0,
      sell: 0,
      strongSell: 0,
      targetHigh: parseFloat(targetHigh.toFixed(2)),
      targetLow: parseFloat(targetLow.toFixed(2)),
      targetMean: parseFloat(targetMean.toFixed(2)),
      upside: parseFloat((((targetMean - price) / price) * 100).toFixed(1)),
    },
    news: [],
    priceHistory,
    collectedAt: new Date().toISOString(),
    dataSource: 'alpha-vantage',
  };
}

function buildFallbackAnalysis(ticker, marketData) {
  return {
    summary: `${ticker} is trading at $${marketData.price} with a ${marketData.trend} trend.`,
    keyTrends: [
      `RSI at ${marketData.rsi}`,
      `Sentiment: ${marketData.sentimentLabel}`,
      `Price vs MA50: ${((marketData.price / marketData.ma50 - 1) * 100).toFixed(1)}%`,
    ],
    riskFlags: [],
    marketContext: 'LLM analysis unavailable - check API key.',
  };
}

async function runMarketIntelligence({ ticker }, dependencies = {}) {
  const cleanTicker = normalizeTicker(ticker);
  let marketData;
  try {
    marketData = await fetchAlphaVantageMarketData(cleanTicker);
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