// This is a boundary diagnostic, NOT a provider/text/tool validation.
// Only metadata and transport Ready are scripted. No remote agent decision is fabricated.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import {cordyceps} from 'cordyceps';
import {isolated} from './probe.mjs';

const metadata = JSON.parse(process.argv[3]);
const report = {node: process.version, date: new Date().toISOString(), packageEntry: import.meta.resolve('cordyceps'),
  ...metadata, passed: false, classification: 'remote-agent-service-model-boundary-unavailable', cases: []};
process.env.CORDYCEPS_QODO_BINARY = metadata.qodo.binary;
for (const builtin of [false, true]) await isolated(async ({launch, work}) => {
  const registry = cordyceps.createRegistry({builtins: false});
  registry.register({schemaVersion: 1, id: 'qodo-provider-sentinel',
    provider: {adapter: 'openai-chat-completions', override: {}}, modes: {diagnostic: {}}});
  const ai = await cordyceps.prepare({registry, harness: 'qodo-provider-sentinel', mode: 'diagnostic'});
  ai.route(() => true, route => route.fulfill({text: 'UNEXPECTED_LOCAL_MODEL_REQUEST'}));
  const record = {builtin, http: [], websocket: [], sent: [], modelRequests: [], passed: false};
  report.cases.push(record);
  const sessionId = randomUUID();
  const model = 'cordyceps-diagnostic-model';
  const token = randomUUID();
  const fixture = join(work, 'fixture.txt');
  await writeFile(fixture, token);
  const prompt = `cordyceps-qodo-boundary: Read ${fixture} and report its content.`;
  record.prompt = prompt;
  record.fixtureToken = token;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    record.http.push({method: req.method, path: req.url, body: Buffer.concat(chunks).toString()});
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url.startsWith('/v2/info/get-things')) {
      const reply = {'session-id': sessionId, default_model: model, models: [{model_name: model}], 'mcp-tools': {}};
      record.sent.push({transport: 'http', path: req.url, body: reply});
      res.end(JSON.stringify(reply));
    } else if (req.url.includes('analytics')) {
      res.end('{}');
    } else {
      res.statusCode = 404; res.end(JSON.stringify({error: 'Unimplemented diagnostic service route'}));
    }
  });
  const wss = new WebSocketServer({server});
  let kill, receivedQuery = false, cancelTimer, onClosed;
  const closed = new Promise(resolve => {onClosed = resolve;});
  wss.on('connection', (ws, req) => {
    record.websocket.push({event: 'connected', path: req.url});
    const ready = {session_id: sessionId, data: {tool: 'Ready', tool_args: {}}};
    record.sent.push({transport: 'websocket', body: ready});
    ws.send(JSON.stringify(ready));
    ws.on('message', bytes => {
      const raw = bytes.toString();
      record.websocket.push({event: 'message', raw});
      if (raw.startsWith('UserQuery ')) {
        receivedQuery = true;
        // Hold the actual agent service request, then cancel the consumer-owned process.
        cancelTimer = setTimeout(() => kill(), 300);
      }
    });
    ws.on('close', (code, reason) => {
      record.websocket.push({event: 'closed', code, reason: reason.toString()});
      onClosed();
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const key = 'cordyceps-test-no-provider-credential';
  record.injection = {QODO_BASE_URL: base, QODO_API_BASE_URL: base, QODO_API_KEY: key,
    OPENAI_BASE_URL: ai.baseUrl + '/v1', OPENAI_API_KEY: key,
    ANTHROPIC_BASE_URL: ai.baseUrl, ANTHROPIC_API_KEY: key};
  try {
    record.version = await launch('qodo', ['--version']);
    record.help = await launch('qodo', ['--help']);
    record.process = await launch('qodo', ['--ci', '--yes', '--model', model,
      ...(builtin ? ['--tools', 'filesystem'] : ['--no-builtin']), prompt],
      record.injection, 20000, undefined, [], {onStart: control => {kill = control.kill;}});
    record.modelRequests = ai.requests;
    record.providerFailures = ai.failures.map(f => String(f.error));
    assert.ok(receivedQuery, 'Actual CLI must reach UserQuery beyond bootstrap');
    const raw = record.websocket.find(e => e.raw?.startsWith('UserQuery ')).raw;
    const query = JSON.parse(raw.slice('UserQuery '.length));
    assert.ok(query.user_request.includes(prompt));
    assert.equal(query.custom_model, model);
    assert.equal(raw.includes(token), false, 'Fixture token must not be supplied by the diagnostic');
    if (builtin) assert.ok(query.tools.filesystem?.some(t => t.name.includes('read')), 'Real filesystem tool declarations required');
    assert.equal(ai.requests.length, 0);
    assert.equal(ai.failures.length, 0);
    assert.equal(record.process.timedOut, false);
    assert.equal(record.process.signal, 'SIGKILL');
    // Socket EOF may arrive after the process close notification.
    let closeTimeout;
    try {
      await Promise.race([closed, new Promise((_, reject) => {
        closeTimeout = setTimeout(() => reject(Error('Native socket did not close after cancellation')), 3000);
      })]);
    } finally {clearTimeout(closeTimeout);}
    assert.ok(record.websocket.some(e => e.event === 'closed'), 'Process cancellation must close the native service socket');
    record.boundaryDiagnosticPassed = true;
    record.processCancellation = 'native WebSocket disconnected after process-group kill';
    record.textOutcome = record.toolOutcome = record.incrementalOutputOutcome = 'not exercised: no model boundary available; no agent decisions scripted';
  } catch (error) {
    record.error = String(error.stack || error);
    throw error;
  } finally {
    clearTimeout(cancelTimer);
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await ai.dispose(); await assert.rejects(fetch(ai.baseUrl));
    record.cleanedUp = true;
    await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  }
});
console.log(JSON.stringify({classification: report.classification, passed: false,
  boundaryDiagnosticsPassed: report.cases.every(c => c.boundaryDiagnosticPassed),
  capturedQueries: report.cases.map(c => c.websocket.filter(e => e.raw?.startsWith('UserQuery ')).length)}));
