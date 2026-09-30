import { expect, test } from 'bun:test';
import { crc32 } from 'node:zlib';
import { amazonQ as codec } from '../src/provider/amazon-q.js';
import type { CapturedRequest, EncodedResponse, ScriptedResponse } from '../src/provider/types.js';
const generate = 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse';
const models = 'AmazonCodeWhispererService.ListAvailableModels';
const telemetry = 'AmazonCodeWhispererService.SendTelemetryEvent';
const raw = (body: unknown, target = generate) => ({ method: 'POST', path: '/', headers: { 'x-amz-target': target }, body: JSON.stringify(body) });
const body = { conversationState: { currentMessage: { userInputMessage: { content: 'prompt', modelId: 'test' } } } };
function request(target = generate): CapturedRequest { const wire = raw(body, target); return { ...codec.decode(wire), raw: wire, id: 'test', timestamp: 0 }; }
const signal = () => new AbortController().signal;
async function read(response: EncodedResponse) { const chunks = []; for await (const chunk of response.body) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); }
// Independent native zlib checks validate both CRCs and exact frame boundaries.
function decode(bytes: Uint8Array) {
  const data = Buffer.from(bytes); const result = [];
  for (let offset = 0; offset < data.length;) {
    const length = data.readUInt32BE(offset), headerLength = data.readUInt32BE(offset + 4);
    const frame = data.subarray(offset, offset + length);
    expect(frame.length).toBe(length);
    expect(frame.readUInt32BE(8)).toBe(crc32(frame.subarray(0, 8)));
    expect(frame.readUInt32BE(length - 4)).toBe(crc32(frame.subarray(0, -4)));
    const headers: Record<string,string> = {}; let cursor = 12;
    while (cursor < 12 + headerLength) {
      const n = frame[cursor++]!; const key = frame.toString('utf8', cursor, cursor + n); cursor += n;
      expect(frame[cursor++]).toBe(7); const size = frame.readUInt16BE(cursor); cursor += 2;
      headers[key] = frame.toString('utf8', cursor, cursor + size); cursor += size;
    }
    expect(cursor).toBe(12 + headerLength);
    expect(headers[':message-type']).toBe('event'); expect(headers[':content-type']).toBe('application/json');
    result.push({ type: headers[':event-type'], body: JSON.parse(frame.toString('utf8', cursor, length - 4)) });
    offset += length;
  }
  return result;
}
test('Q normalizes native messages, offered tools and actual tool results without inventing text', () => {
  const tool = { toolSpecification: { name: 'fs_read', inputSchema: { json: { type: 'object' } } } };
  const result = { toolUseId: 'call', status: 'success', content: [{ text: 'fixture' }, { json: { ignored: 'opaque' } }, { text: 'next' }] };
  const wire = raw({ conversationState: { history: [{ userInputMessage: { content: 'history' } }, { assistantResponseMessage: { content: 'reply', toolUses: [{ input: { ignored: true } }] } }], currentMessage: { userInputMessage: { content: 'prompt', userInputMessageContext: { tools: [tool], toolResults: [result] } } } } });
  const value = codec.decode(wire);
  expect(value.model).toBe(''); expect(value.stream).toBe(true); expect(value.text).toBe('history\nreply\nprompt');
  expect(value.tools).toEqual([{ name: 'fs_read', inputSchema: { type: 'object' }, raw: tool }]);
  expect(value.toolResults).toEqual([{ id: 'call', text: 'fixture\nnext', isError: false, raw: result }]);
  expect(value.body).toEqual(JSON.parse(wire.body));
});
test('Q rejects unsupported targets, endpoints and malformed envelopes', () => {
  expect(codec.matches('POST', '/?origin=KIRO_CLI')).toBe(true);
  expect(codec.matches('GET', '/')).toBe(false); expect(codec.matches('POST', '/v1/messages')).toBe(false);
  expect(() => codec.decode(raw(body, 'Other.Operation'))).toThrow('X-Amz-Target');
  expect(() => codec.decode(raw([]))).toThrow('JSON object');
  expect(() => codec.decode(raw({}))).toThrow('currentMessage');
  expect(() => codec.decode(raw({ conversationState: { currentMessage: { userInputMessage: { modelId: 1 } } } }))).toThrow('modelId');
  expect(() => codec.decode(raw({ conversationState: { history: {}, currentMessage: { userInputMessage: {} } } }))).toThrow('array');
});
test('Q uses AWS binary eventstream with native UTF-8 text and JSON-string tool input, terminating at EOF', async () => {
  const response = codec.encode(request(), { stream: (async function* () { yield { text: 'héllo 🐜' }; yield { toolCall: { id: 'c', name: 'fs_read', input: { path: '/tmp/fixture' } } }; yield { text: 'done' }; })() }, signal());
  expect(response.headers['content-type']).toBe('application/vnd.amazon.eventstream');
  expect(decode(await read(response))).toEqual([
    { type: 'assistantResponseEvent', body: { content: 'héllo 🐜' } },
    { type: 'toolUseEvent', body: { toolUseId: 'c', name: 'fs_read' } },
    { type: 'toolUseEvent', body: { toolUseId: 'c', name: 'fs_read', input: '{"path":"/tmp/fixture"}' } },
    { type: 'toolUseEvent', body: { toolUseId: 'c', name: 'fs_read', stop: true } },
    { type: 'assistantResponseEvent', body: { content: 'done' } },
  ]);
});
test('Q lazily pulls events and stops pulling after abort', async () => {
  const controller = new AbortController(); let pulls = 0;
  const response = codec.encode(request(), { stream: (async function* () { pulls++; yield { text: 'first' }; pulls++; yield { text: 'never' }; })() }, controller.signal);
  expect(pulls).toBe(0);
  const iterator = response.body[Symbol.asyncIterator](); const first = await iterator.next();
  expect(decode(first.value as Uint8Array)[0]?.body.content).toBe('first'); expect(pulls).toBe(1);
  controller.abort(new Error('cancel'));
  await expect(iterator.next()).rejects.toThrow('cancel'); expect(pulls).toBe(1);
  await expect(read(codec.encode(request(), { text: 'never' }, controller.signal))).rejects.toThrow('cancel');
});
test('Q auxiliary routes require matching explicit replies and remain ordinary captured requests', async () => {
  const list = request(models); expect(list.stream).toBe(false); expect(list.text).toBe('');
  expect(JSON.parse(String(await read(codec.encode(list, { amazonQ: { models: [{ modelId: 'test', modelName: 'Test' }] } }, signal()))))).toEqual({ models: [{ modelId: 'test', modelName: 'Test' }] });
  expect(String(await read(codec.encode(request(telemetry), { amazonQ: { telemetry: true } }, signal())))).toBe('{}');
  for (const response of [{ text: 'wrong' }, { health: true }, { amazonQ: { telemetry: true } }] as ScriptedResponse[]) expect(() => codec.encode(list, response, signal())).toThrow('explicit');
  expect(() => codec.encode(request(), { amazonQ: { models: [] } }, signal())).toThrow('generation');
  expect(() => codec.encode(request(telemetry), { amazonQ: { models: [] } }, signal())).toThrow('explicit');
});
test('Q errors are native JSON and malformed scripts fail visibly', async () => {
  const error = codec.encode(request(), { error: { status: 429, message: 'slow', type: 'ThrottlingException' } }, signal());
  expect(error.status).toBe(429); expect(JSON.parse(String(await read(error)))).toEqual({ __type: 'ThrottlingException', message: 'slow' });
  expect(() => codec.encode(request(), { error: { status: 200, message: 'bad' } }, signal())).toThrow();
  await expect(read(codec.encode(request(), { toolCall: { id: '', name: 'read', input: {} } }, signal()))).rejects.toThrow();
  await expect(read(codec.encode(request(), { stream: (async function* () { throw new Error('script failed'); })() }, signal()))).rejects.toThrow('script failed');
});

