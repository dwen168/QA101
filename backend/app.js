const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
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

function createApp() {
  const app = express();
  const skills = loadSkills();

  const authUsersByUsername = new Map(
    (config.authUsers || []).map((entry) => [String(entry.username || '').trim().toLowerCase(), entry])
  );

  const sanitizeUsername = (value) => String(value || '').trim();
  const findAuthUser = (username) => authUsersByUsername.get(sanitizeUsername(username).toLowerCase()) || null;
  const toBase64Url = (value) => Buffer.from(value, 'utf8').toString('base64url');
  const fromBase64Url = (value) => Buffer.from(value, 'base64url').toString('utf8');
  const getAuthTokenSignature = (payloadB64) => crypto
    .createHmac('sha256', config.authTokenSecret)
    .update(payloadB64)
    .digest('base64url');
  const createAuthToken = (username) => {
    const payload = {
      username,
      exp: Math.floor(Date.now() / 1000) + Number(config.authTokenTtlSec || 0),
    };
    const payloadB64 = toBase64Url(JSON.stringify(payload));
    const signature = getAuthTokenSignature(payloadB64);
    return `${payloadB64}.${signature}`;
  };
  const verifyAuthToken = (token) => {
    const raw = String(token || '').trim();
    if (!raw || !raw.includes('.')) return null;
    const [payloadB64, signature] = raw.split('.');
    if (!payloadB64 || !signature) return null;

    const expectedSignature = getAuthTokenSignature(payloadB64);
    const actualBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (actualBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

    try {
      const payload = JSON.parse(fromBase64Url(payloadB64));
      const username = sanitizeUsername(payload?.username);
      const exp = Number(payload?.exp || 0);
      if (!username || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
        return null;
      }
      const user = findAuthUser(username);
      if (!user) return null;
      return { username: user.username };
    } catch {
      return null;
    }
  };
  const parseCookies = (cookieHeader) => {
    const source = String(cookieHeader || '');
    const cookies = {};
    source.split(';').forEach((entry) => {
      const index = entry.indexOf('=');
      if (index <= 0) return;
      const key = entry.slice(0, index).trim();
      const value = entry.slice(index + 1).trim();
      if (!key) return;
      cookies[key] = decodeURIComponent(value);
    });
    return cookies;
  };
  const getAuthFromRequest = (req) => {
    const cookies = parseCookies(req.headers?.cookie);
    const token = cookies[config.authCookieName];
    const user = verifyAuthToken(token);
    return {
      authenticated: Boolean(user),
      user,
    };
  };
  const setAuthCookie = (res, token) => {
    const parts = [
      `${config.authCookieName}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Number(config.authTokenTtlSec || 0)}`,
    ];
    if (config.isVercel) {
      parts.push('Secure');
    }
    res.setHeader('Set-Cookie', parts.join('; '));
  };
  const clearAuthCookie = (res) => {
    const parts = [
      `${config.authCookieName}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
    ];
    if (config.isVercel) {
      parts.push('Secure');
    }
    res.setHeader('Set-Cookie', parts.join('; '));
  };
  const isAuthenticated = (req) => Boolean(req.auth?.authenticated);
  const canUseDeepseek = (req) => isAuthenticated(req);
  const getAllowedProviders = (req) => {
    const providers = ['gemini'];
    if (!config.isVercel) {
      providers.push('ollama');
    }
    if (canUseDeepseek(req)) {
      providers.unshift('deepseek');
    }
    return providers;
  };

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => {
    req.auth = getAuthFromRequest(req);
    next();
  });

  app.get('/api/auth/status', (req, res) => {
    const authenticated = isAuthenticated(req);
    res.json({
      authenticated,
      loginEnabled: authUsersByUsername.size > 0,
      user: authenticated ? { username: req.auth.user.username } : null,
      providers: getAllowedProviders(req),
      deepseekEnabled: canUseDeepseek(req),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    if (authUsersByUsername.size === 0) {
      res.status(503).json({ error: 'Login is not configured on the server.' });
      return;
    }

    const username = sanitizeUsername(req.body?.username);
    const password = String(req.body?.password || '');

    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    const user = findAuthUser(username);
    if (!user || user.password !== password) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = createAuthToken(user.username);
    setAuthCookie(res, token);

    req.auth = { authenticated: true, user: { username: user.username } };
    res.json({ authenticated: true, user: { username: user.username }, providers: getAllowedProviders(req), deepseekEnabled: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearAuthCookie(res);
    req.auth = { authenticated: false, user: null };
    res.json({ authenticated: false, user: null, providers: getAllowedProviders(req), deepseekEnabled: false });
  });

  app.use((req, res, next) => {
    const providerHeader = String(req.get('x-llm-provider') || '').trim().toLowerCase();
    const modelHeader = String(req.get('x-llm-model') || '').trim();

    if (providerHeader && !['deepseek', 'ollama', 'gemini'].includes(providerHeader)) {
      res.status(400).json({ error: 'x-llm-provider must be deepseek, ollama, or gemini' });
      return;
    }

    if (config.isVercel && providerHeader === 'ollama') {
      res.status(400).json({ error: 'ollama is not available on Vercel. Use gemini or deepseek.' });
      return;
    }

    if (providerHeader === 'deepseek' && !canUseDeepseek(req)) {
      res.status(403).json({ error: 'DeepSeek is only available for logged-in users.' });
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
    const activeProvider = getActiveProvider();
    const allowedProviders = getAllowedProviders(req);
    const effectiveProvider = allowedProviders.includes(activeProvider)
      ? activeProvider
      : (allowedProviders[0] || 'gemini');

    res.json({
      status: 'ok',
      skills: Object.keys(skills),
      transports: ['http'],
      auth: {
        authenticated: isAuthenticated(req),
        loginEnabled: authUsersByUsername.size > 0,
        providers: allowedProviders,
      },
      llm: {
        provider: effectiveProvider,
        model: getActiveModel(effectiveProvider),
      },
    });
  });

  app.get('/api/llm/models', async (req, res) => {
    const provider = String(req.query.provider || '').trim().toLowerCase();

    if (!provider || !['deepseek', 'ollama', 'gemini'].includes(provider)) {
      res.status(400).json({ error: 'provider query must be deepseek, ollama, or gemini' });
      return;
    }

    if (provider === 'deepseek' && !canUseDeepseek(req)) {
      res.status(403).json({ error: 'DeepSeek is only available for logged-in users.' });
      return;
    }

    if (provider === 'deepseek') {
      res.json({ provider, models: [config.deepseekModel, 'deepseek-chat', 'deepseek-reasoner'] });
      return;
    }

    if (provider === 'gemini') {
      res.json({ provider, models: [config.geminiModel, 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'] });
      return;
    }

    if (config.isVercel) {
      res.status(400).json({ error: 'ollama models are not available on Vercel. Use gemini or deepseek.' });
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

  app.use((error, _req, res, next) => {
    if (!error) {
      next();
      return;
    }

    if (error.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request payload is too large.' });
      return;
    }

    handleRouteError(res, error);
  });

  return app;
}

module.exports = {
  createApp,
};
