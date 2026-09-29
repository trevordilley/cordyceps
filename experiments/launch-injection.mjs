// Investigation only: synthetic executables and startup files, no provider calls.
// Run: node experiments/launch-injection.mjs [absolute-path-to-real-binary]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform === 'win32') throw new Error('This probe requires /bin/zsh and /bin/sh.');
const root = mkdtempSync(join(tmpdir(), 'cordyceps launch probe '));
const q = value => "'" + value.replaceAll("'", "'\\''") + "'";
const results = [];
const write = (path, content, executable = false) => {
  writeFileSync(path, content);
  if (executable) chmodSync(path, 0o700);
};
const run = (file, args, env, input = '') => {
  const result = spawnSync(file, args, { env, input, encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const check = (name, actual, expected) => {
  assert.equal(actual, expected, name);
  results.push({ name, passed: true });
};

try {
  const realDir = join(root, 'installed');
  const shimDir = join(root, 'wrapper');
  const linkDir = join(root, 'symlink');
  const userRc = join(root, 'user-rc');
  const overlayRc = join(root, 'overlay-rc');
  for (const dir of [realDir, shimDir, linkDir, userRc, overlayRc]) mkdirSync(dir);
  const real = join(realDir, 'claude');
  write(real, '#!/bin/sh\nprintf "%s|%s|%s|%s\\n" "${CORDYCEPS_PROBE_ENDPOINT:-unset}" "${RC_LOADED:-no}" "$#" "$*"\n', true);
  write(join(shimDir, 'claude'), '#!/bin/sh\nexport CORDYCEPS_PROBE_ENDPOINT=mock\nexec ' + q(real) + ' "$@"\n', true);
  symlinkSync(real, join(linkDir, 'claude'));
  const base = {
    PATH: `${realDir}:/usr/bin:/bin`,
    HOME: process.env.HOME,
    ZDOTDIR: userRc,
    SHELL: '/bin/zsh',
  };
  const overlaid = { ...base, PATH: `${shimDir}:${base.PATH}`, CORDYCEPS_PROBE_ENDPOINT: 'mock' };
  const cli = ['-p', 'hello world'];
  check('A symlink alone does not inject configuration', run(join(linkDir, 'claude'), cli, base), 'unset|no|2|-p hello world');
  check('PATH wrapper injects configuration and forwards arguments', run('claude', cli, { ...base, PATH: `${shimDir}:${base.PATH}` }), 'mock|no|2|-p hello world');
  check('Absolute installed binary accepts inherited configuration', run(real, cli, overlaid), 'mock|no|2|-p hello world');
  check('Absolute installed binary bypasses a PATH-only wrapper', run(real, cli, { ...base, PATH: `${shimDir}:${base.PATH}` }), 'unset|no|2|-p hello world');

  write(join(userRc, '.zprofile'), `export PATH=${q(realDir)}:/usr/bin:/bin\n`);
  write(join(userRc, '.zshrc'), 'export RC_LOADED=yes\nexport CORDYCEPS_PROBE_ENDPOINT=user-config\n');
  write(join(userRc, '.zlogin'), `export PATH=${q(realDir)}:/usr/bin:/bin\n`);
  check('Login-only zsh does not load .zshrc', run('/bin/zsh', ['-lc', 'claude -p hello'], overlaid), 'mock|no|2|-p hello');
  check('Interactive login rc defeats inherited PATH and provider overlay', run('/bin/zsh', ['-lic', 'claude -p hello'], overlaid), 'user-config|yes|2|-p hello');
  check('Explicit wrapper reapplies configuration after rc', run('/bin/zsh', ['-lic', `${q(join(shimDir, 'claude'))} -p hello`], overlaid), 'mock|yes|2|-p hello');

  // Synthetic forwarding startup files: prove ordering, not arbitrary dotfile compatibility.
  for (const file of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
    write(join(overlayRc, file),
      `[[ ! -f ${q(join(userRc, file))} ]] || source ${q(join(userRc, file))}\n` +
      `export PATH=${q(shimDir)}:"$PATH"\nexport CORDYCEPS_PROBE_ENDPOINT=mock\n`);
  }
  check('Forwarded startup files preserve rc and reapply overlay', run('/bin/zsh', ['-lic', 'claude -p hello'], { ...overlaid, ZDOTDIR: overlayRc }), 'mock|yes|2|-p hello');
  check('Discovery sees wrapper after startup forwarding', run('/bin/zsh', ['-lic', 'command -v claude'], { ...overlaid, ZDOTDIR: overlayRc }), join(shimDir, 'claude'));
  write(join(shimDir, 'passthrough'), '#!/bin/sh\nexec /bin/cat\n', true);
  const payload = 'prompt line 1\nprompt line 2';
  check('exec wrapper retains stdin/stdout stream', run(join(shimDir, 'passthrough'), [], base, payload), payload);

  // A child already launched cannot observe later changes to the parent's env map.
  const launchEnv = { ...base, CORDYCEPS_PROBE_ENDPOINT: 'before' };
  const child = spawn('/bin/sh', ['-c', 'read ready; printf "%s" "$CORDYCEPS_PROBE_ENDPOINT"'], { env: launchEnv });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const finished = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  launchEnv.CORDYCEPS_PROBE_ENDPOINT = 'after';
  child.stdin.end('go\n');
  const [exitCode] = await finished;
  clearTimeout(timer);
  assert.equal(exitCode, 0);
  check('Already-running children retain their launch environment', output, 'before');

  let realBinaryVersion;
  if (process.argv[2]) {
    assert.ok(process.argv[2].startsWith('/'), 'Provide an absolute binary path');
    const actualWrapper = join(shimDir, 'actual-binary');
    write(actualWrapper, `#!/bin/sh\nexec ${q(process.argv[2])} "$@"\n`, true);
    realBinaryVersion = run(actualWrapper, ['--version'], { ...process.env });
  }
  console.log(JSON.stringify({ platform: process.platform, node: process.version, results, realBinaryVersion,
    limits: 'Synthetic shell fixtures only; optional real binary --version; no real model request, PTY, Windows, or DevSwarm E2E run.' }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
