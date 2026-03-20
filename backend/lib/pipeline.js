const { runMarketIntelligence } = require('../../skills/market-intelligence/scripts');
const { runEdaVisualAnalysis } = require('../../skills/eda-visual-analysis/scripts');
const { runTradeRecommendation } = require('../../skills/trade-recommendation/scripts');
const { runPortfolioOptimization } = require('../../skills/portfolio-optimization/scripts');

async function runFullAnalysis({ ticker, timeHorizon = 'MEDIUM' }) {
  const marketIntelligence = await runMarketIntelligence({ ticker });
  const eda = await runEdaVisualAnalysis({ marketData: marketIntelligence.marketData });
  const tradeRecommendation = await runTradeRecommendation({
    marketData: marketIntelligence.marketData,
    edaInsights: eda.edaInsights,
    timeHorizon,
  });

  return {
    ticker: marketIntelligence.marketData.ticker,
    timeHorizon,
    marketIntelligence,
    eda,
    tradeRecommendation,
  };
}

async function runPortfolioAnalysis({ tickers, timeHorizon = 'MEDIUM' }) {
  const portfolioOptimization = await runPortfolioOptimization({
    tickers,
    useMarketData: [], // Will fetch live data
    timeHorizon,
  });

  return {
    tickers,
    timeHorizon,
    portfolioOptimization,
  };
}

module.exports = {
  runFullAnalysis,
  runPortfolioAnalysis,
};
