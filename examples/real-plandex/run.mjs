import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
assert.equal(process.versions.bun, undefined, 'Use real Node >=22');
assert.ok(process.argv[3], 'Usage: node examples/real-plandex/run.mjs EVIDENCE.json PLANDEX_SOURCE_DIR');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-plandex-package-'));
const run = (file, args, cwd = repo) => {
  const r = spawnSync(file, args, { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw Error(`${file}: ${r.error ?? ''}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
try {
  run('bun', ['run', 'build']);
  const [pack] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root]));
  await mkdir(join(root, 'consumer'));
  await writeFile(join(root, 'consumer/package.json'), '{"private":true,"type":"module"}');
  run('npm', ['install', '--offline', '--ignore-scripts', '--omit=peer', '--no-audit', '--no-fund', join(root, pack.filename)], join(root, 'consumer'));
  for (const file of ['consumer.mjs', 'plandex.json', 'drive-pty.py']) await copyFile(join(repo, 'examples/real-plandex', file), join(root, 'consumer', file));
  console.log(run(process.execPath, ['consumer.mjs', resolve(process.argv[2] ?? '/tmp/cordyceps-plandex-evidence.json'), JSON.stringify({filename:pack.filename, integrity:pack.integrity}), resolve(process.argv[3])], join(root, 'consumer')));
} finally { await rm(root, {recursive:true, force:true}); }
