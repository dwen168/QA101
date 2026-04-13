---
name: backtesting
description: >
  Backtests a trading strategy against historical data. Simulates buy/sell signals,
  computes performance metrics (Sharpe ratio, max drawdown, win rate, PnL),
  and generates a detailed performance report for validation before live trading.
metadata:
  version: "1.0.0"
  author: QuantBot
  inputs:
    - name: ticker
      type: string
      description: Stock ticker symbol (e.g., 'AAPL')
      required: true
    - name: strategyName
      type: string
      description: Strategy identifier (e.g., 'trade-recommendation', 'macd-bb-confluence')
      required: true
    - name: startDate
      type: string
      description: Backtest start date (YYYY-MM-DD, ISO format, e.g., '2025-01-01')
      required: true
    - name: endDate
      type: string
      description: Backtest end date (YYYY-MM-DD, ISO format, e.g., '2026-03-18')
      required: true
    - name: initialCapital
      type: number
      description: Starting portfolio value in USD (default 10000)
      required: false
      default: 10000
    - name: signalFunction
      type: string
      description: "Signal generator: 'trade-recommendation' (uses 15+ signals), 'macd-bb' (MACD × BB), 'rsi-ma' (RSI + MA combos)"
      required: false
      default: trade-recommendation
  outputs:
    - name: BacktestReport
      type: object
      description: Complete backtest results with performance metrics and trade log
  tags:
    - backtesting
    - validation
    - performance
    - sharpe-ratio
    - drawdown
    - signal-analysis
---

# Skill: backtesting

## Purpose
Validate a trading strategy by replaying historical market data and simulating buy/sell signals.
Measure performance using industry-standard metrics: Sharpe ratio, max drawdown, win rate, profit factor.
Identify whether your trading signal (e.g., trade-recommendation score) has **predictive power**.

## Execution Steps

### Step 1 — Fetch Historical Data
Input: ticker, startDate, endDate (e.g., 2025-01-01 to 2026-03-18)
- Fetch daily OHLCV data from Alpha Vantage, then Yahoo Finance as fallback
- Apply configurable per-source timeouts so slow live requests do not block the backtest indefinitely
- Store as array: [{ date, open, high, low, close, volume }, ...]
- Minimum: 100 candles; optimal: 500+ days
- Record the resolved `dataSource` used for the backtest report

### Step 2 — Generate Trading Signals
For each day in the period, compute the signal using the specified strategy:

#### Signal: trade-recommendation (default)
- Compute all 15 signals (MA50, RSI, MACD, BB, KDJ, OBV, VWAP, sentiment, analyst, etc.)
- Score aggregation → score in range [-12, +12]
- Action:
  - score ≥ 6 → **STRONG BUY** (buy signal)
  - score ≥ 3 → **BUY** (buy signal)
  - −2 ≤ score ≤ 2 → **HOLD** (no action)
  - score ≤ −3 → **SELL** (sell/close signal)

#### Signal: macd-bb (alternative)
- MACD bullish crossover + BB oversold → **BUY**
- MACD bearish crossover + BB overbought → **SELL**

#### Signal: rsi-ma (simple momentum)
- Price > MA50 + RSI < 30 → **BUY**
- Price < MA50 + RSI > 70 → **SELL**

### Step 3 — Simulate Trades
Walk through each day:
1. Check signal for that day
2. If **BUY** signal:
   - Record entry price = close[day]
   - Record entry date
   - Position active
3. If **SELL** signal (or exit condition):
   - Calculate exit price = close[day]
   - Compute PnL = (exit − entry) / entry × 100%
   - Record trade (entry, exit, PnL, days held)
   - Position closed

**Exit Conditions:**
- Explicit SELL signal (score drops to ≤ −3)
- Stop-loss hit: loss > 3% from entry
- Take-profit hit: gain > 7% from entry
- End of period (force-close remaining position)

### Step 4 — Compute Performance Metrics

#### Key Metrics
| Metric | Formula | Interpretation |
|--------|---------|-----------------|
| **Total Return %** | (endCapital − initialCapital) / initialCapital × 100 | Net gain/loss |
| **Total Trades** | Count of closed trades | Activity volume |
| **Win Rate %** | (winning trades / total trades) × 100 | % of profitable trades |
| **Profit Factor** | (sum of wins) / (sum of losses) | Reward-to-risk ratio |
| **Sharpe Ratio** | (avgReturn − %Risk-Free-Rate) / StdDev(returns) | Risk-adjusted return |
| **Max Drawdown %** | (peakCapital − lowestCapital) / peakCapital × 100 | Worst peak-to-trough decline |
| **CAGR %** | (endCapital / initialCapital)^(1/years) − 1 | Annualized compound return |
| **Average Trade %** | Total Return % / Total Trades | PnL per trade |

