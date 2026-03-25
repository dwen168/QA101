const config = require('../../../../backend/lib/config');
const { 
  withTimeout, 
  ENRICHMENT_TIMEOUT_MS, 
  safeNumber, 
  hoursAgoFromDate,
  dedupeArticlesByTitle,
  resolveArticleSourceLabel
} = require('./utils');
const { 
  detectFedRbaPolicyMention, 
  detectMacroTheme, 
  detectFedMention, 
  detectRbaMention, 
  detectRateDecisionMention, 
  detectRatePolicyBias 
} = require('./macro');
const { scoreSentimentsWithRules } = require('./sentiment');

async function fetchAsicShortSellingData(ticker) {
  try {
    const code = ticker.split('.')[0].toUpperCase();

    const parseShortmanCurrentPosition = (html) => {
      const tableMatch = String(html || '').match(/<table[^>]*id=["']positionInfo["'][^>]*>[\s\S]*?<\/table>/i);
      const tableHtml = tableMatch ? tableMatch[0] : String(html || '');
      const compact = tableHtml.replace(/\s+/g, ' ');

      // Preferred: find "Current position" row then read the following value cell.
      const contextualMatch = compact.match(
        /Current\s*position[\s\S]*?<\/tr>\s*<tr[^>]*>[\s\S]*?<td[^>]*class=["'][^"']*\bca\b[^"']*["'][^>]*>\s*([0-9]+(?:\.[0-9]+)?)%/i
      );
      if (contextualMatch && contextualMatch[1]) {
        return safeNumber(contextualMatch[1], NaN);
      }

      // Fallback: first percentage in position table value cell.
      const genericMatch = compact.match(/<td[^>]*class=["'][^"']*\bca\b[^"']*["'][^>]*>\s*([0-9]+(?:\.[0-9]+)?)%/i);
      if (genericMatch && genericMatch[1]) {
        return safeNumber(genericMatch[1], NaN);
      }
      return NaN;
    };
    
    // Primary source: shortman.com.au (aggregates ASIC data with better UX)
    try {
      const shortmanUrl = `https://www.shortman.com.au/stock?q=${code.toLowerCase()}`;
      const shortmanResponse = await fetch(shortmanUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: ENRICHMENT_TIMEOUT_MS 
      });
      
      if (shortmanResponse.ok) {
        const html = await shortmanResponse.text();
        const shortPercent = parseShortmanCurrentPosition(html);
        if (Number.isFinite(shortPercent) && shortPercent >= 0) {
          return {
            shortPercent: parseFloat(shortPercent.toFixed(2)),
            shortTurnover: 0,
            dataSource: 'ShortMan (ASIC aggregated)',
            available: true,
          };
        }
      }
    } catch (shortmanError) {
      console.warn(`ShortMan fetch failed for ${code}, using mock short data:`, shortmanError.message);
    }

    // Fallback: return mock short data (2%)
    return {
      shortPercent: 2.0,
      shortTurnover: 0,
      dataSource: 'Mock (ShortMan unavailable)',
      isMock: true,
    };
  } catch (error) {
    console.error('Short data fetch failed:', error.message);
    // Final fallback in case of unexpected error
    return {
      shortPercent: 2.0,
      shortTurnover: 0,
      dataSource: 'Mock (Error)',
      isMock: true,
    };
  }
}

async function fetchNewsApiMacroNews() {
  const apiKey = config.newsApiKey;
  if (!apiKey) return [];

  try {
    const RECENT_WINDOW_HOURS = 48;
    const FRESH_NEWS_MIN_HOURS = 24;
    const GEO_KEYWORDS = ['war', 'conflict', 'missile', 'sanction', 'geopolitic', 'iran', 'israel', 'ukraine', 'russia', 'taiwan', 'china'];
    const from = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const query = encodeURIComponent('((fed OR "federal reserve" OR fomc OR powell OR rba OR "reserve bank of australia" OR "cash rate" OR "rate decision" OR "policy meeting" OR war OR sanctions OR geopolitics OR oil) AND (market OR markets OR equities OR asx OR stocks OR investors))');
    const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=20&from=${encodeURIComponent(from)}&apiKey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const payload = await response.json();
    if (!Array.isArray(payload.articles)) return [];

    const ranked = dedupeArticlesByTitle(
      payload.articles
        .map((article) => {
          const text = `${article?.title || ''} ${article?.description || ''}`;
          const hoursAgo = hoursAgoFromDate(article?.publishedAt);
          const theme = detectMacroTheme(text);
          const isPolicy = detectFedRbaPolicyMention(text);
          const lowerText = text.toLowerCase();
          const geoHits = GEO_KEYWORDS.reduce((count, keyword) => (lowerText.includes(keyword) ? count + 1 : count), 0);
          const freshnessScore = Number.isFinite(hoursAgo)
            ? Math.max(0, (RECENT_WINDOW_HOURS - Math.min(hoursAgo, RECENT_WINDOW_HOURS)) / RECENT_WINDOW_HOURS)
            : 0;
          const rankScore =
            freshnessScore +
            (isPolicy ? 0.35 : 0) +
            (theme === 'GEOPOLITICS' ? 0.35 : 0) +
            Math.min(0.4, geoHits * 0.08);

          return {
            ...article,
            __hoursAgo: hoursAgo,
            __theme: theme,
            __rankScore: rankScore,
          };
        })
        .sort((left, right) => {
          const rankDiff = safeNumber(right.__rankScore) - safeNumber(left.__rankScore);
          if (rankDiff !== 0) return rankDiff;
          return safeNumber(left.__hoursAgo, 9999) - safeNumber(right.__hoursAgo, 9999);
        })
    );

    const recentFirst = ranked.filter((article) => safeNumber(article.__hoursAgo, 9999) <= RECENT_WINDOW_HOURS);
    const older = ranked.filter((article) => safeNumber(article.__hoursAgo, 9999) > RECENT_WINDOW_HOURS);
    const selected = (recentFirst.length > 0 ? [...recentFirst, ...older] : ranked).slice(0, 12);

    const scores = scoreSentimentsWithRules(selected.map((article) => article.title || ''));
    const mappedPromises = selected.map(async (article, index) => ({
      title: article.title || '',
      summary: article.description || article.content || '',
      url: article.url || '',
      source: await resolveArticleSourceLabel(article.url, article.source?.name || 'NewsAPI'),
      sentiment: scores[index] ?? 0,
      hoursAgo: safeNumber(article.__hoursAgo, hoursAgoFromDate(article.publishedAt)),
      theme: article.__theme || detectMacroTheme(`${article.title || ''} ${article.description || ''}`),
      scope: 'macro',
    }));

    const mapped = await Promise.all(mappedPromises);
    const hasVeryRecent = mapped.some((article) => safeNumber(article.hoursAgo, 9999) <= FRESH_NEWS_MIN_HOURS);

    if (!hasVeryRecent || mapped.length < 6) {
      const googleSupplement = await fetchGoogleNewsRssQuery('fed OR rba OR rate decision OR geopolitics OR war OR sanctions OR oil markets');
      return dedupeArticlesByTitle([...googleSupplement, ...mapped])
        .sort((left, right) => safeNumber(left.hoursAgo, 9999) - safeNumber(right.hoursAgo, 9999))
        .slice(0, 12);
    }

    return mapped;
  } catch (error) {
    console.error('NewsAPI macro news fetch failed:', error.message);
    return [];
  }
}

async function fetchGoogleNewsRssQuery(queryStr) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(queryStr)}&hl=en-AU&gl=AU&ceid=AU:en`;
    const response = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;
    const linkRegex = /<link[^>]*>(.*?)<\/link>/;

    const items = [];
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      const block = match[1];
      const title = (titleRegex.exec(block)?.[1] || '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
      const pubDate = pubDateRegex.exec(block)?.[1]?.trim() || '';
      const link = linkRegex.exec(block)?.[1]?.trim() || '';
      if (!title) continue;
      const publishMs = pubDate ? Date.parse(pubDate) : 0;
      items.push({
        title,
        summary: '',
        url: link,
        source: 'Google News',
        hoursAgo: publishMs > 0 ? Math.max(0, Math.round((Date.now() - publishMs) / 3600000)) : 0,
      });
    }

    const scores = scoreSentimentsWithRules(items.map((item) => item.title || ''));
    const resolvedPromises = items.map(async (item, index) => ({
      ...item,
      source: await resolveArticleSourceLabel(item.url, item.source),
      sentiment: scores[index] ?? 0,
      theme: detectMacroTheme(`${item.title || ''} ${item.summary || ''}`),
      scope: 'macro',
    }));
    return await Promise.all(resolvedPromises);
  } catch {
    return [];
  }
}

async function fetchLatestCentralBankDecision(bank) {
  const apiKey = config.newsApiKey;

  const bankConfig = bank === 'RBA'
    ? {
        matcher: detectRbaMention,
        query: '(("reserve bank of australia" OR rba OR bullock OR "cash rate") AND ("rate decision" OR "cash rate" OR "held rates" OR "left rates unchanged" OR "rate hike" OR "rate cut" OR "policy meeting" OR "meeting minutes"))',
      }
    : {
        matcher: detectFedMention,
        query: '(("federal reserve" OR fed OR fomc OR powell) AND ("rate decision" OR "interest rate decision" OR "held rates" OR "left rates unchanged" OR "rate hike" OR "rate cut" OR "policy meeting" OR "meeting minutes"))',
      };

  try {
    let article = null;

    if (apiKey) {
      const from = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(bankConfig.query)}&language=en&sortBy=publishedAt&pageSize=12&from=${encodeURIComponent(from)}&apiKey=${apiKey}`;
      const response = await fetch(url);
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload.articles)) {
          article = payload.articles.find((item) => {
            const text = `${item?.title || ''} ${item?.description || ''}`;
            return bankConfig.matcher(text) && detectRateDecisionMention(text);
          }) || null;
        }
      }
    }

    if (!article) {
      const googleQuery = bank === 'RBA'
        ? 'RBA cash rate decision'
        : 'Federal Reserve rate decision';
      const googleItems = await fetchGoogleNewsRssQuery(googleQuery);
      const googleArticle = googleItems.find((item) => {
        const text = `${item?.title || ''} ${item?.summary || ''}`;
        return bankConfig.matcher(text) && detectRateDecisionMention(text);
      });

      if (!googleArticle) return null;

      return {
        ...googleArticle,
        theme: 'MONETARY_POLICY',
        scope: 'macro',
        bank,
        bias: detectRatePolicyBias(`${googleArticle.title || ''} ${googleArticle.summary || ''}`),
      };
    }

    return {
      title: article.title || `${bank} latest rate decision`,
      summary: article.description || article.content || '',
      url: article.url || '',
      source: article.source?.name || 'NewsAPI',
      sentiment: 0,
      hoursAgo: hoursAgoFromDate(article.publishedAt),
      theme: 'MONETARY_POLICY',
      scope: 'macro',
      bank,
      bias: detectRatePolicyBias(`${article.title || ''} ${article.description || ''}`),
    };
  } catch {
    return null;
  }
}

