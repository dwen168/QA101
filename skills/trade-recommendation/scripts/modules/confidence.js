function computeConfidence(score, signals = [], macroRisk = 'MEDIUM') {
  const absScore = Math.abs(Number(score) || 0);
  const normalizedScore = Math.min(1, absScore / 10);

  // Saturate slowly so mid scores do not jump to very high confidence.
  const baseConfidence = 42 + Math.round(34 * Math.tanh(normalizedScore * 1.8));

  const magnitudes = signals.map((signal) => Number(signal?.points) || 0);
  const positive = magnitudes.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = magnitudes.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0);
  const totalMagnitude = positive + negative;
  const alignment = totalMagnitude > 0 ? Math.abs(positive - negative) / totalMagnitude : 0;

  // Strong one-sided evidence gets a boost; mixed evidence gets penalized.
  const consistencyAdjustment = Math.round((alignment - 0.5) * 14);
  const conflictPenalty = alignment < 0.3 && totalMagnitude >= 5 ? -6 : 0;

  let confidence = baseConfidence + consistencyAdjustment + conflictPenalty;
  let signalCountAdjustment = 0;

  if (signals.length <= 3) {
    confidence -= 4;
    signalCountAdjustment = -4;
  }
  if (signals.length >= 10) {
    confidence += 2;
    signalCountAdjustment = 2;
  }

  let macroAdjustment = 0;

  if (macroRisk === 'HIGH') {
    confidence -= 8;
    macroAdjustment = -8;
  } else if (macroRisk === 'LOW') {
    confidence += 3;
    macroAdjustment = 3;
  }

  const bounded = Math.max(30, Math.min(92, Math.round(confidence)));
  return {
    confidence: bounded,
    breakdown: {
      base: baseConfidence,
      consistencyAdjustment,
      conflictPenalty,
      signalCountAdjustment,
      macroAdjustment,
      rawScore: parseFloat(Number(score || 0).toFixed(1)),
      alignment: parseFloat((alignment * 100).toFixed(1)),
      positiveMagnitude: parseFloat(positive.toFixed(1)),
      negativeMagnitude: parseFloat(negative.toFixed(1)),
      totalSignalCount: signals.length,
      final: bounded,
    },
  };
}

function buildFallbackConfidenceExplanation({ action, confidence, confidenceBreakdown }) {
  const alignment = Number(confidenceBreakdown?.alignment || 0);
  const macroAdj = Number(confidenceBreakdown?.macroAdjustment || 0);
  const conflict = Number(confidenceBreakdown?.conflictPenalty || 0);
  const tone = confidence >= 70 ? 'high' : confidence >= 50 ? 'moderate' : 'cautious';
  const alignmentText = alignment >= 65 ? 'signal alignment is strong' : alignment <= 40 ? 'signals are mixed' : 'signals are moderately aligned';
  const macroText = macroAdj < 0 ? 'macro risk reduced conviction' : macroAdj > 0 ? 'macro regime supports conviction' : 'macro impact is neutral';
  const conflictText = conflict < 0 ? 'and conflict penalties applied' : '';
  return `${action} carries ${tone} conviction (${confidence}%) because ${alignmentText}; ${macroText} ${conflictText}`.trim();
}

async function generateConfidenceExplanation({ llm, ticker, action, confidence, confidenceBreakdown, signals }) {
  const fallback = buildFallbackConfidenceExplanation({ action, confidence, confidenceBreakdown });
  try {
    const systemPrompt = 'You are a quantitative analyst. Write one concise sentence (max 24 words) explaining confidence. No markdown.';
    const userMessage = `Ticker=${ticker}; Action=${action}; Confidence=${confidence}; Alignment=${confidenceBreakdown?.alignment}; Positive=${confidenceBreakdown?.positiveMagnitude}; Negative=${confidenceBreakdown?.negativeMagnitude}; MacroAdj=${confidenceBreakdown?.macroAdjustment}; Conflict=${confidenceBreakdown?.conflictPenalty}; SignalCount=${signals.length}.`;
    const text = await llm(systemPrompt, userMessage);
    const cleaned = String(text || '').replace(/\\s+/g, ' ').replace(/\`\`\`/g, '').trim();
    return cleaned || fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  computeConfidence,
  buildFallbackConfidenceExplanation,
  generateConfidenceExplanation
};
