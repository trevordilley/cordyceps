# Additional official-source agent identities

These identities extend the public-document roster. The scope authorities are the read-only Orca checkout at `98039676f363d6f0c06dbed25f3180463e5952af` (`src/shared/tui-agent.ts` and `tui-agent-config.ts`) and Superset at `3049a3114bd1ae48b944aae3e4cafdb0f521d1a5` (`packages/shared/src/builtin-terminal-agents.ts`). Launch aliases matter: Qoder is `qodercli`, not Qodo; MiMo Code is `mimo`; DeepSeek Harness uses `dsh-tui` plus `dsh`; Freebuff remains distinct from Codebuff.

The consumer examples build and pack Cordyceps, install that tarball into a disposable project outside the repository, and import only `cordyceps`. Real agent processes get a fresh HOME, test credentials, and macOS `sandbox-exec` restrictions: outbound loopback only, writes limited to owned temporary directories. No real provider account or user configuration is used. Each success requires the actual prompt in captured model traffic, controlled text in native output, and an unpredictable fixture token absent from the initial request and returned by the real native tool in the next provider request. Recipes stay example-local for parent integration. Launching, dependency installation, native client drivers and cleanup remain consumer responsibilities.

## OpenClaude: verified

Identity/distribution: Orca links [Gitlawb OpenClaude](https://openclaude.gitlawb.com/), whose installation command names `@gitlawb/openclaude`. Tested npm version **0.31.0**, Node **22.22.3**, macOS arm64. Its [configuration documentation](https://openclaude.gitlawb.com/docs/configuration/) identifies provider environment overrides and `OPENCLAUDE_CONFIG_DIR` isolation. The distinct binary reports `0.31.0 (OpenClaude)`.

The example-local recipe uses Anthropic Messages with `ANTHROPIC_BASE_URL`, the mock key, and disabled nonessential traffic. The consumer selects an explicit model and `--print --dangerously-skip-permissions --output-format json --max-turns 3`. The permission bypass applies only inside the disposable outer OS sandbox. Both cases passed: text (one request), native `Read` (two requests). Native JSON output contains the controlled marker; the second tool request contains the actual random file token. No streaming, cancellation, ACP or TUI claim is inferred.

```sh
hivecontrol exec oneshot 5m -- npm install --prefix /tmp/cordyceps-source-install --no-audit --no-fund @gitlawb/openclaude@0.31.0
hivecontrol exec oneshot 3m -- env OPENCLAUDE_BINARY=/tmp/cordyceps-source-install/node_modules/.bin/openclaude node examples/real-source-agents/openclaude/run.mjs /tmp/openclaude.json
node examples/real-source-agents/summarize.mjs /tmp/openclaude.json /tmp/openclaude-summary.json
```

[Consumer](../examples/real-source-agents/openclaude/consumer.mjs), [recipe](../examples/real-source-agents/openclaude/harnesses/openclaude.json), [packed artifact evidence](../examples/real-source-agents/openclaude/evidence.json). Evidence retains the tarball hash, external public import location, actual process output and selected wire fields with raw-body SHA-256. Full system prompts and unrelated schemas remain outside the compact committed projection. Consumers assert mock health, disposal, removed generated files and removed temporary roots.

## Superset UFO: excluded at the remote agent boundary

Superset's own `docs/agent-tooling.md` identifies [the official installer](https://ufo.ai/ufo), which downloads `https://ufo.ai/ufo/bin/aarch64-apple-darwin`. This is neither Microsoft UFO nor the unrelated alienz host. The downloaded binary is **0.1.90**, SHA-256 `8c3d8f9729e1ca884af917463d18d59b74ab68b2ffe912f93b6265ba2aad555c`.

The isolated actual binary's `--json` launch, with `WORKSPACE_URL` and `UFO_URL` pointed at a loopback diagnostic listener, sent `GET /surface/ufo/<channel>/skills` then `POST /surface/ufo/<channel>` containing the supplied prompt. These are the workspace conversation service, not provider Messages/Responses/Chat Completions requests. The listener returned explicit HTTP 401 and no fabricated assistant or tool decisions. UFO emitted native `session_start`, `turn_start` and a fatal `chat failed (401)` error. Its help states local turns execute file/command steps through the client, with the conversation served by the workspace.

The separate `ufo llm` command was also attempted with a test `ANTHROPIC_API_KEY` and loopback `ANTHROPIC_BASE_URL`. It still targeted `https://api.anthropic.com/v1/messages`, which the outer sandbox blocked. That command is described as a one-question call through the sandbox egress proxy; it is not evidence of a locally injectable autonomous agent loop. No model-control recipe is supplied. This is an exact boundary of the tested release/configuration, not a claim about every possible future UFO deployment.

```sh
# Download the official artifact without executing the installer's shell-profile changes.
curl -fLsS https://ufo.ai/ufo/bin/aarch64-apple-darwin -o /tmp/cordyceps-ufo
chmod +x /tmp/cordyceps-ufo
UFO_BINARY=/tmp/cordyceps-ufo node examples/real-source-agents/boundaries/ufo.mjs /tmp/ufo-boundary.json
```

[Diagnostic](../examples/real-source-agents/boundaries/ufo.mjs) and [actual evidence](../examples/real-source-agents/boundaries/ufo-evidence.json). This diagnostic does not count as a passing integration or a packed-consumer success.

## Freebuff: verified native TUI and BYOK

Orca links [Freebuff's official CLI page](https://freebuff.com/cli), which names npm package `freebuff`. Tested release **0.2.0**, its actual macOS arm64 compiled binary, not the sibling Codebuff identity. The package's bundled launcher selects `https://codebuff.com/api/releases/download/0.2.0/freebuff-darwin-arm64.tar.gz`. The archive matched the SHA-256 published inside the npm package: `831b2dfb3ef66aafb095677ec1378d5cb4df4c4dc4899b35beedd0c7b937060f`. Extracted binary SHA-256: `953a08ff72ca64c8a9d8b532624cdfc6f0a82d1874c434ebe94ffc30e77de041`.

The [official source](https://github.com/CodebuffAI/codebuff/blob/a272f23fdef9f09fd6682a93279f3dcd288eaefd/sdk/src/byok.ts) defines `FREEBUFF_BYOK_CONFIG_DIR/connections.json`, a JSON array with connection UUID/revision, OpenAI-compatible URL/model, context/output limits and an environment credential reference. Native `FREEBUFF_CONFIG_DIR/settings.json` selects that connection. [CLI selection](https://github.com/CodebuffAI/codebuff/blob/a272f23fdef9f09fd6682a93279f3dcd288eaefd/cli/src/utils/byok.ts) permits a BYOK session without hosted account authentication. The local model loop uses Chat Completions. No login, account creation, billing or remote-agent response fabrication is involved.

The native CLI is TUI-only. A consumer-owned Python PTY waits for the real `Enter a coding task` composer, submits actual input, handles terminal capability queries and captures terminal output. The verifier observes controlled text (one model request), then separately issues native `read_files` and requires the random fixture token in the next main request (two requests). Freebuff rewrites model tool-call IDs while storing native history; the verifier correlates the returned ID to the actual assistant `read_files` call and its exact fixture argument, then checks the corresponding tool result. It never assumes an invented result. The persistent TUI is deliberately closed after the marker appears; this establishes text/read workflows, not graceful session completion, cancellation semantics or incremental streaming.

```sh
mkdir -p /tmp/cordyceps-freebuff-bin
curl -fLsS https://codebuff.com/api/releases/download/0.2.0/freebuff-darwin-arm64.tar.gz -o /tmp/cordyceps-freebuff.tar.gz
shasum -a 256 /tmp/cordyceps-freebuff.tar.gz
# Verify the archive equals 831b2dfb3ef66aafb095677ec1378d5cb4df4c4dc4899b35beedd0c7b937060f before extraction.
tar -xzf /tmp/cordyceps-freebuff.tar.gz -C /tmp/cordyceps-freebuff-bin
hivecontrol exec oneshot 3m -- env FREEBUFF_BINARY=/tmp/cordyceps-freebuff-bin/freebuff node examples/real-source-agents/freebuff/run.mjs /tmp/freebuff.json
```

[Consumer](../examples/real-source-agents/freebuff/consumer.mjs), [declarative recipe](../examples/real-source-agents/freebuff/harnesses/freebuff.json), [PTY driver](../examples/real-source-agents/freebuff/drive-pty.py) and [packed evidence](../examples/real-source-agents/freebuff/evidence.json). The recipe generates both native files, including the array-root connection file. That exposed a real library gap: JSON config definitions previously required object roots. The parent supplied tested array-root JSON support; TOML remains object-only and scalar JSON roots remain rejected. Freebuff's configuration is now ordinary declarative injection; the consumer owns only the process, PTY, fixtures, isolation and assertions.

## CodeBuddy and Qoder

[Detailed reproduction and exact boundaries](real-source-codebuddy-qoder.md) cover `@tencent-ai/codebuddy-code` **2.160.0** and `@qoder-ai/qodercli` **1.1.64**. Both CodeBuddy aliases, `codebuddy` and `cbc`, independently pass packed text and native `Read` checks (one/two provider requests). The observed protocol is Chat Completions at `/v1/chat/completions`, even though the selected model name is Claude. Both aliases count as one roster identity.

Qoder is excluded for this account-free workflow. Its actual `qodercli` print mode emits `authentication_failed` before local model traffic, both without credentials and with native local custom-model settings. A test personal access token goes through the real `exchangePersonalToken` / `loginWithPAT` path toward `openapi.qoder.sh`; the loopback diagnostic proxy rejects that connection. The probes do not create authentication, model entitlements or remote decisions. No Qoder recipe is supplied, and no Qodo result is reused.
