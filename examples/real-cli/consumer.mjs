// This file is copied OUTSIDE the repository and imports only the public package.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, access, realpath, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { cordyceps } from 'cordyceps';

assert.equal(process.platform, 'darwin', 'This example requires macOS sandbox-exec; do not silently drop network isolation.');
assert.equal(process.versions.bun, undefined, 'Use real Node, not a Bun node shim');
const [evidencePath, binaryJSON, artifactJSON, selection] = process.argv.slice(2);
const binaries = JSON.parse(binaryJSON);
const evidence = { artifact: JSON.parse(artifactJSON), node: process.version, platform: process.platform,
  packageEntry: import.meta.resolve('cordyceps'), cases: [] };

// Consumer owns every process, including a whole process group on POSIX.
async function launch(binary, args, cwd, env, interactive) {
  let command = binary, commandArgs = args;
  if (process.platform === 'darwin') {
    command = '/usr/bin/sandbox-exec';
    const writable = [await realpath(dirname(cwd)), ...(env.CODEX_HOME ? [await realpath(env.CODEX_HOME)] : [])];
    const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
      + '(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$")'
      + writable.map(path => `(subpath ${JSON.stringify(path)})`).join(' ') + ')';
    commandArgs = ['-p', profile, binary, ...args];
  }
  if (interactive) {
    commandArgs = ['drive-pty.py', interactive.prompt, interactive.marker, command, ...commandArgs];
    command = binaries.python;
    commandArgs[0] = join(process.cwd(), 'drive-pty.py');
  }
  const child = spawn(command, commandArgs, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false, ptyGroup;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => {
    stderr += chunk;
    const reported = stderr.match(/CORDYCEPS_PTY_GROUP=(\d+)/);
    if (reported) ptyGroup = Number(reported[1]);
  });
  const kill = () => {
    // Close the driver (and hence its PTY master) before the terminal child.
    for (const group of [child.pid, ptyGroup].filter(Boolean)) {
      try { process.kill(-group, 'SIGKILL'); }
      catch (error) { if (!['ESRCH', 'EPERM'].includes(error.code)) throw error; }
    }
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
  for (const harness of (selection === '--interactive' ? ['codex'] : selection === '--interactive-claude' ? ['claude-code'] : ['claude-code', 'codex'])) {
    for (const scenario of (selection?.startsWith('--interactive') ? ['interactive'] : ['text', 'tool'])) {
      const root = await mkdtemp(join(tmpdir(), `cordyceps-real-${harness}-`));
      let ai;
      const record = { harness, scenario, passed: false };
      evidence.cases.push(record);
      try {
        const home = join(root, 'home'), work = join(root, 'work');
        await mkdir(home); await mkdir(work);
        const fixturePath = join(work, 'fixture.txt');
        // The secret is absent from the prompt/response; only the real tool can return it.
        const secret = `fixture-${randomUUID()}`;
        await writeFile(fixturePath, secret + '\n');
        ai = await cordyceps.prepare({ harness, mode: scenario === 'interactive' ? 'interactive' : 'nonInteractive' });
        const env = ai.environment({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home,
          TMPDIR: root, TERM: 'xterm-256color', XDG_CONFIG_HOME: join(home, '.config'), SHELL: '/bin/sh',
          CLAUDE_CONFIG_DIR: join(home, '.claude'), DISABLE_AUTOUPDATER: '1',
          NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
          HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
          ALL_PROXY: 'http://127.0.0.1:1', http_proxy: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1',
        });
        if (scenario === 'interactive' && harness === 'claude-code') {
          // Fields observed in this CLI's freshly generated disposable config.
          await mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
          const config = { hasCompletedOnboarding: true,
            customApiKeyResponses: { approved: [ai.apiKey.slice(-20)], rejected: [] },
            projects: { [await realpath(work)]: { hasTrustDialogAccepted: true } } };
          await writeFile(join(env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify(config));
        }
        const binary = binaries[harness === 'codex' ? 'codex' : 'claude'];
        record.version = await launch(binary, ['--version'], work, env);
        assert.equal(record.version.code, 0, record.version.stderr);
        assert.ok(record.version.stdout.trim(), 'version probe returned no version');
        const marker = `CORDYCEPS_${harness}_${scenario}_OK`;
        const prompt = `cordyceps-real-cli-${scenario}: ${scenario === 'tool' ? 'Read fixture.txt, then report completion.' : 'Reply with the controlled test message.'}`;
        const callId = 'call_fixture_read';
        let issued = false, returned = false;
        const isTitle = request => scenario === 'interactive' && harness === 'claude-code'
          && request.text.includes('Return JSON with a single \"title\" field.') && request.text.includes('<session>');
        ai.route(() => true, async route => {
          const request = route.request;
          assert.ok(ai.requests.length <= 4, 'unexpected retry/loop');
          if (isTitle(request)) return route.fulfill({ text: '{"title":"Local mock PTY"}' });
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
        const args = scenario === 'interactive'
          ? harness === 'claude-code'
            ? [...ai.args, '--debug-file', join(root, 'debug.log'), '--bare', '--restricted', '--safe-mode', '--model', 'claude-sonnet-4-6', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--permission-mode', 'dontAsk']
            : [...ai.args, '--no-alt-screen', '-m', 'gpt-5.4', '--dangerously-bypass-approvals-and-sandbox']
          : harness === 'claude-code'
          ? [...ai.args, '--model', 'claude-sonnet-4-6', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--safe-mode', '--no-session-persistence', '--tools', scenario === 'tool' ? 'Read' : '', '--allowedTools', 'Read', '--permission-mode', 'dontAsk', '--output-format', 'json', prompt]
          : [...ai.args, '--skip-git-repo-check', '--ephemeral', '--ignore-rules', '--json', '-m', 'gpt-5.4', '-s', 'danger-full-access', '-c', 'shell_environment_policy.inherit="none"', prompt];
        ai.recordInput(prompt);
        record.args = args;
        record.prompt = prompt;
        record.process = await launch(binary, args, work, env, scenario === 'interactive' ? { prompt, marker } : undefined);
        // Preserve exact observed requests even on a failed run; no replacement fetches.
        if (scenario === 'interactive' && harness === 'claude-code') {
          record.debug = await readFile(join(root, 'debug.log'), 'utf8').catch(() => '');
          record.isolatedConfig = {};
          for (const file of await readdir(home, { recursive: true })) {
            if (file.endsWith('.claude.json')) record.isolatedConfig[file] = JSON.parse(await readFile(join(home, file), 'utf8'));
          }
        }
        record.requests = ai.requests;
        record.responses = ai.responses;
        record.failures = ai.failures.map(f => String(f.error ?? f));
        ai.assertHealthy();
        assert.equal(record.process.timedOut, false, record.process.stderr);
        assert.equal(record.process.code, 0, scenario === 'interactive'
          ? 'Interactive probe did not observe a provider reply; inspect the preserved PTY transcript in the evidence file.'
          : record.process.stderr || 'CLI process failed');
        assert.ok(record.process.stdout.includes(marker), record.process.stdout);
        assert.ok(ai.requests.some(request => request.text.includes(prompt)), 'installed CLI request was not captured');
        assert.ok(!ai.requests[0].raw.body.includes(secret), 'fixture token must not leak into initial request');
        assert.equal(ai.requests.filter(request => !isTitle(request)).length, scenario === 'tool' ? 2 : 1);
        assert.ok(ai.requests.filter(isTitle).length <= 1, 'unexpected repeated session title request');
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
