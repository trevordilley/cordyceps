# Testing an app that launches an agent

Give the prepared configuration to the **application**, before it starts. Its
backend, workers, or extension host can then pass it to the real agent. The test
doesn't need access to the code that launches the binary.

```text
Test → application → worker / extension host → real agent → Cordyceps
       ↑ prepared environment                              ↓ scripted response
       └──────────────── actual app result ────────────────┘
```

`prepare()` supplies data. Your application decides how to consume it:

| Prepared value | How the app uses it |
| --- | --- |
| `ai.environment(base)` | A new environment with provider settings applied and conflicting variables removed. Supply it at app startup or to the process that launches the agent. |
| `ai.args` | Agent arguments. Forward these through the app's agent configuration if needed; they are not arguments for Electron or your web server. |
| `ai.configFiles` | Files already written by `prepare()`. Their paths are referenced by the recipe's environment or arguments. Keep the session alive while the app uses them. |

Environment inheritance works across ordinary child processes, including agents
launched by absolute path. An app that filters environment variables, overwrites
provider settings, or uses an already-running worker must provide its own way to
apply the configuration. Containers and VMs also need access to the listener and
any generated files. Cordyceps doesn't modify a running application's environment.
See [Node's child-process environment options](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options).

## Desktop app with Playwright

This is a template for your Electron app. Replace the entry point and selectors;
the app is assumed to already launch Codex in its noninteractive mode. Install
`@playwright/test` and your app's Electron dependency alongside Cordyceps.
[Playwright's Electron launcher](https://playwright.dev/docs/api/class-electron#electron-launch)
accepts the application environment.

```js
import { _electron as electron } from 'playwright';
import { test, expect } from 'cordyceps/playwright';

test.use({ cordyceps: { harness: 'codex', mode: 'nonInteractive' } });

test('reply travels through the whole app', async ({ ai }) => {
  ai.route(request => request.text.includes('Say hello'), route =>
    route.fulfill({ text: 'Hello through the app' }));

  const app = await electron.launch({
    args: ['dist/main.js'],
    env: ai.environment(process.env),
  });
  try {
    const page = await app.firstWindow();
    await page.getByLabel('Prompt').fill('Say hello');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByLabel('Reply')).toHaveText('Hello through the app');
    await ai.waitForRequest(request => request.text.includes('Say hello'));
  } finally {
    await app.close();
  }
});
```

The fixture owns the mock; your app owns its agent processes. The app's shutdown
must stop those processes before fixture teardown disposes the mock. For an
application with a test profile or workspace setting, select that disposable
profile through its normal launch options.

## Web app with a background worker

Configure the server or worker that launches the agent. Giving environment
variables to Chromium alone doesn't configure a separately running backend.
This template uses **your own** `startApp` test helper: it accepts a launch
environment, waits for server readiness, returns its URL, and closes the server
and workers with `close()`.

```js
import { test as base, expect } from 'cordyceps/playwright';
import { startApp } from './support/app.js'; // Your application's test helper.

const test = base.extend({
  app: async ({ ai }, use) => {
    const app = await startApp({ env: ai.environment(process.env) });
    try { await use(app); }
    finally { await app.close(); }
  },
});
test.use({ cordyceps: { harness: 'codex', mode: 'nonInteractive' } });

test('a queued job produces a visible reply', async ({ ai, app, page }) => {
  ai.route(request => request.text.includes('Summarize this project'), route =>
    route.fulfill({ text: 'A small example project' }));

  await page.goto(app.url);
  await page.getByLabel('Prompt').fill('Summarize this project');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Reply')).toHaveText('A small example project');
  await ai.waitForRequest(request => request.text.includes('Summarize this project'));
});
```

The `app` fixture depends on `ai`, so app cleanup runs first. A worker started
independently of the server needs the same prepared settings at its own startup.
Use a separate app/worker instance per test when tests run concurrently.

For a browser example with an actual installed Claude binary, real file reads,
and cancellation, see [the runnable frontend consumer](real-frontend.md).

## Runnable app → worker → Codex example

[The example application](../examples/inherited-environment/app.mjs) delegates to
[a background worker](../examples/inherited-environment/worker.mjs), which invokes
Codex. Neither file imports Cordyceps. The test prepares the mock, launches only
the top-level app, and checks its public result.

From this repository, with dependencies, Bun, Node >=22, and Codex installed:

```sh
CODEX_BINARY=/absolute/path/to/codex \
  node examples/inherited-environment/verify-packed.mjs
```

This verifier requires macOS for its process sandbox. It builds and installs the
Cordyceps tarball in a temporary consumer project, then checks controlled text and
a real file read through all three processes. `CODEX_HOME` points to the generated
provider config and reaches Codex through ordinary inheritance. The app already
owns its `codex exec` arguments, so the test doesn't pass `ai.args` to the app.

The verifier uses a disposable home, restricts outbound traffic to loopback,
checks process-group cleanup, and removes generated files. If the installed
standalone binary lives inside the user's `.codex` directory, it stages a copy
of that executable so the sandbox can keep the user's credential directory
unreadable. It does not install or authenticate Codex.

## Fixed endpoint and disposable Claude home

For an app or VM image that already expects a particular port, select it when
preparing the provider. Cordyceps still binds only to `127.0.0.1`; an occupied port
fails rather than silently selecting another. VM port forwarding is app setup.

```js
import { prepare } from 'cordyceps';

const ai = await prepare({ harness: 'claude-code', port: 47900 });
try {
  const settings = await ai.installClaudeSettings({
    home: '/absolute/path/to/disposable-home',
  });
  // Launch your app with this home through its existing test-profile mechanism.
  // If it accepts an environment, settings.environment(base) supplies HOME/config.
  // Claude reads the provider URL and apiKeyHelper from the prepared home files.
  // Keep ai alive until the app and all its workers have stopped.
} finally {
  await ai.dispose();
}
```

The helper writes user-level `settings.json` and onboarding metadata for a fresh
Claude profile. `apiKeyHelper` supplies the test key without the API-key
environment approval path. Existing Claude files are never overwritten. The
home must be an absolute disposable directory with an existing parent. The
session removes its own files during disposal and leaves unrelated app files
alone. This helper currently targets POSIX Claude Code startup; permissions,
workspace trust, model selection, and process ownership remain with the app.

If the app forwards an environment, use `settings.environment(base)` so an
inherited `ANTHROPIC_API_KEY` doesn't take precedence over helper authentication.
If it relies on home files alone, ensure its own environment/configuration doesn't
select a different provider or credential source.

Run the packed real-Claude setup check with:

```sh
CLAUDE_BINARY=/absolute/path/to/claude \
  node examples/inherited-environment/verify-packed.mjs --claude-settings
```

This check launches the installed Claude CLI with a disposable `HOME`, without
`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, or `CLAUDE_CONFIG_DIR` in its launch
environment. It requires the scripted response through the prepared settings and
helper, then checks cleanup. Like the nested-process verifier, its network sandbox
requires macOS.

For required steps, current-turn matching and failure artifacts, see
[scenarios and diagnostics](scenarios.md).
