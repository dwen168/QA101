#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const sql = require('mssql');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const config = {
    server: process.env.AZURE_SQL_SERVER || 'quantbot.database.windows.net',
    database: process.env.AZURE_SQL_DATABASE || process.env.CLOUDEVENT_DB_DATABASE,
    user: process.env.CLOUDEVENT_DB_USERNAME,
    password: process.env.CLOUDEVENT_DB_PASSWORD,
    port: Number(process.env.AZURE_SQL_PORT) || 1433,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    requestTimeout: 30000,
  };

  const pool = await sql.connect(config);
  try {
    // Check all tables
    const tables = [
      'market_news_archive',
      'central_bank_decisions',
      'market_macro_anchors',
      'ticker_fundamentals',
      'market_context',
    ];

    console.log('[verify] Connected to Azure SQL\n');

    for (const table of tables) {
      try {
        const result = await pool.request().query(`SELECT COUNT(*) as cnt FROM dbo.[${table}]`);
        const count = result.recordset[0]?.cnt || 0;
        console.log(`✓ ${table}: ${count} rows`);
      } catch (e) {
        console.log(`✗ ${table}: table does not exist`);
      }
    }

    console.log('\n--- NEWS WITH MACRO_THEME (sample) ---');
    const newsResult = await pool.request().query(`
      SELECT TOP 5 
        ticker,
        title,
        macro_theme,
        sentiment,
        collected_at_utc
      FROM dbo.market_news_archive
      WHERE macro_theme IS NOT NULL
      ORDER BY collected_at_utc DESC
    `);
    newsResult.recordset.forEach((row) => {
      console.log(`  [${row.ticker}] ${row.title.substring(0, 60)}...`);
      console.log(`    Theme: ${row.macro_theme}, Sentiment: ${row.sentiment}`);
    });

    console.log('\n--- CENTRAL BANK DECISIONS ---');
    const cbResult = await pool.request().query(`
      SELECT 
        bank,
        title,
        bias,
        hours_ago,
        collected_at_utc
      FROM dbo.central_bank_decisions
      ORDER BY collected_at_utc DESC
    `);
    cbResult.recordset.forEach((row) => {
      console.log(`  [${row.bank}] ${row.title.substring(0, 60)}...`);
      console.log(`    Bias: ${row.bias}, ${row.hours_ago}h ago`);
    });

    console.log('\n--- MACRO ANCHORS (Commodities & Indices) ---');
    const anchorsResult = await pool.request().query(`
      SELECT 
        anchor_ticker,
        anchor_name,
        current_price,
        change_percent,
        trend
      FROM dbo.market_macro_anchors
      ORDER BY collected_at_utc DESC
    `);
    anchorsResult.recordset.forEach((row) => {
      console.log(`  [${row.anchor_ticker}] ${row.anchor_name}`);
      console.log(`    Price: ${row.current_price}, Change: ${row.change_percent}%, Trend: ${row.trend}`);
    });

    console.log('\n--- SUMMARY ---');
    const summaryResult = await pool.request().query(`
      SELECT 
        'market_news_archive' as table_name, COUNT(*) as total FROM dbo.market_news_archive
      UNION ALL
      SELECT 'central_bank_decisions', COUNT(*) FROM dbo.central_bank_decisions
      UNION ALL
      SELECT 'market_macro_anchors', COUNT(*) FROM dbo.market_macro_anchors
      UNION ALL
      SELECT 'ticker_fundamentals', COUNT(*) FROM dbo.ticker_fundamentals
      UNION ALL
      SELECT 'market_context', COUNT(*) FROM dbo.market_context
    `);
    console.log('Table Summary:');
    summaryResult.recordset.forEach((row) => {
      console.log(`  ${row.table_name}: ${row.total}`);
    });

  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error('[verify] Failed:', error.message);
  process.exitCode = 1;
});
