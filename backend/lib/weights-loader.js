/**
 * Signal Weights Loader
 * =====================
 * Loads calibrated signal weights from signal-weights.json.
 * Falls back to hardcoded defaults if file not found.
 * 
 * Usage:
 *   const { getSignalWeight } = require('./weights-loader');
 *   const weight = getSignalWeight('trend_ma50_bullish');  // returns 2
 */

const fs = require('fs');
const path = require('path');

let weightsData = null;

function loadWeights() {
  if (weightsData) return weightsData;

  const weightsPath = path.join(__dirname, 'signal-weights.json');
  
  try {
    if (fs.existsSync(weightsPath)) {
      const content = fs.readFileSync(weightsPath, 'utf8');
      weightsData = JSON.parse(content);
      console.log(`[Weights] Loaded from ${path.basename(weightsPath)} (${weightsData.version || 'unknown version'})`);
    } else {
      console.log(`[Weights] File not found at ${weightsPath}, using defaults`);
      weightsData = getDefaultWeights();
    }
  } catch (err) {
    console.error(`[Weights] Error loading weights: ${err.message}`);
    weightsData = getDefaultWeights();
  }

  return weightsData;
}

function getDefaultWeights() {
  return {
    timestamp: new Date().toISOString(),
    version: '1.0-hardcoded-default',
    signal_weights: {
      trend_ma50_bullish: { points: 2 },
      trend_ma50_bearish: { points: -2 },
      trend_ma200_bullish: { points: 1 },
      trend_ma200_bearish: { points: -1 },
      rsi_oversold: { points: 1 },
      rsi_healthy: { points: 1 },
      rsi_overbought: { points: -2 },
      sentiment_bullish: { points: 2 },
      sentiment_bearish: { points: -2 },
      analyst_strong_buy: { points: 2 },
      analyst_weak_support: { points: -1 },
      analyst_upside: { points: 1 },
      analyst_downside: { points: -1 },
      momentum_strong_up: { points: 1 },
      momentum_strong_down: { points: -1 },
      macd_bullish: { points: 1 },
      macd_bearish: { points: -1 },
      bb_oversold: { points: 1 },
      bb_overbought: { points: -1 },
      kdj_oversold: { points: 1 },
      kdj_overbought: { points: -1 },
      obv_bullish: { points: 1 },
      obv_bearish: { points: -1 },
      vwap_above: { points: 1 },
      vwap_below: { points: -1 },
      macro_risk_high: { points: -2 },
      macro_risk_low: { points: 1 },
      macro_sentiment_bearish: { points: -1 },
      macro_sentiment_bullish: { points: 1 },
      macro_sector_headwind: { points: -1 },
    },
    model_metrics: {
      status: 'Hardcoded defaults (no calibration run yet)'
    }
  };
}

function getSignalWeight(signalKey) {
  const weights = loadWeights();
  const signal = weights.signal_weights?.[signalKey];
  
  if (!signal) {
    console.warn(`[Weights] Unknown signal: ${signalKey}`);
    return 0;
  }

  // Handle both { points: 2 } and direct float formats
  return typeof signal === 'object' ? signal.points : signal;
}

function getAllWeights() {
  const weights = loadWeights();
  const result = {};
  
  for (const [key, val] of Object.entries(weights.signal_weights || {})) {
    result[key] = typeof val === 'object' ? val.points : val;
  }
  
  return result;
}

function getWeightsMetadata() {
  const weights = loadWeights();
  return {
    timestamp: weights.timestamp,
    version: weights.version,
    metrics: weights.model_metrics,
    calibrated: weights.model_metrics?.status?.includes('Hardcoded') === false,
  };
}

module.exports = {
  loadWeights,
  getSignalWeight,
  getAllWeights,
  getWeightsMetadata,
};
