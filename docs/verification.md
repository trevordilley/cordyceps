# Verification and remaining evidence gaps

The library has been built, packed, installed into disposable Node projects, and exercised with **43 native agent families**, an official ACP adapter, and a Chromium frontend. All 43 passed controlled text and actual file-read workflows. See [native harnesses](native-harnesses.md) and [additional harnesses](additional-harnesses.md) for evidence and limits. Process launch, isolation and cleanup live in `examples/` as consumer code.

Reproduction context: macOS 15.7.4, Node 22.22.3, Bun 1.3.13, TypeScript 5.9.3, Playwright 1.56.1, installed Claude Code 2.1.283 and Codex 0.155.1. ACP uses `@agentclientprotocol/claude-agent-acp` 0.84.0, ACP SDK 1.5.1 and Claude Agent SDK 0.3.284. Executable versions are recorded observations, not support gates or a certification matrix. No npm publication, selected license or user review verdict is recorded.

## Consumer API checks

The alpha.2 changes passed strict TypeScript, 168 Bun tests (two known Bun-only
skips), and all 33 Node lifecycle/consumer API tests. Packed consumers cover ESM
and CommonJS imports, declarations, ordinary Playwright `.spec.ts` projects,
required-step failures, fast failure guards, redacted attachments and cleanup.

The [app → worker → Codex example](testing-apps.md) passed controlled text and an
actual file read through inherited configuration. The separate home-only Claude
check passed using generated settings and `apiKeyHelper`, without provider URL or
API-key environment overrides. Original consumer reproductions also passed:
Claude 2.1.283 text and Edit/Read workflows, ordinary-route/raw-capture compatibility,
and the CommonJS TypeScript import case. These checks do not establish a complete
third-party desktop UI or VM journey.

## Reproduce the checks

Run from the repository root after `bun install --frozen-lockfile`. Put a real Node >=22 installation first on `PATH` for these commands and npm's child processes. Some development shells expose a `node` shim that runs Bun; that is not Node verification. `node -p 'JSON.stringify(process.versions)'` must report Node without a `bun` field. `test:node` also accepts `CORDYCEPS_NODE_BINARY=/absolute/path/to/node`; the package check rejects non-Node runtimes explicitly.

| Command | Observed result |
| --- | --- |
| `bun run check` | Strict TypeScript checking passed. |
| `bun run build` | Node-targeted ESM and declaration emission passed. |
| `bun test tests` | 149 passed, 2 known Bun skips, 0 failed; 1,246 assertions on both hosted Node jobs at `8a8bbfe`. |
| `bun run test:node` | 21 Node lifecycle tests passed, 0 skipped. |
| `node scripts/verify-package.mjs` | Clean installed artifact, optional peer, declarations, synthetic HTTP/tool and success/failure teardown checks passed. |
| `node examples/real-cli/run.mjs /tmp/cordyceps-cli.json` | Four real installed CLI cases passed; captured requests were 1/2 for each harness's text/tool cases. |
| `node examples/real-cli/run.mjs /tmp/cordyceps-pty.json --interactive-claude` | Real Claude TUI input and controlled terminal reply passed; title traffic is handled separately. Python 3 is consumer tooling for this case. |
| `CLAUDE_BINARY=/absolute/path/to/claude node examples/real-frontend/verify-packed.mjs` | Three Chromium tests passed: text, actual file read, cancellation and a fresh harness process for the next turn. |
| `node examples/real-acp/verify.mjs` | Real ACP initialization, sessions, turns, tools, permissions, incremental output, cancellation and same-session reuse passed. |
| `node examples/real-provider-agents/run.mjs /tmp/providers.json` | 20 cases passed across Copilot, Goose, Droid, OpenCode and Crush. |
| `node examples/real-google-agents/run.mjs /tmp/google.json` | Nine cases passed across Gemini, Qwen and Mistral Vibe. |
| `node examples/real-editor-agents/verify.mjs /tmp/editors.json` | Four cases passed across Aider and Cline, including their real text-based tool protocols. |
| `node examples/real-q/run.mjs /tmp/q.json` | Four cases passed for the installed `q` → Kiro wrapper, including native AWS event-stream and real `fs_read`. |
| `node examples/real-auggie/verify.mjs /tmp/auggie.json` | Four cases passed with explicit model bootstrap, NDJSON, real `view`, incremental output and cancellation. |
| `node examples/real-gated-agents/run.mjs /tmp/agy.json --antigravity` | Four cases passed for actual `agy`, including `view_file` and incremental output. |
| `node examples/real-gated-agents/run.mjs /tmp/rovo.json --rovo` | Four cases passed through the installed Rovo plugin, including actual `open_files`. |
| `node examples/real-gated-agents/run.mjs /tmp/amp.json --amp` | Four cases passed for installed Amp, including native `Read`. |
| `node examples/real-plandex/run.mjs /tmp/plandex.json "$PLANDEX_TEST_SOURCE"` | Text and real server-directed CLI context read passed with the unmodified self-hosted backend; see [required bootstrap](real-plandex.md). |

