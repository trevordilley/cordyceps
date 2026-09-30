// Copied outside the checkout; only installed public imports are used.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { cordyceps } from 'cordyceps';
const [evidencePath, artifact, source] = process.argv.slice(2);
assert.equal(process.platform, 'darwin');
assert.equal(process.versions.bun, undefined);
const root = await realpath(await mkdtemp(join(tmpdir(), 'cordyceps-plandex-run-')));
const name = 'cordyceps-plandex-' + randomUUID();
const label = 'ai.cordyceps.task=' + name;
const evidence = {artifact:JSON.parse(artifact), node:process.version, packageEntry:import.meta.resolve('cordyceps'), root, commands:[], cases:[]};
let ai, server, database, dbCreated=false, networkCreated=false, volumeCreated=false;
const tracked = Boolean(process.env.DEVSWARM_BUILDER_ID);
const ownedServices = () => tracked ? JSON.parse(sync('hivecontrol',['process','list','--service','--all'])).filter(p=>p.label.includes(name)) : [];
const sync = (cmd,args) => { const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000}); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
const freePort = () => new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const delay = ms=>new Promise(r=>setTimeout(r,ms));
const children = new Set();
function launch(cmd,args,options={}) {
  const child=spawn(cmd,args,{detached:true,stdio:['pipe','pipe','pipe'],...options}); children.add(child);
  const record={cmd,args,stdout:'',stderr:''}; child.stdout.on('data',b=>record.stdout+=b);child.stderr.on('data',b=>record.stderr+=b);
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>{record.code=code;record.signal=signal;children.delete(child);resolve(record);});});
  child.stdin.end();return {child,record,done};
}
function service(cmd,args,options={}) {
  if(!tracked) return launch(cmd,args,options);
  // The tracking wrapper retains DevSwarm routing variables; the actual service
  // receives only the consumer's explicit environment through env -i.
  const serviceEnv=options.env ?? {PATH:process.env.PATH};
  return launch('hivecontrol',['exec','service','--','/usr/bin/env','-i',`CORDYCEPS_TASK=${name}`,...Object.entries(serviceEnv).map(([key,value])=>`${key}=${value}`),cmd,...args],{...options,env:process.env});
}
const home=join(root,'home'), work=join(root,'work');
await mkdir(home); await mkdir(work);
const env={PATH:`${source}/venv/bin:/usr/bin:/bin:/usr/sbin:/sbin`,HOME:home,TMPDIR:root,TERM:'xterm-256color',PLANDEX_SKIP_UPGRADE:'1',PLANDEX_DISABLE_SUGGESTIONS:'1',NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',GIT_CONFIG_NOSYSTEM:'1'};
const profile=`(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(deny network-inbound)(allow network-inbound (local ip "localhost:*"))(deny file-write*)(allow file-write* (subpath ${JSON.stringify(root)}) (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))`;
async function cli(args) {
  const p=launch(join(source,'venv/bin/python3'),[join(process.cwd(),'drive-pty.py'),'/usr/bin/sandbox-exec','-p',profile,join(source,'plandex'),...args],{cwd:work,env:ai.environment(env)});
  const timer=setTimeout(()=>{try{process.kill(-p.child.pid,'SIGKILL');}catch{}},60000);
  const r=await p.done;clearTimeout(timer);evidence.commands.push(r);console.log(JSON.stringify({args,code:r.code}));assert.equal(r.code,0,r.stdout+'\n'+r.stderr);return r;
}
try {
  // Upstream hardcodes LiteLLM localhost:4000. Refuse to reuse anybody else's.
  await new Promise((resolve,reject)=>{const probe=createServer();probe.on('error',reject);probe.listen(4000,()=>probe.close(resolve));});
  evidence.upstream=sync('git',['-C',source,'rev-parse','HEAD']);
  evidence.versions={cliSource:(await readFile(join(source,'app/cli/version.txt'),'utf8')).trim(),serverSource:(await readFile(join(source,'app/server/version.txt'),'utf8')).trim(),go:sync('go',['version']),python:sync(join(source,'venv/bin/python3'),['--version'])};
  evidence.binarySha256={};
  for(const binary of ['plandex','plandex-server']) evidence.binarySha256[binary]=createHash('sha256').update(await readFile(join(source,binary))).digest('hex');
  evidence.postgresImage=JSON.parse(sync('docker',['image','inspect','postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea']))[0].RepoDigests;
  evidence.pythonPackages=sync('uv',['pip','freeze','--python',join(source,'venv/bin/python3')]).split('\n');
  evidence.docker=sync('docker',['version','--format','{{.Server.Version}}']);
  // Static tokenizer data download, before the isolated consumers start. No inference.
  const url='https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken';
  const tokenizer=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.ok(tokenizer.ok);const bytes=Buffer.from(await tokenizer.arrayBuffer());
  const cache=join(root,'tokenizer');await mkdir(cache);await writeFile(join(cache,createHash('sha1').update(url).digest('hex')),bytes);env.TIKTOKEN_CACHE_DIR=cache;
  evidence.tokenizer={url,sha256:createHash('sha256').update(bytes).digest('hex')};
  sync('docker',['network','create','--label',label,name]);networkCreated=true;
  sync('docker',['volume','create','--label',label,name+'-db']);volumeCreated=true;
  sync('docker',['create','--mount',`type=volume,source=${name}-db,target=/var/lib/postgresql/data`,'--name',name,'--label',label,'--network',name,'-p','127.0.0.1::5432','-e','POSTGRES_USER=plandex','-e','POSTGRES_PASSWORD=cordyceps-test','-e','POSTGRES_DB=plandex','postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea']);dbCreated=true;
  evidence.databaseVolumes=JSON.parse(sync('docker',['inspect',name]))[0].Mounts.filter(m=>m.Type==='volume').map(m=>m.Name);
  database=service(sync('/usr/bin/which',['docker']),['start','-a',name]);
  for(let i=0;i<60;i++){if(sync('docker',['inspect','--format','{{.State.Running}}',name])==='true')break;await delay(250);}
  const dbPort=sync('docker',['port',name,'5432/tcp']).split(':').at(-1);
  for(let i=0;i<60;i++){const r=spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','plandex','-d','plandex'],{encoding:'utf8'});if(r.status===0)break;await delay(500);}
  evidence.versions.postgres=sync('docker',['exec',name,'psql','-h','127.0.0.1','-U','plandex','-d','plandex','-Atc','SELECT version()']);
  const port=await freePort(), host=`http://127.0.0.1:${port}`;
  server=service('/usr/bin/sandbox-exec',['-p',profile,join(source,'plandex-server')],{cwd:join(source,'app/server'),env:{...env,GOENV:'development',LOCAL_MODE:'1',PORT:String(port),PLANDEX_BASE_DIR:join(root,'server'),DATABASE_URL:`postgres://plandex:cordyceps-test@127.0.0.1:${dbPort}/plandex?sslmode=disable`,PYTHONDONTWRITEBYTECODE:'1'}});
  for(let i=0;i<120;i++){if(server.record.code!==undefined)throw Error(server.record.stderr);try{if((await fetch(host+'/health')).ok)break;}catch{}await delay(500);}
  const post=async(path,body,headers={})=>{const r=await fetch(host+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});const text=await r.text();assert.ok(r.ok,text);return JSON.parse(text);};
  const account=await post('/accounts',{email:'local-admin@plandex.ai',userName:'Local Admin',pin:''});

  let org=account.orgs?.[0];
  if(!org)org=await post('/orgs',{name:'Cordyceps'},{Authorization:'Bearer '+Buffer.from(JSON.stringify({token:account.token})).toString('base64url')});
  await mkdir(join(home,'.plandex-home-v2'),{recursive:true});
  await writeFile(join(home,'.plandex-home-v2/auth.json'),JSON.stringify({...account,host,isCloud:false,isLocalMode:true,orgId:org.id,orgName:org.name ?? 'Cordyceps',integratedModelsMode:false}));
  const registry=cordyceps.createRegistry({builtins:false});await registry.loadFile(join(process.cwd(),'plandex.json'));
  ai=await cordyceps.prepare({harness:'plandex',mode:'nonInteractive',registry});
  let scenario='text', mainRequests=[], issued=false, returned=false;
  const secret='fixture-'+randomUUID();
  const marker=()=>`CORDYCEPS_PLANDEX_${scenario.toUpperCase()}_OK`;
  ai.route(()=>true,async route=>{
    const request=route.request;
    assert.ok(ai.requests.length<12,'Unexpected retries or request loop');
    if(request.text.includes('You are an AI summarizer')) return route.fulfill({text:'Local test summary.'});
    mainRequests.push(request);

    if(scenario==='text') return route.fulfill({text:marker()});
    if(!issued){
      assert.ok(!request.raw.body.includes(secret),'Fixture token leaked before the read');
      issued=true;
      return route.fulfill({text:'### Files\n- `fixture.txt`\n'});
    }
    assert.equal(returned,false,'Unexpected extra main request');
    assert.ok(request.raw.body.includes(secret),'Real CLI file contents missing from next request');
    returned=true;
    return route.fulfill({text:marker()});
  });
  await cli(['version']);
  await copyFile(ai.configFiles[0].path,join(root,'custom-models.json'));
  await cli(['models','custom','--file',join(root,'custom-models.json'),'--save']);
  await cli(['set-model','default','cordyceps']);
  await cli(['new','--name','cordyceps-text','--no-auto']);
  const clean=text=>text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'');
  const textPrompt='cordyceps-plandex-text: Reply with the controlled message.';
  ai.recordInput(textPrompt);
  const text=await cli(['chat',textPrompt]);
  assert.ok(clean(text.stdout).includes(marker()));
  assert.equal(mainRequests.length,1);
  assert.ok(mainRequests[0].text.includes(textPrompt));
  evidence.cases.push({scenario,passed:true,mainRequestIds:mainRequests.map(r=>r.id),terminalReply:marker()});
  scenario='read';mainRequests=[];
  await writeFile(join(work,'fixture.txt'),secret+'\n');
  await cli(['new','--name','cordyceps-read','--semi']);
  const readPrompt='cordyceps-plandex-read: Read fixture.txt and report completion.';
  ai.recordInput(readPrompt);
  const read=await cli(['chat','--auto-load-context',readPrompt]);
  assert.ok(clean(read.stdout).includes(marker()));
  assert.equal(mainRequests.length,2);
  assert.ok(issued && returned);
  assert.ok(server.record.stderr.includes('Successfully processed request for AutoLoadContextHandler'));
  assert.ok(clean(read.stdout).includes('fixture.txt'));
  assert.ok(mainRequests[0].text.includes(readPrompt));
  evidence.cases.push({scenario,passed:true,fixtureToken:secret,scriptedRead:'### Files\n- `fixture.txt`\n',mainRequestIds:mainRequests.map(r=>r.id),terminalReply:marker()});
  ai.assertHealthy();evidence.passed=true;
} catch(error){evidence.error=String(error.stack??error);throw error;}
finally {
  // Try every cleanup even when a previous cleanup fails, and preserve evidence.
  const cleanupErrors = [];
  const cleanup = async action => {
    try { await action(); } catch (error) { cleanupErrors.push(error); }
  };
  let services = [];
  await cleanup(() => { services = ownedServices(); });
  evidence.trackedServices = services.map(({id,label,track}) => ({id,label,track}));
  for (const p of services.reverse()) await cleanup(() => sync('hivecontrol',['process','stop',p.id]));
  for (const child of children) {
    try { process.kill(-child.pid,'SIGTERM'); } catch {}
  }
  await delay(500);
  for (const child of children) {
    try { process.kill(-child.pid,'SIGKILL'); } catch {}
  }
  if (server) await cleanup(() => server.done);
  if (database) await cleanup(() => database.done);
  evidence.server = server?.record;
  if (ai) {
    evidence.requests = ai.requests;
    evidence.responses = ai.responses;
    evidence.failures = ai.failures.map(f => String(f.error));
    const configs = ai.configFiles.map(f => f.path);
    await cleanup(() => ai.dispose());
    for (const config of configs) await cleanup(() => assert.rejects(access(config)));
    await cleanup(() => assert.rejects(fetch(ai.baseUrl)));
  }
  if (dbCreated) await cleanup(() => sync('docker',['rm','-f','-v',name]));
  if (volumeCreated) await cleanup(() => sync('docker',['volume','rm',name+'-db']));
  if (networkCreated) await cleanup(() => sync('docker',['network','rm',name]));
  await cleanup(() => {
    assert.equal(sync('docker',['ps','-aq','--filter',`label=${label}`]),'');
    assert.equal(sync('docker',['network','ls','-q','--filter',`label=${label}`]),'');
    const remainingVolumes = sync('docker',['volume','ls','--format','{{.Name}}']).split('\n');
    assert.ok((evidence.databaseVolumes ?? []).every(v=>!remainingVolumes.includes(v)));
    evidence.dockerResourcesRemoved = true;
    if (tracked && evidence.passed) assert.equal(services.length,2,'Expected two tracked services');
    assert.ok(ownedServices().every(p => !['running','queued','granted'].includes(p.status)));
  });
  await cleanup(() => rm(root,{recursive:true,force:true}));
  await cleanup(() => assert.rejects(access(root)));
  evidence.cleanedUp = cleanupErrors.length === 0;
  evidence.cleanupErrors = cleanupErrors.map(String);
  await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors,'Plandex consumer cleanup failed');
}
