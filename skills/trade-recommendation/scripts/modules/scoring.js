const { getSignalWeight } = require('../../../../backend/lib/weights-loader');
const { getRecommendationProfile, adjustSignalPoints } = require('./profiles');
const { buildEventRegimeOverlay, buildPolicyOverlay } = require('./overlays');

function scoreSignals(marketData, edaInsights = {}, timeHorizon = 'MEDIUM') {
  const signals = [];
  let score = 0;
  const profile = getRecommendationProfile(timeHorizon);
  const eventRegimeOverlay = buildEventRegimeOverlay(marketData);
  const policyOverlay = buildPolicyOverlay(marketData);

  const macroWeight = (key, fallback) => {
    const value = getSignalWeight(key);
    return value === 0 ? fallback : value;
  };

  // detail: { label, value } pairs shown as chips in the UI
  const add = (name, points, reason, detail = null, bucket = 'trend') => {
    const adjustedPoints = adjustSignalPoints(points, profile.signalMultipliers[bucket] || 1);
    if (adjustedPoints === 0) return;
    signals.push({ name, points: adjustedPoints, reason, detail, bucket });
    score += adjustedPoints;
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
    ], 'trend');
  } else {
    add('Price < MA50', w('trend_ma50_bearish'), 'Bearish trend - price below medium-term average', [
      { label: 'Price', value: `$${fmt(p)}` },
      { label: 'MA50', value: `$${fmt(ma50)}` },
      { label: 'Gap', value: `${fmt(pctVsMa50, 1)}%` },
    ], 'trend');
  }

  if (p > ma200) {
    add('Price > MA200', w('trend_ma200_bullish'), 'Long-term uptrend intact', [
      { label: 'Price', value: `$${fmt(p)}` },
      { label: 'MA200', value: `$${fmt(ma200)}` },
      { label: 'Gap', value: `+${fmt(pctVsMa200, 1)}%` },
    ], 'longTrend');
  } else {
    add('Price < MA200', w('trend_ma200_bearish'), 'Long-term downtrend', [
      { label: 'Price', value: `$${fmt(p)}` },
      { label: 'MA200', value: `$${fmt(ma200)}` },
      { label: 'Gap', value: `${fmt(pctVsMa200, 1)}%` },
    ], 'longTrend');
  }

  // RSI signals
  const rsi = marketData.rsi;
  if (rsi > 70) {
    add('RSI Overbought', w('rsi_overbought'), `RSI > 70 — overextended`, [
      { label: 'RSI', value: fmt(rsi, 1) },
      { label: 'Zone', value: 'Overbought (>70)' },
    ], 'oscillator');
  } else if (rsi < 30) {
    add('RSI Oversold', w('rsi_oversold'), `RSI < 30 — contrarian buy signal`, [
      { label: 'RSI', value: fmt(rsi, 1) },
      { label: 'Zone', value: 'Oversold (<30)' },
    ], 'oscillator');
  } else if (rsi >= 45 && rsi <= 65) {
    add('RSI Healthy', w('rsi_healthy'), `RSI in bullish healthy zone (45–65)`, [
      { label: 'RSI', value: fmt(rsi, 1) },
      { label: 'Zone', value: '45–65 Healthy' },
    ], 'oscillator');
  }

  // Sentiment signals
  const sent = marketData.sentimentScore;
  if (sent > 0.3) {
    add('Positive Sentiment', w('sentiment_bullish'), `News sentiment bullish`, [
      { label: 'Score', value: `+${fmt(sent, 2)}` },
      { label: 'Label', value: marketData.sentimentLabel },
    ], 'sentiment');
  } else if (sent < -0.3) {
    add('Negative Sentiment', w('sentiment_bearish'), `News sentiment bearish`, [
      { label: 'Score', value: fmt(sent, 2) },
      { label: 'Label', value: marketData.sentimentLabel },
    ], 'sentiment');
  }

  // ASIC short selling interest signals (ASX only)
  const shortMetrics = marketData.shortMetrics;
  if (shortMetrics && shortMetrics.available !== false) {
    const shortPercent = Number(shortMetrics.shortPercent || 0);
    if (shortPercent > 5) {
      add('High Short Interest', w('short_pressure_bearish', -2), `${shortPercent.toFixed(1)}% of float is short — potential shorting pressure.`, [
        { label: 'Short %', value: `${shortPercent.toFixed(1)}%` },
        { label: 'Source', value: shortMetrics.dataSource || 'ASIC' },
      ], 'sentiment');
    } else if (shortPercent > 2) {
      add('Moderate Short Interest', w('short_pressure_bearish', -1), `${shortPercent.toFixed(1)}% short — monitor for shorting activity.`, [
        { label: 'Short %', value: `${shortPercent.toFixed(1)}%` },
        { label: 'Source', value: shortMetrics.dataSource || 'ASIC' },
      ], 'sentiment');
    }
  }

  // Macro regime overlay signals
  const macro = marketData.macroContext;
  if (macro && macro.available) {
    const macroThemes = (macro.dominantThemes || []).map((item) => item.theme);
    const macroRisk = String(macro.riskLevel || 'MEDIUM').toUpperCase();
    const macroSent = Number(macro.sentimentScore || 0);

    if (macroRisk === 'HIGH') {
      add('Macro Risk-Off', macroWeight('macro_risk_bearish', -2), 'Global macro backdrop is risk-off; tighten conviction.', [
        { label: 'Risk', value: macroRisk },
        { label: 'Tone', value: macro.sentimentLabel || 'RISK_OFF' },
        { label: 'Score', value: fmt(macroSent, 2) },
      ], 'macro');
    } else if (macroRisk === 'LOW') {
      add('Macro Tailwind', macroWeight('macro_risk_bullish', 1), 'Macro backdrop is supportive for risk assets.', [
        { label: 'Risk', value: macroRisk },
        { label: 'Tone', value: macro.sentimentLabel || 'RISK_ON' },
        { label: 'Score', value: fmt(macroSent, 2) },
      ], 'macro');
    }

    if (macroSent <= -0.25) {
      add('Macro Sentiment Bearish', macroWeight('macro_sentiment_bearish', -1), 'Global macro headlines lean defensive.', [
        { label: 'Score', value: fmt(macroSent, 2) },
        { label: 'Themes', value: macroThemes.slice(0, 2).join(', ') || 'General' },
      ], 'macro');
    } else if (macroSent >= 0.25) {
      add('Macro Sentiment Supportive', macroWeight('macro_sentiment_bullish', 1), 'Global macro sentiment supports risk-taking.', [
        { label: 'Score', value: `+${fmt(macroSent, 2)}` },
        { label: 'Themes', value: macroThemes.slice(0, 2).join(', ') || 'General' },
      ], 'macro');
    }

    const sector = String(marketData.sector || 'Unknown');
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
    const headwindOverlap = (sectorHeadwindThemes[sector] || []).filter((theme) => macroThemes.includes(theme));
    const tailwindOverlap = (sectorTailwindThemes[sector] || []).filter((theme) => macroThemes.includes(theme));
    if (macroRisk === 'HIGH' && headwindOverlap.length) {
      add('Macro-Sector Headwind', macroWeight('macro_sector_headwind', -1), `Current macro themes directly pressure ${sector}.`, [
        { label: 'Sector', value: sector },
        { label: 'Themes', value: headwindOverlap.join(', ') },
      ], 'macro');
    }
    if (macroRisk === 'HIGH' && tailwindOverlap.length) {
      add('Macro-Sector Tailwind', macroWeight('macro_risk_bullish', 1), `Macro regime favours ${sector} in the current environment.`, [
        { label: 'Sector', value: sector },
        { label: 'Themes', value: tailwindOverlap.join(', ') },
      ], 'macro');
    }

    if (policyOverlay.available && Math.abs(policyOverlay.netBias) >= 0.2) {
      const magnitude = Math.min(1.5, Math.max(0.4, Math.abs(policyOverlay.netBias)));
      const drivers = policyOverlay.banks
        .filter((item) => Math.abs(item.biasScore) >= 0.2)
        .map((item) => `${item.bank} ${item.bias}`)
        .join(', ');

      if (policyOverlay.netBias > 0) {
        const rawPoints = macroWeight('macro_risk_bullish', 1) * magnitude;
        const points = Math.max(0.5, rawPoints);
        add('Central Bank Policy Tailwind', points, policyOverlay.summary, [
          { label: 'Sector', value: policyOverlay.sector },
          { label: 'Bias', value: `+${fmt(policyOverlay.netBias, 2)}` },
          { label: 'Drivers', value: drivers || 'FED/RBA' },
        ], 'macro');
      } else {
        const rawPoints = macroWeight('macro_sector_headwind', -1) * magnitude;
        const points = Math.min(-0.5, rawPoints);
        add('Central Bank Policy Headwind', points, policyOverlay.summary, [
          { label: 'Sector', value: policyOverlay.sector },
          { label: 'Bias', value: fmt(policyOverlay.netBias, 2) },
          { label: 'Drivers', value: drivers || 'FED/RBA' },
        ], 'macro');
      }
    }
  }

  // Event-regime knowledge base overlay (war/oil shock/rate cycle/supply chain, etc.)
  if (eventRegimeOverlay.available && Math.abs(eventRegimeOverlay.netBias) >= 0.25) {
    const magnitude = Math.min(2, Math.max(0.5, Math.abs(eventRegimeOverlay.netBias)));
    const highlightedRegimes = eventRegimeOverlay.regimes
      .filter((regime) => regime.direction !== 'NEUTRAL')
      .slice(0, 2)
      .map((regime) => regime.name)
      .join(', ');

    if (eventRegimeOverlay.netBias > 0) {
      add(
        'Event Regime Tailwind',
        macroWeight('macro_risk_bullish', 1) * magnitude,
        `Current event regime favors ${eventRegimeOverlay.sector}.`,
        [
          { label: 'Sector', value: eventRegimeOverlay.sector },
          { label: 'Bias', value: `+${eventRegimeOverlay.netBias}` },
          { label: 'Drivers', value: highlightedRegimes || 'Macro events' },
        ],
        'macro'
      );
    } else {
      add(
        'Event Regime Headwind',
        macroWeight('macro_sector_headwind', -1) * magnitude,
        `Current event regime is a headwind for ${eventRegimeOverlay.sector}.`,
        [
          { label: 'Sector', value: eventRegimeOverlay.sector },
          { label: 'Bias', value: `${eventRegimeOverlay.netBias}` },
          { label: 'Drivers', value: highlightedRegimes || 'Macro events' },
        ],
        'macro'
      );
    }
  }

  // EDA engineered factors (small overlay weights)
  const edaFactors = edaInsights?.edaFactors || {};
  if (edaFactors.available) {
    if (edaFactors.breakoutSignal === 'BULLISH_BREAKOUT') {
      add('EDA Breakout', w('eda_breakout_bullish') || 0.5, 'Price broke above recent 20-day range.', [
        { label: 'Breakout20', value: `+${fmt(edaFactors.breakout20Pct, 2)}%` },
        { label: 'Volume', value: `${fmt(edaFactors.volumeRatio, 2)}x` },
      ], 'eda');
    } else if (edaFactors.breakoutSignal === 'BEARISH_BREAKDOWN') {
      add('EDA Breakdown', w('eda_breakout_bearish') || -0.5, 'Price lost recent 20-day support.', [
        { label: 'Breakout20', value: `${fmt(edaFactors.breakout20Pct, 2)}%` },
        { label: 'Volume', value: `${fmt(edaFactors.volumeRatio, 2)}x` },
      ], 'eda');
    }

    if (edaFactors.volumeRegime === 'HIGH' && (marketData.changePercent || 0) > 0) {
      add('EDA Volume Confirmation', w('eda_volume_bullish') || 0.5, 'Up move is supported by high volume participation.', [
        { label: 'VolumeRatio', value: `${fmt(edaFactors.volumeRatio, 2)}x` },
      ], 'eda');
    }

    if (edaFactors.volatilityRegime === 'HIGH') {
      add('EDA Volatility Risk', w('eda_volatility_bearish') || -0.5, 'High realized volatility increases execution risk.', [
        { label: 'Vol20', value: `${fmt(edaFactors.volatility20, 1)}%` },
      ], 'eda');
    }

    if (edaFactors.trendStrengthSignal === 'STRONG_UP') {
      add('EDA Trend Strength', w('eda_trend_strength') || 0.5, 'MA20 is meaningfully above MA50.', [
        { label: 'TrendGap', value: `+${fmt(edaFactors.trendStrengthPct, 2)}%` },
      ], 'eda');
    } else if (edaFactors.trendStrengthSignal === 'STRONG_DOWN') {
      add('EDA Trend Weakness', w('eda_trend_weakness') || -0.5, 'MA20 is meaningfully below MA50.', [
        { label: 'TrendGap', value: `${fmt(edaFactors.trendStrengthPct, 2)}%` },
      ], 'eda');
    }
  }

  // Analyst consensus signals
  const consensus = marketData.analystConsensus;
  const totalRatings = consensus.strongBuy + consensus.buy + consensus.hold + consensus.sell + consensus.strongSell;
  const buyRatio = totalRatings === 0 ? 0 : (consensus.strongBuy + consensus.buy) / totalRatings;

  if (buyRatio > 0.6) {
    add('Strong Analyst Buy', w('analyst_buy_strong'), `Majority of analysts rate Buy or Strong Buy`, [
      { label: 'Buy%', value: `${(buyRatio * 100).toFixed(0)}%` },
      { label: 'Ratings', value: `${consensus.strongBuy + consensus.buy}B / ${consensus.hold}H / ${consensus.sell + consensus.strongSell}S` },
    ], 'analyst');
  } else if (buyRatio < 0.3) {
    add('Weak Analyst Support', w('analyst_buy_weak'), `Few analysts rate Buy`, [
      { label: 'Buy%', value: `${(buyRatio * 100).toFixed(0)}%` },
      { label: 'Ratings', value: `${consensus.strongBuy + consensus.buy}B / ${consensus.hold}H / ${consensus.sell + consensus.strongSell}S` },
    ], 'analyst');
  }

  if (consensus.upside > 10) {
    add('Analyst Upside', w('analyst_upside'), `Analyst targets above current price`, [
      { label: 'Upside', value: `+${fmt(consensus.upside, 1)}%` },
      { label: 'Target', value: `$${fmt(consensus.targetMean)}` },
      { label: 'Range', value: `$${fmt(consensus.targetLow)}–$${fmt(consensus.targetHigh)}` },
    ], 'analyst');
  } else if (consensus.upside < -5) {
    add('Downside Risk', w('analyst_downside'), `Analyst targets below current price`, [
      { label: 'Downside', value: `${fmt(consensus.upside, 1)}%` },
      { label: 'Target', value: `$${fmt(consensus.targetMean)}` },
    ], 'analyst');
  }

  const pe = Number(marketData.pe || 0);
  const eps = Number(marketData.eps || 0);
  if (Number.isFinite(eps) && eps !== 0) {
    if (eps > 0) {
      add('Positive EPS', 1, 'Company is profitable on trailing EPS, which supports a medium/long-term thesis.', [
        { label: 'EPS', value: `$${fmt(eps)}` },
        { label: 'P/E', value: pe > 0 ? fmt(pe, 1) : 'N/A' },
      ], 'valuation');
    } else {
      add('Negative EPS', -2, 'Negative trailing EPS weakens a fundamentally driven holding case.', [
        { label: 'EPS', value: `$${fmt(eps)}` },
      ], 'valuation');
    }
  }

  if (pe > 0 && eps > 0) {
    if (pe <= 25) {
      add('Reasonable Valuation', 1, 'Valuation is not obviously stretched for a medium/long-term entry.', [
        { label: 'P/E', value: fmt(pe, 1) },
      ], 'valuation');
    } else if (pe >= 40) {
      add('Rich Valuation', -1, 'Valuation is rich and leaves less margin of safety if growth expectations fade.', [
        { label: 'P/E', value: fmt(pe, 1) },
      ], 'valuation');
    }
  }

  // Daily momentum signals
  const chg = marketData.changePercent;
  if (chg > 1.5) {
    add('Strong Daily Momentum', w('momentum_strong_up'), `Up ${fmt(chg, 1)}% today`, [
      { label: 'Change', value: `+${fmt(chg, 2)}%` },
      { label: 'Price Δ', value: `+$${fmt(marketData.change, 2)}` },
      { label: 'Volume', value: `${(marketData.volume / 1e6).toFixed(1)}M` },
    ], 'momentum');
  } else if (chg < -2) {
    add('Bearish Day', w('momentum_strong_down'), `Down ${fmt(Math.abs(chg), 1)}% today`, [
      { label: 'Change', value: `${fmt(chg, 2)}%` },
      { label: 'Price Δ', value: `$${fmt(marketData.change, 2)}` },
      { label: 'Volume', value: `${(marketData.volume / 1e6).toFixed(1)}M` },
    ], 'momentum');
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
        ], 'technical');
      } else if (ti.macd.signal === 'BEARISH') {
        add('MACD Bearish', w('macd_bearish'), `MACD below signal line — momentum negative`, [
          { label: 'MACD', value: fmt(ti.macd.macdLine, 3) },
          { label: 'Signal', value: fmt(ti.macd.signalLine, 3) },
          { label: 'Hist', value: fmt(ti.macd.histogram, 3) },
        ], 'technical');
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
        ], 'technical');
      } else if (bb.signal === 'OVERSOLD') {
        add('BB Oversold', w('bb_oversold'), `Price near lower Bollinger Band — bounce opportunity`, [
          { label: 'BB%', value: `${(bb.bbPosition * 100).toFixed(0)}%` },
          { label: 'Lower', value: `$${fmt(bb.lowerBand)}` },
          { label: 'Mid', value: `$${fmt(bb.middleBand)}` },
          { label: 'StdDev', value: fmt(bb.stdDev, 2) },
        ], 'technical');
      }
    }

    // KDJ signal
    if (ti.kdj) {
      if (ti.kdj.signal === 'OVERSOLD') {
        add('KDJ Oversold', w('kdj_oversold'), `KDJ in oversold territory — contrarian buy`, [
          { label: 'K', value: fmt(ti.kdj.k, 1) },
          { label: 'D', value: fmt(ti.kdj.d, 1) },
          { label: 'J', value: fmt(ti.kdj.j, 1) },
        ], 'technical');
      } else if (ti.kdj.signal === 'OVERBOUGHT') {
        add('KDJ Overbought', w('kdj_overbought'), `KDJ in overbought territory — potential pullback`, [
          { label: 'K', value: fmt(ti.kdj.k, 1) },
          { label: 'D', value: fmt(ti.kdj.d, 1) },
          { label: 'J', value: fmt(ti.kdj.j, 1) },
        ], 'technical');
      }
    }

    // OBV signal
    if (ti.obv) {
      if (ti.obv.signal === 'BULLISH') {
        add('OBV Rising', w('obv_bullish'), `Volume confirms uptrend`, [
          { label: 'OBV', value: (ti.obv.obv / 1e6).toFixed(1) + 'M' },
          { label: 'Trend', value: 'Rising' },
        ], 'technical');
      } else if (ti.obv.signal === 'BEARISH') {
        add('OBV Falling', w('obv_bearish'), `Volume confirms downtrend`, [
          { label: 'OBV', value: (ti.obv.obv / 1e6).toFixed(1) + 'M' },
          { label: 'Trend', value: 'Falling' },
        ], 'technical');
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
        ], 'intraday');
      } else if (ti.vwap.signal === 'BELOW_VWAP') {
        add('Price < VWAP', w('vwap_below'), `Price below VWAP — bearish intraday positioning`, [
          { label: 'Price', value: `$${fmt(p)}` },
          { label: 'VWAP', value: `$${fmt(ti.vwap.vwap)}` },
          { label: 'Gap', value: vwapGap != null ? `${fmt(vwapGap, 1)}%` : '—' },
        ], 'intraday');
      }
    }
  }

  return { signals, score: parseFloat(score.toFixed(1)), buyRatio, profile, eventRegimeOverlay, policyOverlay };
}

module.exports = {
  scoreSignals
};