The example verifiers own and clean up their temporary projects and processes. The real examples currently use macOS `sandbox-exec` for their network boundary and fail explicitly on other platforms. They do not silently substitute synthetic harnesses. See [CLI reproduction](real-cli.md), [frontend reproduction](real-frontend.md) and [ACP reproduction](real-acp.md) for prerequisites, exact flags, evidence and consumer setup.

The earlier synthetic/package checks remain useful regression coverage. A synthetic handler reading a file is not counted as real harness evidence; the real examples independently verify an unpredictable fixture token returned by the actual harness tool in the next captured provider request.

## Actual consumer results and fixes

- **Installed CLIs:** packed public imports controlled Claude text and its `Read` tool, and Codex text and its real `exec_command` running `/bin/cat fixture.txt`. Both required actual captured prompt traffic, actual binary output and the fixture-only token in a second provider request. Consumers asserted health, exit status and cleanup. The first Codex tool run returned `sandbox_apply: Operation not permitted` from nested macOS sandboxes. The working consumer keeps its outer OS sandbox and disables Codex's inner sandbox; it never substitutes a fabricated result.
- **Interactive terminal:** actual Claude TUI input reaches the provider and the controlled response appears in terminal output. The consumer prepares only its own temporary onboarding/key/trust settings, replies to terminal queries, and uses carriage return to submit. Real title traffic gets a separate scripted response. Closing the PTY master before reaping fixed a macOS consumer-driver cleanup bug. The separate PTY transport regression passed; it is not counted as harness evidence.
- **Frontend:** Playwright drives a real HTML form through a consumer HTTP server to installed Claude's stdin. The UI renders Claude's parsed output. The file-read reply derives from the real tool result. Cancel stops a held process and aborts its provider exchange; another browser turn launches a fresh process and succeeds. Test fixture dependencies close the consumer before the Cordyceps mock, and the verifier checks that mock listeners are closed too.
- **ACP:** the official adapter and standard ACP SDK negotiated protocol 1, created distinct sessions, retained follow-up context, emitted native updates before a gated stream completed, requested real permissions, and performed an actual fixture read. Acceptance and refusal use real offered permission IDs. A held turn ended with native `cancelled`, and the same session then completed another prompt. Complete native JSON-RPC observations and provider requests remain separate. The expanded-branch rerun produced eight prompt responses, 30 provider requests and 65 native messages; background request/message totals are context, not a fixed protocol contract.
- **Shipped backend fix:** real Claude SDK consumers issued `HEAD /api/hello` and `POST /v1/messages/count_tokens?beta=true`. The old codec rejected them and `assertHealthy()` failed. The codec now recognizes only those exact method/path combinations, captures them normally, and requires explicit `{health: true}` or `{inputTokens: n}` routes. Token counts are scripted values, not tokenizer estimates. Incorrect response kinds, unknown endpoints and unhandled requests still fail visibly. See [provider codec details](provider-codecs.md).
- **Verification runtime fix:** the workspace's default `node` was a shim running Bun 1.2.23. The Node lifecycle check failed, rather than providing Node evidence. Verification now diagnoses that case and accepts an explicit Node executable; the full checks passed with real Node 22.22.3.

## Expanded agent results and fixes

Each successful consumer requires a captured prompt, actual native output, and a fresh fixture token absent from the initial request but returned by the real agent in a later provider request. Per-agent documents retain executable versions and complete reproduction commands. The first 18 families passed 59 native cases, excluding ACP, browser tests, historical diagnostics and transport-only checks.

- Chat Completions and Gemini codecs enabled additional agents through ordinary JSON recipes. Aider needed actual shell consent on stdin; Cline needed native XML tool/completion text. Their real results stay in conversation text, not invented function-call records.
- Q required native service endpoint configuration and CRC-framed AWS event-stream responses. Auggie required native NDJSON and a successful explicit `/get-models` reply; returning 404 had silently discarded its initial prompt. The fixed example asserts the actual prompt is captured.
- Rovo’s wrapper login gate did not block its same installed plugin from using a scratch local gateway. Amp’s explicit metadata bootstrap exposed its real local agent loop. Narrow gateway codecs delegate model formats and capture service traffic without automatic replies or account changes.
- Plandex required its real CLI, backend, LiteLLM startup process, PostgreSQL and a controlling terminal. A private recipe supplies the custom-model settings; consumer helpers create and clean up the isolated services. The real CLI loads context after the real server asks for it.

