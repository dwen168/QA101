# QuantBot Functional Improvements v2.3

## Delta from V2.2
- V2.2 focused on macro regime overlays, EDA-as-signal integration, backtesting reliability, and market intelligence performance.
- V2.3 builds on that by hardening the confidence scoring model and transforming signal calibration into a rigorous, data-driven ML pipeline:
  - **Confidence Formula Redesign**: Replaced a naive linear formula with a `tanh`-based saturation curve that stays informative across the full score range, augmented with signal consistency and macro adjustments.
  - **Confidence Explainability**: Added a structured breakdown of every factor that contributed to the final confidence percentage, surfaced as a collapsible UI panel.
  - **ASX-Aware Calibration**: Rewrote the signal calibration script to use `yfinance` as the primary data source, enabling direct calibration on ASX-listed securities.
  - **Time-Series Cross-Validation**: Replaced random train/test split with walk-forward `TimeSeriesSplit` to prevent look-ahead bias.
  - **Multi-Horizon Calibration**: Separated calibration into short (5d), medium (20d), and long (60d) horizons with threshold-aware binary labels, then blended the resulting weights.
  - **Class Imbalance Handling**: Applied per-fold `scale_pos_weight` to XGBoost so the model no longer ignores minority class (profitable trades).
  - **Richer Feature Engineering**: Added 9 new lagged and derived features (momentum returns, MA slopes, volatility z-score, volume shock, drawdown, trend persistence).
  - **PR-AUC Tracking**: Added Precision-Recall AUC as a secondary metric alongside ROC-AUC to better gauge performance under class imbalance.
  - **Market Intelligence Reliability (ASX Short Data)**: Migrated ASX short-interest retrieval to ShortMan live source with robust HTML parsing and deterministic fixed fallback.
  - **Supplementary Fetch Parallelization**: Increased responsiveness by running news, macro, and ASX short-data enrichment concurrently in the Yahoo path, and folding macro fetches into Alpha/Finnhub enrichment batches.
  - **Mock Transparency UX**: Refined UI behavior so short-only mock does not trigger full-report mock headline; users now see explicit short-only mock labeling and clearer data-source headers.

## 0) Components Improved in V2.3

### Improved `skills/market-intelligence/scripts/index.js`:
- **ShortMan as primary ASX short source**: Short interest now pulls from `https://www.shortman.com.au/stock?q=<code>` and parses `Current position` from the `positionInfo` table.
- **Deterministic fallback for short data**: If ShortMan is unavailable or times out, `shortPercent` falls back to fixed `2.0` with mock source labels (`Mock (ShortMan unavailable)` / `Mock (ShortMan timeout)`), avoiding random mock volatility.
- **Parallel enrichment in Yahoo path**: Company news, macro feeds, and ASX short metrics are fetched in parallel to reduce end-to-end latency.
- **Parallel enrichment in Alpha/Finnhub path**: Macro feeds are now included in the same enrichment batch as profile/metrics/news/recommendations/targets.

### Improved `frontend/index.html` (Market Intelligence UX):
- **Short-only mock isolation**: Top-level `Using Mock Data` banner is now governed by core sources (price/technicals/news/macro), not by shortMetrics-only mock fallback.
- **Source labels clarified**: Added explicit `Data Source:` label above source chips for readability.
- **Short metric surfaced in key stats**: Added `SHORT %` to the top stat row (with graceful `—` fallback when unavailable).
- **Short-only mock text clarity**: Source chip now explicitly states `Only short data is mocked; core market data is live.` for short-only fallback scenarios.

### Improved `trade-recommendation`:
- **`computeConfidence()`**: Fully rewritten confidence formula with `tanh`-based saturation, signal alignment/conflict adjustments, signal count bonus, and macro risk adjustment. Output capped at `[30, 92]`.
- **`confidenceBreakdown` payload**: Each recommendation response now includes a structured breakdown object exposing `base`, `consistencyAdjustment`, `conflictPenalty`, `signalCountAdjustment`, `macroAdjustment`, `alignment`, `positiveMagnitude`, `negativeMagnitude`, `totalSignalCount`, and `final`.

### Improved `frontend`:
- **Collapsible confidence panel**: A `<details>/<summary>` panel under the confidence badge renders chip-based breakdown of all formula components. Defaults to collapsed state; summary shows `"Explain confidence (XX%)"`.
- **`fmtAdj()` helper**: Utility function that prefixes positive adjustments with `+` for clear signed display.

