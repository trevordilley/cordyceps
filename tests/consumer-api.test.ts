import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepare, match, anthropic, validateToolCall } from '../src/index.js';
import type { AISession } from '../src/index.js';

const post = (ai: AISession, messages: unknown[], path = '/v1/messages', headers: Record<string, string> = {}) => fetch(ai.baseUrl + path, {
  method: 'POST', headers, body: JSON.stringify({ model: 'fixture', messages }),
});
const user = (content: string) => ({ role: 'user', content });
const step = (name: string, text = name, times = 1) => ({ name, times, match: match.lastUserMessage(text), handle: (route: Parameters<Parameters<AISession['route']>[1]>[0]) => route.fulfill({ text: name }) });

test('fixed port binds exactly, rejects occupied/invalid ports, and releases on dispose', async () => {
  const reserve = createServer();
  await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const address = reserve.address();
  assert.ok(address && typeof address !== 'string');
  try { await assert.rejects(prepare({ harness: 'claude-code', port: address.port }), { code: 'EADDRINUSE' }); }
  finally { await new Promise<void>((resolve, reject) => reserve.close(error => error ? reject(error) : resolve())); }
  const ai = await prepare({ harness: 'claude-code', port: address.port });
  assert.equal(new URL(ai.baseUrl).port, String(address.port));
  await ai.dispose();
  const next = await prepare({ harness: 'claude-code', port: address.port });
  await next.dispose();
  for (const port of [-1, 65536, NaN, 2.5]) await assert.rejects(prepare({ harness: 'claude-code', port }), /port must/);
});

test('a required scenario fails even if no request arrives; teardown still closes resources', async () => {
  const ai = await prepare({ harness: 'codex' });
  const config = ai.configFiles[0]!.path;
  ai.scenario([step('required')]);
  assert.throws(() => ai.assertComplete(), /required.*0\/1/);
  await assert.rejects(ai.dispose(), /required.*0\/1/);
  await assert.rejects(access(config));
  await assert.rejects(fetch(ai.baseUrl));
});

test('ordered steps enforce counts while explicit auxiliary traffic stays outside the sequence', async () => {
  const ai = await prepare({ harness: 'claude-code' });
  ai.scenario([step('first', 'hello', 2), step('second', 'bye')], { background: anthropic.background({ inputTokens: 42 }) });
  try {
    assert.equal((await fetch(ai.baseUrl + '/api/hello', { method: 'HEAD' })).status, 200);
    const tokens = await post(ai, [user('hello')], '/v1/messages/count_tokens');
    assert.deepEqual(await tokens.json(), { input_tokens: 42 });
    for (const text of ['hello', 'hello', 'bye']) assert.equal((await post(ai, [user(text)])).status, 200);
    ai.assertComplete();
    assert.deepEqual(ai.expectations.map(step => step.received), [2, 1]);
    assert.deepEqual(ai.matches.map(match => match.kind), ['background', 'background', 'step', 'step', 'step']);
    assert.equal(ai.requests.length, 5);
  } finally { await ai.dispose(); }
});

test('out-of-order, unexpected repeats and undeclared background requests fail', async () => {
  for (const inputs of [['second'], ['first', 'first'], ['unknown']]) {
    const ai = await prepare({ harness: 'claude-code' });
    ai.scenario([step('first'), step('second')]);
    for (const text of inputs) await post(ai, [user(text)]);
    assert.throws(() => ai.assertHealthy(), /out of order|unexpected repeat|Unexpected scenario/);
    assert.equal(ai.failureSignal.aborted, true);
    await assert.rejects(ai.dispose(), /Unfulfilled/);
  }
});

test('guard propagates the original assertion without waiting for a stalled app', async () => {
  const ai = await prepare({ harness: 'claude-code' });
  try {
    ai.route(() => true, () => { throw new Error('missing real file result'); }, { name: 'read-result' });
    const guarded = ai.guard(new Promise<never>(() => {}));
    const rejected = assert.rejects(guarded, /missing real file result/);
    await post(ai, [user('hello')]);
    await rejected;
    assert.equal(ai.matches[0]!.name, 'read-result');
  } finally { await ai.dispose(); }
});

