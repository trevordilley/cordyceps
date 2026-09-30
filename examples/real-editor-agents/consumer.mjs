// Consumer code: process ownership, test configuration and lifecycle are not library APIs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRegistry, prepare } from 'cordyceps';
const [output,binaryJSON,artifactJSON,selection] = process.argv.slice(2);
const binaries=JSON.parse(binaryJSON);
assert.equal(process.platform,'darwin','This consumer requires macOS sandbox-exec');
const evidence={artifact:JSON.parse(artifactJSON),packageEntry:import.meta.resolve('cordyceps'),node:process.version,cases:[]};
async function launch(binary,args,cwd,env,input='',extraWritable=[]) {
  const writable=await realpath(dirname(cwd));
  const profile='(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:'+new URL(env.OPENAI_API_BASE).port+'"))(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty") (subpath '+JSON.stringify(writable)+')'+extraWritable.map(p=>'(subpath '+JSON.stringify(p)+')').join('')+')';
  const child=spawn('/usr/bin/sandbox-exec',['-p',profile,binary,...args],{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',timedOut=false;
  child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  child.stdin.on('error',()=>{}); child.stdin.end(input);
  const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}};
  const timer=setTimeout(()=>{timedOut=true;kill();},45000);
  try { const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));}); return {...result,stdout,stderr,timedOut,args}; }
  finally {clearTimeout(timer);kill();}
}
for(const harness of (selection==='all'?['aider','cline']:[selection])) {
 for(const scenario of ['text','tool']) {
  const root=await mkdtemp(join(tmpdir(),`cordyceps-${harness}-`)); let ai;
  const record={harness,scenario,passed:false};evidence.cases.push(record);
  try {
   const home=join(root,'home'),work=join(root,'work');await mkdir(home);await mkdir(work);
   const secret='file-'+randomUUID();await writeFile(join(work,'fixture.txt'),secret+'\n');
   const registry=createRegistry({builtins:false});await registry.loadFile(join(process.cwd(),harness+'.json'));
   ai=await prepare({harness,mode:'nonInteractive',registry,inputs:{model:'gpt-4o'}});
   const env=ai.environment({OPENAI_API_BASE:ai.baseUrl+'/v1',PATH:dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,TMPDIR:root,XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),TERM:'dumb',NO_COLOR:'1',PYTHONIOENCODING:'utf-8',LITELLM_LOCAL_MODEL_COST_MAP:'True',AIDER_ANALYTICS:'false',AIDER_CHECK_UPDATE:'false',OTEL_SDK_DISABLED:'true',DO_NOT_TRACK:'1',NO_PROXY:'localhost,127.0.0.1',HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1'});
   const marker=`CORDYCEPS_${harness}_${scenario}_OK`,prompt=`cordyceps-${harness}-${scenario}: ${scenario==='tool'?'Read fixture.txt using your file or command capability and finish.':'Reply with the controlled response and finish.'}`;
   let issued=false,returned=false;
   ai.route(()=>true,async route=>{
    const req=route.request; assert.ok(ai.requests.length<=6,'unexpected retries');
    if(scenario==='tool'&&!issued){
      issued=true;
      if(harness==='aider')return route.fulfill({text:'Run this command to inspect the fixture:\n\n```bash\n/bin/cat fixture.txt\n```\n'});
      record.toolTransport='cline XML tool instructions in model text';
      return route.fulfill({text:'<read_file>\n<path>fixture.txt</path>\n</read_file>'});
    }
    if(scenario==='tool'){
      assert.ok(req.raw.body.includes(secret),'real fixture result absent from follow-up'); returned=true;
    }
    if(harness==='cline')return route.fulfill({text:`<attempt_completion>\n<result>${marker}</result>\n</attempt_completion>`});
    return route.fulfill({text:marker});
   });
   record.version=await launch(binaries[harness],['--version'],work,env);
   let args,input='';
   if(harness==='aider') {
    await writeFile(join(root,'empty.yml'),'{}\n');await writeFile(join(root,'empty.env'),'');
    args=['--model','openai/gpt-4o','--openai-api-base',ai.baseUrl+'/v1','--openai-api-key',ai.apiKey,'--no-git','--no-gitignore','--no-auto-commits','--no-analytics','--no-check-update','--no-show-release-notes','--no-pretty','--map-tokens','0','--config',join(root,'empty.yml'),'--env-file',join(root,'empty.env')];
    if(scenario==='text')args.push('--message',prompt);else input=prompt+'\ny\ny\nReport completion now.\n/exit\n';
   } else {
    args=[...ai.args,'--cwd',work,'--yolo','--json','--timeout','30',prompt];
   }
   ai.recordInput(prompt);record.process=await launch(binaries[harness],args,work,env,input,harness==='cline'?[await realpath(ai.args[1])]:[]);
   record.requests=ai.requests;record.failures=ai.failures.map(f=>String(f.error));ai.assertHealthy();
   assert.equal(record.process.timedOut,false,record.process.stderr);assert.equal(record.process.code,0,record.process.stderr);
   assert.ok(record.process.stdout.includes(marker),record.process.stdout);
   assert.ok(ai.requests.some(r=>r.text.includes(prompt)),'no real prompt request');
   assert.ok(!ai.requests[0].raw.body.includes(secret),'fixture leaked before real read');
   if(scenario==='tool')assert.ok(issued&&returned);
   assert.equal(ai.requests.length,scenario==='tool'?2:1);
   record.responses=ai.responses;
   record.passed=true;
  } catch(e){record.error=String(e.stack??e); if(ai){record.requests=ai.requests;record.failures=ai.failures.map(f=>String(f.error));}}
  finally{if(ai){await ai.dispose();await assert.rejects(fetch(ai.baseUrl));for(const file of ai.configFiles)await assert.rejects(access(file.path));}await rm(root,{recursive:true,force:true});await assert.rejects(access(root));record.cleanedUp=true;await writeFile(output,JSON.stringify(evidence,null,2));}
  console.log(harness,scenario,record.passed?'PASS':record.error);
 }
}
assert.ok(evidence.cases.every(r=>r.passed),`See ${output}`);
