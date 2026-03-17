# QuantBot — AI Quantitative Analysis Demo

An agent-skills–based stock analysis chatbot powered by **DeepSeek AI** with three specialized skills.

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
│   └── trade-recommendation/
│       ├── SKILL.md
│       ├── scripts/
│       │   └── index.js
│       ├── assets/
│       └── references/risk-factors.md
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
PORT=3001
```

Get your DeepSeek API key at: https://platform.deepseek.com/api_keys

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

### 4. Start the MCP server (separate terminal)
Open a second terminal, go to `backend/`, then run:
```bash
npm run mcp
```

This starts a local stdio MCP server that exposes the QuantBot skills as MCP tools for compatible AI clients.

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
- Fetches price data, moving averages, RSI (Alpha Vantage / mock)
- Retrieves news headlines with sentiment scores
- Aggregates analyst consensus ratings
- Returns structured `MarketIntelligenceReport`

### Skill 2: eda-visual-analysis
- Accepts `MarketIntelligenceReport` as input
- Computes MA10, MA20 from price history
- Generates Chart.js configs for: price trend, volume, analyst donut, sentiment bars
- Identifies key EDA patterns via LLM
- Returns chart specs + textual insights

### Skill 3: trade-recommendation
- Scores 8+ signals (trend, RSI, sentiment, analyst consensus, volume, momentum)
- Maps score to BUY/HOLD/SELL with confidence %
- Computes entry, stop-loss, take-profit, risk/reward
- LLM generates rationale and risk factors
- Returns structured `TradeRecommendation`

## Customization

### Adding real market data
Replace the `generateMockMarketData()` function in `skills/market-intelligence/scripts/index.js`:
- **Alpha Vantage** (free): https://www.alphavantage.co/documentation/
- **Yahoo Finance** (unofficial): `npm install yahoo-finance2`
- **Polygon.io**: https://polygon.io/

### Adding real news
Replace the mock `newsHeadlines` array:
- **NewsAPI**: https://newsapi.org/ (100 requests/day free)
- **Finnhub**: https://finnhub.io/ (has built-in stock news endpoint)

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
| POST | `/api/skills/market-intelligence` | Skill 1 |
| POST | `/api/skills/eda-visual-analysis` | Skill 2 |
| POST | `/api/skills/trade-recommendation` | Skill 3 |
| GET | `/api/health` | Health check |

## MCP Tools

The MCP server exposes these tools over stdio:

- `market_intelligence`
- `eda_visual_analysis`
- `trade_recommendation`
- `full_stock_analysis`

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
