// Probe a real Codex binary against local-only scripted Responses API servers.
// No user config or credentials are loaded; only synthetic API keys are supplied.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const binary = process.argv[2] || 'codex';
const root = await mkdtemp(join(tmpdir(), 'cordyceps-codex-'));
const requests = [];
const servers = [];
async function backend(label) {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ server: label, method: req.method, path: req.url,
      hasPrompt: body.includes('cordyceps-endpoint-probe') });
    if (req.method !== 'POST' || req.url !== '/v1/responses') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Local probe: unsupported route' } }));
    }
    const text = `MOCK_REPLY_${label}`;
    const message = { id: 'msg_probe', type: 'message', role: 'assistant',
      status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
    const response = { id: 'resp_probe', object: 'response', created_at: 1,
      status: 'completed', model: 'gpt-5.4', output: [message],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0,
        item: { ...message, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', item_id: message.id, output_index: 0,
        content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', item_id: message.id, output_index: 0,
        content_index: 0, delta: text },
      { type: 'response.output_text.done', item_id: message.id, output_index: 0,
        content_index: 0, text },
      { type: 'response.content_part.done', item_id: message.id, output_index: 0,
        content_index: 0, part: message.content[0] },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response },
    ];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(events.map((event, sequence_number) =>
      `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}/v1`;
}

try {
  const envURL = await backend('ENV');
  const configURL = await backend('CONFIG');
  const cases = [
    { name: 'environment-only', config: '', expected: 'ENV' },
    { name: 'config-versus-environment', config: `openai_base_url = "${configURL}"\n`, expected: 'CONFIG' },
    { name: 'custom-provider-versus-environment', expected: 'CONFIG', config:
      `model_provider = "local_probe"\n[model_providers.local_probe]\nname = "Local probe"\nbase_url = "${configURL}"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\n` },
  ];
  for (const scenario of cases) {
    const dir = join(root, scenario.name);
    await mkdir(dir);
    const configHome = join(dir, 'config');
    await mkdir(configHome);
    await writeFile(join(configHome, 'config.toml'), scenario.config);
    const start = requests.length;
    const child = spawn(binary, ['exec', '--skip-git-repo-check', '--ephemeral',
      '--json', '-m', 'gpt-5.4', '-s', 'read-only', 'cordyceps-endpoint-probe: say hello'], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, TMPDIR: tmpdir(),
        CODEX_HOME: configHome, OPENAI_BASE_URL: envURL,
        OPENAI_API_KEY: 'sk-local-probe-not-a-real-key',
        NO_PROXY: '127.0.0.1,localhost', HTTP_PROXY: envURL, HTTPS_PROXY: envURL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 20_000);
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    clearTimeout(timer);
    const observed = requests.slice(start);
    const passed = code === 0 && stdout.includes(`MOCK_REPLY_${scenario.expected}`)
      && observed.some(r => r.server === scenario.expected
        && r.path === '/v1/responses' && r.hasPrompt);
    console.log(JSON.stringify({ case: scenario.name, code, timedOut, passed,
      requests: observed, output: stdout, diagnostics: stderr }));
    if (!passed) process.exitCode = 1;
  }
} finally {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await rm(root, { recursive: true, force: true });
}
