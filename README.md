# QuantBot — AI Quantitative Analysis Demo

An agent-skills–based stock analysis chatbot powered by a selectable **DeepSeek or Ollama LLM** with five specialized skills: single-stock analysis, multi-stock portfolio optimization, and historical strategy backtesting.

## What's New in v2.1

- Portfolio optimization can now be triggered directly from the UI chatbot with natural-language prompts such as `Optimize portfolio AAPL, MSFT, NVDA`.
- Backtesting can now be triggered directly from the UI chatbot with prompts such as `Backtest AAPL from 2025-01-01 to 2026-03-18`.
- The frontend now supports per-request LLM provider/model switching between DeepSeek and local Ollama.
- Running requests can now be cancelled from the UI, and each completed skill shows its execution time.
- Portfolio optimization and backtesting now surface whether results came from live APIs, mock fallback data, or a mixed source set.
- Market intelligence now includes a macro/geopolitical context layer, so global headlines such as wars, Fed tone, tariffs, and oil shocks can be surfaced alongside ticker-specific news.
- Trade recommendation now uses the macro regime as a scoring overlay, affecting signal totals, confidence, and key risk flags.
- Trade recommendation now includes an event-sector knowledge base overlay (e.g., war, oil shock, rate-hike regime), dynamically boosting or reducing sector signal strength.
- Portfolio optimization now applies macro-regime tilts to ranking and allocations, including defensive cash-bias in high-risk regimes.
- Market intelligence headline sentiment and portfolio narrative generation now use rule-based logic instead of LLM calls, reducing token usage and improving stability on local models.
- News cards now show richer article context with summaries and source links instead of headline-only display.
- News summaries are collapsible, so the analysis panel stays compact while keeping source detail available on demand.
- MACD signal-line calculation now uses the standard EMA-based MACD(12,26,9) method.
- Signal calibration documentation is consolidated in `backend/docs/SIGNAL_WEIGHTS_CALIBRATION.md`.

## Latest Updates (Mar 22, 2026)

- Central-bank policy context is now split into dedicated FED and RBA tracks (`fed` / `rba`) with latest rate-decision focus and clearer bias labels (`EASING`, `TIGHTENING`, `HOLD`, `WATCH`).
- Policy scope is now explicit and consistent across engines: **RBA affects ASX tickers only (`*.AX`)**, while **FED affects all tickers**.
- Policy overlay is now wired into scoring (not just display):
    - Trade recommendations can emit `Central Bank Policy Tailwind/Headwind` signals.
    - Portfolio optimization includes policy-aware macro adjustments with transparent driver reasons.
- Company profile consistency improved for US tickers on the Finnhub route (e.g., `MSFT`): business summary fields (`description`, `industry`, `employees`, `website`, `country`) are now populated via a lightweight Yahoo summary-profile supplement.
- Finnhub company-news reliability improved: removed an expensive redirect-based source resolution path that could trigger timeout and force unnecessary Yahoo fallback.
- Macro/event consistency fixed for energy names (e.g., `CVX`) by separating sector **headwind themes** vs **tailwind themes** under high-risk regimes (war/geopolitics now correctly treated as an energy tailwind).

## Architecture

```
QA101/
├── README.md
├── skills/                       # Agent skill definitions (agentskills.io spec)
│   ├── market-intelligence/
│   │   ├── SKILL.md              # Skill definition and routing guidance
│   │   ├── scripts/
│   │   │   └── index.js          # Executable skill logic
│   │   ├── assets/               # Optional templates/resources
│   │   └── references/data-sources.md
│   ├── eda-visual-analysis/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   │   └── index.js
│   │   ├── assets/
│   │   └── references/chart-types.md
│   ├── trade-recommendation/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   │   └── index.js
│   │   ├── assets/
│   │   └── references/risk-factors.md
│   └── portfolio-optimization/
│       ├── SKILL.md
│       ├── scripts/
│       │   └── index.js
│       └── references/multi-factor-model.md
├── backend/
│   ├── package.json
│   ├── app.js                    # Shared Express app for local and serverless runtime
│   ├── server.js                 # Local HTTP launcher
│   └── lib/
│       ├── chat.js               # Chat orchestration
│       ├── config.js             # Env/config loader
│       ├── llm.js                # Shared DeepSeek/Ollama client wrapper
│       ├── pipeline.js           # End-to-end analysis pipeline
│       ├── skill-loader.js       # Loads SKILL.md definitions
│       └── utils.js              # Shared helpers
└── frontend/
    └── index.html                # Single-page chat UI + chart rendering
```

