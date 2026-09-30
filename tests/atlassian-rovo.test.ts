import { expect, test } from 'bun:test';
import { atlassianRovo } from '../src/provider/atlassian-rovo.js';
import type { CapturedRequest, RawHttpRequest } from '../src/provider/types.js';
const raw = (path: string, body = '', method = 'POST'): RawHttpRequest => ({ method, path, body, headers: {} });
const capture = (request: RawHttpRequest): CapturedRequest => ({ id: 'test', timestamp: 0, raw: request, ...atlassianRovo.decode(request) });
const consume = async (body: AsyncIterable<string | Uint8Array>) => { let text = ''; for await (const part of body) text += typeof part === 'string' ? part : new TextDecoder().decode(part); return text; };

test('Rovo recognizes only observed gateway and auxiliary paths', () => {
  expect(atlassianRovo.matches('POST', '/v1/openai/v1/chat/completions?trace=1')).toBe(true);
  expect(atlassianRovo.matches('GET', '/v3/credits/check')).toBe(true);
  expect(atlassianRovo.matches('POST', '/prompt-moderation/')).toBe(true);
  for (const path of ['/v1/chat/completions', '/other/v1/openai/v1/chat/completions', '/v1/messages', '/prompt-moderation', '/v3/sites']) expect(atlassianRovo.matches('POST', path)).toBe(false);
  expect(atlassianRovo.matches('GET', '/v1/openai/v1/chat/completions')).toBe(false);
  expect(() => atlassianRovo.decode(raw('/unknown'))).toThrow('Unsupported Rovo endpoint');
});

test('Rovo delegates actual model conversation and tool results, preserving raw path', async () => {
  const input = raw('/v1/openai/v1/chat/completions', JSON.stringify({ model: 'test-model', stream: true,
    messages: [{ role: 'user', content: 'read fixture' }, { role: 'tool', tool_call_id: 'fixture', content: 'secret-from-file' }],
    tools: [{ type: 'function', function: { name: 'open_files', parameters: { type: 'object' } } }] }));
  const request = capture(input);
  expect(request.text).toContain('read fixture');
  expect(request.toolResults[0]?.text).toBe('secret-from-file');
  expect(request.tools[0]?.name).toBe('open_files');
  expect(request.raw.path).toBe('/v1/openai/v1/chat/completions');
  const output = atlassianRovo.encode(request, { toolCall: { id: 'fixture', name: 'open_files', input: { file_paths: ['fixture.txt'] } } }, new AbortController().signal);
  const text = await consume(output.body);
  expect(output.headers['content-type']).toContain('text/event-stream');
  expect(text).toContain('open_files');
  expect(text).toContain('[DONE]');
});

test('Rovo auxiliary responses require explicit object JSON and never supply an implicit policy', async () => {
  const request = capture(raw('/prompt-moderation/', JSON.stringify({ prompt: 'test prompt' })));
  expect(request.text).toBe('test prompt');
  expect(request.model).toBe('');
  expect(request.stream).toBe(false);
  const signal = new AbortController().signal;
  for (const response of [{ health: true } as const, { text: 'plain model text' }, { text: '[]' }, { text: 'null' }]) expect(() => atlassianRovo.encode(request, response, signal)).toThrow();
  const output = atlassianRovo.encode(request, { text: '{"status":"DISALLOWED","harm_category":"test"}' }, signal);
  expect(JSON.parse(await consume(output.body))).toEqual({ status: 'DISALLOWED', harm_category: 'test' });
  const credits = capture(raw('/v3/credits/check', '', 'GET'));
  expect(credits.body).toBeNull();
  expect(JSON.parse(await consume(atlassianRovo.encode(credits, { text: '{"status":"ALLOWED"}' }, signal).body))).toEqual({ status: 'ALLOWED' });
});

test('Rovo retains scripted HTTP errors and aborts delegated streams', async () => {
  const request = capture(raw('/v1/openai/v1/chat/completions', '{"model":"test","messages":[],"stream":true}'));
  const controller = new AbortController();
  const error = atlassianRovo.encode(request, { error: { status: 429, message: 'test rate limit' } }, controller.signal);
  expect(error.status).toBe(429);
  expect(await consume(error.body)).toContain('test rate limit');
  controller.abort();
  const response = atlassianRovo.encode(request, { text: 'must not emit' }, controller.signal);
  await expect(consume(response.body)).rejects.toThrow();
});
