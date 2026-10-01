// Consumer-owned packaging and launch driver.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
assert.equal(process.versions.bun, undefined, 'Use real Node >=22');
assert.equal(process.platform, 'darwin', 'Requires macOS sandbox-exec');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const deps = resolve(process.argv[3] ?? '/tmp/cordyceps-codebuddy-qoder-deps');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-codebuddy-qoder-package-'));
const run = (binary, args, cwd = root) => {
  const r = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 240_000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 || r.error) throw Error(`${binary}: ${r.error ?? r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
try {
  run('bun', ['run', 'build'], repo);
  const [artifact] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], repo));
  const project = join(root, 'consumer'); await mkdir(project);
  await writeFile(join(project, 'package.json'), '{"private":true,"type":"module"}');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=peer', join(root, artifact.filename)], project);
  for (const file of ['consumer.mjs', 'isolation.mjs', 'codebuddy.json']) await copyFile(join(here, file), join(project, file));
  const distribution = {};
  for (const name of ['@tencent-ai/codebuddy-code', '@qoder-ai/qodercli']) {
    const pkg = JSON.parse(await readFile(join(deps, 'node_modules', name, 'package.json'), 'utf8'));
    const locks = JSON.parse(await readFile(join(deps, 'package-lock.json'), 'utf8')).packages;
    const lock = Object.entries(locks).find(([key, value]) => key.endsWith(`node_modules/${name}`) && value.integrity)?.[1];
    assert.ok(lock, `Missing distribution integrity for ${name}`);
    const entry = name.includes('qodercli') ? 'bundle/qodercli.js' : 'bin/codebuddy';
    const bytes = await readFile(join(deps, 'node_modules', name, entry));
    distribution[name] = { version: pkg.version, bin: pkg.bin, resolved: lock.resolved, integrity: lock.integrity,
      inspectedEntry: entry, entrySha256: createHash('sha256').update(bytes).digest('hex') };
    if (name.includes('qodercli')) {
      const source = bytes.toString('utf8');
      distribution[name].bundleObservations = {
        settingsCustomModelsParser: source.includes('settingsByokModels:Jut(A.modelConfigs?.customModels)'),
        localCustomProviderAuthenticationCheck: source.includes('A.isAuthenticated()&&!A.isServiceAccount()'),
        sdkSpecificCustomBaseUrlSwitch: source.includes('QODER_SDK_CUSTOM_BASE_URL_BYOK'),
        customProviderStatusCheck: source.includes('check:async()=>{let A=await fl().getUserStatus()')
      };
    }
  }
  console.log(run(process.execPath, ['consumer.mjs', resolve(process.argv[2] ?? '/tmp/cordyceps-codebuddy-qoder-evidence.json'), deps,
    JSON.stringify({ filename: artifact.filename, integrity: artifact.integrity, shasum: artifact.shasum }), JSON.stringify(distribution)], project));
} finally { await rm(root, { recursive: true, force: true }); }