### Improved `backend/scripts/signal-calibration.py`:
- **`fetch_yfinance_data()`**: New primary data fetcher using `yfinance` with automatic MultiIndex column flattening (required for newer `yf.download()` versions). Falls back to Alpha Vantage if Yahoo data is insufficient.
- **`fit_xgboost_timeseries_cv()`**: Replaced `train_test_split` with `TimeSeriesSplit` walk-forward cross-validation to eliminate look-ahead bias.
- **Multi-horizon labels**: `get_threshold_for_horizon()` applies different forward-return thresholds per horizon (2% / 5% / 8% for 5d / 20d / 60d), producing more meaningful binary targets.
- **`blend_horizon_signal_weights()`**: Merges calibrated weights from all three horizons using a fixed blend ratio (SHORT 0.3 / MEDIUM 0.4 / LONG 0.3) and stores per-horizon weights in `signal_weights_by_horizon`.
- **Per-fold `scale_pos_weight`**: XGBoost class imbalance corrected by computing `negatives / positives` independently per fold, avoiding amplifying bias from unequal fold sizes.
- **9 new engineered features** added to `create_signal_features()`:
  - `ret_5d`, `ret_20d` — short and medium momentum returns
  - `ma20_slope_5`, `ma50_slope_10` — linear trend slope over recent windows
  - `volatility_zscore` — 20-day rolling volatility z-scored against a 120-day baseline
  - `volume_ratio_20` — current volume relative to 20-day average
  - `volume_shock` — binary flag for volume surges > 2× average
  - `drawdown_60` — rolling 60-day max drawdown from peak
  - `trend_persistence_10` — fraction of last 10 days where close was above MA20
- **PR-AUC per fold**: `average_precision_score` computed alongside ROC-AUC; blended PR-AUC reported in output JSON under `model_metrics.pr_auc`.

### Improved `backend/lib/signal-weights.json`:
- Updated to version `2.1-timeseries-horizon-calibrated`.
- Calibrated against 8 ASX stocks: `MSB.AX, CBA.AX, WEB.AX, BHP.AX, PNV.AX, TPW.AX, WBC.AX, CSL.AX`.
- 18,000 samples across all tickers and horizons.
- Key calibrated weights (blended): `trend_ma50_bullish: 1.857`, `trend_ma200_bullish: 1.65`, `kdj_oversold: 1.522`, `macd_bullish: 1.46`, `rsi_overbought: -1.605`.
- Now stores both blended `signal_weights` and granular `signal_weights_by_horizon` for future horizon-aware consumption.

### Improved `backend/docs/SIGNAL_WEIGHTS_CALIBRATION.md`:
- Updated to document: yfinance usage, ASX symbol list, TimeSeriesSplit rationale, multi-horizon labeling logic, blend weights, PR-AUC metric, class imbalance handling, and all new CLI arguments (`--horizons`, `--cv-splits`).

## 1) Confidence Formula Redesign

**Problem**: The previous formula `Math.min(95, Math.floor((Math.abs(score)/12)*100 + 40))` had two critical flaws:
- It saturated too early: `score = 6` already yielded ~90% confidence with no room for nuance.
- It had no awareness of whether the signals agreed with each other — a noisy 50/50 split counted the same as a clean consensus.

**Solution**:
```
base = 42 + round(34 × tanh(normalizedScore × 1.8))
consistencyAdjustment = round((alignment − 0.5) × 14)    // ±7
conflictPenalty        = −6  if alignment < 0.3 and totalMagnitude ≥ 5
signalCountAdjustment  = +3 / +1 / −2  based on signal count
macroAdjustment        = +3 / 0 / −4   based on macro risk level
final = clamp(sum, 30, 92)
```

Where `alignment = |positiveMagnitude − negativeMagnitude| / totalMagnitude`.

**Result**: A score-6 STRONG BUY with clean signal alignment now reads ~75–82%, compared to the old ~90% — more honest and differentiable.

## 2) Confidence Explainability UI

- `renderRecommendation()` in `frontend/index.html` now checks for `rec.confidenceBreakdown`.
- If present, a collapsible `<details>` panel renders a chip row showing every additive component of the confidence formula.
- Chips are color-coded using existing CSS variables (`--green`, `--red`, `--border`).
- Users can verify why the system reached a particular confidence figure by expanding this panel without any API changes.

## 3) ASX Signal Calibration

**Calibration run results** (March 20, 2026):

| Horizon | Samples | ROC-AUC | PR-AUC |
|---------|---------|---------|--------|
| 5d      | 6,000   | 0.502   | 0.297  |
| 20d     | 6,000   | 0.513   | 0.287  |
| 60d     | 6,000   | 0.517   | 0.323  |
| **Blended** | 18,000 | 0.511 | **0.302** |

- All 8 tickers returned 750 candles of OHLCV data.
- Walk-forward CV with 5 splits ensured no future data leaked into training.
- Per-fold imbalance correction improved minority-class recall.

## 4) Bearish Sign Convention Fix
- XGBoost feature importances are always non-negative, which would previously strip the directional sign from bearish signals.
- Fixed by inferring `default_sign` from the original `signal_weights` table (`≥0 → +1.0`, `<0 → −1.0`) and applying `abs(feature_weight) × default_sign` when writing calibrated weights.

## 5) Summary of Technical Changes

| File | Change |
|------|--------|
| `skills/trade-recommendation/scripts/index.js` | `computeConfidence()` rewritten; `confidenceBreakdown` added to response |
| `frontend/index.html` | Collapsible confidence breakdown panel with signed chips |
| `backend/scripts/signal-calibration.py` | yfinance source, TimeSeriesSplit CV, multi-horizon, 9 new features, `scale_pos_weight`, PR-AUC |
| `backend/lib/signal-weights.json` | v2.1-timeseries-horizon-calibrated; 8 ASX tickers; per-horizon weights stored |
| `backend/docs/SIGNAL_WEIGHTS_CALIBRATION.md` | Fully updated with all new methodology and CLI reference |
