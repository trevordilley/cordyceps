// Consumer-owned HTTP bridge: browser input -> installed process -> actual stdout.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createConsumerProcess } from './consumer-process.mjs';

export async function startConsumer(ai) {
  const assets = new Map([
    ['/', ['text/html', await readFile(new URL('./public/index.html', import.meta.url))]],
    ['/client.js', ['text/javascript', await readFile(new URL('./public/client.js', import.meta.url))]],
  ]);
  const harness = await createConsumerProcess(ai);
  let url;
  let closing = false;
  const server = createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    try {
      if (closing) return json(503, { error: 'Consumer is closing' });
      if (req.headers.host !== new URL(url).host) return json(403, { error: 'Invalid host' });
      if (req.method === 'GET' && assets.has(req.url)) {
        const [type, body] = assets.get(req.url);
        res.writeHead(200, { 'content-type': type, 'content-security-policy': "default-src 'self'; script-src 'self'; connect-src 'self'" });
        return res.end(body);
      }
      if (req.method !== 'POST') return json(404, { error: 'Not found' });
      if (req.headers.origin !== url || req.headers['content-type'] !== 'application/json') {
        return json(403, { error: 'Same-origin JSON required' });
      }
      if (req.url === '/api/cancel') {
        await harness.stop();
        return json(200, { cancelled: true });
      }
      if (req.url !== '/api/prompt') return json(404, { error: 'Not found' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16_384) return json(413, { error: 'Prompt too large' });
      }
      const { prompt } = JSON.parse(body);
      if (typeof prompt !== 'string' || !prompt.trim()) return json(400, { error: 'A prompt is required' });
      if (harness.activePid) return json(409, { error: 'A turn is already running' });
      const disconnect = () => { if (!res.writableEnded) void harness.stop(); };
      res.once('close', disconnect);
      try { json(200, await harness.prompt(prompt)); }
      finally { res.off('close', disconnect); }
    } catch (error) {
      json(500, { error: error.message });
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    url = `http://127.0.0.1:${server.address().port}`;
    return {
      url, harness,
      async close() {
        if (closing) return;
        closing = true;
        try { await harness.close(); }
        finally {
          const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          server.closeAllConnections();
          await closed;
        }
      },
    };
  } catch (error) {
    server.close();
    await harness.close();
    throw error;
  }
}
