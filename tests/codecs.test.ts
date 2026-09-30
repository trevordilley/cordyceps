import { describe, expect, test } from 'bun:test';
import { codecIds, getCodec } from '../src/provider/index.js';
import type { CapturedRequest, EncodedResponse, ProviderEvent, RawHttpRequest, ScriptedResponse } from '../src/provider/types.js';

function raw(body: unknown, path = '/v1/messages'): RawHttpRequest {
  return { method: 'POST', path, headers: { 'x-fixture': 'synthetic' }, body: JSON.stringify(body) };
}
function request(id: string, stream = false): CapturedRequest {
  const wire = raw({ model: 'synthetic-model', stream, ...(id === 'anthropic-messages' ? { messages: [] } : { input: '' }) });
  return { ...getCodec(id).decode(wire), id: 'captured-request', timestamp: 123, raw: wire };
}
async function read(response: EncodedResponse): Promise<string> {
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}
function frames(text: string): any[] {
  expect(text.endsWith('\n\n')).toBe(true);
  return text.trimEnd().split('\n\n').map(frame => {
    const [name, data] = frame.split('\n');
    expect(data?.startsWith('data: ')).toBe(true);
    const value = JSON.parse(data!.slice(6));
    expect(name).toBe(`event: ${value.type}`);
    return value;
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
const call = { id: 'call-fixture', name: 'Read', input: { path: '/synthetic/雪.txt', nested: { lines: [1, 2] } } };
async function* mixed(): AsyncGenerator<ProviderEvent> {
  yield { text: 'A\n' };
  yield { text: '雪' };
  yield { toolCall: call };
  yield { text: 'after' };
  yield { toolCall: { ...call, id: 'second' } };
}

test('registry exposes its codecs and rejects unknown/prototype names', () => {
  expect(codecIds).toEqual(['anthropic-messages', 'openai-responses', 'openai-chat-completions', 'google-genai', 'amazon-q', 'augment']);
  expect(Object.isFrozen(codecIds)).toBe(true);
  for (const id of codecIds) expect(Object.isFrozen(getCodec(id))).toBe(true);
  for (const id of ['missing', 'toString', '__proto__']) expect(() => getCodec(id)).toThrow('Unknown provider codec');
});

test('Anthropic normalizes explicit text, offered client schemas, and actual result blocks', () => {
  const body = { model: 'fixture', stream: true, system: [{ type: 'text', text: 'system' }],
    tools: [{ name: 'Read', input_schema: { type: 'object' }, description: 'fixture' }, { type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: 'question' }, { role: 'assistant', content: [{ type: 'tool_use', ...call }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: [{ type: 'text', text: 'failure' }, { type: 'image', source: { data: 'opaque' } }] }, { type: 'text', text: 'retry' }] }],
    extra: { keep: true } };
  const wire = raw(body);
  const original = structuredClone(wire);
  const decoded = getCodec('anthropic-messages').decode(wire);
  expect(decoded.text).toBe('system\nquestion\nretry');
  expect(decoded.tools).toEqual([{ name: 'Read', inputSchema: body.tools[0]!.input_schema, raw: body.tools[0] }]);
  expect(decoded.toolResults).toEqual([{ id: call.id, text: 'failure', isError: true, raw: body.messages[2]!.content[0] }]);
  expect(decoded.body).toEqual(body);
  expect(wire).toEqual(original);
});

test('Anthropic string tool result and absent error flag remain factual', () => {
  const decoded = getCodec('anthropic-messages').decode(raw({ model: 'fixture', messages: [{ role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'one', content: 'error is just prose' },
    { type: 'tool_result', tool_use_id: 'two', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
  ] }] }));
  expect(decoded.toolResults.map(({ id, text, isError }) => ({ id, text, isError }))).toEqual([
    { id: 'one', text: 'error is just prose', isError: false }, { id: 'two', text: 'a\nb', isError: false },
  ]);
});

test('Responses normalizes messages and function output without guessing error semantics', () => {
  const body = { model: 'fixture', instructions: 'system', input: [
    { role: 'user', content: [{ type: 'input_text', text: 'question' }, { type: 'input_image', image_url: 'opaque' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'previous' }] },
    { type: 'function_call', call_id: 'one', arguments: '{"secret":"not prose"}' },
    { type: 'function_call_output', call_id: 'one', output: 'error text', is_error: true },
    { type: 'function_call_output', call_id: 'two', output: [{ type: 'input_text', text: 'fixture result' }, { type: 'input_image', image_url: 'opaque' }] },
  ], tools: [{ type: 'function', name: 'Read', parameters: { type: 'object' }, strict: true }, { type: 'web_search' }], unknown: ['preserve'] };
  const wire = raw(body, '/v1/responses');
  const decoded = getCodec('openai-responses').decode(wire);
  expect(decoded.text).toBe('system\nquestion\nprevious');
  expect(decoded.tools).toEqual([{ name: 'Read', inputSchema: body.tools[0]!.parameters, raw: body.tools[0] }]);
  expect(decoded.toolResults).toEqual([
    { id: 'one', text: 'error text', isError: false, raw: body.input[3] },
    { id: 'two', text: 'fixture result', isError: false, raw: body.input[4] },
  ]);
  expect(decoded.body).toEqual(body);
  expect(wire.body).toBe(JSON.stringify(body));
  expect(getCodec('openai-responses').decode(raw({ model: 'fixture', input: 'hello' })).text).toBe('hello');
});

for (const id of ['anthropic-messages', 'openai-responses']) describe(id, () => {
  const codec = getCodec(id);
  const anthropic = id === 'anthropic-messages';
  const endpoint = anthropic ? '/v1/messages' : '/v1/responses';
  const terminal = anthropic ? 'message_stop' : 'response.completed';
  const delta = anthropic ? 'content_block_delta' : 'response.output_text.delta';
  const encode = (response: ScriptedResponse, stream = false, signal = new AbortController().signal) => codec.encode(request(id, stream), response, signal);

  test('matches exact POST endpoint including query but no unrelated paths', () => {
    expect(codec.matches('POST', endpoint)).toBe(true);
    expect(codec.matches('post', `${endpoint}?beta=true`)).toBe(true);
    for (const path of [`${endpoint}/extra`, `${endpoint}/`, '/v1/chat/completions', `/prefix${endpoint}`]) expect(codec.matches('POST', path)).toBe(false);
    expect(codec.matches('GET', endpoint)).toBe(false);
  });

  test('rejects malformed envelopes and field types', () => {
    expect(() => codec.decode({ ...raw({}), body: '{broken' })).toThrow();
    for (const body of [null, [], {}, { model: '' }, { model: 42 }, { model: 'x', stream: 'false' }, { model: 'x', tools: {} }]) {
      expect(() => codec.decode(raw(body))).toThrow();
    }
    expect(() => codec.decode(raw({ model: 'x', [anthropic ? 'messages' : 'input']: 123 }))).toThrow();
  });

  test('encodes JSON text including Unicode/newlines and empty text', async () => {
    for (const text of ['hello\n雪', '']) {
      const response = encode({ text });
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      const value = JSON.parse(await read(response));
      expect(value.model).toBe('synthetic-model');
      if (anthropic) {
        expect(value.content).toEqual([{ type: 'text', text }]);
        expect(value.stop_reason).toBe('end_turn');
      } else {
        expect(value.object).toBe('response');
        expect(value.status).toBe('completed');
        expect(value.output[0].content[0].text).toBe(text);
      }
    }
  });

  test('encodes complete JSON tool call with exact identity and arguments', async () => {
    const value = JSON.parse(await read(encode({ toolCall: call })));
    if (anthropic) {
      expect(value.content).toEqual([{ type: 'tool_use', ...call }]);
      expect(value.stop_reason).toBe('tool_use');
    } else {
      expect(value.output[0]).toMatchObject({ type: 'function_call', call_id: call.id, name: call.name, status: 'completed' });
      expect(value.output[0].id).not.toBe(call.id);
      expect(JSON.parse(value.output[0].arguments)).toEqual(call.input);
    }
  });

  test('aggregates async text/tool events when the request is nonstreaming', async () => {
    const value = JSON.parse(await read(encode({ stream: mixed() })));
    const output = anthropic ? value.content : value.output;
    expect(output).toHaveLength(4);
    expect(anthropic ? output[0].text : output[0].content[0].text).toBe('A\n雪');
    expect(anthropic ? output[1].id : output[1].call_id).toBe(call.id);
    expect(anthropic ? output[2].text : output[2].content[0].text).toBe('after');
    expect(anthropic ? output[3].id : output[3].call_id).toBe('second');
  });

  test('SSE text has ordered provider lifecycle and terminal framing', async () => {
    const response = encode({ text: 'one\n雪' }, true);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const values = frames(await read(response));
    expect(values.map(v => v.type)).toEqual(anthropic ? [
      'message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
    ] : [
      'response.created', 'response.in_progress', 'response.output_item.added', 'response.content_part.added',
      'response.output_text.delta', 'response.output_text.done', 'response.content_part.done', 'response.output_item.done', 'response.completed',
    ]);
    if (anthropic) expect(values[2].delta.text).toBe('one\n雪');
    else {
      expect(values.map(v => v.sequence_number)).toEqual(values.map((_, i) => i));
      expect(values[4].delta).toBe('one\n雪');
      expect(values.at(-1).response.output).toEqual([values.at(-2).item]);
      expect(values[0].response.id).toBe(values.at(-1).response.id);
    }
  });

  test('SSE mixed events retain block indices, call IDs, complete arguments and final state', async () => {
    const values = frames(await read(encode({ stream: mixed() }, true)));
    expect(values.at(-1).type).toBe(terminal);
    if (anthropic) {
      expect(values.filter(v => v.type === 'content_block_start').map(v => v.index)).toEqual([0, 1, 2, 3]);
      expect(values.filter(v => v.type === 'content_block_stop').map(v => v.index)).toEqual([0, 1, 2, 3]);
      expect(values.filter(v => v.delta?.type === 'text_delta').map(v => v.delta.text)).toEqual(['A\n', '雪', 'after']);
      expect(values.filter(v => v.delta?.type === 'input_json_delta').map(v => JSON.parse(v.delta.partial_json))).toEqual([call.input, call.input]);
      expect(values.at(-2).delta.stop_reason).toBe('tool_use');
    } else {
      expect(values.map(v => v.sequence_number)).toEqual(values.map((_, i) => i));
      const done = values.filter(v => v.type === 'response.output_item.done');
      expect(done.map(v => v.output_index)).toEqual([0, 1, 2, 3]);
      expect(values.at(-1).response.output).toEqual(done.map(v => v.item));
      for (const v of values.filter(v => v.type === 'response.function_call_arguments.done')) {
        expect(JSON.parse(v.arguments)).toEqual(call.input);
        expect(v.item_id).toBe(done[v.output_index].item.id);
      }
      expect(done[1].item.call_id).toBe(call.id);
      expect(done[3].item.call_id).toBe('second');
    }
  });

  test('empty async streams still terminate normally', async () => {
    async function* empty(): AsyncGenerator<ProviderEvent> {}
    const values = frames(await read(encode({ stream: empty() }, true)));
    expect(values.at(-1).type).toBe(terminal);
    const value = JSON.parse(await read(encode({ stream: empty() })));
    expect(anthropic ? value.content : value.output).toEqual([]);
  });

  test('gates are lazy and no content or terminal is emitted before release', async () => {
    const gate = deferred();
    const entered = deferred();
    let pulls = 0;
    async function* script(): AsyncGenerator<ProviderEvent> {
      pulls++;
      yield { text: 'first' };
      pulls++;
      entered.resolve();
      await gate.promise;
      yield { text: 'second' };
    }
    const response = encode({ stream: script() }, true);
    expect(pulls).toBe(0);
    const iterator = response.body[Symbol.asyncIterator]();
    let value: IteratorResult<string | Uint8Array>;
    do { value = await iterator.next(); } while (!String(value.value).includes(`event: ${delta}\n`));
    expect(pulls).toBe(1);
    let settled = false;
    const pending = iterator.next().then(result => { settled = true; return result; });
    await entered.promise;
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve();
    expect(String((await pending).value)).toContain('second');
    let rest = '';
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) rest += String(next.value);
    expect(rest).toContain(`event: ${terminal}\n`);
  });

  test('abort at a suspended gate rejects after release without success framing', async () => {
    const controller = new AbortController();
    const gate = deferred();
    const entered = deferred();
    let closed = false;
    async function* script(): AsyncGenerator<ProviderEvent> {
      try { entered.resolve(); await gate.promise; yield { text: 'late' }; }
      finally { closed = true; }
    }
    const iterator = encode({ stream: script() }, true, controller.signal).body[Symbol.asyncIterator]();
    await iterator.next();
    if (!anthropic) await iterator.next();
    const pending = iterator.next();
    await entered.promise;
    const failure = new Error('synthetic abort');
    controller.abort(failure);
    gate.resolve();
    await expect(pending).rejects.toBe(failure);
    expect(closed).toBe(true);
    expect((await iterator.next()).done).toBe(true);
  });

  test('pre-abort never enters the source; early return closes it', async () => {
    let entered = false;
    let closed = false;
    async function* script(): AsyncGenerator<ProviderEvent> {
      entered = true;
      try { yield { text: 'first' }; yield { text: 'second' }; } finally { closed = true; }
    }
    const controller = new AbortController();
    controller.abort(new Error('already stopped'));
    await expect(read(encode({ stream: script() }, true, controller.signal))).rejects.toThrow('already stopped');
    expect(entered).toBe(false);
    const iterator = encode({ stream: script() }, true).body[Symbol.asyncIterator]();
    while (!String((await iterator.next()).value).includes(`event: ${delta}\n`)) {}
    await iterator.return?.();
    expect(closed).toBe(true);
  });

  test('script exceptions propagate without a forged successful terminal', async () => {
    const failure = new Error('script failed');
    async function* script(): AsyncGenerator<ProviderEvent> { yield { text: 'partial' }; throw failure; }
    let seen = '';
    try { for await (const chunk of encode({ stream: script() }, true).body) seen += String(chunk); }
    catch (error) { expect(error).toBe(failure); }
    expect(seen).toContain('partial');
    expect(seen).not.toContain(`event: ${terminal}\n`);
    await expect(read(encode({ stream: script() }))).rejects.toBe(failure);
  });

  test('scripted errors are provider JSON HTTP errors even for a streaming request', async () => {
    for (const stream of [false, true]) {
      const response = encode({ error: { status: 429, message: 'synthetic limit' } }, stream);
      expect(response.status).toBe(429);
      expect(response.headers['content-type']).toContain('application/json');
      const value = JSON.parse(await read(response));
      expect(value.error).toMatchObject({ type: 'rate_limit_error', message: 'synthetic limit' });
      if (anthropic) {
        expect(value.type).toBe('error');
        expect(value.request_id).toBe(response.headers['request-id']);
      }
    }
    const custom = JSON.parse(await read(encode({ error: { status: 503, message: 'custom', type: 'fixture_error' } })));
    expect(custom.error.type).toBe('fixture_error');
    for (const status of [200, 399, 600, 429.5, NaN]) expect(() => encode({ error: { status, message: 'bad' } })).toThrow('400 to 599');
  });

  test('invalid tool inputs and invalid stream events fail visibly', async () => {
    await expect(read(encode({ toolCall: { ...call, input: 'not an object' } }))).rejects.toThrow('JSON object input');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(read(encode({ toolCall: { ...call, input: circular } }))).rejects.toThrow();
    async function* invalid(): AsyncGenerator<ProviderEvent> { yield { nope: true } as unknown as ProviderEvent; }
    await expect(read(encode({ stream: invalid() }))).rejects.toThrow('Provider event');
  });
});
