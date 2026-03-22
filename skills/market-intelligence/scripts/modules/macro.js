const { safeNumber, average, dedupeArticlesByTitle, clamp } = require('./utils');

const MACRO_THEME_RULES = [
  {
    theme: 'GEOPOLITICS',
    keywords: ['war', 'conflict', 'missile', 'iran', 'israel', 'ukraine', 'russia', 'china', 'taiwan', 'sanction', 'ceasefire', 'military'],
  },
  {
    theme: 'MONETARY_POLICY',
    keywords: ['fed', 'federal reserve', 'fomc', 'powell', 'rba', 'reserve bank of australia', 'cash rate', 'bullock'],
  },
  {
    theme: 'POLITICS_POLICY',
    keywords: ['white house', 'president', 'trump', 'biden', 'election', 'tariff', 'trade policy', 'congress', 'tax', 'regulation'],
  },
  {
    theme: 'ENERGY_COMMODITIES',
    keywords: ['oil', 'crude', 'gas', 'opec', 'commodity', 'gold', 'copper', 'shipping', 'strait of hormuz'],
  },
  {
    theme: 'MARKET_STRESS',
    keywords: ['selloff', 'risk-off', 'recession', 'volatility', 'vix', 'downgrade', 'credit spread', 'default', 'banking stress'],
  },
  {
    theme: 'SUPPLY_CHAIN',
    keywords: ['supply chain', 'factory', 'chip', 'semiconductor', 'shipping lane', 'port', 'export control'],
  },
];

const MACRO_THEME_VALUES = new Set([
  ...MACRO_THEME_RULES.map((rule) => rule.theme),
  'GENERAL_MACRO',
]);

const SECTOR_THEME_HINTS = {
  Technology: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'MONETARY_POLICY'],
  Semiconductors: ['SUPPLY_CHAIN', 'POLITICS_POLICY', 'GEOPOLITICS'],
  Financials: ['MONETARY_POLICY', 'MARKET_STRESS', 'POLITICS_POLICY'],
  Energy: ['ENERGY_COMMODITIES', 'GEOPOLITICS', 'POLITICS_POLICY'],
  'Automotive/EV': ['SUPPLY_CHAIN', 'ENERGY_COMMODITIES', 'POLITICS_POLICY'],
  Industrials: ['SUPPLY_CHAIN', 'GEOPOLITICS', 'ENERGY_COMMODITIES'],
  Healthcare: ['POLITICS_POLICY', 'MARKET_STRESS'],
};

function detectMacroTheme(text) {
  const lower = String(text || '').toLowerCase();
  if (detectFedRbaPolicyMention(lower)) {
    return 'MONETARY_POLICY';
  }
  for (const rule of MACRO_THEME_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      return rule.theme;
    }
  }
  return 'GENERAL_MACRO';
}

function detectFedRbaPolicyMention(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower) return false;

  const centralBankMentioned = [
    'fed', 'federal reserve', 'fomc', 'powell',
    'rba', 'reserve bank of australia', 'governor bullock', 'bullock',
  ].some((keyword) => lower.includes(keyword));

  if (!centralBankMentioned) return false;

  return detectRateDecisionMention(lower);
}

function detectRateDecisionMention(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower) return false;

  return [
    'rate decision', 'interest rate decision', 'interest rates', 'cash rate',
    'policy decision', 'policy meeting', 'held rates', 'holds rates',
    'held interest rates', 'holds interest rates', 'kept rates', 'keeps rates',
    'keeps interest rates', 'left rates unchanged', 'left interest rates unchanged',
    'holds interest rates steady', 'keeps interest rates steady', 'holds interest rates steady again',
    'raises rates', 'raised rates', 'hikes rates', 'hiked rates',
    'cuts rates', 'cut rates', 'rate hike', 'rate cut', 'meeting minutes', 'policy statement',
  ].some((keyword) => lower.includes(keyword));
}

