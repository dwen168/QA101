---
name: trade-recommendation
description: >
  Synthesizes market data and EDA insights into an actionable trade recommendation.
  Scores 15+ signals across trend, momentum, RSI, sentiment, analyst consensus, and
  advanced technical indicators (MACD, Bollinger Bands, KDJ, OBV, VWAP), plus
  macro regime overlay signals from market-intelligence (risk-on/off and theme pressure),
  maps the aggregate score to a BUY / HOLD / SELL action with a confidence percentage,
  computes entry, stop-loss, take-profit, and risk/reward, then uses the LLM to
  generate a plain-English rationale and key risk factors.
metadata:
  version: "1.0.0"
  author: QuantBot
  inputs:
    - name: marketData
      type: MarketIntelligenceReport
      description: Full market data object from the market-intelligence skill
      required: true
    - name: edaInsights
      type: object
      description: EDA insights object from the eda-visual-analysis skill (optional)
      required: false
  outputs:
    - name: recommendation
      type: TradeRecommendation
      description: Complete trade recommendation with action, targets, and rationale
  tags:
    - finance
    - recommendation
    - risk-management
    - signal-scoring
---

# Skill: trade-recommendation

## Purpose
Generate a data-driven, risk-aware trade recommendation. This skill is the THIRD and final step in the QuantBot pipeline.

## Execution Steps

### Step 1 — Signal Scoring
Evaluate each signal below and accumulate a total `score`. Each signal adds or subtracts points.

| # | Signal | Condition | Points |
|---|--------|-----------|--------|
| 1 | Price vs MA50 | price > MA50 | +2 |
|   |              | price < MA50 | −2 |
| 2 | Price vs MA200 | price > MA200 | +1 |
|   |               | price < MA200 | −1 |
| 3 | RSI Zone | RSI > 70 (overbought) | −2 |
|   |          | RSI < 30 (oversold, contrarian) | +1 |
|   |          | RSI 45–65 (healthy bullish) | +1 |
| 4 | News Sentiment | sentimentScore > 0.3 | +2 |
|   |                | sentimentScore < −0.3 | −2 |
| 5 | Analyst Consensus | Buy% > 60% | +2 |
|   |                   | Buy% < 30% | −1 |
| 6 | Analyst Price Target | upside > 10% | +1 |
|   |                      | upside < −5% | −1 |
| 7 | Daily Momentum | changePercent > +1.5% | +1 |
|   |               | changePercent < −2.0% | −1 |
| 8 | MACD Signal | MACD bullish crossover | +1 |
|   |            | MACD bearish crossover | −1 |
| 9 | Bollinger Bands | Price oversold (< lower band) | +1 |
|   |                 | Price overbought (> upper band) | −1 |
| 10 | KDJ Stochastic | %K oversold (< 20) | +1 |
|    |                | %K overbought (> 80) | −1 |
| 11 | OBV Trend | OBV rising (bullish) | +1 |
|    |           | OBV falling (bearish) | −1 |
| 12 | VWAP Position | Price > VWAP (institutional support) | +1 |
|    |               | Price < VWAP (institutional resistance) | −1 |
| 13 | Macro Regime | macro risk HIGH / RISK_OFF | −2 to −3 |
|    |              | macro risk LOW / RISK_ON | +1 to +2 |
|    |              | macro-sector theme headwind overlap | −1 |

**Score Range:** −12 to +12 (theoretical max; typical: −8 to +8)

### Step 2 — Map Score to Action
| Score Range | Action | Color |
|-------------|--------|-------|
| ≥ 6 | STRONG BUY | #10b981 |
| 3 – 5 | BUY | #6ee7b7 |
| −2 – 2 | HOLD | #f59e0b |
| −5 – −3 | SELL | #f87171 |
| ≤ −6 | STRONG SELL | #dc2626 |

**Confidence** = min(95, floor(|score| / 12 × 100 + 40)) — expressed as a percentage.

### Step 3 — Compute Price Targets & Risk Metrics

#### 3A. Exit Levels using 14-Day ATR
Using **14-day Average True Range** (more accurate than 52-week range):
```
True Range (TR) = max(High − Low, |High − Close_prev|, |Low − Close_prev|)
ATR(14)         = SMA of last 14 TR values

entry      = currentPrice
stopLoss   = entry − (ATR(14) × 1.5)    [tighter than 52w-based]
takeProfit = entry + (ATR(14) × 2.5)
riskReward = (takeProfit − entry) / (entry − stopLoss)
```

