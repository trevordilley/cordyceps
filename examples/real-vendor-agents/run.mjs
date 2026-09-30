// Build, pack, install, and execute the consumer outside the repository.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
assert.equal(process.versions.bun,undefined,'Use real Node');
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const root=await mkdtemp('/tmp/cordyceps-vendor-package-');
const run=(file,args,cwd=root)=>{const r=spawnSync(file,args,{cwd,encoding:'utf8',timeout:240000,maxBuffer:32*1024*1024});if(r.error||r.status)throw new Error(`${file}: ${r.error??r.stderr}\n${r.stdout}`);return r.stdout};
try {
 run('bun',['run','build'],repo);
 const [pack]=JSON.parse(run('npm',['pack','--json','--ignore-scripts','--pack-destination',root],repo));
 const consumer=join(root,'consumer');await mkdir(consumer);await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
 run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--omit=peer',join(root,pack.filename)],consumer);
 for(const file of ['consumer.mjs','isolation.mjs'])await copyFile(join(repo,'examples/real-vendor-agents',file),join(consumer,file));
 for(const id of (process.argv[3]||'fx,ante,grok-build,muse,minimax').split(','))await copyFile(join(repo,'harnesses',id+'.json'),join(consumer,id+'.json'));
 console.log(run(process.execPath,['consumer.mjs',resolve(process.argv[2]||'/tmp/cordyceps-vendors.json'),process.argv[3]||'fx,ante,grok-build,muse,minimax',JSON.stringify({filename:pack.filename,integrity:pack.integrity,shasum:pack.shasum})],consumer));
}finally{await rm(root,{recursive:true,force:true})}
