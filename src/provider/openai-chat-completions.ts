import type { CapturedRequest, ProviderCodec, ScriptedResponse, ToolDefinition, ToolResult } from './types.js';
import { array, collect, encoded, errorStatus, events, json, matchesPath, object, parseRequest, textContent, wireId } from './common.js';

const usage = () => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });

async function* body(request: CapturedRequest, response: ScriptedResponse, signal: AbortSignal): AsyncGenerator<string> {
  const identity = { id: wireId('chatcmpl'), created: Math.floor(Date.now() / 1000), model: request.model };
  if (!request.stream) {
    let content = '';
    let hasText = false;
    const toolCalls = [];
    for (const event of await collect(response, signal)) {
      if ('text' in event) { content += event.text; hasText = true; }
      else toolCalls.push({ id: event.toolCall.id, type: 'function', function: {
        name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.input),
      } });
    }
    yield JSON.stringify({ ...identity, object: 'chat.completion', choices: [{ index: 0,
      message: { role: 'assistant', content: hasText ? content : null, refusal: null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop', logprobs: null,
    }], usage: usage() });
    return;
  }
  const frame = (delta: unknown, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ ...identity, object: 'chat.completion.chunk', choices: [
      { index: 0, delta, finish_reason, logprobs: null },
    ] })}\n\n`;
  yield frame({ role: 'assistant', content: '' });
  let toolIndex = 0;
  for await (const event of events(response, signal)) {
    if ('text' in event) yield frame({ content: event.text });
    else {
      const { id, name, input } = event.toolCall;
      yield frame({ tool_calls: [{ index: toolIndex, id, type: 'function', function: { name, arguments: '' } }] });
      yield frame({ tool_calls: [{ index: toolIndex++, function: { arguments: JSON.stringify(input) } }] });
    }
  }
  yield frame({}, toolIndex ? 'tool_calls' : 'stop');
  const input = object(request.body) ? request.body : {};
  if (object(input.stream_options) && input.stream_options.include_usage === true) {
    yield `data: ${JSON.stringify({ ...identity, object: 'chat.completion.chunk', choices: [], usage: usage() })}\n\n`;
  }
  yield 'data: [DONE]\n\n';
}

export const openaiChatCompletions: ProviderCodec = Object.freeze({
  id: 'openai-chat-completions',
  matches: (method: string, path: string) => matchesPath(method, path, '/v1/chat/completions'),
  decode(raw) {
    const body = parseRequest(raw);
    const text: string[] = [];
    const tools: ToolDefinition[] = [];
    const toolResults: ToolResult[] = [];
    for (const message of array(body.messages, 'messages')) {
      if (!object(message)) continue;
      if (message.role === 'tool' && typeof message.tool_call_id === 'string') {
        toolResults.push({ id: message.tool_call_id, text: textContent(message.content, ['text']).join('\n'), isError: false, raw: message });
      } else if (['system', 'developer', 'user', 'assistant'].includes(String(message.role))) {
        text.push(...textContent(message.content, ['text']));
      }
    }
    for (const tool of array(body.tools, 'tools')) {
      if (object(tool) && tool.type === 'function' && object(tool.function) && typeof tool.function.name === 'string') {
        tools.push({ name: tool.function.name, inputSchema: tool.function.parameters ?? null, raw: tool });
      }
    }
    return { model: body.model, stream: body.stream === true, text: text.join('\n'), tools, toolResults, body };
  },
  encode(request, response, signal) {
    if (response.amazonQ !== undefined) throw new TypeError('Amazon Q auxiliary response requires the Amazon Q codec');
    if (response.augmentModels !== undefined) throw new TypeError('Augment model replies are only supported by the Augment codec');
    if (response.health !== undefined || response.inputTokens !== undefined)
      throw new TypeError('Chat Completions does not support Anthropic auxiliary responses');
    if (response.error !== undefined) {
      const { status, message, type } = response.error;
      return encoded(json({ error: { message, type: type ?? (status === 429 ? 'rate_limit_error' : status >= 500 ? 'server_error' : 'invalid_request_error'), param: null, code: null } }), signal, false, errorStatus(response.error));
    }
    return encoded(body(request, response, signal), signal, request.stream);
  },
} satisfies ProviderCodec);
