// Consumer-owned binary launch and isolation. Imports only the installed public artifact.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRegistry, prepare } from 'cordyceps';
const [output, binaryJSON, artifactJSON] = process.argv.slice(2);
const binary = JSON.parse(binaryJSON).auggie;
assert.equal(process.platform, 'darwin');
assert.equal(process.versions.bun, undefined);
const installedPath = await realpath(binary);
const installed = JSON.parse(await readFile(join(dirname(installedPath),'package.json'),'utf8'));
const executable = { path: installedPath, version: installed.version, sha256: createHash('sha256').update(await readFile(installedPath)).digest('hex') };
const evidence = { executable, artifact: JSON.parse(artifactJSON), packageEntry: import.meta.resolve('cordyceps'), node: process.version, cases: [] };
for (const scenario of ['text', 'tool', 'stream', 'cancel']) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cordyceps-auggie-')));
  const record = { scenario, passed: false }; evidence.cases.push(record);
  let ai, child, timer, release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstSeen = false, aborted = false;
  const kill = () => { if(child?.pid)try { process.kill(-child.pid, 'SIGKILL'); } catch(e) { if(e.code !== 'ESRCH') throw e; } };
  try {
    const home = join(root, 'home'), work = join(root, 'work'); await mkdir(home); await mkdir(work);
    const secret = 'fixture-' + randomUUID(); await writeFile(join(work, 'fixture.txt'), secret+'\n');
    const registry = createRegistry({ builtins: false }); await registry.loadFile(join(process.cwd(), 'auggie.json'));
    ai = await prepare({ harness: 'auggie', mode: 'nonInteractive', registry, inputs: { model: 'cordyceps-test' } });
    const marker = `CORDYCEPS_AUGGIE_${scenario.toUpperCase()}_OK`;
    const prompt = `cordyceps-auggie-${scenario}: ${scenario === 'tool' ? 'Read fixture.txt using your file tool, then finish.' : 'Reply with the controlled message.'}`;
    let issued = false, returned = false;
    ai.route(() => true, async route => {
      if (route.request.raw.path === '/get-models') return route.fulfill({ augmentModels: { defaultModel: 'cordyceps-test' } });
      if (route.request.raw.path !== '/chat-stream') return route.fulfill({ error: { status: 404, message: 'No optional service configured in this test' } });
      assert.ok(ai.requests.filter(r=>r.stream).length <= 4, 'unexpected retries');
      if (scenario === 'tool' && !issued) {
        issued = true;
        const tool = route.request.tools.find(t => t.name === 'view');
        assert.ok(tool, JSON.stringify(route.request.tools.map(t=>t.name)));
        record.tool = tool;
        return route.fulfill({ toolCall: { id: 'fixture-read', name: tool.name, input: { path: 'fixture.txt', type: 'file' } } });
      }
      if (scenario === 'tool') {
        assert.ok(route.request.toolResults.some(r => r.id === 'fixture-read' && !r.isError && r.text.includes(secret)), 'real fixture result missing');
        returned = true;
      }
      if (scenario === 'stream' || scenario === 'cancel') {
        route.signal.addEventListener('abort',()=> { aborted=true; release(); }, {once:true});
        return route.fulfill({ stream: (async function* () { yield {text: marker+'_FIRST\n'}; await gate; yield {text:marker+'_LAST\n'}; })() });
      }
      await route.fulfill({ text: marker });
    });
    const env = ai.environment({ HOME: home, PATH: dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: root,
      XDG_CONFIG_HOME: join(home,'.config'), XDG_CACHE_HOME: join(home,'.cache'), TERM:'dumb', NO_COLOR:'1', DO_NOT_TRACK:'1', OTEL_SDK_DISABLED:'true' });
    const profile = `(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:${new URL(ai.baseUrl).port}"))(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty") (subpath ${JSON.stringify(root)}))`;
    const args = [...ai.args, '--log-file',join(root,'debug.log'),'--log-level','debug','--max-turns','3','--dont-save-session','--workspace-root',work,'--instruction',prompt];
    record.args = args; ai.recordInput(prompt);
    child = spawn('/usr/bin/sandbox-exec', ['-p',profile,binary,...args], { cwd: work, env, detached:true, stdio:['ignore','pipe','pipe'] });
    let stdout='',stderr=''; child.stdout.on('data',b=>{ stdout+=b; if(!firstSeen && stdout.includes(marker+'_FIRST')) { firstSeen=true; record.incrementalBeforeTerminal=ai.responses.some(r=>r.outcome==='pending'); if(scenario==='cancel'){record.cancelledByConsumer=true;kill();}else release(); } }); child.stderr.on('data',b=>stderr+=b);
    timer=setTimeout(()=>{ record.timedOut=true; kill(); },45000);
    record.process = await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});
    Object.assign(record.process,{stdout,stderr});
    ai.assertHealthy(); assert.equal(record.timedOut,undefined);
    if(scenario==='cancel') {
      for(let attempt=0; !aborted && attempt<100; attempt++) await new Promise(resolve=>setTimeout(resolve,10));
      assert.ok(firstSeen && aborted && record.incrementalBeforeTerminal);
      assert.ok(ai.responses.some(r=>r.outcome==='aborted')); assert.ok(!stdout.includes(marker+'_LAST'));
    } else assert.equal(record.process.code,0,stderr);
    if(scenario==='stream')assert.ok(firstSeen && record.incrementalBeforeTerminal && stdout.includes(marker+'_LAST'));
    assert.ok(stdout.includes(marker),stdout); assert.ok(ai.requests.some(r=>r.text.includes(prompt)));
    assert.ok(!ai.requests.find(r=>r.stream).raw.body.includes(secret),'fixture leaked before tool');
    if(scenario==='tool')assert.ok(issued&&returned);
    assert.equal(ai.requests.filter(r=>r.stream).length,scenario==='tool'?2:1);
    ai.assertHealthy();
    record.passed=true;
  } catch(e) { record.error=String(e.stack??e); }
  finally {
    clearTimeout(timer);kill();release();
    if(ai){record.requests=ai.requests;record.responses=ai.responses;record.failures=ai.failures.map(f=>String(f.error));await ai.dispose();
      await assert.rejects(fetch(ai.baseUrl+'/get-models',{method:'POST',body:'{}'}));record.listenerClosed=true;}

    if (!record.passed) record.debug = await readFile(join(root,'debug.log'),'utf8').catch(()=> ''); await rm(root,{recursive:true,force:true});record.cleanedUp=true;await writeFile(output,JSON.stringify(evidence,null,2));
  }
  console.log(scenario,record.passed?'PASS':record.error);
}
assert.ok(evidence.cases.every(c=>c.passed),`See ${output}`);
