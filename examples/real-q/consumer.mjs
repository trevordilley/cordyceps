// Copied outside the repository. All library imports and the recipe come from the packed artifact.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, symlink, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cordyceps } from 'cordyceps';
assert.equal(process.versions.bun, undefined);
assert.equal(process.platform, 'darwin', 'Requires the macOS outer sandbox');
const [evidencePath, binaryJSON, artifactJSON] = process.argv.slice(2);
const binaries = JSON.parse(binaryJSON);
const report = { artifact: JSON.parse(artifactJSON), packageEntry: import.meta.resolve('cordyceps'), node: process.version, cases: [] };
const registry = cordyceps.createRegistry({ builtins: false });
await registry.loadFile(fileURLToPath(new URL('../harnesses/amazon-q.json', import.meta.resolve('cordyceps'))));
for (const scenario of ['text', 'tool', 'stream', 'cancel']) {
  const root = await realpath(await mkdtemp('/tmp/cordyceps-real-q-'));
  const record = { scenario, passed: false }; report.cases.push(record);
  let ai;
  try {
    ai = await cordyceps.prepare({ registry, harness: 'amazon-q', mode: 'nonInteractive' });
    const env = ai.environment({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: root, TERM: 'dumb', NO_COLOR: '1',
      BROWSER: '/usr/bin/false', NO_OPEN_BROWSER: '1', AWS_EC2_METADATA_DISABLED: 'true',
      NO_PROXY: 'localhost,127.0.0.1', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1' });
    await mkdir(join(env.HOME, '.local/bin'), { recursive: true });
    await symlink(binaries.chat, join(env.HOME, '.local/bin/kiro-cli-chat'));
    const home = await realpath(env.HOME);
    const profile = `(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(deny mach-lookup (global-name "com.apple.securityd"))(deny process-exec (literal "/usr/bin/open"))(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty") (subpath ${JSON.stringify(root)}) (subpath ${JSON.stringify(home)}))`;
    async function launch(args, control = {}) {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, binaries.q, ...args], { cwd: root, env, detached: true, stdio: ['ignore','pipe','pipe'] });
      let stdout = '', stderr = '', timedOut = false;
      child.stdout.on('data', b => { stdout += b; control.output?.(stdout + stderr); }); child.stderr.on('data', b => { stderr += b; control.output?.(stdout + stderr); });
      const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
      control.started?.(kill);
      const timer = setTimeout(() => { timedOut = true; kill(); }, 25000);
      try { return { ...await new Promise((resolve,reject) => { child.once('error', reject); child.once('close', (code,signal) => resolve({code,signal})); }), stdout, stderr, timedOut }; }
      finally { clearTimeout(timer); kill(); }
    }
    record.version = await launch(['version']);
    assert.equal(record.version.code, 0);
    assert.ok((record.version.stdout + record.version.stderr).trim());
    const secret = `fixture-${randomUUID()}`;
    await writeFile(join(root, 'fixture.txt'), secret + '\n');
    const marker = `CORDYCEPS_Q_${scenario.toUpperCase()}_OK`;
    const prompt = `cordyceps-real-q-${scenario}: ${scenario === 'tool' ? 'Read fixture.txt then report completion.' : 'Reply with the controlled test message.'}`;
    let issued = false, returned = false, release, kill, aborted = false, recovering = false;
    const gate = new Promise(resolve => { release = resolve; });
    const first = `CORDYCEPS_Q_${scenario.toUpperCase()}_FIRST`;
    let observedBeforeRelease = false;
    const control = { started(stop) { kill = stop; }, output(output) {
      if (output.includes(first) && !observedBeforeRelease) {
        observedBeforeRelease = true;
        if (scenario === 'cancel') kill(); else release();
      }
    } };
    ai.route(() => true, async route => {
      const request = route.request;
      const target = request.raw.headers['x-amz-target'];
      if (target === 'AmazonCodeWhispererService.ListAvailableModels') return route.fulfill({ amazonQ: { models: [] } });
      if (target === 'AmazonCodeWhispererService.SendTelemetryEvent') return route.fulfill({ amazonQ: { telemetry: true } });
      assert.ok(request.text.includes(prompt));
      if (recovering) return route.fulfill({ text: marker });
      if (scenario === 'stream' || scenario === 'cancel') {
        route.signal.addEventListener('abort', () => { aborted = true; release(); }, { once: true });
        return route.fulfill({ stream: (async function* () {
          yield { text: first + '\n\n' };
          // Q's parser peeks at the next event before releasing text (citation lookahead).
          yield { text: ' ' };
          await gate;
          yield { text: marker + '\n' };
        })() });
      }
      if (scenario === 'text') return route.fulfill({ text: marker });
      const result = request.toolResults.find(r => r.id === 'call_fixture');
      if (result) {
        assert.equal(result.isError, false); assert.ok(result.text.includes(secret), result.text); returned = true;
        return route.fulfill({ text: marker });
      }
      assert.equal(issued, false, 'Expected fixture result in the next generation request');
      assert.ok(request.tools.some(t => t.name === 'fs_read'));
      const call = { id: 'call_fixture', name: 'fs_read', input: { operations: [{ mode: 'Line', path: join(root, 'fixture.txt') }] } };
      record.scriptedCall = call; issued = true; return route.fulfill({ toolCall: call });
    });
    ai.recordInput(prompt); record.prompt = prompt;
    record.process = await launch([...ai.args, '--trust-all-tools', prompt], control);
    if (scenario === 'cancel') {
      for (let i = 0; i < 100 && !aborted; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(aborted, 'CLI termination must abort the provider exchange');
      const cancelled = ai.responses.find(r => r.outcome === 'aborted');
      assert.ok(cancelled, 'Cancellation is captured as aborted');
      assert.equal(cancelled.chunks.length, 2, 'No gated final output after cancellation');
    }
    ai.assertHealthy();
    assert.equal(record.process.timedOut, false);
    if (scenario === 'cancel') {
      assert.equal(record.process.signal, 'SIGKILL');
      assert.ok(!(record.process.stdout + record.process.stderr).includes(marker));
    } else {
      assert.equal(record.process.code, 0);
      assert.ok((record.process.stdout + record.process.stderr).includes(marker), JSON.stringify(record.process));
    }
    if (scenario === 'stream' || scenario === 'cancel') {
      assert.ok(observedBeforeRelease, 'Real CLI must display first chunk before gate release');
      record.observedBeforeRelease = observedBeforeRelease; record.aborted = aborted;
    }
    if (scenario === 'tool') assert.ok(issued && returned);
    if (scenario === 'cancel') {
      recovering = true;
      record.recovery = await launch([...ai.args, '--trust-all-tools', prompt]);
      assert.equal(record.recovery.code, 0); assert.equal(record.recovery.timedOut, false);
      assert.ok((record.recovery.stdout + record.recovery.stderr).includes(marker));
      ai.assertHealthy();
    }
    record.passed = true;
  } catch (error) { record.error = String(error.stack ?? error); }
  finally {
    if (ai) { record.requests = ai.requests; record.responses = ai.responses; record.failures = ai.failures.map(f => String(f.error)); await ai.dispose(); await assert.rejects(fetch(ai.baseUrl)); }
    await rm(root, { recursive: true, force: true }); record.cleanedUp = true;
    await writeFile(evidencePath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ scenario, passed: record.passed, requests: record.requests?.length, error: record.error }));
  }
}
assert.ok(report.cases.every(c => c.passed), `Q validation failed; inspect ${evidencePath}`);
