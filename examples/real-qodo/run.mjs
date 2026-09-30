// Consumer-owned build, package install and diagnostic process lifecycle.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, copyFile, readFile, realpath, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

assert.equal(process.versions.bun, undefined, 'Use real Node');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-qodo-package-'));
const env = {...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH};
const binary = process.env.CORDYCEPS_QODO_BINARY || '/Users/20idemo/.bun/bin/qodo';
function run(cmd, args, cwd = root) {
  const p = spawnSync(cmd, args, {cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 20 * 1024 * 1024});
  if (p.error || p.status !== 0) throw Error(`${cmd}: ${p.error || p.stderr}\n${p.stdout}`);
  return p.stdout;
}
try {
  run('bun', ['run', 'build'], repo);
  const [pack] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], repo));
  const consumer = join(root, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({private: true, type: 'module'}));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=peer', join(root, pack.filename), 'ws@8.18.3'], consumer);
  await copyFile(join(repo, 'examples/real-qodo/consumer.mjs'), join(consumer, 'consumer.mjs'));
  await copyFile(join(repo, 'examples/real-gated-agents/probe.mjs'), join(consumer, 'probe.mjs'));
  const packageRoot = resolve(dirname(await realpath(binary)), '..');
  const sourceFiles = ['package.json', 'bin/qodo.js', 'dist/cli.js', 'dist/api/agent.js',
    'dist/api/websocketClient.js', 'dist/utils/serverData.js', 'dist/sdk/inprocess/QodoClient.js',
    'dist/sdk/inprocess/QodoClient.d.ts', 'dist/sdk/core/messageMappings.js'];
  const source = [];
  for (const path of sourceFiles) {
    const bytes = await readFile(join(packageRoot, path));
    source.push({path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  const metadata = {artifact: {filename: pack.filename, integrity: pack.integrity, shasum: pack.shasum},
    qodo: {binary, packageRoot, version: JSON.parse(await readFile(join(packageRoot, 'package.json'))).version, source}};
  console.log(run(process.execPath, ['consumer.mjs', resolve(process.argv[2] || '/tmp/cordyceps-qodo-evidence.json'), JSON.stringify(metadata)], consumer));
} finally {
  await rm(root, {recursive: true, force: true});
}
