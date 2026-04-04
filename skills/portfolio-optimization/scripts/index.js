const config = require('../../../backend/lib/config');
const { runMarketIntelligence } = require('../../market-intelligence/scripts');
const eventSectorRegimes = require('../../trade-recommendation/references/event-sector-regimes.json');

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

function computeMean(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeCovarianceMatrix(logReturns = [], annualizationFactor = 252) {
  const assetCount = logReturns.length;
  const matrix = Array.from({ length: assetCount }, () => Array(assetCount).fill(0));

  for (let i = 0; i < assetCount; i += 1) {
    for (let j = i; j < assetCount; j += 1) {
      const left = Array.isArray(logReturns[i]) ? logReturns[i] : [];
      const right = Array.isArray(logReturns[j]) ? logReturns[j] : [];
      const commonLength = Math.min(left.length, right.length);
      if (commonLength < 2) {
        matrix[i][j] = i === j ? 1e-6 : 0;
        matrix[j][i] = matrix[i][j];
        continue;
      }

      const leftSeries = left.slice(-commonLength);
      const rightSeries = right.slice(-commonLength);
      const leftMean = computeMean(leftSeries);
      const rightMean = computeMean(rightSeries);
      let covariance = 0;
      for (let k = 0; k < commonLength; k += 1) {
        covariance += (leftSeries[k] - leftMean) * (rightSeries[k] - rightMean);
      }
      covariance = commonLength > 1 ? covariance / (commonLength - 1) : 0;
      const annualized = covariance * annualizationFactor;
      matrix[i][j] = i === j ? Math.max(annualized, 1e-6) : annualized;
      matrix[j][i] = matrix[i][j];
    }
  }

  return matrix;
}

function matrixVectorMultiply(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function dotProduct(left = [], right = []) {
  return left.reduce((sum, value, index) => sum + value * (right[index] || 0), 0);
}

function quadraticForm(weights = [], matrix = []) {
  const mv = matrixVectorMultiply(matrix, weights);
  return dotProduct(weights, mv);
}

function getOptimizationSettings(timeHorizon = 'MEDIUM', macroRisk = 'MEDIUM', assetCount = 1) {
  const targetGrossWeight = macroRisk === 'HIGH'
    ? 0.78
    : macroRisk === 'LOW'
      ? 0.95
      : 0.88;

  const baseMaxWeight = timeHorizon === 'LONG'
    ? 0.20
    : timeHorizon === 'SHORT'
      ? 0.14
      : 0.16;

  const feasibleMinMaxWeight = (targetGrossWeight / Math.max(1, assetCount)) + 0.10;
  const maxWeight = clamp(Math.max(baseMaxWeight, feasibleMinMaxWeight), 0.08, 0.55);
  const riskAversion = macroRisk === 'HIGH' ? 10 : macroRisk === 'LOW' ? 4 : 6;

  return {
    targetGrossWeight,
    maxWeight,
    riskAversion,
    iterations: 140,
    stepSize: 0.08,
    riskFreeRate: 0.03,
  };
}

function projectWeights(proposedWeights, targetGrossWeight, maxWeight) {
  const projected = proposedWeights.map((value) => clamp(value, 0, maxWeight));
  let total = projected.reduce((sum, value) => sum + value, 0);

  if (total > targetGrossWeight && total > 0) {
    const scale = targetGrossWeight / total;
    return projected.map((value) => value * scale);
  }

  let remaining = Math.max(0, targetGrossWeight - total);
  let guard = 0;
  while (remaining > 1e-9 && guard < 10) {
    const candidates = projected
      .map((value, index) => ({ value, index }))
      .filter((item) => item.value < maxWeight - 1e-9);
    if (!candidates.length) break;

    const importance = candidates.map(({ index }) => Math.max(1e-6, proposedWeights[index], projected[index]));
    const totalImportance = importance.reduce((sum, value) => sum + value, 0);
    let consumed = 0;

    candidates.forEach((candidate, idx) => {
      const desired = totalImportance > 0
        ? remaining * (importance[idx] / totalImportance)
        : remaining / candidates.length;
      const add = Math.min(maxWeight - projected[candidate.index], desired);
      projected[candidate.index] += add;
      consumed += add;
    });

    if (consumed <= 1e-9) break;
    remaining -= consumed;
    total += consumed;
    guard += 1;
  }

  return projected;
}

function estimateExpectedReturnPct(data, timeHorizon = 'MEDIUM') {
  const adjustedComposite = safeNumber(data?.adjustedComposite, 50);
  const scoreTilt = clamp((adjustedComposite - 50) / 35, -1, 1);
  const upside = clamp(safeNumber(data?.analystConsensus?.upside, 0), -40, 40);
  const sentimentScore = clamp(safeNumber(data?.sentimentScore, 0), -1, 1);
  const scoreRange = timeHorizon === 'LONG' ? 14 : timeHorizon === 'SHORT' ? 10 : 12;

  const scoreComponent = scoreTilt * scoreRange;
  const analystComponent = upside * 0.35;
  const sentimentComponent = sentimentScore * 2;

  return clamp(scoreComponent + analystComponent + sentimentComponent, -20, 30);
}

function optimizePortfolioWeights(expectedReturnsPct, covarianceMatrix, settings) {
  const assetCount = expectedReturnsPct.length;
  if (assetCount === 0) return [];

  const expectedReturns = expectedReturnsPct.map((value) => safeNumber(value, 0) / 100);
  const preferences = expectedReturns.map((value) => Math.max(0.001, value + 0.02));
  const prefTotal = preferences.reduce((sum, value) => sum + value, 0);
  let weights = preferences.map((value) => (value / prefTotal) * settings.targetGrossWeight);
  weights = projectWeights(weights, settings.targetGrossWeight, settings.maxWeight);

  for (let iteration = 0; iteration < settings.iterations; iteration += 1) {
    const sigmaW = matrixVectorMultiply(covarianceMatrix, weights);
    const gradient = expectedReturns.map((value, index) => value - (2 * settings.riskAversion * sigmaW[index]));
    const candidate = weights.map((value, index) => value + settings.stepSize * gradient[index]);
    weights = projectWeights(candidate, settings.targetGrossWeight, settings.maxWeight);
  }

  return weights;
}

function computePortfolioRiskMetrics(weights, expectedReturnsPct, covarianceMatrix, riskFreeRate = 0.03, tickers = []) {
  if (!weights.length) {
    return {
      expectedReturn: 0,
      expectedVolatility: 0,
      sharpeRatio: 0,
      riskContribution: [],
    };
  }

  const expectedReturns = expectedReturnsPct.map((value) => safeNumber(value, 0) / 100);
  const expectedReturnDec = dotProduct(weights, expectedReturns);
  const portfolioVariance = Math.max(0, quadraticForm(weights, covarianceMatrix));
  const portfolioVolatility = Math.sqrt(portfolioVariance);
  const sigmaW = matrixVectorMultiply(covarianceMatrix, weights);
  const riskContribution = portfolioVolatility > 0
    ? weights.map((weight, index) => {
      const contribution = (weight * sigmaW[index]) / portfolioVolatility;
      return {
        ticker: tickers[index] || `Asset ${index + 1}`,
        contributionPct: parseFloat(((contribution / portfolioVolatility) * 100).toFixed(1)),
      };
    })
    : weights.map((weight, index) => ({
      ticker: tickers[index] || `Asset ${index + 1}`,
      contributionPct: 0,
    }));

  const sharpeRatio = portfolioVolatility > 0
    ? (expectedReturnDec - riskFreeRate) / portfolioVolatility
    : 0;

  return {
    expectedReturn: parseFloat((expectedReturnDec * 100).toFixed(1)),
    expectedVolatility: parseFloat((portfolioVolatility * 100).toFixed(1)),
    sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
    riskContribution,
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

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

function canonicalizeSector(sector) {
  const raw = String(sector || 'Unknown').trim();
  const lower = raw.toLowerCase();
  const aliases = eventSectorRegimes?.sectorAliases || {};

  for (const [canonical, candidates] of Object.entries(aliases)) {
    if (canonical.toLowerCase() === lower) return canonical;
    if (Array.isArray(candidates) && candidates.some((candidate) => String(candidate).toLowerCase() === lower)) {
      return canonical;
    }
  }

  return raw || 'Unknown';
}

function classifyRateSensitivity(sector) {
  const normalized = canonicalizeSector(sector || 'Unknown');
  if (['Technology', 'Semiconductors', 'Consumer Discretionary', 'Utilities', 'Healthcare'].includes(normalized)) {
    return 'GROWTH';
  }
  if (normalized === 'Financials') {
    return 'FINANCIALS';
  }
  if (['Industrials', 'Materials', 'Energy'].includes(normalized)) {
    return 'CYCLICAL';
  }
  return 'NEUTRAL';
}

function computePolicyDirectionalImpact(bank, bias, sector) {
  const sensitivity = classifyRateSensitivity(sector);
  if (bias === 'HOLD' || bias === 'WATCH') return 0;

  if (sensitivity === 'GROWTH') return bias === 'EASING' ? 1 : -1;
  if (sensitivity === 'FINANCIALS') return bias === 'EASING' ? -0.5 : 0.5;
  if (sensitivity === 'CYCLICAL') return bias === 'EASING' ? 0.4 : -0.4;
  return bias === 'EASING' ? 0.25 : -0.25;
}

function detectPortfolioEventRegimes(macroRegime) {
  if (!macroRegime?.available) return [];

  const themes = (macroRegime?.dominantThemes || [])
    .map((item) => String(item?.theme || '').toUpperCase())
    .filter(Boolean);
  const corpus = normalizeText(macroRegime?.marketContext || '');
  const regimes = Array.isArray(eventSectorRegimes?.regimes) ? eventSectorRegimes.regimes : [];

  return regimes
    .map((regime) => {
      const triggerThemes = Array.isArray(regime?.triggerThemes) ? regime.triggerThemes : [];
      const keywords = Array.isArray(regime?.keywords) ? regime.keywords : [];
      const themeMatches = triggerThemes.filter((theme) => themes.includes(String(theme).toUpperCase()));
      const keywordMatches = keywords.filter((keyword) => corpus.includes(normalizeText(keyword)));
      if (themeMatches.length === 0 && keywordMatches.length === 0) return null;

      const confidenceRaw =
        (themeMatches.length > 0 ? 0.55 : 0) +
        Math.min(0.25, keywordMatches.length * 0.08) +
        (String(macroRegime?.riskLevel || '').toUpperCase() === 'HIGH' ? 0.1 : 0);

      return {
        id: regime.id,
        name: regime.name,
        intensity: Number(regime.intensity || 1),
        confidence: Math.min(1, parseFloat(confidenceRaw.toFixed(2))),
        beneficiarySectors: Array.isArray(regime.beneficiarySectors) ? regime.beneficiarySectors : [],
        headwindSectors: Array.isArray(regime.headwindSectors) ? regime.headwindSectors : [],
        businessKeywords: Array.isArray(regime.businessKeywords) ? regime.businessKeywords : [],
        themeMatches,
        keywordMatches: keywordMatches.slice(0, 3),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);
}

function buildCompanyCorpus(marketData) {
  const parts = [
    marketData?.name || '',
    marketData?.description || '',
    marketData?.industry || '',
    ...((marketData?.news || []).flatMap((n) => [n?.title || '', n?.summary || ''])),
  ];
  return normalizeText(parts.join(' '));
}

function computePortfolioEventRegimeOverlay(marketDataArray, macroRegime) {
  const regimes = detectPortfolioEventRegimes(macroRegime);
  if (!regimes.length) {
    return {
      available: false,
      regimes: [],
      sectorBias: {},
      summary: 'No active event regimes matched current portfolio macro context.',
    };
  }

  const sectors = Array.from(new Set((marketDataArray || []).map((item) => canonicalizeSector(item?.sector || 'Unknown'))));
  const sectorBias = {};

  for (const sector of sectors) {
    const bias = regimes.reduce((sum, regime) => {
      const directional = regime.beneficiarySectors.includes(sector)
        ? 1
        : regime.headwindSectors.includes(sector)
          ? -1
          : 0;
      return sum + (directional * regime.intensity * regime.confidence);
    }, 0);

    sectorBias[sector] = parseFloat(Math.max(-3, Math.min(3, bias)).toFixed(2));
  }

  const topRegimeNames = regimes.slice(0, 2).map((item) => item.name).join(', ');
  return {
    available: true,
    regimes,
    sectorBias,
    summary: `Active event regimes: ${topRegimeNames || 'General macro'}; sector biases applied in ranking.`,
  };
}

function getMacroAdjustmentForTicker(marketData, macroRegime, eventOverlay = null) {
  if (!macroRegime || !macroRegime.available) {
    return { adjustment: 0, reasons: [], eventAdjustment: 0, eventReasons: [] };
  }

  const sector = canonicalizeSector(marketData.sector || 'Unknown');
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

  // Themes that HURT a sector in a HIGH-risk macro environment
  const sectorHeadwindThemes = {
    Technology: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'MONETARY_POLICY'],
    Semiconductors: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'GEOPOLITICS'],
    Financials: ['MONETARY_POLICY', 'MARKET_STRESS', 'POLITICS_POLICY'],
    // Energy BENEFITS from GEOPOLITICS and ENERGY_COMMODITIES (war/supply squeeze → higher oil).
    // Only MARKET_STRESS (demand destruction) is a genuine headwind for energy producers.
    Energy: ['MARKET_STRESS'],
    'Automotive/EV': ['SUPPLY_CHAIN', 'ENERGY_COMMODITIES', 'POLITICS_POLICY'],
    Industrials: ['SUPPLY_CHAIN', 'MARKET_STRESS'],
    Healthcare: ['POLITICS_POLICY', 'MARKET_STRESS'],
  };
  // Themes that HELP a sector in a HIGH-risk macro environment
  const sectorTailwindThemes = {
    Energy: ['GEOPOLITICS', 'ENERGY_COMMODITIES'],
    Industrials: ['GEOPOLITICS'],  // Defence/infrastructure spending during conflict
  };
  const headwindOverlap = (sectorHeadwindThemes[sector] || []).filter((theme) => themes.includes(theme));
  const tailwindOverlap = (sectorTailwindThemes[sector] || []).filter((theme) => themes.includes(theme));

  if (macroRegime.riskLevel === 'HIGH' && headwindOverlap.length) {
    adjustment -= 1;
    reasons.push(`Macro themes pressure ${sector} (${headwindOverlap.join(', ')})`);
  }
  if (macroRegime.riskLevel === 'HIGH' && tailwindOverlap.length) {
    adjustment += 1;
    reasons.push(`Macro regime favours ${sector} (${tailwindOverlap.join(', ')})`);
  }

  const ticker = String(marketData?.ticker || '').toUpperCase();
  const isAsx = ticker.endsWith('.AX');
  const policy = marketData?.macroContext?.monetaryPolicy || {};
  const policyEntries = [policy.fed, policy.rba].filter(Boolean);
  const policyAdjustmentRaw = policyEntries.reduce((sum, entry) => {
    const bank = String(entry?.bank || '').toUpperCase();
    const bias = String(entry?.bias || 'WATCH').toUpperCase();
    const directional = computePolicyDirectionalImpact(bank, bias, sector);
    // RBA only affects ASX-listed stocks; FED applies universally
    const relevance = bank === 'RBA' ? (isAsx ? 1 : 0) : 1;
    return sum + (directional * relevance);
  }, 0);
  const policyAdjustment = parseFloat(Math.max(-1.5, Math.min(1.5, policyAdjustmentRaw)).toFixed(1));
  if (Math.abs(policyAdjustment) >= 0.2) {
    adjustment += policyAdjustment;
    const policyDrivers = policyEntries
      .map((entry) => `${String(entry?.bank || '').toUpperCase()} ${String(entry?.bias || 'WATCH').toUpperCase()}`)
      .join(', ');
    reasons.push(`Central-bank policy ${policyAdjustment > 0 ? 'tailwind' : 'headwind'} for ${sector} (${policyDrivers})`);
  }

  const eventReasons = [];
  let eventAdjustment = 0;
  if (eventOverlay?.available) {
    // Per-ticker business analysis: match company's own news/name against regime keywords
    // This catches cases where sector label misses the real business (e.g. DRO.AX = counter-drone)
    const companyCorpus = buildCompanyCorpus(marketData);

    const perTickerBias = (eventOverlay.regimes || []).reduce((sum, regime) => {
      const bizKeywords = [
        ...(Array.isArray(regime.businessKeywords) ? regime.businessKeywords : []),
        ...(Array.isArray(regime.keywords) ? regime.keywords : []),
      ];
      const companyMatches = companyCorpus
        ? bizKeywords.filter((kw) => companyCorpus.includes(normalizeText(kw)))
        : [];
      const companyDirectMatch = companyMatches.length >= 1;

      const isBeneficiary = regime.beneficiarySectors.includes(sector);
      const isHeadwind = regime.headwindSectors.includes(sector);
      let directional = isBeneficiary ? 1 : isHeadwind ? -1 : 0;
      let coefficient = 1.0;

      if (companyDirectMatch) {
        if (directional <= 0) {
          // Company directly operates in this regime's domain → override sector label
          directional = 1;
          coefficient = companyMatches.length >= 2 ? 0.9 : 0.7;
          eventReasons.push(
            `Business match overrides sector: ${companyMatches.slice(0, 3).join(', ')} → ${regime.name} tailwind`
          );
        } else {
          coefficient = 1.2;
          eventReasons.push(
            `Amplified tailwind: ${companyMatches.slice(0, 2).join(', ')} confirms ${regime.name}`
          );
        }
      }

      return sum + (directional * coefficient * regime.intensity * regime.confidence);
    }, 0);

    eventAdjustment = parseFloat(Math.max(-3, Math.min(3, perTickerBias)).toFixed(1));

    if (Math.abs(eventAdjustment) >= 0.2 && eventReasons.length === 0) {
      const direction = eventAdjustment > 0 ? 'tailwind' : 'headwind';
      const keyRegimeNames = (eventOverlay.regimes || [])
        .filter((r) =>
          eventAdjustment > 0
            ? r.beneficiarySectors.includes(sector)
            : r.headwindSectors.includes(sector)
        )
        .slice(0, 2)
        .map((r) => r.name);
      eventReasons.push(`Event-regime ${direction} for ${sector}${keyRegimeNames.length ? ` (${keyRegimeNames.join(', ')})` : ''}`);
    }
  }

  const total = adjustment + eventAdjustment;

  return {
    adjustment: parseFloat(total.toFixed(1)),
    reasons,
    eventAdjustment: parseFloat(eventAdjustment.toFixed(1)),
    eventReasons,
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
  if (score >= 75) return { action: 'STRONG BUY' };
  if (score >= 60) return { action: 'BUY' };
  if (score >= 45) return { action: 'HOLD' };
  if (score >= 30) return { action: 'REDUCE' };
  return { action: 'SELL' };
}

// Compute diversification metrics
function computeDiversificationMetrics(rankedTickers, correlationMatrix) {
  const allocations = rankedTickers.map((item) => safeNumber(item.allocation, 0));
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
  
  const sectorWeights = rankedTickers.reduce((acc, item) => {
    const sector = item.sector || 'Unknown';
    acc[sector] = (acc[sector] || 0) + safeNumber(item.allocation, 0);
    return acc;
  }, {});
  const sectorConcentration = Math.max(0, ...Object.values(sectorWeights)) / 100;
  const herfindahlIndex = allocations.reduce((sum, value) => sum + (value / 100) ** 2, 0);
  
  const riskAssessmentScore = concentration * 100;
  let riskAssessment = 'LOW';
  if (riskAssessmentScore > 50) riskAssessment = 'HIGH';
  else if (riskAssessmentScore > 35) riskAssessment = 'MODERATE';
  
  return {
    correlationWeightedConcentration: parseFloat(concentration.toFixed(3)),
    avgPairwiseCorrelation: parseFloat(avgPairwiseCorr.toFixed(3)),
    sectorConcentration: parseFloat(sectorConcentration.toFixed(3)),
    herfindahlIndex: parseFloat(herfindahlIndex.toFixed(3)),
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
  executiveSummaryParts.push(`expected portfolio return is ${expectedReturn.toFixed(1)}%`);

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
  const eventRegimeOverlay = computePortfolioEventRegimeOverlay(marketDataArray, macroRegime);
  const derivedMetrics = buildDerivedMarketMetrics(marketDataArray);
  
  // Compute factor scores
  const scores = marketDataArray.map((md, idx) => computeCompositeScore(md, marketDataArray, timeHorizon, derivedMetrics, idx));
  
  // Create ranked list
  const rankedData = marketDataArray.map((md, idx) => {
    const baseScores = scores[idx];
    const macroAdj = getMacroAdjustmentForTicker(md, macroRegime, eventRegimeOverlay);
    const adjustedComposite = clamp(baseScores.composite + macroAdj.adjustment, 0, 100);
    return {
      ...md,
      ...baseScores,
      macroAdjustment: macroAdj.adjustment,
      macroReasons: macroAdj.reasons,
      eventAdjustment: macroAdj.eventAdjustment,
      eventReasons: macroAdj.eventReasons,
      adjustedComposite: parseFloat(adjustedComposite.toFixed(1)),
    };
  });
  
  rankedData.sort((a, b) => b.adjustedComposite - a.adjustedComposite);

  const optimizationSettings = getOptimizationSettings(timeHorizon, macroRegime.riskLevel, rankedData.length);
  const expectedReturnsPct = rankedData.map((data) => estimateExpectedReturnPct(data, timeHorizon));
  const covarianceMatrix = computeCovarianceMatrix(derivedMetrics.logReturns);
  const optimizedWeights = optimizePortfolioWeights(expectedReturnsPct, covarianceMatrix, optimizationSettings);
  
  // Assign actions and allocations
  const rankedTickers = rankedData.map((data, rank) => {
    const { action } = getActionFromScore(data.adjustedComposite);
    const optimizedAllocation = safeNumber(optimizedWeights[rank], 0) * 100;
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
      eventAdjustment: data.eventAdjustment,
      eventReasons: data.eventReasons,
      allocation: parseFloat(optimizedAllocation.toFixed(1)),
      expectedReturn: parseFloat(safeNumber(expectedReturnsPct[rank], 0).toFixed(1)),
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
  const diversificationMetrics = computeDiversificationMetrics(rankedTickers, correlationMatrix);
  
  // Estimate portfolio metrics
  const riskMetrics = computePortfolioRiskMetrics(
    rankedTickers.map((item) => item.allocation / 100),
    expectedReturnsPct,
    covarianceMatrix,
    optimizationSettings.riskFreeRate,
    rankedTickers.map((item) => item.ticker),
  );
  const expectedReturn = riskMetrics.expectedReturn;
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
  if (eventRegimeOverlay.available) {
    portfolioNarrative.executiveSummary = `${portfolioNarrative.executiveSummary} ${eventRegimeOverlay.summary}`;
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
    eventRegimeOverlay,
    portfolioMetrics: {
      totalAllocation: parseFloat(totalAllocation.toFixed(1)),
      cashBuffer: parseFloat((100 - totalAllocation).toFixed(1)),
      expectedReturn: riskMetrics.expectedReturn,
      expectedVolatility: riskMetrics.expectedVolatility,
      sharpeRatio: riskMetrics.sharpeRatio,
      optimizationMethod: 'constrained-mean-variance',
      maxPositionWeight: parseFloat((optimizationSettings.maxWeight * 100).toFixed(1)),
      targetInvestedWeight: parseFloat((optimizationSettings.targetGrossWeight * 100).toFixed(1)),
      riskContribution: riskMetrics.riskContribution,
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
