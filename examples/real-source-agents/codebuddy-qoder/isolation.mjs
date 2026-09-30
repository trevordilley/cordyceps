import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
export function environment(home, root) {
  return { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: root,
    TERM: 'xterm-256color', SHELL: '/bin/sh', LANG: 'en_US.UTF-8',
    XDG_CONFIG_HOME: `${home}/.config`, XDG_DATA_HOME: `${home}/.local/share`,
    XDG_STATE_HOME: `${home}/.local/state`, XDG_CACHE_HOME: `${home}/.cache`,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1', DO_NOT_TRACK: '1',
    CODEBUDDY_SKIP_BUILTIN_MARKETPLACE: '1' };
}
export async function launch(binary, args, cwd, env, writable, timeout = 45_000) {
  const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
    + '(deny file-write*)(allow file-write* (literal "/dev/null") (literal "/dev/tty")'
    + writable.map(path => `(subpath ${JSON.stringify(path)})`).join(' ') + ')';
  const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, binary, ...args], {
    cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return { ...result, stdout, stderr, timedOut };
  } finally { clearTimeout(timer); kill(); }
}
