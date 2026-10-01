# Kilo, Continue, Autohand and Command Code

Four native CLIs pass controlled text and real file reads through an externally installed, packed Cordyceps artifact. The separate [Codebuff source and Polygraph consumer](real-codebuff-polygraph.md) now exercises those two profiles as well; the published Codebuff 1.0.688 binary remains excluded.

| CLI | Observed release | Native read | Streaming in tested mode | Cancellation |
| --- | --- | --- | --- | --- |
| Kilo | `@kilocode/cli` 7.8.1 | `read({filePath})` | Provider SSE consumed; stdout buffered | Process termination aborts provider exchange |
| Continue | `@continuedev/cli` 1.5.47 | `Read({filepath})` | Provider SSE consumed; stdout buffered | Same |
| Autohand | `autohand-cli` 0.9.8, build 55f07f81 | `read_file({path})` | Native Anthropic client requests nonstreaming JSON; stream case omitted | Same |
| Command Code | `command-code` 1.72.4 | `read_file({file_path})` | Incremental native stdout observed before gated stream completes | Same |

Fifteen native cases passed on macOS 15.7.4 arm64, Node 22.22.3 and Bun 1.3.13: four each for Kilo, Continue and Command Code, and three for Autohand. These are observations of these installed releases, not a compatibility guarantee or ACP cancellation/reuse claim. Existing suite: 137 passed, 2 existing Bun skips, 0 failed (947 assertions).

## Reproduce

Use real Node >=22 on PATH, not a Bun shim. Installation and downloads happen before isolated agent execution. No real credentials are needed.

```sh
node examples/real-extra-cli/install.mjs /tmp/cordyceps-extra-deps
node examples/real-extra-cli/run.mjs /tmp/extra-verified.json
node examples/real-extra-cli/summarize.mjs /tmp/extra-verified.json examples/real-extra-cli/evidence.json
```

`EXTRA_CLI_DEPS` changes the dependency directory. Binary overrides are `KILOCODE_BINARY`, `CONTINUE_CLI_BINARY`, `AUTOHAND_BINARY` and `COMMAND_CODE_BINARY`. Optional runner arguments after the output path select comma-separated harnesses and scenarios, for example `continue-cli text,tool`.

The runner builds and packs the library, installs that tarball offline into a fresh directory outside the repository, copies the consumer and selected JSON recipes there, and imports only public `cordyceps` exports. It loads recipes with `createRegistry({builtins:false})` and `registry.loadFile(...)`; the same definitions are also bundled by the default registry.

Each case generates its own HOME, work directory, unpredictable fixture token and provider session. The first native prompt request must exclude the token. Cordyceps returns the read call actually offered by that CLI; the native harness executes it. The immediately following prompt request must contain that call's real successful result and token. Only then does the provider return the completion marker, which must appear in actual CLI stdout. No consumer handler reads the fixture on behalf of the agent.

macOS `sandbox-exec` restricts outbound connections to loopback and writes to disposable directories. Child environment variables are allowlisted; known user credential locations are denied. All injected credentials are disposable placeholders. A held request verifies process-group termination and provider abort. Consumers kill children, dispose listeners/configuration, remove scratch state and assert cleanup. The library still does not install, discover or launch agents.

## Injection details and official sources

- **Kilo:** `KILO_CONFIG` points at generated JSON with `provider.anthropic.options.baseURL` set to `${mock.baseUrl}/v1` and a test API key. Consumer selects `anthropic/claude-sonnet-4-5-20250929`, uses `run --pure --title Cordyceps --format json`, and disables updates/model downloads. [Official CLI docs](https://kilo.ai/docs/code-with-ai/platforms/cli), [official custom model config](https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-docs/pages/code-with-ai/agents/custom-models.md).
- **Continue:** explicit `--config` loads generated `continue.yaml`. JSON is valid YAML and is accepted by the installed YAML loader; the recipe needs no YAML serializer. `schema:v1` model configuration uses `provider:anthropic`, `apiBase:${mock.baseUrl}/v1` and a disposable `apiKey`. Consumer chooses `-p --auto`. Tool input is `filepath`, not `file_path`. [CLI quickstart](https://docs.continue.dev/cli/quickstart), [tool permissions](https://docs.continue.dev/cli/tool-permissions), [official source](https://github.com/continuedev/continue). The installed `dist/index.js.map` was also inspected for the exact config loader and native tool schema.
- **Autohand:** `AUTOHAND_CONFIG` selects an Anthropic configuration whose `baseUrl` is the mock origin (the client appends `/v1/messages`). A placeholder `AUTOHAND_API_KEY` passes bare startup credential presence checks. The consumer selects `--bare --offline --ephemeral --yolo --max-requests 4 --output-format stream-json`; the output format does not make provider requests streaming. Permission bypass is consumer-owned. [Config reference](https://github.com/autohandai/code-cli/blob/main/docs/config-reference.md), [CLI docs](https://docs.autohand.ai/working-with-autohand-code/cli), inspected source commit `a248656e78244f8387c0d0e436786fe801ad6599`.
- **Command Code:** native BYOK configuration is only loaded from `~/.commandcode/providers.json`, so this recipe sets HOME to the owned session directory. It uses an OpenAI Chat Completions provider named `cordyceps`, base URL `${mock.baseUrl}/v1`, environment-backed API key and `fixture-model`. `COMMAND_CODE_API_KEY` is a test placeholder required by the print-mode presence gate even with BYOK; `CMD_LOCAL_ONLY=1` selects local execution. Consumer selects `--model cordyceps/fixture-model --local-only --trust --yolo --skip-onboarding --no-auto-update --no-skills --no-session --max-turns 4 --output-format json`. [BYOK docs](https://commandcode.ai/docs/byok), [settings](https://commandcode.ai/docs/settings), [official repository](https://github.com/CommandCodeAI/command-code). Exact provider loader and read schema were checked in the installed npm CLI.

The four recipes required no codec/core changes. Setup corrected genuine consumer/config boundary mistakes: native tool parameter spellings, Autohand's origin-vs-`/v1` base URL, Continue's config shape, and Command Code's separate print-mode key presence gate. No upstream CLI was patched.

`examples/real-extra-cli/versions.json` records npm tarball URLs and integrity values. `evidence.json` retains native versions/argv/output, assertions, response observations, offered tool names, actual fixture tool results and request body sizes/SHA-256. The runner output retains full native provider requests (including system prompts) for local inspection; the committed evidence is intentionally summarized.
