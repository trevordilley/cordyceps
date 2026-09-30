# Real Gemini CLI, Qwen Code and Mistral Vibe consumers

This example builds and packs Cordyceps, installs that tarball into a disposable npm project, and imports only `prepare` and `createRegistry` from `cordyceps`. The consumer owns every executable, argument, permission choice, sandbox, temporary home and process cleanup. No launcher, discovery or installation code is added to the library.

## Reproduce

On macOS with the three real CLIs installed, use real Node 22 or newer (a Bun `node` shim is rejected):

```sh
PATH=/Users/20idemo/.nvm/versions/node/v22.22.3/bin:$PATH \
  hivecontrol exec oneshot 6m -- node examples/real-google-agents/run.mjs /tmp/cordyceps-google-evidence.json
```

Install project dependencies first with `hivecontrol exec oneshot 3m -- bun install --frozen-lockfile`. Outside DevSwarm the same Node command can be run directly. Optional final positional selection is `gemini`, `qwen`, or `mistral-vibe`. `GEMINI_BINARY`, `QWEN_BINARY` and `VIBE_BINARY` override the observed installed executable paths; executable choice belongs to this consumer. The model selections are observed test inputs, not supported-version gates.

The example requires `/usr/bin/sandbox-exec` and fails on other platforms. Every agent runs with a fresh `HOME`, empty work directory, test API key, and a write boundary covering only consumer/session temporary directories plus `/dev/null` and `/dev/tty`. Outbound networking is denied except loopback. No user credentials, settings, shell startup, or paid provider are used. Proxy variables are absent: Gemini's configured proxy can override loopback routing even when `NO_PROXY` is set. The OS sandbox supplies the network boundary.

## Observed results

| Installed agent | Version | Controlled text | Real read + token in next request | Cancellation | Provider streaming |
| --- | --- | --- | --- | --- | --- |
| Gemini CLI | 0.39.1 | Pass | Pass | Pass | SSE; native output observed before completion |
| Qwen Code | 0.15.4 | Pass | Pass | Pass | SSE; native output observed before completion |
| Mistral Vibe | 2.22.0 | Pass | Pass | Pass | Programmatic mode uses JSON; no token streaming claim |

The successful run is preserved in `examples/real-google-agents/evidence.json`, including the exact argv and raw requests. Each agent generated 1/2/1 provider requests for text/tool/cancel. Vibe's installed `vibe/core/programmatic.py` explicitly constructs `AgentLoop(enable_streaming=False)`; its `--output streaming` means one JSON object per complete message. Interactive and ACP modes use streaming, but they are outside this example's headless validation. This is a mode limitation, not an unsupported injection claim.

The first consumer revision supplied dead HTTP proxy variables as an extra precaution. Gemini and Qwen then failed before reaching the mock. Removing these proxy variables while retaining the OS sandbox fixed both. A separate Gemini text assertion initially concatenated metadata between native deltas; parsing assistant content corrected the consumer assertion. No codec changes or fabricated responses were used to turn these failures into passing evidence.

## Injection recipes

The example loads `harnesses/gemini.json`, `qwen.json` and `mistral-vibe.json` through public `registry.loadFile()`. Recipe selection is injection data; the consumer separately supplies model, approval and output flags.

- **Gemini:** `GOOGLE_GEMINI_BASE_URL`, test `GEMINI_API_KEY`, isolated `GEMINI_CLI_HOME`, and a generated `.gemini/settings.json` selecting `gemini-api-key`. The system settings path also points to an empty owned file. Competing Vertex/Google authentication switches are removed. The native provider adapter is `google-genai`.
- **Qwen:** `OPENAI_BASE_URL=<mock>/v1`, test `OPENAI_API_KEY`, and explicit `--auth-type openai`. The consumer adds `--bare`, isolated `HOME`, model and approval flags. Adapter: `openai-chat-completions`.
- **Vibe:** isolated `VIBE_HOME` with generated `config.toml`, a `cordyceps` generic OpenAI provider, `api_base=<mock>/v1`, and `api_key_env_var=CORDYCEPS_API_KEY`. The model name is a required opaque recipe input. Update checks, telemetry and remote experiments are disabled in this owned configuration. Adapter: `openai-chat-completions`.

All noninteractive recipes take `inputs.prompt`; Vibe also takes `inputs.model`. Interactive recipes carry provider configuration without claiming terminal verification.

Official references checked 2026-09-29: [Gemini CLI configuration](https://geminicli.com/docs/reference/configuration/), [Gemini GenerateContent API](https://ai.google.dev/api/generate-content), [Qwen authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/), [Qwen model providers](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/model-providers.md), and [Vibe configuration](https://docs.mistral.ai/vibe/code/cli/configuration). Installed `--help` and package source confirm the actual flags, environment names, provider schema and read-tool arguments used by the consumer.

## Assertions and evidence

Each agent has three real process cases:

1. **Text:** the actual prompt reaches the captured provider request; a scripted two-part response appears in the real binary's output. Gemini and Qwen must request SSE and emit the first text segment before the provider releases the remainder. Vibe's programmatic runner requests JSON and emits complete messages, even with `--output streaming`; this is recorded as nonstreaming evidence.
2. **Tool:** the first captured request offers a file-read tool. Cordyceps issues a native function call. An unpredictable token exists only in disposable `fixture.txt`; the actual agent reads it, and its next provider request must contain that token in a successful tool result. Only then does the provider send the controlled completion marker.
3. **Cancel:** a real request is held open, the consumer kills its owned process group, and the Node provider must observe an aborted exchange. This tests process termination and provider disconnect, not an interactive cancel key or same-process reuse.

Every case records the actual executable version, arguments, prompt, stdout/stderr, raw and decoded requests, provider response chunks and outcomes, failure details, and cleanup results. The evidence also records the installed package resolution and npm artifact integrity. Failed cases preserve observations and fail the overall command; no synthetic replacement request counts as evidence.

## Native Gemini codec scope

`google-genai` matches only POST `/v1/models/<model>:generateContent`, `/v1beta/models/<model>:generateContent` and their `streamGenerateContent?alt=sse` equivalents. The model comes from the URL, streaming from the method suffix, and system/content text from explicit non-thought text parts. Function declarations preserve their native schema; function results retain the full response JSON and raw part. Results without native IDs use their function name, without inventing a call ID.

Responses support text, function calls, JSON collection, incremental SSE, native error envelopes and abort signals. SSE completion uses a final `finishReason: STOP` candidate and no OpenAI `[DONE]` sentinel. This subset does not implement Vertex project/location routes, countTokens, model listings, multimodal output or thought signatures. Unknown endpoints remain visible errors. Focused regression tests cover native normalization, endpoint rejection, mixed text/tools, error status, framing and abort behavior.
