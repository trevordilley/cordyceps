// Copied into a clean npm consumer. Only public package imports are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { prepare, createRegistry } from 'cordyceps';
assert.equal(process.platform, 'darwin', 'Requires macOS sandbox-exec; network isolation is mandatory');
assert.equal(process.versions.bun, undefined);
const [evidencePath, artifactJSON, selected] = process.argv.slice(2);
const binaries = { openclaw: process.env.OPENCLAW_BINARY, hermes: process.env.HERMES_BINARY };
const names = selected.split(',');
const evidence = { observedAt: new Date().toISOString(), artifact: JSON.parse(artifactJSON), node: process.version, platform: process.platform, packageEntry: import.meta.resolve('cordyceps'), cases: [] };
const registry = createRegistry({ builtins: false });
for (const name of names) await registry.loadFile(join(process.cwd(), `${name}.json`));
async function launch(binary, args, cwd, env, writable, cancelWhen, onOutput, lockFiles = []) {
  const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
    + '(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty")'
    + (await Promise.all(writable.map(p => realpath(p)))).map(p => `(subpath ${JSON.stringify(p)})`).join(' ') + lockFiles.map(p => `(literal ${JSON.stringify(p)})`).join(' ') + ')';
  const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, binary, ...args], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false, cancelled = false;
  child.stdout.on('data', chunk => { stdout += chunk; onOutput?.(stdout); }); child.stderr.on('data', chunk => { stderr += chunk; });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  const timer = setTimeout(() => { timedOut = true; kill(); }, 90_000);
  let closed = false;
  if (cancelWhen) cancelWhen.then(() => { if (!closed) { cancelled = true; kill(); } }, () => {});
  try { const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); }); return { ...result, stdout, stderr, timedOut, cancelled }; }
  finally { closed = true; clearTimeout(timer); kill(); }
}
let failures = 0;
for (const harness of names) {
  for (const scenario of ['text', 'tool', 'cancel']) {
    const root = await realpath(await mkdtemp(join(tmpdir(), `cordyceps-${harness}-`))); let ai;
    const lockFiles = [];
    const record = { harness, scenario, binary: binaries[harness], passed: false }; evidence.cases.push(record);
    try {
      const home = join(root, 'home'), work = join(root, 'work'); await mkdir(home); await mkdir(work);
      const stateDir = join(home, '.openclaw'); await mkdir(stateDir);
      if (harness === 'openclaw') {
        const lockDir = `/private/tmp/openclaw-state-locks-${process.getuid()}`;
        await mkdir(lockDir, { recursive: true, mode: 0o700 });
        for (const db of [join(stateDir, 'state/openclaw.sqlite'), join(stateDir, 'agents/main/agent/openclaw-agent.sqlite')]) {
          const hash = createHash('sha256').update(db).digest('hex').slice(0, 8);
          for (const family of ['state-lifecycle', 'gateway-lifecycle']) for (const suffix of ['', '-journal', '-wal', '-shm']) {
            const path = `${lockDir}/${family}.${hash}.lock.sqlite${suffix}`;
            await assert.rejects(access(path), { code: 'ENOENT' }, 'Refuse to reuse another process lock');
            lockFiles.push(path);
          }
        }
      }
      const fixture = join(work, 'fixture.txt'), token = `fixture-${randomUUID()}`; await writeFile(fixture, token + '\n');
      const prompt = `cordyceps-${harness}-${scenario}: ${scenario === 'tool' ? 'Read fixture.txt and report completion.' : 'Reply with the controlled test message.'}`;
      ai = await prepare({ harness, registry, mode: 'nonInteractive', inputs: { prompt } });
      const env = ai.environment({ PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, TMPDIR: root, TERM: 'xterm-256color', SHELL: '/bin/sh', XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PYTHONDONTWRITEBYTECODE: '1', OPENCLAW_STATE_DIR: join(home, '.openclaw'), OPENCLAW_NO_RESPAWN: '1', NODE_COMPILE_CACHE: join(root, 'node-cache'),
        NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' });
      const writable = [root, ...ai.configFiles.map(f => dirname(f.path))];
      record.version = await launch(binaries[harness], ['--version'], work, env, writable); assert.equal(record.version.code, 0, record.version.stderr);
      const marker = `CORDYCEPS_${harness}_${scenario}_OK`;
      let issued = false, returned = false, heldResolve, releaseText;
      let textGateOpen = false;
      const textGate = new Promise(resolve => { releaseText = () => { textGateOpen = true; resolve(); }; });
      const prefix = marker.slice(0, 12);
      const onOutput = stdout => { if (scenario === 'text' && !textGateOpen && stdout.includes(prefix.slice(0, 8))) { record.incrementalOutputBeforeCompletion = true; releaseText(); } };
      const held = new Promise(resolve => { heldResolve = resolve; });
      ai.route(() => true, async route => {
        assert.ok(ai.requests.length <= 40, 'unexpected retry/loop');
        const request = route.request;
        if (harness === 'hermes' && request.raw.path.split('?')[0] !== '/v1/chat/completions') {
          record.metadataProbes = (record.metadataProbes ?? 0) + 1;
          return route.fulfill({ error: { status: 404, message: 'This controlled endpoint supplies no local model metadata' } });
        }
        if (harness === 'hermes' && request.tools.length === 0 && request.text.startsWith('You name chat sessions.')) {
          record.titleRequests = (record.titleRequests ?? 0) + 1;
          return route.fulfill({ text: JSON.stringify({ title: 'Controlled consumer verification' }) });
        }
        if (scenario === 'cancel') { heldResolve(); return route.untilAborted(); }
        if (scenario === 'text') return route.fulfill({ stream: (async function* () {
          record.incrementalOutputBeforeCompletion = false;
          const fallback = setTimeout(releaseText, 1000);
          try { yield { text: prefix }; await textGate; yield { text: marker.slice(12) }; } finally { clearTimeout(fallback); }
        })() });
        if (request.toolResults.length) {
          const result = request.toolResults.at(-1); assert.equal(result.isError, false); assert.ok(result.text.includes(token), `real fixture read failed: ${result.text}`); returned = true; return route.fulfill({ text: marker });
        }
        assert.equal(issued, false, 'tool result missing from next request');
        assert.ok(!request.raw.body.includes(token), 'fixture content must not exist before the native tool runs');
        const names = request.tools.map(t => t.name);
        let call;
        if (names.includes('read')) call = { id: 'fixturecall', name: 'read', input: { path: fixture } };
        else if (names.includes('read_file')) call = { id: 'fixturecall', name: 'read_file', input: harness === 'hermes' ? { path: fixture } : { file_path: fixture } };
        else if (names.includes('bash')) call = { id: 'fixturecall', name: 'bash', input: { command: '/bin/cat fixture.txt' } };
        else throw new Error(`No supported read tool: ${names.join(', ')}`);
        issued = true; record.scriptedCall = call; return route.fulfill({ toolCall: call });
      });
      const args = harness === 'openclaw' ? [...ai.args, '--state-dir', stateDir, '--cwd', work] : [...ai.args];
      record.args = args; record.prompt = prompt; ai.recordInput(prompt);
      record.process = await launch(binaries[harness], args, work, env, writable, scenario === 'cancel' ? held : undefined, onOutput, lockFiles);
      if (scenario === 'cancel') {
        assert.equal(record.process.cancelled, true, record.process.stderr);
        for (let n = 0; n < 100 && !ai.responses.some(r => r.outcome === 'aborted'); n++) await new Promise(r => setTimeout(r, 10));
        assert.ok(ai.responses.some(r => r.outcome === 'aborted'), 'provider disconnect was not observed');
      } else {
        assert.equal(record.process.timedOut, false, record.process.stderr); assert.equal(record.process.code, 0, record.process.stderr);
        // stream-json separates deltas; parse text segments before asserting the complete marker.
        const parsedOutput = record.process.stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
        const assistantText = parsedOutput.filter(event => event.role === 'assistant').map(event => event.content ?? '').join('');
        assert.ok(record.process.stdout.includes(marker) || assistantText.includes(marker), record.process.stdout);
        if (scenario === 'text') {
          record.providerStreaming = ai.requests.some(request => request.stream);
          // OpenClaw JSON mode buffers final output; provider streaming is recorded separately.
          assert.equal(record.providerStreaming, true);
          if (harness === 'hermes') assert.equal(record.incrementalOutputBeforeCompletion, true);
          else assert.equal(record.incrementalOutputBeforeCompletion, false, 'Reassess the documented OpenClaw output buffering');
        }
        if (scenario === 'tool') assert.ok(issued && returned);
      }
      assert.ok(ai.requests.some(r => r.text.includes(prompt)), 'actual prompt not captured');
      assert.ok(!ai.requests[0].raw.body.includes(token), 'fixture token leaked before actual tool execution');
      ai.assertHealthy(); record.passed = true;
    } catch (error) { record.error = String(error.stack ?? error); failures++; }
    finally {
      if (ai) {
        record.requests = ai.requests; record.responses = ai.responses; record.failures = ai.failures.map(f => String(f.error));
        const configs = ai.configFiles.map(f => f.path); await ai.dispose(); for (const p of configs) await assert.rejects(access(p)); await assert.rejects(fetch(ai.baseUrl));
      }
      for (const path of lockFiles) { await rm(path, { force: true }); await assert.rejects(access(path)); }
      await rm(root, { recursive: true, force: true }); await assert.rejects(access(root)); record.cleanedUp = true;
      await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
      console.log(JSON.stringify({ harness, scenario, passed: record.passed, requests: record.requests?.length, error: record.error?.split('\n')[0] }));
    }
  }
}
assert.equal(failures, 0, `Inspect ${evidencePath}: ${failures} real-agent cases failed`);
