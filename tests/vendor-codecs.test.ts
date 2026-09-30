import { expect, test } from 'bun:test';
import { museCode } from '../src/provider/muse-code.js';
import { grokBuild } from '../src/provider/grok-build.js';
import type { CapturedRequest, ProviderCodec, ScriptedResponse } from '../src/provider/types.js';
const capture = (codec: ProviderCodec, method: string, path: string, body = ''): CapturedRequest => {
  const raw = { method, path, body, headers: {} };
  return { id: 'test', timestamp: 0, raw, ...codec.decode(raw) };
};
const consume = async (body: AsyncIterable<string | Uint8Array>) => {
  let text = ''; for await (const part of body) text += typeof part === 'string' ? part : new TextDecoder().decode(part); return text;
};
const signal = new AbortController().signal;
test('vendor auxiliary routes are exact and require explicit replies', async () => {
  for (const [codec, path, reply] of [[museCode, '/muse-code/models', { text: '{"data":[]}' }], [grokBuild, '/', { health: true }]] as const) {
    expect(codec.matches('GET', path)).toBe(true);
    for (const bad of [path+'?x=1', path+'unknown', '/login', '/models']) {
      expect(codec.matches('GET', bad)).toBe(false);
      expect(()=>codec.decode({method:'GET',path:bad,body:'',headers:{}})).toThrow();
    }
    expect(codec.matches('POST', path)).toBe(false);
    expect(()=>capture(codec,'GET',path,'{}')).toThrow();
    const request=capture(codec,'GET',path);
    expect(request.tools).toEqual([]);
    expect(JSON.parse(await consume(codec.encode(request,reply,signal).body))).toEqual(codec===museCode?{data:[]}:{ok:true});
    for (const response of [{toolCall:{id:'x',name:'read',input:{}}},{text:'[]'},{text:'hello'},{text:'{}',amazonQ:{telemetry:true}},{health:true,augmentModels:{defaultModel:'x'}}])
      expect(()=>codec.encode(request,response as ScriptedResponse,signal)).toThrow();
    const error=codec.encode(request,{error:{status:503,message:'explicit failure'}},signal);
    expect(error.status).toBe(503);expect(await consume(error.body)).toContain('explicit failure');
  }
});
test('vendor model routes preserve tools, results and native streaming codecs', async () => {
  const muse=capture(museCode,'POST','/v1/responses',JSON.stringify({model:'test',stream:true,input:[{type:'function_call_output',call_id:'read',output:'fixture-token'}],tools:[{type:'function',name:'read_file',parameters:{type:'object'}}]}));
  expect(muse.toolResults[0]?.text).toBe('fixture-token');
  expect(muse.tools[0]?.name).toBe('read_file');
  const wire=await consume(museCode.encode(muse,{toolCall:{id:'read',name:'read_file',input:{path:'fixture.txt'}}},signal).body);
  expect(wire).toContain('response.completed');expect(wire).toContain('read_file');
  const grok=capture(grokBuild,'POST','/v1/chat/completions',JSON.stringify({model:'test',stream:true,messages:[{role:'tool',tool_call_id:'read',content:'fixture-token'}],tools:[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}]}));
  expect(grok.toolResults[0]?.text).toBe('fixture-token');
  const chat=await consume(grokBuild.encode(grok,{text:'controlled'},signal).body);
  expect(chat).toContain('controlled');expect(chat).toContain('[DONE]');
});

test('Responses preserves same-named functions in different namespaces and emits namespace on every tool item', async () => {
  const request=capture(museCode,'POST','/v1/responses',JSON.stringify({model:'test',stream:true,input:'read',tools:[
    {type:'namespace',name:'muse',tools:[{type:'function',name:'read_file',parameters:{type:'object'}}]},
    {type:'namespace',name:'other',tools:[{type:'function',name:'read_file',parameters:{type:'object'}}]},
  ]}));
  expect(request.tools.map(t=>[t.namespace,t.name])).toEqual([['muse','read_file'],['other','read_file']]);
  const call={id:'read',name:'read_file',namespace:'muse',input:{path:'fixture.txt'}};
  const wire=await consume(museCode.encode(request,{toolCall:call},signal).body);
  const frames=wire.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  for (const frame of frames.filter(f=>f.item?.type==='function_call')) expect(frame.item.namespace).toBe('muse');
  expect(frames.at(-1).response.output[0].namespace).toBe('muse');
  const nonstream={...request,stream:false};
  expect(JSON.parse(await consume(museCode.encode(nonstream,{toolCall:call},signal).body)).output[0].namespace).toBe('muse');
  await expect(consume(museCode.encode(request,{toolCall:{...call,namespace:''}},signal).body)).rejects.toThrow('namespace');
});

test('non-Responses codecs reject namespace instead of silently selecting an unnamespaced tool', async () => {
  const { getCodec } = await import('../src/provider/index.js');
  const cases = [
    ['anthropic-messages','/v1/messages',{model:'test',messages:[]}],
    ['openai-chat-completions','/v1/chat/completions',{model:'test',messages:[]}],
    ['google-genai','/v1beta/models/test:generateContent',{contents:[]}],
  ] as const;
  for (const [id,path,body] of cases) for (const stream of [false,true]) {
    const codec=getCodec(id);
    const request=capture(codec,'POST',path,JSON.stringify({...body,stream}));
    request.stream=stream;
    const call={id:'read',name:'read_file',namespace:'muse',input:{path:'fixture.txt'}};
    await expect(consume(codec.encode(request,{toolCall:call},signal).body)).rejects.toThrow('namespaces require');
    await expect(consume(codec.encode(request,{stream:(async function*(){yield {toolCall:call};})()},signal).body)).rejects.toThrow('namespaces require');
  }
});
