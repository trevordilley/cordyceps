// This file is copied OUTSIDE the repository and imports only the public package.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { cordyceps } from 'cordyceps';

assert.equal(process.platform, 'darwin', 'This example requires macOS sandbox-exec; do not silently drop network isolation.');
assert.equal(process.versions.bun, undefined, 'Use real Node, not a Bun node shim');
const [evidencePath, binaryJSON, artifactJSON] = process.argv.slice(2);
const binaries = JSON.parse(binaryJSON);
const evidence = { artifact: JSON.parse(artifactJSON), node: process.version, platform: process.platform,
  packageEntry: import.meta.resolve('cordyceps'), cases: [] };

// Consumer owns every process, including a whole process group on POSIX.
async function launch(binary, args, cwd, env) {
  let command = binary, commandArgs = args;
  if (process.platform === 'darwin') {
    command = '/usr/bin/sandbox-exec';
    const writable = [await realpath(dirname(cwd)), ...(env.CODEX_HOME ? [await realpath(env.CODEX_HOME)] : [])];
    const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
      + '(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty")'
      + writable.map(path => `(subpath ${JSON.stringify(path)})`).join(' ') + ')';
    commandArgs = ['-p', profile, binary, ...args];
  }
  const child = spawn(command, commandArgs, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const kill = () => {
    try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const timer = setTimeout(() => { timedOut = true; kill(); }, 35_000);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return { ...result, stdout, stderr, timedOut };
  } finally { clearTimeout(timer); kill(); }
}

try {
  for (const harness of ['claude-code', 'codex']) {
    for (const scenario of ['text', 'tool']) {
      const root = await mkdtemp(join(tmpdir(), `cordyceps-real-${harness}-`));
      let ai;
      const record = { harness, scenario };
      evidence.cases.push(record);
      try {
        const home = join(root, 'home'), work = join(root, 'work');
        await mkdir(home); await mkdir(work);
        const fixturePath = join(work, 'fixture.txt');
        // The secret is absent from the prompt/response; only the real tool can return it.
        const secret = `fixture-${randomUUID()}`;
        await writeFile(fixturePath, secret + '\n');
        ai = await cordyceps.prepare({ harness, mode: 'nonInteractive' });
        const env = ai.environment({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home,
          TMPDIR: root, TERM: 'xterm-256color', XDG_CONFIG_HOME: join(home, '.config'), SHELL: '/bin/sh',
          CLAUDE_CONFIG_DIR: join(home, '.claude'), DISABLE_AUTOUPDATER: '1',
          NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
          HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
          ALL_PROXY: 'http://127.0.0.1:1', http_proxy: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1',
        });
        const binary = binaries[harness === 'codex' ? 'codex' : 'claude'];
        record.version = await launch(binary, ['--version'], work, env);
        assert.equal(record.version.code, 0, record.version.stderr);
        assert.ok(record.version.stdout.trim(), 'version probe returned no version');
        const marker = `CORDYCEPS_${harness}_${scenario}_OK`;
        const prompt = `cordyceps-real-cli-${scenario}: ${scenario === 'tool' ? 'Read fixture.txt, then report completion.' : 'Reply with the controlled test message.'}`;
        const callId = 'call_fixture_read';
        let issued = false, returned = false;
        ai.route(() => true, async route => {
          const request = route.request;
          assert.ok(ai.requests.length <= 4, 'unexpected retry/loop');
          if (scenario !== 'tool') return route.fulfill({ text: marker });
          const result = request.toolResults.find(result => result.id === callId);
          if (result) {
            assert.equal(result.isError, false);
            assert.ok(result.text.includes(secret), `real read failed: ${result.text}`);
            returned = true;
            return route.fulfill({ text: marker });
          }
          assert.equal(issued, false, 'expected tool result in the next request');
          let call;
          if (harness === 'claude-code') {
            assert.ok(request.tools.some(tool => tool.name === 'Read'));
            call = { id: callId, name: 'Read', input: { file_path: fixturePath } };
          } else {
            const names = request.tools.map(tool => tool.name);
            if (names.includes('exec_command')) call = { id: callId, name: 'exec_command', input: { cmd: '/bin/cat fixture.txt', workdir: work, login: false, max_output_tokens: 1000 } };
            else if (names.includes('shell')) call = { id: callId, name: 'shell', input: { command: ['/bin/cat', 'fixture.txt'], workdir: work, timeout_ms: 1000 } };
            else throw new Error(`No supported real read tool: ${names.join(', ')}`);
          }
          record.scriptedCall = call;
          issued = true;
          return route.fulfill({ toolCall: call });
        });
        const args = harness === 'claude-code'
          ? [...ai.args, '--model', 'claude-sonnet-4-6', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--safe-mode', '--no-session-persistence', '--tools', scenario === 'tool' ? 'Read' : '', '--allowedTools', 'Read', '--permission-mode', 'dontAsk', '--output-format', 'json', prompt]
          : [...ai.args, '--skip-git-repo-check', '--ephemeral', '--ignore-rules', '--json', '-m', 'gpt-5.4', '-s', 'danger-full-access', '-c', 'shell_environment_policy.inherit="none"', prompt];
        ai.recordInput(prompt);
        record.args = args;
        record.prompt = prompt;
        record.process = await launch(binary, args, work, env);
        // Preserve exact observed requests even on a failed run; no replacement fetches.
        record.requests = ai.requests;
        record.responses = ai.responses;
        record.failures = ai.failures.map(f => String(f.error ?? f));
        ai.assertHealthy();
        assert.equal(record.process.timedOut, false, record.process.stderr);
        assert.equal(record.process.code, 0, record.process.stderr);
        assert.ok(record.process.stdout.includes(marker), record.process.stdout);
        assert.ok(ai.requests.some(request => request.text.includes(prompt)), 'installed CLI request was not captured');
        assert.ok(!ai.requests[0].raw.body.includes(secret), 'fixture token must not leak into initial request');
        assert.equal(ai.requests.length, scenario === 'tool' ? 2 : 1);
        if (scenario === 'tool') assert.ok(issued && returned);
        record.passed = true;
      } catch (error) {
        record.error = String(error.stack ?? error);
        throw error;
      } finally {
        if (ai) {
          const configs = ai.configFiles.map(file => file.path);
          await ai.dispose();
          for (const path of configs) await assert.rejects(access(path));
          await assert.rejects(fetch(ai.baseUrl));
        }
        await rm(root, { recursive: true, force: true });
        await assert.rejects(access(root));
        record.cleanedUp = true;
        await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
        console.log(JSON.stringify({ harness, scenario, passed: record.passed ?? false,
          requests: record.requests?.length, cleanedUp: record.cleanedUp }));
      }
    }
  }
} finally {
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
}
