// Repo-side consumer verifier. Run under real Node >=22 through hivecontrol.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
assert(!process.versions.bun && Number(process.versions.node.split('.')[0]) >= 22, 'Use actual Node >=22, not a node-to-Bun shim');
assert(process.env.CLAUDE_BINARY, 'Set CLAUDE_BINARY to the installed Claude Code absolute path');
const source = dirname(fileURLToPath(import.meta.url));
const repo = resolve(source, '../..');
const root = await mkdtemp(join(tmpdir(), 'cordyceps-packed-frontend-'));
const consumer = join(root, 'consumer');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, CI: '1',
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', PLAYWRIGHT_JSON_OUTPUT_FILE: join(consumer, 'test-results/report.json'), npm_config_userconfig: join(root, 'npmrc') };
const run = (command, args, cwd = repo) => execFileSync(command, args, {
  cwd, env, encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await writeFile(env.npm_config_userconfig, 'registry=https://registry.npmjs.org/\n');
  console.log(run('bun', ['run', 'build']).trim());
  const pack = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root]))[0];
  assert(pack.files.some(f => f.path === 'dist/playwright.js'));
  const artifact = join(root, pack.filename);
  console.log(`Artifact SHA256: ${createHash('sha256').update(await readFile(artifact)).digest('hex')}`);
  await cp(source, consumer, { recursive: true, filter: path => !/(?:^|\/)(node_modules|test-results|playwright-report)(?:\/|$)/.test(path) });
  console.log(run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', artifact], consumer).trim());
  const installed = join(consumer, 'node_modules/cordyceps');
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  assert.equal(await readFile(join(installed, 'dist/index.js'), 'utf8'), await readFile(join(repo, 'dist/index.js'), 'utf8'));
  const cli = join(consumer, 'node_modules/@playwright/test/cli.js');
  try { console.log(run(process.execPath, [cli, 'test', '--reporter=list,json'], consumer).trim()); }
  catch (error) {
    console.error(String(error.stdout ?? ''), String(error.stderr ?? ''));
    throw new Error(`Packed frontend Playwright run failed (exit ${error.status})`);
  } finally {
    if (process.env.FRONTEND_EVIDENCE_DIR) {
      await cp(join(consumer, 'test-results'), resolve(process.env.FRONTEND_EVIDENCE_DIR), { recursive: true });
    }
  }
  const report = JSON.parse(await readFile(env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'utf8'));
  assert.equal(report.stats.expected, 3);
  for (const field of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[field], 0);
  for (const suite of report.suites) for (const spec of suite.specs) {
    const attachments = spec.tests[0].results[0].attachments;
    const attachment = attachments.find(a => a.name === 'consumer-evidence');
    assert(attachment, 'Missing consumer cleanup evidence');
    const evidence = JSON.parse(Buffer.from(attachment.body, 'base64').toString());
    await assert.rejects(fetch(evidence.mockUrl, { signal: AbortSignal.timeout(2000) }));
  }
  console.log(`PASS: real Node ${process.version}; packed npm install; browser text, real Read result, cancellation/reuse; per-test process/listener/fixture cleanup; all mock listeners closed.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
