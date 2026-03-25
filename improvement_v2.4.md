# Quant Stock Analysis - Improvement v2.4 (Cross-Asset Macro Anchors)

## Overview
Analysis of the `trade-recommendation` skill indicated that the original sector-event mapping was somewhat static and relied entirely on descriptive labels rather than underlying market flows. Buying an energy stock on geopolitical headlines can be an empty trade if oil prices are not actively participating in a breakout.

In version 2.4, we engineered a **Cross-Asset Validation (Macro Anchors)** logic, pivoting the skill moving toward institutional-grade macro correlation mapping.

## Functional Changes

### 1. Macro Data Ingestion (`market-intelligence` Skill)
- **Module Created**: `skills/market-intelligence/scripts/modules/macro-anchors.js`
- **Functionality**: Built `fetchMacroAnchors` to automatically retrieve 90-day trailing price histories from the Yahoo Finance API for fundamental market anchors:
  - **Crude Oil (`CL=F`)**: Barometer for energy sector momentum.
  - **Gold (`GC=F`)**: Proxy for traditional safe-haven accumulation.
  - **10Y Treasury Yield (`^TNX`)**: Risk-free rate proxy affecting valuation models.
  - **VIX Volatility Index (`^VIX`)**: The leading indicator of market-wide panic.
- **Integration**: Plumbed the anchor evaluations seamlessly into the unified `marketData` pipeline in `market-intelligence/scripts/index.js`.

### 2. Enhanced Conviction Scoring (`trade-recommendation` Skill)
- **Module Affected**: `skills/trade-recommendation/scripts/modules/scoring.js`
- **Functionality**: Layered in dynamic point shifts based on multi-asset context.
  - **Oil Confirmation**: Energy signal confidence now hinges directly on crude (`CL=F`) health. A strong bull trend in oil triggers a +1 tailwind for Energy names; weakness applies a -1 headwind.
  - **Volatility Intervention**: A trailing >10% surge in the `^VIX` triggers a rigid -1.5 point "risk-off" override limit across most cyclical groups, preventing the system from aggressively buying falling knives.
  - **Rate Gravity**: Significant momentum in the 10Y Treasury (`^TNX` growth > 10%) applies a -1 headwind valuation penalty specifically targeting duration-sensitive spaces like `Technology` and `Real Estate`.

### 3. Visualizations and UI Displays (`frontend`)
- **Module Affected**: `frontend/js/app.js` -> `renderMarketIntelligence()`
- **Functionality**:
  - Implemented an elegant **"Macro Anchors (3-Month Trend)"** card immediately following existing macro indicators.
  - Engineered lightweight HTML/CSS **Mini Sparkline Charts** inside the widgets to plot the 30-day fractional curve, negating the need for heavyweight canvas/Chart.js footprints for simple context widgets.
  - Fully integrated the macro overlay with the existing `trade-recommendation` panel. The new constraints naturally appear under **"Signal Breakdown"** (e.g. `Macro Anchor: Volatility Spiking`).

---

## Factor Contribution (Decision Tree Replacement)

### Background
The original "Decision Tree" used a 4-gate sequential chain (Score Gate → Signal Balance → Macro Gate → Confidence Gate). While structurally valid, users found it opaque — the nodes described thresholds rather than explaining *what* drove the final recommendation.

### New Design: 5-Pillar Factor Contribution

| Pillar | Scoring Buckets Covered |
|---|---|
| **Technical Trend** | `trend`, `longtrend`, `oscillator`, `momentum`, `technical`, `intraday` |
| **Fundamental Value** | `valuation`, `analyst` |
| **News & Sentiment** | `sentiment`, `eda` |
| **Macro Context** | `macro` |
| **Risk Penalty** *(inverse)* | Cross-cutting — all negative-pointing signals across every bucket |

Each pillar aggregates the net point contribution of all signals that belong to its bucket group, making it immediately clear **which category of evidence is pushing the recommendation**.

### Module Changes

#### `skills/trade-recommendation/scripts/modules/decision-tree.js`
- Replaced the `buildDecisionTree` logic with a pillar-based aggregation model.
- Each pillar outputs:
  - `netScore` — signed sum of signal points within the pillar's buckets.
  - `outcome` — `"bullish"` / `"neutral"` / `"bearish"` (or `"low"` / `"moderate"` / `"high"` for Risk Penalty).
  - `topSignals[]` — top 5 contributing signals sorted by absolute point magnitude.
- The **Risk Penalty** pillar collects only negative-pointing signals across *all* buckets and computes `riskPressurePct` (what fraction of total signal power works against the trade).
- `buildDecisionTree()` interface is unchanged — same inputs (`score`, `signals`, `confidence`, `action`, `macroOverlay`, `eventRegimeOverlay`), but the output shape is now `{ title, pillars[], leaf }` instead of `{ title, nodes[], selectedPath[], leaf }`.

#### `frontend/js/app.js` → `renderDecisionTreeHtml(tree)`
- Re-written to render 5 coloured cards stacked vertically.
- Each card shows:
  - Pillar name + net score label + outcome chip (BULLISH / NEUTRAL / BEARISH / LOW|MOD|HIGH RISK).
  - A **centred contribution bar**: extends right for bullish net score, left for bearish, proportional to magnitude.
  - Risk Penalty shows a left-to-right pressure bar (0–100% drag), coloured green → amber → red.
  - A **"Show signals (N)"** button expands the top contributing signals inline, displaying signal name, reason, and point value.
- Event delegation (delegated click on `recCard`) handles the show/hide toggle without re-attaching listeners on re-render.

