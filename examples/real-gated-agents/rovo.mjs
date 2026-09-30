// Consumer for the same installed plugin that `acli rovodev` launches.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {cordyceps} from 'cordyceps';
import {isolated,binaries} from './probe.mjs';
binaries.rovo=process.env.CORDYCEPS_ROVO_BINARY||'/Users/20idemo/.local/share/acli/1.3.13-stable/plugin/rovodev/atlassian_cli_rovodev';
const report={node:process.version,date:new Date().toISOString(),packageEntry:import.meta.resolve('cordyceps'),artifact:JSON.parse(process.argv[3]),identity:'Installed Rovo Dev plugin behind acli rovodev; direct invocation isolates the wrapper account gate.',cases:[]};
const registry=cordyceps.createRegistry({builtins:false});await registry.loadFile('rovo-dev.json');
for(const scenario of ['text','tool','stream','cancel']){
 const record={agent:'rovo-dev',scenario,passed:false};report.cases.push(record);
 await isolated(async({launch,work})=>{
  const ai=await cordyceps.prepare({registry,harness:'rovo-dev',mode:'nonInteractive'});
  const env=ai.environment({HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:''}),home=env.HOME;
  const fixture=join(work,'fixture.txt'),token=`fixture-${randomUUID()}`;await writeFile(fixture,token+'\n');
  const marker=`CORDYCEPS_ROVO_${scenario}_OK`,prompt=`cordyceps-rovo-${scenario}: ${scenario==='tool'?'Read fixture.txt and report completion.':'Reply with the controlled test message.'}`;
  let issued=false,returned=false,kill,aborted=false,incremental=false,tailReleased=false;
  const modelRequest=r=>r.raw.path.split('?')[0]==='/v1/openai/v1/chat/completions';
  try{
   record.version=await launch('rovo',['--version'],env,15000,undefined,[home]);
   ai.route(()=>true,async route=>{
    const request=route.request;
    if(request.raw.path==='/v3/credits/check')return route.fulfill({text:JSON.stringify({status:'ALLOWED',userCreditLimits:{user:{productType:'FREE'},status:'ALLOWED'}})});
    if(request.raw.path==='/prompt-moderation/')return route.fulfill({text:JSON.stringify({status:'ALLOWED'})});
    assert.ok(modelRequest(request),'unexpected path');
    assert.ok(ai.requests.filter(modelRequest).length<=3,'unexpected loop');
    if(scenario==='cancel'){setTimeout(()=>kill(),500);await route.untilAborted();aborted=route.signal.aborted;return;}
    if(scenario==='stream')return route.fulfill({stream:(async function*(){yield{text:'CORDYCEPS_ROVO_'};await delay(1000);tailReleased=true;yield{text:'stream_OK'};})()});
    if(scenario==='tool'){
     const result=request.toolResults.find(r=>r.text.includes(token));
     if(result){assert.equal(result.isError,false);returned=true;return route.fulfill({text:marker})}
     assert.equal(issued,false,'expected actual fixture result');assert.ok(request.tools.some(t=>t.name==='open_files'));
     const call={id:'call_fixture',name:'open_files',input:{file_paths:[fixture]}};record.scriptedCall=call;issued=true;return route.fulfill({toolCall:call});
    }
    return route.fulfill({text:marker});
   });
   ai.recordInput(prompt);record.prompt=prompt;
   record.process=await launch('rovo',[...ai.args,prompt,'--yolo'],env,35000,undefined,[home],{onStart:c=>kill=c.kill,onStdout:chunk=>{if(!tailReleased&&chunk.includes('CORDYCEPS_ROVO_'))incremental=true}});
   const requests=ai.requests.filter(modelRequest);
   assert.ok(requests.some(r=>r.text.includes(prompt)),'real prompt reached model provider');
   assert.ok(!requests[0].raw.body.includes(token),'fixture token absent from prompt');
   ai.assertHealthy();
   if(scenario==='cancel'){await delay(100);assert.equal(record.process.signal,'SIGKILL');assert.ok(aborted);assert.ok(ai.responses.some(r=>r.outcome==='aborted'));}
   else{assert.equal(record.process.code,0,record.process.stderr);assert.ok(record.process.stdout.includes(marker),record.process.stdout);
    if(scenario==='tool'){assert.ok(issued&&returned);assert.equal(requests.length,2)}else assert.equal(requests.length,1);
    if(scenario==='stream'){assert.ok(requests[0].stream);record.streamOutcome=incremental?'incremental stdout before tail':'SSE consumed; noninteractive stdout buffered until completion';}
   }
   record.assertions={capturedModelPrompt:true,actualFixtureResult:scenario==='tool'?returned:null,incrementalBeforeTail:scenario==='stream'?incremental:null,providerAborted:scenario==='cancel'?aborted:null};record.passed=true;
  }catch(error){record.error=String(error.stack||error);throw error}
  finally{
   record.requests=ai.requests;record.responses=ai.responses;record.failures=ai.failures.map(f=>String(f.error));
   await ai.dispose();await assert.rejects(access(home));await assert.rejects(fetch(ai.baseUrl));record.cleanedUp=true;
   await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({scenario,passed:record.passed,requests:record.requests.length,error:record.error}));
  }
 });
}
