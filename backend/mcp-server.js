const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const { runMarketIntelligence } = require('../skills/market-intelligence/scripts');
const { runEdaVisualAnalysis } = require('../skills/eda-visual-analysis/scripts');
const { runTradeRecommendation } = require('../skills/trade-recommendation/scripts');
const { runPortfolioOptimization } = require('../skills/portfolio-optimization/scripts');
const { runBacktest } = require('../skills/backtesting/scripts');
const { runFullAnalysis, runPortfolioAnalysis } = require('./lib/pipeline');
const config = require('./lib/config');

const server = new McpServer({
  name: 'quantbot',
  version: '1.0.0',
});

function asToolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function asToolError(error) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: error.message }, null, 2),
      },
    ],
    isError: true,
  };
}

server.tool(
  'market_intelligence',
  'Collect price trends, sentiment, analyst consensus, and market context for a stock ticker.',
  {
    ticker: z.string().describe('Stock ticker symbol, for example AAPL or NVDA.'),
  },
  async ({ ticker }) => {
    try {
      return asToolResult(await runMarketIntelligence({ ticker }));
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.tool(
  'eda_visual_analysis',
  'Generate chart-ready exploratory analysis from market intelligence output.',
  {
    marketData: z.object({}).passthrough().describe('The marketData object returned by market_intelligence.'),
  },
  async ({ marketData }) => {
    try {
      return asToolResult(await runEdaVisualAnalysis({ marketData }));
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.tool(
  'trade_recommendation',
  'Score market signals and return a buy, hold, or sell recommendation.',
  {
    marketData: z.object({}).passthrough().describe('The marketData object returned by market_intelligence.'),
    edaInsights: z.object({}).passthrough().optional().describe('Optional edaInsights object returned by eda_visual_analysis.'),
    timeHorizon: z.enum(['SHORT', 'MEDIUM', 'LONG']).optional().describe('Investor objective for this recommendation.'),
  },
  async ({ marketData, edaInsights, timeHorizon }) => {
    try {
      return asToolResult(await runTradeRecommendation({ marketData, edaInsights, timeHorizon }));
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.tool(
  'full_stock_analysis',
  'Run the full QuantBot pipeline: market intelligence, EDA, and trade recommendation.',
  {
    ticker: z.string().describe('Stock ticker symbol, for example AAPL or NVDA.'),
    timeHorizon: z.enum(['SHORT', 'MEDIUM', 'LONG']).optional().describe('Investor objective for this full analysis.'),
  },
  async ({ ticker, timeHorizon }) => {
    try {
      return asToolResult(await runFullAnalysis({ ticker, timeHorizon }));
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.tool(
  'portfolio_optimization',
  'Analyze a portfolio of stocks: compute multi-factor scores, correlation matrix, sector rotation, and ranked recommendations.',
  {
    tickers: z.array(z.string()).describe('Array of stock ticker symbols, e.g. ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"].'),
    timeHorizon: z.enum(['SHORT', 'MEDIUM', 'LONG']).optional().default('MEDIUM').describe('Investment time horizon: SHORT (< 2 weeks), MEDIUM (2-8 weeks), LONG (> 2 months).'),
  },
  async ({ tickers, timeHorizon }) => {
    try {
      return asToolResult(await runPortfolioOptimization({ tickers, useMarketData: [], timeHorizon }));
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.tool(
  'full_portfolio_analysis',
  'Run full portfolio analysis pipeline: fetch market data for all tickers and generate optimized portfolio recommendations.',
  {
    tickers: z.array(z.string()).describe('Array of stock ticker symbols.'),
    timeHorizon: z.enum(['SHORT', 'MEDIUM', 'LONG']).optional().default('MEDIUM').describe('Investment time horizon.'),
  },
  async ({ tickers, timeHorizon }) => {
    try {
      return asToolResult(await runPortfolioAnalysis({ tickers, timeHorizon }));
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.tool(
  'backtesting',
  'Backtest a trading strategy on historical data. Returns performance metrics: Sharpe ratio, max drawdown, win rate, trade log.',
  {
    ticker: z.string().describe('Stock ticker symbol to backtest, e.g., AAPL.'),
    strategyName: z.enum(['trade-recommendation', 'macd-bb', 'rsi-ma']).optional().default('trade-recommendation').describe('Strategy type: trade-recommendation (15+ signals), macd-bb, or rsi-ma.'),
    timeHorizon: z.enum(['SHORT', 'MEDIUM', 'LONG']).optional().default('MEDIUM').describe('Backtest horizon profile: SHORT, MEDIUM, or LONG.'),
    startDate: z.string().describe('Backtest start date in YYYY-MM-DD format, e.g., 2025-01-01.'),
    endDate: z.string().describe('Backtest end date in YYYY-MM-DD format, e.g., 2026-03-18.'),
    initialCapital: z.number().optional().default(100000).describe('Starting portfolio value in USD.'),
  },
  async ({ ticker, strategyName, timeHorizon, startDate, endDate, initialCapital }) => {
    try {
      return asToolResult(await runBacktest({
        ticker,
        strategyName,
        timeHorizon,
        startDate,
        endDate,
        initialCapital,
        apiKey: config.alphaVantageApiKey,
      }));
    } catch (error) {
      return asToolError(error);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('QuantBot MCP server ready on stdio\n');
}

main().catch((error) => {
  process.stderr.write(`QuantBot MCP server failed: ${error.stack || error.message}\n`);
  process.exit(1);
});
