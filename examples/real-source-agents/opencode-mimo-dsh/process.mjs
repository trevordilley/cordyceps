import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

export function isolatedEnv(root) {
  const home = join(root, 'home');
  return { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: root, TERM: 'xterm-256color', SHELL: '/bin/sh', LANG: 'en_US.UTF-8',
    XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'),
    XDG_STATE_HOME: join(home, '.local/state'), XDG_CACHE_HOME: join(home, '.cache'),
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1',
    DO_NOT_TRACK: '1', OTEL_SDK_DISABLED: 'true',
  };
}
export async function launch(binary, args, cwd, env, writable, { input, timeout = 65_000, ptyMarker, ptyPrompt = '' } = {}) {
  const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
    + '(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty")'
    + writable.map(path => `(subpath ${JSON.stringify(path)})`).join(' ') + ')';
  const command = ['/usr/bin/sandbox-exec', '-p', profile, binary, ...args];
  const child = spawn(ptyMarker ? '/usr/bin/python3' : command[0], ptyMarker ? [new URL('./drive-pty.py', import.meta.url).pathname, ptyMarker, ptyPrompt, ...command] : command.slice(1), {
    cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const groups = () => [child.pid, ...[...stderr.matchAll(/CORDYCEPS_PTY_GROUP=(\d+)/g)].map(m => Number(m[1]))];
  const kill = () => {
    for (const pid of groups()) try { process.kill(-pid, 'SIGKILL'); } catch (e) {
      if (e.code !== 'ESRCH' && e.code !== 'EPERM') throw e;
      // EPERM can occur during Darwin terminal teardown; settle() must still
      // establish that no live process remains in our exact owned groups.
    }
  };
  const settle = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      kill();
      const ps = spawnSync('/bin/ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8' });
      if (ps.status !== 0) throw Error(`Cannot verify owned process cleanup: ${ps.stderr}`);
      const owned = new Set(groups());
      const live = ps.stdout.split('\n').filter(line => {
        const [, group, stat] = line.trim().split(/\s+/);
        return owned.has(Number(group)) && stat && !stat.startsWith('Z');
      });
      if (live.length === 0) return;
      if (attempt === 19) throw Error(`Owned process groups still live after teardown: ${live.join('; ')}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return { binary, args, ...result, stdout, stderr, timedOut };
  } finally { clearTimeout(timer); await settle(); }
}