async function fetchAsxAnnouncements(ticker) {
  try {
    const code = ticker.split('.')[0].toUpperCase();
    const url = `https://www.asx.com.au/asx/1/company/${encodeURIComponent(code)}/announcements?count=10&market_sensitive=false`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return [];

    const data = await response.json();
    const items = Array.isArray(data?.data) ? data.data : [];
    if (items.length === 0) return [];

    const headlines = items.slice(0, 8).map((item) => item.header || '');
    const scores = scoreSentimentsWithRules(headlines);

    return items.slice(0, 8).map((item, i) => {
      const releasedAt = item.document_release_date ? Date.parse(item.document_release_date) : 0;
      const hoursAgo = releasedAt > 0 ? Math.max(0, Math.round((Date.now() - releasedAt) / 3600000)) : 0;
      const isSensitive = item.price_sensitive === true || String(item.market_sensitive || '').toLowerCase() === 'true';
      return {
        title: item.header || '(ASX Announcement)',
        summary: isSensitive ? '[Price-sensitive announcement]' : '',
        url: item.url ? `https://www.asx.com.au${item.url}` : '',
        source: 'ASX Announcements',
        sentiment: scores[i] ?? 0,
        hoursAgo,
      };
    });
  } catch (error) {
    console.error('ASX announcements fetch failed:', error.message);
    return [];
  }
}