test('Q named recipe renders isolated native service config and closes its listener/files', async () => {
  const { createRegistry, prepare } = await import('../src/index.js');
  const { readFile, access } = await import('node:fs/promises');
  const registry = createRegistry({ builtins: false });
  await registry.loadFile(new URL('../harnesses/amazon-q.json', import.meta.url).pathname);
  const ai = await prepare({ registry, harness: 'amazon-q', mode: 'nonInteractive' });
  const env = ai.environment({ HOME: '/original-home', KIRO_API_KEY: 'original-key' });
  try {
    expect(env.HOME).not.toBe('/original-home'); expect(env.KIRO_API_KEY).toBe(ai.apiKey);
    expect(ai.args).toEqual(['chat', '--no-interactive']);
    expect(JSON.parse(await readFile(ai.configFiles[0]!.path, 'utf8'))).toEqual({
      'api.codewhisperer.service': { endpoint: ai.baseUrl, region: 'us-east-1' },
      'api.q.service': { endpoint: ai.baseUrl, region: 'us-east-1' },
    });
    ai.route(() => true, route => route.fulfill({ amazonQ: { telemetry: true } }));
    const response = await fetch(ai.baseUrl, { method: 'POST', headers: { 'x-amz-target': telemetry }, body: '{}' });
    expect(await response.json()).toEqual({});
    expect(ai.requests[0]!.raw.body).toBe('{}'); expect(ai.responses[0]!.outcome).toBe('completed'); ai.assertHealthy();
  } finally { await ai.dispose(); }
  await expect(access(env.HOME!)).rejects.toThrow();
  await expect(fetch(ai.baseUrl)).rejects.toThrow();
});
