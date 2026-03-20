const config = require('../../../backend/lib/config');
const { runMarketIntelligence } = require('../../market-intelligence/scripts');

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, mapper, { concurrency = 4, delayMs = 0 } = {}) {
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;

      if (delayMs > 0) {
        await sleep(delayMs);
      }

      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

function computeLogReturnsFromHistory(priceHistory = []) {
  const closes = priceHistory.map((d) => safeNumber(d.close)).filter((value) => value > 0);
  if (closes.length < 2) return [];
  const returns = [];
  for (let i = 1; i < closes.length; i += 1) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  return returns;
}

function computeStd(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

function buildDerivedMarketMetrics(marketDataArray = []) {
  const logReturns = marketDataArray.map((md) => computeLogReturnsFromHistory(md.priceHistory));
  const volatilities = logReturns.map((returns) => computeStd(returns));
  const positiveVols = volatilities.filter((value) => value > 0);
  const minVol = positiveVols.length > 0 ? Math.min(...positiveVols) : 0;
  const maxVol = volatilities.length > 0 ? Math.max(...volatilities) : 0;
  return {
    logReturns,
    volatilities,
    minVol,
    maxVol,
  };
}

function summarizeDataSources(marketDataArray) {
  const sourceBreakdown = {
    live: 0,
    mock: 0,
    unknown: 0,
  };

  const details = (marketDataArray || []).map((item) => {
    const rawSource = String(item?.dataSource || '').toLowerCase();
    const source = rawSource || 'unknown';
    const usedFallback = source === 'mock';

    if (usedFallback) {
      sourceBreakdown.mock += 1;
    } else if (source === 'alpha-vantage' || source === 'yahoo-finance') {
      sourceBreakdown.live += 1;
    } else {
      sourceBreakdown.unknown += 1;
    }

    return {
      ticker: item?.ticker || 'UNKNOWN',
      source,
      usedFallback,
      fallbackReason: item?.fallbackReason || null,
    };
  });

  const total = details.length;
  const hasMock = sourceBreakdown.mock > 0;
  const allLive = total > 0 && sourceBreakdown.live === total;

  let status = 'MIXED';
  let message = `Mixed data sources across ${total} tickers.`;
  if (allLive) {
    status = 'LIVE';
    message = `Live market data used for all ${total} tickers.`;
  } else if (hasMock && sourceBreakdown.mock === total) {
    status = 'MOCK';
    message = `Mock data used for all ${total} tickers (live API unavailable).`;
  } else if (hasMock) {
    status = 'MIXED';
    message = `Live data for ${sourceBreakdown.live}, mock data for ${sourceBreakdown.mock}, unknown for ${sourceBreakdown.unknown}.`;
  }

  return {
    status,
    allLive,
    hasMock,
    sourceBreakdown,
    details,
    message,
  };
}

function computeMacroRegime(marketDataArray) {
  const macroContexts = (marketDataArray || [])
    .map((item) => item?.macroContext)
    .filter((macro) => macro && macro.available);

  if (macroContexts.length === 0) {
    return {
      available: false,
      sentimentScore: 0,
      sentimentLabel: 'UNAVAILABLE',
      riskLevel: 'MEDIUM',
      dominantThemes: [],
      marketContext: 'Macro regime unavailable. Portfolio uses ticker-level factors only.',
      sourceCount: 0,
    };
  }

  const sentimentScore = macroContexts.reduce((sum, macro) => sum + safeNumber(macro.sentimentScore), 0) / macroContexts.length;
  const sentimentLabel = sentimentScore > 0.25 ? 'RISK_ON' : sentimentScore < -0.25 ? 'RISK_OFF' : 'BALANCED';

  const riskOrder = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  const riskLevel = macroContexts
    .map((macro) => String(macro.riskLevel || 'MEDIUM').toUpperCase())
    .sort((left, right) => (riskOrder[right] || 2) - (riskOrder[left] || 2))[0] || 'MEDIUM';

  const themeCounts = {};
  for (const macro of macroContexts) {
    for (const item of macro.dominantThemes || []) {
      const theme = String(item.theme || 'GENERAL_MACRO').toUpperCase();
      themeCounts[theme] = (themeCounts[theme] || 0) + safeNumber(item.count, 1);
    }
  }
  const dominantThemes = Object.entries(themeCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([theme, count]) => ({ theme, count }));

  const marketContext = macroContexts[0]?.marketContext || 'Macro regime captured from market-intelligence.';

  return {
    available: true,
    sentimentScore: parseFloat(sentimentScore.toFixed(2)),
    sentimentLabel,
    riskLevel,
    dominantThemes,
    marketContext,
    sourceCount: macroContexts.length,
  };
}

function getMacroAdjustmentForTicker(marketData, macroRegime) {
  if (!macroRegime || !macroRegime.available) {
    return { adjustment: 0, reasons: [] };
  }

  const sector = String(marketData.sector || 'Unknown');
  const themes = (macroRegime.dominantThemes || []).map((item) => item.theme);
  const reasons = [];
  let adjustment = 0;

  if (macroRegime.riskLevel === 'HIGH') {
    adjustment -= 3;
    reasons.push('High macro risk regime');
  } else if (macroRegime.riskLevel === 'MEDIUM') {
    adjustment -= 1;
    reasons.push('Moderate macro uncertainty');
  } else if (macroRegime.riskLevel === 'LOW') {
    adjustment += 0.5;
    reasons.push('Supportive macro regime');
  }

  const sectorThemeHints = {
    Technology: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'MONETARY_POLICY'],
    Semiconductors: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'GEOPOLITICS'],
    Financials: ['MONETARY_POLICY', 'MARKET_STRESS', 'POLITICS_POLICY'],
    Energy: ['ENERGY_COMMODITIES', 'GEOPOLITICS', 'POLITICS_POLICY'],
    'Automotive/EV': ['SUPPLY_CHAIN', 'ENERGY_COMMODITIES', 'POLITICS_POLICY'],
    Industrials: ['SUPPLY_CHAIN', 'GEOPOLITICS', 'ENERGY_COMMODITIES'],
    Healthcare: ['POLITICS_POLICY', 'MARKET_STRESS'],
  };
  const overlap = (sectorThemeHints[sector] || []).filter((theme) => themes.includes(theme));

  if (macroRegime.riskLevel === 'HIGH' && overlap.length) {
    adjustment -= 1;
    reasons.push(`Macro themes pressure ${sector} (${overlap.join(', ')})`);
  }

  if (sector === 'Energy' && themes.includes('ENERGY_COMMODITIES') && macroRegime.riskLevel !== 'LOW') {
    adjustment += 1;
    reasons.push('Energy may benefit from commodity-risk regime');
  }

  return {
    adjustment: parseFloat(adjustment.toFixed(1)),
    reasons,
  };
}

