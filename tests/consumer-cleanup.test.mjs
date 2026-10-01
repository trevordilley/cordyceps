import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { waitForProcessGroups } from '../examples/real-extra-cli/isolation.mjs';

test('consumer cleanup refuses a live process group and confirms it exits after termination', async () => {
  const child = spawn(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], {
    detached: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const closed = once(child, 'close');
  try {
    await once(child.stdout, 'data');
    await assert.rejects(waitForProcessGroups([child.pid], 0), /still has live members/);
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await closed;
    await waitForProcessGroups([child.pid]);
  }
});
