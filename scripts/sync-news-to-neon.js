#!/usr/bin/env node

const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { normalizeTicker } = require('../backend/lib/utils');
const {
  fetchYahooFinanceData,
  fetchFinnhubMarketData,
  fetchAlphaVantageMarketData,
} = require('../skills/market-intelligence/scripts/modules/market-data');
const {
  fetchFinnhubMacroNews,
  fetchFinnhubQuote,
  fetchFinnhubProfile,
} = require('../skills/market-intelligence/scripts/modules/api-finnhub');
const {
  fetchNewsApiMacroNews,
  fetchGoogleNewsRssQuery,
  fetchLatestCentralBankDecision,
} = require('../skills/market-intelligence/scripts/modules/api-news');
const {
  fetchMacroAnchors,
} = require('../skills/market-intelligence/scripts/modules/macro-anchors');
const { scoreMacroNewsWithLlm } = require('../skills/market-intelligence/scripts/modules/sentiment');
const {
  dedupeArticlesByTitle,
  safeNumber,
} = require('../skills/market-intelligence/scripts/modules/utils');

const GLOBAL_TICKER = '__GLOBAL__';
const MACRO_RECENT_HOURS = 48;
const MACRO_RECENT_MIN_ITEMS = 4;
const MACRO_GOOGLE_QUERY = 'fed OR rba OR rate decision OR geopolitics OR war OR sanctions OR oil markets';
const ENRICHMENT_TIMEOUT_MS = 5000;

function parseArgValue(flag) {
  const args = process.argv.slice(2);
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) {
    return inline.slice(flag.length + 1).trim();
  }

  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) {
    return String(args[index + 1]).trim();
  }

  return '';
}

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

function parseTickers() {
  const cliTickers = parseArgValue('--tickers');
  const envTickers = String(process.env.NEWS_SYNC_TICKERS || '').trim();
  const raw = cliTickers || envTickers;

  if (!raw) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => normalizeTicker(item))
    )
  );
}

