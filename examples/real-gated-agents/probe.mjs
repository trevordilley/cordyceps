// Consumer-side diagnostics only. Every agent runs in a disposable HOME under an OS network boundary.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.versions.bun,undefined);
assert.equal(process.platform,'darwin');
export const binaries={q:'/Users/20idemo/.local/bin/q',rovo:'/opt/homebrew/bin/acli',amp:'/Users/20idemo/.local/bin/amp',cursor:'/Users/20idemo/.local/bin/cursor-agent',auggie:'/Users/20idemo/.bun/bin/auggie',antigravity:'/Users/20idemo/.local/bin/agy',qodo:'/Users/20idemo/.bun/bin/qodo'};
export async function isolated(fn){
 const root=await realpath(await mkdtemp('/tmp/cg-'));
 const home=join(root,'home'),work=join(root,'work');await mkdir(home);await mkdir(work);
 const env={HOME:home,PATH:'/Users/20idemo/.nvm/versions/node/v22.22.3/bin:/Users/20idemo/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:root,XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),XDG_DATA_HOME:join(home,'.local/share'),BROWSER:'/usr/bin/false',NO_OPEN_BROWSER:'1',TERM:'dumb',NO_COLOR:'1',NO_PROXY:'localhost,127.0.0.1',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',DISABLE_AUTOUPDATER:'1',AUGMENT_DISABLE_AUTO_UPDATE:'1'};
 const profile=`(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(deny mach-lookup (global-name "com.apple.securityd"))(deny file-read* (subpath "/Users/20idemo/Library/Keychains"))(deny process-exec (literal "/usr/bin/open"))(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty") (subpath ${JSON.stringify(root)}))`;
 async function launch(agent,args,extra={},timeout=15000,input,writable=[],control={}){
  writable=await Promise.all(writable.map(path=>realpath(path)));
  const binary=process.env[`CORDYCEPS_${agent.toUpperCase()}_BINARY`]||binaries[agent];
  const child=spawn('/usr/bin/sandbox-exec',['-p',profile+writable.map(path=>`(allow file-write* (subpath ${JSON.stringify(path)}))`).join(''),binary,...args],{cwd:work,env:{...env,...extra},detached:true,stdio:[input===undefined?'ignore':'pipe','pipe','pipe']});
  if(input!==undefined)child.stdin.end(input);
  let stdout='',stderr='',timedOut=false;child.stdout.on('data',c=>{stdout+=c;control.onStdout?.(String(c))});child.stderr.on('data',c=>stderr+=c);
  function kill(){try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}}
  control.onStart?.({kill});
  const timer=setTimeout(()=>{timedOut=true;kill()},timeout);
  try {const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}))});return {binary,args,...status,timedOut,stdout,stderr};}finally{clearTimeout(timer);kill()}
 }
 try{return await fn({root,home,work,env,launch})}finally{await rm(root,{recursive:true,force:true})}
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const report={node:process.version,date:new Date().toISOString(),cases:[]};
 for(const agent of Object.keys(binaries)){
  const entry=await isolated(async({launch})=>({agent,version:await launch(agent,agent==='q'?['version']:['--version']),help:await launch(agent,agent==='rovo'?['rovodev','run','--help']:['--help'])}));
  report.cases.push(entry);console.log(JSON.stringify(entry));
 }
 await writeFile(process.argv[2]||'/tmp/cordyceps-gated-help.json',JSON.stringify(report,null,2)+'\n');
}
