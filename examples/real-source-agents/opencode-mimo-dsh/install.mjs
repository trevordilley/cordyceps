// Network-enabled dependency preparation only. Run as a tracked oneshot.
// Does not launch a model or touch the caller's HOME/config/npm cache.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
assert.equal(process.versions.bun, undefined);
const root = resolve(process.argv[2] ?? '/tmp/cordyceps-omd-deps');
await mkdir(join(root, 'home'), { recursive: true });
const packages = ['@opencode-ai/cli@0.0.0-beta-19271', '@mimo-ai/cli@0.1.15',
  '@deepseek-ai/dsh@0.2.0-rc.2', '@deepseek-harness-tui/dsh-tui@0.12.0', '@xterm/headless@6.0.0'];
const result = spawnSync('npm', ['install', '--prefix', root, '--no-audit', '--no-fund', ...packages], {
  env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(root, 'home'),
    npm_config_cache: join(root, 'home/.npm'), npm_config_userconfig: join(root, 'home/.npmrc') },
  encoding: 'utf8', timeout: 480_000, maxBuffer: 16 * 1024 * 1024,
});
await writeFile(join(root, 'install-output.json'), JSON.stringify({ packages, code: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2));
assert.equal(result.status, 0, result.stderr);
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const provenance = Object.entries(lock.packages).filter(([path]) =>
  /node_modules\/@(opencode-ai\/(cli|cli-darwin-arm64)|mimo-ai\/(cli|mimocode-darwin-arm64)|deepseek-ai\/dsh|deepseek-harness-tui\/dsh-tui)$/.test(path))
  .map(([path, value]) => ({ path, version: value.version, resolved: value.resolved, integrity: value.integrity }));
await writeFile(join(root, 'provenance.json'), JSON.stringify(provenance, null, 2));
console.log(JSON.stringify({ root, packages, provenance }, null, 2));
