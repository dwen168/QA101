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
  const { runTradeRecommendation, runRecommendationBacktest, computeBacktestDecision } = require('../skills/trade-recommendation/scripts');
const { runPortfolioOptimization, getOptimizationSettings } = require('../skills/portfolio-optimization/scripts');
const { runBacktest } = require('../skills/backtesting/scripts');

function createApp() {
  const app = express();
  const skills = loadSkills();
  const usingDefaultAuthSecret = String(config.authTokenSecret || '') === 'change-this-auth-token-secret';

  if (config.isVercel && usingDefaultAuthSecret) {
    throw new Error('AUTH_TOKEN_SECRET must be set to a strong value in production.');
  }

  const authUsersByUsername = new Map(
    (config.authUsers || []).map((entry) => [String(entry.username || '').trim().toLowerCase(), entry])
  );

  const sanitizeUsername = (value) => String(value || '').trim();
  const findAuthUser = (username) => authUsersByUsername.get(sanitizeUsername(username).toLowerCase()) || null;
  const safeBufferEquals = (left, right) => {
    const leftBuf = Buffer.from(String(left || ''), 'utf8');
    const rightBuf = Buffer.from(String(right || ''), 'utf8');
    if (leftBuf.length !== rightBuf.length) return false;
    return crypto.timingSafeEqual(leftBuf, rightBuf);
  };
  const verifyPassword = (user, password) => {
    const passwordHash = String(user?.passwordHash || '').trim();

    // Supported format: pbkdf2$iterations$salt$hashHex
    if (passwordHash.startsWith('pbkdf2$')) {
      const parts = passwordHash.split('$');
      if (parts.length !== 4) return false;
      const iterations = Number(parts[1]);
      const salt = parts[2];
      const expectedHex = parts[3];
      if (!Number.isFinite(iterations) || iterations < 10000 || !salt || !expectedHex) {
        return false;
      }

      const computed = crypto
        .pbkdf2Sync(String(password || ''), salt, Math.floor(iterations), 32, 'sha256')
        .toString('hex');
      return safeBufferEquals(computed, expectedHex);
    }

    return safeBufferEquals(String(user?.password || ''), String(password || ''));
  };
  const sanitizeStringForHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const sanitizeResponsePayload = (value) => {
    if (typeof value === 'string') return sanitizeStringForHtml(value);
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => sanitizeResponsePayload(item));
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeResponsePayload(item)])
    );
  };
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

  const parseCorsOrigins = () => {
    const raw = String(process.env.CORS_ORIGIN || '').trim();
    if (!raw) return null;
    const values = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return values.length ? new Set(values) : null;
  };

  const allowedCorsOrigins = parseCorsOrigins();
  const corsOptions = {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (!allowedCorsOrigins) {
        if (!config.isVercel) {
          callback(null, true);
          return;
        }
        callback(new Error('CORS origin is not allowed'));
        return;
      }

      callback(null, allowedCorsOrigins.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  };

  const loginAttempts = new Map();
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_MAX_ATTEMPTS = 8;
  const getClientIp = (req) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || String(req.ip || req.socket?.remoteAddress || 'unknown');
  };
  const loginThrottleKey = (req, username) => `${getClientIp(req)}::${String(username || '').toLowerCase()}`;
  const isLoginRateLimited = (req, username) => {
    const key = loginThrottleKey(req, username);
    const now = Date.now();
    const history = (loginAttempts.get(key) || []).filter((ts) => now - ts < LOGIN_WINDOW_MS);
    loginAttempts.set(key, history);
    return history.length >= LOGIN_MAX_ATTEMPTS;
  };
  const recordFailedLogin = (req, username) => {
    const key = loginThrottleKey(req, username);
    const now = Date.now();
    const history = (loginAttempts.get(key) || []).filter((ts) => now - ts < LOGIN_WINDOW_MS);
    history.push(now);
    loginAttempts.set(key, history);
  };
  const clearFailedLogins = (req, username) => {
    loginAttempts.delete(loginThrottleKey(req, username));
  };

  const apiRequests = new Map();
  const API_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000);
  const API_MAX_REQUESTS = Number(process.env.API_RATE_LIMIT_MAX || 120);
  const isRateLimited = (req) => {
    const key = getClientIp(req);
    const now = Date.now();
    const history = (apiRequests.get(key) || []).filter((ts) => now - ts < API_WINDOW_MS);
    history.push(now);
    apiRequests.set(key, history);
    return history.length > API_MAX_REQUESTS;
  };

  app.use(cors(corsOptions));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://unpkg.com https://fonts.googleapis.com 'unsafe-inline'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    next();
  });
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => {
    req.auth = getAuthFromRequest(req);
    next();
  });
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/auth/status') {
      next();
      return;
    }

    if (isRateLimited(req)) {
      res.status(429).json({ error: 'Too many requests. Please slow down.' });
      return;
    }
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

    if (isLoginRateLimited(req, username)) {
      res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
      return;
    }

    if (!username || !password) {
      recordFailedLogin(req, username);
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    const user = findAuthUser(username);
    if (!user || !verifyPassword(user, password)) {
      recordFailedLogin(req, username);
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    clearFailedLogins(req, username);

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
      res.json(sanitizeResponsePayload(result));
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  app.post('/api/skills/eda-visual-analysis', async (req, res) => {
    try {
      const result = await runEdaVisualAnalysis({ marketData: req.body.marketData });
      res.json(sanitizeResponsePayload(result));
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
      res.json(sanitizeResponsePayload(result));
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Convenience endpoint: run a backtest using the trade-recommendation strategy
  app.post('/api/skills/trade-recommendation/backtest', async (req, res) => {
    try {
      const result = await runRecommendationBacktest({
        ticker: req.body.ticker,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        initialCapital: req.body.initialCapital || 10000,
        timeHorizon: req.body.timeHorizon || 'MEDIUM',
        apiKey: config.alphaVantageApiKey,
      });
      res.json(sanitizeResponsePayload(result));
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Backtest-style decision for the latest bar (price + technicals only)
  app.post('/api/skills/trade-recommendation/backtest-action', (req, res) => {
    try {
      const priceHistory = req.body.priceHistory;
      const timeHorizon = String(req.body.timeHorizon || 'MEDIUM').toUpperCase();
      const result = computeBacktestDecision({ priceHistory, timeHorizon });
      res.json(sanitizeResponsePayload(result));
    } catch (err) {
      res.status(400).json({ error: String(err?.message || 'invalid request') });
    }
  });

  app.post('/api/skills/portfolio-optimization', async (req, res) => {
    try {
      const result = await runPortfolioOptimization({
        tickers: req.body.tickers,
        useMarketData: req.body.useMarketData,
        timeHorizon: req.body.timeHorizon || 'MEDIUM',
      });
      res.json(sanitizeResponsePayload(result));
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Provide optimizer parameters for frontend inspection
  app.get('/api/portfolio/params', (req, res) => {
    try {
      const rawHorizon = String(req.query?.timeHorizon || 'MEDIUM').toUpperCase();
      const rawRisk = String(req.query?.macroRisk || 'MEDIUM').toUpperCase();
      const parsedAssetCount = Number(req.query?.assetCount || 10);

      const timeHorizon = ['SHORT', 'MEDIUM', 'LONG'].includes(rawHorizon) ? rawHorizon : 'MEDIUM';
      const macroRisk = ['LOW', 'MEDIUM', 'HIGH'].includes(rawRisk) ? rawRisk : 'MEDIUM';
      const assetCount = Number.isFinite(parsedAssetCount) ? Math.max(1, Math.min(100, Math.round(parsedAssetCount))) : 10;

      const settings = getOptimizationSettings(timeHorizon, macroRisk, assetCount);
      res.json({
        timeHorizon,
        macroRisk,
        assetCount,
        targetGrossWeight: settings.targetGrossWeight,
        maxWeight: settings.maxWeight,
        iterations: settings.iterations,
        stepSize: settings.stepSize,
        riskAversion: settings.riskAversion,
        riskFreeRate: settings.riskFreeRate,
      });
    } catch (err) {
      res.status(500).json({ error: 'failed to compute params' });
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
        initialCapital: req.body.initialCapital || 10000,
        apiKey: config.alphaVantageApiKey,
      });
      res.json(sanitizeResponsePayload(result));
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
      res.json(sanitizeResponsePayload(result));
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Weights metadata endpoint (top-level)
  app.get('/api/weights/metadata', (req, res) => {
    try {
      const { getWeightsMetadata } = require('./lib/weights-loader');
      const meta = getWeightsMetadata();
      res.json(meta);
    } catch (err) {
      res.status(500).json({ error: 'failed to read weights metadata' });
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
