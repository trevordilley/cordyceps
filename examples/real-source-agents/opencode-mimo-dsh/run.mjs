// Consumer-owned packaging and launch driver.
// Builds a source copy, packs it, and runs public imports outside the checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
assert.equal(process.versions.bun, undefined, 'Use actual Node >=22');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-omd-package-'));
const evidence = resolve(process.argv[2] ?? '/tmp/cordyceps-omd-evidence.json');
const deps = resolve(process.argv[3] ?? '/tmp/cordyceps-omd-deps');
const selection = process.argv[4] ?? 'mimo,dsh,dsh-tui,opencode2,opencode2-run';
function run(binary, args, cwd) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 480_000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(`${binary} ${args.join(' ')}: ${result.error ?? result.status}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  const source = join(root, 'source'), consumer = join(root, 'consumer');
  await mkdir(source); await mkdir(consumer);
  for (const file of ['src', 'scripts', 'harnesses', 'package.json', 'tsconfig.json', 'bun.lock', 'README.md', 'docs']) {
    await cp(join(repo, file), join(source, file), { recursive: true });
  }
  run('bun', ['install', '--frozen-lockfile'], source);
  run('bun', ['run', 'build'], source);
  const [artifact] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], source));
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=peer', join(root, artifact.filename)], consumer);
  await cp(here, join(consumer, 'example'), { recursive: true });
  console.log(run(process.execPath, ['example/consumer.mjs', evidence, deps, JSON.stringify({ filename: artifact.filename, integrity: artifact.integrity, shasum: artifact.shasum }), selection], consumer));
} finally { await rm(root, { recursive: true, force: true }); }
