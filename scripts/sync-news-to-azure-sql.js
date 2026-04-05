#!/usr/bin/env node

const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const sql = require('mssql');

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

function envPick(...keys) {
  for (const key of keys) {
    const value = process.env[key] || process.env[String(key).toLowerCase()];
    if (String(value || '').trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function resolveSqlConfig() {
  const user = envPick('CLOUDEVENT_DB_USERNAME', 'AZURE_SQL_USERNAME');
  const password = envPick('CLOUDEVENT_DB_PASSWORD', 'AZURE_SQL_PASSWORD');
  const database = envPick('AZURE_SQL_DATABASE', 'CLOUDEVENT_DB_DATABASE', 'CLOUDEVENT_DB_NAME');

  if (!user || !password) {
    throw new Error('Missing DB credentials. Set CLOUDEVENT_DB_USERNAME and CLOUDEVENT_DB_PASSWORD.');
  }
  if (!database) {
    throw new Error('Missing database name. Set AZURE_SQL_DATABASE (or CLOUDEVENT_DB_DATABASE).');
  }

  return {
    server: envPick('AZURE_SQL_SERVER') || 'quantbot.database.windows.net',
    database,
    user,
    password,
    port: Number(envPick('AZURE_SQL_PORT') || 1433),
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    requestTimeout: 30000,
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
    
    // Fetch RBA and FED decisions
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

    // Select appropriate data source based on ticker format
    try {
      if (ticker.includes('.')) {
        // ASX ticker (e.g., CBA.AX) - use Yahoo Finance
        marketData = await fetchYahooFinanceData(ticker);
        dataSource = 'yahoo-finance';
      } else {
        // US ticker - use Finnhub
        marketData = await fetchFinnhubMarketData(ticker);
        dataSource = 'finnhub';
      }
    } catch (error) {
      console.debug(`[sync-data] Market data fetch for ${ticker} failed (trying fallback): ${error.message}`);
      // Fallback: try the other source
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

    // Extract fundamentals from market data
    const sector = clampText(marketData.sector || 'Unknown', 128);
    const marketCap = safeNumber(marketData.marketCap);
    const pe = safeNumber(marketData.pe);
    const eps = safeNumber(marketData.eps);
    
    // Advanced fundamentals from Yahoo Finance (if available)
    const advFund = marketData.advancedFundamentals || {};
    const roe = safeNumber(advFund.returnOnEquity);
    
    // Trading metrics
    const return3m = 0; // Not easily derived from single fetch, would need historical calculation
    const rsi = safeNumber(marketData.rsi);
    const volume = safeNumber(marketData.volume);
    const avgVolume = safeNumber(marketData.avgVolume);
    const volumeRatio = avgVolume > 0 ? volume / avgVolume : null;

    // Short selling data (ASX only via ASIC/ShortMan)
    const shortMetrics = marketData.shortMetrics || null;
    const shortPercent = shortMetrics && Number.isFinite(shortMetrics.shortPercent) ? shortMetrics.shortPercent : null;
    const shortIsMock = shortMetrics ? (shortMetrics.isMock === true ? 1 : 0) : null;
    const shortDataSource = shortMetrics ? clampText(shortMetrics.dataSource || '', 128) || null : null;

    // Compute scores (same logic as market-data.js)
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
  const sqlText = `
-- ========== NEWS ARCHIVE TABLE (WITH UPDATES) ==========
IF OBJECT_ID('dbo.market_news_archive', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.market_news_archive (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    news_scope NVARCHAR(16) NOT NULL,
    ticker NVARCHAR(32) NOT NULL,
    title NVARCHAR(1024) NOT NULL,
    summary NVARCHAR(MAX) NULL,
    url NVARCHAR(2048) NULL,
    source NVARCHAR(255) NULL,
    sentiment FLOAT NULL,
    macro_theme NVARCHAR(64) NULL,
    hours_ago INT NULL,
    published_at_utc DATETIME2 NULL,
    collected_at_utc DATETIME2 NOT NULL,
    data_source NVARCHAR(64) NOT NULL,
    news_source_breakdown NVARCHAR(128) NULL,
    content_hash CHAR(64) NOT NULL,
    created_at_utc DATETIME2 NOT NULL CONSTRAINT DF_market_news_archive_created_at DEFAULT SYSUTCDATETIME()
  );
END
ELSE
BEGIN
  -- Add macro_theme column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'market_news_archive'
      AND COLUMN_NAME = 'macro_theme'
      AND TABLE_SCHEMA = 'dbo'
  )
  BEGIN
    ALTER TABLE dbo.market_news_archive
    ADD macro_theme NVARCHAR(64) NULL;
  END;
END;

;WITH ranked_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        news_scope,
        ticker,
        title,
        ISNULL(url, ''),
        ISNULL(source, '')
      ORDER BY collected_at_utc DESC, id DESC
    ) AS rn
  FROM dbo.market_news_archive
)
DELETE FROM dbo.market_news_archive
WHERE id IN (
  SELECT id
  FROM ranked_duplicates
  WHERE rn > 1
);

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_market_news_archive_scope_ticker_hash'
    AND object_id = OBJECT_ID('dbo.market_news_archive')
)
BEGIN
  CREATE UNIQUE INDEX UX_market_news_archive_scope_ticker_hash
    ON dbo.market_news_archive (news_scope, ticker, content_hash);
END;

-- ========== MACRO ANCHORS TABLE ==========
IF OBJECT_ID('dbo.market_macro_anchors', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.market_macro_anchors (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    anchor_ticker NVARCHAR(32) NOT NULL,
    anchor_name NVARCHAR(128) NOT NULL,
    anchor_type NVARCHAR(32) NOT NULL,
    current_price FLOAT NOT NULL,
    change_percent FLOAT NOT NULL,
    trend NVARCHAR(16) NOT NULL,
    price_history NVARCHAR(MAX) NULL,
    collected_at_utc DATETIME2 NOT NULL,
    created_at_utc DATETIME2 NOT NULL CONSTRAINT DF_market_macro_anchors_created_at DEFAULT SYSUTCDATETIME()
  );
END;

-- Drop old unique index if it exists (we now use DELETE+INSERT for daily snapshots)
IF EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_market_macro_anchors_ticker_collected'
    AND object_id = OBJECT_ID('dbo.market_macro_anchors')
)
BEGIN
  DROP INDEX UX_market_macro_anchors_ticker_collected ON dbo.market_macro_anchors;
END;

-- Create new index for efficient queries (non-unique, for date-based lookups)
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_market_macro_anchors_ticker_date'
    AND object_id = OBJECT_ID('dbo.market_macro_anchors')
)
BEGIN
  CREATE INDEX IX_market_macro_anchors_ticker_date
    ON dbo.market_macro_anchors (anchor_ticker, collected_at_utc DESC);
END;

-- ========== CENTRAL BANK DECISIONS TABLE ==========
IF OBJECT_ID('dbo.central_bank_decisions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.central_bank_decisions (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    bank NVARCHAR(32) NOT NULL,
    title NVARCHAR(1024) NOT NULL,
    summary NVARCHAR(MAX) NULL,
    url NVARCHAR(2048) NULL,
    source NVARCHAR(255) NULL,
    bias NVARCHAR(32) NULL,
    hours_ago INT NULL,
    published_at_utc DATETIME2 NULL,
    collected_at_utc DATETIME2 NOT NULL,
    data_source NVARCHAR(64) NOT NULL,
    content_hash CHAR(64) NOT NULL,
    created_at_utc DATETIME2 NOT NULL CONSTRAINT DF_central_bank_decisions_created_at DEFAULT SYSUTCDATETIME()
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_central_bank_decisions_bank_hash'
    AND object_id = OBJECT_ID('dbo.central_bank_decisions')
)
BEGIN
  CREATE UNIQUE INDEX UX_central_bank_decisions_bank_hash
    ON dbo.central_bank_decisions (bank, content_hash);
END;

;WITH ranked_central_bank_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        bank,
        title,
        ISNULL(url, ''),
        ISNULL(source, '')
      ORDER BY collected_at_utc DESC, id DESC
    ) AS rn
  FROM dbo.central_bank_decisions
)
DELETE FROM dbo.central_bank_decisions
WHERE id IN (
  SELECT id
  FROM ranked_central_bank_duplicates
  WHERE rn > 1
);

-- ========== TICKER FUNDAMENTALS TABLE ==========
IF OBJECT_ID('dbo.ticker_fundamentals', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ticker_fundamentals (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    ticker NVARCHAR(32) NOT NULL,
    sector NVARCHAR(128) NULL,
    market_cap BIGINT NULL,
    pe_ratio FLOAT NULL,
    eps FLOAT NULL,
    roe FLOAT NULL,
    fundamental_score FLOAT NULL,
    trading_score FLOAT NULL,
    return_3m FLOAT NULL,
    rsi FLOAT NULL,
    volume_ratio FLOAT NULL,
    short_percent FLOAT NULL,
    short_is_mock BIT NULL,
    short_data_source NVARCHAR(128) NULL,
    collected_at_utc DATETIME2 NOT NULL,
    data_source NVARCHAR(64) NOT NULL,
    created_at_utc DATETIME2 NOT NULL CONSTRAINT DF_ticker_fundamentals_created_at DEFAULT SYSUTCDATETIME()
  );
END
ELSE
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ticker_fundamentals' AND COLUMN_NAME = 'short_percent' AND TABLE_SCHEMA = 'dbo'
  )
  BEGIN
    ALTER TABLE dbo.ticker_fundamentals ADD short_percent FLOAT NULL;
    ALTER TABLE dbo.ticker_fundamentals ADD short_is_mock BIT NULL;
    ALTER TABLE dbo.ticker_fundamentals ADD short_data_source NVARCHAR(128) NULL;
  END;
END;

-- Drop old unique index if it exists (we now use DELETE+INSERT for daily snapshots)
IF EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_ticker_fundamentals_ticker_collected'
    AND object_id = OBJECT_ID('dbo.ticker_fundamentals')
)
BEGIN
  DROP INDEX UX_ticker_fundamentals_ticker_collected ON dbo.ticker_fundamentals;
END;

-- Create new index for efficient queries (non-unique, for date-based lookups)
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_ticker_fundamentals_ticker_date'
    AND object_id = OBJECT_ID('dbo.ticker_fundamentals')
)
BEGIN
  CREATE INDEX IX_ticker_fundamentals_ticker_date
    ON dbo.ticker_fundamentals (ticker, collected_at_utc DESC);
END;

-- ========== MARKET CONTEXT TABLE (Benchmarks + Sectors) ==========
IF OBJECT_ID('dbo.market_context', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.market_context (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    context_type NVARCHAR(32) NOT NULL,
    context_name NVARCHAR(128) NOT NULL,
    context_ticker NVARCHAR(32) NOT NULL,
    trend NVARCHAR(16) NOT NULL,
    change_percent FLOAT NOT NULL,
    price_history NVARCHAR(MAX) NULL,
    collected_at_utc DATETIME2 NOT NULL,
    created_at_utc DATETIME2 NOT NULL CONSTRAINT DF_market_context_created_at DEFAULT SYSUTCDATETIME()
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_market_context_type_ticker_collected'
    AND object_id = OBJECT_ID('dbo.market_context')
)
BEGIN
  CREATE UNIQUE INDEX UX_market_context_type_ticker_collected
    ON dbo.market_context (context_type, context_ticker, collected_at_utc);
END;
`;

  await pool.request().query(sqlText);
}

async function insertRowIfNew(pool, row) {
  const request = pool.request();
  request.input('newsScope', sql.NVarChar(16), row.newsScope);
  request.input('ticker', sql.NVarChar(32), row.ticker);
  request.input('title', sql.NVarChar(1024), row.title);
  request.input('summary', sql.NVarChar(sql.MAX), row.summary);
  request.input('url', sql.NVarChar(2048), row.url || null);
  request.input('source', sql.NVarChar(255), row.source || null);
  request.input('sentiment', sql.Float, row.sentiment);
  request.input('macroTheme', sql.NVarChar(64), row.macroTheme || null);
  request.input('hoursAgo', sql.Int, row.hoursAgo);
  request.input('publishedAtUtc', sql.DateTime2, row.publishedAtUtc);
  request.input('collectedAtUtc', sql.DateTime2, row.collectedAtUtc);
  request.input('dataSource', sql.NVarChar(64), row.dataSource);
  request.input('newsSourceBreakdown', sql.NVarChar(128), row.newsSourceBreakdown);
  request.input('contentHash', sql.Char(64), row.contentHash);

  const insertSql = `
INSERT INTO dbo.market_news_archive (
  news_scope,
  ticker,
  title,
  summary,
  url,
  source,
  sentiment,
  macro_theme,
  hours_ago,
  published_at_utc,
  collected_at_utc,
  data_source,
  news_source_breakdown,
  content_hash
)
SELECT
  @newsScope,
  @ticker,
  @title,
  @summary,
  @url,
  @source,
  @sentiment,
  @macroTheme,
  @hoursAgo,
  @publishedAtUtc,
  @collectedAtUtc,
  @dataSource,
  @newsSourceBreakdown,
  @contentHash
WHERE NOT EXISTS (
  SELECT 1
  FROM dbo.market_news_archive
  WHERE news_scope = @newsScope
    AND ticker = @ticker
    AND (
      content_hash = @contentHash
      OR (
        title = @title
        AND ISNULL(url, '') = ISNULL(@url, '')
        AND ISNULL(source, '') = ISNULL(@source, '')
      )
    )
);
`;

  const result = await request.query(insertSql);
  return result.rowsAffected?.[0] > 0 ? 'INSERT' : 'SKIP';
}

async function insertMacroAnchorIfNew(pool, anchor) {
  const request = pool.request();
  request.input('anchorTicker', sql.NVarChar(32), anchor.anchorTicker);
  request.input('anchorName', sql.NVarChar(128), anchor.anchorName);
  request.input('anchorType', sql.NVarChar(32), anchor.anchorType);
  request.input('currentPrice', sql.Float, anchor.currentPrice);
  request.input('changePercent', sql.Float, anchor.changePercent);
  request.input('trend', sql.NVarChar(16), anchor.trend);
  request.input('priceHistory', sql.NVarChar(sql.MAX), anchor.priceHistory);
  request.input('collectedAtUtc', sql.DateTime2, anchor.collectedAtUtc);

  // Delete old records from the same day (keep only latest snapshot per day)
  const deleteSql = `
  DELETE FROM dbo.market_macro_anchors
  WHERE anchor_ticker = @anchorTicker
    AND CAST(collected_at_utc AS DATE) = CAST(@collectedAtUtc AS DATE);
  `;
  await request.query(deleteSql);

  // Insert new snapshot
  const insertSql = `
  INSERT INTO dbo.market_macro_anchors (
    anchor_ticker,
    anchor_name,
    anchor_type,
    current_price,
    change_percent,
    trend,
    price_history,
    collected_at_utc
  )
  VALUES (
    @anchorTicker,
    @anchorName,
    @anchorType,
    @currentPrice,
    @changePercent,
    @trend,
    @priceHistory,
    @collectedAtUtc
  );
  `;

  const result = await request.query(insertSql);
  return result.rowsAffected?.[0] > 0 ? 'INSERT' : 'SKIP';
}

async function insertCentralBankDecisionIfNew(pool, decision) {
  const request = pool.request();
  request.input('bank', sql.NVarChar(32), decision.bank);
  request.input('title', sql.NVarChar(1024), decision.title);
  request.input('summary', sql.NVarChar(sql.MAX), decision.summary);
  request.input('url', sql.NVarChar(2048), decision.url || null);
  request.input('source', sql.NVarChar(255), decision.source || null);
  request.input('bias', sql.NVarChar(32), decision.bias || null);
  request.input('hoursAgo', sql.Int, decision.hoursAgo);
  request.input('publishedAtUtc', sql.DateTime2, decision.publishedAtUtc);
  request.input('collectedAtUtc', sql.DateTime2, decision.collectedAtUtc);
  request.input('dataSource', sql.NVarChar(64), decision.dataSource);
  request.input('contentHash', sql.Char(64), decision.contentHash);

  const insertSql = `
INSERT INTO dbo.central_bank_decisions (
  bank,
  title,
  summary,
  url,
  source,
  bias,
  hours_ago,
  published_at_utc,
  collected_at_utc,
  data_source,
  content_hash
)
SELECT
  @bank,
  @title,
  @summary,
  @url,
  @source,
  @bias,
  @hoursAgo,
  @publishedAtUtc,
  @collectedAtUtc,
  @dataSource,
  @contentHash
WHERE NOT EXISTS (
  SELECT 1
  FROM dbo.central_bank_decisions
  WHERE bank = @bank
    AND (
      content_hash = @contentHash
      OR (
        title = @title
        AND ISNULL(url, '') = ISNULL(@url, '')
        AND ISNULL(source, '') = ISNULL(@source, '')
      )
    )
);
`;

  const result = await request.query(insertSql);
  return result.rowsAffected?.[0] > 0 ? 'INSERT' : 'SKIP';
}

async function insertTickerFundamentalIfNew(pool, fundamental) {
  const request = pool.request();
  request.input('ticker', sql.NVarChar(32), fundamental.ticker);
  request.input('sector', sql.NVarChar(128), fundamental.sector);
  request.input('marketCap', sql.BigInt, fundamental.marketCap);
  request.input('peRatio', sql.Float, fundamental.peRatio);
  request.input('eps', sql.Float, fundamental.eps);
  request.input('roe', sql.Float, fundamental.roe);
  request.input('fundamentalScore', sql.Float, fundamental.fundamentalScore);
  request.input('tradingScore', sql.Float, fundamental.tradingScore);
  request.input('return3m', sql.Float, fundamental.return3m);
  request.input('rsi', sql.Float, fundamental.rsi);
  request.input('volumeRatio', sql.Float, fundamental.volumeRatio);
  request.input('shortPercent', sql.Float, fundamental.shortPercent ?? null);
  request.input('shortIsMock', sql.Bit, fundamental.shortIsMock ?? null);
  request.input('shortDataSource', sql.NVarChar(128), fundamental.shortDataSource ?? null);
  request.input('collectedAtUtc', sql.DateTime2, fundamental.collectedAtUtc);
  request.input('dataSource', sql.NVarChar(64), fundamental.dataSource);

  // Delete old records from the same day (keep only latest snapshot per day)
  const deleteSql = `
  DELETE FROM dbo.ticker_fundamentals
  WHERE ticker = @ticker
    AND CAST(collected_at_utc AS DATE) = CAST(@collectedAtUtc AS DATE);
  `;
  await request.query(deleteSql);

  // Insert new snapshot
  const insertSql = `
  INSERT INTO dbo.ticker_fundamentals (
    ticker,
    sector,
    market_cap,
    pe_ratio,
    eps,
    roe,
    fundamental_score,
    trading_score,
    return_3m,
    rsi,
    volume_ratio,
    short_percent,
    short_is_mock,
    short_data_source,
    collected_at_utc,
    data_source
  )
  VALUES (
    @ticker,
    @sector,
    @marketCap,
    @peRatio,
    @eps,
    @roe,
    @fundamentalScore,
    @tradingScore,
    @return3m,
    @rsi,
    @volumeRatio,
    @shortPercent,
    @shortIsMock,
    @shortDataSource,
    @collectedAtUtc,
    @dataSource
  );
  `;

  const result = await request.query(insertSql);
  return result.rowsAffected?.[0] > 0 ? 'INSERT' : 'SKIP';
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const tickers = parseTickers();

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

  const pool = await sql.connect(resolveSqlConfig());
  try {
    await ensureSchema(pool);

    let newsInserted = 0, newsSkipped = 0;
    let cbInserted = 0, cbSkipped = 0;
    let anchorsInserted = 0, anchorsSkipped = 0;
    let fundsInserted = 0, fundsSkipped = 0;

    // Insert news
    for (const row of allNewsRows) {
      const action = await insertRowIfNew(pool, row);
      if (action === 'INSERT') newsInserted += 1;
      if (action === 'SKIP') newsSkipped += 1;
    }

    // Insert central bank decisions
    for (const decision of allCentralBankDecisions) {
      const action = await insertCentralBankDecisionIfNew(pool, decision);
      if (action === 'INSERT') cbInserted += 1;
      if (action === 'SKIP') cbSkipped += 1;
    }

    // Insert macro anchors
    for (const anchor of allMacroAnchors) {
      const action = await insertMacroAnchorIfNew(pool, anchor);
      if (action === 'INSERT') anchorsInserted += 1;
      if (action === 'SKIP') anchorsSkipped += 1;
    }

    // Insert fundamentals
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
    await pool.close();
  }
}

main().catch((error) => {
  console.error('[sync] Failed:', error.message);
  process.exitCode = 1;
});