// Compute momentum score for a single stock (0-100)
function computeMomentumScore(marketData) {
  const { price, priceHistory, ma50 } = marketData;
  const closes = priceHistory.map(d => d.close);
  
  if (closes.length < 30) return 50; // neutral if not enough data
  
  const latest   = closes[closes.length - 1];
  const prev1d   = closes[closes.length - 2];
  const prev5d   = closes[Math.max(0, closes.length - 6)];
  const prev30d  = closes[Math.max(0, closes.length - 31)];
  
  const mom1d  = ((latest - prev1d)  / prev1d)  * 100 || 0;
  const mom5d  = ((latest - prev5d)  / prev5d)  * 100 || 0;
  const mom30d = ((latest - prev30d) / prev30d) * 100 || 0;
  
  const avgMom = (mom1d + mom5d + mom30d) / 3;
  const ma50Slope = (ma50 ? ((price - ma50) / ma50) * 100 : 0);
  
  const momentumScore = 50 + (avgMom + ma50Slope) / 2;
  return Math.max(0, Math.min(100, momentumScore));
}

// Compute quality score for a single stock (0-100)
function computeQualityScore(marketData) {
  const { pe, eps, sentimentScore, analystConsensus } = marketData;
  let qualityScore = 0;
  
  // Valuation quality (0-25)
  if (pe > 0 && pe < 20) {
    qualityScore += 25;
  } else if (pe >= 20 && pe <= 30) {
    qualityScore += 15;
  } else if (pe > 30 && pe < 50) {
    qualityScore += 5;
  }
  
  // Earnings quality (0-25) - assume positive if EPS > 0
  if (eps > 0) {
    qualityScore += 20;
  }
  
  // Sentiment quality (0-25)
  if (sentimentScore > 0.5) {
    qualityScore += 25;
  } else if (sentimentScore > 0.3) {
    qualityScore += 15;
  } else if (sentimentScore >= -0.3) {
    qualityScore += 10;
  }
  
  // Analyst support (0-25)
  const upside = safeNumber(analystConsensus?.upside, 0);
  if (upside > 15) {
    qualityScore += 25;
  } else if (upside >= 10) {
    qualityScore += 15;
  } else if (upside >= 0) {
    qualityScore += 10;
  }
  
  return Math.max(0, Math.min(100, qualityScore));
}

