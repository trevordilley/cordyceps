# DevSwarm agent validation

Validation scope comes from DevSwarm commit `d7c33873380e092018140ccf6e90529e1605fff0`, `libs/shared/types/src/ai-agent.ts`, cross-checked against `libs/desktop/types/builder.ts` and the executable mappings in `libs/desktop/utils/src/agent.ts`. This is 20 agent families and 40 enum values, including Windows/WSL variants. OpenHands is absent from this enum. DevSwarm's Antigravity value launches `agy`; the installed `q` wrapper launches Kiro CLI, which is recorded rather than silently presented as a different executable.

The machine-readable scope and results live in [inventory.json](../examples/devswarm-agents/inventory.json). Check for scope drift against a local DevSwarm checkout:

```sh
node examples/devswarm-agents/check-inventory.mjs /path/to/devswarm
```

This inventory is a set of observed real-consumer outcomes, not a version certification matrix. A recipe's presence means injection data exists. Verification additionally requires a built and packed artifact installed outside the repository, public imports, actual agent requests and output, and an unpredictable disposable file token returned through the actual agent's tool workflow. No mock backend manufactures that file-read result.

## Native workflows

The table is finalized with the accompanying machine-readable evidence after each integration run. A documented configuration seam alone is not a passing workflow. Pending service protocols remain implementation work; they are not marked external blockers merely because an existing codec cannot decode them.

<!-- agent-results:start -->
| DevSwarm family | Text + real read | Recipe / codec | Evidence and limits |
| --- | --- | --- | --- |
| Amazon Q (`q`) | [Passed](real-q.md) | amazon-q / amazon-q | `fs_read`; installed `q` invokes Kiro 2.3.0. |
| Claude Code (`claude`) | [Passed](real-cli.md) | claude-code / anthropic-messages | `Read`; separate real PTY, ACP and browser evidence. |
| Codex (`codex`) | [Passed](real-cli.md) | codex / openai-responses | `exec_command` executes `/bin/cat`. |
| Antigravity (`antigravity`) | [Passed](real-gated-agents.md) | antigravity / google-genai | Actual `agy` uses `view_file`. |
| Gemini CLI (`gemini`) | [Passed](real-google-agents.md) | gemini / google-genai | `read_file`; incremental CLI output and process cancellation. |
| Rovo Dev (`acli`) | [Passed](real-gated-agents.md) | rovo-dev / atlassian-rovo | Direct installed `acli` plugin executes `open_files`; selected CLI buffers stdout. |
| Aider (`aider`) | [Passed](real-editor-agents.md) | aider / openai-chat-completions | Real shell read after explicit stdin consent; result appears in conversation text. |
| Goose (`goose`) | [Passed](real-provider-agents.md) | goose / anthropic-messages | Real `shell` read; separate title requests. |
| Cursor (`cursor-agent`) | In progress | — / — | Service and authentication boundary under investigation. |
| Amp (`amp`) | [Passed](real-gated-agents.md) | amp / amp-service | Real `Read`; explicit service bootstrap; selected CLI buffers stdout. |
| GitHub Copilot CLI (`copilot`) | [Passed](real-provider-agents.md) | copilot / anthropic-messages | Real `view` read; incremental output and process cancellation. |
| Mistral Vibe (`vibe`) | [Passed](real-google-agents.md) | mistral-vibe / openai-chat-completions | Real `read_file`; selected headless mode requests nonstreaming JSON. |
| Qwen Code (`qwen`) | [Passed](real-google-agents.md) | qwen / openai-chat-completions | Real `read_file`; incremental output and process cancellation. |
| Auggie (`auggie`) | [Passed](real-auggie.md) | auggie / augment | Real `view`; explicit model bootstrap, native NDJSON, incremental output and cancellation. |
| OpenCode (`opencode`) | [Passed](real-provider-agents.md) | opencode / anthropic-messages | Real `read`; CLI consumes stream but buffers assistant output. |
| Crush (`crush`) | [Passed](real-provider-agents.md) | crush / anthropic-messages | Real `view`; separate title requests. |
| Cline (`cline`) | [Passed](real-editor-agents.md) | cline / openai-chat-completions | Native XML `read_file` / `attempt_completion` carried in model text. |
| Plandex (`plandex`) | [Passed](real-plandex.md) | example-local plandex / openai-chat-completions | Self-hosted real server directs CLI context read; separate summaries. |
| Factory Droid (`droid`) | [Passed](real-provider-agents.md) | droid / anthropic-messages | Real `Read`; CLI consumes stream but buffers assistant output. |
| Qodo (`qodo`) | In progress | — / — | Service and agent execution boundary under investigation. |
<!-- agent-results:end -->

All runs use test credentials and isolated scratch configuration. Installed or project-local binaries, SDKs, containers, PTYs, permissions and cleanup are consumer tooling in `examples/`; the public library does not install, discover, launch or manage agents. Most verified recipes are bundled and can also be loaded privately with `registry.loadFile()` through the same validator. Plandex retains an example-local recipe because its custom-model setup also needs a consumer-owned self-hosted backend.

## Reproduction groups

Use real Node >=22 first on PATH. The known DevSwarm shell's default `node` is a Bun shim; use an actual Node executable. Inside DevSwarm wrap bounded commands with `hivecontrol exec oneshot 6m --` (see each group's exact timeout/setup).

- [Claude and Codex](real-cli.md): `node examples/real-cli/run.mjs /tmp/cli.json`.
- [Copilot, Goose, Droid, OpenCode and Crush](real-provider-agents.md): `node examples/real-provider-agents/run.mjs /tmp/providers.json`.
- [Gemini, Qwen and Mistral Vibe](real-google-agents.md): `node examples/real-google-agents/run.mjs /tmp/google.json`.
- [Amazon Q / installed Kiro wrapper](real-q.md): `node examples/real-q/run.mjs /tmp/q.json`.
- [Auggie](real-auggie.md): `node examples/real-auggie/verify.mjs /tmp/auggie.json`.
- [Plandex](real-plandex.md): bootstrap the real CLI/backend, then `node examples/real-plandex/run.mjs /tmp/plandex.json "$PLANDEX_TEST_SOURCE"`.
- [Amp](real-gated-agents.md): `node examples/real-gated-agents/run.mjs /tmp/amp.json --amp`.
- [Rovo Dev](real-gated-agents.md): `node examples/real-gated-agents/run.mjs /tmp/rovo.json --rovo`.
- [Antigravity](real-gated-agents.md): `node examples/real-gated-agents/run.mjs /tmp/agy.json --antigravity`.
- [Aider and Cline](real-editor-agents.md): `node examples/real-editor-agents/verify.mjs /tmp/editors.json`.

Exact executable observations, configuration inputs, arguments, package integrity, captured requests, returned output and limitations are retained with each example. Executable versions do not gate future runs. Missing prerequisites or failed assertions fail verification rather than turning into skipped successes.

## Platform and protocol boundaries

No Windows/WSL host was exercised. Each of the 20 `*_WSL` values is explicitly `platform-unavailable` in the inventory; native macOS evidence is not WSL evidence. Linux/native Windows are likewise not inferred from these observations. The macOS consumers require `sandbox-exec` and fail rather than silently remove network isolation.

Provider streaming, incremental agent output, process-disconnect cancellation and native ACP cancellation are distinct observations. Droid and OpenCode's selected JSON CLI modes consume streaming replies but buffer assistant output until completion. Vibe's headless mode requests nonstreaming JSON despite its `--output streaming` option. New CLI process-cancellation tests do not establish same-session reuse; the separate [real Claude ACP example](real-acp.md) establishes native ACP cancellation and reuse.
