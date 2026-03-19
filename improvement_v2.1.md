# QuantBot Functional Improvements v2.1

## Delta from V2.0
- V2.0 focused on international live market-data coverage, ticker routing, and data-source transparency.
- V2.1 builds on that by improving usability, auditability, and standards compliance:
  - portfolio optimization can now be triggered directly from the UI chatbot
  - backtesting can now be triggered directly from the UI chatbot and rendered in the main analysis panel
  - news cards now expose article summaries and direct source links, not just headlines
  - news summaries are collapsible, keeping the interface compact
  - MACD signal-line calculation now follows the standard EMA-based method instead of approximation
  - calibration/training documentation is consolidated into one canonical guide

## 0) Skills Improved in V2.1
- Improved `market-intelligence`:
  - Enriched news payloads with summaries and article links.
  - Improved Yahoo Finance news timestamp parsing.
- Improved `trade-recommendation`:
  - Corrected MACD signal-line calculation to use the standard EMA-based method.
- Improved `portfolio-optimization`:
  - Enabled portfolio requests through the UI chatbot.
- Improved `backtesting`:
  - Enabled chatbot-triggered backtests and frontend report rendering.
  - Improved engine warmup behavior and reporting fidelity.
- Improved `frontend` experience:
  - Added collapsible news summaries.
  - Added portfolio result rendering inside the analysis panel.
  - Added backtest result rendering with summary, metrics, equity curve, and recent trades.

## 1) Portfolio Optimization Is Now Accessible from Chat UI
- Users can now trigger the `portfolio-optimization` skill directly from the chatbot.
- Supported request patterns include:
  - `Optimize portfolio AAPL, MSFT, NVDA`
  - `Rebalance my portfolio TSLA AMZN META for long term`
  - `Optimize portfolio CBA.AX, BHP.AX, MSB.AX`
- Chat routing now supports:
  - multi-ticker extraction
  - portfolio intent detection
  - time-horizon parsing (`SHORT`, `MEDIUM`, `LONG`)
- Frontend now renders portfolio optimization output in the main analysis panel with:
  - portfolio summary
  - ranked ticker list
  - sector analysis
  - portfolio narrative

## 2) News Module Upgraded Beyond Headlines
- News collection is no longer limited to headline-only display.
- `market-intelligence` news items now expose, where available:
  - `title`
  - `summary`
  - `url`
  - `source`
  - `sentiment`
  - `hoursAgo`
- Source-specific behavior:
  - Finnhub typically provides headline + summary + article URL
  - Yahoo Finance provides title + article URL, and summary when available
- This improves explainability because users can now inspect the actual article context behind sentiment signals.

## 3) Better News UX in Frontend
- Breaking News cards now support:
  - clickable article titles
  - `Read article` links
  - collapsible summaries using a compact default layout
- Result:
  - cleaner visual presentation
  - less panel clutter
  - better traceability from sentiment signal to source article

## 4) MACD Calculation Corrected to Standard Method
- The previous MACD implementation used a simplified approximation for the signal line.
- V2.1 updates `technical-indicators` to use the standard MACD(12,26,9) workflow:
  - `EMA12(close)`
  - `EMA26(close)`
  - `MACD line = EMA12 - EMA26`
  - `Signal line = EMA9(MACD line series)`
  - `Histogram = MACD - Signal`
- This makes technical signal generation more defensible and closer to standard charting-platform behavior.

## 5) Better Data Fidelity and Traceability
- News sentiment remains lightweight and fast, but is now paired with richer supporting context.
- Users can inspect not just what the model inferred, but what article/source caused that inference.
- Portfolio requests are no longer backend-only; they now work end-to-end from natural-language chat to rendered portfolio output.
- Backtest requests are also no longer backend-only; they now work from natural-language chat to visual performance output in the UI.

## 6) Documentation Improvements
- Training documentation for signal calibration was consolidated into a single canonical guide:
  - `backend/docs/SIGNAL_WEIGHTS_CALIBRATION.md`
- The guide now clearly explains:
  - how to run calibration from repo root vs backend folder
  - how to train one pooled model across multiple stocks
  - how to batch-train one model per stock

## 7) Version Summary
- V2.1 focuses on making QuantBot more production-usable and more auditable:
  - portfolio optimization can now be requested directly from the chatbot
  - backtesting can now be requested directly from the chatbot
  - news intelligence is richer and easier to verify
  - technical indicators are more standard and reliable
  - training workflow documentation is clearer for future model calibration
