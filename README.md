<p align="center">
  <img src="assets/cordyceps-256.png" alt="Cordyceps logo" width="256" height="256">
</p>

<h1 align="center">Cordyceps</h1>

Test your app with real AI agents and predictable model responses.

Cordyceps runs a local model provider you control. Your app launches Claude Code,
Codex, or another supported agent as usual. Your test decides what the model says
and which tools it calls, then checks what your app does with the result.

## Install

Early alpha. Requires Node.js 22 or later.

```sh
npm install --save-dev https://github.com/trevordilley/cordyceps/releases/download/v0.0.1-alpha.1/cordyceps.tgz
```

[Releases and curl downloads →](docs/releases.md)

## Try it

With Codex installed, run this from a Git repository:

```js
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cordyceps } from 'cordyceps';

const run = promisify(execFile);
const ai = await cordyceps.prepare({
  harness: 'codex',
  mode: 'nonInteractive',
});

try {
  ai.route(() => true, route =>
    route.fulfill({ text: 'Hello from the test' }));

  const { stdout } = await run('codex', [...ai.args, 'Say hello'], {
    env: ai.environment(process.env),
    timeout: 15_000,
  });

  assert.match(stdout, /Hello from the test/);
  ai.assertHealthy();
} finally {
  await ai.dispose();
}
```

In your app's tests, pass `ai.environment(...)`, `ai.args`, and any generated
configuration files to your existing agent launcher. You keep control of agent
startup, permissions, and shutdown.

## What you can test

- **Responses:** return text, stream it a piece at a time, or send an error.
- **Tools:** ask the real agent to read a file and inspect the result it sends back.
- **Cancellation:** hold a response while your app cancels the request.
- **Requests:** inspect prompts, available tools, and tool results through `ai.requests`.

There's also a `cordyceps/playwright` fixture that handles session setup and
teardown. Install `@playwright/test` to use it.

## Examples and docs

- [Real CLI tests](docs/real-cli.md) — Claude Code and Codex
- [Browser tests](docs/real-frontend.md) — Playwright driving an app backed by Claude
- [ACP sessions](docs/real-acp.md) — permissions, tools, and cancellation
- [Supported agents and verification](docs/verification.md)
- [Provider controls](docs/provider-codecs.md)
- [Adding an agent](docs/registry.md)

## Development

```sh
bun install --frozen-lockfile
bun run check
bun test tests
bun run test:node
bun run build
node scripts/verify-package.mjs
```

[CI](docs/ci.md) · [Release workflow](docs/releases.md)
