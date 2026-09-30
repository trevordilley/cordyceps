import { expect, test } from 'bun:test';
import { getCodec } from '../src/provider/index.js';
import type { CapturedRequest, EncodedResponse, ProviderEvent } from '../src/provider/types.js';
const codec = getCodec('openai-chat-completions');
function request(body: Record<string, unknown> = {}): CapturedRequest {
  const raw = { method: 'POST', path: '/v1/chat/completions', headers: {}, body: JSON.stringify({ model: 'fixture', messages: [], ...body }) };
  return { ...codec.decode(raw), raw, id: 'capture', timestamp: 1 };
}
async function read(r: EncodedResponse) { let out = ''; for await (const chunk of r.body) out += chunk; return out; }
const call = { id: 'read_1', name: 'read_file', input: { path: '雪.txt' } };
async function* mixed(): AsyncGenerator<ProviderEvent> { yield { text: 'hello ' }; yield { text: '雪' }; yield { toolCall: call }; yield { toolCall: { ...call, id: 'read_2' } }; }
test('Chat Completions exact endpoint and normalization preserve tools and opaque content', () => {
  expect(codec.matches('POST', '/v1/chat/completions?test=1')).toBe(true);
  for (const p of ['/chat/completions', '/v1/chat/completions/', '/v1/responses']) expect(codec.matches('POST', p)).toBe(false);
  expect(codec.matches('GET', '/v1/chat/completions')).toBe(false);
  const decoded = request({ tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }], messages: [
    { role: 'system', content: 'system' }, { role: 'user', content: [{ type: 'text', text: 'question' }, { type: 'image_url', image_url: { url: 'opaque' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'read_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'read_1', content: 'error is prose' },
  ] });
  expect(decoded.text).toBe('system\nquestion');
  expect(decoded.tools[0]).toMatchObject({ name: 'read_file', inputSchema: { type: 'object' } });
  expect(decoded.toolResults[0]).toMatchObject({ id: 'read_1', text: 'error is prose', isError: false });
  expect(decoded.body).toEqual(JSON.parse(decoded.raw.body));
  expect(() => request({ messages: 'bad' })).toThrow();
  expect(() => request({ tools: {} })).toThrow();
});
test('Chat JSON combines text and preserves independent tool identities', async () => {
  const value = JSON.parse(await read(codec.encode(request(), { stream: mixed() }, new AbortController().signal)));
  expect(value.object).toBe('chat.completion');
  expect(value.choices[0].finish_reason).toBe('tool_calls');
  expect(value.choices[0].message.content).toBe('hello 雪');
  expect(value.choices[0].message.tool_calls.map((t: any) => t.id)).toEqual(['read_1', 'read_2']);
  expect(JSON.parse(value.choices[0].message.tool_calls[0].function.arguments)).toEqual(call.input);
});
test('Chat SSE uses data-only frames, stable identity, tool indices, optional usage and DONE', async () => {
  const wire = await read(codec.encode(request({ stream: true, stream_options: { include_usage: true } }), { stream: mixed() }, new AbortController().signal));
  const lines = wire.trim().split('\n\n').map(f => f.slice(6));
  expect(lines.pop()).toBe('[DONE]');
  expect(wire).not.toContain('event:');
  const frames = lines.map(f => JSON.parse(f));
  expect(new Set(frames.map(f => f.id)).size).toBe(1);
  expect(frames.at(-1)).toMatchObject({ choices: [], usage: { total_tokens: 0 } });
  const choices = frames.flatMap(f => f.choices);
  expect(choices[0].delta.role).toBe('assistant');
  expect(choices.at(-1).finish_reason).toBe('tool_calls');
  expect(choices.flatMap(c => c.delta.tool_calls ?? []).filter(c => c.id).map(c => c.index)).toEqual([0, 1]);
});
test('Chat text-only and empty text complete successfully without fabricated tools', async () => {
  for (const text of ['text', '']) {
    const value = JSON.parse(await read(codec.encode(request(), { text }, new AbortController().signal)));
    expect(value.choices[0].message.content).toBe(text);
    expect(value.choices[0].message.tool_calls).toBeUndefined();
    expect(value.choices[0].finish_reason).toBe('stop');
  }
});
test('Chat streaming delivers first text without waiting for the next scripted event', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  async function* script() { yield { text: 'first' }; await gate; yield { text: 'second' }; }
  const iter = codec.encode(request({ stream: true }), { stream: script() }, new AbortController().signal).body[Symbol.asyncIterator]();
  await iter.next();
  expect((await iter.next()).value).toContain('first');
  release();
  expect((await iter.next()).value).toContain('second');
  await iter.return?.();
});
test('Chat cancellation prevents successful terminal frames', async () => {
  const controller = new AbortController();
  const iter = codec.encode(request({ stream: true }), { text: 'first' }, controller.signal).body[Symbol.asyncIterator]();
  await iter.next();
  controller.abort(new Error('cancelled test'));
  await expect(iter.next()).rejects.toThrow('cancelled test');
});
test('Chat errors remain HTTP errors and unsupported auxiliary replies fail', async () => {
  const response = codec.encode(request({ stream: true }), { error: { status: 429, message: 'slow down' } }, new AbortController().signal);
  expect(response.status).toBe(429);
  expect(response.headers['content-type']).toContain('application/json');
  expect(JSON.parse(await read(response)).error.type).toBe('rate_limit_error');
  expect(() => codec.encode(request(), { health: true }, new AbortController().signal)).toThrow('auxiliary');
});
