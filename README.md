# QuantBot — AI Quantitative Analysis Demo

An agent-skills–based stock analysis chatbot powered by **DeepSeek AI** with five specialized skills: single-stock analysis, multi-stock portfolio optimization, and historical strategy backtesting.

## What's New in v2.1

- Portfolio optimization can now be triggered directly from the UI chatbot with natural-language prompts such as `Optimize portfolio AAPL, MSFT, NVDA`.
- Backtesting can now be triggered directly from the UI chatbot with prompts such as `Backtest AAPL from 2025-01-01 to 2026-03-18`.
- News cards now show richer article context with summaries and source links instead of headline-only display.
- News summaries are collapsible, so the analysis panel stays compact while keeping source detail available on demand.
- MACD signal-line calculation now uses the standard EMA-based MACD(12,26,9) method.
- Signal calibration documentation is consolidated in `backend/docs/SIGNAL_WEIGHTS_CALIBRATION.md`.

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
│   ├── server.js                 # Express HTTP API
│   ├── mcp-server.js             # MCP stdio server
│   └── lib/
│       ├── chat.js               # Chat orchestration
│       ├── config.js             # Env/config loader
│       ├── llm.js                # DeepSeek client wrapper
│       ├── pipeline.js           # End-to-end analysis pipeline
│       ├── skill-loader.js       # Loads SKILL.md definitions
│       └── utils.js              # Shared helpers
└── frontend/
    └── index.html                # Single-page chat UI + chart rendering
```

Runtime architecture:
- Frontend (`frontend/index.html`) calls the HTTP API on `backend/server.js`.
- Chat orchestration in `backend/lib/chat.js` and `backend/lib/pipeline.js` routes requests across skills.
- Skill instructions are loaded from `skills/*/SKILL.md`, while executable logic runs from `skills/*/scripts/index.js`.
- `backend/mcp-server.js` exposes the same capabilities as MCP tools, reusing the backend skill modules.

## Setup

### Quick start (from repo root)
Terminal 1:
```bash
cd backend
npm install
node server.js
```

Terminal 2:
```bash
cd backend
npm run mcp
```

Then open: http://localhost:3001/

### 1. Configure API keys
Edit `.env`:
```env
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key_here
FINNHUB_API_KEY=your_finnhub_api_key_here
NEWS_API_KEY=your_newsapi_api_key_here
PORT=3001
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

### 4. Start the MCP server (optional, separate terminal)
If you want to expose the QuantBot skills as MCP tools for compatible AI clients, you can start the MCP server. Open a second terminal, go to `backend/`, then run:
```bash
npm run mcp
```

This is not required if you are using the browser-based UI.

### 5. Open the frontend
Open http://localhost:3001/ in your browser.

## How It Works

### Running modes
- Browser app mode: requires `node server.js`
- MCP client mode: requires `npm run mcp`
- Full local demo (recommended): run both commands in parallel using two terminals

### Agent Skills Pattern
Each skill follows the [agentskills.io spec](https://agentskills.io/specification):
- `SKILL.md` with YAML frontmatter (`name`, `description`, `metadata`)
- Markdown body with step-by-step instructions
- `references/` directory with supporting documentation

The LLM (DeepSeek) receives each `SKILL.md` as part of its system prompt — this is how it "learns" what each skill does and how to execute it.

The executable skill logic lives directly in each skill folder under `scripts/`. Both the Express API and the MCP server import those script modules, so the skills remain reusable across transports while matching the agent skill folder pattern.

### Skill 1: market-intelligence
- Validates ticker symbol
- Fetches price data, moving averages, RSI from Alpha Vantage (live or mock fallback)
- Calculates advanced technical indicators: **MACD, Bollinger Bands, KDJ, OBV, VWAP**
- Retrieves news headlines from Finnhub with rule-based sentiment scoring (VADER-like)
- Aggregates analyst consensus ratings from Finnhub
- Pulls real P/E, EPS, and market cap from Finnhub when available
- Returns structured `MarketIntelligenceReport` with full technical + fundamental + sentiment data

### Skill 2: eda-visual-analysis
- Accepts `MarketIntelligenceReport` as input
- Computes MA10, MA20 from price history
- Generates Chart.js configs for: price trend, volume, analyst donut, sentiment bars
- Identifies key EDA patterns via LLM
- Returns chart specs + textual insights

### Skill 3: trade-recommendation
- Scores 15+ signals: trend, RSI, sentiment, analyst consensus, momentum, **+ MACD, Bollinger Bands, KDJ, OBV, VWAP**
- Maps aggregate score to BUY/HOLD/SELL with confidence %
- Computes exit levels using **14-day ATR** (more accurate than 52-week range):
  - Stop-loss = entry − (ATR14 × 1.5)
  - Take-profit = entry + (ATR14 × 2.5)
- Calculates **Value at Risk (VaR)** for 1-day maximum loss at 95% confidence
- LLM generates rationale and risk factors
- Returns structured `TradeRecommendation` with multi-indicator validation + risk metrics

### Skill 4: portfolio-optimization
- Accepts array of tickers (e.g., 5–20 stocks)
- Computes multi-factor scores: momentum, quality, risk-adjusted
- Constructs correlation matrix and identifies diversification gaps
- Groups stocks by sector and ranks sector rotation opportunities
- Assigns portfolio actions (STRONG BUY → SELL) with recommended allocations
- LLM generates portfolio thesis, sector rotation insight, and rebalancing recommendations
- Returns ranked holdings, correlation matrix, and diversification metrics

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
| POST | `/api/chat` | Main chatbot (DeepSeek routing) |
| POST | `/api/skills/market-intelligence` | Single-stock market analysis |
| POST | `/api/skills/eda-visual-analysis` | Single-stock visual insights |
| POST | `/api/skills/trade-recommendation` | Single-stock trade signal |
| POST | `/api/skills/portfolio-optimization` | Multi-stock portfolio ranking & diversification |
| GET | `/api/health` | Health check |

## MCP Tools

The MCP server exposes these tools over stdio:

- `market_intelligence` — Single ticker analysis
- `eda_visual_analysis` — Visual analysis from market data
- `trade_recommendation` — Trade signal for single stock
- `full_stock_analysis` — Full pipeline for single stock
- `portfolio_optimization` — Multi-stock ranking and sector rotation
- `full_portfolio_analysis` — Full portfolio analysis pipeline

Example Claude Desktop / VS Code MCP config on Windows:

```json
{
    "mcpServers": {
        "quantbot": {
            "command": "node",
            "args": [
                "e:/WorkSource/QA101/backend/mcp-server.js"
            ]
        }
    }
}
```

## Disclaimer
This is a demo application for educational purposes only.
Nothing produced by this tool constitutes financial advice.
