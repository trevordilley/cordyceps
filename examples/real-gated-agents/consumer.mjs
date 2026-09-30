// Copied outside the repository; the provider is the installed npm artifact.
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {cordyceps} from 'cordyceps';
import {isolated,binaries} from './probe.mjs';
const report={node:process.version,date:new Date().toISOString(),packageEntry:import.meta.resolve('cordyceps'),artifact:JSON.parse(process.argv[3]),cases:[]};
const chosen=process.argv[4]?.split(',')||Object.keys(binaries).filter(agent=>agent!=='antigravity');
for(const agent of chosen){
 await isolated(async({launch,home,root,work})=>{
  const registry=cordyceps.createRegistry({builtins:false});
  registry.register({schemaVersion:1,id:'gated-diagnostic',provider:{adapter:'anthropic-messages',override:{}},modes:{diagnostic:{}}});
  const ai=await cordyceps.prepare({registry,harness:'gated-diagnostic',mode:'diagnostic'});
  const raw=[];
  // A transparent loopback-only capture proxy preserves proprietary requests rejected by the codec.
  // Default forwarding is unchanged; opt-in bootstrap branches below are explicit diagnostic metadata only.
  const proxy=createServer(async(req,res)=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=Buffer.concat(chunks);raw.push({method:req.method,path:req.url,headers:req.headers,body:body.toString(),bodyBase64:body.toString('base64')});
   if(agent==='rovo'&&process.env.CORDYCEPS_ROVO_BOOTSTRAP&&['/prompt-moderation/','/v3/credits/check'].includes(req.url)){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(req.url==='/prompt-moderation/'?{status:'ALLOWED'}:{status:'ALLOWED',userCreditLimits:{user:{productType:'FREE'},status:'ALLOWED'}}));return;}
   if(agent==='amp'&&process.env.CORDYCEPS_AMP_BOOTSTRAP&&req.url==='/api/internal?getUserInfo'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,result:{id:'U-cordyceps',email:'cordyceps@example.invalid',displayName:'Local test',features:[],team:null}}));return;}
   if(agent==='amp'&&process.env.CORDYCEPS_AMP_BOOTSTRAP&&['/api/internal?getThread','/api/internal?getUserFreeTierStatus','/api/internal?uploadThread'].includes(req.url)){const replies={getThread:{ok:false,error:{code:'thread-not-found'}},getUserFreeTierStatus:{ok:true,result:{canUseAmpFree:false}},uploadThread:{ok:true,result:{}}};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(replies[req.url.split('?')[1]]));return;}
   if(agent==='qodo'&&process.env.CORDYCEPS_QODO_BOOTSTRAP&&req.url.startsWith('/v2/info/get-things')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({default_model:'cordyceps-test',models:[{model_name:'cordyceps-test'}],'session-id':'00000000-0000-4000-8000-000000000001','mcp-tools':{}}));return;}
   const target=new URL(ai.baseUrl);const upstream=httpRequest({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res)});
   upstream.on('error',e=>{res.writeHead(502);res.end(String(e))});upstream.end(body);
  });
  proxy.on('upgrade',(req,socket)=>{raw.push({method:req.method,path:req.url,headers:req.headers,upgrade:true});socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  const base=`http://127.0.0.1:${proxy.address().port}`,key='cordyceps-test-no-provider-credential';
  const prompt=`cordyceps-gated-${agent}: Reply with the controlled test message.`;
  const marker=`CORDYCEPS_${agent}_TEXT_OK`;
  ai.route(()=>true,route=>route.fulfill({text:marker}));
  const record={agent,scriptedBootstrap:['amp','rovo','qodo'].includes(agent)&&Boolean(process.env[`CORDYCEPS_${agent.toUpperCase()}_BOOTSTRAP`]),passed:false,providerAdapter:'anthropic-messages',purpose:'Discover actual injection traffic; proprietary endpoints are expected to fail decoding, never reported as a validation pass.',attempts:[]};report.cases.push(record);
  try{
   record.version=await launch(agent,agent==='q'?['version']:['--version']);
   record.help=await launch(agent,agent==='rovo'?['rovodev','run','--help']:['--help']);
   let args,env={ANTHROPIC_BASE_URL:base,ANTHROPIC_API_KEY:key,OPENAI_BASE_URL:base+'/v1',OPENAI_API_KEY:key};
   if(agent==='q'){await mkdir(join(home,'.local/bin'),{recursive:true});await symlink('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat',join(home,'.local/bin/kiro-cli-chat'));args=['chat','--no-interactive',prompt];Object.assign(env,{AWS_ENDPOINT_URL:base,AWS_ACCESS_KEY_ID:'test',AWS_SECRET_ACCESS_KEY:'test',AWS_EC2_METADATA_DISABLED:'true',KIRO_API_KEY:key,KIRO_NO_AUTO_UPDATE:'1',KIRO_DISABLE_TELEMETRY:'1'});record.chatHelp=await launch(agent,['chat','--help']);}
   if(agent==='rovo'){args=['rovodev','run',prompt];Object.assign(env,{ACLI_CONFIG_DIR:join(home,'.acli'),ATLASSIAN_API_URL:base});record.authHelp=await launch(agent,['rovodev','auth','login','--help']);if(process.env.CORDYCEPS_ROVO_BINARY){args=['run',prompt,'--yolo'];Object.assign(env,{AUTH_METHOD:process.env.CORDYCEPS_ROVO_AUTH_METHOD||'api_token',USER_EMAIL:'cordyceps-test@example.invalid',USER_API_TOKEN:key,ROVO_DEV_PROXY_BASE_URL:base,MESH_DEPENDENCY_AI_GATEWAY_BASE_URL:base,AI_GATEWAY_SLAUTH_TOKEN:key,HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:''});}}
   if(agent==='amp'){
    const settings=join(home,'amp.json');await writeFile(settings,JSON.stringify({'amp.updates.mode':'disabled','amp.skills.disableClaudeCodeSkills':true}));
    args=['--log-level','debug','--log-file',join(root,'amp.log'),'--settings-file',settings,'--no-ide','--no-jetbrains','--execute',prompt];Object.assign(env,{AMP_URL:base,AMP_API_KEY:key,AMP_DEBUG:'1'});
    record.customProvidersHelp=await launch(agent,['config','model-providers','--help'],env);
   }
   if(agent==='cursor'){args=['--endpoint',base,'--agent-endpoint',base,'--api-key',key,'--trust','--sandbox','disabled','--print',prompt];env.CURSOR_API_BASE_URL=base;Object.assign(env,{HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:''});}
   if(agent==='auggie'){args=['--print','--max-turns','2','--dont-save-session','--workspace-root',work,'--instruction',prompt];env.AUGMENT_SESSION_AUTH=JSON.stringify({accessToken:key,tenantURL:base,scopes:["email"]});}
   if(agent==='antigravity'){const dir=join(home,'.gemini/antigravity-cli');await mkdir(dir,{recursive:true});await writeFile(join(dir,'settings.json'),JSON.stringify({modelProvider:'gemini'}));args=['--print',prompt,'--output-format','stream-json','--print-timeout','15s'];Object.assign(env,{GEMINI_API_KEY:key,GOOGLE_GEMINI_BASE_URL:base});}
   if(agent==='qodo'){args=['--ci','--yes','--no-builtin',prompt];Object.assign(env,{QODO_API_KEY:key,QODO_API_BASE_URL:base,QODO_BASE_URL:base,QODO_DEBUG:'true'});}
   if(agent==='rovo'&&process.env.CORDYCEPS_ROVO_AUTH_METHOD==='slauth'){delete env.USER_EMAIL;delete env.USER_API_TOKEN;}
   record.injection=env;record.prompt=prompt;ai.recordInput(prompt);
   record.attempts.push(await launch(agent,args,env,22000));
   if(agent==='q'){
    const settings=join(home,'.kiro/settings');await mkdir(settings,{recursive:true});
    const config={'api.q.service':{endpoint:base,region:'us-east-1'},'api.codewhisperer.service':{endpoint:base,region:'us-east-1'},'api.kiroauth.service':{endpoint:base,region:'us-east-1'}};
    await writeFile(join(settings,'cli.json'),JSON.stringify(config));record.customServiceConfig=config;
    record.attempts.push(await launch(agent,args,env,22000));
   }
   if(agent==='rovo'&&!process.env.CORDYCEPS_ROVO_BINARY)record.attempts.push(await launch(agent,['rovodev','auth','login','--email','cordyceps-test@example.invalid','--token'],env,15000,key+'\n'));
   if(agent==='cursor')record.attempts.push(await launch(agent,['--endpoint',base,'--agent-endpoint',base,'--auth-token',key,'--trust','--sandbox','disabled','--print',prompt],env,22000));
   if(agent==='amp' && process.env.CORDYCEPS_AMP_BINARY){
    const keyFile=join(home,'test-key');await writeFile(keyFile,key);
    for(const format of ['responses','anthropic-messages'])record.attempts.push(await launch(agent,['config','model-providers','add-router','custom-url','--personal','--name','cordyceps-local-test','--api-key-file',keyFile,'--base-url',base,'--api-format',format,'--model-mapping','*/*'],env,15000));
   }
   if(agent==='auggie')record.attempts.push(await launch(agent,[...args,'--provider-model','claude-sonnet-4-6','--provider-api-key',key,'--provider-base-url',base],env,22000));
   record.passed=record.attempts.at(-1).code===0 && record.attempts.at(-1).stdout.includes(marker) && ai.requests.some(r=>r.text.includes(prompt));
  }catch(e){record.error=String(e.stack||e)}finally{
   if(agent==='amp')record.debug=await readFile(join(root,'amp.log'),'utf8').catch(()=>null);
   record.outcome=record.passed?'validated-text':'blocked-before-controlled-text';record.toolOutcome='not-exercised: controlled text prerequisite failed';record.streamCancelOutcome='not-exercised: controlled text prerequisite failed';
   record.rawRequests=raw;record.requests=ai.requests;record.responses=ai.responses;record.failures=ai.failures.map(f=>String(f.error));
   proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await ai.dispose();await assert.rejects(fetch(ai.baseUrl));
   record.cleanedUp=true;await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
   console.log(JSON.stringify({agent,passed:record.passed,requests:raw.map(r=>r.path),exit:record.attempts.at(-1)?.code,timedOut:record.attempts.at(-1)?.timedOut}));
  }
 });
}