// Compute risk-adjusted score for a single stock (0-100)
function computeRiskAdjustedScore(marketData, volatilityContext) {
  const { rsi } = marketData;

  const { volatilities = [], minVol = 0, maxVol = 0, index = -1 } = volatilityContext || {};
  const currentVol = index >= 0 ? safeNumber(volatilities[index], 0) : 0;
  
  let riskScore = 100;
  if (maxVol > minVol && currentVol > 0) {
    const volPercentile = ((currentVol - minVol) / (maxVol - minVol)) * 100;
    riskScore = 100 - volPercentile;
  }
  
  // RSI adjustments
  if (rsi > 70) {
    riskScore -= 20; // Overbought
  } else if (rsi < 30) {
    riskScore += 15; // Oversold (contrarian)
  } else if (rsi >= 40 && rsi <= 60) {
    riskScore += 5; // Healthy zone
  }
  
  return Math.max(0, Math.min(100, riskScore));
}

// Compute composite multi-factor score
function computeCompositeScore(marketData, allMarketData, timeHorizon = 'MEDIUM', derivedMetrics = null, index = -1) {
  const momentumScore = computeMomentumScore(marketData);
  const qualityScore = computeQualityScore(marketData);
  const riskAdjustedScore = computeRiskAdjustedScore(marketData, {
    ...(derivedMetrics || {}),
    index,
  });
  
  // Weights based on time horizon
  let weights = { momentum: 0.30, quality: 0.40, risk: 0.30 }; // MEDIUM
  if (timeHorizon === 'SHORT') {
    weights = { momentum: 0.50, quality: 0.30, risk: 0.20 };
  } else if (timeHorizon === 'LONG') {
    weights = { momentum: 0.20, quality: 0.50, risk: 0.30 };
  }
  
  const compositeScore = 
    momentumScore * weights.momentum +
    qualityScore * weights.quality +
    riskAdjustedScore * weights.risk;
  
  return {
    momentum: parseFloat(momentumScore.toFixed(1)),
    quality: parseFloat(qualityScore.toFixed(1)),
    riskAdjusted: parseFloat(riskAdjustedScore.toFixed(1)),
    composite: parseFloat(compositeScore.toFixed(1)),
  };
}

// Compute correlation matrix from price histories
function computeCorrelationMatrix(marketDataArray, precomputedLogReturns = null) {
  const n = marketDataArray.length;
  const matrix = Array(n).fill(null).map(() => Array(n).fill(0));
  const tickers = marketDataArray.map(m => m.ticker);
  
  // Get log returns for each stock
  const logReturns = Array.isArray(precomputedLogReturns) && precomputedLogReturns.length === n
    ? precomputedLogReturns
    : marketDataArray.map((md) => computeLogReturnsFromHistory(md.priceHistory));
  
  // Compute pairwise correlations
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1.0;
      } else if (i < j) {
        const r1 = logReturns[i];
        const r2 = logReturns[j];
        
        if (r1.length < 2 || r2.length < 2) {
          matrix[i][j] = 0;
        } else {
          // Pearson correlation
          const n = Math.min(r1.length, r2.length);
          const mean1 = r1.slice(0, n).reduce((a, b) => a + b) / n;
          const mean2 = r2.slice(0, n).reduce((a, b) => a + b) / n;
          
          const cov = r1.slice(0, n).reduce((sum, val, idx) => sum + (val - mean1) * (r2[idx] - mean2), 0) / n;
          
          const std1 = Math.sqrt(r1.slice(0, n).reduce((sum, val) => sum + (val - mean1) ** 2, 0) / n);
          const std2 = Math.sqrt(r2.slice(0, n).reduce((sum, val) => sum + (val - mean2) ** 2, 0) / n);
          
          const corr = std1 > 0 && std2 > 0 ? cov / (std1 * std2) : 0;
          matrix[i][j] = parseFloat(Math.max(-1, Math.min(1, corr)).toFixed(3));
        }
      } else {
        matrix[i][j] = matrix[j][i]; // Symmetric
      }
    }
  }
  
  return { tickers, matrix };
}

