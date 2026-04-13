// API endpoint for Vercel Cron: triggers daily news sync
// Accessible at: /api/cron/sync-news

const { main: syncNews } = require('../../scripts/sync-news-to-neon');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  // Verify cron secret to prevent unauthorized calls
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured' });
  }

  const providedAuth = String(req.headers['authorization'] || '');
  const expectedAuth = `Bearer ${cronSecret}`;
  const providedBuf = Buffer.from(providedAuth, 'utf8');
  const expectedBuf = Buffer.from(expectedAuth, 'utf8');
  const isAuthorized = providedBuf.length === expectedBuf.length
    && crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[cron] Starting daily news sync...');

    const rawTickers = String(process.env.NEWS_SYNC_TICKERS || 'MSB.AX').trim();
    const tickers = rawTickers
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    await syncNews({ tickers });

    console.log('[cron] Sync completed successfully');
    return res.status(200).json({ success: true, message: 'News sync completed' });
  } catch (error) {
    console.error('[cron] Error:', error.message);
    return res.status(500).json({ error: 'Sync error', message: error.message });
  }
};
