# Codebuff source and Polygraph launching Claude

These examples use a packed Cordyceps tarball installed into a fresh external consumer project. The real Codebuff CLI and Polygraph launcher execute their own agent loops and fixture file reads. The library provides provider injection and response codecs; the example owns all setup, account fixtures, processes, terminal transport and cleanup.

On September 30, 2026, all four text/read cases passed with six genuine model requests: one text request and two tool-turn requests per profile. The final run also captured 46 explicitly scripted Codebuff auxiliary requests. Strict TypeScript passed; the child regression suite passed 140 Bun tests (two existing skips, 973 assertions) and all 21 Node tests. These profiles verify native streaming consumption, text and real reads; they do not add a cancellation/session-reuse or incremental-terminal-output claim.

The later clean hosted [run 36739752968](https://github.com/trevordilley/cordyceps/actions/runs/36739752968) verified Polygraph runtime `2609.29.0017`: text captured one model request, the real file-read case captured two, and both native processes exited 0. Codebuff source failed before any provider request because its official generated agent module was missing from the clean checkout. Setup now runs the pinned CLI's own `bun run prebuild:agents` command from `codebuff-source/cli` after dependency installation, matching its `dev` script, and requires the resulting module to exist. This does not modify official source or fabricate agent definitions. Codebuff's earlier local success remains valid, but clean hosted verification of this setup fix is still pending.

## Exact profiles

- **Codebuff:** unmodified official source commit `fb2a17d442feb9a3482c0ed32863a4cd5fe37009`, executed by Bun 1.3.13 at `cli/src/entry.ts`; native `--version` reports `1.0.0`. This is a source-run CLI, not proof that the published native release works. Codebuff's native `/api/v1/chat/completions` request is standard Chat Completions with extra metadata. The `codebuff` codec delegates model messages/tools/SSE and accepts only a finite list of observed auxiliary paths. Consumers must explicitly script account, usage, validation and log replies; no login or account state is synthesized by the library.
- **Polygraph:** npm shell `0.1.5`, official runtime bundle `2609.28.0005`, official Claude plugin `0.5.4`, launching Claude Code `2.1.283`. The official MCP package `0.3.1` initialized over stdio, reported server version `0.0.1`, and negotiated protocol `2025-11-25`; both cases assert a real connected MCP transport. The `polygraph` recipe injects Claude's Anthropic provider and selects the native launcher. The example supplies an isolated native Claude print-mode configuration, offline official plugin installation and explicit local organization/empty-session metadata. Native Claude's `Read` tool reads the unpredictable disposable fixture. Other Polygraph agent backends, remote repository management and hosted semantic session/repository search are not verified here.

The Codebuff source profile is distinct from Freebuff. The source's direct selected-BYOK path is guarded by `IS_FREEBUFF`; this Codebuff workflow instead uses its genuine hosted-provider API override with all traffic confined to the local Cordyceps endpoint. Account and agent-run records are static fixtures, never remote agent decisions. Tool calls and text are generated only through Cordyceps's provider scripting API.

## Reproduce

Use real Node 22 or newer and Bun on PATH. These setup commands install ordinary local dependencies and download official artifacts; they do not authenticate or launch an agent. Run expensive commands through the tracked process wrapper when using DevSwarm.

```sh
hivecontrol exec oneshot 10m -- node examples/real-extra-cli/install.mjs /tmp/cordyceps-extra-deps
hivecontrol exec oneshot 5m -- node examples/real-extra-cli/download-diagnostics.mjs /tmp/cordyceps-extra-deps
hivecontrol exec oneshot 10m -- node examples/real-extra-cli/install-source.mjs /tmp/cordyceps-extra-deps
hivecontrol exec oneshot 4m -- node examples/real-extra-cli/probe.mjs /tmp/extra-workflows.json polygraph-text,polygraph-tool,codebuff-source-text,codebuff-source-tool workflow
hivecontrol exec oneshot 2m -- node examples/real-extra-cli/probe.mjs /tmp/extra-released-codebuff.json codebuff
node examples/real-extra-cli/summarize-boundaries.mjs /tmp/extra-workflows.json /tmp/extra-released-codebuff.json examples/real-extra-cli/boundary-evidence.json
```

`EXTRA_CLI_DEPS` selects a different dependency directory. `CLAUDE_BINARY` selects the underlying installed Claude binary; its default in this reproduction environment is `/Users/20idemo/.local/bin/claude`. `BUN_BINARY` controls the source setup wrapper. Downloads are pinned by hash; a changed mutable Polygraph runtime download requires inspection and fresh verification, never silent reuse of an old receipt.

Hosted setup on September 30 detected a real upstream runtime update from `2609.28.0005` (archive SHA-256 `f8f2409d79a04d9f0cd852e4fbabf89927b6e5836af7a31eabc4bf55f328cea6`) to `2609.29.0017` (archive SHA-256 `500aefb051bd7c868d67d38b7367b6c3002ef6b1e202d831c05c17422baab041`). A fresh local download matched the hosted hash: HTTP 200, `application/gzip`, filename `2609.29.0017.tar.gz`, and a valid portable JS/WASM archive. Five JavaScript payloads changed; this was neither a rate-limit response nor an architecture mismatch. The downloader now pins the newer archive's version, filename and hash, and writes `polygraph-runtime.json` with the verified version for the consumer's native cache directory. The earlier local receipt and profile above remain for `2609.28.0005`; the separate hosted run linked above verifies `2609.29.0017` text and real file reads.

The official [runtime verification endpoint](https://cloud.nx.app/nx-cloud/polygraph/verify) returned `2609.29.0017` and the mutable `/nx-cloud/static/polygraph-bundle` URL even when queried with the older version and content hash. The inspected npm shell follows that returned URL; no immutable runtime URL was exposed by this bootstrap. The [official installer](https://app.trypolygraph.com/install.sh) uses a separate native-shell manifest, which does not pin the runtime bundle. Setup deliberately fails on subsequent runtime drift instead of silently updating the pin or reusing previous evidence.

The consumer installs the actual official Claude plugin payload from a local marketplace mirror into its disposable HOME using the real `claude plugins` commands. The npm cache prepared by setup lets the unmodified plugin resolve its MCP dependency offline. All agent processes use `sandbox-exec` to restrict network connections to loopback and writes to owned state. Unknown service calls fail closed; semantic search is not mocked as a successful remote decision.

Each text case requires actual captured native prompt traffic and the controlled reply in native output. Each tool case checks that the random fixture token is absent before the tool call, scripts the native offered `Read` or `read_files` tool, then requires the token in the actual next native provider request. Codebuff rewrites tool IDs: the assertion correlates the native assistant call's exact name/arguments with its native returned ID. The consumer never reads the fixture for the agent. The TUI transport answers terminal capability queries only and closes its own process group after observing the controlled response.

## Published Codebuff boundary

The independently tested official `1.0.688` darwin-arm64 artifact does **not** pass this profile. With `CODEBUFF_APP_URL`, `NEXT_PUBLIC_CODEBUFF_APP_URL`, `OPENAI_BASE_URL`, `OPENROUTER_BASE_URL` and test keys set, it attempts `CONNECT www.codebuff.com:443` instead of the local app/provider endpoint. The rejecting loopback proxy returns 403; no provider model request or fixture result reaches Cordyceps. No hosted request is forwarded. The actual downloaded binary's SHA-256 is `486d0ad8fe7f2000f7c2c58d96a603bdfe0352d59676c4e5f04d5ee97e0480da`.

The source CLI can work while that released artifact remains excluded. Do not present this recipe as verified against the published binary. Native source startup prints `1.0.0`, so the exact source commit is the reproducibility identifier.

## Official references

- [Codebuff source at the tested commit](https://github.com/CodebuffAI/codebuff/tree/fb2a17d442feb9a3482c0ed32863a4cd5fe37009), especially `cli/src/hooks/use-send-message.ts` and `sdk/src/impl/model-provider.ts` for direct-BYOK versus hosted-provider behavior.
- [Polygraph skills and plugins](https://github.com/nrwl/polygraph-skills), [Polygraph Claude plugin package](https://www.npmjs.com/package/@polygraph/claude-plugin), [Polygraph shell package](https://www.npmjs.com/package/polygraph).

`boundary-evidence.json` separates positive workflows from released-binary diagnostics and retains native versions, argv/output, selected native tool calls, actual returned file content, request hashes and artifact integrity. Full local receipts preserve the original request bodies for reproduction debugging.
