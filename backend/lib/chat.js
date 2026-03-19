const axios = require('axios');
const config = require('./config');

async function routeChatMessage({ message, history = [] }) {
  const parseDateRange = (raw) => {
    const text = String(raw || '');
    const matches = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
    if (matches.length >= 2) {
      return { startDate: matches[0], endDate: matches[1] };
    }

    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);
    const fmt = (d) => d.toISOString().split('T')[0];
    return { startDate: fmt(start), endDate: fmt(end) };
  };

  const parseBacktestStrategy = (raw) => {
    const lower = String(raw || '').toLowerCase();
    if (/macd.?bb/.test(lower)) return 'macd-bb';
    if (/rsi.?ma/.test(lower)) return 'rsi-ma';
    return 'trade-recommendation';
  };

  const systemPrompt = `You are QuantBot, an AI-powered quantitative analysis assistant. You help users analyze stocks using specialized Agent Skills:

1. **market-intelligence** — Collects price trends, news, consensus, and sentiment
2. **eda-visual-analysis** — Performs visual exploratory data analysis
3. **trade-recommendation** — Generates BUY/HOLD/SELL recommendations
4. **portfolio-optimization** — Optimizes allocation and ranking across multiple stocks
5. **backtesting** — Replays a strategy on historical data and evaluates performance metrics

When a user mentions a stock ticker or asks to analyze a stock, you MUST:
1. Acknowledge you'll run the analysis
2. Return a JSON command to trigger the skill pipeline

ALWAYS respond with a JSON object in this format:
{
  "message": "Your conversational response here",
  "action": null OR "ANALYZE_STOCK" OR "OPTIMIZE_PORTFOLIO" OR "RUN_BACKTEST",
  "ticker": null OR "TICKER_SYMBOL",
  "tickers": null OR ["TICKER1", "TICKER2", "..."],
  "timeHorizon": null OR "SHORT" OR "MEDIUM" OR "LONG",
  "startDate": null OR "YYYY-MM-DD",
  "endDate": null OR "YYYY-MM-DD",
  "strategyName": null OR "trade-recommendation" OR "macd-bb" OR "rsi-ma",
  "skillSequence": null OR ["market-intelligence", "eda-visual-analysis", "trade-recommendation"]
}

For non-stock questions, set action to null and just respond conversationally.
For stock analysis requests, extract the ticker and set action to "ANALYZE_STOCK".
For portfolio optimization requests with multiple tickers, set action to "OPTIMIZE_PORTFOLIO" and provide tickers array.
For backtest requests, set action to "RUN_BACKTEST" and include ticker, startDate, endDate, and strategyName.

Common tickers: AAPL (Apple), TSLA (Tesla), NVDA (Nvidia), MSFT (Microsoft), AMZN (Amazon), GOOGL (Google), META (Meta).

Be concise, professional, and enthusiastic about quantitative analysis.`;

  const messages = [
    ...history.map((entry) => ({ role: entry.role, content: entry.content })),
    { role: 'user', content: message },
  ];

  try {
    if (!config.deepseekApiKey) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }

    const response = await axios.post(
      `${config.deepseekBaseUrl}/chat/completions`,
      {
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.5,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${config.deepseekApiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const content = response.data.choices[0].message.content;
    const cleaned = String(content || '').replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const parseTimeHorizon = (raw) => {
      const lower = String(raw || '').toLowerCase();
      if (/short|swing|day trade|intraday|near term|near-term/.test(lower)) return 'SHORT';
      if (/long|long term|long-term|invest|retirement/.test(lower)) return 'LONG';
      return 'MEDIUM';
    };

    const extractTickers = (raw) => {
      const upper = String(raw || '').toUpperCase();
      const matches = upper.match(/\b([A-Z0-9]{1,6}(?:\.[A-Z]{1,3})?)\b/g) || [];
      const banned = new Set([
        'I', 'A', 'AN', 'THE', 'AND', 'OR', 'TO', 'FOR', 'OF', 'IN', 'ON', 'AT', 'WITH',
        'BUY', 'SELL', 'HOLD', 'CHECK', 'LOOK', 'WHAT', 'ABOUT', 'SHOULD', 'IS', 'ARE',
        'PORTFOLIO', 'OPTIMIZE', 'OPTIMISE', 'REBALANCE', 'ALLOCATE', 'ANALYZE', 'ANALYSE',
        'SHORT', 'MEDIUM', 'LONG', 'TERM', 'MY', 'ME', 'PLEASE', 'NOW'
      ]);
      const unique = [];
      for (const m of matches) {
        if (!banned.has(m) && !unique.includes(m)) unique.push(m);
      }
      return unique;
    };

    // Fallback: extract ticker from message
    // Matches: US tickers (AAPL, TSLA, CBA), international (CBA.AX, 7203.T, HSBA.L), NASDAQ/NYSE codes
    const msg = String(message || '').toUpperCase().trim();
    const tickers = extractTickers(msg);

    const lowerMsg = msg.toLowerCase();
    const portfolioIntent = /portfolio|optimi[sz]e|allocat|weight|rebalance|diversif|basket|multi.?stock|组合|调仓|配置|优化/.test(lowerMsg);
    if (portfolioIntent) {
      if (tickers.length >= 2) {
        return {
          message: `I will optimize a ${tickers.length}-stock portfolio (${tickers.join(', ')}) for ${parseTimeHorizon(msg).toLowerCase()} horizon.`,
          action: 'OPTIMIZE_PORTFOLIO',
          ticker: null,
          tickers,
          timeHorizon: parseTimeHorizon(msg),
          startDate: null,
          endDate: null,
          strategyName: null,
          skillSequence: ['portfolio-optimization'],
        };
      }

      return {
        message: 'I can optimize your portfolio. Please provide at least 2 tickers, e.g. "Optimize portfolio AAPL, MSFT, NVDA".',
        action: null,
        ticker: null,
        tickers: null,
        timeHorizon: null,
        startDate: null,
        endDate: null,
        strategyName: null,
        skillSequence: null,
      };
    }

    const backtestIntent = /backtest|back.?testing|回测|复盘|strategy test|historical test/.test(lowerMsg);
    if (backtestIntent) {
      if (tickers.length >= 1) {
        const { startDate, endDate } = parseDateRange(msg);
        const strategyName = parseBacktestStrategy(msg);
        return {
          message: `I will backtest ${tickers[0]} using ${strategyName} from ${startDate} to ${endDate}.`,
          action: 'RUN_BACKTEST',
          ticker: tickers[0],
          tickers: null,
          timeHorizon: null,
          startDate,
          endDate,
          strategyName,
          skillSequence: ['backtesting'],
        };
      }

      return {
        message: 'I can run a backtest. Please provide a ticker, for example: "Backtest AAPL from 2025-01-01 to 2026-03-18".',
        action: null,
        ticker: null,
        tickers: null,
        timeHorizon: null,
        startDate: null,
        endDate: null,
        strategyName: null,
        skillSequence: null,
      };
    }
    
    // Pattern: 1-6 alphanumeric chars, optionally followed by dot and 1-3 letter exchange code
    const tickerMatch = msg.match(/\b([A-Z0-9]{1,6}(?:\.[A-Z]{1,3})?)\b/);
    
    // Check if message looks like a ticker query (ticker alone, or with action keywords)
    const hasActionKeyword = msg.toLowerCase().match(/analyz|buy|sell|recommend|look at|check|research|price|news|target|opinion|should i|what.?s|performance/);
    const isTickerOnly = tickerMatch && msg.split(/\s+/).length <= 2; // Just ticker, maybe with one word
    
    if (tickerMatch && (hasActionKeyword || isTickerOnly)) {
      const ticker = tickerMatch[1];
      return {
        message: `I'll analyze ${ticker} for you! Running all three skills now...`,
        action: 'ANALYZE_STOCK',
        ticker: ticker,
        tickers: null,
        timeHorizon: null,
        startDate: null,
        endDate: null,
        strategyName: null,
        skillSequence: ['market-intelligence', 'eda-visual-analysis', 'trade-recommendation'],
      };
    }

    return {
      message: 'I\'m QuantBot! Ask me to analyze a stock, optimize a portfolio, or backtest a strategy. Examples: "Analyze AAPL", "Optimize portfolio AAPL, MSFT, NVDA", "Backtest AAPL from 2025-01-01 to 2026-03-18".',
      action: null,
      ticker: null,
      tickers: null,
      timeHorizon: null,
      startDate: null,
      endDate: null,
      strategyName: null,
    };
  }
}

module.exports = {
  routeChatMessage,
};