### Why This Is Better
- **Transparent** — users immediately see whether the call is driven by technicals, fundamentals, news, or macro, and how large each category's contribution is relative to the others.
- **Actionable** — clicking "Show signals" inside any pillar reveals the exact signals (with reasons and point values) that formed that category's verdict.
- **Honest about risk** — the Risk Penalty pillar makes headwinds visible rather than burying them inside an aggregate score.

---

## Reports Library (Save / Load / Delete)

### Overview
Analysts frequently need to revisit previous recommendations without re-running the full pipeline. v2.4 introduces a **persistent Reports Library** backed by a SQLite database, giving users a one-click save workflow and instant restore from any prior session.

### Backend

#### `backend/lib/reports-db.js`
- Initialises a SQLite database at `backend/data/reports.db` using the `better-sqlite3` driver.
- Schema:
  ```
  reports(id INTEGER PRIMARY KEY, ticker TEXT, label TEXT, html TEXT, created_at DATETIME)
  ```
- Exposes four synchronous helpers: `saveReport`, `listReports`, `getReport`, `deleteReport`.

#### `backend/server.js` — REST Endpoints
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/reports` | Save current analysis HTML snapshot with `ticker` + `label` |
| `GET` | `/api/reports` | List all saved reports (id, ticker, label, created_at — no html) |
| `GET` | `/api/reports/:id` | Fetch full HTML of a single report |
| `DELETE` | `/api/reports/:id` | Remove a report by id |

Payload size is capped at 9 MB server-side; the UI also validates before sending.

### Frontend

#### Save
- A **"Save to Reports Library"** button is injected into the existing Export dropdown at runtime (via `DOMContentLoaded` in `frontend/js/app.js`).
- On click, `saveCurrentReport()` serialises the live analysis panel to a self-contained HTML string (charts captured as PNG via `canvas.toDataURL`), prompts the user for a label, and POSTs to `/api/reports`.
- After a successful save the Reports top-menu dropdown is opened automatically so the user can see the new entry immediately.

#### Load
- The **Reports** top-navigation dropdown lists every saved report as a card with ticker, label, and timestamp.
- Clicking **Load** on any card calls `restoreReport(id)`, which GETs the stored HTML and injects it directly into the analysis panel — no API calls, no re-processing.
- The dropdown also surfaces **Load** / **Delete** action buttons per report.

#### Delete
- `deleteReport(id)` sends a `DELETE` to `/api/reports/:id`.
- On success the Reports list refreshes in-place and a toast notification confirms the deletion.

### Data Files
- **`backend/data/reports.db`** — SQLite main database (persistent report records).
- **`backend/data/reports.db-shm`** — Shared-memory WAL index (auto-managed by SQLite, not committed).
- **`backend/data/reports.db-wal`** — Write-ahead log (merged back into `.db` on checkpoint, not committed).

---

## Post-v2.4 Functional Additions (Market Intelligence UX/Data Expansion)

### 1. Macro News Freshness Upgrade
- **Module Affected**: `skills/market-intelligence/scripts/modules/api-news.js`
- **Functionality**:
  - Upgraded macro news ranking to prioritize recency and event relevance (especially policy + geopolitics).
  - Added fallback supplementation from Google News RSS when macro coverage is stale or sparse.
  - Ensured fallback items carry normalized `theme`, `sentiment`, and `scope` fields.

### 2. Sector Trend Data (3-Month)
- **Module Affected**: `skills/market-intelligence/scripts/modules/market-data.js`
- **Functionality**:
  - Added sector proxy trend ingestion via Yahoo Finance ETF proxies (e.g., XLK, XLF, XLV, XLE).
  - Extended sector coverage to include **Materials** (`XLB`) and **Mining** (`XME`).
  - Exposed `sectorTrends` in market-intelligence outputs across Finnhub/Yahoo/Alpha paths.

### 3. Market Benchmark Overlay (Mountain)
- **Modules Affected**:
  - `skills/market-intelligence/scripts/modules/market-data.js`
  - `frontend/js/app.js`
- **Functionality**:
  - Added benchmark selection by listing market context:
    - ASX assets → `^AXJO` (ASX 200)
    - US assets → `^GSPC` (S&P 500)
  - Introduced a benchmark mountain series and merged it into the same sector comparison chart for visual relative-performance context.
  - Added chart interaction controls:
    - Legend click toggles visibility per series.
    - `All` / `Focus` quick controls (`Focus` = benchmark + primary sector).

### 4. Peer Comparison Cards (Real Metrics)
- **Modules Affected**:
  - `skills/market-intelligence/scripts/modules/market-data.js`
  - `skills/market-intelligence/scripts/modules/mock.js`
  - `frontend/js/app.js`
- **Functionality**:
  - Implemented backend `peerComparisons` generation using live peer metrics.
  - Two side-by-side cards now render ranked peer tables:
    - **Fundamentals**: PE, EPS, Market Cap, ROE
    - **Trading**: 3M Return, RSI, Sentiment, Volume/Avg
  - Updated ticker column UX to show **symbol + company name**.
  - Converted Chinese helper text in peer cards to English.

### 5. ASX Peer Availability Fallback
- **Module Affected**: `skills/market-intelligence/scripts/modules/market-data.js`
- **Functionality**:
  - Added sector-based ASX peer fallback universe when Finnhub peer endpoint returns empty.
  - Added a default ASX fallback basket if sector-specific mapping is unavailable.
  - This resolves blank peer comparison cards for `.AX` tickers.

### 6. Runtime Stability Fix
- **Module Affected**: `skills/market-intelligence/scripts/modules/market-data.js`
- **Fix**:
  - Resolved `Cannot access 'sectorLabel' before initialization` by correcting variable declaration order in the Yahoo data path.


