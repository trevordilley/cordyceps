// Build and install the tarball in a disposable project, then run with Node.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.versions.bun, undefined, 'Use real Node, not a Bun node shim');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-real-cli-package-'));
const evidence = resolve(process.argv[2] ?? join(tmpdir(), 'cordyceps-real-cli-evidence.json'));
const run = (file, args, cwd = root) => {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    if (result.stdout) console.log(result.stdout);
    throw new Error(`${file} failed (${result.status}): ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
};
try {
  console.log(run('bun', ['run', 'build'], repo));
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], repo));
  const consumer = join(root, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--omit=peer', join(root, packed.filename)], consumer);
  await copyFile(join(repo, 'examples/real-cli/consumer.mjs'), join(consumer, 'consumer.mjs'));
  await copyFile(join(repo, 'examples/real-cli/drive-pty.py'), join(consumer, 'drive-pty.py'));
  const binaries = {};
  if (process.argv[3]?.startsWith('--interactive')) binaries.python = run('/usr/bin/which', ['python3']).trim();
  for (const name of ['claude', 'codex']) binaries[name] = run('/usr/bin/which', [name]).trim();
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules/cordyceps/package.json'), 'utf8'));
  assert.equal(installed.name, 'cordyceps');
  console.log(run(process.execPath, ['consumer.mjs', evidence, JSON.stringify(binaries), JSON.stringify({
    name: packed.filename, integrity: packed.integrity, shasum: packed.shasum,
  }), ...(process.argv.slice(3))], consumer));
  console.log(`Full captured evidence: ${evidence}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
