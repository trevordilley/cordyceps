// Consumer-owned launches. Cordyceps supplies only provider injection and capture.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { prepare, createRegistry } from 'cordyceps';
import { isolatedEnv, launch } from './process.mjs';
assert.equal(process.platform, 'darwin', 'Requires macOS sandbox-exec');
assert.equal(process.versions.bun, undefined);
const [evidencePath, deps, artifactJSON, selection] = process.argv.slice(2);
const { Terminal } = createRequire(import.meta.url)(join(deps, 'node_modules/@xterm/headless'));
const evidence = { date: new Date().toISOString(), node: process.version, platform: process.platform,
  sourceRoster: '98039676f363d6f0c06dbed25f3180463e5952af',
  packageEntry: import.meta.resolve('cordyceps'), artifact: JSON.parse(artifactJSON),
  isolation: 'Allowlisted environment, isolated HOME/XDG/TMPDIR, macOS outbound loopback only and writes restricted to owned directories', cases: [] };
assert.ok(evidence.packageEntry.includes('/node_modules/cordyceps/'));
const specifications = {
  mimo: { package: '@mimo-ai/cli', binary: 'mimo', args: prompt => ['--model', 'cordyceps/fixture-model', '--format', 'json', prompt] },
  opencode2: { package: '@opencode-ai/cli', binary: 'opencode2', args: prompt => ['--auto'] },
  dsh: { package: '@deepseek-ai/dsh', binary: 'dsh', args: prompt => [prompt] },
};
specifications['opencode2-run'] = { ...specifications.opencode2, args: prompt => ['--auto', '--model', 'anthropic/claude-sonnet-4-5', '--format', 'json', '--print-logs', prompt] };
specifications['dsh-tui'] = { ...specifications.dsh, package: '@deepseek-harness-tui/dsh-tui', binary: 'dsh-tui', args: prompt => ['--', prompt] };
for (const harness of selection.split(',')) for (const scenario of ['text', 'tool']) {
  const spec = specifications[harness]; assert.ok(spec, `Unknown harness ${harness}`);
  const record = { harness, scenario, passed: false }; evidence.cases.push(record);
  const root = await realpath(await mkdtemp(join(tmpdir(), `cordyceps-omd-${harness}-`)));
  let ai;
  try {
    const work = join(root, 'work'); await mkdir(work); await mkdir(join(root, 'home'));
    const fixture = join(work, 'fixture.txt'), token = `fixture-${randomUUID()}`;
    await writeFile(fixture, token + '\n');
    const binary = await realpath(join(deps, 'node_modules/.bin', spec.binary));
    const pkg = JSON.parse(await readFile(join(deps, 'node_modules', spec.package, 'package.json'), 'utf8'));
    record.distribution = { package: pkg.name, version: pkg.version, repository: pkg.repository, binary,
      binarySha256: createHash('sha256').update(await readFile(binary)).digest('hex') };
    const registry = createRegistry({ builtins: false });
    const recipe = harness === 'dsh-tui' ? 'dsh' : harness === 'opencode2-run' ? 'opencode2' : harness;
    await registry.loadFile(new URL(`./recipes/${recipe}.json`, import.meta.url).pathname);
    ai = await prepare({ registry, harness: recipe, mode: ['dsh-tui', 'opencode2'].includes(harness) ? 'interactive' : 'nonInteractive' });
    const env = ai.environment(isolatedEnv(root));
    if (harness.startsWith('opencode2')) {
      // The OS sandbox enforces loopback. Dead proxy settings can also intercept local SDK calls.
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[key];
    }
    const writable = [root, ...await Promise.all(ai.configFiles.map(f => realpath(dirname(f.path))))];
    for (const key of ['MIMOCODE_HOME', 'DSH_HOME']) if (env[key]) {
      await mkdir(env[key], { recursive: true }); writable.push(await realpath(env[key]));
    }
    if (harness === 'dsh-tui') {
      env.PATH = join(deps, 'node_modules/.bin') + ':' + env.PATH;
      env.DSH_TUI_LANG = 'en'; env.DSH_TELEMETRY_MODE = 'DISABLED';
      const profile = join(env.DSH_HOME, 'profiles/dsh-tui'); await mkdir(profile, { recursive: true });
      await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'cordyceps-dsh-tui-profile', private: true, dependencies: { '@deepseek-harness-tui/dsh-tui': '0.12.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui'] } } }));
      // Expose the already installed, unmodified scratch package to the real profile loader.
      await symlink(join(deps, 'node_modules'), join(profile, 'node_modules'));
    }
    record.version = await launch(binary, ['--version'], work, env, writable, { timeout: 15_000 });
    record.help = await launch(binary, ['--help'], work, env, writable, { timeout: 15_000 });
    const prompt = `cordyceps-source-${harness}-${scenario}: ${scenario === 'tool' ? 'Read fixture.txt and report completion.' : 'Reply with the controlled test message.'}`;
    const marker = `CORDYCEPS_${harness}_${scenario}_OK`;
    record.prompt = prompt;
    let issued = false, returned = false;
    const isTitle = r => r.text.startsWith('You are a title generator. You output ONLY a thread title. Nothing else.')
      || r.text.startsWith('Create a concise title for an AI coding-assistant session')
      || (r.tools.length === 1 && r.tools[0].name === 'StructuredOutput');
    ai.route(() => true, async route => {
      const request = route.request;
      assert.ok(ai.requests.length <= 12, 'Unexpected request loop');
      if (request.raw.path.includes('count_tokens')) return route.fulfill({ inputTokens: 100 });
      if (request.raw.method === 'HEAD') return route.fulfill({ health: true });
      // Explicit title model requests are captured but cannot satisfy main-prompt assertions.
      if (isTitle(request)) return route.fulfill(request.tools.length ? { toolCall: { id: 'title_result', name: 'StructuredOutput', input: { title: 'Cordyceps fixture' } } } : { text: 'Cordyceps fixture' });
      // Only actual model requests are scripted; no fabricated auth/remote decisions.
      if (!request.text.includes(prompt)) return route.fulfill({ text: 'Cordyceps fixture' });
      if (scenario === 'text') return route.fulfill({ text: marker });
      const result = request.toolResults.find(r => r.id === 'fixture_read');
      if (result) {
        assert.equal(result.isError, false, result.text);
        assert.ok(result.text.includes(token), `Real tool result lacks unpredictable fixture token: ${result.text}`);
        returned = true; return route.fulfill({ text: marker });
      }
      assert.equal(issued, false, 'Expected real tool result in next request');
      const names = request.tools.map(t => t.name);
      let name, input;
      if (names.includes('read')) { name = 'read'; input = { [harness.startsWith('opencode2') ? 'path' : 'file_path']: fixture }; }
      else if (names.includes('read_file')) { name = 'read_file'; input = { path: fixture }; }
      else if (names.includes('str_replace_editor')) { name = 'str_replace_editor'; input = { command: 'view', path: fixture }; }
      else throw Error(`Unrecognized read tool: ${JSON.stringify(request.tools)}`);
      issued = true; record.scriptedCall = { id: 'fixture_read', name, input };
      return route.fulfill({ toolCall: record.scriptedCall });
    });
    ai.recordInput(prompt);
    record.process = await launch(binary, [...ai.args, ...spec.args(prompt)], work, env, writable, ['opencode2', 'dsh-tui'].includes(harness) ? { ptyMarker: marker, ptyPrompt: harness === 'opencode2' ? prompt : '' } : {});
    ai.assertHealthy();
    assert.equal(record.process.timedOut, false, record.process.stderr);
    assert.equal(record.process.code, 0, record.process.stderr);
    if (['opencode2', 'dsh-tui'].includes(harness)) {
      record.pty = JSON.parse(record.process.stdout);
      if (harness === 'opencode2') assert.equal(record.pty.promptBytesSent, true, 'Real native composer input was not submitted');
      const terminal = new Terminal({ cols: 180, rows: 40, scrollback: 10000, allowProposedApi: true });
      try {
        await new Promise(resolve => terminal.write(record.pty.transcript, resolve));
        record.pty.renderedScreen = Array.from({ length: terminal.buffer.active.length }, (_,i) => terminal.buffer.active.getLine(i).translateToString(true)).join('\n');
        assert.ok(record.pty.renderedScreen.includes(marker), 'Missing controlled native terminal output');
        record.pty.observedReply = true;
      } finally { terminal.dispose(); }
    } else assert.ok(record.process.stdout.includes(marker), 'Missing controlled native output');
    const prompts = ai.requests.filter(r => r.text.includes(prompt) && !isTitle(r));
    assert.ok(prompts.length, 'Missing actual captured prompt');
    assert.ok(!prompts[0].raw.body.includes(token), 'Fixture token leaked into initial request');
    if (scenario === 'tool') {
      assert.ok(issued && returned, 'Missing actual tool round trip');
      assert.ok(prompts[1]?.toolResults.some(r => r.id === 'fixture_read' && r.text.includes(token)), 'Fixture token absent from next actual provider request');
    }
    record.assertions = { capturedPrompt: true, controlledNativeOutput: true, tokenAbsentBeforeRead: true,
      fixtureTokenInNextRequest: scenario === 'tool' ? true : null, healthy: true };
    record.passed = true;
  } catch (e) { record.error = String(e.stack ?? e); }
  finally {
    if (ai) {
      record.requests = ai.requests; record.responses = ai.responses; record.failures = ai.failures.map(f => String(f.error));
      await ai.dispose(); await assert.rejects(fetch(ai.baseUrl));
      for (const f of ai.configFiles) await assert.rejects(access(f.path));
    }
    await rm(root, { recursive: true, force: true }); await assert.rejects(access(root)); record.cleanedUp = true;
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ harness, scenario, passed: record.passed, requests: record.requests?.length, error: record.error?.slice(0, 1200) }));
  }
}
process.exitCode = evidence.cases.every(c => c.passed) ? 0 : 1;
