# Real Amazon Q / Kiro consumer

Amazon Q was exercised through the installed `q` wrapper, which invokes Kiro CLI 2.3.0 on this machine. This is a native AWS service integration, not an OpenAI-compatible substitute. Cordyceps only supplies provider injection and HTTP replies; the developer's consumer owns binary paths, helper installation, process launch, permissions, isolation and cleanup.

## Reproduce

With dependencies installed, run from the repository root:

```sh
node examples/real-q/run.mjs /tmp/cordyceps-q-native.json
```

Use real Node >=22, not a Bun-backed `node` shim. `Q_BINARY` overrides the installed `q` executable; `Q_CHAT_BINARY` overrides the Kiro CLI chat helper (default `/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat`). These are consumer inputs, not library discovery logic.

The verifier builds and packs the library, installs the tarball offline into a disposable project, copies the consumer there, and uses only public `cordyceps` imports. It loads `harnesses/amazon-q.json` from that installed artifact through the public registry. The library itself never launches or discovers Q.

The recipe creates an isolated HOME with `.kiro/settings/cli.json` containing `api.codewhisperer.service` and `api.q.service` endpoint/region objects. It supplies the local test key as `KIRO_API_KEY`. The consumer creates its own helper symlink in that scratch HOME. No user credentials or configuration are copied. Each process runs inside an outer macOS sandbox allowing outbound connections only to loopback and writes only to owned scratch paths and terminal devices; the example fails on other platforms. Keychain service access and browser launch are denied. `--trust-all-tools` is a consumer-selected flag inside this sandbox.

## Protocol and scope

The `amazon-q` codec accepts POST `/` with optional query strings and validates `X-Amz-Target`. Exactly these native operations are supported:

- `AmazonCodeWhispererStreamingService.GenerateAssistantResponse`: native conversation history/current text, currently offered tool specifications, and real tool results normalize into the shared capture. `modelId` is optional; absence normalizes to an empty model string. Replies use `application/vnd.amazon.eventstream` binary framing, network-order lengths, and both AWS CRC32 checksums. Text emits `assistantResponseEvent`; calls emit `toolUseEvent` with an input JSON string and `stop: true`. HTTP EOF ends the stream. Tools execute only inside the actual CLI.
- `AmazonCodeWhispererService.ListAvailableModels`: an explicit `{amazonQ: {models: [...]}}` route controls the model list. The example supplies an empty list, with no guessed provider catalogue.
- `AmazonCodeWhispererService.SendTelemetryEvent`: an explicit `{amazonQ: {telemetry: true}}` route acknowledges the request with `{}`.

Auxiliary requests are captured and routed normally. There are no automatic acknowledgements, silent ignores or upstream fallbacks. Unsupported targets, bad request shapes, mismatched replies and unhandled requests fail visibly. `{error}` produces an AWS JSON service error. Encoding is lazy and cancellation guarded; the HTTP listener owns writes, disconnects, backpressure and cancellation of pending pulls. This is a narrow protocol subset, not full Q/Kiro service emulation: authentication, subscriptions, images, citations, reasoning and other operations are not implemented.

The upstream AWS repository now identifies Kiro as the closed-source successor. The installed wrapper and actual traffic establish this version's behavior. Wire fields were checked against AWS's public generated Rust [event dispatch](https://github.com/aws/amazon-q-developer-cli/blob/main/crates/amzn-codewhisperer-streaming-client/src/event_stream_serde.rs), [text event schema](https://github.com/aws/amazon-q-developer-cli/blob/main/crates/amzn-codewhisperer-streaming-client/src/protocol_serde/shape_assistant_response_event.rs), [tool event schema](https://github.com/aws/amazon-q-developer-cli/blob/main/crates/amzn-codewhisperer-streaming-client/src/protocol_serde/shape_tool_use_event.rs), [optional model field](https://github.com/aws/amazon-q-developer-cli/blob/main/crates/amzn-codewhisperer-streaming-client/src/types/_user_input_message.rs) and [endpoint configuration](https://github.com/aws/amazon-q-developer-cli/blob/main/crates/chat-cli/src/api_client/endpoints.rs), inspected 2026-09-29 PDT.

## Evidence

The consumer requires actual captured prompt traffic and actual CLI output. Its file-read case writes an unpredictable token only to a disposable fixture, scripts Q's offered `fs_read` operation, then requires the token in the next captured request's tool result. The backend neither reads that fixture nor manufactures its result. Each scenario records complete requests, binary response chunks, process output, failures, package integrity and cleanup; a zero CLI exit alone is insufficient because Q may exit zero after a provider failure.

`tests/amazon-q.test.ts` independently checks wire lengths and both checksums with native zlib, UTF-8 payloads, tool input, normalization, lazy iteration, cancellation, explicit auxiliary response matching, malformed requests and service errors. Packed real results complement these synthetic regressions; they do not certify other OSes or versions.

Observed run on 2026-09-29 PDT with real Node 22.22.3 and the installed Q wrapper/Kiro CLI 2.3.0:

| Scenario | Captures (generation only) | Required real observation |
| --- | --- | --- |
| Text | 4 (1) | Controlled marker printed by Q; clean exit. |
| Fixture read | 6 (2) | Q ran `fs_read`; next generation request contained the file-only token; controlled completion printed. |
| Stream | 4 (1) | First text displayed while the final event was gated; consumer released the gate only after observing CLI output. |
| Cancel and recover | 7 (2) | Consumer killed Q after observing the first text; held provider response recorded `aborted`, with no gated final chunk; a fresh Q process reused the same mock session successfully. |

The Q [parser](https://github.com/aws/amazon-q-developer-cli/blob/main/crates/chat-cli/src/cli/chat/parser.rs) looks ahead one event before releasing assistant text to handle code references. The stream/cancel consumer therefore scripts two text deltas before the gate. This is consumer-selected stream content; the codec does not insert delays, prefetch scripts or manufacture extra content.

[Compact checked evidence](../examples/real-q/evidence.json) retains version output, CLI transcripts, actual tool result, outcome counts, package identity and a SHA-256 for the full capture. Full byte/request evidence is written to the caller-selected path by each reproduction run. Cancellation here means terminating the consumer-owned CLI process, not a claim about Q's interactive Ctrl-C or native session reuse. All four scenarios asserted healthy mocks and closed listeners, and removed their owned temporary state.
