const eventSectorRegimes = require('../../references/event-sector-regimes.json');

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

function canonicalizeSector(sector) {
  const raw = String(sector || 'Unknown').trim();
  const lower = raw.toLowerCase();
  const aliases = eventSectorRegimes?.sectorAliases || {};

  for (const [canonical, candidates] of Object.entries(aliases)) {
    if (canonical.toLowerCase() === lower) {
      return canonical;
    }

    if (Array.isArray(candidates) && candidates.some((candidate) => String(candidate).toLowerCase() === lower)) {
      return canonical;
    }
  }

  return raw || 'Unknown';
}

function buildMacroCorpus(macroContext) {
  const parts = [
    macroContext?.marketContext || '',
    ...(macroContext?.impactNotes || []),
    ...((macroContext?.news || []).flatMap((item) => [item?.title || '', item?.summary || ''])),
  ];
  return normalizeText(parts.join(' '));
}

function detectActiveEventRegimes(macroContext) {
  const dominantThemes = (macroContext?.dominantThemes || [])
    .map((item) => String(item?.theme || '').toUpperCase())
    .filter(Boolean);
  const corpus = buildMacroCorpus(macroContext);
  const regimes = Array.isArray(eventSectorRegimes?.regimes) ? eventSectorRegimes.regimes : [];

  const matched = regimes
    .map((regime) => {
      const triggerThemes = Array.isArray(regime?.triggerThemes) ? regime.triggerThemes : [];
      const keywords = Array.isArray(regime?.keywords) ? regime.keywords : [];
      const themeMatches = triggerThemes.filter((theme) => dominantThemes.includes(String(theme).toUpperCase()));
      const keywordMatches = keywords.filter((keyword) => corpus.includes(normalizeText(keyword)));

      if (themeMatches.length === 0 && keywordMatches.length === 0) {
        return null;
      }

      const confidenceRaw =
        (themeMatches.length > 0 ? 0.55 : 0) +
        Math.min(0.35, keywordMatches.length * 0.08) +
        (String(macroContext?.riskLevel || '').toUpperCase() === 'HIGH' ? 0.1 : 0);
      const confidence = Math.min(1, parseFloat(confidenceRaw.toFixed(2)));

      return {
        id: regime.id,
        name: regime.name,
        intensity: Number(regime.intensity || 1),
        beneficiarySectors: Array.isArray(regime.beneficiarySectors) ? regime.beneficiarySectors : [],
        headwindSectors: Array.isArray(regime.headwindSectors) ? regime.headwindSectors : [],
        businessKeywords: Array.isArray(regime.businessKeywords) ? regime.businessKeywords : [],
        themeMatches,
        keywordMatches: keywordMatches.slice(0, 3),
        confidence,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);

  return matched;
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

function buildEventRegimeOverlay(marketData) {
  const macroContext = marketData?.macroContext;
  const sector = canonicalizeSector(marketData?.sector || 'Unknown');

  if (!macroContext || macroContext.available !== true) {
    return {
      available: false,
      sector,
      netBias: 0,
      regimes: [],
      summary: 'Macro context unavailable for event-regime overlay.',
    };
  }

  const activeRegimes = detectActiveEventRegimes(macroContext);
  if (!activeRegimes.length) {
    return {
      available: false,
      sector,
      netBias: 0,
      regimes: [],
      summary: 'No active event regimes matched current macro themes.',
    };
  }

  const companyCorpus = buildCompanyCorpus(marketData);

  const regimeImpacts = activeRegimes.map((regime) => {
    // Check company's own news/name against regime business keywords (product-level match)
    const bizKeywords = [
      ...(Array.isArray(regime.businessKeywords) ? regime.businessKeywords : []),
      ...(Array.isArray(regime.keywords) ? regime.keywords : []),
    ];
    const companyKeywordMatches = companyCorpus
      ? bizKeywords.filter((kw) => companyCorpus.includes(normalizeText(kw)))
      : [];
    const companyDirectMatch = companyKeywordMatches.length >= 1;

    // Start with sector-level direction
    const isBeneficiary = regime.beneficiarySectors.includes(sector);
    const isHeadwind = regime.headwindSectors.includes(sector);
    let directional = isBeneficiary ? 1 : isHeadwind ? -1 : 0;
    let coefficient = 1.0;

    // Company business analysis overrides sector classification:
    // If company's own content matches regime keywords, it has direct exposure
    if (companyDirectMatch) {
      if (directional <= 0) {
        // Company operates in this regime's domain → override to tailwind
        // (e.g. DroneShield classified as Tech → sector says headwind, but business is war-tech)
        directional = 1;
        coefficient = companyKeywordMatches.length >= 2 ? 0.9 : 0.7;
      } else {
        // Sector already says tailwind AND company confirms → amplify
        coefficient = 1.2;
      }
    }

    const bias = parseFloat((directional * coefficient * regime.intensity * regime.confidence).toFixed(2));

    return {
      id: regime.id,
      name: regime.name,
      confidence: regime.confidence,
      bias,
      direction: directional > 0 ? 'TAILWIND' : directional < 0 ? 'HEADWIND' : 'NEUTRAL',
      sectorBased: isBeneficiary ? 'TAILWIND' : isHeadwind ? 'HEADWIND' : 'NEUTRAL',
      themeMatches: regime.themeMatches,
      keywordMatches: regime.keywordMatches,
      companyKeywordMatches: companyKeywordMatches.slice(0, 4),
      companyDirectMatch,
    };
  });

  const netBiasRaw = regimeImpacts.reduce((sum, regime) => sum + regime.bias, 0);
  const netBias = parseFloat(Math.max(-2.5, Math.min(2.5, netBiasRaw)).toFixed(2));
  const direction = netBias > 0.2 ? 'TAILWIND' : netBias < -0.2 ? 'HEADWIND' : 'NEUTRAL';

  const companyOverrides = regimeImpacts.filter((r) => r.companyDirectMatch && r.sectorBased !== r.direction);
  const overrideSummary = companyOverrides.length
    ? ` Business analysis overrides sector for: ${companyOverrides.map((r) => r.name).join(', ')}.`
    : '';

  return {
    available: true,
    sector,
    direction,
    netBias,
    regimes: regimeImpacts,
    summary: `${sector} has a ${direction.toLowerCase()} event overlay (net ${netBias > 0 ? '+' : ''}${netBias}).${overrideSummary}`,
  };
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

function buildPolicyOverlay(marketData) {
  const policy = marketData?.macroContext?.monetaryPolicy;
  const sector = canonicalizeSector(marketData?.sector || 'Unknown');
  const ticker = String(marketData?.ticker || '').toUpperCase();
  const isAsx = ticker.endsWith('.AX');

  const banks = [policy?.fed, policy?.rba]
    .filter(Boolean)
    .map((entry) => {
      const bank = String(entry?.bank || '').toUpperCase();
      const bias = String(entry?.bias || 'WATCH').toUpperCase();
      const directional = computePolicyDirectionalImpact(bank, bias, sector);
      // RBA only affects ASX-listed stocks; FED applies universally
      const relevance = bank === 'RBA' ? (isAsx ? 1 : 0) : 1;
      return {
        bank,
        bias,
        headline: entry?.headline || '',
        impact: entry?.impact || '',
        biasScore: parseFloat((directional * relevance).toFixed(2)),
      };
    });

  const activeBanks = banks.filter((item) => Math.abs(item.biasScore) >= 0.2);
  const netBias = parseFloat(activeBanks.reduce((sum, item) => sum + item.biasScore, 0).toFixed(2));

  return {
    available: activeBanks.length > 0,
    sector,
    netBias,
    direction: netBias > 0.2 ? 'TAILWIND' : netBias < -0.2 ? 'HEADWIND' : 'NEUTRAL',
    banks,
    summary: activeBanks.length
      ? `${sector} has a ${netBias > 0 ? 'tailwind' : 'headwind'} from latest FED/RBA decisions.`
      : 'Latest FED/RBA decisions are not creating a material score overlay.',
  };
}

module.exports = {
  normalizeText,
  canonicalizeSector,
  buildMacroCorpus,
  detectActiveEventRegimes,
  buildCompanyCorpus,
  buildEventRegimeOverlay,
  classifyRateSensitivity,
  computePolicyDirectionalImpact,
  buildPolicyOverlay
};
