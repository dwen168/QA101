const { callDeepSeek } = require('../../../backend/lib/llm');
const { loadSkills } = require('../../../backend/lib/skill-loader');
const { parseJsonResponse, requireObject } = require('../../../backend/lib/utils');
const { getSignalWeight, getWeightsMetadata } = require('../../../backend/lib/weights-loader');
const { calculateATR, calculateVaR } = require('../../../backend/lib/technical-indicators');

const skills = loadSkills();

// Rolling RSI helper for historical pattern scan
function computeRollingRSI(closes, period) {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = losses === 0 ? 100 : (gains / period) / (losses / period);
  return parseFloat((100 - 100 / (1 + rs)).toFixed(1));
}

// Find past setups matching current RSI zone + MA50 position, report next 5/10d returns
function findHistoricalPatterns(priceHistory, marketData) {
  if (!priceHistory || priceHistory.length < 30) return null;
  const closes = priceHistory.map(d => d.close);
  const curRsiZone = marketData.rsi > 70 ? 'OB' : marketData.rsi < 30 ? 'OS' : 'N';
  const curVsMA50 = marketData.price > marketData.ma50 ? 'ABOVE' : 'BELOW';
  const LOOKAHEAD = 10;
  const raw = [];

  for (let i = 20; i <= closes.length - LOOKAHEAD - 1; i++) {
    const slice = closes.slice(0, i + 1);
    const rsi = computeRollingRSI(slice, 14);
    if (rsi === null) continue;
    const ma50Slice = slice.slice(-50);
    const ma50 = ma50Slice.reduce((s, v) => s + v, 0) / ma50Slice.length;
    const histPrice = slice[slice.length - 1];
    const histRsiZone = rsi > 70 ? 'OB' : rsi < 30 ? 'OS' : 'N';
    const histVsMA50 = histPrice > ma50 ? 'ABOVE' : 'BELOW';
    if (histRsiZone === curRsiZone && histVsMA50 === curVsMA50) {
      raw.push({
        i, date: priceHistory[i].date, rsi, priceVsMA50: histVsMA50,
        entryPrice: parseFloat(histPrice.toFixed(2)),
        return5d: parseFloat(((closes[i + 5] - histPrice) / histPrice * 100).toFixed(1)),
        return10d: parseFloat(((closes[i + LOOKAHEAD] - histPrice) / histPrice * 100).toFixed(1)),
      });
    }
  }

  // Deduplicate: at least 5 bars between retained matches
  const dedup = [];
  let lastIdx = -99;
  for (const m of raw) {
    if (m.i - lastIdx >= 5) {
      const { i, ...rest } = m; // eslint-disable-line no-unused-vars
      dedup.push(rest);
      lastIdx = m.i;
    }
  }
  if (dedup.length === 0) return null;

  const rsiLabel = curRsiZone === 'OB' ? 'Overbought' : curRsiZone === 'OS' ? 'Oversold' : 'Neutral';
  const wins5 = dedup.filter(m => m.return5d > 0).length;
  const wins10 = dedup.filter(m => m.return10d > 0).length;
  return {
    pattern: `RSI ${rsiLabel} + Price ${curVsMA50} MA50`,
    lookbackDays: priceHistory.length,
    instances: dedup.slice(-5),
    summary: {
      count: dedup.length,
      avg5d: parseFloat((dedup.reduce((s, m) => s + m.return5d, 0) / dedup.length).toFixed(1)),
      avg10d: parseFloat((dedup.reduce((s, m) => s + m.return10d, 0) / dedup.length).toFixed(1)),
      winRate5d: `${Math.round(wins5 / dedup.length * 100)}%`,
      winRate10d: `${Math.round(wins10 / dedup.length * 100)}%`,
    },
  };
}

