// Copied outside the repository; only public installed-package imports.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { prepare, createRegistry } from 'cordyceps';
import { environment, launch } from './isolation.mjs';
assert.equal(process.versions.bun, undefined);
assert.equal(process.platform, 'darwin');
const [evidencePath, deps, artifactJSON, distributionJSON] = process.argv.slice(2);
const evidence = { date: new Date().toISOString(), node: process.version, platform: process.platform,
  sourceCommit: '98039676f363d6f0c06dbed25f3180463e5952af',
  packageEntry: import.meta.resolve('cordyceps'), artifact: JSON.parse(artifactJSON), distribution: JSON.parse(distributionJSON),
  isolation: 'Allowlisted environment; fresh HOME/work per case; macOS sandbox-exec outbound loopback only and writes only under owned scratch root; test credentials only.',
  cases: [], diagnostics: [] };
const registry = createRegistry({ builtins: false });
await registry.loadFile(join(process.cwd(), 'codebuddy.json'));
const save = () => writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
for (const alias of ['codebuddy', 'cbc']) for (const scenario of ['text', 'tool']) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cordyceps-codebuddy-')));
  const record = { harness: 'codebuddy', alias, scenario, passed: false };
  evidence.cases.push(record);
  let ai;
  try {
    const home = join(root, 'home'), work = join(root, 'work');
    await mkdir(home); await mkdir(work);
    const fixture = join(work, 'fixture.txt'), token = `fixture-${randomUUID()}`;
    await writeFile(fixture, `${token}\n`);
    ai = await prepare({ harness: 'codebuddy', registry, mode: 'nonInteractive' });
    const env = ai.environment(environment(home, root));
    const binary = join(deps, 'node_modules/.bin', alias);
    record.binary = binary;
    record.version = await launch(binary, ['--version'], work, env, [root]);
    assert.equal(record.version.code, 0, record.version.stderr);
    const marker = `CORDYCEPS_${alias}_${scenario}_${randomUUID()}`;
    const prompt = `cordyceps-source-${scenario}: ${scenario === 'tool' ? 'Read fixture.txt, then report completion.' : 'Reply with the controlled test message.'}`;
    let issued = false, returned = false;
    ai.route(() => true, async route => {
      const request = route.request;
      assert.ok(ai.requests.length <= 10, 'Unexpected request loop');
      if (request.raw.path.includes('count_tokens')) return route.fulfill({ inputTokens: 100 });
      if (request.raw.method === 'HEAD') return route.fulfill({ health: true });
      assert.ok(request.text.includes(prompt), 'Unexpected auxiliary model request');
      if (scenario === 'text') return route.fulfill({ text: marker });
      const result = request.toolResults.find(r => r.id === 'fixture_read');
      if (result) {
        assert.equal(result.isError, false, result.text);
        assert.ok(result.text.includes(token), 'Native result does not contain the unpredictable fixture token');
        returned = true;
        return route.fulfill({ text: marker });
      }
      assert.equal(issued, false, 'Tool result missing from next request');
      assert.ok(!request.raw.body.includes(token), 'Token leaked before tool execution');
      assert.ok(request.tools.some(t => t.name === 'Read'), JSON.stringify(request.tools));
      record.scriptedCall = { id: 'fixture_read', name: 'Read', input: { file_path: fixture } };
      issued = true;
      return route.fulfill({ toolCall: record.scriptedCall });
    });
    const args = [...ai.args, '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', prompt];
    record.args = args; record.prompt = prompt;
    ai.recordInput(prompt);
    record.process = await launch(binary, args, work, env, [root]);
    ai.assertHealthy();
    assert.equal(record.process.timedOut, false, record.process.stderr);
    assert.equal(record.process.code, 0, record.process.stderr);
    assert.ok(record.process.stdout.includes(marker), record.process.stdout);
    const prompts = ai.requests.filter(r => r.text.includes(prompt));
    assert.ok(prompts.length > 0, 'Missing actual captured prompt');
    assert.ok(!prompts[0].raw.body.includes(token), 'Token present in first provider request');
    if (scenario === 'tool') {
      assert.ok(issued && returned, 'Missing actual tool round trip');
      assert.ok(prompts[1]?.toolResults.some(r => r.id === 'fixture_read' && r.text.includes(token)), 'Token missing from immediately next provider request');
    }
    record.assertions = { capturedPrompt: true, controlledNativeOutput: true, tokenAbsentInitially: true,
      actualToolResultInNextRequest: scenario === 'tool' ? true : null, healthy: true };
    record.passed = true;
  } catch (error) { record.error = String(error.stack ?? error); }
  finally {
    if (ai) {
      record.requests = ai.requests; record.responses = ai.responses; record.failures = ai.failures.map(f => String(f.error));
      await ai.dispose(); await assert.rejects(fetch(ai.baseUrl));
    }
    await rm(root, { recursive: true, force: true }); await assert.rejects(access(root));
    record.cleanedUp = true; await save();
    console.log(JSON.stringify({ alias, scenario, passed: record.passed, requests: record.requests?.length, error: record.error?.slice(0, 1500) }));
  }
}

