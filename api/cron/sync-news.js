// API endpoint for Vercel Cron: triggers daily news sync
// Accessible at: /api/cron/sync-news

const { main: syncNews } = require('../../scripts/sync-news-to-neon');

module.exports = async function handler(req, res) {
  // Verify cron secret to prevent unauthorized calls
  const cronSecret = process.env.CRON_SECRET;
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
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
