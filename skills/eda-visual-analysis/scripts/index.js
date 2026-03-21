const { callDeepSeek } = require('../../../backend/lib/llm');
const { loadSkills } = require('../../../backend/lib/skill-loader');
const { computeMovingAverage, parseJsonResponse, requireObject } = require('../../../backend/lib/utils');

const skills = loadSkills();

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function computeEdaFactors(marketData) {
  const priceHistory = Array.isArray(marketData?.priceHistory) ? marketData.priceHistory : [];
  const closes = priceHistory.map((bar) => safeNumber(bar.close)).filter((value) => value > 0);
  if (closes.length < 25) {
    return {
      available: false,
      breakoutSignal: 'NEUTRAL',
      breakout20Pct: 0,
      volumeRegime: 'NORMAL',
      volumeRatio: 1,
      volatilityRegime: 'NORMAL',
      volatility20: 0,
      trendStrengthPct: 0,
      trendStrengthSignal: 'NEUTRAL',
    };
  }

  const currentPrice = safeNumber(marketData.price, closes[closes.length - 1]);
  const prev20 = closes.slice(-21, -1);
  const highest20 = Math.max(...prev20);
  const lowest20 = Math.min(...prev20);
  const breakout20Pct = highest20 > 0 ? ((currentPrice - highest20) / highest20) * 100 : 0;
  const breakdown20Pct = lowest20 > 0 ? ((currentPrice - lowest20) / lowest20) * 100 : 0;

  const breakoutSignal = breakout20Pct > 1
    ? 'BULLISH_BREAKOUT'
    : breakdown20Pct < -1
      ? 'BEARISH_BREAKDOWN'
      : 'NEUTRAL';

  const volumeRatioRaw = safeNumber(marketData.volume) / Math.max(1, safeNumber(marketData.avgVolume, 1));
  const volumeRatio = parseFloat(volumeRatioRaw.toFixed(2));
  const volumeRegime = volumeRatio >= 1.3 ? 'HIGH' : volumeRatio <= 0.7 ? 'LOW' : 'NORMAL';

  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  const recentReturns = returns.slice(-20);
  const mean = recentReturns.length > 0
    ? recentReturns.reduce((sum, value) => sum + value, 0) / recentReturns.length
    : 0;
  const variance = recentReturns.length > 0
    ? recentReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / recentReturns.length
    : 0;
  const volatility20 = parseFloat((Math.sqrt(Math.max(0, variance)) * Math.sqrt(252) * 100).toFixed(2));
  const volatilityRegime = volatility20 > 40 ? 'HIGH' : volatility20 < 18 ? 'LOW' : 'NORMAL';

  const ma20 = safeNumber(marketData.ma20);
  const ma50 = safeNumber(marketData.ma50);
  const trendStrengthPct = ma50 > 0 ? parseFloat((((ma20 - ma50) / ma50) * 100).toFixed(2)) : 0;
  const trendStrengthSignal = trendStrengthPct > 2 ? 'STRONG_UP' : trendStrengthPct < -2 ? 'STRONG_DOWN' : 'NEUTRAL';

  return {
    available: true,
    breakoutSignal,
    breakout20Pct: parseFloat(breakout20Pct.toFixed(2)),
    volumeRegime,
    volumeRatio,
    volatilityRegime,
    volatility20,
    trendStrengthPct,
    trendStrengthSignal,
  };
}