function scoreSignals(marketData) {
  const signals = [];
  let score = 0;

  const macroWeight = (key, fallback) => {
    const value = getSignalWeight(key);
    return value === 0 ? fallback : value;
  };

  // detail: { label, value } pairs shown as chips in the UI
  const add = (name, points, reason, detail = null) => {
    signals.push({ name, points, reason, detail });
    score += points;
  };

  const fmt = (n, digits = 2) => (n == null ? '—' : Number(n).toFixed(digits));
  const w = (key) => getSignalWeight(key);

  const p = marketData.price;
  const ma50 = marketData.ma50;
  const ma200 = marketData.ma200;
  const pctVsMa50 = ma50 ? ((p - ma50) / ma50 * 100) : 0;
  const pctVsMa200 = ma200 ? ((p - ma200) / ma200 * 100) : 0;

  // Trend signals
  if (p > ma50) {
    add('Price > MA50', w('trend_ma50_bullish'), 'Bullish trend confirmation', [
      { label: 'Price', value: `$${fmt(p)}` },
      { label: 'MA50', value: `$${fmt(ma50)}` },
      { label: 'Gap', value: `+${fmt(pctVsMa50, 1)}%` },
    ]);
  } else {
    add('Price < MA50', w('trend_ma50_bearish'), 'Bearish trend - price below medium-term average', [
      { label: 'Price', value: `$${fmt(p)}` },
      { label: 'MA50', value: `$${fmt(ma50)}` },
      { label: 'Gap', value: `${fmt(pctVsMa50, 1)}%` },
    ]);
  }

  if (p > ma200) {
    add('Price > MA200', w('trend_ma200_bullish'), 'Long-term uptrend intact', [
      { label: 'Price', value: `$${fmt(p)}` },
      { label: 'MA200', value: `$${fmt(ma200)}` },
      { label: 'Gap', value: `+${fmt(pctVsMa200, 1)}%` },
    ]);
  } else {
    add('Price < MA200', w('trend_ma200_bearish'), 'Long-term downtrend', [
      { label: 'Price', value: `$${fmt(p)}` },
      { label: 'MA200', value: `$${fmt(ma200)}` },
      { label: 'Gap', value: `${fmt(pctVsMa200, 1)}%` },
    ]);
  }

  // RSI signals
  const rsi = marketData.rsi;
  if (rsi > 70) {
    add('RSI Overbought', w('rsi_overbought'), `RSI > 70 — overextended`, [
      { label: 'RSI', value: fmt(rsi, 1) },
      { label: 'Zone', value: 'Overbought (>70)' },
    ]);
  } else if (rsi < 30) {
    add('RSI Oversold', w('rsi_oversold'), `RSI < 30 — contrarian buy signal`, [
      { label: 'RSI', value: fmt(rsi, 1) },
      { label: 'Zone', value: 'Oversold (<30)' },
    ]);
  } else if (rsi >= 45 && rsi <= 65) {
    add('RSI Healthy', w('rsi_healthy'), `RSI in bullish healthy zone (45–65)`, [
      { label: 'RSI', value: fmt(rsi, 1) },
      { label: 'Zone', value: '45–65 Healthy' },
    ]);
  }

  // Sentiment signals
  const sent = marketData.sentimentScore;
  if (sent > 0.3) {
    add('Positive Sentiment', w('sentiment_bullish'), `News sentiment bullish`, [
      { label: 'Score', value: `+${fmt(sent, 2)}` },
      { label: 'Label', value: marketData.sentimentLabel },
    ]);
  } else if (sent < -0.3) {
    add('Negative Sentiment', w('sentiment_bearish'), `News sentiment bearish`, [
      { label: 'Score', value: fmt(sent, 2) },
      { label: 'Label', value: marketData.sentimentLabel },
    ]);
  }

  // Macro regime overlay signals
  const macro = marketData.macroContext;
  if (macro && macro.available) {
    const macroThemes = (macro.dominantThemes || []).map((item) => item.theme);
    const macroRisk = String(macro.riskLevel || 'MEDIUM').toUpperCase();
    const macroSent = Number(macro.sentimentScore || 0);

    if (macroRisk === 'HIGH') {
      add('Macro Risk-Off', macroWeight('macro_risk_high', -2), 'Global macro backdrop is risk-off; tighten conviction.', [
        { label: 'Risk', value: macroRisk },
        { label: 'Tone', value: macro.sentimentLabel || 'RISK_OFF' },
        { label: 'Score', value: fmt(macroSent, 2) },
      ]);
    } else if (macroRisk === 'LOW') {
      add('Macro Tailwind', macroWeight('macro_risk_low', 1), 'Macro backdrop is supportive for risk assets.', [
        { label: 'Risk', value: macroRisk },
        { label: 'Tone', value: macro.sentimentLabel || 'RISK_ON' },
        { label: 'Score', value: fmt(macroSent, 2) },
      ]);
    }

    if (macroSent <= -0.25) {
      add('Macro Sentiment Bearish', macroWeight('macro_sentiment_bearish', -1), 'Global macro headlines lean defensive.', [
        { label: 'Score', value: fmt(macroSent, 2) },
        { label: 'Themes', value: macroThemes.slice(0, 2).join(', ') || 'General' },
      ]);
    } else if (macroSent >= 0.25) {
      add('Macro Sentiment Supportive', macroWeight('macro_sentiment_bullish', 1), 'Global macro sentiment supports risk-taking.', [
        { label: 'Score', value: `+${fmt(macroSent, 2)}` },
        { label: 'Themes', value: macroThemes.slice(0, 2).join(', ') || 'General' },
      ]);
    }

    const sector = String(marketData.sector || 'Unknown');
    const sectorThemeHints = {
      Technology: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'MONETARY_POLICY'],
      Semiconductors: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'GEOPOLITICS'],
      Financials: ['MONETARY_POLICY', 'MARKET_STRESS', 'POLITICS_POLICY'],
      Energy: ['ENERGY_COMMODITIES', 'GEOPOLITICS', 'POLITICS_POLICY'],
      'Automotive/EV': ['SUPPLY_CHAIN', 'ENERGY_COMMODITIES', 'POLITICS_POLICY'],
      Industrials: ['SUPPLY_CHAIN', 'GEOPOLITICS', 'ENERGY_COMMODITIES'],
      Healthcare: ['POLITICS_POLICY', 'MARKET_STRESS'],
    };
    const overlapThemes = (sectorThemeHints[sector] || []).filter((theme) => macroThemes.includes(theme));
    if (macroRisk === 'HIGH' && overlapThemes.length) {
      add('Macro-Sector Headwind', macroWeight('macro_sector_headwind', -1), `Current macro themes directly pressure ${sector}.`, [
        { label: 'Sector', value: sector },
        { label: 'Themes', value: overlapThemes.join(', ') },
      ]);
    }
  }

  // Analyst consensus signals
  const consensus = marketData.analystConsensus;
  const totalRatings = consensus.strongBuy + consensus.buy + consensus.hold + consensus.sell + consensus.strongSell;
  const buyRatio = totalRatings === 0 ? 0 : (consensus.strongBuy + consensus.buy) / totalRatings;

  if (buyRatio > 0.6) {
    add('Strong Analyst Buy', w('analyst_strong_buy'), `Majority of analysts rate Buy or Strong Buy`, [
      { label: 'Buy%', value: `${(buyRatio * 100).toFixed(0)}%` },
      { label: 'Ratings', value: `${consensus.strongBuy + consensus.buy}B / ${consensus.hold}H / ${consensus.sell + consensus.strongSell}S` },
    ]);
  } else if (buyRatio < 0.3) {
    add('Weak Analyst Support', w('analyst_weak_support'), `Few analysts rate Buy`, [
      { label: 'Buy%', value: `${(buyRatio * 100).toFixed(0)}%` },
      { label: 'Ratings', value: `${consensus.strongBuy + consensus.buy}B / ${consensus.hold}H / ${consensus.sell + consensus.strongSell}S` },
    ]);
  }

  if (consensus.upside > 10) {
    add('Analyst Upside', w('analyst_upside'), `Analyst targets above current price`, [
      { label: 'Upside', value: `+${fmt(consensus.upside, 1)}%` },
      { label: 'Target', value: `$${fmt(consensus.targetMean)}` },
      { label: 'Range', value: `$${fmt(consensus.targetLow)}–$${fmt(consensus.targetHigh)}` },
    ]);
  } else if (consensus.upside < -5) {
    add('Downside Risk', w('analyst_downside'), `Analyst targets below current price`, [
      { label: 'Downside', value: `${fmt(consensus.upside, 1)}%` },
      { label: 'Target', value: `$${fmt(consensus.targetMean)}` },
    ]);
  }

  // Daily momentum signals
  const chg = marketData.changePercent;
  if (chg > 1.5) {
    add('Strong Daily Momentum', w('momentum_strong_up'), `Up ${fmt(chg, 1)}% today`, [
      { label: 'Change', value: `+${fmt(chg, 2)}%` },
      { label: 'Price Δ', value: `+$${fmt(marketData.change, 2)}` },
      { label: 'Volume', value: `${(marketData.volume / 1e6).toFixed(1)}M` },
    ]);
  } else if (chg < -2) {
    add('Bearish Day', w('momentum_strong_down'), `Down ${fmt(Math.abs(chg), 1)}% today`, [
      { label: 'Change', value: `${fmt(chg, 2)}%` },
      { label: 'Price Δ', value: `$${fmt(marketData.change, 2)}` },
      { label: 'Volume', value: `${(marketData.volume / 1e6).toFixed(1)}M` },
    ]);
  }

  // Technical Indicators scoring (if available)
  if (marketData.technicalIndicators && marketData.technicalIndicators.available) {
    const ti = marketData.technicalIndicators;

    // MACD signal
    if (ti.macd) {
      if (ti.macd.signal === 'BULLISH') {
        add('MACD Bullish', w('macd_bullish'), `MACD above signal line — momentum positive`, [
          { label: 'MACD', value: fmt(ti.macd.macdLine, 3) },
          { label: 'Signal', value: fmt(ti.macd.signalLine, 3) },
          { label: 'Hist', value: `+${fmt(ti.macd.histogram, 3)}` },
        ]);
      } else if (ti.macd.signal === 'BEARISH') {
        add('MACD Bearish', w('macd_bearish'), `MACD below signal line — momentum negative`, [
          { label: 'MACD', value: fmt(ti.macd.macdLine, 3) },
          { label: 'Signal', value: fmt(ti.macd.signalLine, 3) },
          { label: 'Hist', value: fmt(ti.macd.histogram, 3) },
        ]);
      }
    }

    // Bollinger Bands signal
    if (ti.bollingerBands) {
      const bb = ti.bollingerBands;
      if (bb.signal === 'OVERBOUGHT') {
        add('BB Overbought', w('bb_overbought'), `Price near upper Bollinger Band — pullback risk`, [
          { label: 'BB%', value: `${(bb.bbPosition * 100).toFixed(0)}%` },
          { label: 'Upper', value: `$${fmt(bb.upperBand)}` },
          { label: 'Mid', value: `$${fmt(bb.middleBand)}` },
          { label: 'StdDev', value: fmt(bb.stdDev, 2) },
        ]);
      } else if (bb.signal === 'OVERSOLD') {
        add('BB Oversold', w('bb_oversold'), `Price near lower Bollinger Band — bounce opportunity`, [
          { label: 'BB%', value: `${(bb.bbPosition * 100).toFixed(0)}%` },
          { label: 'Lower', value: `$${fmt(bb.lowerBand)}` },
          { label: 'Mid', value: `$${fmt(bb.middleBand)}` },
          { label: 'StdDev', value: fmt(bb.stdDev, 2) },
        ]);
      }
    }

    // KDJ signal
    if (ti.kdj) {
      if (ti.kdj.signal === 'OVERSOLD') {
        add('KDJ Oversold', w('kdj_oversold'), `KDJ in oversold territory — contrarian buy`, [
          { label: 'K', value: fmt(ti.kdj.k, 1) },
          { label: 'D', value: fmt(ti.kdj.d, 1) },
          { label: 'J', value: fmt(ti.kdj.j, 1) },
        ]);
      } else if (ti.kdj.signal === 'OVERBOUGHT') {
        add('KDJ Overbought', w('kdj_overbought'), `KDJ in overbought territory — potential pullback`, [
          { label: 'K', value: fmt(ti.kdj.k, 1) },
          { label: 'D', value: fmt(ti.kdj.d, 1) },
          { label: 'J', value: fmt(ti.kdj.j, 1) },
        ]);
      }
    }

    // OBV signal
    if (ti.obv) {
      if (ti.obv.signal === 'BULLISH') {
        add('OBV Rising', w('obv_bullish'), `Volume confirms uptrend`, [
          { label: 'OBV', value: (ti.obv.obv / 1e6).toFixed(1) + 'M' },
          { label: 'Trend', value: 'Rising' },
        ]);
      } else if (ti.obv.signal === 'BEARISH') {
        add('OBV Falling', w('obv_bearish'), `Volume confirms downtrend`, [
          { label: 'OBV', value: (ti.obv.obv / 1e6).toFixed(1) + 'M' },
          { label: 'Trend', value: 'Falling' },
        ]);
      }
    }

    // VWAP signal
    if (ti.vwap) {
      const vwapGap = ti.vwap.vwap ? ((p - ti.vwap.vwap) / ti.vwap.vwap * 100) : null;
      if (ti.vwap.signal === 'ABOVE_VWAP') {
        add('Price > VWAP', w('vwap_above'), `Price above VWAP — bullish intraday positioning`, [
          { label: 'Price', value: `$${fmt(p)}` },
          { label: 'VWAP', value: `$${fmt(ti.vwap.vwap)}` },
          { label: 'Gap', value: vwapGap != null ? `+${fmt(vwapGap, 1)}%` : '—' },
        ]);
      } else if (ti.vwap.signal === 'BELOW_VWAP') {
        add('Price < VWAP', w('vwap_below'), `Price below VWAP — bearish intraday positioning`, [
          { label: 'Price', value: `$${fmt(p)}` },
          { label: 'VWAP', value: `$${fmt(ti.vwap.vwap)}` },
          { label: 'Gap', value: vwapGap != null ? `${fmt(vwapGap, 1)}%` : '—' },
        ]);
      }
    }
  }

  return { signals, score, buyRatio };
}