Streaming limits remain explicit: Droid, OpenCode, Rovo and Amp consume streaming provider replies but buffer assistant stdout in the selected CLI modes. Vibe’s headless mode requests nonstreaming JSON. Aider, Cline and Plandex establish text/read workflows only; no additional stream/cancel claim is inferred. Process cancellation is distinct from native ACP cancellation and same-session reuse. See the separate ACP and browser evidence for those lifecycles.

Qodo’s [actual WebSocket diagnostic](real-qodo.md) crosses bootstrap and captures native queries/tool declarations, but does not reach a locally injectable model client. That diagnostic is not a successful text/read test. The [Cursor ACP diagnostic](real-cursor.md) likewise submits actual run requests and provider credentials to its remote agent service without local model traffic. Both agents are excluded under the user’s removal instruction. Remote decisions are not fabricated to turn missing model control into a pass.

## Additional harnesses

The additional 25 profiles bring the total to 43 native families. Codebuff is verified from official source commit `fb2a17d`; its published 1.0.688 binary remains excluded. Polygraph's verified profile launches Claude through its actual plugin and MCP integration.

[CI run 36740569377](https://github.com/trevordilley/cordyceps/actions/runs/36740569377) passed 34 families, 107 native cases, real ACP and three browser tests. The [CI documentation](ci.md) lists the nine families verified only locally. Launch aliases, TUI/headless modes, metadata requests and diagnostic failures do not count as extra families.

Actual failures led to narrow fixes: Hermes model-metadata probes, Grok
prewarm and Muse model catalog routes require explicit consumer replies; Muse
requires preserving Responses tool namespaces; Freebuff needs a JSON-array
configuration root; and Codebuff source needs its native gateway path plus
explicit auxiliary metadata. OpenCode 2 needed its actual XDG configuration
and a ready TUI before submitting input. Claude on a fresh hosted runner
needed its documented `CLAUDE_CODE_TMPDIR` set to the consumer scratch root.
Clean hosted runs also exposed Codebuff’s required official agent-generation
step and an ACP shutdown race: cleanup now verifies that no live process
remains in the owned group after bounded termination attempts. Both corrections
passed hosted run `36740569377`. Permission flags, process startup and cleanup
remain consumer-owned.

## Evidence boundaries

| Saga scope | Real evidence | Remaining limits |
| --- | --- | --- |
| `prove-installed-binary`, `standalone-programmatic-use` | Installed Claude and Codex run against the packed public library with captured requests, controlled output and real tool results. | Other OS/runtime/harness releases are not verified by these observations. |
| `exercise-modes-and-flags` | Both noninteractive modes plus real Claude interactive PTY input/output and consumer-selected flags are exercised. | The optional Codex TUI diagnostic still fails at its trust screen before provider traffic; this is an unresolved consumer/TUI issue, not an established upstream blocker. |
| `inspect-and-control-exchanges` | Actual input hooks, provider captures, controlled text/tool replies and real fixture results are asserted. | Input/protocol hooks still require consumer instrumentation; the library does not capture process I/O automatically. |
| `playwright-e2e-workflow`, `test-frontend-through-binary` | Chromium input reaches installed Claude and its real result is rendered, including tool and cancellation scenarios. | The minimal example represents a consumer; it does not verify an unrelated application's frontend. |
| `launch-protocol-mode`, `consume-acp-messages`, `exercise-acp-lifecycle` | A concrete ACP recipe and real adapter/client exercise negotiated messages, separate sessions, followups, completion, incremental output, permissions, tools and cancellation/reuse. | Optional protocol features remain bounded by negotiated capabilities. Load/resume/reconnect and arbitrary protocol faults are not claimed. ACP results come from the adapter's real Claude Agent SDK integration, not a fabricated ACP peer. |
| Harness integration registry | Bundled/local definition parity and a useful ACP injection recipe are tested. | Contribution acceptance, release naming and publication remain maintainer actions. |

Bun 1.3.13's `node:http` implementation did not report remote disconnects to held handlers in two independently reproduced direct-TCP cases, with and without SSE already open. Exactly those two tests remain skipped only for that Bun version. Both are mandatory and pass under Node; the skips are not cancellation evidence. Real ACP and browser cancellation were separately exercised under Node.

The provider subset includes Anthropic Messages, OpenAI Responses, Chat Completions, Gemini Developer API, native Amazon Q and Augment, and precise Rovo/Amp/Hermes/Grok/Muse/Codebuff service routes. Their observed auxiliary routes require explicit consumer scripts, including Q model discovery and Auggie model bootstrap. This is not full vendor API emulation: general model listings, stored-response state, hosted/custom tools, multimodal/reasoning output and direct ACP fault injection remain outside the subset. The listener binds loopback and has no upstream fallback. The library still does not discover/install/launch binaries, manage shell startup, implement an ACP client or certify harness versions. Consumers close their processes before disposing the mock.