function buildCharts(marketData) {
  const { priceHistory, analystConsensus, ticker } = marketData;
  const labels = priceHistory.map((day) => day.date.slice(5));
  const prices = priceHistory.map((day) => day.close);
  const volumes = priceHistory.map((day) => day.volume);
  const ma10 = computeMovingAverage(prices, 10);
  const ma20 = computeMovingAverage(prices, 20);
  const avgVolumeSeries = prices.map(() => marketData.avgVolume);
  const sourceBuckets = (marketData.news || []).reduce((accumulator, headline) => {
    const source = String(headline?.source || 'Unknown').trim() || 'Unknown';
    const sentiment = safeNumber(headline?.sentiment, 0);
    if (!accumulator[source]) {
      accumulator[source] = { sum: 0, count: 0 };
    }
    accumulator[source].sum += sentiment;
    accumulator[source].count += 1;
    return accumulator;
  }, {});
  const sentimentSources = Object.keys(sourceBuckets);
  const sentimentBySource = sentimentSources.map((source) => {
    const bucket = sourceBuckets[source];
    return bucket.count > 0 ? parseFloat((bucket.sum / bucket.count).toFixed(2)) : 0;
  });

  return {
    priceChart: {
      type: 'line',
      title: `${ticker} - 30-Day Price & Moving Averages`,
      data: {
        labels,
        datasets: [
          { label: 'Price', data: prices, borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.08)', tension: 0.3, fill: true, pointRadius: 0 },
          { label: 'MA10', data: ma10, borderColor: '#f59e0b', borderDash: [4, 4], tension: 0.3, pointRadius: 0, fill: false },
          { label: 'MA20', data: ma20, borderColor: '#10b981', borderDash: [8, 4], tension: 0.3, pointRadius: 0, fill: false },
        ],
      },
    },
    volumeChart: {
      type: 'bar',
      title: `${ticker} - Volume Analysis`,
      data: {
        labels,
        datasets: [
          { label: 'Volume', data: volumes, backgroundColor: volumes.map((volume) => (volume > marketData.avgVolume * 1.3 ? 'rgba(239,68,68,0.7)' : 'rgba(0,212,255,0.4)')) },
          { label: 'Avg Volume', data: avgVolumeSeries, type: 'line', borderColor: '#f59e0b', borderDash: [5, 5], pointRadius: 0, fill: false },
        ],
      },
    },
    analystChart: {
      type: 'doughnut',
      title: `${ticker} - Analyst Consensus`,
      data: {
        labels: ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'],
        datasets: [{
          data: [
            analystConsensus.strongBuy,
            analystConsensus.buy,
            analystConsensus.hold,
            analystConsensus.sell,
            analystConsensus.strongSell,
          ],
          backgroundColor: ['#10b981', '#6ee7b7', '#f59e0b', '#f87171', '#dc2626'],
          borderWidth: 2,
          borderColor: '#0a0f1e',
        }],
      },
    },
    sentimentChart: {
      type: 'bar',
      title: `${ticker} - News Sentiment by Source`,
      data: {
        labels: sentimentSources,
        datasets: [{
          label: 'Avg Sentiment Score',
          data: sentimentBySource,
          backgroundColor: sentimentBySource.map((value) => (value > 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)')),
        }],
      },
    },
  };
}

function buildFallbackInsights(marketData) {
  const edaFactors = computeEdaFactors(marketData);
  return {
    insights: [
      `RSI at ${marketData.rsi} - ${marketData.rsi > 70 ? 'overbought territory' : marketData.rsi < 30 ? 'oversold territory' : 'healthy range'}`,
      `Price is ${((marketData.price / marketData.ma50 - 1) * 100).toFixed(1)}% above MA50`,
      `Sentiment score of ${marketData.sentimentScore} indicates ${marketData.sentimentLabel} market mood`,
      `Analyst upside potential: ${marketData.analystConsensus.upside}%`,
    ],
    riskFlags: marketData.rsi > 70 ? ['Overbought - potential pullback risk'] : [],
    technicalSummary: `${marketData.ticker} shows a ${marketData.trend} trend with RSI at ${marketData.rsi}.`,
    momentumSignal: marketData.changePercent > 0 ? 'POSITIVE' : 'NEGATIVE',
    edaFactors,
  };
}

function normalizeMomentumSignal(value, fallbackValue = 'NEUTRAL') {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return fallbackValue;

  if (['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(raw)) {
    return raw;
  }

  if (/BULL|UP|STRONG_UP|RISING|GAIN/.test(raw)) {
    return 'POSITIVE';
  }
  if (/BEAR|DOWN|STRONG_DOWN|FALL|LOSS/.test(raw)) {
    return 'NEGATIVE';
  }
  if (/N\/A|NA|UNKNOWN|NONE/.test(raw)) {
    return fallbackValue;
  }

  return fallbackValue;
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEdaInsights(parsed, fallback) {
  const insights = Array.isArray(parsed?.insights)
    ? parsed.insights.map((item) => sanitizeText(item)).filter(Boolean).slice(0, 6)
    : [];

  const riskFlags = Array.isArray(parsed?.riskFlags)
    ? parsed.riskFlags.map((item) => sanitizeText(item)).filter(Boolean).slice(0, 6)
    : [];

  const technicalSummary = sanitizeText(parsed?.technicalSummary) || fallback.technicalSummary;
  const momentumSignal = normalizeMomentumSignal(parsed?.momentumSignal, fallback.momentumSignal);

  return {
    insights: insights.length > 0 ? insights : fallback.insights,
    riskFlags,
    technicalSummary,
    momentumSignal,
    edaFactors: fallback.edaFactors,
  };
}

async function runEdaVisualAnalysis({ marketData }, dependencies = {}) {
  requireObject(marketData, 'marketData');

  const charts = buildCharts(marketData);
  const fallback = buildFallbackInsights(marketData);
  const llm = dependencies.callDeepSeek || callDeepSeek;
  const systemPrompt = `You are a quantitative analyst running the eda-visual-analysis skill.\n\n${skills['eda-visual-analysis']}\n\nAnalyze the market data and provide key EDA insights as JSON only. Do not include markdown, tables, explanations, or code fences.`;
  const userMessage = `Provide EDA insights for ${marketData.ticker}. Return JSON with: insights (array of 4 key observations), riskFlags (array of strings), technicalSummary (1-2 sentences), momentumSignal (POSITIVE/NEGATIVE/NEUTRAL).\n\nContext:\n- Price=${marketData.price}, Change%=${marketData.changePercent}, RSI=${marketData.rsi}, Trend=${marketData.trend}\n- MA20=${marketData.ma20}, MA50=${marketData.ma50}, MA200=${marketData.ma200}\n- SentimentScore=${marketData.sentimentScore}, SentimentLabel=${marketData.sentimentLabel}\n- MacroRisk=${marketData.macroContext?.riskLevel || 'N/A'}, MacroTone=${marketData.macroContext?.sentimentLabel || 'N/A'}\n- MacroContext=${marketData.macroContext?.marketContext || 'N/A'}\n- TopNews=${(marketData.news || []).slice(0, 5).map((item) => `${item.title} [${item.sentiment}]`).join(' | ')}\n- Indicators=${JSON.stringify(marketData.technicalIndicators || {}, null, 2)}`;

  try {
    const analysis = await llm(systemPrompt, userMessage);
    const parsed = parseJsonResponse(analysis, {});
    const edaInsights = normalizeEdaInsights(parsed, fallback);
    return { charts, edaInsights, skillUsed: 'eda-visual-analysis' };
  } catch {
    return { charts, edaInsights: fallback, skillUsed: 'eda-visual-analysis' };
  }
}

module.exports = {
  buildCharts,
  runEdaVisualAnalysis,
};