function mapAction(score) {
  if (score >= 6) {
    return { action: 'STRONG BUY', actionColor: '#10b981' };
  }
  if (score >= 3) {
    return { action: 'BUY', actionColor: '#6ee7b7' };
  }
  if (score >= -2) {
    return { action: 'HOLD', actionColor: '#f59e0b' };
  }
  if (score >= -5) {
    return { action: 'SELL', actionColor: '#f87171' };
  }
  return { action: 'STRONG SELL', actionColor: '#dc2626' };
}

function buildFallbackRecommendation(marketData, action, signals, confidence, buyRatio) {
  const macro = marketData?.macroContext || {};
  const macroSentence = macro.available
    ? `Macro regime is ${String(macro.riskLevel || 'MEDIUM').toLowerCase()} risk (${macro.sentimentLabel || 'BALANCED'}), which is included in signal scoring.`
    : 'Macro regime data is limited, so conviction relies more on ticker-level signals.';

  const keyRisks = ['Market volatility', 'Sector headwinds', 'RSI extended'];
  if (macro.riskLevel === 'HIGH') {
    keyRisks.unshift('Elevated macro and geopolitical risk regime');
  }

  return {
    rationale: `Based on technical, sentiment, and macro regime analysis, ${marketData.ticker} shows a ${marketData.trend} setup with ${marketData.rsi > 50 ? 'positive' : 'weakening'} momentum. Analyst consensus supports the view with ${(buyRatio * 100).toFixed(0)}% buy ratings. ${macroSentence}`,
    timeHorizon: 'MEDIUM',
    keyRisks,
    executiveSummary: `${marketData.ticker} - ${action} recommendation based on ${signals.length} signals with ${confidence}% confidence.`,
  };
}