function resolvePoolConfig() {
  // Use DATABASE_URL_UNPOOLED for a standalone script (avoids PgBouncer transaction mode limits).
  // Falls back to DATABASE_URL, then individual PGHOST/PGUSER/PGPASSWORD/PGDATABASE env vars.
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL;

  if (connectionString) {
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }

  const host = process.env.PGHOST_UNPOOLED || process.env.PGHOST;
  const user = process.env.PGUSER || process.env.POSTGRES_USER;
  const password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
  const database = process.env.PGDATABASE || process.env.POSTGRES_DATABASE;

  if (!host || !user || !password || !database) {
    throw new Error(
      'Missing Neon/PostgreSQL credentials. Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in .env, ' +
        'or set PGHOST, PGUSER, PGPASSWORD, PGDATABASE individually.'
    );
  }

  return {
    host,
    user,
    password,
    database,
    port: Number(process.env.PGPORT || 5432),
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

function hasFreshMacroCoverage(articles = []) {
  if (!Array.isArray(articles) || articles.length === 0) return false;
  const freshCount = articles.filter((article) => safeNumber(article?.hoursAgo, 9999) <= MACRO_RECENT_HOURS).length;
  return freshCount >= MACRO_RECENT_MIN_ITEMS;
}

function toDateOrNow(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toOptionalDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toPublishedAt(collectedAtUtc, hoursAgo) {
  const safeHours = Number(hoursAgo);
  if (!Number.isFinite(safeHours) || safeHours < 0) return null;
  return new Date(collectedAtUtc.getTime() - Math.round(safeHours) * 3600 * 1000);
}

function clampText(value, maxLen) {
  const text = String(value || '').trim();
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function clampScore(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalizeUrlForHash(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(value);
    parsed.hash = '';

    const removableParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'guccounter',
      'guce_referrer',
      'guce_referrer_sig',
      'ocid',
      'cmpid',
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
      'taid',
    ];

    for (const key of removableParams) {
      parsed.searchParams.delete(key);
    }

    const search = parsed.searchParams.toString();
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin.toLowerCase()}${pathname}${search ? `?${search}` : ''}`;
  } catch {
    return value.toLowerCase();
  }
}

function buildContentHash({ newsScope, ticker, title, url, source }) {
  const key = [
    newsScope,
    ticker,
    String(title || '').trim().toLowerCase(),
    normalizeUrlForHash(url),
    String(source || '').trim().toLowerCase(),
  ].join('|');

  return crypto.createHash('sha256').update(key).digest('hex');
}

function normalizeNewsRows({ ticker, news, collectedAtUtc, dataSource, sourceBreakdown, newsScope, macroTheme }) {
  return (Array.isArray(news) ? news : [])
    .filter((item) => item && item.title)
    .map((item) => {
      const publishedAtUtc =
        toOptionalDate(item.publishedAtUtc) ||
        toOptionalDate(item.publishedAt) ||
        toPublishedAt(collectedAtUtc, item.hoursAgo);
      const row = {
        newsScope,
        ticker,
        title: clampText(item.title, 1024),
        summary: String(item.summary || ''),
        url: clampText(item.url, 2048),
        source: clampText(item.source, 255),
        sentiment: Number.isFinite(Number(item.sentiment)) ? Number(item.sentiment) : null,
        macroTheme: macroTheme || clampText(item.theme, 64) || null,
        hoursAgo: Number.isFinite(Number(item.hoursAgo)) ? Math.round(Number(item.hoursAgo)) : null,
        publishedAtUtc,
        collectedAtUtc,
        dataSource: clampText(dataSource || 'unknown', 64),
        newsSourceBreakdown: sourceBreakdown ? clampText(sourceBreakdown, 128) : null,
      };

      row.contentHash = buildContentHash(row);
      return row;
    });
}

async function fetchMacroAnchorsRows() {
  try {
    const anchors = await fetchMacroAnchors();
    return (Array.isArray(anchors) ? anchors : [])
      .filter((anchor) => anchor && anchor.ticker)
      .map((anchor) => ({
        anchorTicker: clampText(anchor.ticker, 32),
        anchorName: clampText(anchor.name, 128),
        anchorType: clampText(anchor.type, 32),
        currentPrice: safeNumber(anchor.currentPrice),
        changePercent: safeNumber(anchor.changePercent),
        trend: clampText(anchor.trend, 16),
        priceHistory: anchor.history ? JSON.stringify(anchor.history) : null,
        collectedAtUtc: new Date(),
      }));
  } catch (error) {
    console.error('[sync-data] Macro anchors fetch failed:', error.message);
    return [];
  }
}

async function fetchCentralBankDecisionsRows() {
  try {
    const decisions = [];

    const [rbaDecision, fedDecision] = await Promise.allSettled([
      fetchLatestCentralBankDecision('RBA'),
      fetchLatestCentralBankDecision('FED'),
    ]);

    if (rbaDecision.status === 'fulfilled' && rbaDecision.value) {
      decisions.push(rbaDecision.value);
    }
    if (fedDecision.status === 'fulfilled' && fedDecision.value) {
      decisions.push(fedDecision.value);
    }

    return decisions
      .filter((decision) => decision && decision.title)
      .map((decision) => {
        const publishedAtUtc = decision.publishedAt
          ? toDateOrNow(decision.publishedAt)
          : decision.hoursAgo
            ? toPublishedAt(new Date(), decision.hoursAgo)
            : null;

        const hash = buildContentHash({
          newsScope: 'central_bank',
          ticker: decision.bank || 'GLOBAL',
          title: decision.title,
          url: decision.url,
          source: decision.source,
        });

        return {
          bank: clampText(decision.bank || 'UNKNOWN', 32),
          title: clampText(decision.title, 1024),
          summary: String(decision.summary || ''),
          url: clampText(decision.url, 2048),
          source: clampText(decision.source, 255),
          bias: clampText(decision.bias, 32),
          hoursAgo: Number.isFinite(Number(decision.hoursAgo)) ? Math.round(Number(decision.hoursAgo)) : null,
          publishedAtUtc,
          collectedAtUtc: new Date(),
          dataSource: 'central-bank-api',
          contentHash: hash,
        };
      });
  } catch (error) {
    console.error('[sync-data] Central bank decisions fetch failed:', error.message);
    return [];
  }
}

async function fetchTickerFundamentalsRows(ticker) {
  try {
    let marketData = null;
    let dataSource = 'unknown';

    try {
      if (ticker.includes('.')) {
        marketData = await fetchYahooFinanceData(ticker);
        dataSource = 'yahoo-finance';
      } else {
        marketData = await fetchFinnhubMarketData(ticker);
        dataSource = 'finnhub';
      }
    } catch (error) {
      console.debug(`[sync-data] Market data fetch for ${ticker} failed (trying fallback): ${error.message}`);
      try {
        if (!ticker.includes('.')) {
          marketData = await fetchYahooFinanceData(ticker);
          dataSource = 'yahoo-finance-fallback';
        } else {
          marketData = await fetchFinnhubMarketData(ticker);
          dataSource = 'finnhub-fallback';
        }
      } catch (fallbackError) {
        console.debug(`[sync-data] Fallback also failed for ${ticker}: ${fallbackError.message}`);
        return [];
      }
    }

    if (!marketData) {
      return [];
    }

    const sector = clampText(marketData.sector || 'Unknown', 128);
    const marketCap = safeNumber(marketData.marketCap);
    const pe = safeNumber(marketData.pe);
    const eps = safeNumber(marketData.eps);

    const advFund = marketData.advancedFundamentals || {};
    const roe = safeNumber(advFund.returnOnEquity);

    const return3m = 0;
    const rsi = safeNumber(marketData.rsi);
    const volume = safeNumber(marketData.volume);
    const avgVolume = safeNumber(marketData.avgVolume);
    const volumeRatio = avgVolume > 0 ? volume / avgVolume : null;

    const shortMetrics = marketData.shortMetrics || null;
    const shortPercent = shortMetrics && Number.isFinite(shortMetrics.shortPercent) ? shortMetrics.shortPercent : null;
    // PostgreSQL BOOLEAN: use true/false instead of 1/0
    const shortIsMock = shortMetrics ? shortMetrics.isMock === true : null;
    const shortDataSource = shortMetrics ? clampText(shortMetrics.dataSource || '', 128) || null : null;

    function buildFundamentalScore(params) {
      const peScore = params.pe > 0 ? clampScore((28 - params.pe) / 28) : 0;
      const epsScore = clampScore((params.eps || 0) / 8);
      const roePercent = safeNumber(params.roe) * 100;
      const roeScore = clampScore(roePercent / 20);
      const sizeScore = params.marketCap > 0 ? clampScore((Math.log10(params.marketCap) - 10) / 3) : 0;
      const avg = (peScore + epsScore + roeScore + sizeScore) / 4;
      return parseFloat(isNaN(avg) ? 0 : avg.toFixed(2));
    }

    function buildTradingScore(params) {
      const momentumScore = clampScore((params.return3m || 0) / 20);
      const rsiScore = Number.isFinite(params.rsi) ? clampScore((params.rsi - 50) / 25) : 0;
      const volumeScore = Number.isFinite(params.volumeRatio) ? clampScore((params.volumeRatio - 1) / 1.2) : 0;
      const avg = (momentumScore + rsiScore + volumeScore) / 3;
      return parseFloat(isNaN(avg) ? 0 : avg.toFixed(2));
    }

    const fundamentalScore = buildFundamentalScore({ pe, eps, roe, marketCap });
    const tradingScore = buildTradingScore({ return3m, rsi, volumeRatio });

    return [{
      ticker: clampText(ticker, 32),
      sector,
      marketCap: marketCap > 0 ? Math.floor(marketCap) : null,
      peRatio: pe || null,
      eps: eps || null,
      roe: roe || null,
      fundamentalScore: Number.isFinite(fundamentalScore) ? fundamentalScore : null,
      tradingScore: Number.isFinite(tradingScore) ? tradingScore : null,
      return3m: return3m || null,
      rsi: Number.isFinite(rsi) ? rsi : null,
      volumeRatio: volumeRatio ? parseFloat(volumeRatio.toFixed(2)) : null,
      shortPercent,
      shortIsMock,
      shortDataSource,
      collectedAtUtc: new Date(),
      dataSource: clampText(dataSource, 64),
    }];
  } catch (error) {
    console.error(`[sync-data] Fundamentals fetch for ${ticker} failed:`, error.message);
    return [];
  }
}

async function fetchTickerNewsRows(ticker) {
  let marketData;
  if (ticker.includes('.')) {
    marketData = await fetchYahooFinanceData(ticker);
  } else {
    try {
      marketData = await fetchFinnhubMarketData(ticker);
    } catch {
      marketData = await fetchAlphaVantageMarketData(ticker);
    }
  }

  const collectedAtUtc = toDateOrNow(marketData?.collectedAt);
  return normalizeNewsRows({
    ticker,
    news: marketData?.news,
    collectedAtUtc,
    dataSource: marketData?.dataSource || 'unknown',
    sourceBreakdown: marketData?.dataSourceBreakdown?.news || null,
    newsScope: 'ticker',
  });
}

async function fetchMacroNewsRows() {
  const [finnhubMacro, newsApiMacro] = await Promise.all([
    fetchFinnhubMacroNews(),
    fetchNewsApiMacroNews(),
  ]);

  let merged = dedupeArticlesByTitle([...(finnhubMacro || []), ...(newsApiMacro || [])]);

  if (!hasFreshMacroCoverage(merged)) {
    const googleSupplement = await fetchGoogleNewsRssQuery(MACRO_GOOGLE_QUERY);
    merged = dedupeArticlesByTitle([...(googleSupplement || []), ...merged]);
  }

  const scored = await scoreMacroNewsWithLlm(merged, {
    ticker: GLOBAL_TICKER,
    sector: 'Global Macro',
  });

  const collectedAtUtc = new Date();
  return normalizeNewsRows({
    ticker: GLOBAL_TICKER,
    news: scored,
    collectedAtUtc,
    dataSource: 'macro-aggregated',
    sourceBreakdown: 'Finnhub + NewsAPI (+Google fallback)',
    newsScope: 'macro',
  });
}

async function ensureSchema(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ========== NEWS ARCHIVE TABLE ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_news_archive (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        news_scope VARCHAR(16) NOT NULL,
        ticker VARCHAR(32) NOT NULL,
        title VARCHAR(1024) NOT NULL,
        summary TEXT NULL,
        url VARCHAR(2048) NULL,
        source VARCHAR(255) NULL,
        sentiment DOUBLE PRECISION NULL,
        macro_theme VARCHAR(64) NULL,
        hours_ago INT NULL,
        published_at_utc TIMESTAMPTZ NULL,
        collected_at_utc TIMESTAMPTZ NOT NULL,
        data_source VARCHAR(64) NOT NULL,
        news_source_breakdown VARCHAR(128) NULL,
        content_hash CHAR(64) NOT NULL,
        created_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE market_news_archive
        ADD COLUMN IF NOT EXISTS macro_theme VARCHAR(64) NULL
    `);

    // Deduplicate existing rows
    await client.query(`
      DELETE FROM market_news_archive
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY news_scope, ticker, title, COALESCE(url, ''), COALESCE(source, '')
              ORDER BY collected_at_utc DESC, id DESC
            ) AS rn
          FROM market_news_archive
        ) sub
        WHERE rn > 1
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_market_news_archive_scope_ticker_hash
        ON market_news_archive (news_scope, ticker, content_hash)
    `);

    // ========== MACRO ANCHORS TABLE ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_macro_anchors (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        anchor_ticker VARCHAR(32) NOT NULL,
        anchor_name VARCHAR(128) NOT NULL,
        anchor_type VARCHAR(32) NOT NULL,
        current_price DOUBLE PRECISION NOT NULL,
        change_percent DOUBLE PRECISION NOT NULL,
        trend VARCHAR(16) NOT NULL,
        price_history TEXT NULL,
        collected_at_utc TIMESTAMPTZ NOT NULL,
        created_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      DROP INDEX IF EXISTS ux_market_macro_anchors_ticker_collected
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS ix_market_macro_anchors_ticker_date
        ON market_macro_anchors (anchor_ticker, collected_at_utc DESC)
    `);

    // ========== CENTRAL BANK DECISIONS TABLE ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS central_bank_decisions (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        bank VARCHAR(32) NOT NULL,
        title VARCHAR(1024) NOT NULL,
        summary TEXT NULL,
        url VARCHAR(2048) NULL,
        source VARCHAR(255) NULL,
        bias VARCHAR(32) NULL,
        hours_ago INT NULL,
        published_at_utc TIMESTAMPTZ NULL,
        collected_at_utc TIMESTAMPTZ NOT NULL,
        data_source VARCHAR(64) NOT NULL,
        content_hash CHAR(64) NOT NULL,
        created_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_central_bank_decisions_bank_hash
        ON central_bank_decisions (bank, content_hash)
    `);

    // Deduplicate existing rows
    await client.query(`
      DELETE FROM central_bank_decisions
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY bank, title, COALESCE(url, ''), COALESCE(source, '')
              ORDER BY collected_at_utc DESC, id DESC
            ) AS rn
          FROM central_bank_decisions
        ) sub
        WHERE rn > 1
      )
    `);

    // ========== TICKER FUNDAMENTALS TABLE ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticker_fundamentals (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ticker VARCHAR(32) NOT NULL,
        sector VARCHAR(128) NULL,
        market_cap BIGINT NULL,
        pe_ratio DOUBLE PRECISION NULL,
        eps DOUBLE PRECISION NULL,
        roe DOUBLE PRECISION NULL,
        fundamental_score DOUBLE PRECISION NULL,
        trading_score DOUBLE PRECISION NULL,
        return_3m DOUBLE PRECISION NULL,
        rsi DOUBLE PRECISION NULL,
        volume_ratio DOUBLE PRECISION NULL,
        short_percent DOUBLE PRECISION NULL,
        short_is_mock BOOLEAN NULL,
        short_data_source VARCHAR(128) NULL,
        collected_at_utc TIMESTAMPTZ NOT NULL,
        data_source VARCHAR(64) NOT NULL,
        created_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE ticker_fundamentals
        ADD COLUMN IF NOT EXISTS short_percent DOUBLE PRECISION NULL,
        ADD COLUMN IF NOT EXISTS short_is_mock BOOLEAN NULL,
        ADD COLUMN IF NOT EXISTS short_data_source VARCHAR(128) NULL
    `);

    await client.query(`
      DROP INDEX IF EXISTS ux_ticker_fundamentals_ticker_collected
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS ix_ticker_fundamentals_ticker_date
        ON ticker_fundamentals (ticker, collected_at_utc DESC)
    `);

    // ========== MARKET CONTEXT TABLE ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_context (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        context_type VARCHAR(32) NOT NULL,
        context_name VARCHAR(128) NOT NULL,
        context_ticker VARCHAR(32) NOT NULL,
        trend VARCHAR(16) NOT NULL,
        change_percent DOUBLE PRECISION NOT NULL,
        price_history TEXT NULL,
        collected_at_utc TIMESTAMPTZ NOT NULL,
        created_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_market_context_type_ticker_collected
        ON market_context (context_type, context_ticker, collected_at_utc)
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function insertRowIfNew(pool, row) {
  const existing = await pool.query(
    `SELECT 1 FROM market_news_archive
     WHERE news_scope = $1
       AND ticker = $2
       AND (
         content_hash = $3
         OR (
           title = $4
           AND COALESCE(url, '') = COALESCE($5, '')
           AND COALESCE(source, '') = COALESCE($6, '')
         )
       )
     LIMIT 1`,
    [row.newsScope, row.ticker, row.contentHash, row.title, row.url || null, row.source || null]
  );

  if (existing.rowCount > 0) return 'SKIP';

  try {
    await pool.query(
      `INSERT INTO market_news_archive (
        news_scope, ticker, title, summary, url, source, sentiment,
        macro_theme, hours_ago, published_at_utc, collected_at_utc,
        data_source, news_source_breakdown, content_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        row.newsScope,
        row.ticker,
        row.title,
        row.summary,
        row.url || null,
        row.source || null,
        row.sentiment,
        row.macroTheme || null,
        row.hoursAgo,
        row.publishedAtUtc,
        row.collectedAtUtc,
        row.dataSource,
        row.newsSourceBreakdown,
        row.contentHash,
      ]
    );
    return 'INSERT';
  } catch (err) {
    if (err.code === '23505') return 'SKIP'; // unique constraint race condition
    throw err;
  }
}

