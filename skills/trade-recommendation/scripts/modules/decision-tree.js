function toSignalId(signal, index) {
  const bucket = String(signal?.bucket || 'misc').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const name = String(signal?.name || `signal-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `sig-${bucket}-${name || index + 1}`;
}

function normalizeSignals(signals = []) {
  return signals.map((signal, index) => ({
    id: toSignalId(signal, index),
    name: signal?.name || `Signal ${index + 1}`,
    bucket: String(signal?.bucket || 'misc').toLowerCase(),
    points: Number(signal?.points || 0),
    reason: signal?.reason || 'No reason provided',
  }));
}

function selectTopByAbsPoints(signals, limit = 5) {
  return [...signals]
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, limit);
}

function scoreToOutcome(netScore) {
  if (netScore > 0.5) return 'bullish';
  if (netScore < -0.5) return 'bearish';
  return 'neutral';
}

// Each pillar is assigned an exclusive set of scoring buckets.
const PILLAR_DEFS = [
  {
    id: 'technical-trend',
    label: 'Technical Trend',
    description: 'Price action, moving averages, daily momentum, and technical indicators (MACD, RSI, BB, KDJ, OBV, VWAP)',
    buckets: ['trend', 'longtrend', 'oscillator', 'momentum', 'technical', 'intraday'],
  },
  {
    id: 'fundamental-value',
    label: 'Fundamental Value',
    description: 'Valuation, profitability, analyst ratings, and price targets',
    buckets: ['valuation', 'analyst'],
  },
  {
    id: 'fundamental-momentum',
    label: 'Fundamental Momentum',
    description: 'Recent earnings surprise and operating momentum signals',
    buckets: ['fundamental'],
  },
  {
    id: 'news-sentiment',
    label: 'News & Sentiment',
    description: 'News flow, market sentiment score, short interest, and EDA volume/breakout patterns',
    buckets: ['sentiment', 'eda'],
  },
  {
    id: 'macro-context',
    label: 'Macro Context',
    description: 'Macroeconomic regime, sector overlays, central bank policy, and event-regime profiles',
    buckets: ['macro'],
  },
];

function buildDecisionTree({
  score = 0,
  signals = [],
  confidence = 0,
  action = 'HOLD',
  macroOverlay = {},
  eventRegimeOverlay = {},
}) {
  const normalizedScore = Number(score || 0);
  const normalizedConfidence = Number(confidence || 0);
  const signalPool = normalizeSignals(signals);
  const assignedBuckets = new Set(PILLAR_DEFS.flatMap((def) => def.buckets));

  const pillars = PILLAR_DEFS.map((def) => {
    const pillarSignals = signalPool.filter((s) => def.buckets.includes(s.bucket));
    const netScore = parseFloat(
      pillarSignals.reduce((sum, s) => sum + s.points, 0).toFixed(1)
    );
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      netScore,
      outcome: scoreToOutcome(netScore),
      topSignals: selectTopByAbsPoints(pillarSignals, 5),
    };
  });

  const uncategorizedSignals = signalPool.filter((signal) => !assignedBuckets.has(signal.bucket));
  if (uncategorizedSignals.length) {
    const netScore = parseFloat(
      uncategorizedSignals.reduce((sum, signal) => sum + signal.points, 0).toFixed(1)
    );
    pillars.push({
      id: 'other-drivers',
      label: 'Other Drivers',
      description: 'Signals that are scored but not part of the main pillar taxonomy.',
      netScore,
      outcome: scoreToOutcome(netScore),
      topSignals: selectTopByAbsPoints(uncategorizedSignals, 5),
    });
  }

  const totalPositive = signalPool
    .filter((s) => s.points > 0)
    .reduce((sum, s) => sum + s.points, 0);
  const totalNegative = signalPool
    .filter((s) => s.points < 0)
    .reduce((sum, s) => sum + Math.abs(s.points), 0);
  const totalMagnitude = totalPositive + totalNegative;
  const riskPressurePct = totalMagnitude > 0
    ? parseFloat(((totalNegative / totalMagnitude) * 100).toFixed(1))
    : 0;
  const riskOutcome = riskPressurePct > 50 ? 'high' : riskPressurePct > 28 ? 'moderate' : 'low';

  const bullishPillars = pillars
    .filter((p) => p.outcome === 'bullish')
    .map((p) => p.label);

  return {
    title: 'Factor Contribution',
    pillars,
    risk: {
      negativeScore: parseFloat(totalNegative.toFixed(1)),
      riskPressurePct,
      outcome: riskOutcome,
      topSignals: selectTopByAbsPoints(signalPool.filter((s) => s.points < 0), 5),
    },
    leaf: {
      action,
      score: normalizedScore,
      confidence: Math.round(normalizedConfidence),
      summary: bullishPillars.length
        ? `${action} supported by ${bullishPillars.join(' + ')}, with ${riskPressurePct}% risk pressure across all signals.`
        : `${action} with ${riskPressurePct}% risk pressure and mixed factor signals.`,
    },
  };
}

module.exports = {
  buildDecisionTree,
};
