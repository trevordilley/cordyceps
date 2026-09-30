// Copied into a disposable npm consumer. Public imports only; all launch logic is consumer-owned.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { prepare, createRegistry } from 'cordyceps';
import { launch, environment } from './isolation.mjs';

assert.equal(process.versions.bun, undefined);
assert.equal(process.platform, 'darwin', 'Requires macOS sandbox-exec; never silently remove isolation');
const [evidencePath, binaryJSON, artifactJSON, selection = 'kilocode,continue-cli,autohand,command-code', scenarios = 'text,tool,stream,cancel'] = process.argv.slice(2);
const binaries = JSON.parse(binaryJSON);
const promptsStreamed = (requests, prompt) => requests.some(r => r.text.includes(prompt) && r.stream);
const evidence = { limitations: { autohand: 'Anthropic client requests nonstream JSON; stream scenario intentionally omitted' }, date: new Date().toISOString(), node: process.version, platform: process.platform,
  isolation: 'macOS sandbox-exec: outbound loopback only; writes restricted to disposable home/work and generated config directories; allowlisted child environment',
  packageEntry: import.meta.resolve('cordyceps'), artifact: JSON.parse(artifactJSON), cases: [] };
const registry = createRegistry({ builtins: false });
for (const name of selection.split(',')) await registry.loadFile(join(process.cwd(), 'harnesses', `${name}.json`));

