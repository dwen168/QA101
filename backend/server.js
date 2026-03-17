const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./lib/config');
const { loadSkills } = require('./lib/skill-loader');
const { routeChatMessage } = require('./lib/chat');
const { runMarketIntelligence } = require('../skills/market-intelligence/scripts');
const { runEdaVisualAnalysis } = require('../skills/eda-visual-analysis/scripts');
const { runTradeRecommendation } = require('../skills/trade-recommendation/scripts');

const app = express();
const skills = loadSkills();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function handleRouteError(res, error, fallbackStatus = 500) {
  const status = /required|must be/.test(error.message) ? 400 : fallbackStatus;
  res.status(status).json({ error: error.message });
}

app.post('/api/skills/market-intelligence', async (req, res) => {
  try {
    const result = await runMarketIntelligence({ ticker: req.body.ticker });
    res.json(result);
  } catch (error) {
    handleRouteError(res, error);
  }
});

app.post('/api/skills/eda-visual-analysis', async (req, res) => {
  try {
    const result = await runEdaVisualAnalysis({ marketData: req.body.marketData });
    res.json(result);
  } catch (error) {
    handleRouteError(res, error);
  }
});

app.post('/api/skills/trade-recommendation', async (req, res) => {
  try {
    const result = await runTradeRecommendation({
      marketData: req.body.marketData,
      edaInsights: req.body.edaInsights,
    });
    res.json(result);
  } catch (error) {
    handleRouteError(res, error);
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const result = await routeChatMessage({
      message: req.body.message,
      history: req.body.history || [],
    });
    res.json(result);
  } catch (error) {
    handleRouteError(res, error);
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    skills: Object.keys(skills),
    transports: ['http', 'mcp-stdio'],
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(config.port, () => {
  console.log(`\nQuantBot API running on http://localhost:${config.port}`);
  console.log(`Skills loaded: ${Object.keys(skills).join(', ')}`);
  console.log(`DeepSeek API: ${config.deepseekApiKey ? 'configured' : 'missing — add to .env'}\n`);
});
