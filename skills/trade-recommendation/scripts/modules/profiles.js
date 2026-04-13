function normalizeTimeHorizon(value = 'MEDIUM') {
  const normalized = String(value || '').trim().toUpperCase();
  return ['SHORT', 'MEDIUM', 'LONG'].includes(normalized) ? normalized : 'MEDIUM';
}

function getActionThresholds(timeHorizon = 'MEDIUM') {
  const normalized = normalizeTimeHorizon(timeHorizon);
  const thresholds = {
    SHORT: { strongBuy: 7, buy: 4, holdLow: -2, holdHigh: 2, sell: -4, strongSell: -7 },
    MEDIUM: { strongBuy: 7, buy: 4, holdLow: -2, holdHigh: 2, sell: -4, strongSell: -7 },
    LONG: { strongBuy: 8, buy: 5, holdLow: -2, holdHigh: 2, sell: -5, strongSell: -8 },
  };
  return thresholds[normalized];
}

function mapActionFromScore(score, timeHorizon = 'MEDIUM') {
  const s = Number(score || 0);
  const t = getActionThresholds(timeHorizon);
  if (s >= t.strongBuy) return { action: 'STRONG BUY', actionColor: '#10b981' };
  if (s >= t.buy) return { action: 'BUY', actionColor: '#6ee7b7' };
  if (s <= t.strongSell) return { action: 'STRONG SELL', actionColor: '#dc2626' };
  if (s <= t.sell) return { action: 'SELL', actionColor: '#f87171' };
  return { action: 'HOLD', actionColor: '#f59e0b' };
}

function getRecommendationProfile(timeHorizon = 'MEDIUM') {
  const normalized = normalizeTimeHorizon(timeHorizon);
  const profiles = {
    SHORT: {
      timeHorizon: 'SHORT',
      label: 'Short-term tactical',
      holdingPeriod: 'Up to 8 weeks',
      focus: 'Momentum, breakout confirmation, execution timing, and tight risk control.',
      signalMultipliers: {
        trend: 1.0,
        longTrend: 0.6,
        oscillator: 1.2,
        sentiment: 0.9,
        macro: 0.8,
        analyst: 0.6,
        valuation: 0.4,
        fundamental: 0.5,
        momentum: 1.3,
        technical: 1.2,
        intraday: 1.2,
        eda: 1.2,
      },
      atrStopMultiplier: 1.2,
      atrTargetMultiplier: 2.0,
    },
    MEDIUM: {
      timeHorizon: 'MEDIUM',
      label: 'Medium-term balanced',
      holdingPeriod: 'Several weeks to a few months',
      focus: 'Balanced mix of trend, momentum, macro, analyst sentiment, and risk-adjusted setup quality.',
      signalMultipliers: {
        trend: 1.0,
        longTrend: 1.0,
        oscillator: 1.0,
        sentiment: 1.0,
        macro: 1.0,
        analyst: 1.0,
        valuation: 1.0,
        fundamental: 1.0,
        momentum: 1.0,
        technical: 1.0,
        intraday: 1.0,
        eda: 1.0,
      },
      atrStopMultiplier: 1.5,
      atrTargetMultiplier: 2.5,
    },
    LONG: {
      timeHorizon: 'LONG',
      label: 'Medium/long-term fundamental',
      holdingPeriod: 'Multi-month holding period',
      focus: 'Trend durability, fundamentals, analyst expectations, valuation discipline, and macro regime.',
      signalMultipliers: {
        trend: 1.1,
        longTrend: 1.35,
        oscillator: 0.7,
        sentiment: 0.75,
        macro: 1.15,
        analyst: 1.25,
        valuation: 1.35,
        fundamental: 1.2,
        momentum: 0.5,
        technical: 0.6,
        intraday: 0.3,
        eda: 0.8,
      },
      atrStopMultiplier: 2.0,
      atrTargetMultiplier: 4.0,
    },
  };

  return profiles[normalized];
}

function adjustSignalPoints(points, multiplier = 1) {
  const adjusted = Number(points || 0) * Number(multiplier || 1);
  return Math.round(adjusted * 2) / 2;
}

function collectLensSignalNames(signals, profile, predicate) {
  const names = [];
  for (const signal of signals) {
    const multiplier = profile.signalMultipliers[signal.bucket] || 1;
    if (!predicate(multiplier)) continue;
    if (!names.includes(signal.name)) names.push(signal.name);
    if (names.length >= 4) break;
  }
  return names;
}

function buildObjectiveLensSummary(signals, profile) {
  return {
    amplifiedSignals: collectLensSignalNames(signals, profile, (multiplier) => multiplier > 1.05),
    deemphasizedSignals: collectLensSignalNames(signals, profile, (multiplier) => multiplier < 0.95),
  };
}

module.exports = {
  normalizeTimeHorizon,
  getRecommendationProfile,
  getActionThresholds,
  mapActionFromScore,
  adjustSignalPoints,
  collectLensSignalNames,
  buildObjectiveLensSummary
};
