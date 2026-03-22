const { calculateAllIndicators } = require('../../../../backend/lib/technical-indicators');
const { buildMacroContext } = require('./macro');

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

module.exports = {
  generateMockShortData,
  generateMockMarketData,
};
