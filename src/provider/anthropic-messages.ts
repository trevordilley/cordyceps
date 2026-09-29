import type { CapturedRequest, ProviderCodec, ProviderEvent, ScriptedResponse, ToolDefinition, ToolResult } from './types.js';
import { array, collect, encoded, errorStatus, events, json, matchesPath, object, parseRequest, sse, textContent, wireId } from './common.js';

const isHello = (method: string, path: string) => method.toUpperCase() === 'HEAD' && path.split('?')[0] === '/api/hello';
const isTokenCount = (method: string, path: string) => matchesPath(method, path, '/v1/messages/count_tokens');

function block(event: ProviderEvent): Record<string, unknown> {
  return 'text' in event ? { type: 'text', text: event.text }
    : { type: 'tool_use', ...event.toolCall };
}

function message(request: CapturedRequest, id: string, content: Record<string, unknown>[], stop: string | null) {
  return { id, type: 'message', role: 'assistant', model: request.model, content,
    stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } };
}

async function* body(request: CapturedRequest, response: ScriptedResponse, signal: AbortSignal): AsyncGenerator<string> {
  const id = wireId('msg');
  if (!request.stream) {
    const values = await collect(response, signal);
    yield JSON.stringify(message(request, id, values.map(block), values.some(v => 'toolCall' in v) ? 'tool_use' : 'end_turn'));
    return;
  }
  yield sse('message_start', { message: message(request, id, [], null) });
  let index = 0;
  let textOpen = false;
  let hasTool = false;
  for await (const value of events(response, signal)) {
    if ('text' in value) {
      if (!textOpen) {
        yield sse('content_block_start', { index, content_block: { type: 'text', text: '' } });
        textOpen = true;
      }
      yield sse('content_block_delta', { index, delta: { type: 'text_delta', text: value.text } });
    } else {
      if (textOpen) {
        yield sse('content_block_stop', { index: index++ });
        textOpen = false;
      }
      hasTool = true;
      yield sse('content_block_start', { index, content_block: { type: 'tool_use', id: value.toolCall.id, name: value.toolCall.name, input: {} } });
      yield sse('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(value.toolCall.input) } });
      yield sse('content_block_stop', { index: index++ });
    }
  }
  if (textOpen) yield sse('content_block_stop', { index });
  yield sse('message_delta', { delta: { stop_reason: hasTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } });
  yield sse('message_stop');
}

export const anthropicMessages: ProviderCodec = Object.freeze({
  id: 'anthropic-messages',
  matches: (method: string, path: string) => matchesPath(method, path, '/v1/messages') || isHello(method, path) || isTokenCount(method, path),
  decode(raw) {
    // A bodyless connectivity probe has no model or provider conversation.
    if (isHello(raw.method, raw.path)) return { model: '', stream: false, text: '', tools: [], toolResults: [], body: null };
    const body = parseRequest(raw);
    const text = textContent(body.system, ['text']);
    const tools: ToolDefinition[] = [];
    const toolResults: ToolResult[] = [];
    for (const message of array(body.messages, 'messages')) {
      if (!object(message)) continue;
      text.push(...textContent(message.content, ['text']));
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (object(part) && part.type === 'tool_result' && typeof part.tool_use_id === 'string') {
          toolResults.push({ id: part.tool_use_id, text: textContent(part.content, ['text']).join('\n'), isError: part.is_error === true, raw: part });
        }
      }
    }
    for (const tool of array(body.tools, 'tools')) {
      if (object(tool) && typeof tool.name === 'string' && tool.input_schema !== undefined) {
        tools.push({ name: tool.name, inputSchema: tool.input_schema, raw: tool });
      }
    }
    return { model: body.model, stream: !isTokenCount(raw.method, raw.path) && body.stream === true, text: text.join('\n'), tools, toolResults, body };
  },
  encode(request, response, signal) {
    if (response.error !== undefined) {
      const { status, message, type } = response.error;
      const defaults: Record<number, string> = { 400: 'invalid_request_error', 401: 'authentication_error', 403: 'permission_error', 404: 'not_found_error', 413: 'request_too_large', 429: 'rate_limit_error', 529: 'overloaded_error' };
      const requestId = wireId('req');
      const result = encoded(json({ type: 'error', error: { type: type ?? defaults[status] ?? 'api_error', message }, request_id: requestId }), signal, false, errorStatus(response.error));
      result.headers['request-id'] = requestId;
      return result;
    }
    if (isHello(request.raw.method, request.raw.path)) {
      if (response.health !== true) throw new TypeError('Anthropic HEAD /api/hello requires { health: true }');
      return { status: 200, headers: { 'content-length': '0' }, body: (async function* () { signal.throwIfAborted(); })() };
    }
    if (isTokenCount(request.raw.method, request.raw.path)) {
      if (!Number.isSafeInteger(response.inputTokens) || response.inputTokens! < 0)
        throw new TypeError('Anthropic count_tokens requires a nonnegative safe integer inputTokens');
      return encoded(json({ input_tokens: response.inputTokens }), signal, false);
    }
    if (response.health !== undefined || response.inputTokens !== undefined)
      throw new TypeError('Anthropic auxiliary responses require their exact endpoint');
    return encoded(body(request, response, signal), signal, request.stream);
  },
} satisfies ProviderCodec);
