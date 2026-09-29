import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Run after bun run build. All consumer execution below uses Node, never Bun.
const repo = process.cwd();
const root = await mkdtemp(join(tmpdir(), 'cordyceps-package-'));
const run = (command, args, cwd, allowFailure = false) => {
  try { return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 90_000, env: { ...process.env, CI: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } }); }
  catch (error) { if (allowFailure) return error; throw error; }
};
const definition = {
  schemaVersion: 1, id: 'package-fixture',
  provider: { adapter: 'anthropic-messages', override: {
    env: { FIXTURE_URL: '${mock.baseUrl}', FIXTURE_CONFIG: '${config.fixture.path}' },
    unsetEnv: ['FIXTURE_REMOVE'],
    configFiles: [{ id: 'fixture', path: 'fixture.json', format: 'json', values: { endpoint: '${mock.baseUrl}' } }],
  } },
  modes: { interactive: {}, acp: { args: ['--fixture-only'] } },
};
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', root, '--ignore-scripts'], repo))[0];
  const paths = packed.files.map(f => f.path);
  assert(paths.includes('dist/index.js'));
  assert(paths.includes('dist/index.d.ts'));
  assert(paths.includes('dist/playwright.js'));
  assert(paths.includes('dist/playwright.d.ts'));
  assert(paths.some(p => p.startsWith('harnesses/') && p.endsWith('.json')));
  assert(!paths.some(p => /^(src|tests|experiments|change\.saga|node_modules)\//.test(p)));
  const tarball = join(root, packed.filename);
  const standalone = join(root, 'standalone');
  await mkdir(standalone);
  await writeFile(join(standalone, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', tarball], standalone);
  await writeFile(join(standalone, 'definition.json'), JSON.stringify(definition));
  await writeFile(join(standalone, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cordyceps } from 'cordyceps';
const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('@playwright/test'));
assert.equal(globalThis.Bun, undefined);
const registry = cordyceps.createRegistry({ builtins: false });
await registry.loadFile('./definition.json');
const ai = await cordyceps.prepare({ registry, harness: 'package-fixture', mode: 'acp' });
const configPath = ai.configFiles[0].path;
try {
  const base = { FIXTURE_REMOVE: 'remove', PRESERVE: 'yes' };
  const env = ai.environment(base);
  assert.equal(env.FIXTURE_REMOVE, undefined);
  assert.equal(base.FIXTURE_REMOVE, 'remove');
  assert.equal(env.PRESERVE, 'yes');
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).endpoint, ai.baseUrl);
  assert.deepEqual(ai.args, ['--fixture-only']);
  ai.route(() => true, route => route.fulfill({ text: 'Node packed artifact' }));
  const response = await fetch(ai.baseUrl + '/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'fixture', max_tokens: 128, messages: [{ role: 'user', content: 'hello' }] }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content[0].text, 'Node packed artifact');
  assert.equal(ai.requests.length, 1);
  // Synthetic consumer handler performs a real filesystem read. This proves the
  // provider round-trip contract, not any installed harness's tool behavior.
  const fixtureContents = await readFile(configPath, 'utf8');
  ai.route(() => true, route => {
    const result = route.request.toolResults.find(t => t.id === 'file-call');
    if (result) {
      assert.equal(result.text, fixtureContents);
      return route.fulfill({ text: 'tool result received' });
    }
    assert.equal(route.request.tools[0].name, 'read_file');
    return route.fulfill({ toolCall: { id: 'file-call', name: 'read_file', input: { path: configPath } } });
  });
  const toolReply = await fetch(ai.baseUrl + '/v1/messages', {
    method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [], tools: [{ name: 'read_file', input_schema: { type: 'object' } }] }),
  });
  const call = (await toolReply.json()).content.find(c => c.type === 'tool_use');
  const actualResult = await readFile(call.input.path, 'utf8');
  const final = await fetch(ai.baseUrl + '/v1/messages', {
    method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: actualResult }] }] }),
  });
  assert.equal((await final.json()).content[0].text, 'tool result received');
  ai.assertHealthy();
} finally { await ai.dispose(); }
await assert.rejects(access(configPath));
await assert.rejects(fetch(ai.baseUrl));
console.log('Packed standalone: Node import, local JSON, injection, HTTP, cleanup; no Bun or Playwright.');
`);
  console.log(run(process.execPath, ['smoke.mjs'], standalone).trim());
  // Typecheck root declarations BEFORE installing the optional Playwright peer.
  await writeFile(join(standalone, 'consumer.ts'), `import { cordyceps, type ProviderEvent } from 'cordyceps';