function detectFedMention(text) {
  const lower = String(text || '').toLowerCase();
  return ['fed', 'federal reserve', 'fomc', 'powell'].some((keyword) => lower.includes(keyword));
}

function detectRbaMention(text) {
  const lower = String(text || '').toLowerCase();
  return ['rba', 'reserve bank of australia', 'cash rate', 'bullock', 'governor bullock'].some((keyword) => lower.includes(keyword));
}

function detectRatePolicyBias(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower) return 'WATCH';

  if (['rate cut', 'cuts rates', 'cut rates', 'easing', 'dovish', 'lower rates', 'lowered rates'].some((keyword) => lower.includes(keyword))) {
    return 'EASING';
  }

  if (['rate hike', 'hikes rates', 'hiked rates', 'raises rates', 'raised rates', 'tightening', 'hawkish', 'higher for longer'].some((keyword) => lower.includes(keyword))) {
    return 'TIGHTENING';
  }

  if (['held rates', 'holds rates', 'held interest rates', 'holds interest rates', 'kept rates', 'keeps rates', 'keeps interest rates', 'left rates unchanged', 'left interest rates unchanged', 'holds interest rates steady', 'keeps interest rates steady', 'unchanged'].some((keyword) => lower.includes(keyword))) {
    return 'HOLD';
  }

  return 'WATCH';
}

function summarizeRateImpact(bank, bias, sector, ticker) {
  const tickerLabel = ticker || 'this stock';
  const lowerSector = String(sector || '').toLowerCase();
  const growthSensitive = ['technology', 'semiconductors', 'consumer discretionary', 'utilities', 'healthcare'].includes(lowerSector);
  const rateSensitiveFinancials = ['financials', 'banks', 'banking', 'financial services'].includes(lowerSector);

  if (bias === 'EASING') {
    if (growthSensitive) return `${bank} easing is a tailwind for ${tickerLabel} through lower discount-rate pressure and easier liquidity.`;
    if (rateSensitiveFinancials) return `${bank} easing can pressure net-interest-margin expectations for ${tickerLabel}, even if broader liquidity improves.`;
    return `${bank} easing is broadly supportive for ${tickerLabel} through easier financial conditions.`;
  }

  if (bias === 'TIGHTENING') {
    if (growthSensitive) return `${bank} tightening is a headwind for ${tickerLabel} because higher rates usually compress growth multiples.`;
    if (rateSensitiveFinancials) return `${bank} tightening can support margin expectations for ${tickerLabel}, but it also raises credit-risk sensitivity.`;
    return `${bank} tightening raises financing pressure and usually acts as a macro headwind for ${tickerLabel}.`;
  }

  if (bias === 'HOLD') {
    return `${bank} holding rates steady keeps ${tickerLabel} focused on forward guidance rather than an immediate policy shock.`;
  }

  return `${bank} policy remains a live watch item for ${tickerLabel}; the current macro set does not yet show a clear directional rate signal.`;
}

function buildCentralBankImpact(bank, articles, sector, ticker) {
  const matcher = bank === 'FED' ? detectFedMention : detectRbaMention;
  const bankArticles = (articles || []).filter((article) => {
    const text = `${article?.title || ''} ${article?.summary || ''}`;
    return matcher(text) && detectRateDecisionMention(text);
  });
  const latestArticle = bankArticles
    .slice()
    .sort((left, right) => safeNumber(left?.hoursAgo, 0) - safeNumber(right?.hoursAgo, 0))[0] || null;
  const bias = detectRatePolicyBias(`${latestArticle?.title || ''} ${latestArticle?.summary || ''}`);

  return {
    bank,
    available: bankArticles.length > 0,
    bias,
    headline: latestArticle?.title || `No fresh ${bank} rate headline in current macro window.`,
    hoursAgo: Number.isFinite(Number(latestArticle?.hoursAgo)) ? Number(latestArticle.hoursAgo) : null,
    impact: summarizeRateImpact(bank, bias, sector, ticker),
  };
}

