import type { ProviderCodec, ScriptedResponse, ToolResult } from './types.js';
import { array, encoded, errorStatus, events, guarded, json, matchesPath, object } from './common.js';

const auxiliary = new Set(['/get-models', '/settings/get-mcp-tenant-configs', '/settings/get-mcp-user-configs', '/agents/list-remote-tools', '/find-missing']);

// Auggie's service protocol is NDJSON, not the third-party provider wire named in its override.
async function* body(response: ScriptedResponse, signal: AbortSignal): AsyncGenerator<string> {
  let id = 0, usedTool = false;
  for await (const event of events(response, signal)) {
    if ('text' in event) yield JSON.stringify({ text: event.text, nodes: [{ id: id++, type: 0, content: event.text }] }) + '\n';
    else {
      usedTool = true;
      yield JSON.stringify({ text: '', nodes: [{ id: id++, type: 5, content: '', tool_use: {
        tool_use_id: event.toolCall.id, tool_name: event.toolCall.name, input_json: JSON.stringify(event.toolCall.input),
      } }] }) + '\n';
    }
  }
  yield JSON.stringify({ text: '', stop_reason: usedTool ? 'TOOL_USE_REQUESTED' : 'END_TURN' }) + '\n';
}
export const augment: ProviderCodec = Object.freeze({
  id: 'augment',
  matches: (method: string, path: string) => matchesPath(method, path, '/chat-stream') || (method.toUpperCase() === 'POST' && auxiliary.has(path.split('?')[0]!)),
  decode(raw) {
    const body: unknown = JSON.parse(raw.body);
    if (!object(body)) throw new TypeError('Augment request must be a JSON object');
    if (auxiliary.has(raw.path.split('?')[0]!)) return { model: '', stream: false, text: '', tools: [], toolResults: [], body };
    const model = object(body.third_party_override) ? body.third_party_override.provider_model_name ?? body.model : body.model;
    if (typeof model !== 'string' || !model) throw new TypeError('Augment request requires a nonempty model or provider_model_name');
    const text: string[] = [], toolResults: ToolResult[] = [];
    const addText = (value: unknown) => { if (typeof value === 'string') text.push(value); };
    const nodes = (value: unknown) => {
      for (const node of array(value, 'nodes')) {
        if (!object(node)) continue;
        if (node.type === 0 && object(node.text_node)) addText(node.text_node.content);
        const result = node.tool_result_node;
        if (node.type === 1 && object(result) && typeof result.tool_use_id === 'string') {
          toolResults.push({ id: result.tool_use_id, text: typeof result.content === 'string' ? result.content : '',
            isError: result.is_error === true, raw: node });
        }
      }
    };
    addText(body.system_prompt); addText(body.system_prompt_append);
    for (const exchange of array(body.chat_history, 'chat_history')) {
      if (!object(exchange)) continue;
      addText(exchange.request_message); nodes(exchange.request_nodes); addText(exchange.response_text);
      for (const node of array(exchange.response_nodes, 'response_nodes')) if (object(node) && node.type === 0) addText(node.content);
    }
    addText(body.message); nodes(body.nodes);
    const tools = array(body.tool_definitions, 'tool_definitions').flatMap(tool => {
      if (!object(tool) || typeof tool.name !== 'string') return [];
      if (typeof tool.input_schema_json !== 'string') throw new TypeError('Augment tool input_schema_json must be a JSON string');
      return [{ name: tool.name, inputSchema: JSON.parse(tool.input_schema_json) as unknown, raw: tool }];
    });
    return { model, stream: true, text: text.join('\n'), tools, toolResults, body };
  },
  encode(request, response, signal) {
    if (response.amazonQ !== undefined) throw new TypeError('Amazon Q auxiliary replies are not supported by the Augment codec');
    if (response.error !== undefined) return encoded(json({ error: response.error.message }), signal, false, errorStatus(response.error));
    if (response.augmentModels !== undefined) {
      if (request.raw.path.split('?')[0] !== '/get-models' || typeof response.augmentModels.defaultModel !== 'string') throw new TypeError('augmentModels requires /get-models and a string defaultModel');
      return encoded(json({ default_model: response.augmentModels.defaultModel, models: [], languages: [] }), signal, false);
    }
    if (auxiliary.has(request.raw.path.split('?')[0]!)) throw new TypeError('Augment auxiliary endpoints require augmentModels on /get-models or an explicit scripted error');
    if (response.health !== undefined || response.inputTokens !== undefined) throw new TypeError('Augment chat requires text, tools, or a stream');
    return { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' }, body: guarded(body(response, signal), signal) };
  },
} satisfies ProviderCodec);
