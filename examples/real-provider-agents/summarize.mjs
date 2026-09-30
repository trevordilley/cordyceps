import { readFile } from 'node:fs/promises';
const evidence = JSON.parse(await readFile(process.argv[2] ?? new URL('./evidence.json', import.meta.url), 'utf8'));
const sources = {
  copilot: ['https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models'],
  goose: ['https://github.com/aaif-goose/goose/blob/main/documentation/docs/getting-started/providers.md', 'https://github.com/aaif-goose/goose/blob/main/CONTRIBUTING.md'],
  droid: ['https://docs.factory.ai/model-independence/byok'],
  opencode: ['https://opencode.ai/docs/providers/', 'https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts'],
  crush: ['https://github.com/charmbracelet/crush#custom-providers', 'https://github.com/charmbracelet/crush/blob/main/schema.json'],
};
console.log(JSON.stringify({ date: evidence.date, node: evidence.node, artifact: evidence.artifact,
  isolation: evidence.isolation, devswarmSourceCommit: 'd7c33873380e092018140ccf6e90529e1605fff0',
  agents: Object.keys(sources).filter(id => evidence.cases.some(c => c.harness === id)).map(id => {
    const cases = evidence.cases.filter(c => c.harness === id);
    return { id, recipe: `harnesses/${id}.json`, adapter: 'anthropic-messages',
      binary: cases[0].binary, version: cases[0].version.stdout.trim(), sources: sources[id],
      allScenariosPassed: cases.every(c => c.passed), cases: cases.map(c => ({ scenario: c.scenario,
        command: [c.binary, ...c.args], passed: c.passed, capturedRequests: c.requests.length,
        assertions: c.assertions, scriptedCall: c.scriptedCall, cleanedUp: c.cleanedUp,
        outputBeforeStreamCompletion: c.outputBeforeStreamCompletion,
        providerAbortObserved: c.providerAbortObserved, error: c.error })) };
  }) }, null, 2));
