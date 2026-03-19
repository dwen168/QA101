/**
 * Backtesting Skill
 * =================
 * Simulates trading strategy on historical data and computes performance metrics.
 * 
 * Usage:
 *   runBacktest({
 *     ticker: 'AAPL',
 *     strategyName: 'trade-recommendation',
 *     startDate: '2025-01-01',
 *     endDate: '2026-03-18',
 *     initialCapital: 100000
 *   })
 */

const {
  calculateMACD,
  calculateBollingerBands,
} = require('../../../backend/lib/technical-indicators');

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// Fetch historical data from Alpha Vantage
async function fetchHistoricalData(ticker, apiKey) {
  try {
    const url = 'https://www.alphavantage.co/query';
    const params = new URLSearchParams({
      function: 'TIME_SERIES_DAILY_ADJUSTED',
      symbol: ticker,
      outputsize: 'full',
      apikey: apiKey,
    });

    const response = await fetch(`${url}?${params.toString()}`);
    if (!response.ok) {
      console.error('[Backtest] HTTP Error:', response.status);
      return null;
    }

    const data = await response.json();
    
    if (data['Error Message'] || data['Note']) {
      console.error('[Backtest] API Error:', data['Error Message'] || data['Note']);
      return null;
    }
    
    const timeSeries = data['Time Series (Daily)'] || {};
    const priceHistory = Object.entries(timeSeries)
      .map(([date, vals]) => ({
        date: new Date(date),
        open: parseFloat(vals['1. open']),
        high: parseFloat(vals['2. high']),
        low: parseFloat(vals['3. low']),
        close: parseFloat(vals['4. close']),
        volume: parseInt(vals['6. volume']),
      }))
      .sort((a, b) => a.date - b.date);
    
    return priceHistory;
  } catch (error) {
    console.error('[Backtest] Fetch error:', error.message);
    return null;
  }
}

function getRequiredWarmupBars(signalType) {
  if (signalType === 'rsi-ma') return 50;
  if (signalType === 'macd-bb') return 34;
  return 200;
}

// Generate trading signals (simplified trade-recommendation scoring)
function generateSignal(priceData, index, signalType = 'trade-recommendation') {
  const warmupBars = getRequiredWarmupBars(signalType);
  if (index < warmupBars) return 'HOLD';
  
  const current = priceData[index];
  const history = priceData.slice(0, index + 1);
  const closes = history.map(p => p.close);

  if (signalType === 'macd-bb') {
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes, 20);
    if (!macd || !bb) return 'HOLD';

    const bbPosition = (current.close - bb.lowerBand) / ((bb.upperBand - bb.lowerBand) || 1e-9);
    if (macd.signal === 'BULLISH' && bbPosition < 0.2) return 'BUY';
    if (macd.signal === 'BEARISH' && bbPosition > 0.8) return 'SELL';
    return 'HOLD';
  }

  if (signalType === 'rsi-ma') {
    const ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const rsi = calculateRSI(closes, 14);
    if (current.close > ma50 && rsi < 30) return 'BUY';
    if (current.close < ma50 && rsi > 70) return 'SELL';
    return 'HOLD';
  }

  let score = 0;
  
  // MA50 signal
  const ma50 = closes.slice(-50).reduce((a, b) => a + b) / 50;
  if (current.close > ma50) score += 2;
  else score -= 2;
  
  // MA200 signal
  if (history.length >= 200) {
    const ma200 = closes.slice(-200).reduce((a, b) => a + b) / 200;
    if (current.close > ma200) score += 1;
    else score -= 1;
  }
  
  // RSI signal
  const rsi = calculateRSI(closes, 14);
  if (rsi > 70) score -= 2;
  else if (rsi < 30) score += 1;
  else if (rsi >= 45 && rsi <= 65) score += 1;
  
  // MACD signal using standard MACD(12,26,9)
  const macd = calculateMACD(closes);
  if (macd) {
    if (macd.signal === 'BULLISH') score += 1;
    else if (macd.signal === 'BEARISH') score -= 1;
  }
  
  // Bollinger Bands signal
  const bb = calculateBollingerBands(closes, 20);
  if (bb) {
    const bbPosition = (current.close - bb.lower) / (bb.upper - bb.lower);
    if (bbPosition < 0.2) score += 1;
    else if (bbPosition > 0.8) score -= 1;
  }
  
  // Map score to action
  if (score >= 6) return 'STRONG_BUY';
  if (score >= 3) return 'BUY';
  if (score >= -2 && score <= 2) return 'HOLD';
  if (score <= -6) return 'STRONG_SELL';
  if (score <= -3) return 'SELL';
  
  return 'HOLD';
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;

  const recent = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const change = recent[i] - recent[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  gains /= period;
  losses /= period;
  
  const rs = gains / (losses + 1e-9);
  return 100 - (100 / (1 + rs));
}