// Group stocks by sector and compute sector strength
function groupBySector(marketDataArray, scores) {
  const sectorMap = {};
  
  marketDataArray.forEach((md, idx) => {
    const sector = md.sector || 'Unknown';
    if (!sectorMap[sector]) {
      sectorMap[sector] = {
        sector,
        tickers: [],
        allocations: [],
        momentumScores: [],
        qualityScores: [],
        riskScores: [],
      };
    }
    sectorMap[sector].tickers.push(md.ticker);
    sectorMap[sector].momentumScores.push(scores[idx].momentum);
    sectorMap[sector].qualityScores.push(scores[idx].quality);
    sectorMap[sector].riskScores.push(scores[idx].riskAdjusted);
  });
  
  // Compute sector strength
  const byIndustry = Object.values(sectorMap).map(sector => {
    const avgMomentum = sector.momentumScores.reduce((a, b) => a + b) / sector.momentumScores.length;
    const avgQuality = sector.qualityScores.reduce((a, b) => a + b) / sector.qualityScores.length;
    const avgRisk = sector.riskScores.reduce((a, b) => a + b) / sector.riskScores.length;
    
    const sectorStrength = parseFloat((avgMomentum * 0.4 + avgQuality * 0.4 + avgRisk * 0.2).toFixed(1));
    
    return {
      sector: sector.sector,
      tickers: sector.tickers,
      allocation: 0, // Will be filled in during ranking
      avgMomentum: parseFloat(avgMomentum.toFixed(1)),
      avgQuality: parseFloat(avgQuality.toFixed(1)),
      sectorStrength,
    };
  });
  
  return byIndustry.sort((a, b) => b.sectorStrength - a.sectorStrength);
}

// Assign portfolio actions based on score
function getActionFromScore(score) {
  if (score >= 75) {
    return { action: 'STRONG BUY', allocation: 8 };
  } else if (score >= 60) {
    return { action: 'BUY', allocation: 5 };
  } else if (score >= 45) {
    return { action: 'HOLD', allocation: 3 };
  } else if (score >= 30) {
    return { action: 'REDUCE', allocation: 1 };
  } else {
    return { action: 'SELL', allocation: 0 };
  }
}

// Compute diversification metrics
function computeDiversificationMetrics(allocations, correlationMatrix) {
  const n = allocations.length;
  let concentration = 0;
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      concentration += (allocations[i] / 100) * (allocations[j] / 100) * (correlationMatrix.matrix[i][j] || 0);
    }
  }
  
  const avgPairwiseCorr = (() => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        sum += correlationMatrix.matrix[i][j] || 0;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  })();
  
  const sectorConcentration = allocations.reduce((max, a) => Math.max(max, a), 0) / 100;
  
  const riskAssessmentScore = concentration * 100;
  let riskAssessment = 'LOW';
  if (riskAssessmentScore > 50) riskAssessment = 'HIGH';
  else if (riskAssessmentScore > 35) riskAssessment = 'MODERATE';
  
  return {
    correlationWeightedConcentration: parseFloat(concentration.toFixed(3)),
    avgPairwiseCorrelation: parseFloat(avgPairwiseCorr.toFixed(3)),
    sectorConcentration: parseFloat(sectorConcentration.toFixed(3)),
    riskAssessment: `${riskAssessment} - Concentration: ${riskAssessmentScore.toFixed(0)}`,
  };
}

