import { expect, test } from 'bun:test';
import { googleGenai as codec } from '../src/provider/google-genai.js';
import type { CapturedRequest, EncodedResponse } from '../src/provider/types.js';
const raw = (body: unknown, stream = false) => ({ method: 'POST', path: `/v1beta/models/gemini-test:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, headers: {}, body: JSON.stringify(body) });
const request = (stream = false): CapturedRequest => { const wire = raw({ contents: [] }, stream); return { ...codec.decode(wire), raw: wire, id: 'test', timestamp: 1 }; };
async function read(response: EncodedResponse) { let output = ''; for await (const chunk of response.body) output += chunk; return output; }
const signal = () => new AbortController().signal;
test('Gemini endpoint model, text, function declarations and actual results are decoded without flattening opaque data', () => {
  const wire = raw({ systemInstruction: { parts: [{ text: 'system' }] }, contents: [{ parts: [{ text: 'prompt' }, { text: 'private', thought: true }, { inlineData: { data: 'opaque' } }, { functionResponse: { name: 'read_file', response: { output: 'fixture' } } }, { functionResponse: { name: 'bash', id: 'call', response: { error: 'denied' } } }] }], tools: [{ functionDeclarations: [{ name: 'read_file', parameters: { type: 'OBJECT' } }, { name: 'bash', parametersJsonSchema: { type: 'object' } }] }] }, true);
  const result = codec.decode(wire);
  expect(result.model).toBe('gemini-test'); expect(result.stream).toBe(true); expect(result.text).toBe('system\nprompt');
  expect(result.toolResults.map(r => [r.id, r.text, r.isError])).toEqual([['read_file', '{"output":"fixture"}', false], ['call', '{"error":"denied"}', true]]);
  expect(result.tools.map(t => t.inputSchema)).toEqual([{ type: 'OBJECT' }, { type: 'object' }]);
  expect(result.body).toEqual(JSON.parse(wire.body));
});
test('Gemini endpoints reject unrelated paths and malformed requests', () => {
  expect(codec.matches('POST', raw({}).path)).toBe(true);
  for (const path of ['/v1/messages', '/v1beta/models/:generateContent', '/v1beta/models/x:countTokens', '/v1/projects/x/models/x:generateContent']) expect(codec.matches('POST', path)).toBe(false);
  expect(codec.matches('GET', raw({}).path)).toBe(false);
  expect(() => codec.decode(raw([]))).toThrow('JSON object');
  expect(() => codec.decode(raw({ contents: {} }))).toThrow('array');
  expect(() => codec.decode({ ...raw({}, true), path: '/v1beta/models/x:streamGenerateContent' })).toThrow('alt=sse');
});
test('Gemini nonstream collects text and emits function calls with stable IDs', async () => {
  const response = JSON.parse(await read(codec.encode(request(), { stream: (async function* () { yield { text: 'a' }; yield { text: 'b' }; yield { toolCall: { id: 'c', name: 'read_file', input: { file_path: 'x' } } }; })() }, signal())));
  expect(response.candidates[0].content.parts).toEqual([{ text: 'ab' }, { functionCall: { id: 'c', name: 'read_file', args: { file_path: 'x' } } }]);
  expect(response.candidates[0].finishReason).toBe('STOP');
});
test('Gemini SSE is incremental, finishes once, and stops on abort', async () => {
  const controller = new AbortController();
  const output = codec.encode(request(true), { stream: (async function* () { yield { text: 'first' }; yield { toolCall: { id: 'c', name: 'read_file', input: {} } }; })() }, controller.signal);
  const iterator = output.body[Symbol.asyncIterator]();
  const first = await iterator.next(); expect(String(first.value)).toContain('first'); expect(String(first.value)).not.toContain('finishReason');
  expect(String((await iterator.next()).value)).toContain('functionCall');
  expect(String((await iterator.next()).value)).toContain('"finishReason":"STOP"');
  expect((await iterator.next()).done).toBe(true);
  const aborted = codec.encode(request(true), { text: 'never' }, controller.signal); controller.abort();
  await expect(read(aborted)).rejects.toThrow();
});
test('Gemini scripted HTTP errors use native status and reject auxiliary responses', async () => {
  const error = codec.encode(request(true), { error: { status: 429, message: 'slow' } }, signal());
  expect(error.status).toBe(429); expect(JSON.parse(await read(error))).toEqual({ error: { code: 429, message: 'slow', status: 'RESOURCE_EXHAUSTED' } });
  expect(() => codec.encode(request(), { health: true }, signal())).toThrow();
  expect(() => codec.encode(request(), { error: { status: 200, message: 'bad' } }, signal())).toThrow();
});