// Simulate trading
function simulateTrades(priceData, signals, initialCapital, startTradingIndex = 0) {
  const trades = [];
  const equityCurve = [];

  let position = null; // { tradeId, entryIndex, entryPrice, entryDate, entrySignal }
  let capital = initialCapital;
  let nextTradeId = 1;

  for (let i = startTradingIndex; i < signals.length; i++) {
    const signal = signals[i];
    const current = priceData[i];
    let action = i === startTradingIndex ? 'START' : null;
    let actionMeta = {};
    let exitedThisBar = false;

    // Check exit conditions
    if (position) {
      const entryPrice = position.entryPrice;
      const currentPrice = current.close;
      const pnlPercent = (currentPrice - entryPrice) / entryPrice;

      // Stop-loss: -3%
      if (pnlPercent < -0.03) {
        const closedTrade = closeTrade(position, current, 'STOP_LOSS');
        action = 'SELL';
        actionMeta = { tradeId: closedTrade.tradeId, pnl: closedTrade.pnlDollars, reason: closedTrade.reason };
        exitedThisBar = true;
      }
      // Take-profit: +7%
      else if (pnlPercent > 0.07) {
        const closedTrade = closeTrade(position, current, 'TAKE_PROFIT');
        action = 'SELL';
        actionMeta = { tradeId: closedTrade.tradeId, pnl: closedTrade.pnlDollars, reason: closedTrade.reason };
        exitedThisBar = true;
      }
      // Sell signal
      else if (['SELL', 'STRONG_SELL'].includes(signal)) {
        const closedTrade = closeTrade(position, current, 'SELL_SIGNAL');
        action = 'SELL';
        actionMeta = { tradeId: closedTrade.tradeId, pnl: closedTrade.pnlDollars, reason: closedTrade.reason };
        exitedThisBar = true;
      }
    }

    // Check entry conditions
    if (!position && !exitedThisBar && ['BUY', 'STRONG_BUY'].includes(signal)) {
      position = {
        tradeId: nextTradeId++,
        entryIndex: i,
        entryPrice: current.close,
        entryDate: current.date,
        entrySignal: signal,
      };
      action = 'BUY';
      actionMeta = { tradeId: position.tradeId, reason: signal };
    }

    const markedCapital = position
      ? capital * (safeNumber(current.close) / safeNumber(position.entryPrice, 1))
      : capital;

    equityCurve.push({
      date: current.date,
      capital: parseFloat(markedCapital.toFixed(2)),
      signal,
      ...(action ? { action } : {}),
      ...actionMeta,
    });
  }

  // Close remaining position if open
  if (position) {
    const lastCandle = priceData[priceData.length - 1];
    const closedTrade = closeTrade(position, lastCandle, 'END_OF_PERIOD');
    equityCurve[equityCurve.length - 1] = {
      ...equityCurve[equityCurve.length - 1],
      capital: parseFloat(capital.toFixed(2)),
      action: 'SELL',
      tradeId: closedTrade.tradeId,
      pnl: closedTrade.pnlDollars,
      reason: closedTrade.reason,
    };
  }

  function closeTrade(pos, exitCandle, reason) {
    const exitPrice = exitCandle.close;
    const pnlPercent = (exitPrice - pos.entryPrice) / pos.entryPrice;
    const pnlDollars = capital * pnlPercent;

    const trade = {
      tradeId: pos.tradeId,
      entryDate: pos.entryDate,
      entryPrice: parseFloat(pos.entryPrice.toFixed(2)),
      exitDate: exitCandle.date,
      exitPrice: parseFloat(exitPrice.toFixed(2)),
      pnlPercent: parseFloat((pnlPercent * 100).toFixed(2)),
      pnlDollars: parseFloat(pnlDollars.toFixed(2)),
      daysHeld: Math.max(1, Math.floor((exitCandle.date - pos.entryDate) / (1000 * 60 * 60 * 24))),
      entrySignal: pos.entrySignal,
      reason,
    };

    trades.push(trade);
    capital *= (1 + pnlPercent);
    position = null;
    return trade;
  }

  return { trades, capital, equityCurve };
}

