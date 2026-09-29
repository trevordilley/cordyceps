import { expect, test } from 'bun:test';
import { cordyceps, getCodec } from '../src/index.js';
import type { CapturedRequest, ScriptedResponse } from '../src/index.js';

const codec = getCodec('anthropic-messages');
const signal = new AbortController().signal;
function request(method: string, path: string, body = ''): CapturedRequest {
  const raw = { method, path, headers: {}, body };
  return { ...codec.decode(raw), id: 'auxiliary', timestamp: 0, raw };
}

test('auxiliary endpoints match only their exact method/path and remain explicitly scripted', async () => {
  expect(codec.matches('HEAD', '/api/hello')).toBe(true);
  expect(codec.matches('POST', '/v1/messages/count_tokens?beta=true')).toBe(true);
  for (const [method, path] of [['GET', '/api/hello'], ['POST', '/api/hello'], ['HEAD', '/api/hello/extra'],
    ['GET', '/v1/messages/count_tokens'], ['POST', '/v1/messages/count_tokens/extra']]) {
    expect(codec.matches(method!, path!)).toBe(false);
  }
  const hello = request('HEAD', '/api/hello');
  expect(hello.model).toBe('');
  expect(hello.body).toBeNull();
  expect(() => codec.encode(hello, { text: 'not a health reply' }, signal)).toThrow('health');
  const health = codec.encode(hello, { health: true }, signal);
  expect(health.status).toBe(200);
  let payload = '';
  for await (const chunk of health.body) payload += chunk;
  expect(payload).toBe('');
  const count = request('POST', '/v1/messages/count_tokens?beta=true', JSON.stringify({ model: 'fixture', messages: [] }));
  for (const inputTokens of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => codec.encode(count, { inputTokens }, signal)).toThrow('nonnegative safe integer');
  }
  expect(() => codec.encode(count, { text: 'wrong shape' }, signal)).toThrow('inputTokens');
  const message = request('POST', '/v1/messages', '{"model":"fixture","messages":[]}');
  for (const script of [{ inputTokens: 3 }, { health: true }] as ScriptedResponse[]) {
    expect(() => codec.encode(message, script, signal)).toThrow('exact endpoint');
    expect(() => getCodec('openai-responses').encode(message, script, signal)).toThrow('does not support');
  }
});

test('real HTTP hello and token-count requests are captured, routed and checked through public session API', async () => {
  const ai = await cordyceps.prepare({ harness: 'claude-code' });
  try {
    ai.route(r => r.raw.method === 'HEAD' && r.raw.path === '/api/hello', r => r.fulfill({ health: true }));
    ai.route(r => r.raw.path === '/v1/messages/count_tokens?beta=true', r => r.fulfill({ inputTokens: 37 }));
    const hello = await fetch(ai.baseUrl + '/api/hello', { method: 'HEAD' });
    expect(hello.status).toBe(200);
    expect(await hello.text()).toBe('');
    const body = { model: 'claude-fixture', messages: [{ role: 'user', content: 'count this fixture' }],
      tools: [{ name: 'Read', input_schema: { type: 'object' } }] };
    const result = await fetch(ai.baseUrl + '/v1/messages/count_tokens?beta=true', {
      method: 'POST', body: JSON.stringify(body),
    });
    expect(await result.json()).toEqual({ input_tokens: 37 });
    expect(ai.requests).toHaveLength(2);
    expect(ai.requests[1]!.body).toEqual(body);
    expect(ai.requests[1]!.raw.body).toBe(JSON.stringify(body));
    expect(ai.requests[1]!.text).toBe('count this fixture');
    expect(ai.requests[1]!.tools[0]!.name).toBe('Read');
    expect(ai.requests[1]!.stream).toBe(false);
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

test('known ancillary endpoints without consumer routes still fail visibly', async () => {
  const ai = await cordyceps.prepare({ harness: 'claude-code' });
  try {
    expect((await fetch(ai.baseUrl + '/api/hello', { method: 'HEAD' })).status).toBe(500);
    expect(ai.requests).toHaveLength(1);
    expect(() => ai.assertHealthy()).toThrow('No route matched');
  } finally { await ai.dispose(); }
});
