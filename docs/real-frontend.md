# Real frontend through installed Claude Code

`examples/real-frontend` is a minimal **consumer application**, not a new Cordyceps API or process runner. Chromium submits a prompt to its loopback HTTP server; the server sends that prompt on stdin to an installed Claude Code process. Claude calls the local Cordyceps provider, and the server parses Claude's actual JSON stdout. The browser renders the returned `result` using `textContent`.

## Run the packed consumer checks

Prerequisites: macOS with `/usr/bin/sandbox-exec`, an already installed Claude Code executable, real Node >=22, npm, Bun 1.3.13 for building this repository, and the Chromium build for Playwright 1.56.1. No harness installation or authentication is performed. The example fails on another OS rather than silently bypassing its network policy. It records the executable version as reproduction context without gating it.

From the repository root (after `bun install --frozen-lockfile`):

```sh
CLAUDE_BINARY=/absolute/path/to/claude \
  /absolute/path/to/node \
  examples/real-frontend/verify-packed.mjs
```

`node` must be actual Node, not a Bun shim. The verifier checks this and prepends its own executable directory to PATH for npm. It builds Cordyceps, runs `npm pack`, copies this consumer into a disposable project outside the repository, and runs `npm install` on the tarball with lifecycle scripts disabled. Public imports are exclusively `cordyceps` and `cordyceps/playwright`; there are no source aliases, source imports, or workspace package links. It prints the artifact SHA256. Dependency installation may contact the public npm registry; harness model traffic is restricted to the local mock and uses only generated test credentials.

Set `FRONTEND_EVIDENCE_DIR=/absolute/output/directory` to retain the Playwright JSON report and failure traces after the disposable installed consumer is removed. Reports include per-test process exit records, explicit input observations, provider requests/tool results, responses and successful cleanup assertions. The verifier also checks that each mock listener is unreachable after Playwright teardown. These contain only disposable test prompts and fixtures. The output directory is caller-owned.

## What the tests exercise

| Scenario | Actual path and assertions |
| --- | --- |
| Text | A unique browser prompt is recorded at the consumer's stdin boundary and captured in Claude's streaming provider request. A distinct mock reply must appear exactly in the DOM after Claude exits successfully. |
| Real file read | The test writes a random token into a disposable workspace file. The token is absent from the first provider request. Cordyceps returns a `Read` tool call with the file path; **Claude Code's built-in Read handler reads the file**. The next provider request must include the same tool-use ID, a non-error result and the token. Only then does the provider return final text derived from that actual tool result, which must appear in the DOM. The server/client never read the fixture. |
| Cancellation and reuse | The mock holds a real Claude request. Clicking Cancel terminates and awaits the consumer-owned process; the mock observes disconnect, the UI shows Cancelled, and no response is fabricated. A subsequent browser prompt launches a fresh process and renders its reply. This is application reuse, not persistent Claude session reuse or ACP cancellation. |

Every test asserts process and owned process-group disappearance, consumer listener closure and disposable config/workspace removal. The consumer fixture depends on Cordyceps' `ai` fixture, so consumer cleanup finishes before the library disposes its mock and checks route health. Playwright owns browser/context teardown. No retries or skipped tests mask absent binaries, missing browser builds, provider mismatches or assertion failures.

## Ownership and isolation

- `consumer-process.mjs`: consumer-owned launch, stdin/stdout, timeout, termination and temporary fixture/config lifetime. Environment values start from an allowlist rather than copying user auth. Claude's `--bare` mode skips keychain reads; `--restricted`, empty settings sources, empty strict MCP configuration, disabled slash commands and Read-only tools avoid user plugins, hooks and command tools. No user configuration or credentials are modified.
- Dead proxy settings plus a loopback `NO_PROXY` bypass suppress ancillary connectivity probes in this installed version. Without those settings, this launch emitted `HEAD /api/hello`, which the baseline codec rejected. The library now supports an explicit health route, as exercised by the ACP example; this frontend retains its observed proxy setup.
- The macOS sandbox denies all network operations except outbound connections to the exact Cordyceps loopback port. A provider configuration mistake cannot turn this test into a paid upstream call. The sandbox is a network boundary; it is not a claim of complete filesystem confinement.
- `consumer-server.mjs`: consumer-owned ephemeral loopback server, same-origin JSON endpoints, static assets and response forwarding. Client disconnect also terminates the active child. It allows one turn at a time.
- `public/client.js`: consumer-owned form submission, cancel action and rendering of real server-returned text. It contains no response fixtures or tool implementation.
- `frontend.spec.mjs`: consumer-owned provider controls and browser assertions through the packed optional Playwright public entry point.
- `demo.mjs`: consumer-owned standalone composition through the packed root export; Ctrl-C closes the app, child, mock and temporary files.

For a manual demo, build and pack in the repository, copy `examples/real-frontend` to a separate directory, and install the resulting `.tgz` there with `npm install --ignore-scripts /absolute/path/to/cordyceps-0.0.1-alpha.1.tgz`. Start that installed consumer using:

```sh
CLAUDE_BINARY=/absolute/path/to/claude \
  /absolute/path/to/node demo.mjs
```

Open the printed loopback URL. The demo route returns a fixed local provider greeting through the real process. Use Ctrl-C when finished.

## Recorded run

On 2026-09-29, the packed consumer passed all three tests (zero retries/skips) using macOS 15.7.4, Node 22.22.3, Claude Code 2.1.283 and Playwright 1.56.1 Chromium. Five real provider requests covered text (one), Read tool exchange (two), and cancellation/new-process reuse (two). The baseline packed artifact SHA256 was `cffd2cf87f9b35aba74fe7011fcfabfa069323a6bf8f52ab98bb4652f9bad2aa`; subsequent library changes produce a new hash printed by the verifier.

## Evidence boundary

This is bounded evidence for the selected macOS/Node/Claude/Chromium combination, with noninteractive stdin and JSON stdout. It does not establish a general harness support matrix, interactive terminal behavior, ACP negotiation or lifecycle, multi-user production server security, or other operating systems. It uses ordinary `Read` permission allowance and `dontAsk`, not permission bypass. Saga metadata, review verdicts and publication are outside this example.
