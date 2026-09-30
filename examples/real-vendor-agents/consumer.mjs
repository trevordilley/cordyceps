import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {prepare,createRegistry} from 'cordyceps';
import {isolated} from './isolation.mjs';
const [output,selection,artifactJSON]=process.argv.slice(2);
const binRoot=process.env.CORDYCEPS_VENDOR_BIN_DIR||'/tmp/cordyceps-vendor-investigation';
const binaries={'grok-build':binRoot+'/grok/grok',fx:binRoot+'/fx/fx',ante:binRoot+'/ante/ante',muse:binRoot+'/muse',minimax:binRoot+'/minimax/node_modules/.bin/mcode'};
const evidence={date:new Date().toISOString(),artifact:JSON.parse(artifactJSON),packageEntry:import.meta.resolve('cordyceps'),node:process.version,cases:[]};
for(const harness of selection.split(','))for(const scenario of ['text','tool']) {
 const record={harness,scenario,passed:false};evidence.cases.push(record);
 await isolated(async({work,env,launch})=>{
  let ai;
  try {
   const token='fixture-'+randomUUID(),fixture=join(work,'fixture.txt');await writeFile(fixture,token+'\n');
   record.fixtureToken=token;
   const marker=`CORDYCEPS_${harness}_${scenario}_OK`,prompt=`cordyceps-${harness}-${scenario}: ${scenario==='tool'?'Read fixture.txt with your file reading tool, then finish.':'Return the controlled reply and finish.'}`;
   record.prompt=prompt;record.marker=marker;
   const registry=createRegistry({builtins:false});await registry.loadFile(join(process.cwd(),harness+'.json'));
   ai=await prepare({harness,mode:'nonInteractive',registry});
   let issued=false,returned=false;
   ai.route(()=>true,async route=>{
    assert.ok(ai.requests.length<=30,'unexpected provider retry');
    if(route.request.raw.path.startsWith('/v1/messages/count_tokens'))return route.fulfill({inputTokens:100});
    if(harness==='grok-build'&&route.request.raw.path==='/')return route.fulfill({health:true});
    if(harness==='muse'&&route.request.raw.path==='/muse-code/models')return route.fulfill({text:JSON.stringify({object:'list',data:[{id:'muse-spark-1.3',object:'model',created:0,owned_by:'meta',metadata:{'muse-code':{name:'Fixture model',family:'muse',attachment:false,reasoning:false,tool_call:true,modalities:{input:['text'],output:['text']},limit:{context:32768,output:2048},options:{},cost:{input:0,output:0,cached:0,currency:'USD'}}}}]})});
    const observer=route.request.tools.find(t=>t.name==='submit_reminder_decision');
    if(harness==='muse'&&observer){
      const input=Object.fromEntries(Object.keys(observer.inputSchema.properties).map(k=>[k,null]));
      input.decision='none';input.reason='Controlled test observer response.';
      return route.fulfill({toolCall:{id:'observer_'+ai.requests.length,name:observer.name,namespace:observer.namespace,input}});
    }
    if(scenario==='tool'&&!issued){
     assert.ok(!route.request.raw.body.includes(token),'fixture leaked initially');
     issued=true;
     record.offeredTools=route.request.tools;
     let name,args;
     if(harness==='ante'){name='Read';args={file_path:fixture};}
     else if(harness==='fx'){name='read_file';args={path:fixture};}
     else if(harness==='grok-build'){name='read_file';args={target_file:fixture};}
     else if(harness==='muse'){name='read_file';args={path:fixture};}
     else {name='read';args={path:fixture};}
     const offered=route.request.tools.find(t=>t.name===name);
     assert.ok(offered,'requested read tool was not offered by real harness');
     return route.fulfill({toolCall:{id:'read_fixture',name,...(offered.namespace?{namespace:offered.namespace}:{}),input:args}});
    }
    if(scenario==='tool'){assert.ok(route.request.toolResults.some(result=>result.text.includes(token)),'real fixture token missing from native tool result in next provider request');returned=true;}
    return route.fulfill({text:marker});
   });
   const extra=ai.environment(env);const writable=[...new Set(ai.configFiles.map(f=>dirname(f.path)))];
   if(extra.HOME!==env.HOME)writable.push(extra.HOME);
   if(extra.ANTE_HOME)writable.push(extra.ANTE_HOME);
   if(extra.GROK_HOME)writable.push(extra.GROK_HOME);
   record.version=await launch(binaries[harness],['--version'],extra,writable);
   ai.recordInput(prompt);record.process=await launch(binaries[harness],[...ai.args,prompt],extra,writable,45000);
   record.requests=ai.requests;record.responses=ai.responses;record.failures=ai.failures.map(f=>String(f.error));
   ai.assertHealthy();assert.equal(record.process.timedOut,false);assert.equal(record.process.code,0,record.process.stderr);
   assert.ok(record.process.stdout.includes(marker),record.process.stdout);
   assert.ok(ai.requests.some(r=>r.text.includes(prompt)),'prompt absent from captured provider requests');
   assert.ok(!ai.requests.find(r=>r.raw.method==='POST').raw.body.includes(token));
   if(scenario==='tool')assert.ok(issued&&returned);
   record.assertions={promptCaptured:true,controlledNativeOutput:true,fixtureAbsentInitially:true,realToolRoundTrip:scenario==='tool'?issued&&returned:null,providerHealthy:true,processExited:true};
   record.passed=true;
  }catch(e){record.error=String(e.stack??e);if(ai){record.requests=ai.requests;record.failures=ai.failures.map(f=>String(f.error));}}
  finally {if(ai){await ai.dispose();await assert.rejects(fetch(ai.baseUrl));for(const f of ai.configFiles)await assert.rejects(access(f.path));}}
 });
 record.cleanedUp=true;await writeFile(output,JSON.stringify(evidence,null,2)+'\n');console.log(harness,scenario,record.passed?'PASS':record.error);
}
assert.ok(evidence.cases.every(c=>c.passed),`See ${output}`);
