// Test code launches only the application; its worker owns the real agent.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cordyceps } from 'cordyceps';
import { environment, launch } from '../real-extra-cli/isolation.mjs';

assert.equal(process.platform, 'darwin', 'This verification requires macOS sandbox-exec');
assert.equal(process.versions.bun, undefined, 'Use actual Node >=22');
assert.ok(isAbsolute(process.env.CODEX_BINARY ?? ''), 'Set CODEX_BINARY to an installed executable');
const appPath = fileURLToPath(new URL('./app.mjs', import.meta.url));
const cases = [];
for (const scenario of ['text', 'tool']) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cordyceps-inherited-')));
  const home = join(root, 'home'), cwd = join(root, 'workspace');
  let ai, configs = [];
  try {
    await mkdir(home); await mkdir(cwd);
    const token = `file-only-${randomUUID()}`;
    await writeFile(join(cwd, 'fixture.txt'), token);
    ai = await cordyceps.prepare({ harness: 'codex', mode: 'nonInteractive' });
    configs = ai.configFiles.map(file => file.path);
    const prompt = `Application request ${randomUUID()}: ${scenario === 'tool' ? 'Read fixture.txt.' : 'Say hello.'}`;
    const answer = `Application reply ${randomUUID()}`;
    let readResult;
    ai.route(() => true, route => {
      const request = route.request;
      assert.ok(request.text.includes(prompt));
      assert.ok(ai.requests.length <= 2, 'Unexpected retry or extra model turn');
      if (scenario === 'text') return route.fulfill({ text: answer });
      readResult = request.toolResults.find(result => result.id === 'read-fixture');
      if (readResult) {
        assert.equal(readResult.isError, false);
        assert.ok(readResult.text.includes(token));
        return route.fulfill({ text: answer });
      }
      assert.ok(!request.text.includes(token));
      assert.ok(request.tools.some(tool => tool.name === 'exec_command'));
      return route.fulfill({ toolCall: { id: 'read-fixture', name: 'exec_command',
        input: { cmd: '/bin/cat fixture.txt', workdir: cwd, login: false, max_output_tokens: 1000 } } });
    });
    // Configure the top-level app once. Its worker and Codex inherit these values.
    const env = ai.environment({ ...environment(home, root), CODEX_BINARY: process.env.CODEX_BINARY });
    assert.ok(configs.some(path => dirname(path) === env.CODEX_HOME));
    const result = await launch(process.execPath, [appPath, prompt], cwd, env,
      [root, await realpath(env.CODEX_HOME)]);
    assert.equal(result.timedOut, false);
    assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
    const reply = JSON.parse(result.stdout);
    assert.equal(reply.text, answer);
    assert.equal(reply.workerParentPid, reply.appPid);
    assert.equal(new Set([reply.appPid, reply.workerPid, reply.harnessPid]).size, 3);
    assert.equal(ai.requests.length, scenario === 'tool' ? 2 : 1);
    if (scenario === 'tool') assert.ok(readResult);
    ai.assertHealthy();
    cases.push({ scenario, passed: true, ...reply, providerRequests: ai.requests.length,
      generatedConfigInherited: true, realFileRead: Boolean(readResult) });
  } finally {
    // launch() awaits the app and checks its entire process group before returning.
    try { await ai?.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
  }
  for (const path of [...configs, root]) await assert.rejects(access(path));
  if (ai) await assert.rejects(fetch(ai.baseUrl, { signal: AbortSignal.timeout(2000) }));
}
const evidence = { node: process.version, packageEntry: import.meta.resolve('cordyceps'), cases,
  cleanup: { processGroupsStopped: true, configRemoved: true, listenersClosed: true } };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
