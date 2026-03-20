---
name: market-intelligence
description: >
  Collects and synthesizes real-time market intelligence for a given stock ticker.
  Validates the ticker, retrieves price data and technical indicators (MA, RSI),
  fetches recent news headlines with sentiment scores, and aggregates analyst
  consensus ratings into a structured MarketIntelligenceReport with a rule-based
  market summary.
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

### Step 2 — Fetch Price Data & Core Market Metrics (Live, Timeout-Protected)
Collect the following price metrics from live APIs:
- **Current price**, previous close, change ($), change (%)
- **52-week high** and **52-week low**
- **Market cap**, P/E ratio, EPS
- **Volume** (today) and **average volume** (30-day)
- **30-day+ OHLCV history** (date, open, high, low, close, volume for each day)

**Live Data Sources:**
- **US/International tickers** (AAPL, MSFT, etc.): Yahoo Finance (yfinance library)
  - Default timeout: 10 seconds. If exceeded, entire market data falls back to mock.
  - International tickers (with `.` notation) always use Yahoo Finance (e.g., `MSB.AX` for ASX)
- **US domestic tickers** (AAPL, TSLA, etc., without `.`): Try Finnhub first, fall back to Alpha Vantage
  - Finnhub timeout: 5 seconds
  - Alpha Vantage timeout: 10 seconds

**Fallback to Mock Data:**
- If core price/OHLCV data times out or API fails, generate a complete mock `MarketData` object with synthetic:
  - Price history (100 candles with realistic walk-forward volatility)
  - Technical indicators (MA20, MA50, MA200, RSI, MACD, etc.)
  - Analyst consensus (random counts and targets)
  - News (empty array, triggering fallback label)
- Mark in response: `dataSource: "mock"`, `fallbackReason: "<error message>"`
- This ensures core recommendation logic never breaks, but UI clearly shows fallback status

**Timeout Safety:**
- Core price fetch is wrapped in `Promise.all([chart_fetch, summary_fetch])` with timeout enforcement
- If price data fails/times out → entire response is mock
- Supplementary data (news, short metrics, macro) failures → continue with partial data (see Step 3B–4B below)

**Parallel Orchestration (Performance):**
- Yahoo (`.AX` and other international) path runs **company news + macro news + short metrics** in parallel
- Finnhub/Alpha enrichment path runs **profile + metrics + company news + recommendations + price targets + macro feeds** in parallel where available
- `Promise.allSettled` is used for supplementary fetches so partial failures do not block successful sources

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

### Step 4 — Retrieve News & Sentiment (Supplementary, Partial Failures Acceptable)
Collect relevant company news headlines. Unlike core price data, **partial news fetch failures do NOT trigger full mock response.**

**Live Data Sources (Parallel Fetch):**
1. **Yahoo Finance News Search** — For international tickers (`.AX`, `.HK`, etc.)
   - Tries `yf.search(ticker, { newsCount: 5, quotesCount: 0 })`
   - Timeout: 5 seconds
   
2. **ASX Company Announcements API** (ASX tickers only `xx.AX`)
   - Direct HTTP fetch from `https://www.asx.com.au/asx/1/company/{CODE}/announcements`
   - No API key required. Returns official price-sensitive announcements.
   - Timeout: 5 seconds
   
3. **Google News RSS** (ASX tickers only)
   - RSS feed from `https://news.google.com/rss/search?q={TICKER}+ASX`
   - Covers Australian media (AFR, SMH, The Australian)
   - Timeout: 5 seconds

**News Processing:**
- Collect headlines; limit to 5–8 per source
- Score sentiment using **rule-based keyword logic** (positive/negative keyword matching, no LLM inference)
- Aggregate across sources; deduplicate by title
- Preferred headlines: explicitly mention ticker or company name
- Fallback: if no named headlines found, use all headlines (common for small-cap ASX stocks)

**Failure Handling:**
- If all news sources timeout/fail → return `news: []`, `dataSourceBreakdown.news: "No news found"`
- If some sources succeed (e.g., Yahoo + Google but ASX fails) → merge successful sources, mark appropriately
- No mock news is generated; empty or partial subset is acceptable
- UI displays: "No news found" with gray badge, or lists available sources (Yahoo Finance, ASX, Google News)

**Supplementary News:** Do NOT call LLM for brief sentiment scoring on every headline; use LLM only for **relevant company news**:
- LLM is called on relevant company headlines to refine rule-based sentiment
- LLM receives 5–8 headlines per call with company context
- Timeout: 5 seconds for LLM call

### Step 4C — Retrieve Macro & Geopolitical Context (Supplementary, Partial Failure Acceptable)
Collect and score recent macro headlines that can move the broader market. Unlike core price data, **macro data failure does NOT trigger full mock response.**

**Live Data Sources (Parallel Fetch):**
1. **Finnhub Macro News**
   - Endpoint: `https://finnhub.io/api/v1/company-news?symbol=^DJI` (market-wide)
   - Timeout: 5 seconds
2. **NewsAPI Global News**
   - Endpoint: Query for broad market keywords (stock market, Fed, inflation, oil, geopolitics)
   - Timeout: 5 seconds

