import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {cordyceps} from 'cordyceps';
import {isolated} from './probe.mjs';
const report={node:process.version,date:new Date().toISOString(),packageEntry:import.meta.resolve('cordyceps'),artifact:JSON.parse(process.argv[3]),cases:[]};
const registry=cordyceps.createRegistry({builtins:false});await registry.loadFile('antigravity.json');
for(const scenario of ['text','tool','stream','cancel']){
 const record={agent:'antigravity',scenario,passed:false};report.cases.push(record);
 await isolated(async({launch,work})=>{
  const ai=await cordyceps.prepare({registry,harness:'antigravity',mode:'nonInteractive'});
  const env=ai.environment({});const home=env.HOME;
  const fixture=join(work,'fixture.txt'),token=`fixture-${randomUUID()}`;await writeFile(fixture,token+'\n');
  const marker=`CORDYCEPS_AGY_${scenario}_OK`,prompt=`cordyceps-agy-${scenario}: ${scenario==='tool'?'Read fixture.txt then report completion.':'Reply with the controlled test message.'}`;
  const isTitle=request=>request.text.startsWith('You are a conversation title generator.');
  let issued=false,returned=false,kill,aborted=false,incremental=false;
  try{
   record.version=await launch('antigravity',['--version'],env,15000,undefined,[home]);
   ai.route(()=>true,async route=>{
    const request=route.request;
    assert.ok(ai.requests.length<=4,'unexpected loop');
    if(isTitle(request))return route.fulfill({text:'Local Test Conversation'});
    if(scenario==='cancel'){
     setTimeout(()=>kill(),500);
     await route.untilAborted();aborted=route.signal.aborted;return;
    }
    if(scenario==='stream')return route.fulfill({stream:(async function*(){yield{text:'CORDYCEPS_AGY_'};await delay(400);yield{text:'stream_OK'};})()});
    if(scenario==='tool'){
     const result=request.toolResults.find(r=>r.text.includes(token));
     if(result){assert.equal(result.isError,false);returned=true;return route.fulfill({text:marker})}
     assert.equal(issued,false,'expected actual fixture result');
     assert.ok(request.tools.some(t=>t.name==='view_file'));
     const call={id:'call_fixture',name:'view_file',input:{AbsolutePath:fixture,toolSummary:'Fixture contents',toolAction:'Reading fixture'}};
     record.scriptedCall=call;issued=true;return route.fulfill({toolCall:call});
    }
    return route.fulfill({text:marker});
   });
   const args=[...ai.args,prompt,'--output-format','stream-json','--print-timeout','20s','--dangerously-skip-permissions'];
   ai.recordInput(prompt);record.prompt=prompt;
   record.process=await launch('antigravity',args,env,25000,undefined,[home],{onStart:c=>kill=c.kill,onStdout:chunk=>{if(chunk.includes('CORDYCEPS_AGY_')&&!chunk.includes('stream_OK'))incremental=true}});
   record.requests=ai.requests;record.responses=ai.responses;record.failures=ai.failures.map(f=>String(f.error));
   assert.ok(ai.requests.some(r=>r.text.includes(prompt)),'real prompt reached provider');
   assert.ok(!ai.requests[0].raw.body.includes(token),'fixture token absent from prompt');
   ai.assertHealthy();
   if(scenario==='cancel'){await delay(100);assert.equal(record.process.signal,'SIGKILL');assert.ok(aborted,'provider saw native client disconnect');assert.ok(ai.responses.some(r=>r.outcome==='aborted'));}
   else {
    assert.equal(record.process.code,0,record.process.stderr||record.process.stdout);
    assert.ok(record.process.stdout.includes(marker),record.process.stdout);
    if(scenario==='tool'){assert.ok(issued&&returned);assert.equal(ai.requests.filter(r=>!isTitle(r)).length,2)}
    else assert.equal(ai.requests.filter(r=>!isTitle(r)).length,1);
    if(scenario==='stream')assert.ok(incremental,'native output appeared before final text');
   }
   record.assertions={capturedPrompt:true,actualFixtureResult:scenario==='tool'?returned:null,incremental:scenario==='stream'?incremental:null,providerAborted:scenario==='cancel'?aborted:null};record.passed=true;
  }catch(error){record.error=String(error.stack||error);throw error}
  finally{
   record.requests=ai.requests;record.responses=ai.responses;record.failures=ai.failures.map(f=>String(f.error));
   await ai.dispose();await assert.rejects(access(home));await assert.rejects(fetch(ai.baseUrl));record.cleanedUp=true;
   await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({scenario,passed:record.passed,requests:record.requests.length,error:record.error}));
  }
 });
}