async function insertMacroAnchorIfNew(pool, anchor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Replace today's snapshot for this anchor
    await client.query(
      `DELETE FROM market_macro_anchors
       WHERE anchor_ticker = $1
         AND collected_at_utc::date = $2::date`,
      [anchor.anchorTicker, anchor.collectedAtUtc]
    );

    const result = await client.query(
      `INSERT INTO market_macro_anchors (
        anchor_ticker, anchor_name, anchor_type,
        current_price, change_percent, trend, price_history, collected_at_utc
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        anchor.anchorTicker,
        anchor.anchorName,
        anchor.anchorType,
        anchor.currentPrice,
        anchor.changePercent,
        anchor.trend,
        anchor.priceHistory,
        anchor.collectedAtUtc,
      ]
    );

    await client.query('COMMIT');
    return result.rowCount > 0 ? 'INSERT' : 'SKIP';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function insertCentralBankDecisionIfNew(pool, decision) {
  const existing = await pool.query(
    `SELECT 1 FROM central_bank_decisions
     WHERE bank = $1
       AND (
         content_hash = $2
         OR (
           title = $3
           AND COALESCE(url, '') = COALESCE($4, '')
           AND COALESCE(source, '') = COALESCE($5, '')
         )
       )
     LIMIT 1`,
    [decision.bank, decision.contentHash, decision.title, decision.url || null, decision.source || null]
  );

  if (existing.rowCount > 0) return 'SKIP';

  try {
    await pool.query(
      `INSERT INTO central_bank_decisions (
        bank, title, summary, url, source, bias,
        hours_ago, published_at_utc, collected_at_utc, data_source, content_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        decision.bank,
        decision.title,
        decision.summary,
        decision.url || null,
        decision.source || null,
        decision.bias || null,
        decision.hoursAgo,
        decision.publishedAtUtc,
        decision.collectedAtUtc,
        decision.dataSource,
        decision.contentHash,
      ]
    );
    return 'INSERT';
  } catch (err) {
    if (err.code === '23505') return 'SKIP'; // unique constraint race condition
    throw err;
  }
}

