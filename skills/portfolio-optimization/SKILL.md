---
name: portfolio-optimization
description: >
  Analyzes multiple stocks in a portfolio context, computing correlation matrices,
  sector rotation insights, and multi-factor scores to rank and recommend the
  optimal securities. Produces a ranked buy/hold/sell action list with diversification
  metrics and relative value comparison, with macro-regime overlays (geopolitical,
  monetary-policy, and market-stress context) applied to scoring and allocations.
metadata:
  version: "1.0.0"
  author: QuantBot
  inputs:
    - name: tickers
      type: array
      description: List of stock ticker symbols (e.g., ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA'])
      required: true
    - name: useMarketData
      type: array
      description: Optional pre-fetched MarketIntelligenceReport objects for each ticker; if empty, will fetch live
      required: false
    - name: timeHorizon
      type: string
      description: Investment horizon - SHORT (< 2 weeks), MEDIUM (2-8 weeks), LONG (> 2 months)
      required: false
      default: MEDIUM
  outputs:
    - name: PortfolioAnalysis
      type: object
      description: Ranked ticker list, correlation matrix, sector grouping, factor scores, and allocated recommendations
  tags:
    - finance
    - portfolio
    - multi-factor
    - correlation
    - sector-rotation
---

# Skill: portfolio-optimization

## Purpose
Transform a basket of stocks into an actionable portfolio recommendation. Rank stocks by multi-factor scores, visualize sector rotation opportunities, compute pair-wise correlations, and suggest optimal weighting based on risk/return profiles.

## Execution Steps

### Step 1 — Collect Stock Market Data
Input: Array of tickers, optionally pre-computed MarketIntelligenceReport objects.
- If `useMarketData` provided: validate and use existing data
- Else: fetch market data for each ticker via market-intelligence skill (run in parallel)
- Return early with error if any ticker fails validation or critical API calls fail

### Step 2 — Compute Multi-Factor Score for Each Stock

For each ticker, calculate:

#### 2a. Momentum Score (0–100)
```
momentum = (price_change_1d% + price_change_5d% + price_change_1m%) / 3
slope = (current_price - ma50) / ma50 * 100
momentumScore = min(100, max(0, 50 + slope + momentum))
```

#### 2b. Quality Score (0–100)
```
qualityScore = 0
if pe > 0 and pe < 30: qualityScore += 25        (valuation not extended)
if eps > 0 and eps_growth_positive: qualityScore += 25   (earnings positive)
if sentiment_score > 0: qualityScore += 25       (positive sentiment)
if analyst_upside > 10%: qualityScore += 25      (consensus price target support)
```

#### 2c. Risk-Adjusted Score (0–100)
```
volatilityRank = (stock_vol - min_vol) / (max_vol - min_vol) * 100
riskScore = 100 - volatilityRank
if rsi > 70: riskScore -= 15  (overbought)
if rsi < 30: riskScore += 10  (oversold contrarian)
riskAdjustedScore = max(0, min(100, riskScore))
```

#### 2d. Composite Multi-Factor Score
```
compositeScore = (
  momentumScore * 0.30 +
  qualityScore * 0.40 +
  riskAdjustedScore * 0.30
)
// Weighted: quality > momentum > risk
```

### Step 3 — Compute Correlation Matrix
From price history of all tickers (30-day, if available):
- Log-return each stock's daily prices
- Compute Pearson correlation coefficient for each pair
- Return NxN matrix (N = number of tickers)
- Identify high-correlation pairs (> 0.75) and low-correlation pairs (< 0.3) for diversification insight

### Step 4 — Group by Sector & Identify Rotation Opportunity
- Map each ticker to its sector (from market-intelligence data)
- Group tickers by sector
- For each sector, compute aggregate:
  - Average sentiment score
  - Average momentum
  - Average quality
  - Sector strength score (0–100)
- Identify best-performing sector(s) vs. worst-performing

### Step 5 — Rank and Action Assignment
Sort tickers by composite score (descending).
Assign action based on score and market conditions:

| Score Range | Action | Allocation |
|-------------|--------|------------|
| ≥ 75 | STRONG BUY | 8–10% per position |
| 60–74 | BUY | 5–7% per position |
| 45–59 | HOLD | 3–5% per position |
| 30–44 | REDUCE | 1–3% per position |
| < 30 | SELL | 0% (exit) |

Allocations should sum to ≤ 100% (allow cash buffer).

### Step 5B — Macro Regime Overlay
- Aggregate `macroContext` from each ticker's market-intelligence output into a portfolio-level macro regime.
- When macro risk is HIGH, apply defensive score penalties and reduce position sizing; when LOW, allow mild risk-on tilts.
- Apply additional sector-specific adjustments when dominant macro themes directly pressure sector exposures.

### Step 6 — Diversification Metrics
Compute:
- **Correlation-weighted concentration**: sum of (allocation[i] × allocation[j] × corr[i,j]) for all i,j
- **Sector concentration**: largest sector % of total allocation
- **Idiosyncratic risk**: average pairwise correlation (lower is better)

### Step 7 — LLM Narrative
Send to LLM:
- Ranked ticker list + scores
- Top sector opportunity + reason
- Diversification summary
- Risk warnings

Request JSON output:
- `executiveSummary` — 1–2 sentences on portfolio thesis
- `sectorRotationInsight` — Which sectors are rotating in/out and why
- `diversificationAssessment` — Are we sufficiently diversified? Any concentration risks?
- `recommendations` — Plain-English actionable steps (e.g., "Overweight tech momentum, underweight utilities")
- `riskWarnings` — Array of portfolio-level risks (e.g., "High correlation to tech sector", "All picks are momentum-heavy")

## Output Schema
```json
{
  "rankedTickers": [
    {
      "rank": 1,
      "ticker": "NVDA",
      "name": "NVIDIA Corp.",
      "sector": "Semiconductors",
      "action": "STRONG BUY",
      "compositeScore": 82.5,
      "allocation": 8,
      "scores": {
        "momentum": 85,
        "quality": 78,
        "riskAdjusted": 80
      },
      "priceTarget": 1000,
      "upside": 15.2,
      "sentiment": 0.65
    }
  ],
  "correlationMatrix": {
    "tickers": ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"],
    "matrix": [
      [1.0, 0.72, 0.68, 0.85, 0.52],
      [0.72, 1.0, 0.71, 0.79, 0.55],
      [...],
    ]
  },
  "sectorAnalysis": {
    "byIndustry": [
      {
        "sector": "Semiconductors",
        "tickers": ["NVDA"],
        "allocation": 8,
        "avgSentiment": 0.65,
        "avgMomentum": 85,
        "sectorStrength": 85
      }
    ],
    "topSector": "Semiconductors (strength: 85)",
    "worstSector": "Utilities (strength: 25)"
  },
  "diversificationMetrics": {
    "correlationWeightedConcentration": 0.42,
    "avgPairwiseCorrelation": 0.68,
    "sectorConcentration": 0.35,
    "riskAssessment": "MODERATE - Tech-heavy with high internal correlation"
  },
  "portfolioMetrics": {
    "totalAllocation": 85,
    "cashBuffer": 15,
    "expectedReturn": 12.5,
    "expectedVolatility": 18.2,
    "sharpeRatio": 0.69
  },
  "llmNarrative": {
    "executiveSummary": "Portfolio is tilted toward semiconductor and AI momentum with moderate diversification. Recommend increasing exposure to non-correlated sectors for risk control.",
    "sectorRotationInsight": "Semiconductors and cloud infrastructure are rotating in; utilities and consumer staples remain weak.",
    "diversificationAssessment": "73% of allocation is tech-correlated. Consider adding financials, healthcare, or energy for cross-sector balance.",
    "recommendations": [
      "Overweight NVDA and MSFT on AI tailwinds",
      "Add one healthcare or financial position for diversification",
      "Consider XLU (utilities) as hedge if tech pullback risk high"
    ],
    "riskWarnings": [
      "High correlation within tech cluster (>0.80)",
      "Portfolio momentum-heavy; vulnerable to sentiment reversal",
      "Sector concentration risk: 73% in Technology"
    ]
  },
  "skillUsed": "portfolio-optimization"
}
```

## Notes
- **Correlation matrix computation**: Use daily log returns over 30-day window (if available). Handle missing data gracefully (NaN → 0 correlation).
- **Fallback factors**: If market data incomplete, use available fields and note lowered confidence.
- **Time horizon**: SHORT horizon emphasizes momentum + quality; MEDIUM emphasizes balance; LONG emphasizes quality + valuation.
- **Position sizing**: Allocations are theoretical; actual portfolio construction should apply Kelly Criterion, portfolio constraints (min/max per position), and user risk budget.

## References
- See `references/multi-factor-model.md` for detailed factor definitions and calibration notes.
