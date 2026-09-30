import type { CapturedRequest, ProviderCodec, ProviderEvent, ScriptedResponse, ToolDefinition, ToolResult } from './types.js';
import { array, collect, encoded, errorStatus, events, json, object, wireId } from './common.js';

// Gemini Developer API only; Vertex project/location paths are deliberately separate.
function endpoint(path: string) {
  return /^\/(?:v1beta|v1)\/models\/([^/:?]+):(generateContent|streamGenerateContent)$/.exec(path.split('?')[0]!);
}
function part(event: ProviderEvent) {
  return 'text' in event ? { text: event.text }
    : { functionCall: { id: event.toolCall.id, name: event.toolCall.name, args: event.toolCall.input } };
}
function chunk(request: CapturedRequest, id: string, parts: unknown[], done: boolean) {
  return { candidates: [{ index: 0, content: { role: 'model', parts }, ...(done ? { finishReason: 'STOP' } : {}) }],
    modelVersion: request.model, responseId: id,
    ...(done ? { usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 } } : {}) };
}
async function* body(request: CapturedRequest, response: ScriptedResponse, signal: AbortSignal): AsyncGenerator<string> {
  const id = wireId('gen');
  if (!request.stream) {
    yield JSON.stringify(chunk(request, id, (await collect(response, signal)).map(part), true));
    return;
  }
  for await (const value of events(response, signal)) yield `data: ${JSON.stringify(chunk(request, id, [part(value)], false))}\n\n`;
  yield `data: ${JSON.stringify(chunk(request, id, [], true))}\n\n`;
}
export const googleGenai: ProviderCodec = Object.freeze({
  id: 'google-genai',
  matches: (method: string, path: string) => method.toUpperCase() === 'POST' && endpoint(path) !== null,
  decode(raw) {
    const match = endpoint(raw.path);
    if (!match) throw new TypeError('Unsupported Google GenAI endpoint');
    const body: unknown = JSON.parse(raw.body);
    if (!object(body)) throw new TypeError('Google GenAI request must be a JSON object');
    const stream = match[2] === 'streamGenerateContent';
    if (stream && new URLSearchParams(raw.path.split('?')[1]).get('alt') !== 'sse')
      throw new TypeError('Google GenAI streaming requires alt=sse');
    const text: string[] = [], tools: ToolDefinition[] = [], toolResults: ToolResult[] = [];
    for (const content of [body.systemInstruction, ...array(body.contents, 'contents')]) {
      if (!object(content)) continue;
      for (const value of array(content.parts, 'parts')) {
        if (!object(value)) continue;
        if (typeof value.text === 'string' && value.thought !== true) text.push(value.text);
        const result = value.functionResponse;
        if (object(result) && typeof result.name === 'string') {
          // Older Gemini clients omit call IDs; retain the function name rather than inventing an ID.
          toolResults.push({ id: typeof result.id === 'string' ? result.id : result.name,
            text: typeof result.response === 'string' ? result.response : JSON.stringify(result.response) ?? '',
            isError: object(result.response) && result.response.error !== undefined, raw: value });
        }
      }
    }
    for (const tool of array(body.tools, 'tools')) {
      if (!object(tool)) continue;
      for (const declaration of array(tool.functionDeclarations, 'functionDeclarations')) {
        if (object(declaration) && typeof declaration.name === 'string') tools.push({ name: declaration.name,
          inputSchema: declaration.parametersJsonSchema ?? declaration.parameters ?? {}, raw: declaration });
      }
    }
    return { model: decodeURIComponent(match[1]!), stream, text: text.join('\n'), tools, toolResults, body };
  },
  encode(request, response, signal) {
    if (response.amazonQ !== undefined) throw new TypeError('Amazon Q auxiliary response requires the Amazon Q codec');
    if (response.augmentModels !== undefined) throw new TypeError('Augment model replies are only supported by the Augment codec');
    if (response.error !== undefined) {
      const { status, message, type } = response.error;
      const defaults: Record<number, string> = { 400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 429: 'RESOURCE_EXHAUSTED', 500: 'INTERNAL', 503: 'UNAVAILABLE' };
      return encoded(json({ error: { code: status, message, status: type ?? defaults[status] ?? 'UNKNOWN' } }), signal, false, errorStatus(response.error));
    }
    if (response.health !== undefined || response.inputTokens !== undefined) throw new TypeError('Google GenAI generation requires text, tools, or a stream');
    return encoded(body(request, response, signal), signal, request.stream);
  },
} satisfies ProviderCodec);