**Macro Processing:**
- Collect 8 recent macro headlines
- Tag each with theme: `GEOPOLITICS`, `MONETARY_POLICY`, `POLITICS_POLICY`, `ENERGY_COMMODITIES`, `MARKET_STRESS`, `SUPPLY_CHAIN`, or `GENERAL_MACRO`
- Call LLM to refine sentiment scores and theme confidence (timeout: 5 seconds; skip if LLM unavailable)
- Aggregate feed into `macroContext` object with sentiment, risk level, dominant themes, and stock-specific impact notes

**Failure Handling:**
- If both Finnhub and NewsAPI timeout → return `macroContext.available: false`, `macroNews: []`
- If one source succeeds → use available data
- UI displays: "No macro context" or lists available sources
- Recommendation engine uses sensible defaults if macro data unavailable (assume "MEDIUM" risk)

### Step 5B — Retrieve ASX Short Selling Interest (ASX Tickers Only, Supplementary)
For tickers ending in `.AX` (Australian Securities Exchange), fetch and score short interest data. **Short data failure does NOT trigger full mock response.**

**Live Data Sources (Try in Order):**
1. **ShortMan stock page** — Primary live source (aggregated from ASIC)
  - Endpoint pattern: `https://www.shortman.com.au/stock?q=<asx_code_lowercase>`
  - Parsed field: **Current position** (short %)
  - Data note: ShortMan reflects ASIC series with T+4 delay
  - Timeout: 5 seconds

2. **Mock Short Data (fixed fallback)**
  - If ShortMan fetch/parsing fails, return fixed fallback
  - Fallback value: `shortPercent: 2.0`, `shortTurnover: 0`
  - Marked as `dataSource: "Mock (ShortMan unavailable)"` or `"Mock (ShortMan timeout)"`, `isMock: true`

**Short Data Processing:**
- Extract `shortPercent` (short position as % of float); `shortTurnover` may be `0` when unavailable
- Mark data source as either "ShortMan (ASIC aggregated)" or ShortMan-related mock source labels
- Return as `shortMetrics` object with source label

**Failure Handling:**

**Selective Fallback Strategy** (v2.0+) — Compare old vs. new behavior:

| Scenario | New Logic |
|----------|-----------|
| Short data timeout | ✅ Price + Technical + News real + Short mock |
| News fetch failure | ✅ Price + Technical + Recommendation real + News empty |
| Macro news failure | ✅ Other data real + Macro empty |

Granular fallback rules:
- Timeout or parse failure on ShortMan → fall back to fixed mock `2.0%`
- **All failures degrade gracefully; recommendation continues with `shortMetrics` available but marked as mock**
- UI shows short source as mock, but this does **not** imply full-report mock
- Top-level "Using Mock Data" headline is driven by core data state; short-only mock does not trigger it
After all data fetches complete, compile a **`dataSourceBreakdown`** object documenting the source of each major data category:

```json
"dataSourceBreakdown": {
  "price": "Yahoo Finance (Real)",        // or "Mock" if timeout
  "technicals": "Yahoo Finance (Real)",   // computed from real/mock price history
  "news": "Yahoo + ASX + Google (Real)" | "No news found" | "Mock",
  "shortMetrics": "ShortMan (ASIC aggregated)" | "Mock (ShortMan unavailable)" | "Mock (ShortMan timeout)",
  "macro": "Finnhub + NewsAPI (Real)" | "No macro news" | "Unavailable"
}
```

**Purpose:**
- Frontend displays these labels next to each data section (price, news, short metrics, macro context)
- Users see at a glance which data is live, cached, or mock
- Distinguishes between "no data fetched" (e.g., no news available) vs. "data is mock" (e.g., API timeout)
- UI color codes: green = Real, yellow = Mock, gray = Unavailable/No data

**Behavioral Guarantees:**
1. **If core price data is real** → recommendation engine has high confidence, uses all available signals
2. **If core price data is mock** → recommendation engine discloses fallback prominently, uses caution
3. **If any supplementary data is mock/missing** (news, short, macro) → recommendation engine works normally, but those signals are absent or muted

### Step 6 — Analyst Consensus
Aggregate analyst ratings:
- Counts: strongBuy, buy, hold, sell, strongSell
- Price targets: targetHigh, targetLow, targetMean
- Upside % = (targetMean − currentPrice) / currentPrice × 100

### Step 6 — Synthesize Report (Rule-Based)
Using all data collected above, produce a JSON `llmAnalysis` object with:
- `summary` — 2–3 sentences describing the current market situation
- `keyTrends` — array of 3 concise trend observations
- `riskFlags` — array of risk factors (may be empty)
- `marketContext` — 1 sentence on the broader macro/sector context

The output key remains `llmAnalysis` for response compatibility, but the content is generated deterministically rather than by an LLM.

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
    "dataSource": "alpha-vantage",
    "fallbackReason": null,
    "collectedAt": "2026-03-17T12:00:00.000Z"
  },
  "llmAnalysis": {
    "summary": "...",
    "keyTrends": ["...", "...", "..."],
    "riskFlags": [],
    "marketContext": "..."
  },
  "skillUsed": "market-intelligence",
  "dataSource": "alpha-vantage",
  "usedFallback": false,
  "fallbackReason": null
}
```

## References
- See `references/data-sources.md` for supported data providers and integration notes.
