// Consumer-owned package installation and executable selection.
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
assert.equal(process.versions.bun, undefined, 'Use real Node');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-editors-package-'));
const run = (cmd, args, cwd = root) => { const p = spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:240000,maxBuffer:20*1024*1024}); if(p.error || p.status) throw new Error(`${cmd}: ${p.error ?? p.stderr}\n${p.stdout}`); return p.stdout; };
try {
  run('bun',['run','build'],repo);
  const [pack] = JSON.parse(run('npm',['pack','--json','--ignore-scripts','--pack-destination',root],repo));
  const consumer=join(root,'consumer'); await mkdir(consumer);
  await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--omit=peer',join(root,pack.filename)],consumer);
  await copyFile(join(repo,'examples/real-editor-agents/consumer.mjs'),join(consumer,'consumer.mjs'));
  for (const id of ['aider','cline']) await copyFile(join(repo,'harnesses',id+'.json'),join(consumer,id+'.json'));
  const binaries=Object.fromEntries(['aider','cline'].map(n=>[n,run('/usr/bin/which',[n]).trim()]));
  console.log(run(process.execPath,['consumer.mjs',resolve(process.argv[2]??'/tmp/cordyceps-editor-evidence.json'),JSON.stringify(binaries),JSON.stringify({filename:pack.filename,integrity:pack.integrity}),process.argv[3]??'all'],consumer));
} finally { await rm(root,{recursive:true,force:true}); }
