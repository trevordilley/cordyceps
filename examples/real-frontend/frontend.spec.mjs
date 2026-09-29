import { test as base, expect } from 'cordyceps/playwright';
import { randomUUID } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startConsumer } from './consumer-server.mjs';

// Dependency order ensures consumer children and HTTP listener close before ai.
const test = base.extend({
  app: async ({ ai }, use, testInfo) => {
    const app = await startConsumer(ai);
    try { await use(app); }
    finally {
      await app.close();
      expect(app.harness.activePid).toBeUndefined();
      await expect(access(app.harness.root)).rejects.toThrow();
      await expect(fetch(app.url)).rejects.toThrow();
      for (const launch of app.harness.launches) {
        expect(() => process.kill(launch.pid, 0)).toThrow();
      }
      await testInfo.attach('consumer-evidence', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({
          node: process.version, harness: app.harness.version, mockUrl: ai.baseUrl,
          launches: app.harness.launches, inputs: ai.inputs,
          requests: ai.requests.map(r => ({ text: r.text, tools: r.tools, toolResults: r.toolResults })),
          responses: ai.responses,
          cleanup: { processExited: true, fixtureRemoved: true, listenerClosed: true },
        }, null, 2)),
      });
    }
  },
});
test.use({ cordyceps: { harness: 'claude-code', mode: 'nonInteractive' } });

async function send(page, app, prompt) {
  await page.goto(app.url);
  await page.getByLabel('Prompt', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test('browser prompt reaches installed Claude and renders the provider reply', async ({ page, ai, app }) => {
  const prompt = `Browser text ${randomUUID()}`;
  const reply = `Actual harness reply ${randomUUID()}`;
  ai.route(() => true, route => {
    expect(route.request.text).toContain(prompt);
    return route.fulfill({ text: reply });
  });
  await send(page, app, prompt);
  await expect(page.getByRole('status')).toHaveText('Complete');
  await expect(page.getByLabel('Harness reply')).toHaveText(reply);
  expect(ai.inputs.map(i => i.data)).toEqual([prompt]);
  expect(ai.requests).toHaveLength(1);
  expect(ai.requests[0].stream).toBe(true);
  expect(app.harness.launches[0].code).toBe(0);
});

test('real Read tool returns disposable file content to the provider before UI completion', async ({ page, ai, app }) => {
  const token = `file-only-secret-${randomUUID()}`;
  const path = join(app.harness.cwd, 'fixture.txt');
  await writeFile(path, `${token}\n`);
  const prompt = `Read ${path} and report what you found.`;
  let actual;
  ai.route(() => true, route => {
    expect(route.request.text).toContain(prompt);
    actual = route.request.toolResults.find(r => r.id === 'read-real-fixture');
    if (actual) {
      expect(actual.isError).toBe(false);
      expect(actual.text).toContain(token);
      // UI reply derives from the actual harness result, not the fixture variable.
      return route.fulfill({ text: `Read returned: ${actual.text}` });
    }
    expect(route.request.tools.some(t => t.name === 'Read')).toBe(true);
    expect(route.request.text).not.toContain(token);
    return route.fulfill({ toolCall: { id: 'read-real-fixture', name: 'Read', input: { file_path: path } } });
  });
  await send(page, app, prompt);
  await expect(page.getByRole('status')).toHaveText('Complete');
  expect(actual).toBeDefined();
  await expect(page.getByLabel('Harness reply')).toHaveText(`Read returned: ${actual.text}`);
  expect(ai.requests).toHaveLength(2);
  expect(ai.requests[1].toolResults[0].raw.tool_use_id).toBe('read-real-fixture');
  expect(app.harness.launches[0].code).toBe(0);
});

test('browser cancel stops held harness request and next turn succeeds', async ({ page, ai, app }) => {
  const prompt = `Hold ${randomUUID()}`;
  let aborted = false;
  ai.route(request => request.text.includes(prompt), async route => {
    await route.untilAborted();
    aborted = true;
  });
  await send(page, app, prompt);
  await ai.waitForRequest(request => request.text.includes(prompt), { timeout: 20_000 });
  const pid = app.harness.activePid;
  expect(pid).toBeGreaterThan(0);
  await expect(page.getByRole('status')).toHaveText('Running');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Cancelled');
  await expect.poll(() => aborted).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(page.getByLabel('Harness reply')).toBeEmpty();
  const next = `Next ${randomUUID()}`;
  ai.route(request => request.text.includes(next), route => route.fulfill({ text: 'Recovered through Claude' }));
  await page.getByLabel('Prompt', { exact: true }).fill(next);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Complete');
  await expect(page.getByLabel('Harness reply')).toHaveText('Recovered through Claude');
  expect(ai.inputs.map(i => i.data)).toEqual([prompt, next]);
  expect(app.harness.launches).toHaveLength(2);
  expect(app.harness.launches[1].code).toBe(0);
});
