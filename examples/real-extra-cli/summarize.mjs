import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const full = JSON.parse(await readFile(process.argv[2], 'utf8'));
const summary = { ...full, cases: full.cases.map(c => ({
  harness: c.harness, scenario: c.scenario, binary: c.binary, version: c.version.stdout.trim(),
  args: c.args, prompt: c.prompt, passed: c.passed, assertions: c.assertions,
  scriptedCall: c.scriptedCall, providerAbortObserved: c.providerAbortObserved,
  requests: c.requests.map(r => ({ method: r.raw.method, path: r.raw.path, model: r.model, stream: r.stream,
    rawBodySha256: createHash('sha256').update(r.raw.body).digest('hex'), rawBodyBytes: Buffer.byteLength(r.raw.body),
    capturedPrompt: r.text.includes(c.prompt) ? c.prompt : null,
    toolNames: r.tools.map(t => t.name), toolResults: r.toolResults,
    fixtureTokens: [...new Set(r.raw.body.match(/fixture-[0-9a-f-]{36}/g) ?? [])],
  })),
  responses: c.responses, process: c.process, failures: c.failures, error: c.error, cleanedUp: c.cleanedUp,
})) };
await writeFile(process.argv[3], JSON.stringify(summary, null, 2) + '\n');