Runtime architecture:
- Frontend (`frontend/index.html`) calls `/api` endpoints.
- Chat orchestration in `backend/lib/chat.js` and `backend/lib/pipeline.js` routes requests across skills.
- Skill instructions are loaded from `skills/*/SKILL.md`, while executable logic runs from `skills/*/scripts/index.js`.
- `backend/app.js` is the shared Express app used by both local dev (`backend/server.js`) and Vercel serverless (`api/[...route].js`).

## Setup

### Quick start (from repo root)
```bash
cd backend
npm install
node server.js
```

Then open: http://localhost:3001/

The frontend header now includes an LLM switcher, so you can choose `DeepSeek` or `Ollama` and adjust the model name from the browser without restarting the server.
The chat composer also includes a Stop button that aborts the current request, while completed skills report their elapsed runtime in the chat log.

### 1. Configure API keys and LLM provider
Edit `.env`:
```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:9b
REAL_DATA_TIMEOUT_MS=10000
LLM_TIMEOUT_MS=60000
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key_here
FINNHUB_API_KEY=your_finnhub_api_key_here
NEWS_API_KEY=your_newsapi_api_key_here
PORT=3001
```

Provider options:
- `LLM_PROVIDER=deepseek`: uses the DeepSeek API and requires `DEEPSEEK_API_KEY`
- `LLM_PROVIDER=ollama`: uses your local Ollama instance at `OLLAMA_BASE_URL`

Example for local Ollama with Qwen:
```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:9b
```

If you use the frontend switcher, the selected provider and model are sent per request and stored in browser local storage.

Supporting runtime endpoints:
- `GET /api/health` returns the active provider/model.
- `GET /api/llm/models?provider=deepseek|ollama` returns selectable models for the current provider.

Then pull the model if needed:
```bash
ollama pull qwen3.5:9b
```

Get your API keys:
- **DeepSeek API key**: https://platform.deepseek.com/api_keys
- **Alpha Vantage API key**: https://www.alphavantage.co/api/ (free tier: 25 req/day)
- **Finnhub API key**: https://finnhub.io/dashboard/api-token (free tier: 60 req/min)
- **NewsAPI key**: https://newsapi.org/account (free tier: 100 req/day)

### 2. Install backend dependencies
```bash
cd backend
npm install
```

### 3. Start the app server (HTTP API + frontend)
From `backend/`:
```bash
node server.js
```

This starts the API and serves the frontend at:
- http://localhost:3001/
- Health check: http://localhost:3001/api/health

### 4. Open the frontend
Open http://localhost:3001/ in your browser.

## How It Works

### Running modes
- Browser app mode: `node server.js`
- Vercel serverless mode: deploy the repo to Vercel using `vercel.json` + `api/[...route].js`

