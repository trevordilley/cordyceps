// Compact evidence: retain actual output and selected wire fields, omit system prompts.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [source, destination] = process.argv.slice(2);
const full = JSON.parse(await readFile(source, 'utf8'));
for (const c of full.cases) {
  if (c.pty) {
    c.process.stdoutSha256 = createHash('sha256').update(c.process.stdout).digest('hex');
    delete c.process.stdout; // The parsed PTY record below preserves its actual transcript once.
  }
  c.requests = c.requests.map(r => ({ method: r.raw.method, path: r.raw.path, model: r.model, stream: r.stream,
    rawBodySha256: createHash('sha256').update(r.raw.body).digest('hex'),
    promptMessages: (r.body.messages ?? r.body.input ?? []).filter(m => JSON.stringify(m).includes(c.prompt)),
    selectedTool: r.tools.find(t => t.name === c.scriptedCall?.name), toolResults: r.toolResults }));
}
full.projection = 'Actual native output and selected wire fields; system prompts, other schemas and request headers omitted. Raw-body SHA-256 binds projections to full local evidence.';
await writeFile(destination, JSON.stringify(full, null, 2) + '\n');
