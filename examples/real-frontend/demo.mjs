// Consumer-owned demo composition using the packed package's public root export.
import { cordyceps } from 'cordyceps';
import { startConsumer } from './consumer-server.mjs';
const ai = await cordyceps.prepare({ harness: 'claude-code', mode: 'nonInteractive' });
let app;
try {
  ai.route(() => true, route => route.fulfill({ text: 'Hello through the real Claude Code process.' }));
  app = await startConsumer(ai);
  console.log(`Open ${app.url}. Ctrl-C closes the consumer, child process, mock and temporary files.`);
} catch (error) {
  await ai.dispose();
  throw error;
}
let closing;
const close = () => closing ??= (async () => {
  try { await app.close(); } finally { await ai.dispose(); }
  ai.assertHealthy();
})();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  close().catch(error => { console.error(error); process.exitCode = 1; });
});
