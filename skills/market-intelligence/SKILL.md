---
name: market-intelligence
description: >
  Collects and synthesizes real-time market intelligence for a given stock ticker.
  Validates the ticker, retrieves price data and technical indicators (MA, RSI),
  fetches recent news headlines with sentiment scores, and aggregates analyst
  consensus ratings into a structured MarketIntelligenceReport.
metadata:
  version: "1.0.0"
  author: QuantBot
  inputs:
    - name: ticker
      type: string
      description: A valid stock ticker symbol (e.g., AAPL, TSLA, NVDA)
      required: true
  outputs:
    - name: MarketIntelligenceReport
      type: object
      description: Structured report containing price data, technicals, news, and analyst data
  tags:
    - finance
    - market-data
    - sentiment
    - technical-analysis
---

# Skill: market-intelligence

## Purpose
Provide a comprehensive market intelligence snapshot for a single equity. This skill is always the FIRST step in the QuantBot analysis pipeline.

## Execution Steps

### Step 1 — Validate Ticker
- Normalize the ticker to uppercase and strip whitespace.
- Reject any input that is not 1–5 uppercase letters; return an error if invalid.

### Step 2 — Fetch Price Data
Collect the following price metrics (live or from mock generator):
- **Current price**, previous close, change ($), change (%)
- **52-week high** and **52-week low**
- **Market cap**, P/E ratio, EPS
- **Volume** (today) and **average volume** (30-day)
- **30-day OHLCV history** (date, open, high, low, close, volume for each day)

### Step 3 — Compute Technical Indicators
Using the 30-day price history:

**Basic Indicators:**
- **MA20** — 20-day simple moving average of closing prices
- **MA50** — 50-day SMA (use available history; extrapolate if fewer than 50 days)
- **MA200** — 200-day SMA (estimate from available data)
- **RSI (14)** — Relative Strength Index over 14 periods:
  - Separate daily gains and losses
  - Average gain / average loss over last 14 days
  - RSI = 100 − (100 / (1 + RS)) where RS = avgGain / avgLoss
- **Trend classification**: BULLISH if price > MA50 and price > MA20; BEARISH if price < MA50; otherwise NEUTRAL

**Advanced Indicators (calculated locally):**
- **MACD** — 12-EMA − 26-EMA with 9-EMA signal line; detect momentum crossovers
- **Bollinger Bands** — 20-SMA ± 2σ; identify overbought/oversold levels
- **KDJ (Stochastic)** — %K, %D, %J values; reversal and divergence detection
- **OBV (On-Balance Volume)** — Cumulative volume with price direction; confirm trends
- **VWAP (Volume Weighted Average Price)** — Fair value price; support/resistance levels

### Step 4 — Retrieve News & Sentiment
- Collect 5 recent headlines relevant to the ticker.
- For each headline, record: title, source, sentiment score (−1.0 to +1.0), hoursAgo.
- Aggregate sentiment into a single `sentimentScore` (average of headline scores).
- Classify `sentimentLabel`: BULLISH (> 0.3), BEARISH (< −0.3), or NEUTRAL.

### Step 4B — Retrieve Macro & Geopolitical Context
- Collect recent macro headlines that can move the broader market, such as war escalation, sanctions, tariff or policy changes, Fed guidance, inflation, oil shocks, and recession-risk narratives.
- Tag each macro headline with a theme such as `GEOPOLITICS`, `MONETARY_POLICY`, `POLITICS_POLICY`, `ENERGY_COMMODITIES`, `MARKET_STRESS`, or `SUPPLY_CHAIN`.
- Aggregate the macro feed into a `macroContext` object with sentiment, risk level, dominant themes, and stock-specific impact notes.

### Step 5 — Analyst Consensus
Aggregate analyst ratings:
- Counts: strongBuy, buy, hold, sell, strongSell
- Price targets: targetHigh, targetLow, targetMean
- Upside % = (targetMean − currentPrice) / currentPrice × 100

