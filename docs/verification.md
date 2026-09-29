# Verification and remaining evidence gaps

The library has been built, packed, installed into disposable Node consumer projects, and exercised with real Claude Code, Codex, an official ACP adapter, and a Chromium frontend. These tests use public package imports and the actual local Cordyceps provider. Process launch, client handlers, isolation and cleanup live in `examples/` as consumer code.

Reproduction context: macOS 15.7.4, Node 22.22.3, Bun 1.3.13, TypeScript 5.9.3, Playwright 1.56.1, installed Claude Code 2.1.283 and Codex 0.155.1. ACP uses `@agentclientprotocol/claude-agent-acp` 0.84.0, ACP SDK 1.5.1 and Claude Agent SDK 0.3.284. Executable versions are recorded observations, not support gates or a certification matrix. No npm publication, selected license or user review verdict is recorded.

## Reproduce the checks

Run from the repository root after `bun install --frozen-lockfile`. Put a real Node >=22 installation first on `PATH` for these commands and npm's child processes. Some development shells expose a `node` shim that runs Bun; that is not Node verification. `node -p 'JSON.stringify(process.versions)'` must report Node without a `bun` field. `test:node` also accepts `CORDYCEPS_NODE_BINARY=/absolute/path/to/node`; the package check rejects non-Node runtimes explicitly.

| Command | Observed result |
| --- | --- |
| `bun run check` | Strict TypeScript checking passed. |
| `bun run build` | Node-targeted ESM and declaration emission passed. |
| `bun test tests` | 99 passed, 2 known Bun skips, 0 failed; 578 assertions. |
| `bun run test:node` | 21 Node lifecycle tests passed, 0 skipped. |
| `node scripts/verify-package.mjs` | Clean installed artifact, optional peer, declarations, synthetic HTTP/tool and success/failure teardown checks passed. |
| `node examples/real-cli/run.mjs /tmp/cordyceps-cli.json` | Four real installed CLI cases passed; captured requests were 1/2 for each harness's text/tool cases. |
| `CLAUDE_BINARY=/absolute/path/to/claude node examples/real-frontend/verify-packed.mjs` | Three Chromium tests passed: text, actual file read, cancellation and a fresh harness process for the next turn. |
| `node examples/real-acp/verify.mjs` | Real ACP initialization, sessions, turns, tools, permissions, incremental output, cancellation and same-session reuse passed. |

Inside DevSwarm, run bounded commands with `hivecontrol exec oneshot 5m -- ...`; the example verifiers own and clean up their temporary projects and processes. The real examples currently use macOS `sandbox-exec` for their network boundary and fail explicitly on other platforms. They do not silently substitute synthetic harnesses. See [CLI reproduction](real-cli.md), [frontend reproduction](real-frontend.md) and [ACP reproduction](real-acp.md) for prerequisites, exact flags, evidence and consumer setup.

The earlier synthetic/package checks remain useful regression coverage. A synthetic handler reading a file is not counted as real harness evidence; the real examples independently verify an unpredictable fixture token returned by the actual harness tool in the next captured provider request.

## Actual consumer results and fixes

- **Installed CLIs:** packed public imports controlled Claude text and its `Read` tool, and Codex text and its real `exec_command` running `/bin/cat fixture.txt`. Both required actual captured prompt traffic, actual binary output and the fixture-only token in a second provider request. Consumers asserted health, exit status and cleanup. The first Codex tool run returned `sandbox_apply: Operation not permitted` from nested macOS sandboxes. The working consumer keeps its outer OS sandbox and disables Codex's inner sandbox; it never substitutes a fabricated result.
- **Frontend:** Playwright drives a real HTML form through a consumer HTTP server to installed Claude's stdin. The UI renders Claude's parsed output. The file-read reply derives from the real tool result. Cancel stops a held process and aborts its provider exchange; another browser turn launches a fresh process and succeeds. Test fixture dependencies close the consumer before the Cordyceps mock, and the verifier checks that mock listeners are closed too.
- **ACP:** the official adapter and standard ACP SDK negotiated protocol 1, created distinct sessions, retained follow-up context, emitted native updates before a gated stream completed, requested real permissions, and performed an actual fixture read. Acceptance and refusal use real offered permission IDs. A held turn ended with native `cancelled`, and the same session then completed another prompt. Complete native JSON-RPC observations and provider requests remain separate. One observed run produced eight prompt responses, 29 provider requests and 65 native messages; background request/message totals are context, not a fixed protocol contract.
- **Shipped backend fix:** real Claude SDK consumers issued `HEAD /api/hello` and `POST /v1/messages/count_tokens?beta=true`. The old codec rejected them and `assertHealthy()` failed. The codec now recognizes only those exact method/path combinations, captures them normally, and requires explicit `{health: true}` or `{inputTokens: n}` routes. Token counts are scripted values, not tokenizer estimates. Incorrect response kinds, unknown endpoints and unhandled requests still fail visibly. See [provider codec details](provider-codecs.md).
- **Verification runtime fix:** the workspace's default `node` was a DevSwarm shim running Bun 1.2.23. The Node lifecycle check failed, rather than providing Node evidence. Verification now diagnoses that case and accepts an explicit Node executable; the full checks passed with real Node 22.22.3.

## Evidence boundaries

| Saga scope | Real evidence | Remaining limits |
| --- | --- | --- |
| `prove-installed-binary`, `standalone-programmatic-use` | Installed Claude and Codex run against the packed public library with captured requests, controlled output and real tool results. | Other OS/runtime/harness releases are not verified by these observations. |
| `exercise-modes-and-flags` | Both noninteractive modes and documented consumer-selected flags are exercised. | Interactive terminal behavior is recorded separately in the CLI guide; do not infer it from print/exec or ACP tests. |
| `inspect-and-control-exchanges` | Actual input hooks, provider captures, controlled text/tool replies and real fixture results are asserted. | Input/protocol hooks still require consumer instrumentation; the library does not capture process I/O automatically. |
| `playwright-e2e-workflow`, `test-frontend-through-binary` | Chromium input reaches installed Claude and its real result is rendered, including tool and cancellation scenarios. | The minimal example represents a consumer; it does not verify an unrelated application's frontend. |
| `launch-protocol-mode`, `consume-acp-messages`, `exercise-acp-lifecycle` | A concrete ACP recipe and real adapter/client exercise negotiated messages, separate sessions, followups, completion, incremental output, permissions, tools and cancellation/reuse. | Optional protocol features remain bounded by negotiated capabilities. Load/resume/reconnect and arbitrary protocol faults are not claimed. ACP results come from the adapter's real Claude Agent SDK integration, not a fabricated ACP peer. |
| Harness integration registry | Bundled/local definition parity and a useful ACP injection recipe are tested. | Contribution acceptance, release naming and publication remain maintainer actions. |

Bun 1.3.13's `node:http` implementation did not report remote disconnects to held handlers in two independently reproduced direct-TCP cases, with and without SSE already open. Exactly those two tests remain skipped only for that Bun version. Both are mandatory and pass under Node; the skips are not cancellation evidence. Real ACP and browser cancellation were separately exercised under Node.

The provider subset covers Anthropic Messages creation, the two explicit auxiliary requests above, and OpenAI Responses creation. It does not implement model listings, stored-response state, hosted/custom tools, multimodal/reasoning output or a direct ACP fault injector. The listener binds loopback and has no upstream fallback. The library still does not discover/install/launch binaries, manage shell startup, implement an ACP client or certify harness versions. Consumers close their processes before disposing the mock.
