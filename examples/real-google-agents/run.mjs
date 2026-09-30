// Build/pack/install outside the repository. Launch and dependency ownership stay here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
assert.equal(process.versions.bun, undefined, 'Use real Node, not a Bun node shim');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-google-package-'));
const evidence = resolve(process.argv[2] ?? join(tmpdir(), 'cordyceps-google-evidence.json'));
const run = (file, args, cwd = root) => {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.stdout && args[0] !== 'pack') console.log(result.stdout.trim());
  if (result.error || result.status !== 0) throw new Error(`${file} failed (${result.status}): ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
try {
  run('bun', ['run', 'build'], repo);
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], repo));
  const consumer = join(root, 'consumer'); await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--omit=peer', join(root, packed.filename)], consumer);
  await copyFile(join(repo, 'examples/real-google-agents/consumer.mjs'), join(consumer, 'consumer.mjs'));
  for (const name of ['gemini', 'qwen', 'mistral-vibe']) await copyFile(join(repo, `harnesses/${name}.json`), join(consumer, `${name}.json`));
  run(process.execPath, ['consumer.mjs', evidence, JSON.stringify({ name: packed.filename, integrity: packed.integrity, shasum: packed.shasum }), ...process.argv.slice(3)], consumer);
  console.log(`Evidence: ${evidence}`);
} finally { await rm(root, { recursive: true, force: true }); }