for (const harness of selection.split(',')) for (const scenario of scenarios.split(',')) {
  if (harness === 'autohand' && scenario === 'stream') continue; // Native Anthropic client is nonstreaming.
  const root = await realpath(await mkdtemp(join(tmpdir(), `cordyceps-extra-${harness}-`)));
  const record = { harness, scenario, binary: binaries[harness], passed: false };
  evidence.cases.push(record);
  let ai;
  try {
    const home = join(root, 'home'), work = join(root, 'work');
    await mkdir(home); await mkdir(work);
    const fixture = join(work, 'fixture.txt'), token = `fixture-${randomUUID()}`;
    await writeFile(fixture, token + '\n');
    ai = await prepare({ harness, registry, mode: 'nonInteractive' });
    const env = ai.environment({ ...environment(home, root),
      KILO_DISABLE_MODELS_FETCH: 'true', KILO_DISABLE_AUTOUPDATE: 'true', KILO_DISABLE_DEFAULT_PLUGINS: 'true',
      OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true',
      AUTOHAND_OFFLINE: '1',
    });
    const writable = [root, await realpath(env.HOME), ...await Promise.all(ai.configFiles.map(f => realpath(dirname(f.path))))];
    record.version = await launch(binaries[harness], ['--version'], work, env, writable);
    assert.equal(record.version.code, 0, record.version.stderr);
    assert.ok(record.version.stdout.trim(), 'Missing version observation');
    const marker = `CORDYCEPS_${harness}_${scenario}_OK`;
    const prompt = `cordyceps-extra-${scenario}: ${scenario === 'tool' ? 'Read fixture.txt, then report completion.' : 'Reply with the controlled test message.'}`;
    let issued = false, returned = false, control;
    const isTitle = request => request.text.startsWith('Generate a short title (four words or less)')
      || request.text.startsWith('You will generate a short title based on the first message');
    ai.route(() => true, async route => {
      const request = route.request;
      assert.ok(ai.requests.length <= 12, 'unexpected request loop');
      if (request.raw.path.includes('count_tokens')) return route.fulfill({ inputTokens: 100 });
      if (request.raw.method === 'HEAD') return route.fulfill({ health: true });
      // Native title/background requests remain captured; they cannot satisfy the prompt assertions.
      if (!request.text.includes(prompt) || isTitle(request)) return route.fulfill({ text: 'Cordyceps fixture' });
      if (scenario === 'cancel') {
        record.cancelRequestCaptured = true;
        setTimeout(() => control.kill(), 300);
        await route.untilAborted();
        record.providerAbortObserved = route.signal.aborted;
        return;
      }
      if (scenario === 'stream') {
        return route.fulfill({ stream: (async function* () {
          yield { text: `${marker}_PREFIX ` };
          await new Promise(resolve => setTimeout(resolve, 1000));
          record.outputBeforeStreamCompletion = control.output().includes(`${marker}_PREFIX`);
          yield { text: `${marker}_TAIL` };
        })() });
      }
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
      if (names.includes('Read')) { name = 'Read'; input = harness === 'continue-cli' ? { filepath: fixture } : { file_path: fixture }; }
      else if (names.includes('read_file')) { name = 'read_file'; input = harness === 'command-code' ? { file_path: fixture } : { path: fixture }; }
      else if (names.includes('read')) { name = 'read'; input = { filePath: fixture }; }
      else throw new Error(`No read tool recognized: ${JSON.stringify(request.tools)}`);
      issued = true;
      record.scriptedCall = { id: 'fixture_read', name, input };
      return route.fulfill({ toolCall: record.scriptedCall });
    });
    const model = 'claude-sonnet-4-5-20250929';
    const args = harness === 'kilocode' ? [...ai.args, '--pure', '--model', `anthropic/${model}`, '--title', 'Cordyceps', '--format', 'json', prompt]
      : harness === 'continue-cli' ? [...ai.args, '--auto', prompt]
      : harness === 'autohand' ? [...ai.args, prompt, '--bare', '--offline', '--ephemeral', '--yolo', '--max-requests', '4', '--output-format', 'stream-json']
      : [...ai.args, prompt, '--local-only', '--model', 'cordyceps/fixture-model', '--trust', '--yolo', '--skip-onboarding', '--no-auto-update', '--no-skills', '--no-session', '--max-turns', '4', '--output-format', 'json'];
    record.args = args; record.prompt = prompt;
    ai.recordInput(prompt);
    record.process = await launch(binaries[harness], args, work, env, writable, value => { control = value; });
    await new Promise(resolve => setTimeout(resolve, 30));
    record.requests = ai.requests; record.responses = ai.responses; record.failures = ai.failures.map(f => String(f.error));
    ai.assertHealthy();
    assert.equal(record.process.timedOut, false, record.process.stderr);
    if (scenario === 'cancel') {
      assert.equal(record.process.signal, 'SIGKILL');
      assert.ok(record.cancelRequestCaptured && record.providerAbortObserved, 'Process cancellation did not abort provider exchange');
      assert.ok(ai.responses.some(r => r.outcome === 'aborted'));
    } else {
      assert.equal(record.process.code, 0, record.process.stderr);
      assert.ok(record.process.stdout.includes(marker), record.process.stdout);
      if (scenario === 'stream') {
        assert.ok(record.process.stdout.includes(`${marker}_TAIL`));
        assert.ok(promptsStreamed(ai.requests, prompt), 'Agent did not request provider streaming');
      }
    }
    const prompts = ai.requests.filter(r => r.text.includes(prompt) && !isTitle(r));
    assert.ok(prompts.length > 0, 'Missing actual prompt request');
    assert.ok(!prompts[0].raw.body.includes(token), 'Token leaked before real read');
    if (scenario === 'tool') {
      assert.ok(issued && returned, 'No actual tool round trip');
      assert.ok(prompts[1]?.toolResults.some(r => r.id === 'fixture_read' && r.text.includes(token)), 'Fixture result must be in the actual next prompt request');
    }
    record.assertions = { capturedPrompt: true, controlledBinaryOutput: scenario !== 'cancel', tokenAbsentBeforeTool: true,
      actualToolResultInNextRequest: scenario === 'tool' ? returned : null,
      streamedReplyConsumed: scenario === 'stream' ? true : null,
      incrementalNativeOutput: scenario === 'stream' ? record.outputBeforeStreamCompletion : null, healthy: true };
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
