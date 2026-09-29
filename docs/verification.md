# Verification and remaining evidence gaps

The integrated implementation is an ESM library for Node >=22. Verification in this workspace uses Node 22.22.3, Bun 1.3.13, TypeScript 5.9.3 and Playwright 1.56.1 on macOS. Other Node releases and operating systems have not been exercised here. There is no npm publication, selected license, harness support matrix or product approval.

## Reproducible checks

Run from the repository root after `bun install --frozen-lockfile`:

| Command | Recorded result |
| --- | --- |
| `bun run build` | Passed strict tsc checking, Node-targeted ESM bundling and declaration emission. |
| `bun test tests` | 96 passed, 2 skipped, 0 failed; 540 Bun expect calls across 98 tests. |
| `bun run test:node` | 21 lifecycle tests passed under Node, 0 skipped, 0 failed. |
| `node scripts/verify-package.mjs` | Passed standalone Node import without Playwright, public declarations, injection/HTTP/file-handler round trip, and optional Playwright success/failure teardown. |

`test:node` bundles the node:test lifecycle suite using Bun as build tooling, then invokes Node. The full suite verifies both held/no-header and open-SSE remote disconnects, successful reuse after disconnect, gated streaming, route abort, incomplete bodies, late handler rejection, reentrant disposal, preparation rollback, observations and concurrent isolation.

Bun 1.3.13's node:http implementation did not report remote disconnects to held handlers in two independently reproduced direct-TCP tests, with and without SSE already open. Exactly those tests are skipped only when `process.versions.bun === '1.3.13'`. They are mandatory and pass under Node. The Bun skips do not count as cancellation evidence. Bun's TOML parser also mishandles some control escapes: registry tests retain exact serialization assertions and ordinary-value parser round trips; the registry child independently verified the full control fixture with Python tomllib. Python is not required by the test suite or library.

The final diagnostic-only change makes handler messages visible when Playwright omits nested AggregateError details; it passed a fresh strict rebuild and the complete packed-consumer check.

The packed-package script creates separate temporary consumer projects. It checks package contents, installs with npm, imports the standalone root with no Playwright installed, runs HTTP/injection/cleanup checks and checks declarations. A synthetic consumer handler performs an actual filesystem read in a provider tool-call round trip. A separate consumer installs the optional Playwright peer and exercises fixture teardown after successful use and an intentionally ignored handler error. This is synthetic provider and consumer-handler evidence, not a real installed-harness test.

## Acceptance-criterion evidence boundary

| Saga scope | Delivered library support | Remaining consumer evidence |
| --- | --- | --- |
| `prove-installed-binary`, `exercise-modes-and-flags` | Documented Claude Code/Codex recipes; pure env, args and config outputs; synthetic provider exchanges. | No installed binary launched in these checks. Actual interactive/noninteractive behavior and selected flags remain consumer tests. |
| `inspect-and-control-exchanges`, `standalone-programmatic-use` | Node standalone preparation, raw/normalized HTTP observations, caller-supplied input snapshots, route controls, text/tool/stream/error encodings and cleanup. | Input hooks must be wired where the consumer really sends input. A synthetic file handler does not prove any real harness's normal tools or permission behavior. |
| `playwright-e2e-workflow`, `test-frontend-through-binary` | Optional test-scoped fixture over the same core, handler failure propagation, provider interception and response controls. | No real frontend, installed harness or browser-to-harness scenario was exercised. |
| `launch-protocol-mode` | Custom `acp` recipes, explicit missing recipe/codec errors and opaque caller-supplied adapter inputs. | Neither bundled definition has a verified ACP recipe. Actual adapter selection, launch and negotiated capabilities remain consumer-owned and unverified. |
| `consume-acp-messages`, `exercise-acp-lifecycle` | Complete caller-supplied native payload snapshots with separate metadata; gated and held provider work suitable for real client scenarios. | No real ACP negotiation, sessions, messages, permissions, tools, turn completion, cancellation or reuse was verified. No fake peer, fabricated ACP state or provider-to-ACP ID mapping is supplied. |
| Harness integration registry stories | Private/bundled loader parity, strict definition diagnostics, snapshots, deterministic rendering, JSON/TOML files, failure rollback and contribution guidance. | Bundled settings are documented recipes, not binary certification. Contribution acceptance and release remain maintainer actions. |

## Implemented subset and ownership

Only Anthropic `POST /v1/messages` and OpenAI `POST /v1/responses` creation endpoints are implemented. They support client function tools and text, JSON/SSE output and scripted HTTP errors. Ancillary endpoints, stored-response state, hosted/custom tools, multimodal/reasoning output and a direct protocol fault injector are outside this initial subset. See the codec guide for exact normalization and framing behavior.

The listener binds to loopback. There is no upstream fallback, process runner, executable probe, shell configuration, required shim, ACP client, MCP implementation or automatic process capture. Applications close their own processes before the mock is disposed. HTTP request bodies are bounded by default; retained transcripts grow with traffic. Disposal ends owned network work without waiting for an uncooperative consumer iterator; arbitrary user-code side effects still require consumer cleanup.

Current Saga implementation slides carry exact code evidence. Earlier proposals and lifecycle samples remain labeled design history or illustrative consumer scenarios. Requirement acceptance records product intent; neither code coverage nor these verification results record a user review verdict.
