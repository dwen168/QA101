const config = require('./lib/config');
const { getActiveModel, getActiveProvider } = require('./lib/llm');
const { createApp } = require('./app');

const app = createApp();

app.listen(config.port, () => {
  const provider = getActiveProvider();
  console.log(`\nQuantBot API running on http://localhost:${config.port}`);
  console.log(`LLM provider: ${provider} (${getActiveModel(provider)})`);
  if (provider === 'ollama') {
    console.log(`Ollama endpoint: ${config.ollamaBaseUrl}`);
  } else {
    console.log(`DeepSeek API: ${config.deepseekApiKey ? 'configured' : 'missing — add to .env'}`);
  }
  console.log('');
});
