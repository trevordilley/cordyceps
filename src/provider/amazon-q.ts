import { array, encoded, errorStatus, events, guarded, json, object } from './common.js';
import type { CapturedRequest, ProviderCodec, RawHttpRequest, ScriptedResponse, ToolDefinition, ToolResult } from './types.js';

const generate = 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse';
const models = 'AmazonCodeWhispererService.ListAvailableModels';
const telemetry = 'AmazonCodeWhispererService.SendTelemetryEvent';
function operation(raw: RawHttpRequest): string {
  const target = Object.entries(raw.headers).find(([key]) => key.toLowerCase() === 'x-amz-target')?.[1];
  if (typeof target !== 'string' || ![generate, models, telemetry].includes(target)) {
    throw new TypeError('Unsupported Amazon Q X-Amz-Target');
  }
  return target;
}

// AWS event-stream uses network-order lengths and IEEE CRC32 for both prelude and message.
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function frame(type: string, payload: unknown): Uint8Array {
  const headers = Buffer.concat(Object.entries({ ':message-type': 'event', ':event-type': type, ':content-type': 'application/json' }).map(([key, value]) => {
    const name = Buffer.from(key), content = Buffer.from(value);
    const header = Buffer.alloc(1 + name.length + 1 + 2 + content.length);
    header[0] = name.length; name.copy(header, 1); header[1 + name.length] = 7;
    header.writeUInt16BE(content.length, 2 + name.length); content.copy(header, 4 + name.length);
    return header;
  }));
  const content = Buffer.from(JSON.stringify(payload));
  const result = Buffer.alloc(16 + headers.length + content.length);
  result.writeUInt32BE(result.length, 0); result.writeUInt32BE(headers.length, 4);
  result.writeUInt32BE(crc32(result.subarray(0, 8)), 8);
  headers.copy(result, 12); content.copy(result, 12 + headers.length);
  result.writeUInt32BE(crc32(result.subarray(0, -4)), result.length - 4);
  return result;
}

export const amazonQ: ProviderCodec = Object.freeze({
  id: 'amazon-q',
  matches(method: string, path: string) { return method.toUpperCase() === 'POST' && path.split('?')[0] === '/'; },
  decode(raw: RawHttpRequest) {
    const target = operation(raw);
    const body: unknown = JSON.parse(raw.body);
    if (!object(body)) throw new TypeError('Amazon Q request must be a JSON object');
    if (target !== generate) return { model: '', stream: false, text: '', tools: [], toolResults: [], body };
    const state = body.conversationState;
    if (!object(state) || !object(state.currentMessage) || !object(state.currentMessage.userInputMessage)) {
      throw new TypeError('Amazon Q requires conversationState.currentMessage.userInputMessage');
    }
    const current = state.currentMessage.userInputMessage;
    if (current.modelId !== undefined && typeof current.modelId !== 'string') throw new TypeError('Amazon Q modelId must be a string');
    const text: string[] = [], tools: ToolDefinition[] = [], toolResults: ToolResult[] = [];
    for (const message of [...array(state.history, 'history'), state.currentMessage]) {
      if (!object(message)) continue;
      const input = message.userInputMessage, assistant = message.assistantResponseMessage;
      for (const value of [input, assistant]) if (object(value) && typeof value.content === 'string') text.push(value.content);
      if (!object(input) || input.userInputMessageContext === undefined) continue;
      const context = input.userInputMessageContext;
      if (!object(context)) throw new TypeError('userInputMessageContext must be an object');
      if (input === current) for (const tool of array(context.tools, 'tools')) {
        if (object(tool) && object(tool.toolSpecification) && typeof tool.toolSpecification.name === 'string') {
          const spec = tool.toolSpecification;
          tools.push({ name: spec.name as string, inputSchema: object(spec.inputSchema) ? spec.inputSchema.json : undefined, raw: tool });
        }
      }
      for (const result of array(context.toolResults, 'toolResults')) {
        if (!object(result) || typeof result.toolUseId !== 'string') continue;
        const content = array(result.content, 'tool result content');
        toolResults.push({ id: result.toolUseId, text: content.flatMap(part => object(part) && typeof part.text === 'string' ? [part.text] : []).join('\n'), isError: result.status === 'error', raw: result });
      }
    }
    return { model: current.modelId ?? '', stream: true, text: text.join('\n'), tools, toolResults, body };
  },
  encode(request: CapturedRequest, response: ScriptedResponse, signal: AbortSignal) {
    if (response.augmentModels !== undefined) throw new TypeError('Augment model replies are not supported by the Amazon Q codec');
    const target = operation(request.raw);
    if (response.error !== undefined) {
      return encoded(json({ __type: response.error.type ?? 'InternalServerException', message: response.error.message }), signal, false, errorStatus(response.error));
    }
    if (target !== generate) {
      const auxiliary = response.amazonQ;
      if (!auxiliary || (target === models ? !Array.isArray(auxiliary.models) || auxiliary.telemetry !== undefined : auxiliary.telemetry !== true || auxiliary.models !== undefined)) {
        throw new TypeError('Amazon Q auxiliary operation requires its explicit amazonQ response');
      }
      if (target === models) for (const model of auxiliary.models!) {
        if (!object(model) || typeof model.modelId !== 'string' || !model.modelId || typeof model.modelName !== 'string' || !model.modelName || (model.description !== undefined && typeof model.description !== 'string')) throw new TypeError('Invalid Amazon Q model');
      }
      return encoded(json(target === models ? { models: auxiliary.models } : {}), signal, false);
    }
    if (response.amazonQ !== undefined || response.health !== undefined || response.inputTokens !== undefined) throw new TypeError('Amazon Q generation requires text, toolCall, stream or error');
    async function* body() {
      for await (const value of events(response, signal)) {
        if ('text' in value) yield frame('assistantResponseEvent', { content: value.text });
        else {
          const call = value.toolCall;
          yield frame('toolUseEvent', { toolUseId: call.id, name: call.name });
          yield frame('toolUseEvent', { toolUseId: call.id, name: call.name, input: JSON.stringify(call.input) });
          yield frame('toolUseEvent', { toolUseId: call.id, name: call.name, stop: true });
        }
      }
      // This protocol terminates at HTTP EOF, without an SSE sentinel or invented stop event.
    }
    return { status: 200, headers: { 'content-type': 'application/vnd.amazon.eventstream' }, body: guarded(body(), signal) };
  },
});
