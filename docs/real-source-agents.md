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
