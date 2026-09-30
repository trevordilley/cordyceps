import { expect, test } from 'bun:test';
import { augment as codec } from '../src/provider/augment.js';
import type { CapturedRequest, EncodedResponse } from '../src/provider/types.js';
const raw = (body: unknown, path = '/chat-stream') => ({ method: 'POST', path, headers: {}, body: JSON.stringify(body) });
const request = (path = '/chat-stream'): CapturedRequest => { const wire = raw({ model: 'test' },path); return { ...codec.decode(wire), raw: wire, id: 'test', timestamp: 1 }; };
const signal = () => new AbortController().signal;
async function read(response: EncodedResponse) { let text = ''; for await (const c of response.body) text += c; return text; }
test('Augment decodes native current/history text, tool schemas and actual tool results, retaining opaque nodes', () => {
  const body = { model: '', third_party_override: { provider_model_name: 'override' }, message: 'prompt', system_prompt: 'system',
    chat_history: [{ request_message: 'old', response_text: 'answer', request_nodes: [{ type: 1, tool_result_node: { tool_use_id: 'old', content: 'failed', is_error: true } }] }],
    nodes: [{ type: 0, text_node: { content: 'node text' } }, { type: 1, tool_result_node: { tool_use_id: 'read', content: 'fixture', is_error: false } }, { type: 4, ide_state_node: { content: 'opaque' } }],
    tool_definitions: [{ name: 'view', input_schema_json: '{"type":"object"}' }] };
  const decoded = codec.decode(raw(body));
  expect(decoded.model).toBe('override'); expect(decoded.stream).toBe(true);
  expect(decoded.text).toBe('system\nold\nanswer\nprompt\nnode text');
  expect(decoded.toolResults.map(r=>[r.id,r.text,r.isError])).toEqual([['old','failed',true],['read','fixture',false]]);
  expect(decoded.tools[0]?.inputSchema).toEqual({type:'object'});expect(decoded.body).toEqual(body);
});
test('Augment restricts paths, validates body/model/arrays and parses schema JSON', () => {
  expect(codec.matches('POST','/chat-stream?x=1')).toBe(true);
  for(const path of ['/chat','/v1/messages','/arbitrary','/report-error'])expect(codec.matches('POST',path)).toBe(false);
  expect(codec.matches('GET','/chat-stream')).toBe(false);
  expect(()=>codec.decode(raw([]))).toThrow('JSON object');expect(()=>codec.decode(raw({}))).toThrow('model');
  expect(()=>codec.decode(raw({model:'test',nodes:{}}))).toThrow('array');
  expect(()=>codec.decode(raw({model:'test',tool_definitions:[{name:'view',input_schema_json:'no'}]}))).toThrow();
});
test('Augment emits incremental NDJSON, native tool nodes and exactly one terminal reason', async () => {
  const output=codec.encode(request(),{stream:(async function*(){yield {text:'one'};yield {text:'two'};yield {toolCall:{id:'call',name:'view',input:{path:'fixture.txt'}}};})()},signal());
  expect(output.headers['content-type']).toContain('application/x-ndjson');
  const rows=(await read(output)).trim().split('\n').map(s=>JSON.parse(s));
  expect(rows).toEqual([{text:'one',nodes:[{id:0,type:0,content:'one'}]},{text:'two',nodes:[{id:1,type:0,content:'two'}]},{text:'',nodes:[{id:2,type:5,content:'',tool_use:{tool_use_id:'call',tool_name:'view',input_json:'{"path":"fixture.txt"}'}}]},{text:'',stop_reason:'TOOL_USE_REQUESTED'}]);
  expect((await read(codec.encode(request(),{text:'done'},signal()))).trim().split('\n').map(s=>JSON.parse(s))).toEqual([{text:'done',nodes:[{id:0,type:0,content:'done'}]},{text:'',stop_reason:'END_TURN'}]);
});
test('Augment auxiliary requests are captured but only explicitly scripted errors are supported', async () => {
  for(const path of ['/get-models','/settings/get-mcp-tenant-configs','/settings/get-mcp-user-configs','/agents/list-remote-tools']) {
    expect(codec.matches('POST',path)).toBe(true);expect(codec.decode(raw({},path)).stream).toBe(false);
    const response=codec.encode(request(path),{error:{status:404,message:'unavailable'}},signal());
    expect(response.status).toBe(404);expect(JSON.parse(await read(response))).toEqual({error:'unavailable'});
    expect(()=>codec.encode(request(path),{text:'no'},signal())).toThrow('explicit');
  }
  expect(()=>codec.encode(request(),{health:true},signal())).toThrow();
  expect(()=>codec.encode(request(),{error:{status:200,message:'bad'}},signal())).toThrow();
});
test('Augment abort and source errors never emit a successful terminal frame', async () => {
  const controller=new AbortController();
  const iterator=codec.encode(request(),{stream:(async function*(){yield {text:'partial'};yield {text:'never'};})()},controller.signal).body[Symbol.asyncIterator]();
  expect(String((await iterator.next()).value)).toContain('partial');controller.abort();await expect(iterator.next()).rejects.toThrow();
  const broken=codec.encode(request(),{stream:(async function*(){yield {text:'partial'};throw new Error('source failed');})()},signal()).body[Symbol.asyncIterator]();
  await broken.next();await expect(broken.next()).rejects.toThrow('source failed');
});
test('Augment model bootstrap is explicit, endpoint-specific, and rejects other provider auxiliary replies', async () => {
  const response = codec.encode(request('/get-models'), { augmentModels: { defaultModel: 'test' } }, signal());
  expect(response.status).toBe(200);
  expect(JSON.parse(await read(response))).toEqual({default_model:'test',models:[],languages:[]});
  expect(()=>codec.encode(request(),{augmentModels:{defaultModel:'test'}},signal())).toThrow('/get-models');
  expect(()=>codec.encode(request(),{amazonQ:{telemetry:true}},signal())).toThrow('Amazon Q');
});

test('Augment startup and chat use shared capture/failure lifecycle without automatic replies', async () => {
  const { createRegistry, prepare } = await import('../src/index.js');
  const registry=createRegistry({builtins:false});
  registry.register({schemaVersion:1,id:'auggie-test',provider:{adapter:'augment',override:{}},modes:{interactive:{}}});
  const ai=await prepare({harness:'auggie-test',registry});
  try {
    ai.route(r=>r.raw.path==='/get-models',route=>route.fulfill({augmentModels:{defaultModel:'test'}}));
    const response=await fetch(ai.baseUrl+'/get-models',{method:'POST',body:'{}'});
    expect(await response.json()).toEqual({default_model:'test',models:[],languages:[]});
    expect(ai.requests[0]?.raw.path).toBe('/get-models');ai.assertHealthy();
    const unhandled=await fetch(ai.baseUrl+'/settings/get-mcp-user-configs',{method:'POST',body:'{}'});
    await unhandled.text();expect(ai.requests).toHaveLength(2);expect(()=>ai.assertHealthy()).toThrow();
  } finally {await ai.dispose();}
});
test('other codecs reject Augment bootstrap replies rather than treating them as generation or health', async () => {
  const {getCodec}=await import('../src/provider/index.js');
  for(const id of ['anthropic-messages','openai-responses','openai-chat-completions','google-genai','amazon-q']) {
    expect(()=>getCodec(id).encode(request(),{augmentModels:{defaultModel:'test'}},signal())).toThrow('Augment');
  }
});
