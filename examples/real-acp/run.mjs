import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { cordyceps } from 'cordyceps';

assert.equal(process.versions.bun, undefined, 'Run the consumer with Node, not a Bun shim');
assert.equal(process.platform, 'darwin', 'This example requires macOS sandbox-exec for network isolation');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function within(promise, label, timeout = 30_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeout); })]); }
  finally { clearTimeout(timer); }
}
const root = await mkdtemp(join(tmpdir(), 'cordyceps-acp-'));
const cwd = join(root, 'workspace');
await mkdir(cwd);
const home = join(root, 'home');
await mkdir(home);
const fixture = join(root, 'disposable.txt'); // Outside cwd deliberately requires permission.
const secret = 'disposable-file-content-' + crypto.randomUUID();
await writeFile(fixture, secret + '\n');
const deniedFixture = join(root, 'denied.txt');
const deniedSecret = 'must-not-be-read-' + crypto.randomUUID();
await writeFile(deniedFixture, deniedSecret);
let ai, summary;
const updates = [];
const permissions = [];
const reads = [];
const native = [];
let child, connection;
let diagnostics = '';
const releaseStream = deferred();
const firstChunk = deferred();
const heldRequest = deferred();
const providerAborted = deferred();
let activeScenario = 'initial';
const modelRequests = () => ai.requests.filter(r => r.raw.method === 'POST' && new URL(r.raw.path, ai.baseUrl).pathname === '/v1/messages' && r.tools.some(t => t.name === 'Read'));
const textFor = id => updates.filter(u => u.sessionId === id && u.update.sessionUpdate === 'agent_message_chunk').map(u => u.update.content.text ?? '').join('');
const observe = direction => new TransformStream({ transform(message, controller) {
  native.push({ direction, payload: structuredClone(message) });
  ai.recordProtocolMessage(direction, message, { connection: 'real-adapter' });
  controller.enqueue(message);
} });
try {
  ai = await cordyceps.prepare({ harness: 'claude-code-acp', mode: 'acp' });
  // Minimal explicit base: never inherit provider credentials, proxy variables,
  // CLI overrides, NODE_OPTIONS, or the user's project environment.
  const env = ai.environment({ PATH: dirname(process.execPath), TMPDIR: root, LANG: 'en_US.UTF-8',
    HOME: home, XDG_CONFIG_HOME: join(home, '.config') });
  const adapter = fileURLToPath(import.meta.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js'));
  // Consumer policy: the adapter and all descendants can reach only this mock.
  const port = new URL(ai.baseUrl).port;
  const sandbox = `(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:${port}"))`;
  child = spawn('/usr/bin/sandbox-exec', ['-p', sandbox, process.execPath, adapter, ...ai.args],
    { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  child.stderr.setEncoding('utf8').on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-32_000); });
  await once(child, 'spawn');
  const wire = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const outgoing = observe('client-to-agent');
  void outgoing.readable.pipeTo(wire.writable).catch(() => {});
  const app = client({ name: 'cordyceps-real-acp-example', version: '1.0.0' })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(structuredClone(params));
      if (params.update.sessionUpdate === 'agent_message_chunk' && textFor(params.sessionId).includes('stream-first')) firstChunk.resolve();
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      permissions.push(structuredClone(params));
      const refusing = activeScenario === 'refusal';
      assert.equal(params.toolCall.rawInput.file_path, refusing ? deniedFixture : fixture);
      const option = params.options.find(o => o.kind === (refusing ? 'reject_once' : 'allow_once'));
      assert(option, 'Agent must offer the requested one-time permission choice');
      return { outcome: { outcome: 'selected', optionId: option.optionId } };
    })
    .onRequest(methods.client.fs.readTextFile, async ({ params }) => {
      assert.equal(params.path, fixture, 'Only the disposable fixture may be read');
      reads.push(structuredClone(params));
      const content = await readFile(params.path, 'utf8');
      const start = (params.line ?? 1) - 1;
      return { content: content.split('\n').slice(start, params.limit ? start + params.limit : undefined).join('\n') };
    });
  connection = app.connect({ writable: outgoing.writable, readable: wire.readable.pipeThrough(observe('agent-to-client')) });
  const agent = connection.agent;
  const request = (method, params) => within(agent.request(method, params), method);
  const init = await request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } }, clientInfo: { name: 'cordyceps-example', version: '1' } });
  assert.equal(init.protocolVersion, PROTOCOL_VERSION);
  assert(init.agentCapabilities && init.agentInfo?.name);
  console.log('initialize', JSON.stringify(init));
  ai.route(() => true, async route => {
    const path = new URL(route.request.raw.path, ai.baseUrl).pathname;
    if (route.request.raw.method === 'HEAD' && path === '/api/hello') return route.fulfill({ health: true });
    if (route.request.raw.method === 'POST' && path === '/v1/messages/count_tokens') return route.fulfill({ inputTokens: 32 });
    if (!route.request.tools.some(t => t.name === 'Read')) return route.fulfill({ text: 'Auxiliary response' });
    if (activeScenario === 'stream') {
      return route.fulfill({ stream: (async function* () { yield { text: 'stream-first ' }; await releaseStream.promise; yield { text: 'stream-second' }; })() });
    }
    if (activeScenario === 'tool') {
      const result = route.request.toolResults.find(t => t.id === 'disposable-read');
      if (result) {
        assert(!result.isError, result.text);
        assert(result.text.includes(secret), 'Next provider request contains actual file contents');
        return route.fulfill({ text: 'read-confirmed' });
      }
      const tool = route.request.tools.find(t => /(^|__)Read$/.test(t.name));
      assert(tool, 'Real agent offered a Read tool');
      assert(tool.inputSchema.properties.file_path);
      return route.fulfill({ toolCall: { id: 'disposable-read', name: tool.name, input: { file_path: fixture } } });
    }
    if (activeScenario === 'refusal') {
      const result = route.request.toolResults.find(t => t.id === 'denied-read');
      if (result) {
        assert(result.isError, 'Refused read returns an actual tool error');
        assert(!result.text.includes(deniedSecret));
        return route.fulfill({ text: 'refusal-confirmed' });
      }
      const tool = route.request.tools.find(t => t.name === 'Read');
      assert(tool.inputSchema.properties.file_path);
      return route.fulfill({ toolCall: { id: 'denied-read', name: tool.name, input: { file_path: deniedFixture } } });
    }
    if (activeScenario === 'cancel') {
      heldRequest.resolve(route.request.id);
      await route.untilAborted();
      providerAborted.resolve();
      return;
    }
    return route.fulfill({ text: `reply-${activeScenario}` });
  });
  const sessionParams = { cwd, mcpServers: [], _meta: { claudeCode: { options: { settingSources: [], model: 'claude-sonnet-4-6', maxThinkingTokens: 0, extraArgs: { bare: '' } } } } };
  const a = await request(methods.agent.session.new, sessionParams);
  const b = await request(methods.agent.session.new, sessionParams);
  assert.notEqual(a.sessionId, b.sessionId);
  const prompt = (session, text) => {
    const params = { sessionId: session.sessionId, prompt: [{ type: 'text', text }] };
    ai.recordInput(params, { scenario: activeScenario });
    const pending = request(methods.agent.session.prompt, params);
    void pending.catch(() => {}); // Cleanup still observes a timed-out gated prompt.
    return pending;
  };
  assert.equal((await prompt(a, 'session-A-marker')).stopReason, 'end_turn');
  assert(textFor(a.sessionId).includes('reply-initial'));
  activeScenario = 'followup';
  assert.equal((await prompt(a, 'session-A-followup')).stopReason, 'end_turn');
  const followup = modelRequests().at(-1);
  assert(followup.text.includes('session-A-marker'));
  assert(followup.text.includes('reply-initial'));
  activeScenario = 'separate';
  assert.equal((await prompt(b, 'session-B-marker')).stopReason, 'end_turn');
  assert(!modelRequests().at(-1).text.includes('session-A-marker'));
  assert(!modelRequests().at(-1).text.includes('reply-initial'));
  assert(!textFor(b.sessionId).includes('reply-initial'));
  activeScenario = 'stream';
  let streamCompleted = false;
  const streaming = prompt(a, 'stream-marker').then(r => { streamCompleted = true; return r; });
  void streaming.catch(() => {});
  await within(firstChunk.promise, 'incremental native output');
  assert.equal(streamCompleted, false);
  assert(!textFor(a.sessionId).includes('stream-second'));
  releaseStream.resolve();
  assert.equal((await streaming).stopReason, 'end_turn');
  assert(textFor(a.sessionId).includes('stream-first stream-second'));
  activeScenario = 'tool';
  assert.equal((await prompt(a, 'read the disposable file')).stopReason, 'end_turn');
  assert(permissions.length > 0, 'Actual permission callback');
  const readResult = modelRequests().at(-1).toolResults.find(t => t.id === 'disposable-read');
  assert(readResult && !readResult.isError && readResult.text.includes(secret), 'Actual next model request contains the file result');
  // This adapter version runs Read inside Claude; permission stays client-owned.
  const readUpdate = updates.find(u => u.sessionId === a.sessionId && u.update.sessionUpdate === 'tool_call_update' && u.update.rawInput?.file_path === fixture);
  assert(readUpdate, 'Native tool update identifies the real fixture');
  assert(updates.some(u => u.sessionId === a.sessionId && u.update.sessionUpdate === 'tool_call' && u.update.toolCallId === readUpdate.update.toolCallId));
  assert(updates.some(u => u.sessionId === a.sessionId && u.update.sessionUpdate === 'tool_call_update' && u.update.toolCallId === readUpdate.update.toolCallId && u.update.status === 'completed'));
  activeScenario = 'refusal';
  const permissionCount = permissions.length;
  assert.equal((await prompt(b, 'refuse the other disposable file')).stopReason, 'end_turn');
  assert(permissions.length > permissionCount, 'Second session requests permission independently');
  assert(textFor(b.sessionId).includes('refusal-confirmed'));
  const refusedResult = modelRequests().at(-1).toolResults.find(t => t.id === 'denied-read');
  assert(refusedResult?.isError && !refusedResult.text.includes(deniedSecret));
  activeScenario = 'cancel';
  const cancelled = prompt(a, 'cancel-marker');
  const cancelledRequest = await within(heldRequest.promise, 'held provider request');
  await within(agent.notify(methods.agent.session.cancel, { sessionId: a.sessionId }), 'cancel notification');
  assert.equal((await cancelled).stopReason, 'cancelled');
  await within(providerAborted.promise, 'provider abort');
  assert.equal(ai.responses.find(r => r.requestId === cancelledRequest).outcome, 'aborted');
  activeScenario = 'reuse';
  assert.equal((await prompt(a, 'reuse-marker')).stopReason, 'end_turn');
  assert(textFor(a.sessionId).includes('reply-reuse'));
  assert.equal(child.exitCode, null, 'Turn completion does not mean process exit');
  assert.deepEqual(ai.protocolMessages.map(({ direction, payload }) => ({ direction, payload })), native);
  const promptRequests = native.filter(m => m.direction === 'client-to-agent' && m.payload.method === 'session/prompt');
  assert.equal(promptRequests.length, 8);
  for (const { payload } of promptRequests) {
    assert(native.some(m => m.direction === 'agent-to-client' && m.payload.id === payload.id && m.payload.result?.stopReason));
  }
  ai.assertHealthy();
  summary = { ok: true, node: process.version, protocolVersion: init.protocolVersion, sessions: [a.sessionId, b.sessionId], prompts: promptRequests.length, providerRequests: ai.requests.length, nativeMessages: native.length, permissions: permissions.length, clientFileReadCallbacks: reads.length, harnessReadResultVerified: true, incremental: true, cancellation: 'cancelled', reusedSession: a.sessionId };

} catch (error) {
  console.error(diagnostics);
  console.error('Provider failures:', ai?.failures.map(f => f.error.message));
  throw error;
} finally {
  releaseStream.resolve();
  connection?.close();
  try {
    if (child?.pid) {
      const exited = once(child, 'exit');
      const kill = signal => { try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
      kill('SIGTERM');
      const stopped = async () => {
        if (child.exitCode === null && child.signalCode === null) await exited;
        if (process.platform !== 'win32') {
          for (let attempts = 0; attempts < 120; attempts++) {
            try { process.kill(-child.pid, 0); }
            catch (error) { if (error.code === 'ESRCH') return; throw error; }
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Adapter process group still alive');
        }
      };
      try { await within(stopped(), 'adapter process group exit', 3000); }
      catch { kill('SIGKILL'); await within(stopped(), 'forced process group exit', 3000); }
    }
    if (ai) {
      if (process.env.ACP_EVIDENCE_DIR) {
        await mkdir(process.env.ACP_EVIDENCE_DIR, { recursive: true });
        await writeFile(join(process.env.ACP_EVIDENCE_DIR, 'native.json'), JSON.stringify(ai.protocolMessages, null, 2));
        await writeFile(join(process.env.ACP_EVIDENCE_DIR, 'provider.json'), JSON.stringify({ requests: ai.requests, responses: ai.responses }, null, 2));
      }
      ai.assertHealthy(); // Includes requests made during adapter shutdown.
    }
  } finally {
    try { await ai?.dispose(); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
}
console.log(JSON.stringify(summary, null, 2));
