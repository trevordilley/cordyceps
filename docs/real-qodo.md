# Qodo native service boundary

**Qodo is not a passing mock-model integration.** The installed `@qodo/command` 0.36.0 reaches a controllable native WebSocket service, but that service owns the agent decisions. Its model client is not present in the inspected CLI or SDK execution path. Implementing the WebSocket messages as Cordyceps model replies would replace that agent service, rather than test the actual agent against a mock model.

[Recorded evidence](../examples/real-qodo/evidence.json) advances beyond the earlier `/v2/info/get-things` startup failure. It contains the actual binary invocation, installed source hashes, packed Cordyceps artifact integrity, native requests, process output, explicit diagnostic replies, and cancellation results. `passed` remains `false`; `boundaryDiagnosticPassed` describes only the narrower assertions below.

## Reproduce

```sh
export PATH=/Users/20idemo/.nvm/versions/node/v22.22.3/bin:$PATH
hivecontrol exec oneshot 2m -- bun install --frozen-lockfile
hivecontrol exec oneshot 4m -- node examples/real-qodo/run.mjs /tmp/qodo.json
```

The consumer defaults to `/Users/20idemo/.bun/bin/qodo`; `CORDYCEPS_QODO_BINARY` can select another installed package executable. The version is recorded, not used as a compatibility gate. `run.mjs` builds and packs Cordyceps, installs that artifact and ordinary `ws@8.18.3` into a temporary external consumer, and imports only the public `cordyceps` entry. Package setup may use npm network access; the actual agent is subsequently confined to outbound loopback by `sandbox-exec`.

The consumer uses the existing isolated diagnostic launcher: disposable HOME, XDG directories, work directory, test credentials, denied Keychain access, denied browser launch, and writes restricted to the owned scratch directory. No user auth/config is copied or modified. The consumer owns installation, launch, WebSocket metadata service, process cancellation, and cleanup. Nothing is added to the public library's execution scope.

## Observed real traffic

Both cases complete these assertions, once with `--no-builtin` and once with native `--tools filesystem`:

1. The CLI fetches `/v2/info/get-things`. The diagnostic supplies only a session ID, a selected model name, model listing, and empty backend MCP metadata. Analytics is acknowledged locally.
2. It opens `/v2/agentic/ws/connect?session_id=…&request_id=…`. The diagnostic sends the native transport `Ready` message.
3. The CLI sends `UserQuery {…}\n`, containing the actual prompt, work directory, `agent_type: "cli"`, `ci_mode`, `execution_strategy: "act"`, and `custom_model: "cordyceps-diagnostic-model"`. The native-tools case declares ten filesystem tools, including `read_files`, with their real schemas.
4. Both ordinary provider environment overrides point to the packed Cordyceps sentinel: `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`, with test keys. No model requests or decoder failures arrive. `--model` changes the remote `custom_model` field; it does not select a local provider client.
5. After receiving the real `UserQuery`, the consumer holds the service response, kills the process group, and observes native WebSocket disconnect code 1006. This establishes process cancellation and socket cleanup, not model-request abort or session reuse.

An unpredictable fixture token is written only to the scratch file and is absent from both initial requests. No read instruction, assistant response, or completion decision is sent by the diagnostic. Consequently there is **no actual file-read round trip, controlled assistant text, or incremental assistant-output result**. Those requirements remain unvalidated. The provider sentinel is a negative observation on this path, not a claim that every possible configuration has been exhausted.

## Execution boundary in installed source

Paths and line numbers below refer to the installed package rooted at `qodo.packageRoot` in the evidence. SHA-256 hashes identify the inspected files, including the actual bundled CLI entry, without copying vendor implementation into this repository.

| Installed file / location | Evidence |
| --- | --- |
| `dist/auth/index.js:93`, `dist/utils/serverData.js:10` | `QODO_API_BASE_URL` / `QODO_BASE_URL` select the Qodo service; bootstrap may also return a replacement `base_url`. These are service URLs. |
| `dist/api/websocketClient.js:461–484` | URL is `/v2/agentic/ws/connect`; outgoing frames are a message type followed by JSON and a newline. Connection readiness and checkpoints are service protocol state. |
| `dist/api/agent.js:413–480` | `sendUserQuery` collects tools, permissions, instructions, session information and the selected model name, then sends `UserQuery`. |
| `dist/api/agent.js:572–613` | Backend task responses select `UserResponse`, `EndNode`, or local tool execution. The client dispatches those already-made decisions. |
| `dist/api/agent.js:774`, `824–861` | The local MCP manager executes `server_name` / `tool` / `tool_args` from the service. Results return as `IDERetrievalAnswer`, not a local model conversation request. |
| `dist/sdk/inprocess/QodoClient.js:94`, `209`, `221` | The SDK initializes the same service metadata and constructs the same `AgentAPI`. Running the SDK in-process does not move agent reasoning in-process. |
| `dist/sdk/inprocess/QodoClient.d.ts:21–35` | Options expose model name, agent configuration, tools, flags and directories; no model implementation or provider URL option is declared. |
| `dist/sdk/core/messageMappings.js:2` | The OpenAI LangChain import converts stored messages to OpenAI format for output. Its presence is not evidence of a local OpenAI inference client. |

The [official command repository](https://github.com/qodo-ai/command) documents model-name selection with `--model`, and describes the CLI as a way to interact with the Qodo platform. The repository tree inspected during this investigation contains documentation/action integration, not a runnable agent backend. This corroborates the installed runtime path; it does not establish that Qodo offers no private deployment or future model-injection option.

## Missing prerequisite and alternatives

The prerequisite is **access to the actual Qodo agent backend with a configurable, locally reachable model transport**, or a vendor-provided local agent runtime/model-client hook. Neither is supplied by this installed CLI/SDK or the inspected public command repository. A working WebSocket codec alone cannot supply it. Authentication/bootstrap has already been crossed with test metadata, so neither a paid credential nor the old startup 404 explains the remaining boundary.

Viable next paths are:

- Obtain a runnable Qodo agent backend for an isolated consumer-owned local deployment, including its model endpoint override. Keep the real backend's session/decision machinery, and point its model client at packed Cordyceps. This would permit the required native CLI → real backend → mock model → real local tool → next model request validation without live inference.
- Use a vendor-provided local model-client injection hook, if available, retaining the actual Qodo agent loop. The inspected `QodoClient` options do not expose one; private/enterprise capabilities were not accessed.
- Test the CLI transport/MCP dispatcher separately with scripted remote-agent decisions. That can exercise real local reads and display behavior, but must be labeled a **remote-agent client test** and cannot count as the requested mock-model integration. This diagnostic intentionally stops before doing that.

No `qodo` provider codec or bundled recipe is registered, because there is no honest model endpoint to target under the current prerequisites. No shared types, registry, inventory, Saga, main branch, or publishing state is changed by this work.