function buildRuleBasedPortfolioNarrative({ rankedTickers, sectorAnalysis, diversificationMetrics, macroRegime, expectedReturn }) {
  const top = rankedTickers[0];
  const second = rankedTickers[1];
  const strongestSector = sectorAnalysis[0];
  const weakestSector = sectorAnalysis[sectorAnalysis.length - 1];

  const executiveSummaryParts = [];
  if (top) {
    executiveSummaryParts.push(`${top.ticker} ranks #1 with a composite score of ${top.compositeScore.toFixed(1)} and ${top.action} signal`);
  }
  if (strongestSector) {
    executiveSummaryParts.push(`strongest sector is ${strongestSector.sector} (${strongestSector.sectorStrength.toFixed(1)})`);
  }
  executiveSummaryParts.push(`expected blended upside is ${expectedReturn.toFixed(1)}%`);

  const executiveSummary = `${executiveSummaryParts.join('; ')}.`;

  const sectorRotationInsight = strongestSector && weakestSector
    ? `Rotation favors ${strongestSector.sector} over ${weakestSector.sector}; consider overweighting leaders and trimming lagging sector exposure.`
    : 'Sector rotation signal is limited due to sparse sector coverage.';

  const diversificationAssessment = `Avg pairwise correlation is ${(diversificationMetrics.avgPairwiseCorrelation || 0).toFixed(3)} with ${diversificationMetrics.riskAssessment}.`;

  const recommendations = [];
  if (top && second) {
    recommendations.push(`Prioritize top convictions: ${top.ticker}${second ? ` and ${second.ticker}` : ''}.`);
  }
  if ((diversificationMetrics.avgPairwiseCorrelation || 0) > 0.7) {
    recommendations.push('Reduce concentration by adding lower-correlation names or increasing cash buffer.');
  }
  if (macroRegime?.riskLevel === 'HIGH') {
    recommendations.push('Keep a defensive tilt while macro risk remains elevated.');
  } else if (macroRegime?.riskLevel === 'LOW') {
    recommendations.push('Macro backdrop is supportive; gradual risk-on rebalancing is reasonable.');
  }

  const riskWarnings = [];
  if ((diversificationMetrics.avgPairwiseCorrelation || 0) > 0.8) {
    riskWarnings.push('High correlation across holdings can amplify drawdowns during risk-off moves.');
  }
  if (macroRegime?.riskLevel === 'HIGH') {
    riskWarnings.push('Macro regime is HIGH risk; volatile headline shocks may impact all sectors simultaneously.');
  }
  if (top && top.allocation >= 8) {
    riskWarnings.push(`Top holding ${top.ticker} has high allocation; monitor single-name risk.`);
  }

  return {
    executiveSummary,
    sectorRotationInsight,
    diversificationAssessment,
    recommendations,
    riskWarnings,
  };
}