test('message matchers ignore system/history and old tool results; cursors distinguish turns', async () => {
  const ai = await prepare({ harness: 'claude-code' });
  try {
    ai.route(() => true, route => route.fulfill({ text: 'reply' }));
    await post(ai, [{ role: 'system', content: 'current' }, user('old'), { role: 'assistant', content: 'current' }, user('new')]);
    const first = ai.requests[0]!;
    assert.equal(match.lastUserMessage('current')(first), false);
    assert.equal(match.lastUserMessage('old')(first), false);
    assert.equal(match.lastUserMessage('new')(first), true);
    assert.deepEqual(first.messages.map(message => message.role), ['system', 'user', 'assistant', 'user']);
    const cursor = ai.requestCursor();
    const next = ai.waitForNextRequest(match.lastUserMessage('new'));
    await post(ai, [user('new')]);
    assert.notEqual((await next).id, first.id);
    assert.equal((await ai.waitForRequest(match.lastUserMessage('new'), { after: cursor })).id, ai.requests[1]!.id);
    const resultMessage = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read', content: 'file token' }] };
    await post(ai, [user('read'), resultMessage]);
    assert.equal(match.toolResult({ id: 'read', text: /token/ })(ai.requests[2]!), true);
    await post(ai, [user('read'), resultMessage, { role: 'assistant', content: 'done' }, user('new task')]);
    assert.equal(match.toolResult({ id: 'read' })(ai.requests[3]!), false);
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

test('raw replies preserve malformed JSON, status, headers and invalid streaming frames', async () => {
  const ai = await prepare({ harness: 'claude-code' });
  try {
    ai.route(() => true, route => route.fulfillRaw({ status: 418, headers: { 'content-type': 'application/json', 'x-test': 'raw' }, body: '{broken' }));
    const bad = await post(ai, [user('one')]);
    assert.equal(bad.status, 418);
    assert.equal(bad.headers.get('x-test'), 'raw');
    assert.equal(await bad.text(), '{broken');
    ai.route(() => true, route => route.fulfillRaw({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: (async function* () { yield 'event: nonsense\n'; yield new TextEncoder().encode('data: {broken\n\n'); })() }));
    assert.equal(await (await post(ai, [user('two')])).text(), 'event: nonsense\ndata: {broken\n\n');
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

test('redacted exports remove headers, URL credentials, JSON secrets and split response secrets without modifying captures', async () => {
  const ai = await prepare({ harness: 'claude-code' });
  try {
    ai.route(() => true, route => route.fulfillRaw({ status: 200, body: (async function* () { yield 'bearer-'; yield 'secret'; })() }));
    await (await post(ai, [user('https://name:password-value@example.test/p?api_key=query-secret')], '/v1/messages?token=path-secret&api_key=a%2fb',
      { authorization: 'Bearer bearer-secret', 'x-api-key': ai.apiKey, 'x-goog-api-key': 'google-secret', 'x-session-token': 'session-secret', cookie: 'session=cookie-secret' })).text();
    ai.recordInput({ client_secret: 'json-secret', body: '{"password":"nested-secret"}', notes: 'extra-secret' });
    const circular: { self?: unknown } = {}; circular.self = circular;
    ai.recordInput(circular);
    const safe = JSON.stringify(ai.exportTranscript({ secrets: ['extra-secret'] }));
    for (const secret of ['bearer-secret', ai.apiKey, 'cookie-secret', 'password-value', 'query-secret', 'path-secret', 'json-secret', 'nested-secret', 'extra-secret', 'a%2fb', 'google-secret', 'session-secret']) assert.ok(!safe.includes(secret), secret);
    assert.ok(safe.includes('[REDACTED]'));
    assert.equal(ai.requests[0]!.raw.headers.authorization, 'Bearer bearer-secret');
    assert.ok(JSON.stringify(ai.exportTranscript({ redact: false })).includes('bearer-secret'));
  } finally { await ai.dispose(); }
});

test('Claude disposable settings use helper auth, refuse existing config, and clean only owned files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cordyceps-claude-settings-test-'));
  const home = join(root, 'home');
  const ai = await prepare({ harness: 'claude-code' });
  try {
    const setup = await ai.installClaudeSettings({ home });
    const settings = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
    assert.equal(settings.env.ANTHROPIC_BASE_URL, ai.baseUrl);
    assert.ok(settings.apiKeyHelper.includes(ai.apiKey));
    const env = setup.environment({ ANTHROPIC_API_KEY: 'old', ANTHROPIC_AUTH_TOKEN: 'old', HOME: 'old' });
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(env.HOME, setup.home);
    assert.equal(JSON.parse(await readFile(join(home, '.claude.json'), 'utf8')).hasCompletedOnboarding, true);
    await writeFile(join(home, 'app-owned'), 'keep');
    await assert.rejects(ai.installClaudeSettings({ home }), /EEXIST/);
    assert.ok(await readFile(setup.settingsPath, 'utf8'));
    await ai.dispose();
    assert.equal(await readFile(join(home, 'app-owned'), 'utf8'), 'keep');
    await assert.rejects(access(setup.configDir));
    const occupied = join(root, 'occupied');
    await mkdir(occupied); await writeFile(join(occupied, '.claude.json'), 'existing');
    const other = await prepare({ harness: 'claude-code' });
    try {
      await assert.rejects(other.installClaudeSettings({ home: occupied }), /EEXIST/);
      assert.equal(await readFile(join(occupied, '.claude.json'), 'utf8'), 'existing');
      await assert.rejects(access(join(occupied, '.claude')));
    } finally { await other.dispose(); }
  } finally { await ai.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('tool validation reports absent tools and validates the offered input schema without coercion', () => {
  const request = { tools: [{ name: 'Read', inputSchema: { type: 'object', required: ['file_path'], properties: { file_path: { type: 'string' } }, additionalProperties: false }, raw: {} }] };
  assert.throws(() => validateToolCall(request, { id: 'call', name: 'Write', input: {} }), /Write.*not offered.*Read/);
  assert.throws(() => validateToolCall(request, { id: 'call', name: 'Read', input: { path: 'wrong' } }), /file_path/);
  assert.throws(() => validateToolCall(request, { id: 'call', name: 'Read', input: { file_path: 123 } }), /string/);
  assert.equal(validateToolCall(request, { id: 'call', name: 'Read', input: { file_path: 'fixture.txt' } }).name, 'Read');
});

test('a repeat after the final required step fails automatic scenario teardown', async () => {
  const ai = await prepare({ harness: 'claude-code' });
  ai.scenario([step('only')]);
  await post(ai, [user('only')]);
  await post(ai, [user('only')]);
  await assert.rejects(ai.dispose(), /unexpected repeat/);
  await assert.rejects(fetch(ai.baseUrl));
});

test('Responses, Chat Completions and Gemini preserve user boundaries and latest tool results', async () => {
  const samples = [
    { harness: 'codex', path: '/v1/responses', body: { model: 'fixture', instructions: 'new', input: [
      { role: 'user', content: [{ type: 'input_text', text: 'old' }] }, { role: 'assistant', content: [{ type: 'output_text', text: 'new' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'current' }] }, { type: 'function_call_output', call_id: 'read', output: 'actual' },
    ] } },
    { harness: 'qwen', path: '/v1/chat/completions', body: { model: 'fixture', messages: [
      { role: 'system', content: 'new' }, user('old'), { role: 'assistant', content: 'new' }, user('current'), { role: 'tool', tool_call_id: 'read', content: 'actual' },
    ] } },
    { harness: 'gemini', path: '/v1beta/models/fixture:generateContent', body: { systemInstruction: { parts: [{ text: 'new' }] }, contents: [
      { role: 'user', parts: [{ text: 'old' }] }, { role: 'model', parts: [{ text: 'new' }] }, { role: 'user', parts: [{ text: 'current' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read', response: 'actual' } }] },
    ] } },
  ];
  for (const sample of samples) {
    const ai = await prepare({ harness: sample.harness });
    try {
      ai.route(() => true, route => route.fulfill({ text: 'ok' }));
      const reply = await fetch(ai.baseUrl + sample.path, { method: 'POST', body: JSON.stringify(sample.body) });
      assert.equal(reply.status, 200);
      const request = ai.requests[0]!;
      assert.equal(match.lastUserMessage('current')(request), true);
      assert.equal(match.lastUserMessage('new')(request), false);
      assert.equal(match.toolResult({ id: 'read', text: 'actual' })(request), true);
      ai.assertHealthy();
    } finally { await ai.dispose(); }
  }
});
