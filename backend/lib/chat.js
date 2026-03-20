const { callLlm } = require('./llm');

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

  const systemPrompt = `You are QuantBot, a quantitative analysis assistant.

Return ONLY a valid JSON object (no markdown, no code fences, no extra keys) with this schema:
{
  "message": "string",
  "action": null | "ANALYZE_STOCK" | "OPTIMIZE_PORTFOLIO" | "RUN_BACKTEST",
  "ticker": null | "TICKER",
  "tickers": null | ["TICKER1", "TICKER2"],
  "timeHorizon": null | "SHORT" | "MEDIUM" | "LONG",
  "startDate": null | "YYYY-MM-DD",
  "endDate": null | "YYYY-MM-DD",
  "strategyName": null | "trade-recommendation" | "macd-bb" | "rsi-ma",
  "skillSequence": null | ["market-intelligence", "eda-visual-analysis", "trade-recommendation"] | ["portfolio-optimization"] | ["backtesting"]
}

Routing rules:
- Non-stock/general chat: action = null.
- Stock analysis intent or ticker-only request: action = "ANALYZE_STOCK", set ticker, skillSequence = ["market-intelligence", "eda-visual-analysis", "trade-recommendation"].
- Portfolio optimization intent: action = "OPTIMIZE_PORTFOLIO", set tickers array (>= 2), skillSequence = ["portfolio-optimization"].
- Backtest intent: action = "RUN_BACKTEST", set ticker, startDate, endDate, strategyName, timeHorizon, skillSequence = ["backtesting"].

Output safety rules:
- If uncertain, prefer action = null instead of guessing.
- Ensure output is strict JSON parseable by JSON.parse.
- Never include comments, trailing commas, or explanatory text outside the JSON object.

If a field is unknown, set it to null. Keep message concise and professional.`;

  const messages = [
    ...history.map((entry) => ({ role: entry.role, content: entry.content })),
    { role: 'user', content: message },
  ];

  try {
    const content = await callLlm({
      systemPrompt,
      messages,
      temperature: 0.5,
      maxTokens: 500,
    });
    const cleaned = String(content || '').replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const parseTimeHorizon = (raw) => {
      const lower = String(raw || '').toLowerCase();
      if (/short|swing|day trade|intraday|near term|near-term|短线|短期|波段|8周|八周|两个月内/.test(lower)) return 'SHORT';
      if (/long|long term|long-term|invest|retirement|中长线|长线|长期|基本面|价值|半年|一年|长期持有/.test(lower)) return 'LONG';
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
        const timeHorizon = parseTimeHorizon(msg);
        return {
          message: `I will backtest ${tickers[0]} using ${strategyName} from ${startDate} to ${endDate} for ${timeHorizon.toLowerCase()} horizon.`,
          action: 'RUN_BACKTEST',
          ticker: tickers[0],
          tickers: null,
          timeHorizon,
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
        timeHorizon: parseTimeHorizon(msg),
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
