import { expect, test } from 'bun:test';
import { hermes } from '../src/provider/hermes.js';
import type { CapturedRequest, RawHttpRequest } from '../src/provider/types.js';
const raw = (method: string, path: string, body = ''): RawHttpRequest => ({ method, path, body, headers: {} });
const capture = (request: RawHttpRequest): CapturedRequest => ({ id: 'probe', timestamp: 0, raw: request, ...hermes.decode(request) });
const consume = async (body: AsyncIterable<string | Uint8Array>) => { let text = ''; for await (const part of body) text += typeof part === 'string' ? part : new TextDecoder().decode(part); return text; };

test('Hermes captures only observed metadata probes alongside model chat', () => {
  for (const path of ['/api/v1/models', '/api/tags', '/v1/props', '/props', '/version', '/v1/models', '/models', '/v1/models/custom-model']) {
    expect(hermes.matches('GET', path + '?test=1')).toBe(true);
    const request = capture(raw('GET', path));
    expect(request.model).toBe('');
    expect(request.toolResults).toEqual([]);
    expect(request.body).toBeNull();
    expect(hermes.matches('POST', path)).toBe(false);
  }
  expect(hermes.matches('POST', '/api/show')).toBe(true);
  expect(hermes.matches('GET', '/api/show')).toBe(false);
  expect(hermes.matches('GET', '/v1/models/test/extra')).toBe(false);
  expect(hermes.matches('POST', '/arbitrary')).toBe(false);
  expect(() => capture(raw('POST', '/api/show', '[]'))).toThrow();
  expect(() => capture(raw('GET', '/unknown'))).toThrow();
});

test('Hermes metadata has no default success and keeps explicit HTTP errors', async () => {
  const request = capture(raw('POST', '/api/show', '{"model":"custom-model"}'));
  const signal = new AbortController().signal;
  for (const response of [{ health: true } as const, { text: 'not JSON' }, { text: '[]' }, { text: 'null' }]) expect(() => hermes.encode(request, response, signal)).toThrow();
  const reply = hermes.encode(request, { text: '{"model_info":{"context_length":128000}}' }, signal);
  expect(JSON.parse(await consume(reply.body))).toEqual({ model_info: { context_length: 128000 } });
  const unavailable = hermes.encode(request, { error: { status: 404, message: 'metadata unavailable' } }, signal);
  expect(unavailable.status).toBe(404);
  expect(await consume(unavailable.body)).toContain('metadata unavailable');
});

test('Hermes delegates streaming model tools and preserves native tool results', async () => {
  const request = capture(raw('POST', '/v1/chat/completions', JSON.stringify({ model: 'test', stream: true,
    messages: [{ role: 'user', content: 'read fixture' }, { role: 'tool', tool_call_id: 'read-1', content: 'actual token' }],
    tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }] })));
  expect(request.text).toBe('read fixture');
  expect(request.toolResults[0]?.text).toBe('actual token');
  const controller = new AbortController();
  const reply = hermes.encode(request, { toolCall: { id: 'read-2', name: 'read_file', input: { path: 'fixture.txt' } } }, controller.signal);
  expect(await consume(reply.body)).toContain('read_file');
  controller.abort();
  await expect(consume(hermes.encode(request, { text: 'late' }, controller.signal).body)).rejects.toThrow();
});