### Agent Skills Pattern
Each skill follows the [agentskills.io spec](https://agentskills.io/specification):
- `SKILL.md` with YAML frontmatter (`name`, `description`, `metadata`)
- Markdown body with step-by-step instructions
- `references/` directory with supporting documentation

The configured LLM provider (DeepSeek or Ollama) receives each `SKILL.md` as part of its system prompt — this is how it "learns" what each skill does and how to execute it.

The executable skill logic lives directly in each skill folder under `scripts/`. The local server and Vercel serverless function both import the same script modules.

### Skill 1: market-intelligence
- Validates ticker symbol
- Fetches price data, moving averages, RSI from Alpha Vantage (live or mock fallback)
- Applies configurable real-data timeouts via `REAL_DATA_TIMEOUT_MS`, then degrades gracefully to fallback data when needed
- Calculates advanced technical indicators: **MACD, Bollinger Bands, KDJ, OBV, VWAP**
- Retrieves news headlines from Finnhub with rule-based sentiment scoring
- Retrieves macro/geopolitical headlines and tags them into themes such as geopolitics, Fed or policy, tariffs, energy, and market stress
- Builds dedicated latest-decision policy context for FED and RBA (with fallback data sources) and exposes bank-level policy bias + impact summaries
- Aggregates analyst consensus ratings from Finnhub
- Pulls real P/E, EPS, and market cap from Finnhub when available
- Returns richer company business profile fields (`description`, `industry`, `employees`, `website`, `country`) for both US and ASX flows
- Returns a rule-generated market summary compatible with the previous `llmAnalysis` response shape
- Returns structured `MarketIntelligenceReport` with technical, fundamental, ticker-news, and macro-context data

### Skill 2: eda-visual-analysis
- Accepts `MarketIntelligenceReport` as input
- Computes MA10, MA20 from price history
- Generates Chart.js configs for: price trend, volume, analyst donut, sentiment bars
- Identifies key EDA patterns via the configured LLM provider
- Receives compact macro context, top-news headlines, and technical indicators to synthesize final interpretation
- Returns chart specs + textual insights

### Skill 3: trade-recommendation
- Scores 15+ signals: trend, RSI, sentiment, analyst consensus, momentum, **+ MACD, Bollinger Bands, KDJ, OBV, VWAP**
- Adds event-regime overlays from a knowledge base (war/geopolitics, oil shocks, rate cycles, supply-chain disruption) mapped to sector beneficiaries/headwinds
- Adds central-bank policy overlays (FED/RBA) into score construction with explicit policy tailwind/headwind signals when policy impact is material
- Maps aggregate score to BUY/HOLD/SELL with confidence %
- Computes exit levels using **14-day ATR** (more accurate than 52-week range):
  - Stop-loss = entry − (ATR14 × 1.5)
  - Take-profit = entry + (ATR14 × 2.5)
- Calculates **Value at Risk (VaR)** for 1-day maximum loss at 95% confidence
- LLM generates rationale and risk factors
- Returns structured `TradeRecommendation` with multi-indicator validation + risk metrics

### Skill 4: portfolio-optimization
- Accepts array of tickers (e.g., 5–20 stocks)
- Fetches ticker inputs sequentially to reduce Alpha Vantage free-tier rate-limit failures
- Computes multi-factor scores: momentum, quality, risk-adjusted
- Applies event-regime sector tilts from the knowledge base (e.g., war, oil shock, rate cycle) to ranking and allocation bias
- Applies central-bank policy-aware macro adjustments per ticker (FED global, RBA ASX-only) with reason strings surfaced in output
- Constructs correlation matrix and identifies diversification gaps
- Groups stocks by sector and ranks sector rotation opportunities
- Assigns portfolio actions (STRONG BUY → SELL) with recommended allocations
- Generates portfolio thesis, sector rotation insight, and rebalancing recommendations with rule-based logic
- Returns ranked holdings, correlation matrix, diversification metrics, `portfolioNarrative`, and per-ticker data-source diagnostics
- Response compatibility: legacy `llmNarrative` is still returned as an alias of `portfolioNarrative`

### Skill 5: backtesting
- Fetches historical data from Alpha Vantage or Yahoo Finance with configurable timeouts
- Surfaces data-source status in the frontend so users can distinguish live historical data from fallback/unavailable states
- Returns trade log, performance metrics, drawdown analysis, and risk summary

### Customization

### Price data sources (Alpha Vantage handles this)
- **Alpha Vantage** (integrated, free): https://www.alphavantage.co/documentation/
- **Yahoo Finance** (alternative, unofficial): `npm install yahoo-finance2`
- **Polygon.io**: https://polygon.io/

### Sentiment & News (Finnhub handles this)
**Finnhub integration is built-in** for:
- Real news headlines with rule-based sentiment scoring
- Analyst recommendation consensus and price targets
- Company fundamentals (P/E, EPS, market cap)

Add a `FINNHUB_API_KEY=your_key` to `.env` to enable. Free tier: 60 req/min.

If you want to swap sentiment providers:
- Replace `scoreHeadlineSentiment()` in `skills/market-intelligence/scripts/index.js` with VADER (Python via `child_process`) or HuggingFace API (FinBERT)
- Or integrate **NewsAPI** for additional headline sources

### Signal Weights Calibration (Advanced)
The `trade-recommendation` skill uses 12 signals (MA50/MA200, RSI, sentiment, analyst consensus, MACD, BB, KDJ, OBV, VWAP) to score trades.

By default, weights are **hardcoded experience values** (e.g., Price > MA50 = +2 points).

To **learn optimal weights from historical data** using XGBoost:

```bash
# 1. Install Python dependencies
pip install xgboost scikit-learn pandas numpy requests

# 2. Run calibration on historical data (e.g., 500 days of 7 stocks)
cd backend
npm run calibrate-weights -- --symbols AAPL,MSFT,GOOGL,NVDA,TSLA,AMD,NFLX --days 500

# 3. Outputs: lib/signal-weights.json
#    - Model metrics (Accuracy, F1, AUC)
#    - Learned weights for each signal
#    - Feature importance scores

# 4. Verify by checking API response
node server.js
# API response now includes weightingMetadata with model version and metrics
```

For details, see [SIGNAL_WEIGHTS_CALIBRATION.md](backend/docs/SIGNAL_WEIGHTS_CALIBRATION.md).

**Benefits:**
- Replace intuition-based weights with statistically validated ones
- Measure model quality (AUC > 0.65 is good for 5-day prediction)
- Create sector-specific weight sets (Tech vs Finance vs Healthcare)
- Continuously retrain as new market data arrives

### Extending skills
Create new skill folders following the agentskills.io spec:
```bash
mkdir -p skills/my-new-skill/{scripts,references}
touch skills/my-new-skill/SKILL.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Main chatbot (provider-aware LLM routing) |
| POST | `/api/skills/market-intelligence` | Single-stock market analysis |
| POST | `/api/skills/eda-visual-analysis` | Single-stock visual insights |
| POST | `/api/skills/trade-recommendation` | Single-stock trade signal |
| POST | `/api/skills/portfolio-optimization` | Multi-stock portfolio ranking & diversification (`portfolioNarrative`, legacy `llmNarrative`) |
| POST | `/api/skills/backtesting` | Historical strategy replay and performance metrics |
| GET | `/api/health` | Health check |
| GET | `/api/llm/models` | Model list for `deepseek` or `ollama` |

## Vercel Deployment

This project now runs in a serverless model on Vercel:
- API: `api/[...route].js` (Express app from `backend/app.js`)
- Frontend: served from `frontend/` via rewrites in `vercel.json`

Deploy steps:
```bash
npm install --prefix backend
vercel
```

Required environment variables on Vercel:
- `LLM_PROVIDER`
- `DEEPSEEK_API_KEY` (if using DeepSeek)
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `OLLAMA_BASE_URL` (if using Ollama over reachable endpoint)
- `OLLAMA_MODEL`
- `ALPHA_VANTAGE_API_KEY`
- `FINNHUB_API_KEY`
- `NEWS_API_KEY`

## Disclaimer
This is a demo application for educational purposes only.
Nothing produced by this tool constitutes financial advice.
