import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
assert.equal(process.versions.bun,undefined,'Use real Node');
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const root=await mkdtemp(join(tmpdir(),'cordyceps-gated-package-'));
const env={...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH};
function run(file,args,cwd=root){const r=spawnSync(file,args,{cwd,env,encoding:'utf8',timeout:300000,maxBuffer:24*1024*1024});if(r.error||r.status!==0)throw Error(`${file}: ${r.error||r.stderr}\n${r.stdout}`);return r.stdout}
try{
 run('bun',['run','build'],repo);
 const [artifact]=JSON.parse(run('npm',['pack','--json','--ignore-scripts','--pack-destination',root],repo));
 const consumer=join(root,'consumer');await mkdir(consumer);await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
 run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--omit=peer',join(root,artifact.filename)],consumer);
 for(const file of ['consumer.mjs','probe.mjs','antigravity.mjs','rovo.mjs','amp.mjs'])await copyFile(join(repo,'examples/real-gated-agents',file),join(consumer,file));
 for(const id of ['antigravity','rovo-dev','amp'])await copyFile(join(repo,'harnesses',id+'.json'),join(consumer,id+'.json'));
 console.log(run(process.execPath,[process.argv[3]==='--antigravity'?'antigravity.mjs':process.argv[3]==='--rovo'?'rovo.mjs':process.argv[3]==='--amp'?'amp.mjs':'consumer.mjs',resolve(process.argv[2]||'/tmp/cordyceps-gated-evidence.json'),JSON.stringify({name:artifact.filename,integrity:artifact.integrity,shasum:artifact.shasum}),...(process.argv.slice(3))],consumer));
}finally{await rm(root,{recursive:true,force:true})}
