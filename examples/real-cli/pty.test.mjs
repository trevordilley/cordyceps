import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Transport/lifecycle regression, not a replacement harness compatibility test.
test('PTY reads typed bytes and reaps an exited terminal child without hanging', () => {
  const driver = fileURLToPath(new URL('./drive-pty.py', import.meta.url));
  const result = spawnSync('python3', [driver, 'pty-input-check', 'PTY_OUTPUT_OK', '/bin/sh', '-c',
    'echo "Yes, continue"; read answer; read prompt; test "$answer" = 1 && test "$prompt" = pty-input-check && echo PTY_OUTPUT_OK'],
  { encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.promptBytesSent, true);
  assert.equal(observed.observedReply, true);
  assert.equal(observed.waitStatus, 0);
});