#### Calculation Details
```
equity_curve = [initialCapital]
for each trade:
  if trade_profit > 0:
    equity_curve.append(equity_curve[-1] × (1 + trade_pnl%))
  else:
    equity_curve.append(equity_curve[-1] × (1 + trade_pnl%))

sharpe_ratio = (mean(daily_returns) − 0.0003) / stdev(daily_returns) × √252
max_drawdown = min((equity_curve[t] − max(equity_curve[0:t])) / max(equity_curve[0:t]))
```

### Step 5 — Trade Log & Report
Generate detailed report:
- **Trade-by-trade log**: entry date, entry price, exit date, exit price, PnL%, reason
- **Equity curve**: capital over time
- **Signal analysis**: distribution of signals (BUY vs SELL vs HOLD)
- **Drawdown analysis**: drawdown periods, recovery time
- **Risk assessment**: max loss in a single trade, max consecutive losses

### Step 6 — Return Response

## Output Schema
```json
{
  "backtestReport": {
    "ticker": "AAPL",
    "strategyName": "trade-recommendation",
    "dataSource": "alpha-vantage",
    "period": {
      "startDate": "2025-01-01",
      "endDate": "2026-03-18",
      "tradingDays": 253
    },
    "capital": {
      "initial": 10000,
      "final": 118500,
      "totalReturn": 18.5
    },
    "performanceMetrics": {
      "totalTrades": 24,
      "winRate": 60.8,
      "profitFactor": 2.14,
      "sharpeRatio": 1.42,
      "maxDrawdown": -8.3,
      "cagr": 15.2,
      "avgTradeReturn": 0.77
    },
    "tradeLog": [
      {
        "tradeId": 1,
        "entryDate": "2025-01-15",
        "entryPrice": 150.25,
        "exitDate": "2025-01-28",
        "exitPrice": 158.30,
        "pnlPercent": 5.36,
        "daysHeld": 13,
        "reason": "SELL signal (score dropped to -4)"
      }
    ],
    "equityCurve": [
      { "date": "2025-01-01", "capital": 10000 },
      { "date": "2025-01-15", "capital": 10000, "action": "BUY", "tradeId": 1 },
      { "date": "2025-01-28", "capital": 105360, "action": "SELL", "tradeId": 1, "pnl": 5360 }
    ],
    "signalDistribution": {
      "buySignals": 45,
      "sellSignals": 23,
      "holdDays": 185
    },
    "drawdownAnalysis": {
      "maxDrawdownValue": 8300,
      "maxDrawdownPercent": -8.3,
      "recoveryDays": 28,
      "drawdownPeriods": [
        {
          "startDate": "2025-03-10",
          "bottomDate": "2025-03-18",
          "recoveryDate": "2025-04-15",
          "maxLoss": -8.3
        }
      ]
    },
    "riskAnalysis": {
      "maxSingleTradeLoss": -3.5,
      "maxConsecutiveLosses": 3,
      "avgWinSize": 2.1,
      "avgLossSize": -1.3,
      "profitToLossRatio": 1.62
    },
    "recommendations": [
      "Strategy shows positive Sharpe ratio (1.42) - risk-adjusted returns are good",
      "Max drawdown of 8.3% is reasonable for a momentum strategy",
      "Win rate of 60.8% is above 50% - trades are more often profitable than not",
      "Recommendation: PROCEED with live trading, but use position sizing based on VaR"
    ]
  },
  "skillUsed": "backtesting"
}
```

## Backtest Quality Checklist

**Minimum viable:**
- ✅ ≥ 100 trades (confidence in stats)
- ✅ Sharpe ratio > 0.5 (positive risk-adjusted return)
- ✅ Win rate > 40% (more profitable trades than losses)

**Good strategy:**
- ✅ ≥ 250 trades over 2+ years
- ✅ Sharpe ratio > 1.0 (strong risk-adjusted return)
- ✅ Win rate > 55% (better than random)
- ✅ Max drawdown < 20%
- ✅ Profit factor > 1.5

**Excellent strategy:**
- ✅ ≥ 500 trades over 3+ years
- ✅ Sharpe ratio > 1.5 (excellent return relative to risk)
- ✅ Win rate > 60%
- ✅ Max drawdown < 15%
- ✅ Profit factor > 2.0

## References
- See `references/backtesting-guide.md` for methodology details, pitfalls, and real-world validation techniques.
- See `references/performance-metrics.md` for formulas and interpretations of Sharpe ratio, drawdown, etc.