async function runTradeRecommendation({ marketData, edaInsights }, dependencies = {}) {
  requireObject(marketData, 'marketData');

  const { signals, score, buyRatio } = scoreSignals(marketData);
  const { action, actionColor } = mapAction(score);
  const baseConfidence = Math.min(95, Math.floor((Math.abs(score) / 12) * 100 + 40));
  const macroRisk = String(marketData?.macroContext?.riskLevel || '').toUpperCase();
  const confidence = macroRisk === 'HIGH'
    ? Math.max(35, baseConfidence - 8)
    : macroRisk === 'LOW'
      ? Math.min(95, baseConfidence + 3)
      : baseConfidence;

  const entry = marketData.price;

  // Risk metrics - using 14-day ATR and VaR
  let atr = null;
  let varMetrics = null;
  let stopLoss = entry * 0.95;  // Default 5% fallback
  let takeProfit = entry * 1.10; // Default 10% fallback

  if (marketData.priceHistory && marketData.priceHistory.length >= 15) {
    // Use 14-day ATR instead of 52-week range-based ATR
    atr = calculateATR(marketData.priceHistory, 14);
    if (atr && atr > 0) {
      stopLoss = parseFloat((entry - atr * 1.5).toFixed(2));
      takeProfit = parseFloat((entry + atr * 2.5).toFixed(2));
    }

    // Calculate Value at Risk (95% confidence)
    varMetrics = calculateVaR(marketData.priceHistory, 0.95);
  }

  const riskReward = stopLoss > 0 ? parseFloat(((takeProfit - entry) / (entry - stopLoss)).toFixed(1)) : 0;

  const llm = dependencies.callDeepSeek || callDeepSeek;
  const systemPrompt = `You are a senior quantitative analyst running the trade-recommendation skill.\n\n${skills['trade-recommendation']}\n\nSynthesize all signals and write a clear trade recommendation.`;
  const userMessage = `Write a trade recommendation for ${marketData.ticker}. Action: ${action}. Score: ${score}. Key signals: ${signals.map((signal) => `${signal.name}(${signal.points > 0 ? '+' : ''}${signal.points})`).join(', ')}. Return JSON with: rationale (2-3 sentences), timeHorizon (SHORT/MEDIUM/LONG), keyRisks (array of 2-3 strings), executiveSummary (1 sentence plain English). Additional EDA context: ${JSON.stringify(edaInsights || {}, null, 2)}. Macro context: ${JSON.stringify(marketData.macroContext || {}, null, 2)}`;

  let llmRecommendation;
  try {
    const analysis = await llm(systemPrompt, userMessage);
    llmRecommendation = parseJsonResponse(analysis, buildFallbackRecommendation(marketData, action, signals, confidence, buyRatio));
  } catch {
    llmRecommendation = buildFallbackRecommendation(marketData, action, signals, confidence, buyRatio);
  }

  // Historical pattern matching
  const historicalPatterns = findHistoricalPatterns(marketData.priceHistory, marketData);

  // Get weights metadata for transparency
  const weightsMetadata = getWeightsMetadata();

  return {
    recommendation: {
      ticker: marketData.ticker,
      action,
      actionColor,
      confidence,
      score,
      signals,
      entry,
      stopLoss,
      takeProfit,
      riskReward,
      macroOverlay: {
        available: !!marketData?.macroContext?.available,
        riskLevel: marketData?.macroContext?.riskLevel || 'UNKNOWN',
        sentimentLabel: marketData?.macroContext?.sentimentLabel || 'UNKNOWN',
        dominantThemes: (marketData?.macroContext?.dominantThemes || []).slice(0, 3),
      },
      ...llmRecommendation,
      historicalPatterns,
      disclaimer: 'WARNING: For educational/demo purposes only. Not financial advice.',
    },
    riskMetrics: {
      atr14: atr,
      atrMultiplierSL: 1.5,
      atrMultiplierTP: 2.5,
      var95: varMetrics,
      riskWarnifVarExceeds: varMetrics ? {
        message: varMetrics.interpretation,
        maxDailyLoss: varMetrics.varPrice,
        maxDailyLossPercent: Math.abs(varMetrics.varPercent),
      } : null,
    },
    weightingMetadata: {
      version: weightsMetadata.version,
      timestamp: weightsMetadata.timestamp,
      calibrated: weightsMetadata.calibrated,
      metrics: weightsMetadata.metrics,
    },
    skillUsed: 'trade-recommendation',
  };
}

module.exports = {
  mapAction,
  runTradeRecommendation,
  scoreSignals,
};