import type { CapturedRequest, ProviderCodec, ProviderEvent, ScriptedResponse, ToolDefinition, ToolResult } from './types.js';
import { array, collect, encoded, errorStatus, events, json, matchesPath, object, parseRequest, sse, textContent, wireId } from './common.js';

interface TextPart { type: 'output_text'; text: string; annotations: unknown[]; logprobs: unknown[] }
interface MessageItem { id: string; type: 'message'; role: 'assistant'; status: 'in_progress' | 'completed'; content: TextPart[] }
interface FunctionItem { id: string; type: 'function_call'; call_id: string; name: string; arguments: string; status: 'completed' }
type OutputItem = MessageItem | FunctionItem;

function part(text: string): TextPart {
  return { type: 'output_text', text, annotations: [], logprobs: [] };
}

function item(event: ProviderEvent): OutputItem {
  return 'text' in event
    ? { id: wireId('msg'), type: 'message', role: 'assistant', status: 'completed', content: [part(event.text)] }
    : { id: wireId('fc'), type: 'function_call', call_id: event.toolCall.id, name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.input), status: 'completed' };
}

function envelope(request: CapturedRequest, id: string, created: number, output: OutputItem[], status: 'in_progress' | 'completed') {
  const body = object(request.body) ? request.body : {};
  return {
    id, object: 'response', created_at: created, status, completed_at: status === 'completed' ? Math.floor(Date.now() / 1000) : null,
    error: null, incomplete_details: null, model: request.model, output,
    instructions: body.instructions ?? null, max_output_tokens: body.max_output_tokens ?? null,
    parallel_tool_calls: body.parallel_tool_calls ?? true, previous_response_id: body.previous_response_id ?? null,
    reasoning: body.reasoning ?? { effort: null, summary: null }, store: false,
    temperature: body.temperature ?? 1, text: body.text ?? { format: { type: 'text' } },
    tool_choice: body.tool_choice ?? 'auto', tools: body.tools ?? [], top_p: body.top_p ?? 1,
    truncation: body.truncation ?? 'disabled', metadata: body.metadata ?? {},
    usage: status === 'completed' ? { input_tokens: 0, output_tokens: 0, total_tokens: 0,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } : null,
  };
}

async function* body(request: CapturedRequest, response: ScriptedResponse, signal: AbortSignal): AsyncGenerator<string> {
  const id = wireId('resp');
  const created = Math.floor(Date.now() / 1000);
  if (!request.stream) {
    yield JSON.stringify(envelope(request, id, created, (await collect(response, signal)).map(item), 'completed'));
    return;
  }
  let sequence = 0;
  const frame = (type: string, fields: Record<string, unknown>) => sse(type, { ...fields, sequence_number: sequence++ });
  const output: OutputItem[] = [];
  let active: MessageItem | undefined;
  let activeText = '';
  // Called only when text ends: no next() lookahead is needed to deliver a delta.
  function* finishText(): Generator<string> {
    if (!active) return;
    const position = { item_id: active.id, output_index: output.length, content_index: 0 };
    active.status = 'completed';
    active.content = [part(activeText)];
    yield frame('response.output_text.done', { ...position, text: activeText, logprobs: [] });
    yield frame('response.content_part.done', { ...position, part: active.content[0] });
    yield frame('response.output_item.done', { output_index: output.length, item: active });
    output.push(active);
    active = undefined;
    activeText = '';
  }
  yield frame('response.created', { response: envelope(request, id, created, [], 'in_progress') });
  yield frame('response.in_progress', { response: envelope(request, id, created, [], 'in_progress') });
  for await (const value of events(response, signal)) {
    if ('text' in value) {
      if (!active) {
        active = { id: wireId('msg'), type: 'message', role: 'assistant', status: 'in_progress', content: [] };
        yield frame('response.output_item.added', { output_index: output.length, item: active });
        yield frame('response.content_part.added', { item_id: active.id, output_index: output.length, content_index: 0, part: part('') });
      }
      activeText += value.text;
      yield frame('response.output_text.delta', { item_id: active.id, output_index: output.length, content_index: 0, delta: value.text, logprobs: [] });
    } else {
      yield* finishText();
      const call = item(value) as FunctionItem;
      const position = { item_id: call.id, output_index: output.length };
      yield frame('response.output_item.added', { output_index: output.length, item: { ...call, arguments: '', status: 'in_progress' } });
      yield frame('response.function_call_arguments.delta', { ...position, delta: call.arguments });
      yield frame('response.function_call_arguments.done', { ...position, arguments: call.arguments });
      yield frame('response.output_item.done', { output_index: output.length, item: call });
      output.push(call);
    }
  }
  yield* finishText();
  yield frame('response.completed', { response: envelope(request, id, created, output, 'completed') });
}

export const openaiResponses: ProviderCodec = Object.freeze({
  id: 'openai-responses',
  matches: (method: string, path: string) => matchesPath(method, path, '/v1/responses'),
  decode(raw) {
    const body = parseRequest(raw);
    const text = textContent(body.instructions, ['input_text']);
    const tools: ToolDefinition[] = [];
    const toolResults: ToolResult[] = [];
    if (typeof body.input === 'string') text.push(body.input);
    else for (const input of array(body.input, 'input')) {
      if (!object(input)) continue;
      if (input.type === 'function_call_output' && typeof input.call_id === 'string') {
        // Responses has no standard is_error flag; never infer errors from output prose.
        toolResults.push({ id: input.call_id, text: textContent(input.output, ['input_text']).join('\n'), isError: false, raw: input });
      } else if (input.type === 'message' || (input.type === undefined && typeof input.role === 'string')) {
        text.push(...textContent(input.content, ['input_text', 'output_text']));
      }
    }
    for (const tool of array(body.tools, 'tools')) {
      if (object(tool) && tool.type === 'function' && typeof tool.name === 'string') {
        tools.push({ name: tool.name, inputSchema: tool.parameters ?? null, raw: tool });
      }
    }
    return { model: body.model, stream: body.stream === true, text: text.join('\n'), tools, toolResults, body };
  },
  encode(request, response, signal) {
    if (response.amazonQ !== undefined) throw new TypeError('Amazon Q auxiliary response requires the Amazon Q codec');
    if (response.health !== undefined || response.inputTokens !== undefined)
      throw new TypeError('OpenAI Responses does not support Anthropic auxiliary responses');
    if (response.error !== undefined) {
      const { status, message, type } = response.error;
      const result = encoded(json({ error: { message, type: type ?? (status === 429 ? 'rate_limit_error' : status >= 500 ? 'server_error' : 'invalid_request_error'), param: null, code: null } }), signal, false, errorStatus(response.error));
      result.headers['x-request-id'] = wireId('req');
      return result;
    }
    return encoded(body(request, response, signal), signal, request.stream);
  },
} satisfies ProviderCodec);
