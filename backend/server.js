const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./lib/config');
const { getActiveModel, getActiveProvider, runWithLlmContext } = require('./lib/llm');
const { loadSkills } = require('./lib/skill-loader');
const { routeChatMessage } = require('./lib/chat');
const { runMarketIntelligence } = require('../skills/market-intelligence/scripts');
const { runEdaVisualAnalysis } = require('../skills/eda-visual-analysis/scripts');
const { runTradeRecommendation } = require('../skills/trade-recommendation/scripts');
const { runPortfolioOptimization } = require('../skills/portfolio-optimization/scripts');
const { runBacktest } = require('../skills/backtesting/scripts');

const app = express();
const skills = loadSkills();

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const providerHeader = String(req.get('x-llm-provider') || '').trim().toLowerCase();
  const modelHeader = String(req.get('x-llm-model') || '').trim();

  if (providerHeader && !['deepseek', 'ollama'].includes(providerHeader)) {
    res.status(400).json({ error: 'x-llm-provider must be either deepseek or ollama' });
    return;
  }

  runWithLlmContext(
    { provider: providerHeader || null, model: modelHeader || null },
    () => next()
  );
});
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
      timeHorizon: req.body.timeHorizon || 'MEDIUM',
    });
    res.json(result);
  } catch (error) {
    handleRouteError(res, error);
  }
});

app.post('/api/skills/portfolio-optimization', async (req, res) => {
  try {
    const result = await runPortfolioOptimization({
      tickers: req.body.tickers,
      useMarketData: req.body.useMarketData,
      timeHorizon: req.body.timeHorizon || 'MEDIUM',
    });
    res.json(result);
  } catch (error) {
    handleRouteError(res, error);
  }
});

app.post('/api/skills/backtesting', async (req, res) => {
  try {
    const result = await runBacktest({
      ticker: req.body.ticker,
      strategyName: req.body.strategyName || 'trade-recommendation',
      timeHorizon: req.body.timeHorizon || 'MEDIUM',
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      initialCapital: req.body.initialCapital || 100000,
      apiKey: config.alphaVantageApiKey,
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
    llm: {
      provider: getActiveProvider(),
      model: getActiveModel(),
    },
  });
});

app.get('/api/llm/models', async (req, res) => {
  const provider = String(req.query.provider || '').trim().toLowerCase();

  if (!provider || !['deepseek', 'ollama'].includes(provider)) {
    res.status(400).json({ error: 'provider query must be deepseek or ollama' });
    return;
  }

  if (provider === 'deepseek') {
    res.json({ provider, models: [config.deepseekModel, 'deepseek-chat', 'deepseek-reasoner'] });
    return;
  }

  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama tags request failed: ${response.status}`);
    }

    const payload = await response.json();
    const models = Array.isArray(payload?.models)
      ? payload.models
          .map((entry) => String(entry?.name || '').trim())
          .filter(Boolean)
      : [];

    res.json({ provider, models });
  } catch (error) {
    res.status(502).json({ error: `Failed to fetch Ollama models: ${error.message}` });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(config.port, () => {
  const provider = getActiveProvider();
  console.log(`\nQuantBot API running on http://localhost:${config.port}`);
  console.log(`Skills loaded: ${Object.keys(skills).join(', ')}`);
  console.log(`LLM provider: ${provider} (${getActiveModel(provider)})`);
  if (provider === 'ollama') {
    console.log(`Ollama endpoint: ${config.ollamaBaseUrl}`);
  } else {
    console.log(`DeepSeek API: ${config.deepseekApiKey ? 'configured' : 'missing — add to .env'}`);
  }
  console.log('');
});
