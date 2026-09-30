// Keep selected proof, hashes and our own terminal output; omit vendor prompts.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const full=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.ok(full.passed && full.cleanedUp && full.dockerResourcesRemoved);
const secret=full.cases.find(c=>c.scenario==='read').fixtureToken;
const mainIds=new Set(full.cases.flatMap(c=>c.mainRequestIds));
const clean=text=>text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\)/g,'');
const summary={
  observedAt:new Date().toISOString(), artifact:full.artifact,
  node:full.node, upstream:full.upstream, versions:full.versions,
  binarySha256:full.binarySha256, docker:full.docker, postgresImage:full.postgresImage,
  pythonPackages:full.pythonPackages, tokenizer:full.tokenizer,
  packageEntry:full.packageEntry, cases:full.cases,
  requests:full.requests.map(r=>({id:r.id,model:r.model,stream:r.stream,method:r.raw.method,
    path:r.raw.path,kind:mainIds.has(r.id)?'main':'summary',
    containsFixtureToken:r.raw.body.includes(secret),
    rawBodySha256:createHash('sha256').update(r.raw.body).digest('hex'),
    fixtureExcerpt:r.raw.body.includes(secret)?r.raw.body.slice(r.raw.body.indexOf(secret)-35,r.raw.body.indexOf(secret)+secret.length+20):undefined})),
  cli:full.commands.map(c=>({args:c.args.slice(c.args.findIndex(a=>a.endsWith('/plandex'))+1),code:c.code,stdout:clean(c.stdout),stderr:c.stderr})),
  readBackendEvidence:full.server.stderr.split('\n').filter(l=>l.includes('checkAutoLoadContext - toAutoLoad: [fixture.txt]')||l.includes('AutoLoadContextHandler')),
  trackedServiceIds:full.trackedServices.map(p=>p.id),
  passed:full.passed,cleanedUp:full.cleanedUp,dockerResourcesRemoved:full.dockerResourcesRemoved,
  failures:full.failures,
};
await writeFile(process.argv[3],JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({passed:summary.passed,cases:summary.cases.length,requests:summary.requests.length,cleanedUp:summary.cleanedUp}));
