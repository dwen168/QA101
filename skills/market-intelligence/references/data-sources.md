# Market Data Sources — Reference

## Currently Used: Mock Generator
`generateMockMarketData(ticker)` in `skills/market-intelligence/scripts/index.js` simulates realistic price data for demo purposes. Replace with a live provider for production use.

---

## Supported Live Data Providers

### Price & Fundamentals

| Provider | Free Tier | npm Package | Notes |
|----------|-----------|-------------|-------|
| **Alpha Vantage** | 25 req/day | — (use `axios`) | Env var: `ALPHA_VANTAGE_API_KEY` |
| **Yahoo Finance 2** | Unlimited (unofficial) | `yahoo-finance2` | No API key needed |
| **Polygon.io** | 5 req/min | — (use `axios`) | Requires registration |
| **Finnhub** | 60 req/min | — (use `axios`) | Also provides news |

### Alpha Vantage — Quick Integration
```js
// Daily prices (TIME_SERIES_DAILY_ADJUSTED)
const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`;
const { data } = await axios.get(url);
const timeSeries = data['Time Series (Daily)'];
```

### Yahoo Finance 2 — Quick Integration
```js
const yahooFinance = require('yahoo-finance2').default;
const quote  = await yahooFinance.quote(ticker);
const chart  = await yahooFinance.chart(ticker, { interval: '1d', range: '1mo' });
```

---

## News & Sentiment Providers

| Provider | Free Tier | Endpoint |
|----------|-----------|----------|
| **NewsAPI** | 100 req/day | `https://newsapi.org/v2/everything?q={ticker}` |
| **Finnhub News** | 60 req/min | `https://finnhub.io/api/v1/company-news?symbol={ticker}` |
| **Benzinga** | Paid | REST API |

### NewsAPI — Quick Integration
```js
const newsRes = await axios.get(`https://newsapi.org/v2/everything`, {
  params: { q: ticker, sortBy: 'publishedAt', pageSize: 5, apiKey: process.env.NEWS_API_KEY }
});
const articles = newsRes.data.articles;
```

---

## Sentiment Scoring
QuantBot uses a mock sentiment score. For production:
- **VADER** (Python, via child process) — rule-based, no API
- **Hugging Face Inference API** — `ProsusAI/finbert` model is fine-tuned for financial text
- **OpenAI / DeepSeek** — prompt the LLM with the headline to return a float in [−1, 1]

---

## Rate Limit Recommendations
- Cache market data for ≥ 1 minute per ticker to avoid hitting free-tier limits.
- Add an in-memory Map or Redis cache keyed on `${ticker}:${date}`.
