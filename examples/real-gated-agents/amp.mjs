// Real installed Amp, driven only through the packed public provider API.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {cordyceps} from 'cordyceps';
import {isolated,binaries} from './probe.mjs';
const report={node:process.version,date:new Date().toISOString(),packageEntry:import.meta.resolve('cordyceps'),artifact:JSON.parse(process.argv[3]),identity:'Installed Amp native binary with explicit loopback service metadata.',cases:[]};
const registry=cordyceps.createRegistry({builtins:false});await registry.loadFile('amp.json');
for(const scenario of ['text','tool','stream','cancel']){
 const record={agent:'amp',scenario,passed:false};report.cases.push(record);
 await isolated(async({launch,work})=>{
  const ai=await cordyceps.prepare({registry,harness:'amp',mode:'nonInteractive'});
  const env=ai.environment({HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:''}),home=env.HOME;
  const fixture=join(work,'fixture.txt'),token=`fixture-${randomUUID()}`;await writeFile(fixture,token+'\n');
  const marker=`CORDYCEPS_AMP_${scenario}_OK`,prompt=`cordyceps-amp-${scenario}: ${scenario==='tool'?'Read fixture.txt and report completion.':'Reply with the controlled test message.'}`;
  let issued=false,returned=false,kill,aborted=false,incremental=false,tailReleased=false;
  const providerRequest=r=>r.raw.path==='/api/provider/anthropic/v1/messages';
  const modelRequest=r=>providerRequest(r)&&!r.tools.some(t=>t.name==='set_title');
  try{
   record.version=await launch('amp',['--version'],env,15000,undefined,[home]);
   ai.route(()=>true,async route=>{
    const request=route.request;
    const metadata={getUserInfo:{ok:true,result:{id:'U-cordyceps',email:'cordyceps@example.invalid',displayName:'Local test',features:[],team:null}},getThread:{ok:false,error:{code:'thread-not-found'}},getUserFreeTierStatus:{ok:true,result:{canUseAmpFree:false}},uploadThread:{ok:true,result:{}}};
    if(request.raw.path.startsWith('/api/internal?')){const reply=metadata[request.raw.path.split('?')[1]];assert.ok(reply);return route.fulfill({text:JSON.stringify(reply)})}
    if(providerRequest(request)&&!modelRequest(request))return route.fulfill({toolCall:{id:'title',name:'set_title',input:{title:'Local controlled test'}}});
    assert.ok(modelRequest(request),'unexpected path');
    assert.ok(ai.requests.filter(modelRequest).length<=3,'unexpected loop');
    if(scenario==='cancel'){setTimeout(()=>kill(),500);await route.untilAborted();aborted=route.signal.aborted;return;}
    if(scenario==='stream')return route.fulfill({stream:(async function*(){yield{text:'CORDYCEPS_AMP_'};await delay(1000);tailReleased=true;yield{text:'stream_OK'};})()});
    if(scenario==='tool'){
     const result=request.toolResults.find(r=>r.text.includes(token));
     if(result){assert.equal(result.isError,false);returned=true;return route.fulfill({text:marker})}
     assert.equal(issued,false,'expected actual fixture result');assert.ok(request.tools.some(t=>t.name==='Read'));
     const call={id:'call_fixture',name:'Read',input:{path:fixture}};record.scriptedCall=call;issued=true;return route.fulfill({toolCall:call});
    }
    return route.fulfill({text:marker});
   });
   const settings=join(home,'amp-settings.json');await writeFile(settings,JSON.stringify({'amp.updates.mode':'disabled','amp.skills.disableClaudeCodeSkills':true}));
   ai.recordInput(prompt);record.prompt=prompt;
   record.process=await launch('amp',['--settings-file',settings,'--no-ide','--no-jetbrains','--dangerously-allow-all',...ai.args,prompt],env,35000,undefined,[home],{onStart:c=>kill=c.kill,onStdout:chunk=>{if(!tailReleased&&chunk.includes('CORDYCEPS_AMP_'))incremental=true}});
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