const registry = cordyceps.createRegistry({ builtins: false });
const ai = await cordyceps.prepare({ registry, harness: 'example', mode: 'acp' });
const event: ProviderEvent = { text: 'typed' };
ai.route(() => true, route => route.fulfill(event));
await ai.dispose();\n`);
  const tsc = resolve(repo, 'node_modules/typescript/bin/tsc');
  const typeArgs = [tsc, '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--typeRoots', resolve(repo, 'node_modules/@types'), 'consumer.ts'];
  run(process.execPath, typeArgs, standalone);
  // Install the peer into a SEPARATE clean consumer, checking fixture ownership.
  const playwright = join(root, 'playwright');
  await mkdir(playwright);
  await writeFile(join(playwright, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const dev = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).devDependencies;
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, '@playwright/test@' + dev['@playwright/test']], playwright);
  await writeFile(join(playwright, 'fixture.spec.ts'), `
import { test, expect } from 'cordyceps/playwright';
import { cordyceps } from 'cordyceps';
import { writeFile } from 'node:fs/promises';
const registry = cordyceps.createRegistry({ builtins: false });
registry.register(${JSON.stringify(definition)});
test.use({ cordyceps: { registry, harness: 'package-fixture', mode: 'acp' } });
test('fixture HTTP and automatic cleanup', async ({ ai }) => {
  await writeFile('cleanup.json', JSON.stringify({ url: ai.baseUrl, path: ai.configFiles[0]!.path }));
  ai.route(() => true, route => route.fulfill({ text: 'fixture reply' }));
  const r = await fetch(ai.baseUrl + '/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'fixture', max_tokens: 128, messages: [] }) });
  expect((await r.json()).content[0].text).toBe('fixture reply');
});
`);
  await writeFile(join(playwright, 'playwright.config.ts'), `export default { testDir: '.', testMatch: '*.spec.ts', workers: 1, retries: 0, timeout: 10000 };\n`);
  const pw = join(playwright, 'node_modules/@playwright/test/cli.js');
  console.log(run(process.execPath, [pw, 'test', '--reporter=line'], playwright).trim());
  const cleanup = JSON.parse(await readFile(join(playwright, 'cleanup.json'), 'utf8'));
  await assert.rejects(fetch(cleanup.url));
  await assert.rejects(readFile(cleanup.path));
  run(process.execPath, [tsc, '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--typeRoots', resolve(repo, 'node_modules/@types'), 'fixture.spec.ts'], playwright);
  // A swallowed HTTP error must still fail through the fixture's health check.
  await writeFile(join(playwright, 'failure.spec.ts'), `
import { test } from 'cordyceps/playwright';
import { cordyceps } from 'cordyceps';
import { writeFile } from 'node:fs/promises';
const registry = cordyceps.createRegistry({ builtins: false });
registry.register(${JSON.stringify(definition)});
test.use({ cordyceps: { registry, harness: 'package-fixture' } });
test('route failure is visible', async ({ ai }) => {
  await writeFile('failed-cleanup.json', JSON.stringify({ url: ai.baseUrl, path: ai.configFiles[0]!.path }));
  ai.route(() => true, () => { throw new Error('intentional route assertion'); });
  await fetch(ai.baseUrl + '/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [] }) });
});
`);
  const failed = run(process.execPath, [pw, 'test', 'failure.spec.ts', '--reporter=line'], playwright, true);
  assert.equal(failed.status, 1, 'the intentionally failed route must fail Playwright');
  assert.match(String(failed.stdout) + String(failed.stderr), /intentional route assertion/);
  const failedCleanup = JSON.parse(await readFile(join(playwright, 'failed-cleanup.json'), 'utf8'));
  await assert.rejects(fetch(failedCleanup.url));
  await assert.rejects(readFile(failedCleanup.path));
  console.log('Packed Playwright: fixture HTTP, type declarations, teardown after success and handler failure.');
  console.log('Artifact contents checked; standalone and optional-peer consumer checks passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
