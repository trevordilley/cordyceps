// Install the actual package outside this checkout before exercising the app.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.versions.bun, undefined, 'Use actual Node >=22');
const source = dirname(fileURLToPath(import.meta.url));
const repo = resolve(source, '../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-packed-inherited-'));
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
const run = (binary, args, cwd = repo) => execFileSync(binary, args, {
  cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
});
try {
  env.CODEX_BINARY ??= run('/usr/bin/which', ['codex']).trim();
  const installedBinary = await realpath(env.CODEX_BINARY);
  if (installedBinary.startsWith(join(homedir(), '.codex') + '/')) {
    // Keep the user's credential directory unreadable while running its exact binary.
    const staged = join(root, 'codex');
    await copyFile(installedBinary, staged);
    env.CODEX_BINARY = staged;
  }
  console.log(run('bun', ['run', 'build']).trim());
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root]));
  const consumer = join(root, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  run('npm', ['install', '--offline', '--ignore-scripts', '--omit=peer', '--no-audit', '--no-fund', join(root, packed.filename)], consumer);
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules/cordyceps/package.json'), 'utf8'));
  assert.equal(installed.name, 'cordyceps');
  await cp(source, join(consumer, 'examples/inherited-environment'), { recursive: true });
  await mkdir(join(consumer, 'examples/real-extra-cli'));
  await cp(join(repo, 'examples/real-extra-cli/isolation.mjs'), join(consumer, 'examples/real-extra-cli/isolation.mjs'));
  const output = process.argv[2] ? [resolve(process.argv[2])] : [];
  console.log(run(process.execPath, ['examples/inherited-environment/consumer.mjs', ...output], consumer));
  console.log(`PASS: installed ${packed.filename}; app → worker → Codex; text, real file read, inherited config and cleanup.`);
} catch (error) {
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
}
