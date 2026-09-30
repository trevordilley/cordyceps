// Copied outside the checkout. Only this public import supplies Cordyceps.
import {cordyceps} from 'cordyceps';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {field,inspectAppend} from './wire.mjs';
import {isolated} from './probe.mjs';
assert.equal(process.versions.bun,undefined,'Use real Node');
assert.equal(process.platform,'darwin','This diagnostic requires macOS sandbox-exec');
const report={date:new Date().toISOString(),node:process.version,packageEntry:import.meta.resolve('cordyceps'),artifact:JSON.parse(process.argv[3]),
  passed:false,boundaryEstablished:false,textOutcome:'not-validated',toolOutcome:'not-validated',streamOutcome:'not-validated',modelCancellationOutcome:'not-validated',
  purpose:'Identify the native remote-agent boundary without implementing an agent service',requests:[],rpc:[]};
const registry=cordyceps.createRegistry({builtins:false});
registry.register({schemaVersion:1,id:'cursor-boundary-diagnostic',provider:{adapter:'anthropic-messages',override:{}},modes:{diagnostic:{}}});
const ai=await cordyceps.prepare({registry,harness:'cursor-boundary-diagnostic',mode:'diagnostic'});
const root=await realpath(await mkdtemp('/tmp/cc-')),home=join(root,'home'),work=join(root,'work');
await mkdir(home);await mkdir(work);
const fixture=join(work,'fixture.txt'),fixtureToken=randomUUID();await writeFile(fixture,fixtureToken);
const prompt=`Cordyceps Cursor boundary probe: read ${fixture}, then reply CURSOR_CONTROLLED_OK.`;
const token=`eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({sub:'cordyceps-test',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.test`;
let child,kill=()=>{},serviceStream,appendSeen,disconnect,openStream;
const appended=new Promise(resolve=>appendSeen=resolve),disconnected=new Promise(resolve=>disconnect=resolve);
const opened=new Promise(resolve=>openStream=resolve);
const diagnostics=[];
const server=createServer(async(req,res)=>{
 try {
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  const record={path:req.url,headers:req.headers,bodyBase64:body.toString('base64')};report.requests.push(record);
  if(req.url==='/auth/exchange_user_api_key'){
   record.response={accessToken:token,refreshToken:'cordyceps-test-refresh'};
   res.setHeader('content-type','application/json');res.end(JSON.stringify(record.response));return;
  }
  if(req.url.endsWith('/RunSSE')){
   serviceStream=res;openStream();res.setHeader('content-type','application/connect+proto');res.flushHeaders();
   res.once('close',()=>{report.agentServiceDisconnected=true;disconnect()});return;
  }
  if(req.url.endsWith('/BidiAppend')){
   record.decoded=inspectAppend(body);
   // Preserve the exact native request against the installed public provider. Its rejection is evidence, not success.
   diagnostics.push((async()=>{const result=await fetch(ai.baseUrl+req.url,{method:req.method,headers:{'content-type':req.headers['content-type']},body});record.packedProvider={status:result.status,body:await result.text()};})());
   appendSeen(record.decoded);
  }
  let reply=Buffer.alloc(0);
  if(req.url.endsWith('/GetUsableModels')||req.url.endsWith('/GetDefaultModelForCli')){
   reply=field(1,Buffer.concat([field(1,'cordyceps-test-model'),field(3,'cordyceps-test-model'),field(4,'Cordyceps test model'),field(5,'test'),
    field(8,Buffer.concat([field(1,'test-provider-key'),field(2,base+'/provider')]))]));
  }
  record.responseBase64=reply.toString('base64');
  res.setHeader('content-type','application/proto');res.end(reply);
 } catch(error){report.serverError=String(error.stack);res.writeHead(500);res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
let timer,closed;
try {
 await isolated(async({launch})=>{report.version=await launch('cursor',['--version']);report.printAttempt=await launch('cursor',['--endpoint',base,'--agent-endpoint',base,'--api-key','cordyceps-test','--trust','--sandbox','disabled','--print',prompt],{HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:''});});
 const config=join(home,'.config/cursor');await mkdir(config,{recursive:true});await writeFile(join(config,'cli-config.json'),JSON.stringify({version:1,network:{useHttp1ForAgent:true}}));
 const profile=`(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(deny mach-lookup (global-name "com.apple.securityd"))(deny file-read* (subpath "/Users/20idemo/Library/Keychains"))(deny process-exec (literal "/usr/bin/open"))(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty") (subpath ${JSON.stringify(root)}))`;
 const args=['--endpoint',base,'--agent-endpoint',base,'--api-key','cordyceps-test','acp'];report.args=args;
 child=spawn('/usr/bin/sandbox-exec',['-p',profile,process.env.CORDYCEPS_CURSOR_BINARY||'/Users/20idemo/.local/bin/cursor-agent',...args],{cwd:work,detached:true,
  env:{HOME:home,PATH:'/Users/20idemo/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin:/opt/homebrew/bin',TMPDIR:root,XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),XDG_DATA_HOME:join(home,'.local/share'),NO_PROXY:'localhost,127.0.0.1',NO_OPEN_BROWSER:'1',BROWSER:'/usr/bin/false',TERM:'dumb',NO_COLOR:'1'},stdio:['pipe','pipe','pipe']});
 kill=()=>{try{process.kill(-child.pid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}};
 let seq=0,buffer='';report.stderr='';const waiting=new Map();
 child.stdout.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const index=buffer.indexOf('\n'),line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const message=JSON.parse(line);report.rpc.push(message);if(waiting.has(message.id)){waiting.get(message.id)(message);waiting.delete(message.id);}}catch{report.unparsedStdout=(report.unparsedStdout||'')+line+'\n';}}});
 child.stderr.on('data',chunk=>report.stderr+=chunk);
 closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{report.exit={code,signal};for(const done of waiting.values())done({error:'process exited'});waiting.clear();resolve();})});
 const rpc=(method,params)=>new Promise(resolve=>{const id=++seq;waiting.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 timer=setTimeout(()=>{report.timedOut=true;kill()},25000);
 await rpc('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'cordyceps-boundary-diagnostic',version:'1'}});
 let session;
 // Native auth refresh caches the ephemeral token before failed Keychain persistence. Retry session setup; never relax Keychain isolation.
 for(let attempt=0;attempt<4;attempt++){session=await rpc('session/new',{cwd:work,mcpServers:[]});if(session.result?.sessionId)break;}
 assert.ok(session.result?.sessionId,'Native ACP session did not initialize');
 const pending=rpc('session/prompt',{sessionId:session.result.sessionId,prompt:[{type:'text',text:prompt}]});
 const decoded=await Promise.race([appended,closed.then(()=>{throw Error('Agent exited before BidiAppend')})]);
 assert.equal(decoded.prompt,prompt);assert.equal(decoded.providerBaseUrl,base+'/provider');assert.equal(decoded.providerKey,'test-provider-key');
 assert.ok(!JSON.stringify(report.requests).includes(fixtureToken),'Fixture content must not be manufactured into a request');
 await Promise.race([opened,closed.then(()=>{throw Error('Agent exited before RunSSE')})]);
 assert.ok(serviceStream,'Native agent service stream was not opened');
 kill();await closed;await pending;await disconnected;await Promise.all(diagnostics);
 assert.equal(report.exit.signal,'SIGKILL');assert.equal(report.timedOut,undefined);assert.ok(!report.requests.some(r=>r.path.startsWith('/provider')));
 assert.ok(report.requests.some(r=>r.packedProvider?.status>=400));
 report.boundaryEstablished=true;
 report.finding='Actual client submits AgentRunRequest and provider base URL to a remote agent service. No direct provider request, model output, or real file read was observed.';
 report.processCancellation='Real ACP process group killed after native run request; held agent-service socket disconnected. This is not model cancellation.';
} finally {
 clearTimeout(timer);kill();if(closed)await closed;
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await Promise.allSettled(diagnostics);
 report.providerFailures=ai.failures.map(f=>String(f.error));await ai.dispose();await assert.rejects(fetch(ai.baseUrl));
 await rm(root,{recursive:true,force:true});report.cleanedUp=true;
 await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({passed:report.passed,boundaryEstablished:report.boundaryEstablished,requests:report.requests.map(r=>r.path),cleanedUp:report.cleanedUp}));