// Diagnostic only. This rejects remote connections without emulating login,
// entitlements, catalog or model decisions. There is no Qoder success recipe.
for (const credential of ['none', 'test-pat', 'local-settings']) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cordyceps-qoder-')));
  const record = { harness: 'qoder', executable: 'qodercli', credential, supported: false, proxyRequests: [], localEndpointRequests: [] };
  evidence.diagnostics.push(record);
  const sockets = new Set();
  const proxy = createServer((req, res) => {
    (req.url.startsWith('/') ? record.localEndpointRequests : record.proxyRequests).push({ method: req.method, url: req.url });
    res.writeHead(502); res.end('Offline diagnostic: outbound provider access refused');
  });
  proxy.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  proxy.on('connect', (req, socket) => {
    record.proxyRequests.push({ method: 'CONNECT', url: req.url });
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  });
  try {
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const home = join(root, 'home'), work = join(root, 'work');
    await mkdir(home); await mkdir(work); await mkdir(join(home, '.qoder'));
    const settings = { general: { enableAutoUpdate: false }, permissions: { trustDirectories: [work] } };
    if (credential === 'local-settings') settings.modelConfigs = { customModels: [{ key: 'cordyceps/local', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', apiKey: 'cordyceps-test-key', baseURL: `http://127.0.0.1:${proxy.address().port}`, format: 'anthropic' }] };
    record.settings = settings;
    await writeFile(join(home, '.qoder/settings.json'), JSON.stringify(settings));
    const env = environment(home, root);
    env.QODER_CONFIG_DIR = join(home, '.qoder');
    env.HTTP_PROXY = env.HTTPS_PROXY = env.ALL_PROXY = `http://127.0.0.1:${proxy.address().port}`;
    if (credential === 'test-pat') env.QODER_PERSONAL_ACCESS_TOKEN = 'cordyceps-test-key-not-a-real-token';
    const binary = join(deps, 'node_modules/.bin/qodercli');
    record.version = await launch(binary, ['--version'], work, env, [root]);
    record.help = await launch(binary, ['--help'], work, env, [root]);
    assert.equal(record.version.code, 0, record.version.stderr);
    assert.ok(record.version.stdout.includes('1.1.64'), 'Reinvestigate Qoder boundaries for a different release');
    assert.equal(record.help.code, 0, record.help.stderr);
    assert.ok(record.help.stdout.includes('qodercli'), 'Not the source-roster executable');
    record.prompt = 'cordyceps-source-qoder: Read fixture.txt, then report completion.';
    await writeFile(join(work, 'fixture.txt'), `fixture-${randomUUID()}\n`);
    record.args = ['--print', '--dangerously-skip-permissions', '--output-format', 'stream-json', record.prompt];
    if (credential === 'local-settings') record.args.unshift('--model', 'cordyceps/local');
    record.process = await launch(binary, record.args, work, env, [root], 30_000);
    assert.equal(record.process.timedOut, false, 'Timeout alone is not an established unsupported boundary');
    assert.equal(record.process.code, 1, record.process.stdout);
    assert.equal(record.localEndpointRequests.length, 0, 'Local endpoint reached: investigate genuine model control instead of declaring unsupported');
    if (credential === 'test-pat') {
      assert.ok(record.process.stderr.includes('exchangePersonalToken') && record.process.stderr.includes('loginWithPAT'), record.process.stderr);
      assert.ok(record.proxyRequests.some(r => r.url === 'openapi.qoder.sh:443'));
      record.boundary = 'Test PAT requires remote exchangePersonalToken/loginWithPAT; rejecting proxy prevents authentication before inference.';
    } else {
      const messages = record.process.stdout.trim().split('\n').map(line => JSON.parse(line));
      assert.ok(messages.some(m => m.error === 'authentication_failed' && JSON.stringify(m).includes('Not logged in')));
      assert.ok(messages.some(m => m.type === 'result' && m.is_error === true && m.usage.input_tokens === 0));
      record.boundary = 'Native authentication_failed / Not logged in result, including with local custom-model settings; no model exchange.';
    }
    record.diagnosticPassed = true;
  } catch (error) { record.error = String(error.stack ?? error); }
  finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
    await rm(root, { recursive: true, force: true }); await assert.rejects(access(root));
    record.cleanedUp = true; await save();
    console.log(JSON.stringify({ harness: 'qoder', credential, code: record.process?.code, timedOut: record.process?.timedOut, proxyRequests: record.proxyRequests.length, localEndpointRequests: record.localEndpointRequests.length }));
  }
}
process.exitCode = evidence.cases.every(c => c.passed) && evidence.diagnostics.every(c => c.diagnosticPassed) ? 0 : 1;
