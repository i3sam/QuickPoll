import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createStore } from './stores/index.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const config = loadConfig();
const store = await createStore(config);

const server = http.createServer(createApp({ store, config }));

const sweeper = setInterval(async () => {
  try {
    await store.sweep();
  } catch (error) {
    console.error('Failed to remove old polls:', error);
  }
}, SWEEP_INTERVAL_MS);

server.listen(config.port, config.host, () => {
  console.log(`QuickPoll is running on http://localhost:${config.port} (${store.constructor.name})`);
});

function shutdown() {
  clearInterval(sweeper);
  server.close(async () => {
    await store.flush();
    process.exit(0);
  });
  server.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
