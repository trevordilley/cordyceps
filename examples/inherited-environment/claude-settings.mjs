// Prove that normal Claude startup can consume prepared files without provider env overrides.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { prepare, match, anthropic } from 'cordyceps';
import { environment, launch } from '../real-extra-cli/isolation.mjs';

assert.equal(process.platform, 'darwin', 'macOS sandbox-exec required');
assert.ok(isAbsolute(process.env.CLAUDE_BINARY ?? ''), 'Set CLAUDE_BINARY to an installed executable');
const root = await realpath(await mkdtemp(join(tmpdir(), 'cordyceps-home-settings-')));
const ai = await prepare({ harness: 'claude-code' });
let setup;
try {
  setup = await ai.installClaudeSettings({ home: join(root, 'home') });
  const prompt = `Home settings prompt ${randomUUID()}`;
  const reply = `Home settings reply ${randomUUID()}`;
  ai.scenario([{ name: 'configured-through-home', match: match.lastUserMessage(text => text.includes(prompt)),
    handle: route => route.fulfill({ text: reply }) }], { background: anthropic.background({ inputTokens: 32 }) });
  const env = { ...environment(setup.home, root), CLAUDE_CODE_TMPDIR: root };
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  const result = await launch(process.env.CLAUDE_BINARY, ['--print', '--model', 'claude-sonnet-4-6',
    '--no-session-persistence', '--setting-sources', 'user', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--tools', '', '--disable-slash-commands', '--output-format', 'json', prompt], root, env, [root]);
  assert.equal(result.timedOut, false);
  assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(JSON.parse(result.stdout).result, reply);
  ai.assertComplete();
  const evidence = { node: process.version, binary: process.env.CLAUDE_BINARY, passed: true,
    injection: 'HOME settings and apiKeyHelper; no provider environment override',
    expectations: ai.expectations, matches: ai.matches, cleanup: 'checked after session disposal' };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try { await ai.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
}
await assert.rejects(access(setup.settingsPath));
await assert.rejects(fetch(ai.baseUrl, { signal: AbortSignal.timeout(2000) }));
