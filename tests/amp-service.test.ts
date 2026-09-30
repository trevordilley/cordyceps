import { expect, test } from 'bun:test';
import { ampService } from '../src/provider/amp-service.js';
import type { CapturedRequest, RawHttpRequest } from '../src/provider/types.js';
const raw = (path: string, body = '{}'): RawHttpRequest => ({ method: 'POST', path, body, headers: {} });
const capture = (request: RawHttpRequest): CapturedRequest => ({ id: 'test', timestamp: 0, raw: request, ...ampService.decode(request) });
const consume = async (body: AsyncIterable<string | Uint8Array>) => { let text = ''; for await (const part of body) text += typeof part === 'string' ? part : new TextDecoder().decode(part); return text; };

test('Amp accepts observed Anthropic gateway and only explicit service methods', () => {
  expect(ampService.matches('POST', '/api/provider/anthropic/v1/messages')).toBe(true);
  for (const method of ['getUserInfo', 'getThread', 'getUserFreeTierStatus', 'uploadThread']) expect(ampService.matches('POST', '/api/internal?' + method)).toBe(true);
  for (const path of ['/v1/messages', '/api/internal?checkModelProviderAccess', '/api/internal?deleteThread', '/api/internal?getThread&other=1']) expect(ampService.matches('POST', path)).toBe(false);
  expect(ampService.matches('GET', '/api/internal?getUserInfo')).toBe(false);
  expect(() => ampService.decode(raw('/unknown'))).toThrow();
});

test('Amp delegates actual native tool definitions/results and SSE', async () => {
  const request = capture(raw('/api/provider/anthropic/v1/messages', JSON.stringify({ model: 'test', stream: true,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'read fixture' }, { type: 'tool_result', tool_use_id: 'fixture', content: 'file-only-token' }] }],
    tools: [{ name: 'Read', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }] })));
  expect(request.text).toContain('read fixture');
  expect(request.toolResults[0]?.text).toBe('file-only-token');
  expect(request.tools[0]?.name).toBe('Read');
  expect(request.raw.path).toBe('/api/provider/anthropic/v1/messages');
  const result = ampService.encode(request, { toolCall: { id: 'fixture', name: 'Read', input: { path: 'fixture.txt' } } }, new AbortController().signal);
  expect(result.headers['content-type']).toContain('text/event-stream');
  const wire = await consume(result.body);
  expect(wire).toContain('tool_use');expect(wire).toContain('Read');expect(wire).toContain('message_stop');
});

test('Amp never invents account/thread state; service JSON is explicitly supplied', async () => {
  const request = capture(raw('/api/internal?getThread', '{"method":"getThread","params":{"thread":"T-test"}}'));
  const signal = new AbortController().signal;
  expect(request.body).toEqual({ method: 'getThread', params: { thread: 'T-test' } });
  for (const response of [{ text: 'hello' }, { text: '[]' }, { toolCall: { name: 'Read', input: {} } }]) expect(() => ampService.encode(request, response, signal)).toThrow();
  const reply = { ok: false, error: { code: 'thread-not-found' } };
  const encoded = ampService.encode(request, { text: JSON.stringify(reply) }, signal);
  expect(JSON.parse(await consume(encoded.body))).toEqual(reply);
  const error = ampService.encode(request, { error: { status: 401, message: 'test auth failure' } }, signal);
  expect(error.status).toBe(401);expect(await consume(error.body)).toContain('test auth failure');
});


test('Amp rejects unrelated provider bootstrap branches even alongside JSON text', () => {
  const request = capture(raw('/api/internal?getUserInfo'));
  for (const branch of [{ amazonQ: { models: [] } }, { augmentModels: { defaultModel: 'fixture' } }]) {
    const response = { text: '{}', ...branch } as Parameters<typeof ampService.encode>[1];
    expect(() => ampService.encode(request, response, new AbortController().signal)).toThrow('not supported by Amp');
  }
});
