# Cordyceps

Cordyceps is an npm library for testing applications around installed AI harnesses. It runs a local mock model provider and prepares environment values, arguments and optional configuration files. Your application chooses and launches its real binary or ACP adapter, handles its output, and closes its processes.

This initial implementation ships ESM JavaScript and TypeScript declarations for Node 22 or later. Bun is used to develop, build and test the library; consumers do not need Bun. No npm publication has been performed. [GitHub Actions](docs/ci.md) runs the library checks on Linux and real consumer groups on macOS; run logs and artifacts are available in the repository’s Actions tab.

## Install the alpha

The initial package version is **0.0.1-alpha**. Once the corresponding GitHub
prerelease is published, install its built package directly in your application:

```sh
npm install --save-dev https://github.com/trevordilley/cordyceps/releases/download/v0.0.1-alpha/cordyceps.tgz
```

See [GitHub releases](docs/releases.md) for curl downloads, checksum verification,
stable releases and the maintainer release flow. The workflow must publish the
release before this URL is available.

## Usage

```js
import { cordyceps } from 'cordyceps';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ai = await cordyceps.prepare({
  harness: 'claude-code', mode: 'nonInteractive',
});
try {
  ai.route(() => true, route => route.fulfill({ text: 'Hello from the test' }));
  // Current Claude consumers may also issue these auxiliary requests.
  ai.route(r => r.raw.path.split('?')[0] === '/api/hello',
    route => route.fulfill({ health: true }));
  ai.route(r => r.raw.path.split('?')[0] === '/v1/messages/count_tokens',
    route => route.fulfill({ inputTokens: 100 }));
  const prompt = 'Say hello';
  // Explicit consumer instrumentation; Cordyceps cannot observe your process by itself.
  ai.recordInput(prompt);
  const { stdout } = await promisify(execFile)('claude', [...ai.args, prompt], {
    env: ai.environment(process.env), timeout: 15_000,
  });
  console.log(stdout, ai.requests);
  ai.assertHealthy();
} finally {
  await ai.dispose();
}
```

This short API sketch requires a consumer-installed Claude Code binary and its ordinary permission setup. For complete runnable consumers with isolated configuration, actual tool reads and cleanup, see [installed CLI tests](docs/real-cli.md) and [browser E2E tests](docs/real-frontend.md). The [real ACP example](docs/real-acp.md) also exercises native sessions, permissions and cancellation. All three build, pack and install the actual library before exercising real harnesses. Apply the settings before the application or child process starts. A cached environment, an existing daemon or a configuration override can bypass injection; assert that the mock actually receives the expected request.

Real text and file-read workflows are verified for **43 native agent families**: 18 from the [DevSwarm inventory](docs/devswarm-agents.md) and 25 additional integrations from the [Superset/Orca audit](docs/orchestrator-agents.md). Codebuff is verified from pinned official source; its published 1.0.688 binary remains excluded. Polygraph is verified launching Claude. Cursor, Qodo, Devin, TRAE, Qoder, UFO, Claude Teams mode and unverified WSL variants are excluded. The inventories retain every source entry and diagnostic boundary. Agents using an existing provider protocol need an injection recipe; a different wire protocol needs codec code plus a real consumer test. CLI verification does not imply ACP support.

## Provider controls

`prepare({ harness, mode = 'interactive', registry?, inputs?, signal? })` returns an isolated session with `baseUrl`, `apiKey`, `environment(baseEnv)`, `args` and `configFiles`. It does not launch or inspect an executable. An absent recipe or codec is an explicit configuration error.

The optional preparation signal remains connected for the session lifetime: aborting it disposes the session. Provider request bodies are limited to 16 MiB by default (`maxRequestBodyBytes` can change this); transcripts remain in memory until the session is released.

Register routes before starting the app. The newest matching route wins; `route(predicate, handler)` returns a function that removes that route. Predicates receive captured requests. Handlers receive a route with `request`, `signal`, `fulfill`, `abort` and `untilAborted`. Unmatched requests and handler failures are recorded in `failures`; no traffic falls through to a real provider. Call `assertHealthy()` in standalone tests to surface asynchronous handler failures. Deliberately scripted provider HTTP errors are ordinary responses, not handler failures.

