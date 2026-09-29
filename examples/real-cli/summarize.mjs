// Preserve exact selected wire fields without committing CLI system prompts.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [source, destination] = process.argv.slice(2);
const full = JSON.parse(await readFile(source, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const summary = { capturedAt: new Date().toISOString(), artifact: full.artifact, node: full.node,
  platform: full.platform, packageEntry: full.packageEntry,
  scope: 'Exact selected request fields and CLI output. System prompts, unselected tool schemas and headers omitted; raw body SHA-256 ties each projection to full local evidence.',
  cases: full.cases.map(c => ({ harness: c.harness, scenario: c.scenario, version: c.version.stdout.trim(),
    args: c.args, process: c.process, scriptedCall: c.scriptedCall, passed: c.passed ?? false, cleanedUp: c.cleanedUp,
    requests: c.requests.map(r => ({ method: r.raw.method, path: r.raw.path, model: r.model, stream: r.stream,
      rawBodySha256: sha256(r.raw.body),
      promptMessages: (r.body.messages ?? r.body.input ?? []).filter(m => JSON.stringify(m).includes('cordyceps-real-cli-')),
      selectedTool: r.tools.find(t => t.name === c.scriptedCall?.name),
      toolResults: r.toolResults,
    })),
  })) };
await writeFile(destination, JSON.stringify(summary, null, 2) + '\n');