// Compute performance metrics
function computeMetrics(trades, equityCurve, initialCapital, finalCapital, days) {
  const winningTrades = trades.filter(t => t.pnlPercent > 0);
  const losingTrades = trades.filter(t => t.pnlPercent <= 0);

  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;
  const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnlPercent, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlPercent, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);

  const dailyReturns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = safeNumber(equityCurve[i - 1].capital, initialCapital);
    const curr = safeNumber(equityCurve[i].capital, prev);
    if (prev > 0) dailyReturns.push((curr - prev) / prev);
  }

  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? ((avgReturn - 0.0003) / stdDev) * Math.sqrt(252) : 0;

  // CAGR
  const years = days / 252;
  const cagr = years > 0 ? (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100 : 0;

  const avgTradeReturn = trades.length > 0
    ? trades.reduce((sum, trade) => sum + trade.pnlPercent, 0) / trades.length
    : 0;

  const avgWinSize = winningTrades.length > 0
    ? winningTrades.reduce((sum, trade) => sum + trade.pnlPercent, 0) / winningTrades.length
    : 0;
  const avgLossSize = losingTrades.length > 0
    ? losingTrades.reduce((sum, trade) => sum + trade.pnlPercent, 0) / losingTrades.length
    : 0;
  const maxSingleTradeLoss = losingTrades.length > 0
    ? Math.min(...losingTrades.map((trade) => trade.pnlPercent))
    : 0;

  let maxConsecutiveLosses = 0;
  let currentLossStreak = 0;
  for (const trade of trades) {
    if (trade.pnlPercent <= 0) {
      currentLossStreak += 1;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
    } else {
      currentLossStreak = 0;
    }
  }

  let peakCapital = initialCapital;
  let peakDate = equityCurve[0]?.date || null;
  let inDrawdown = false;
  let currentPeriod = null;
  let maxDrawdown = 0;
  const drawdownPeriods = [];

  for (const point of equityCurve) {
    const pointCapital = safeNumber(point.capital, peakCapital);
    if (pointCapital >= peakCapital) {
      if (inDrawdown && currentPeriod) {
        currentPeriod.recoveryDate = point.date;
        currentPeriod.recoveryDays = Math.max(0, Math.round((new Date(point.date) - new Date(currentPeriod.startDate)) / (1000 * 60 * 60 * 24)));
        drawdownPeriods.push(currentPeriod);
        currentPeriod = null;
        inDrawdown = false;
      }
      peakCapital = pointCapital;
      peakDate = point.date;
      continue;
    }

    const drawdown = peakCapital > 0 ? ((pointCapital - peakCapital) / peakCapital) * 100 : 0;
    if (!inDrawdown) {
      inDrawdown = true;
      currentPeriod = {
        startDate: peakDate,
        bottomDate: point.date,
        recoveryDate: null,
        maxLoss: parseFloat(drawdown.toFixed(1)),
      };
    }

    if (currentPeriod && drawdown < currentPeriod.maxLoss) {
      currentPeriod.maxLoss = parseFloat(drawdown.toFixed(1));
      currentPeriod.bottomDate = point.date;
    }

    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }

  if (inDrawdown && currentPeriod) {
    drawdownPeriods.push(currentPeriod);
  }

  const deepestDrawdown = drawdownPeriods.reduce((worst, period) => {
    if (!worst || period.maxLoss < worst.maxLoss) return period;
    return worst;
  }, null);

  const recoveryDays = deepestDrawdown?.recoveryDays ?? null;

  return {
    totalTrades: trades.length,
    winRate: parseFloat(winRate.toFixed(1)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(1)),
    cagr: parseFloat(cagr.toFixed(1)),
    avgTradeReturn: parseFloat(avgTradeReturn.toFixed(2)),
    avgWinSize: parseFloat(avgWinSize.toFixed(2)),
    avgLossSize: parseFloat(avgLossSize.toFixed(2)),
    maxSingleTradeLoss: parseFloat(maxSingleTradeLoss.toFixed(2)),
    maxConsecutiveLosses,
    recoveryDays,
    drawdownPeriods,
  };
}

