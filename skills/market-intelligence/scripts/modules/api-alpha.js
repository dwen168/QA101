const config = require('../../../../backend/lib/config');
const { safeNumber, withTimeout, REAL_DATA_TIMEOUT_MS } = require('./utils');

async function fetchAlphaVantagePriceHistory(ticker) {
  const apiKey = config.alphaVantageApiKey;
  if (!apiKey || apiKey === 'demo') {
    throw new Error('ALPHA_VANTAGE_API_KEY is missing or set to demo');
  }

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=full&apikey=${apiKey}`;
  const response = await withTimeout(fetch(url), REAL_DATA_TIMEOUT_MS, `Alpha Vantage core price fetch for ${ticker}`);

  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (payload['Error Message']) {
    throw new Error(payload['Error Message']);
  }
  if (payload.Information) {
    throw new Error(payload.Information);
  }
  if (payload.Note) {
    throw new Error(payload.Note);
  }

  const series = payload['Time Series (Daily)'];
  if (!series || typeof series !== 'object') {
    throw new Error('Missing time series data from Alpha Vantage');
  }

  const allDates = Object.keys(series).sort();
  if (allDates.length < 20) {
    throw new Error('Not enough history returned by Alpha Vantage');
  }

  const getVolume = (candle) => safeNumber(candle['6. volume'] ?? candle['5. volume']);
  const recentDatesAsc = allDates.slice(-500);  // Last 500 trading days (~2 years)
  const priceHistory = recentDatesAsc.map((date) => {
    const candle = series[date] || {};
    return {
      date,
      open: parseFloat(safeNumber(candle['1. open']).toFixed(2)),
      high: parseFloat(safeNumber(candle['2. high']).toFixed(2)),
      low: parseFloat(safeNumber(candle['3. low']).toFixed(2)),
      close: parseFloat(safeNumber(candle['4. close']).toFixed(2)),
      volume: Math.floor(getVolume(candle)),
    };
  });

  return { priceHistory, allDates, series };
}

module.exports = {
  fetchAlphaVantagePriceHistory,
};