### Step 6 — Synthesize Report (LLM)
Using all data collected above, produce a JSON `llmAnalysis` object with:
- `summary` — 2–3 sentences describing the current market situation
- `keyTrends` — array of 3 concise trend observations
- `riskFlags` — array of risk factors (may be empty)
- `marketContext` — 1 sentence on the broader macro/sector context

## Output Schema
```json
{
  "marketData": {
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "sector": "Technology",
    "price": 185.50,
    "prevClose": 183.20,
    "change": 2.30,
    "changePercent": 1.25,
    "volume": 62000000,
    "avgVolume": 58000000,
    "high52w": 220.00,
    "low52w": 145.00,
    "marketCap": 2850000000000,
    "pe": 28.5,
    "eps": 6.51,
    "ma20": 182.10,
    "ma50": 178.40,
    "ma200": 169.80,
    "rsi": 58.3,
    "trend": "BULLISH",
    "sentimentScore": 0.45,
    "sentimentLabel": "BULLISH",
    "analystConsensus": { "strongBuy": 8, "buy": 12, "hold": 6, "sell": 2, "strongSell": 1, "targetHigh": 240, "targetLow": 165, "targetMean": 205, "upside": 10.5 },
    "news": [{ "title": "...", "source": "Reuters", "sentiment": 0.7, "hoursAgo": 2 }],
    "macroContext": {
      "available": true,
      "sentimentScore": -0.18,
      "sentimentLabel": "RISK_OFF",
      "riskLevel": "HIGH",
      "dominantThemes": [{ "theme": "GEOPOLITICS", "count": 2 }, { "theme": "MONETARY_POLICY", "count": 1 }],
      "marketContext": "Macro tone is risk-off, led by geopolitics and monetary policy headlines.",
      "impactNotes": ["AAPL may be exposed to supply-chain and policy shifts."],
      "news": [{ "title": "...", "source": "Reuters", "theme": "GEOPOLITICS", "sentiment": -0.4, "hoursAgo": 3 }]
    },
    "priceHistory": [{ "date": "2026-02-14", "close": 180.0, "volume": 55000000, "open": 179.0, "high": 181.0, "low": 178.5 }],
    "technicalIndicators": {
      "available": true,
      "macd": {
        "macdLine": 1.23,
        "signalLine": 0.95,
        "histogram": 0.28,
        "signal": "BULLISH"
      },
      "bollingerBands": {
        "upperBand": 195.6,
        "middleBand": 182.1,
        "lowerBand": 168.6,
        "bbPosition": 0.72,
        "signal": "NEUTRAL",
        "stdDev": 6.75
      },
      "kdj": {
        "k": 68.5,
        "d": 62.3,
        "j": 80.9,
        "rsv": 68.5,
        "signal": "OVERBOUGHT"
      },
      "obv": {
        "obv": 4820000000,
        "obvMA14": 4750000000,
        "obvTrend": "BULLISH",
        "signal": "BULLISH"
      },
      "vwap": {
        "vwap": 183.25,
        "currentPrice": 185.50,
        "priceDiff": 2.25,
        "priceDiffPercent": 1.22,
        "signal": "ABOVE_VWAP"
      },
      "atr14": 2.10,
      "var95": {
        "varPercent": -3.45,
        "varPrice": 6.39,
        "confidence": 95,
        "interpretation": "At 95% confidence, max 1-day loss is 3.45%"
      },
      "calculatedAt": "2026-03-17T12:00:00.000Z"
    },
    "collectedAt": "2026-03-17T12:00:00.000Z"
  },
  "llmAnalysis": {
    "summary": "...",
    "keyTrends": ["...", "...", "..."],
    "riskFlags": [],
    "marketContext": "..."
  },
  "skillUsed": "market-intelligence"
}
```

## References
- See `references/data-sources.md` for supported data providers and integration notes.