// Main backtest function
async function runBacktest(params, dependencies = {}) {
  const { ticker, strategyName = 'trade-recommendation', startDate, endDate, initialCapital = 100000, apiKey } = params;
  
  if (!ticker || !startDate || !endDate) {
    throw new Error('Missing required parameters: ticker, startDate, endDate');
  }

  const supportedStrategies = new Set(['trade-recommendation', 'macd-bb', 'rsi-ma']);
  if (!supportedStrategies.has(strategyName)) {
    throw new Error(`Unsupported strategyName: ${strategyName}. Use trade-recommendation, macd-bb, or rsi-ma`);
  }

  if (!apiKey) {
    throw new Error('Alpha Vantage API key is required for backtesting');
  }
  
  // Fetch historical data
  const priceData = await fetchHistoricalData(ticker, apiKey);
  if (!priceData || priceData.length < 50) {
    return {
      error: 'Insufficient historical data. Need at least 50 trading days.',
      skillUsed: 'backtesting',
    };
  }
  
  // Filter by date range
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('Invalid date range. Use YYYY-MM-DD and ensure startDate <= endDate');
  }

  const requiredWarmupBars = getRequiredWarmupBars(strategyName);
  const rangeStartIndex = priceData.findIndex((p) => p.date >= start);
  const rangeEndIndex = priceData.findLastIndex((p) => p.date <= end);

  if (rangeStartIndex === -1 || rangeEndIndex === -1 || rangeStartIndex > rangeEndIndex) {
    return {
      error: `No historical data available in date range [${startDate}, ${endDate}]`,
      skillUsed: 'backtesting',
    };
  }

  const simulationStartIndex = Math.max(0, rangeStartIndex - requiredWarmupBars);
  const simulationData = priceData.slice(simulationStartIndex, rangeEndIndex + 1);
  const tradingStartOffset = rangeStartIndex - simulationStartIndex;
  const filteredData = simulationData.slice(tradingStartOffset);
  
  if (filteredData.length < 50) {
    return {
      error: `Insufficient data in date range [${startDate}, ${endDate}]. Got ${filteredData.length} days.`,
      skillUsed: 'backtesting',
    };
  }
  
  // Generate signals
  const signals = simulationData.map((p, i) => generateSignal(simulationData, i, strategyName));
  
  // Simulate trades
  const { trades, capital: finalCapital, equityCurve } = simulateTrades(simulationData, signals, initialCapital, tradingStartOffset);
  
  // Compute metrics
  const days = filteredData.length;
  const metrics = computeMetrics(trades, equityCurve, initialCapital, finalCapital, days);
  
  // Signal distribution
  const buySignals = signals.filter(s => ['BUY', 'STRONG_BUY'].includes(s)).length;
  const sellSignals = signals.filter(s => ['SELL', 'STRONG_SELL'].includes(s)).length;
  const holdDays = signals.filter(s => s === 'HOLD').length;
  
  // Build recommendations
  const recommendations = [];
  if (metrics.sharpeRatio > 1.0) {
    recommendations.push('✅ Excellent Sharpe ratio - risk-adjusted returns are strong');
  } else if (metrics.sharpeRatio > 0.5) {
    recommendations.push('✅ Good Sharpe ratio - positive risk-adjusted returns');
  } else {
    recommendations.push('⚠️ Low Sharpe ratio - improve risk management');
  }
  
  if (metrics.winRate > 55) {
    recommendations.push('✅ Win rate above 55% - strategy is profitable more often than not');
  } else if(metrics.winRate > 40) {
    recommendations.push('✅ Win rate above 40% - decent performance');
  } else {
    recommendations.push('⚠️ Win rate below 40% - consider revisiting signals');
  }
  
  if (metrics.profitFactor > 1.5) {
    recommendations.push('✅ Profit factor > 1.5 - good reward/risk balance');
  }
  
  if (Math.abs(metrics.maxDrawdown) < 15) {
    recommendations.push('✅ Max drawdown < 15% - acceptable risk level');
  } else {
    recommendations.push(`⚠️ Max drawdown ${Math.abs(metrics.maxDrawdown).toFixed(1)}% - consider larger stop-loss`);
  }
  
  if (metrics.totalTrades < 20) {
    recommendations.push('⚠️ Less than 20 trades - increase sample size for statistical significance');
  }
  
  return {
    backtestReport: {
      ticker,
      strategyName,
      period: {
        startDate,
        endDate,
        tradingDays: days,
      },
      capital: {
        initial: initialCapital,
        final: parseFloat(finalCapital.toFixed(2)),
        totalReturn: parseFloat(((finalCapital - initialCapital) / initialCapital * 100).toFixed(2)),
      },
      performanceMetrics: metrics,
      tradeLog: trades,
      equityCurve,
      signalDistribution: {
        buySignals: signals.slice(tradingStartOffset).filter(s => ['BUY', 'STRONG_BUY'].includes(s)).length,
        sellSignals: signals.slice(tradingStartOffset).filter(s => ['SELL', 'STRONG_SELL'].includes(s)).length,
        holdDays: signals.slice(tradingStartOffset).filter(s => s === 'HOLD').length,
      },
      drawdownAnalysis: {
        maxDrawdownPercent: metrics.maxDrawdown,
        recoveryDays: metrics.recoveryDays,
        drawdownPeriods: metrics.drawdownPeriods,
      },
      riskAnalysis: {
        maxSingleTradeLoss: metrics.maxSingleTradeLoss,
        maxConsecutiveLosses: metrics.maxConsecutiveLosses,
        avgWinSize: metrics.avgWinSize,
        avgLossSize: metrics.avgLossSize,
        profitToLossRatio: metrics.avgLossSize !== 0
          ? parseFloat((Math.abs(metrics.avgWinSize / metrics.avgLossSize)).toFixed(2))
          : null,
      },
      recommendations,
    },
    skillUsed: 'backtesting',
  };
}

module.exports = {
  runBacktest,
};