**Why 14-day ATR is better:**
- Captures recent volatility (not extreme 52-week outliers)
- More responsive to current market conditions
- Standard period in technical analysis

#### 3B. Value at Risk (VaR) Estimation
Calculates maximum potential **1-day loss** at given confidence level:
```
Daily Returns = log(close[t] / close[t-1])
Mean           = average of last 20 returns
StdDev         = standard deviation of returns

VaR(95%)  = Mean − 1.645 × StdDev    [95% confidence]
VaR(99%)  = Mean − 2.326 × StdDev    [99% confidence]

VaR % (e.g., -3.45%)           = potential daily loss %
VaR Price (e.g., $5.23/share)  = absolute loss per share
```

**Interpretation:**
- VaR(95%) = In 95 out of 100 days, daily loss ≤ this amount
- Used as risk warning when considering position sizing
- More conservative than ATR-based targets

#### 3C. Response Structure
```json
{
  "recommendation": {
    "entry": 185.50,
    "stopLoss": 182.45,        ← 14-day ATR × 1.5
    "takeProfit": 191.80,      ← 14-day ATR × 2.5
    "riskReward": 2.4
  },
  "riskMetrics": {
    "atr14": 2.10,                    ← 14-day ATR value
    "atrMultiplierSL": 1.5,
    "atrMultiplierTP": 2.5,
    "var95": {
      "varPercent": -3.45,            ← Max 1-day loss %
      "varPrice": 6.39,               ← Max 1-day loss $ per share
      "confidence": 95,
      "interpretation": "At 95% confidence, max 1-day loss is 3.45%"
    }
  }
}
```

### Step 4 — LLM Rationale
Send the following to the LLM:
- Action, score, and all scored signals (name + points)
- Request JSON output with:
  - `rationale` — 2–3 sentences explaining the recommendation
  - `timeHorizon` — SHORT (< 2 weeks), MEDIUM (2–8 weeks), or LONG (> 2 months)
  - `keyRisks` — array of 2–3 specific risk factors
  - `executiveSummary` — 1 plain-English sentence suitable for a non-technical reader

#### Fallback (if LLM unavailable)
Build deterministic defaults from signal data and Buy% value.

### Step 5 — Return Response
```json
{
  "recommendation": {
    "ticker": "AAPL",
    "action": "BUY",
    "actionColor": "#6ee7b7",
    "confidence": 72,
    "score": 4,
    "signals": [
      { "name": "Price > MA50", "points": 2, "reason": "Bullish trend confirmation" },
      { "name": "MACD Bullish", "points": 1, "reason": "MACD above signal line" }
    ],
    "entry": 185.50,
    "stopLoss": 182.45,
    "takeProfit": 191.80,
    "riskReward": 2.4,
    "rationale": "...",
    "timeHorizon": "MEDIUM",
    "keyRisks": ["Market volatility", "Earnings report risk"],
    "executiveSummary": "...",
    "disclaimer": "⚠️ For educational/demo purposes only. Not financial advice."
  },
  "riskMetrics": {
    "atr14": 2.10,
    "atrMultiplierSL": 1.5,
    "atrMultiplierTP": 2.5,
    "var95": {
      "varPercent": -3.45,
      "varPrice": 6.39,
      "confidence": 95,
      "interpretation": "At 95% confidence, max 1-day loss is 3.45%"
    },
    "riskWarnifVarExceeds": {
      "message": "At 95% confidence, max 1-day loss is 3.45%",
      "maxDailyLoss": 6.39,
      "maxDailyLossPercent": 3.45
    }
  },
  "weightingMetadata": {
    "version": "1.0-calibrated-2026-03-18",
    "timestamp": "2026-03-18T12:00:00Z",
    "calibrated": true,
    "metrics": {
      "accuracy": 0.628,
      "f1_score": 0.612,
      "auc": 0.685
    }
  },
  "skillUsed": "trade-recommendation"
}
```

## References
- See `references/risk-factors.md` for a taxonomy of common equity risk factors and position sizing guidance.
- See `references/var-calculation.md` for technical details on Value at Risk estimation.
