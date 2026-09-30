// Ordinary project-local dependencies only. Does not log in or start an agent.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
assert.equal(process.versions.bun, undefined, 'Use Node >=22, not a Bun node shim');
const root = resolve(process.argv[2] ?? '/tmp/cordyceps-extra-deps');
await mkdir(root, { recursive: true });
await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: {
  '@kilocode/cli': '7.8.1', '@continuedev/cli': '1.5.47', 'autohand-cli': '0.9.8',
  'command-code': '1.72.4', 'codebuff': '1.0.688', 'polygraph': '0.1.5',
}}, null, 2) + '\n');
const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
assert.equal(result.status, 0);
console.log(`Installed CLI dependencies in ${root}; agent execution must use the isolated runner.`);
