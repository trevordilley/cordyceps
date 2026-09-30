// Consumer-owned process isolation. No harness launch code belongs to Cordyceps.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
export function environment(home, root) {
  return { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: root, TERM: 'xterm-256color', SHELL: '/bin/sh', NO_COLOR: '1',
    XDG_CONFIG_HOME: `${home}/.config`, XDG_DATA_HOME: `${home}/.local/share`,
    XDG_STATE_HOME: `${home}/.local/state`, XDG_CACHE_HOME: `${home}/.cache`,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1',
    DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', CI: '1' };
}
export async function launch(binary, args, cwd, env, writable, onStart, timeout = 45000, ptyMarker) {
  assert.equal(process.platform, 'darwin', 'macOS sandbox-exec required; do not remove isolation');
  assert.equal(process.versions.bun, undefined, 'Run consumer with real Node');
  const denied = ['.claude', '.codex', '.continue', '.autohand', '.commandcode', '.codebuff', '.polygraph', '.freebuff', '.config', '.local/share', '.ssh', '.aws', '.netrc', '.npmrc', '.gitconfig', '.git-credentials', 'Library/Keychains'].map(p => `${homedir()}/${p}`);
  const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
    + '(deny file-read* ' + denied.map(p => `(subpath ${JSON.stringify(p)})`).join(' ') + ')'
    + '(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty") '
    + writable.map(p => `(subpath ${JSON.stringify(p)})`).join(' ') + ')';
  const sandboxArgs = ['-p', profile, binary, ...args];
  const child = spawn(ptyMarker ? '/usr/bin/python3' : '/usr/bin/sandbox-exec',
    ptyMarker ? [join(process.cwd(), 'drive-pty.py'), ptyMarker, '/usr/bin/sandbox-exec', ...sandboxArgs] : sandboxArgs,
    { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false, ptyGroup, closed = false;
  child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; ptyGroup = Number(stderr.match(/CORDYCEPS_PTY_GROUP=(\d+)/)?.[1]) || ptyGroup; });
  // Darwin can return EPERM for an already-reaped hardened native process group.
  // Ignore that race only after this exact child emitted close; live-child failures still surface.
  const kill = () => { for (const pid of [ptyGroup, child.pid].filter(Boolean)) { try { process.kill(-pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH' && !(closed && e.code === 'EPERM')) throw e; } } };
  onStart?.({ kill, output: () => stdout });
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
  try { return { ...await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { closed = true; resolve({code, signal}); }); }), stdout, stderr, timedOut }; }
  finally { clearTimeout(timer); kill(); }
}