```js
ai.route(request => request.text.includes('read fixture'), async route => {
  const actual = route.request.toolResults.find(result => result.id === 'read-fixture');
  if (actual) {
    if (actual.isError || !actual.text.includes('fixture contents')) {
      throw new Error('The real tool did not return the expected file contents');
    }
    return route.fulfill({ text: 'File read verified' });
  }
  if (!route.request.tools.some(tool => tool.name === 'Read')) {
    throw new Error('The selected harness did not offer Read');
  }
  return route.fulfill({ toolCall: {
    id: 'read-fixture', name: 'Read', input: { file_path: fixturePath },
  } });
});
```

`fixturePath` is a consumer-created file, and `Read`/`file_path` must match the actual tool schema offered by your harness. The real harness or its consumer-owned client handlers execute the operation with normal permissions. Cordyceps never supplies a fabricated file result.

Generation codecs support text, a single-tool-call shorthand, scripted errors and asynchronous text/tool event streams:

```js
ai.route(() => true, route => route.fulfill({
  stream: (async function* () {
    yield { text: 'Hello' };
    await consumerGate; // your promise; release it in your test's finally block
    yield { text: ' world' };
  })(),
}));
// Alternative: route.fulfill({ error: { status: 429, message: 'Try later' } })
// Cancellation scenario: await route.untilAborted(), while your ACP client cancels.
```

`requests` retains raw HTTP and normalized text, offered tool schemas and tool results. `responses` records encoded delivery and outcomes. `waitForRequest(predicate, { timeout: 5000, signal })` searches history and then waits for future requests. Input and native ACP observations come only from your explicit instrumentation; they are separate from provider transcripts. See [ACP consumer integration](docs/acp-consumers.md) and [provider codec details](docs/provider-codecs.md).

Dispose the session in `finally`, after closing your app and its processes. Disposal aborts held exchanges and waits, closes sockets and removes owned config files. A failed preparation rolls back its acquired resources. It does not terminate application processes. Independent sessions have separate ports, routes and files; `environment(baseEnv)` returns a new object without globally changing `process.env`.

## Playwright

Install `@playwright/test` in the consumer project to use the optional entry point:

```ts
import { test, expect } from 'cordyceps/playwright';

test.use({ cordyceps: { harness: 'claude-code', mode: 'nonInteractive' } });
test('controls a provider exchange', async ({ ai }) => {
  ai.route(() => true, route => route.fulfill({ text: 'Hello' }));
  // Launch and drive your app using ai.environment(baseEnv), ai.args and configFiles.
  // Assert its real output with your usual Playwright page or application fixtures.
  expect(ai.args.length).toBeGreaterThan(0);
});
```

The test-scoped `ai` fixture wraps the same `prepare` and `dispose` implementation and checks for handler failures during teardown. Make your application fixture depend on `ai`, so the application closes before `ai` is disposed. This follows [Playwright fixture dependency and teardown ordering](https://playwright.dev/docs/test-fixtures#execution-order). Importing `cordyceps` alone does not load Playwright.

## Private and contributed definitions

```js
const registry = cordyceps.createRegistry({ builtins: false });
await registry.loadFile('./my-harness.json');
const ai = await cordyceps.prepare({ registry, harness: 'my-harness', mode: 'acp' });
```

Local and bundled definitions use the same validator and renderer. Definitions describe injection data; a new provider wire format requires codec code. See [the registry format and contribution path](docs/registry.md). Bundled recipes are documented settings, not executable-version certification. The bundled `claude-code-acp` definition provides the verified official adapter recipe; use it with `mode: 'acp'`. The consumer still installs and launches that adapter. Missing ACP recipes never fall back to a text invocation.

## Development and verification

```sh
bun install --frozen-lockfile
bun run check
bun test tests
bun run test:node
bun run build
node scripts/verify-package.mjs
```

The package check packs the artifact, installs it into clean Node consumers, verifies core use with no Playwright installed, checks published declarations, and runs the optional Playwright adapter with synthetic provider traffic. The separate real-consumer examples exercise installed CLI output, actual file reads and a Chromium frontend against the same packed library. They are consumer code in `examples/`, not public process-running APIs. See [verification results and reproduction commands](docs/verification.md) for the exact observations and remaining limits. The exploratory files in `experiments/` remain historical evidence.

Release naming, license terms and publication credentials remain release decisions. There is no install hook, required CLI, harness downloader, shell adapter or direct ACP mock peer.
