# Quant Stock Analysis - Improvement v2.5 (Shared Signal Engine: Backtest ↔ Trade Recommendation)

## Overview

V2.5 unifies the `trade-recommendation` signal core and the `backtesting` strategy named `trade-recommendation`.

Before this release, backtesting used a simplified standalone scorer, so historical validation was not actually testing the same engine as the live recommendation path. After v2.5, both paths share the same technical scoring core, the same calibrated weights, and the same time-horizon multipliers.

---

## Core Changes

### 1. Shared Scoring Core

**Modules Affected**:
- `skills/trade-recommendation/scripts/modules/scoring.js`
- `skills/backtesting/scripts/index.js`

**Implemented**:
- Added `scoreBacktestSnapshot(priceHistory, currentIndex, timeHorizon)`.
- Backtest `trade-recommendation` signals now call the same `scoreSignals()` core used by live recommendations.
- Snapshot scoring uses price-derivable inputs only and supplies neutral defaults for unavailable live-only context.
- `runBacktest()` now propagates the selected time horizon into signal generation.

**Result**:
- Shared technical logic across live recommendation and historical replay.
- Same calibrated weights.
- Same SHORT / MEDIUM / LONG multiplier behaviour.

### 2. Backtest Transparency

**Module Affected**:
- `skills/backtesting/scripts/index.js`

**Implemented**:
- Added `signalEngine` metadata to the backtest report.
- Added `priceHistory` to backtest output.
- Added per-trade `entryPrice`, `exitPrice`, `pnlDollars`, and `balanceAfter`.

**Result**:
- Backtest output now makes it explicit which signal engine was used and what data coverage it had.

---

## Execution and Risk Alignment

### 3. ATR-Based Exit Logic in Backtesting

**Module Affected**:
- `skills/backtesting/scripts/index.js`

**Implemented**:
- Added `calculateATR(...)` for historical bars.
- Replaced fixed-percentage stop-loss / take-profit exits with ATR-based dynamic exit prices.
- Stored `atrAtEntry`, `stopLossPrice`, and `takeProfitPrice` per position.
- Kept percentage fallback if ATR is unavailable due to insufficient warmup bars.

### 4. ATR Exit Alignment Across Live and Backtest

**Modules Affected**:
- `skills/trade-recommendation/scripts/modules/profiles.js`
- `skills/trade-recommendation/scripts/index.js`
- `skills/backtesting/scripts/index.js`

**Aligned Multipliers**:

| Horizon | Stop-Loss | Take-Profit |
|---|---:|---:|
| `SHORT`  | `1.2 × ATR14` | `2.0 × ATR14` |
| `MEDIUM` | `1.5 × ATR14` | `2.5 × ATR14` |
| `LONG`   | `2.0 × ATR14` | `4.0 × ATR14` |

**Result**:
- Entry logic and exit logic are now aligned across recommendation and backtesting, not just the signal score.

---

## Frontend and Explainability

### 5. Backtest Visualization Upgrade

**Modules Affected**:
- `skills/backtesting/scripts/index.js`
- `frontend/js/app.js`

**Implemented**:
- Default initial capital reduced to `$1,000`.
- Added candlestick/K-line backtest chart with BUY / SELL markers.
- SELL markers show realized `$P&L`.
- Retained compact portfolio balance chart.
- Expanded trade log to show buy/sell dates, buy/sell prices, `% return`, `$ P&L`, balance, and exit reason.

### 6. Strict Factor Attribution Fix

**Modules Affected**:
- `skills/trade-recommendation/scripts/modules/decision-tree.js`
- `skills/trade-recommendation/scripts/modules/scoring.js`
- `skills/trade-recommendation/scripts/modules/profiles.js`
- `frontend/js/app.js`

**Implemented**:
- Removed `Risk Penalty` as an additive pillar.
- Replaced it with a separate `Bearish Pressure` summary.
- Added a dedicated `fundamental` bucket for earnings-surprise momentum.
- Reclassified `Earnings Beat` / `Earnings Miss` out of technical momentum.
- Added `Other Drivers` fallback support for uncategorized scored signals.

**Result**:
- The attribution panel is now a cleaner factor breakdown instead of a partially double-counted explanation surface.

### 7. Two-Level Recommendation Explanation

**Modules Affected**:
- `frontend/index.html`
- `README.md`

**Implemented**:
- Replaced `How it Works` with `Flow Overview` for the high-level view.
- Added a separate `Recommendation Algorithm Specification` modal.
- Detailed spec now documents:
  - scoring equation
  - bucket families
  - horizon multipliers
  - overlay layers
  - exact action thresholds
  - confidence calculation rules
  - ATR exit equations
  - module boundaries
- README ATR documentation updated to the full SHORT / MEDIUM / LONG table.

---

## Historical Context Clarification

### 8. Historical Pattern Analogs Positioning

**Modules Affected**:
- `skills/trade-recommendation/scripts/modules/historical.js`
- `frontend/index.html`

**Clarified**:
- `Historical Pattern Analogs` is not a backtest.
- It is a historical analog scan using RSI zone and MA50-relative price state.
- It reports forward `5d` / `10d` outcomes for similar prior setups.

**Result**:
- Strategy validation remains the role of backtesting.
- Historical analogs remain explanatory context only.

---

## What Did Not Change

- `macd-bb` and `rsi-ma` remain standalone backtest strategies.
- Live recommendation still uses the same `scoreSignals()` entry point.
- The LLM rationale layer is still separate from backtesting.
- Backtest replay still cannot reconstruct historical live-only context such as sentiment, macro headlines, analyst revisions, or release timing.

---

## Version Summary

V2.5 started as a shared-signal-engine release and ended as a broader consistency release.

It now provides:
- shared technical scoring logic between live recommendation and backtest replay
- aligned ATR-based risk management across both paths
- improved backtest execution visibility
- stricter factor attribution
- clearer separation between high-level flow, detailed algorithm specification, and historical analog context

The result is a recommendation and backtest system that is more internally consistent, easier to audit, and more defensible when comparing live calls with historical behaviour.
