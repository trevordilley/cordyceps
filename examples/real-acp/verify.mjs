// Run from any directory with real Node >=22. Installs only in a disposable consumer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.versions.bun, undefined, 'Use real Node >=22, not a Bun-backed node shim');
assert(Number(process.versions.node.split('.')[0]) >= 22);
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const consumer = await mkdtemp(join(tmpdir(), 'cordyceps-real-acp-package-'));
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, CI: '1' };
const run = (cmd, args, cwd = repo, capture = false) => execFileSync(cmd, args, {
  cwd, env, timeout: 180_000, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
});
try {
  run('bun', ['run', 'build']);
  const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer], repo, true));
  assert(packed.files.some(file => file.path === 'harnesses/claude-code-acp.json'));
  for (const name of ['package.json', 'package-lock.json', 'run.mjs']) await cp(join(here, name), join(consumer, name));
  run('npm', ['ci', '--no-audit', '--no-fund'], consumer);
  run('npm', ['install', '--no-save', '--package-lock=false', '--no-audit', '--no-fund', join(consumer, packed.filename)], consumer);
  assert.equal(JSON.parse(await readFile(join(consumer, 'node_modules/cordyceps/package.json'), 'utf8')).name, 'cordyceps');
  console.log(`Packed consumer: ${packed.filename}; Node ${process.version}; adapter 0.84.0; ACP SDK 1.5.1`);
  run(process.execPath, ['run.mjs'], consumer);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
