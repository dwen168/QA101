// Rolling RSI helper for historical pattern scan
function computeRollingRSI(closes, period) {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = losses === 0 ? 100 : (gains / period) / (losses / period);
  return parseFloat((100 - 100 / (1 + rs)).toFixed(1));
}

// Find past setups matching current RSI zone + MA50 position, report next 5/10d returns
function findHistoricalPatterns(priceHistory, marketData) {
  if (!priceHistory || priceHistory.length < 30) return null;
  const closes = priceHistory.map(d => d.close);
  const curRsiZone = marketData.rsi > 70 ? 'OB' : marketData.rsi < 30 ? 'OS' : 'N';
  const curVsMA50 = marketData.price > marketData.ma50 ? 'ABOVE' : 'BELOW';
  const LOOKAHEAD = 10;
  const raw = [];

  for (let i = 20; i <= closes.length - LOOKAHEAD - 1; i++) {
    const slice = closes.slice(0, i + 1);
    const rsi = computeRollingRSI(slice, 14);
    if (rsi === null) continue;
    const ma50Slice = slice.slice(-50);
    const ma50 = ma50Slice.reduce((s, v) => s + v, 0) / ma50Slice.length;
    const histPrice = slice[slice.length - 1];
    const histRsiZone = rsi > 70 ? 'OB' : rsi < 30 ? 'OS' : 'N';
    const histVsMA50 = histPrice > ma50 ? 'ABOVE' : 'BELOW';
    if (histRsiZone === curRsiZone && histVsMA50 === curVsMA50) {
      raw.push({
        i, date: priceHistory[i].date, rsi, priceVsMA50: histVsMA50,
        entryPrice: parseFloat(histPrice.toFixed(2)),
        return5d: parseFloat(((closes[i + 5] - histPrice) / histPrice * 100).toFixed(1)),
        return10d: parseFloat(((closes[i + LOOKAHEAD] - histPrice) / histPrice * 100).toFixed(1)),
      });
    }
  }

  // Deduplicate: at least 5 bars between retained matches
  const dedup = [];
  let lastIdx = -99;
  for (const m of raw) {
    if (m.i - lastIdx >= 5) {
      const { i, ...rest } = m; // eslint-disable-line no-unused-vars
      dedup.push(rest);
      lastIdx = m.i;
    }
  }
  if (dedup.length === 0) return null;

  const rsiLabel = curRsiZone === 'OB' ? 'Overbought' : curRsiZone === 'OS' ? 'Oversold' : 'Neutral';
  const wins5 = dedup.filter(m => m.return5d > 0).length;
  const wins10 = dedup.filter(m => m.return10d > 0).length;
  return {
    pattern: `RSI ${rsiLabel} + Price ${curVsMA50} MA50`,
    lookbackDays: priceHistory.length,
    instances: dedup.slice(-5),
    summary: {
      count: dedup.length,
      avg5d: parseFloat((dedup.reduce((s, m) => s + m.return5d, 0) / dedup.length).toFixed(1)),
      avg10d: parseFloat((dedup.reduce((s, m) => s + m.return10d, 0) / dedup.length).toFixed(1)),
      winRate5d: `${Math.round(wins5 / dedup.length * 100)}%`,
      winRate10d: `${Math.round(wins10 / dedup.length * 100)}%`,
    },
  };
}

module.exports = {
  computeRollingRSI,
  findHistoricalPatterns
};
