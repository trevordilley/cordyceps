import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Compile test tooling with Bun, then execute the complete lifecycle suite under
// the consumer runtime. Bun's node:http disconnect behavior is not Node's.
const node = process.env.CORDYCEPS_NODE_BINARY ?? 'node';
const probe = Bun.spawn([node, '-e', 'process.exit(process.versions.bun || Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)'], {
  stdout: 'inherit', stderr: 'inherit',
});
if (await probe.exited) {
  throw new Error('test:node requires real Node >=22. Put it first on PATH or set CORDYCEPS_NODE_BINARY to its executable; a node-to-Bun shim cannot verify Node behavior.');
}
const directory = await mkdtemp(join(tmpdir(), 'cordyceps-node-tests-'));
try {
  await mkdir(join(directory, 'dist'));
  await cp('harnesses', join(directory, 'harnesses'), { recursive: true });
  const output = join(directory, 'dist', 'core.test.mjs');
  const build = Bun.spawn(['bun', 'build', 'tests/core.test.ts', '--target=node', '--outfile', output], {
    stdout: 'inherit', stderr: 'inherit',
  });
  if (await build.exited) process.exitCode = 1;
  else {
    const tests = Bun.spawn([node, '--test', output], { stdout: 'inherit', stderr: 'inherit' });
    process.exitCode = await tests.exited;
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
