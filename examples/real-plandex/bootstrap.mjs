// Consumer installation helper. Run through a tracked one-shot in DevSwarm.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
assert.equal(process.versions.bun, undefined, 'Use real Node');
const revision = 'e2d772072efadbe41d2946d97d79be55532dbab5';
const root = await mkdtemp(join(tmpdir(), 'cordyceps-plandex-source-'));
const run = (cmd,args,cwd=root) => {
  const result=spawnSync(cmd,args,{cwd,stdio:'inherit'});
  assert.equal(result.status,0,`${cmd} failed`);
};
run('git',['init',root]);
run('git',['remote','add','origin','https://github.com/plandex-ai/plandex.git']);
run('git',['fetch','--depth','1','origin',revision]);
run('git',['checkout','--detach','FETCH_HEAD']);
run('go',['build','-o',join(root,'plandex'),'.'],join(root,'app/cli'));
run('go',['build','-o',join(root,'plandex-server'),'.'],join(root,'app/server'));
run('uv',['venv',join(root,'venv'),'--python','3.12']);
run('uv',['pip','install','--python',join(root,'venv/bin/python3'),'litellm==1.72.6','fastapi==0.115.12','uvicorn==0.34.1']);
run('docker',['pull','postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea']);
if(process.argv[2]) await writeFile(process.argv[2],root+'\n');
console.log(`Plandex source and dependencies: ${root}`);
console.log('Remove this exact directory after validation when you no longer need the build.');
