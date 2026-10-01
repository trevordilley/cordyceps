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

## Supported harnesses

All 43 below passed controlled text and real file-read tests on macOS.
**CI** means checked in GitHub Actions and the release flow (34); **Local** means
verified locally with no hosted setup yet (9). Click a harness for setup and tested versions.

“Streaming” means incremental agent output; “buffered” means output arrives after
the provider stream finishes. Cancellation means terminating the agent process;
Claude's ACP tests also cover protocol cancellation and session reuse. A dash means
no additional checks are claimed.

| Harness | Verification | Additional checks / limits |
| --- | --- | --- |
| [Aider](docs/real-editor-agents.md) | CI | — |
| [Amazon Q / Kiro](docs/real-q.md) | Local | Streaming, cancellation; installed `q` wrapper |
| [Amp](docs/real-gated-agents.md) | Local | Buffered stream, cancellation |
| [Ante](docs/real-vendor-agents.md) | CI | — |
| [Antigravity (`agy`)](docs/real-gated-agents.md) | Local | Streaming, cancellation |
| [Auggie](docs/real-auggie.md) | CI | Streaming, cancellation |
| [Autohand](docs/real-extra-cli.md) | CI | Cancellation; nonstreaming headless mode |
| [Claude Code](docs/real-cli.md) | CI | Interactive terminal, [ACP](docs/real-acp.md), [browser](docs/real-frontend.md) |
| [Cline](docs/real-editor-agents.md) | CI | — |
| [CodeBuddy](docs/real-source-codebuddy-qoder.md) | Local | Both `codebuddy` and `cbc` aliases |
| [Codebuff](docs/real-codebuff-polygraph.md) | CI | Pinned official source only; published binary excluded |
| [Codex](docs/real-cli.md) | CI | Noninteractive mode |
| [Command Code](docs/real-extra-cli.md) | CI | Streaming, cancellation |
| [Continue CLI](docs/real-extra-cli.md) | CI | Buffered stream, cancellation |
| [Crush](docs/real-provider-agents.md) | CI | Streaming, cancellation |
| [DeepSeek Harness](docs/real-source-opencode-mimo-dsh.md) | CI | Headless and interactive terminal |
| [Factory Droid](docs/real-provider-agents.md) | CI | Buffered stream, cancellation |
| [Freebuff](docs/real-source-agents.md) | Local | Interactive terminal |
| [fx](docs/real-vendor-agents.md) | CI | — |
| [Gemini CLI](docs/real-google-agents.md) | CI | Streaming, cancellation |
| [GitHub Copilot CLI](docs/real-provider-agents.md) | CI | Streaming, cancellation |
| [Goose](docs/real-provider-agents.md) | CI | Streaming, cancellation |
| [Grok Build](docs/real-vendor-agents.md) | CI | — |
| [Hermes](docs/real-local-agents.md) | Local | Streaming, cancellation |
| [Kilo Code](docs/real-extra-cli.md) | CI | Buffered stream, cancellation |
| [Kimi Code](docs/real-pi-agents.md) | CI | Buffered stream, cancellation |
| [Mastra Code](docs/real-pi-agents.md) | CI | Streaming, cancellation |
| [MiniMax Code (`mcode`)](docs/real-vendor-agents.md) | CI | — |
| [MiMo Code](docs/real-source-opencode-mimo-dsh.md) | CI | — |
| [Mistral Vibe](docs/real-google-agents.md) | CI | Cancellation; nonstreaming headless mode |
| [Muse Code](docs/real-vendor-agents.md) | CI | — |
| [Oh My Pi](docs/real-pi-agents.md) | CI | Streaming, cancellation |
| [OpenClaw](docs/real-local-agents.md) | CI | Buffered stream, cancellation |
| [OpenClaude](docs/real-source-agents.md) | Local | — |
| [OpenCode](docs/real-provider-agents.md) | CI | Buffered stream, cancellation |
| [OpenCode 2 beta](docs/real-source-opencode-mimo-dsh.md) | CI | Headless and interactive terminal |
| [Pi](docs/real-pi-agents.md) | CI | Streaming, cancellation |
| [Plandex](docs/real-plandex.md) | Local | Example-local recipe; requires self-hosted backend |
| [Polygraph](docs/real-codebuff-polygraph.md) | CI | Claude-launching profile only |
| [Prime Agent](docs/real-pi-agents.md) | CI | Streaming; cancellation includes daemon shutdown |
| [Qwen Code](docs/real-google-agents.md) | CI | Streaming, cancellation |
| [Rovo Dev](docs/real-gated-agents.md) | Local | Installed `acli` plugin; buffered stream, cancellation |
| [ZCode](docs/real-pi-agents.md) | CI | Buffered stream, cancellation |

These are tested profiles, not guarantees for every version or operating system.
[Verification details and exclusions](docs/verification.md).

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
