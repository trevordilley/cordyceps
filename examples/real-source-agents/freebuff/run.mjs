import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
assert.equal(process.versions.bun, undefined, 'Use real Node, not a Bun shim');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-provider-package-'));
const names = (process.argv[3] ?? 'freebuff').split(',');
const run = (binary, args, cwd = root) => {
  const r = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || r.error) throw Error(`${binary}: ${r.error ?? r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
try {
  run('bun', ['run', 'build'], repo);
  const [artifact] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], repo));
  const project = join(root, 'consumer'); await mkdir(project); await mkdir(join(project, 'harnesses'));
  await writeFile(join(project, 'package.json'), '{"private":true,"type":"module"}');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=peer', join(root, artifact.filename)], project);
  await copyFile(join(repo, 'examples/real-source-agents/freebuff/consumer.mjs'), join(project, 'consumer.mjs'));
  await copyFile(join(repo, 'examples/real-source-agents/freebuff/drive-pty.py'), join(project, 'drive-pty.py'));
  const binaries = {};
  for (const name of names) {
    await copyFile(join(repo, 'examples/real-source-agents/freebuff/harnesses', `${name}.json`), join(project, 'harnesses', `${name}.json`));
    binaries[name] = process.env[`${name.toUpperCase()}_BINARY`] ?? run('/usr/bin/which', [name]).trim();
  }
  console.log(run(process.execPath, ['consumer.mjs', resolve(process.argv[2] ?? '/tmp/cordyceps-provider-evidence.json'), JSON.stringify(binaries), JSON.stringify({ filename: artifact.filename, integrity: artifact.integrity, shasum: artifact.shasum }), names.join(','), process.argv[4] ?? 'text,tool'], project));
} finally { await rm(root, { recursive: true, force: true }); }