async function insertTickerFundamentalIfNew(pool, fundamental) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Replace today's snapshot for this ticker
    await client.query(
      `DELETE FROM ticker_fundamentals
       WHERE ticker = $1
         AND collected_at_utc::date = $2::date`,
      [fundamental.ticker, fundamental.collectedAtUtc]
    );

    const result = await client.query(
      `INSERT INTO ticker_fundamentals (
        ticker, sector, market_cap, pe_ratio, eps, roe,
        fundamental_score, trading_score, return_3m, rsi, volume_ratio,
        short_percent, short_is_mock, short_data_source,
        collected_at_utc, data_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        fundamental.ticker,
        fundamental.sector,
        fundamental.marketCap,
        fundamental.peRatio,
        fundamental.eps,
        fundamental.roe,
        fundamental.fundamentalScore,
        fundamental.tradingScore,
        fundamental.return3m,
        fundamental.rsi,
        fundamental.volumeRatio,
        fundamental.shortPercent ?? null,
        fundamental.shortIsMock ?? null,
        fundamental.shortDataSource ?? null,
        fundamental.collectedAtUtc,
        fundamental.dataSource,
      ]
    );

    await client.query('COMMIT');
    return result.rowCount > 0 ? 'INSERT' : 'SKIP';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main(opts = {}) {
  const dryRun = opts.dryRun !== undefined ? opts.dryRun : hasFlag('--dry-run');
  const tickers = opts.tickers !== undefined ? opts.tickers : parseTickers();

  console.log(`[sync] Macro mode: shared global news. Ticker mode: ${tickers.length} symbols.`);

  const allNewsRows = [];
  const allMacroAnchors = [];
  const allCentralBankDecisions = [];
  const allFundamentals = [];

  // ===== COLLECT NEWS DATA =====
  process.stdout.write('[sync] Collecting shared macro/geopolitical news... ');
  const macroRows = await fetchMacroNewsRows();
  allNewsRows.push(...macroRows);
  console.log(`ok (${macroRows.length} rows)`);

  for (const ticker of tickers) {
    process.stdout.write(`[sync] Collecting ticker news for ${ticker}... `);
    const rows = await fetchTickerNewsRows(ticker);
    allNewsRows.push(...rows);
    console.log(`ok (${rows.length} rows)`);
  }

  // ===== COLLECT CENTRAL BANK DATA =====
  process.stdout.write('[sync] Collecting central bank decisions... ');
  const cbDecisions = await fetchCentralBankDecisionsRows();
  allCentralBankDecisions.push(...cbDecisions);
  console.log(`ok (${cbDecisions.length} rows)`);

  // ===== COLLECT MACRO ANCHORS =====
  process.stdout.write('[sync] Collecting macro anchors (commodities, indices)... ');
  const macroAnchors = await fetchMacroAnchorsRows();
  allMacroAnchors.push(...macroAnchors);
  console.log(`ok (${macroAnchors.length} rows)`);

  // ===== COLLECT TICKER FUNDAMENTALS =====
  for (const ticker of tickers) {
    process.stdout.write(`[sync] Collecting fundamentals for ${ticker}... `);
    const fundamentals = await fetchTickerFundamentalsRows(ticker);
    allFundamentals.push(...fundamentals);
    console.log(`ok (${fundamentals.length} rows)`);
  }

  const totalRows = allNewsRows.length + allMacroAnchors.length + allCentralBankDecisions.length + allFundamentals.length;

  if (dryRun) {
    console.log(`[sync] Dry run only. Prepared ${totalRows} rows total:`);
    console.log(`  - News: ${allNewsRows.length}`);
    console.log(`  - Central Bank: ${allCentralBankDecisions.length}`);
    console.log(`  - Macro Anchors: ${allMacroAnchors.length}`);
    console.log(`  - Fundamentals: ${allFundamentals.length}`);
    return;
  }

  if (totalRows === 0) {
    console.log('[sync] No rows collected; nothing to write.');
    return;
  }

  const pool = new Pool(resolvePoolConfig());
  try {
    await ensureSchema(pool);

    let newsInserted = 0, newsSkipped = 0;
    let cbInserted = 0, cbSkipped = 0;
    let anchorsInserted = 0, anchorsSkipped = 0;
    let fundsInserted = 0, fundsSkipped = 0;

    for (const row of allNewsRows) {
      const action = await insertRowIfNew(pool, row);
      if (action === 'INSERT') newsInserted += 1;
      if (action === 'SKIP') newsSkipped += 1;
    }

    for (const decision of allCentralBankDecisions) {
      const action = await insertCentralBankDecisionIfNew(pool, decision);
      if (action === 'INSERT') cbInserted += 1;
      if (action === 'SKIP') cbSkipped += 1;
    }

    for (const anchor of allMacroAnchors) {
      const action = await insertMacroAnchorIfNew(pool, anchor);
      if (action === 'INSERT') anchorsInserted += 1;
      if (action === 'SKIP') anchorsSkipped += 1;
    }

    for (const fundamental of allFundamentals) {
      const action = await insertTickerFundamentalIfNew(pool, fundamental);
      if (action === 'INSERT') fundsInserted += 1;
      if (action === 'SKIP') fundsSkipped += 1;
    }

    console.log(`[sync] Completed. Inserted total: ${newsInserted + cbInserted + anchorsInserted + fundsInserted}`);
    console.log(`  - News: INSERT=${newsInserted}, SKIP=${newsSkipped}`);
    console.log(`  - Central Bank: INSERT=${cbInserted}, SKIP=${cbSkipped}`);
    console.log(`  - Macro Anchors: INSERT=${anchorsInserted}, SKIP=${anchorsSkipped}`);
    console.log(`  - Fundamentals: INSERT=${fundsInserted}, SKIP=${fundsSkipped}`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[sync] Failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