async function runPortfolioOptimization({ tickers, useMarketData = [], timeHorizon = 'MEDIUM' }, dependencies = {}) {
  // Validate input
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error('tickers array is required and must not be empty');
  }
  
  if (tickers.length > 50) {
    throw new Error('Portfolio limited to 50 tickers for computation efficiency');
  }
  
  // Fetch or use provided market data
  let marketDataArray = [];
  
  if (useMarketData && Array.isArray(useMarketData) && useMarketData.length === tickers.length) {
    marketDataArray = useMarketData;
  } else {
    // Fetch market data with controlled concurrency to reduce end-to-end latency.
    try {
      const hasFinnhub = !!config.finnhubApiKey;
      const shouldThrottle = !hasFinnhub && !!config.alphaVantageApiKey && config.alphaVantageApiKey !== 'demo';
      const concurrency = shouldThrottle ? 2 : 4;
      const perRequestDelayMs = shouldThrottle ? 200 : 0;

      const settled = await mapWithConcurrency(tickers, async (ticker) => {
        const result = await runMarketIntelligence({ ticker }, dependencies);
        return result?.marketData || null;
      }, { concurrency, delayMs: perRequestDelayMs });

      for (let index = 0; index < settled.length; index += 1) {
        const item = settled[index];
        if (item?.error) {
          console.error(`Failed to fetch market data for ${tickers[index]}:`, item.error.message);
          continue;
        }
        if (item) {
          marketDataArray.push(item);
        }
      }
    } catch (error) {
      throw new Error(`Failed to fetch market data: ${error.message}`);
    }
  }
  
  if (marketDataArray.length === 0) {
    throw new Error('No valid market data could be retrieved for any ticker');
  }

  const dataSources = summarizeDataSources(marketDataArray);

  const macroRegime = computeMacroRegime(marketDataArray);
  const derivedMetrics = buildDerivedMarketMetrics(marketDataArray);
  
  // Compute factor scores
  const scores = marketDataArray.map((md, idx) => computeCompositeScore(md, marketDataArray, timeHorizon, derivedMetrics, idx));
  
  // Create ranked list
  const rankedData = marketDataArray.map((md, idx) => {
    const baseScores = scores[idx];
    const macroAdj = getMacroAdjustmentForTicker(md, macroRegime);
    const adjustedComposite = clamp(baseScores.composite + macroAdj.adjustment, 0, 100);
    return {
      ...md,
      ...baseScores,
      macroAdjustment: macroAdj.adjustment,
      macroReasons: macroAdj.reasons,
      adjustedComposite: parseFloat(adjustedComposite.toFixed(1)),
    };
  });
  
  rankedData.sort((a, b) => b.adjustedComposite - a.adjustedComposite);

  const allocationScale = macroRegime.riskLevel === 'HIGH'
    ? 0.9
    : macroRegime.riskLevel === 'LOW'
      ? 1.03
      : 0.98;
  
  // Assign actions and allocations
  const rankedTickers = rankedData.map((data, rank) => {
    const { action, allocation } = getActionFromScore(data.adjustedComposite);
    const scaledAllocation = clamp(allocation * allocationScale, 0, 10);
    return {
      rank: rank + 1,
      ticker: data.ticker,
      name: data.name,
      sector: data.sector,
      action,
      compositeScore: data.adjustedComposite,
      baseCompositeScore: data.composite,
      macroAdjustment: data.macroAdjustment,
      macroReasons: data.macroReasons,
      allocation: parseFloat(scaledAllocation.toFixed(1)),
      scores: {
        momentum: data.momentum,
        quality: data.quality,
        riskAdjusted: data.riskAdjusted,
      },
      priceTarget: data.analystConsensus?.targetMean || 0,
      upside: data.analystConsensus?.upside || 0,
      sentiment: data.sentimentScore || 0,
    };
  });
  
  // Compute correlation matrix
  const correlationMatrix = computeCorrelationMatrix(marketDataArray, derivedMetrics.logReturns);
  
  // Group by sector
  const sectorAnalysis = groupBySector(marketDataArray, scores);
  
  // Update allocations in sector analysis
  const allocations = rankedTickers.map(rt => rt.allocation);
  const totalAllocation = allocations.reduce((a, b) => a + b);
  
  sectorAnalysis.forEach(sector => {
    const sectorAllocation = rankedTickers
      .filter(rt => rt.sector === sector.sector)
      .reduce((sum, rt) => sum + rt.allocation, 0);
    sector.allocation = sectorAllocation;
  });
  
  // Compute diversification
  const diversificationMetrics = computeDiversificationMetrics(allocations, correlationMatrix);
  
  // Estimate portfolio metrics
  const expectedReturn = rankedTickers.reduce((sum, rt) => sum + (rt.upside * rt.allocation / 100), 0);
  let portfolioNarrative = buildRuleBasedPortfolioNarrative({
    rankedTickers,
    sectorAnalysis,
    diversificationMetrics,
    macroRegime,
    expectedReturn,
  });

  if (macroRegime.available) {
    const macroText = `Macro regime: ${macroRegime.riskLevel} risk (${macroRegime.sentimentLabel}, ${macroRegime.sentimentScore}).`;
    portfolioNarrative.executiveSummary = portfolioNarrative.executiveSummary
      ? `${portfolioNarrative.executiveSummary} ${macroText}`
      : macroText;
  }
  if (macroRegime.riskLevel === 'HIGH') {
    portfolioNarrative.recommendations = Array.from(new Set([...(portfolioNarrative.recommendations || []), 'Increase cash buffer and reduce high-beta concentration while macro risk remains elevated.']));
    portfolioNarrative.riskWarnings = Array.from(new Set([...(portfolioNarrative.riskWarnings || []), 'Macro risk regime is HIGH; drawdown probability is elevated across correlated risk assets.']));
  }
  
  return {
    rankedTickers,
    correlationMatrix,
    sectorAnalysis,
    diversificationMetrics,
    dataSources,
    macroRegime,
    portfolioMetrics: {
      totalAllocation: totalAllocation,
      cashBuffer: 100 - totalAllocation,
      expectedReturn: parseFloat(expectedReturn.toFixed(1)),
      expectedVolatility: 0, // Simplified; would require std computation
      sharpeRatio: 0, // Simplified
    },
    portfolioNarrative,
    llmNarrative: portfolioNarrative,
    skillUsed: 'portfolio-optimization',
    analysisDate: new Date().toISOString(),
    timeHorizon,
  };
}

module.exports = {
  computeCompositeScore,
  computeCorrelationMatrix,
  runPortfolioOptimization,
};
