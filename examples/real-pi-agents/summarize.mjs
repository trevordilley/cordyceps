import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const path = process.argv[2] ?? fileURLToPath(new URL('evidence.json', import.meta.url));
const evidence = JSON.parse(await readFile(path, 'utf8'));
const observations = {
  date: evidence.date, node: evidence.node, packageEntry: evidence.packageEntry, artifact: evidence.artifact,
  cases: evidence.cases.map(c => ({
    harness: c.harness, scenario: c.scenario, passed: c.passed,
    package: c.binaryPackage, version: c.harness === 'mastra-code' ? c.binaryPackage?.version : c.version?.stdout.trim(),
    requests: c.requests?.length, tool: c.scriptedCall, assertions: c.assertions,
    daemonShutdownForCancellation: c.daemonShutdownForCancellation ?? false,
    cleanedUp: c.cleanedUp, error: c.error, cleanupError: c.cleanupError,
  })),
};
await writeFile(process.argv[3] ?? fileURLToPath(new URL('observations.json', import.meta.url)), JSON.stringify(observations, null, 2) + '\n');
console.log(JSON.stringify(observations, null, 2));
