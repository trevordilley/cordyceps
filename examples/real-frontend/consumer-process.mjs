// Consumer-owned process and isolation policy. None of this is a Cordyceps runner.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';

// Fail closed on unsupported platforms: this example's verified network boundary
// is macOS Seatbelt. Only the mock's loopback port is reachable by the harness.
export function sandboxArgs(baseUrl) {
  if (process.platform !== 'darwin') throw new Error('This example requires macOS sandbox-exec');
  const url = new URL(baseUrl);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || !url.port) {
    throw new Error('Expected an explicit HTTP loopback mock port');
  }
  return ['-p', `(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:${url.port}"))`];
}

export async function createConsumerProcess(ai) {
  if (process.versions.bun || Number(process.versions.node.split('.')[0]) < 22) throw new Error('Use actual Node >=22');
  const binary = process.env.CLAUDE_BINARY;
  if (!binary || !isAbsolute(binary)) throw new Error('Set CLAUDE_BINARY to the installed Claude Code absolute path');
  const root = await mkdtemp(join(tmpdir(), 'cordyceps-frontend-'));
  const home = join(root, 'home');
  const cwd = join(root, 'workspace');
  const config = join(home, '.claude');
  let active;
  let disposed = false;
  const launches = [];
  try {
    await mkdir(config, { recursive: true });
    await mkdir(cwd);
    const env = ai.environment({
      PATH: '/usr/bin:/bin', HOME: home, TMPDIR: root,
      XDG_CONFIG_HOME: join(home, '.config'), CLAUDE_CONFIG_DIR: config,
      LANG: 'en_US.UTF-8', CI: '1', DISABLE_AUTOUPDATER: '1',
      // Match the verified installed-CLI recipe: suppress ancillary connectivity
      // probes through an unreachable proxy; model requests bypass it locally.
      NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
      HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
      ALL_PROXY: 'http://127.0.0.1:1', http_proxy: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1',
    });
    const sandbox = sandboxArgs(ai.baseUrl);
    const version = execFileSync('/usr/bin/sandbox-exec', [...sandbox, binary, '--version'], {
      env, cwd, encoding: 'utf8', timeout: 10_000,
    }).trim();
    if (!version) throw new Error('Claude version command returned no reproduction context');
    const args = [...ai.args, '--bare', '--restricted', '--no-session-persistence',
      '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--disable-slash-commands', '--no-chrome', '--tools', 'Read', '--allowedTools', 'Read',
      '--permission-mode', 'dontAsk', '--model', 'claude-sonnet-4-6', '--output-format', 'json'];

    const signalGroup = (run, signal) => {
      if (!run.child.pid) return;
      try { process.kill(-run.child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    async function stop() {
      const run = active;
      if (!run) return;
      run.cancelled = true;
      signalGroup(run, 'SIGTERM');
      const force = setTimeout(() => signalGroup(run, 'SIGKILL'), 1000);
      try { await run.closed; } finally { clearTimeout(force); }
    }
    return {
      root, cwd, version, launches,
      get activePid() { return active?.child.pid; },
      async prompt(prompt) {
        if (disposed) throw new Error('Consumer is closed');
        if (active) throw new Error('A turn is already running');
        // Input observation is at the real consumer send boundary, not a test echo.
        ai.recordInput(prompt, { transport: 'consumer-stdin' });
        const child = spawn('/usr/bin/sandbox-exec', [...sandbox, binary, ...args], { env, cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const run = { child, cancelled: false, closed: null };
        active = run;
        let stdout = '', stderr = '', spawnError;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', data => { stdout += data; });
        child.stderr.on('data', data => { stderr += data; });
        child.on('error', error => { spawnError = error; });
        child.stdin.on('error', () => {}); // close/error below owns reporting EPIPE.
        run.closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
        const record = { pid: child.pid, args, code: null, signal: null };
        launches.push(record);
        const timeout = setTimeout(() => { void stop(); }, 30_000);
        child.stdin.end(prompt);
        try {
          const ended = await run.closed;
          Object.assign(record, ended);
          if (spawnError) throw spawnError;
          if (run.cancelled) return { cancelled: true };
          if (ended.code !== 0) throw new Error(`Claude exited ${ended.code}: ${stderr}\n${stdout}`);
          const result = JSON.parse(stdout);
          if (result.is_error || typeof result.result !== 'string') throw new Error(`Claude failed: ${stdout}`);
          return { text: result.result };
        } finally {
          clearTimeout(timeout);
          if (child.pid) signalGroup(run, 'SIGKILL');
          if (active === run) active = undefined;
        }
      },
      stop,
      async close() {
        disposed = true;
        try { await stop(); } finally { await rm(root, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