async function fetchGoogleNewsRss(ticker, companyName) {
  try {
    const code = ticker.split('.')[0].toUpperCase();
    const queryStr = companyName && companyName !== ticker
      ? `${code} OR "${companyName.split(' ').slice(0, 3).join(' ')}" ASX`
      : `${code} ASX`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(queryStr)}&hl=en-AU&gl=AU&ceid=AU:en`;
    const response = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;
    const linkRegex = /<link[^>]*>(.*?)<\/link>/;

    const items = [];
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 6) {
      const block = match[1];
      const title = (titleRegex.exec(block)?.[1] || '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
      const pubDate = pubDateRegex.exec(block)?.[1]?.trim() || '';
      const link = linkRegex.exec(block)?.[1]?.trim() || '';
      if (!title) continue;
      const publishMs = pubDate ? Date.parse(pubDate) : 0;
      const hoursAgo = publishMs > 0 ? Math.max(0, Math.round((Date.now() - publishMs) / 3600000)) : 0;
      items.push({ title, link, hoursAgo });
    }

    if (items.length === 0) return [];

    const scores = scoreSentimentsWithRules(items.map((item) => item.title));
    const itemsPromises = items.map(async (item, i) => ({
      title: item.title,
      summary: '',
      url: item.link,
      source: await resolveArticleSourceLabel(item.link, 'Google News'),
      sentiment: scores[i] ?? 0,
      hoursAgo: item.hoursAgo,
    }));
    return await Promise.all(itemsPromises);
  } catch (error) {
    console.error('Google News RSS fetch failed:', error.message);
    return [];
  }
}

module.exports = {
  fetchAsicShortSellingData,
  fetchNewsApiMacroNews,
  fetchGoogleNewsRssQuery,
  fetchLatestCentralBankDecision,
  fetchAsxAnnouncements,
  fetchGoogleNewsRss,
};
