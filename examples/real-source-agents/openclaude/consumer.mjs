// Copied into a disposable npm consumer. Public imports only; all launch logic is consumer-owned.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { prepare, createRegistry } from 'cordyceps';

assert.equal(process.versions.bun, undefined);
assert.equal(process.platform, 'darwin', 'Requires macOS sandbox-exec; never silently remove isolation');
const [evidencePath, binaryJSON, artifactJSON, selection = 'openclaude', scenarios = 'text,tool'] = process.argv.slice(2);
const binaries = JSON.parse(binaryJSON);
const evidence = { date: new Date().toISOString(), node: process.version, platform: process.platform,
  isolation: 'macOS sandbox-exec: outbound loopback only; writes restricted to disposable home/work and generated config directories; allowlisted child environment',
  packageEntry: import.meta.resolve('cordyceps'), artifact: JSON.parse(artifactJSON), cases: [] };
const registry = createRegistry({ builtins: false });
for (const name of selection.split(',')) await registry.loadFile(join(process.cwd(), 'harnesses', `${name}.json`));

async function launch(binary, args, cwd, env, writable) {
  const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
    + '(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty")'
    + writable.map(path => `(subpath ${JSON.stringify(path)})`).join(' ') + ')';
  const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, binary, ...args], {
    cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  const timer = setTimeout(() => { timedOut = true; kill(); }, 45_000);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return { ...result, stdout, stderr, timedOut };
  } finally { clearTimeout(timer); kill(); }
}

assert.equal(selection, 'openclaude');
assert.ok(scenarios.split(',').every(s => ['text', 'tool'].includes(s)));
for (const harness of selection.split(',')) for (const scenario of scenarios.split(',')) {
  const root = await realpath(await mkdtemp(join(tmpdir(), `cordyceps-provider-${harness}-`)));
  const record = { harness, scenario, binary: binaries[harness], passed: false };
  evidence.cases.push(record);
  let ai;
  try {
    const home = join(root, 'home'), work = join(root, 'work');
    await mkdir(home); await mkdir(work);
    const fixture = join(work, 'fixture.txt'), token = `fixture-${randomUUID()}`;
    await writeFile(fixture, token + '\n');
    ai = await prepare({ harness, registry, mode: 'nonInteractive' });
    const env = ai.environment({ HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      TMPDIR: root, TERM: 'xterm-256color', SHELL: '/bin/sh', XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local/share'), XDG_STATE_HOME: join(home, '.local/state'), XDG_CACHE_HOME: join(home, '.cache'),
      NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', DO_NOT_TRACK: '1',
    });
    env.OPENCLAUDE_CONFIG_DIR = join(home, '.openclaude');
    const writable = [root, ...await Promise.all(ai.configFiles.map(f => realpath(dirname(f.path))))];
    record.version = await launch(binaries[harness], ['--version'], work, env, writable);
    assert.equal(record.version.code, 0, record.version.stderr);
    assert.ok(record.version.stdout.trim(), 'Missing version observation');
    const marker = `CORDYCEPS_${harness}_${scenario}_OK`;
    const prompt = `cordyceps-provider-${scenario}: ${scenario === 'tool' ? 'Read fixture.txt, then report completion.' : 'Reply with the controlled test message.'}`;
    let issued = false, returned = false;
    const isTitle = request => request.text.startsWith('Generate a short title (four words or less)')
      || request.text.startsWith('You will generate a short title based on the first message');
    ai.route(() => true, async route => {
      const request = route.request;
      assert.ok(ai.requests.length <= 12, 'unexpected request loop');
      if (request.raw.path.includes('count_tokens')) return route.fulfill({ inputTokens: 100 });
      if (request.raw.method === 'HEAD') return route.fulfill({ health: true });
      // Native title/background requests remain captured; they cannot satisfy the prompt assertions.
      if (!request.text.includes(prompt) || isTitle(request)) return route.fulfill({ text: 'Cordyceps fixture' });
      if (scenario !== 'tool') return route.fulfill({ text: marker });
      const result = request.toolResults.find(r => r.id === 'fixture_read');
      if (result) {
        assert.equal(result.isError, false, result.text);
        assert.ok(result.text.includes(token), `Actual tool result lacks fixture token: ${result.text}`);
        returned = true;
        return route.fulfill({ text: marker });
      }
      assert.equal(issued, false, 'expected actual tool result in next request');
      const names = request.tools.map(t => t.name);
      let name, input;
      if (names.includes('Read')) { name = 'Read'; input = { file_path: fixture }; }
      else throw new Error(`No read tool recognized: ${JSON.stringify(request.tools)}`);
      issued = true;
      record.scriptedCall = { id: 'fixture_read', name, input };
      return route.fulfill({ toolCall: record.scriptedCall });
    });
    const model = 'claude-sonnet-4-5-20250929';
    const args = [...ai.args, '--dangerously-skip-permissions', '--model', model, '--output-format', 'json', '--max-turns', '3', prompt];
    record.args = args; record.prompt = prompt;
    ai.recordInput(prompt);
    record.process = await launch(binaries[harness], args, work, env, writable);
    await new Promise(resolve => setTimeout(resolve, 30));
    record.requests = ai.requests; record.responses = ai.responses; record.failures = ai.failures.map(f => String(f.error));
    ai.assertHealthy();
    assert.equal(record.process.timedOut, false, record.process.stderr);
    assert.equal(record.process.code, 0, record.process.stderr);
    assert.ok(record.process.stdout.includes(marker), record.process.stdout);
    const prompts = ai.requests.filter(r => r.text.includes(prompt) && !isTitle(r));
    assert.ok(prompts.length > 0, 'Missing actual prompt request');
    assert.ok(!prompts[0].raw.body.includes(token), 'Token leaked before real read');
    if (scenario === 'tool') {
      assert.ok(issued && returned, 'No actual tool round trip');
      assert.ok(prompts[1]?.toolResults.some(r => r.id === 'fixture_read' && r.text.includes(token)), 'Fixture result must be in the actual next prompt request');
    }
    record.assertions = { capturedPrompt: true, controlledBinaryOutput: true, tokenAbsentBeforeTool: true, actualToolResultInNextRequest: scenario === 'tool' ? returned : null, healthy: true };
    record.passed = true;
  } catch (e) { record.error = String(e.stack ?? e); }
  finally {
    if (ai) {
      record.requests ??= ai.requests; record.responses ??= ai.responses;
      record.failures ??= ai.failures.map(f => String(f.error));
      await ai.dispose(); await assert.rejects(fetch(ai.baseUrl));
      for (const f of ai.configFiles) await assert.rejects(access(f.path));
    }
    await rm(root, { recursive: true, force: true }); await assert.rejects(access(root));
    record.cleanedUp = true;
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ harness, scenario, passed: record.passed, requests: record.requests?.length,
      error: record.error?.slice(0, 1000), stderr: record.process?.stderr.slice(0, 1000) }));
  }
}
process.exitCode = evidence.cases.every(c => c.passed) ? 0 : 1;