function buildMonetaryPolicyContext(articles, sector, ticker, policyDecisions = {}) {
  return {
    available: true,
    fed: buildCentralBankImpact('FED', policyDecisions?.fed ? [policyDecisions.fed, ...(articles || [])] : articles, sector, ticker),
    rba: buildCentralBankImpact('RBA', policyDecisions?.rba ? [policyDecisions.rba, ...(articles || [])] : articles, sector, ticker),
  };
}

function normalizeMacroTheme(theme, fallbackText) {
  const raw = String(theme || '').trim().toUpperCase();
  if (MACRO_THEME_VALUES.has(raw)) {
    return raw;
  }
  return detectMacroTheme(fallbackText);
}

function normalizeMacroTone(value, fallbackScore = 0) {
  const raw = String(value || '').trim().toUpperCase();
  if (['RISK_ON', 'RISK_OFF', 'BALANCED'].includes(raw)) {
    return raw;
  }
  return fallbackScore >= 0.25 ? 'RISK_ON' : fallbackScore <= -0.25 ? 'RISK_OFF' : 'BALANCED';
}

function normalizeMacroScore(value, fallbackValue = 0) {
  const parsed = Number(value);
  const score = Number.isFinite(parsed) ? parsed : fallbackValue;
  return parseFloat(clamp(score, -1, 1).toFixed(2));
}

function summarizeThemeImpact(theme, sector, ticker) {
  const sectorHints = SECTOR_THEME_HINTS[sector] || [];
  const tickerLabel = ticker || 'this stock';
  if (sectorHints.includes(theme)) {
    switch (theme) {
      case 'GEOPOLITICS': return `${tickerLabel} may be sensitive to cross-border risk, sanctions, or defense-driven market repricing.`;
      case 'MONETARY_POLICY': return `${tickerLabel} may react to rate expectations, discount-rate changes, and liquidity conditions.`;
      case 'POLITICS_POLICY': return `${tickerLabel} may be exposed to regulatory, tariff, or election-policy shifts.`;
      case 'ENERGY_COMMODITIES': return `${tickerLabel} may feel margin pressure or support from commodity and energy moves.`;
      case 'MARKET_STRESS': return `${tickerLabel} may trade with broader risk appetite as volatility and drawdown pressure rise.`;
      case 'SUPPLY_CHAIN': return `${tickerLabel} may face delivery, sourcing, or export-control pressure through supply chains.`;
      default: return `${tickerLabel} may be influenced by the broader macro narrative.`;
    }
  }
  return `${tickerLabel} has secondary exposure to the current ${theme.toLowerCase().replace(/_/g, ' ')} narrative.`;
}

function ensureMonetaryPolicyCoverage(macroNews = [], ticker = '') {
  const news = Array.isArray(macroNews) ? macroNews.filter(Boolean) : [];

  const normalizedNews = news.map((article) => {
    const text = `${article?.title || ''} ${article?.summary || ''}`;
    if (String(article?.theme || '').toUpperCase() === 'MONETARY_POLICY' || detectFedRbaPolicyMention(text)) {
      return {
        ...article,
        theme: 'MONETARY_POLICY',
      };
    }
    return article;
  });

  const hasMonetary = normalizedNews.some((article) => String(article?.theme || '').toUpperCase() === 'MONETARY_POLICY');
  if (hasMonetary) return normalizedNews;

  const symbol = String(ticker || '').toUpperCase() || 'MARKET';
  return [
    ...normalizedNews,
    {
      title: `${symbol} policy watch: FED/RBA focus (no FED/RBA decision headline found in fetched window)`,
      summary: 'Monetary policy monitoring remains anchored to Federal Reserve and Reserve Bank of Australia signals.',
      url: '',
      source: 'System Policy Overlay',
      sentiment: 0,
      hoursAgo: 0,
      theme: 'MONETARY_POLICY',
      scope: 'macro',
      synthetic: true,
    },
  ];
}

