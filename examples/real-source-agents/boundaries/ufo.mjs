// Diagnostic only: no fake agent decisions or success recipe.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
assert.equal(process.platform, 'darwin');
assert.equal(process.versions.bun, undefined);
const binary = resolve(process.env.UFO_BINARY ?? '/tmp/cordyceps-source-extra/ufo');
const root = await realpath(await mkdtemp(join(tmpdir(), 'cordyceps-ufo-')));
const requests = [];
const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Controlled diagnostic: no UFO account or remote agent emulation' }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const evidence = { date: new Date().toISOString(), binary, sha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
  isolation: 'allowlisted environment; disposable HOME/UFO_HOME/work; sandbox loopback-only outbound and owned-directory writes', requests, cases: [] };
try {
  const home = join(root, 'home'), work = join(root, 'work'); await mkdir(home); await mkdir(work);
  const env = { HOME: home, UFO_HOME: home, TMPDIR: root, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TERM: 'xterm-256color', UFO_URL: url, WORKSPACE_URL: url, ANTHROPIC_BASE_URL: url, ANTHROPIC_API_KEY: 'cordyceps-test-key' };
  const profile = `(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(deny file-write*)(allow file-write* (subpath ${JSON.stringify(root)}) (literal "/dev/null") (literal "/dev/tty"))`;
  for (const args of [['--version'], ['--help'], ['--json', 'cordyceps-ufo: reply with the controlled message'], ['llm', 'cordyceps-ufo: reply with the controlled message']]) {
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, binary, ...args], { env, cwd: work, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const record = { args, stdout: '', stderr: '' }; evidence.cases.push(record);
    child.stdout.on('data', c => record.stdout += c); child.stderr.on('data', c => record.stderr += c);
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { record.timedOut = true; kill(); }, 15000);
    try { Object.assign(record, await new Promise((r,j) => { child.once('error', j); child.once('close', (code, signal) => r({ code, signal })); })); }
    finally { clearTimeout(timer); kill(); }
  }
  assert.ok(requests.some(r => r.method === 'POST' && r.url.startsWith('/surface/ufo/') && r.body.includes('cordyceps-ufo:')));
  assert.equal(evidence.cases[2].code, 1);
  assert.ok(evidence.cases[2].stdout.includes('chat failed (401)'));
  assert.equal(evidence.cases[3].code, 1);
  assert.ok(evidence.cases[3].stderr.includes('https://api.anthropic.com/v1/messages'));
  evidence.status = 'excluded-no-local-model-control-established';
} finally {
  server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, {recursive:true,force:true});
  evidence.cleanedUp = true;
  await writeFile(process.argv[2] ?? '/tmp/cordyceps-ufo-boundary.json', JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify(evidence, null, 2));
