// Build and install the tarball in a disposable project, then run with Node.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.versions.bun, undefined, 'Use real Node, not a Bun node shim');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-real-cli-package-'));
const evidence = resolve(process.argv[2] ?? join(tmpdir(), 'cordyceps-real-cli-evidence.json'));
const run = (file, args, cwd = root) => execFileSync(file, args, {
  cwd, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
});
try {
  console.log(run('bun', ['run', 'build'], repo));
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], repo));
  const consumer = join(root, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--omit=peer', join(root, packed.filename)], consumer);
  await copyFile(join(repo, 'examples/real-cli/consumer.mjs'), join(consumer, 'consumer.mjs'));
  const binaries = {};
  for (const name of ['claude', 'codex']) binaries[name] = run('/usr/bin/which', [name]).trim();
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules/cordyceps/package.json'), 'utf8'));
  assert.equal(installed.name, 'cordyceps');
  console.log(run(process.execPath, ['consumer.mjs', evidence, JSON.stringify(binaries), JSON.stringify({
    name: packed.filename, integrity: packed.integrity, shasum: packed.shasum,
  })], consumer));
  console.log(`Full captured evidence: ${evidence}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