function buildMacroContext({ ticker, sector, macroNews = [], policyDecisions = {} }) {
  const coverageNews = ensureMonetaryPolicyCoverage(macroNews, ticker);
  const sortedCoverageNews = dedupeArticlesByTitle(coverageNews)
    .sort((left, right) => (left.hoursAgo ?? 0) - (right.hoursAgo ?? 0));

  let articles = sortedCoverageNews.slice(0, 6);
  const latestMonetaryArticle = sortedCoverageNews.find(
    (article) => String(article?.theme || '').toUpperCase() === 'MONETARY_POLICY'
  );

  if (
    latestMonetaryArticle
    && !articles.some((article) => String(article?.theme || '').toUpperCase() === 'MONETARY_POLICY')
  ) {
    articles = dedupeArticlesByTitle([latestMonetaryArticle, ...articles]).slice(0, 6);
  }

  const score = parseFloat(average(articles.map((article) => safeNumber(article.sentiment))).toFixed(2));
  const sentimentLabel = score > 0.25 ? 'RISK_ON' : score < -0.25 ? 'RISK_OFF' : 'BALANCED';

  const themeCounts = articles.reduce((accumulator, article) => {
    const theme = article.theme || 'GENERAL_MACRO';
    accumulator[theme] = (accumulator[theme] || 0) + 1;
    return accumulator;
  }, {});

  let dominantThemes = Object.entries(themeCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([theme, count]) => ({ theme, count }));

  const monetaryCount = safeNumber(themeCounts.MONETARY_POLICY, 0);
  if (monetaryCount > 0 && !dominantThemes.some((item) => item.theme === 'MONETARY_POLICY')) {
    dominantThemes = [
      { theme: 'MONETARY_POLICY', count: monetaryCount },
      ...dominantThemes,
    ].slice(0, 3);
  }

  const primaryTheme = dominantThemes[0]?.theme || 'GENERAL_MACRO';
  const riskLevel = sentimentLabel === 'RISK_OFF' || ['GEOPOLITICS', 'MARKET_STRESS'].includes(primaryTheme)
    ? 'HIGH'
    : sentimentLabel === 'BALANCED'
      ? 'MEDIUM'
      : 'LOW';

  const headline = articles[0]?.title || 'No major macro headlines captured.';
  const marketContext = articles.length
    ? `Macro tone is ${sentimentLabel.toLowerCase().replace('_', '-')}, led by ${dominantThemes.map((item) => item.theme.toLowerCase().replace(/_/g, ' ')).join(', ')} headlines. Latest focus: ${headline}`
    : 'Macro feed unavailable; current view relies on ticker-specific news only.';

  const impactNotes = dominantThemes.map((item) => summarizeThemeImpact(item.theme, sector, ticker));
  const monetaryPolicy = buildMonetaryPolicyContext(articles, sector, ticker, policyDecisions);

  return {
    available: articles.length > 0,
    sentimentScore: score,
    sentimentLabel,
    riskLevel,
    dominantThemes,
    marketContext,
    impactNotes,
    monetaryPolicy,
    news: articles,
    sourceBreakdown: {
      articleCount: articles.length,
      hasFinnhubMacro: articles.some((article) => String(article.source || '').toLowerCase().includes('finnhub')),
      hasNewsApiMacro: articles.some((article) => String(article.source || '').toLowerCase().includes('newsapi')),
    },
  };
}

module.exports = {
  MACRO_THEME_RULES,
  MACRO_THEME_VALUES,
  SECTOR_THEME_HINTS,
  detectMacroTheme,
  detectFedRbaPolicyMention,
  detectRateDecisionMention,
  detectFedMention,
  detectRbaMention,
  detectRatePolicyBias,
  summarizeRateImpact,
  buildCentralBankImpact,
  buildMonetaryPolicyContext,
  normalizeMacroTheme,
  normalizeMacroTone,
  normalizeMacroScore,
  summarizeThemeImpact,
  ensureMonetaryPolicyCoverage,
  buildMacroContext,
};
