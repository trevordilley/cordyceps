# Cursor native agent boundary

**Cursor is not a passing model-injection integration.** The installed `cursor-agent` `2026.04.28-e984b46` was exercised unchanged, with a built and packed Cordyceps library installed outside this repository. The diagnostic establishes a remote-agent boundary, not merely a missing wire codec. Controlled assistant text, a real fixture read returned to a model, incremental model output, and model-request cancellation remain unvalidated.

[Raw evidence](../examples/real-cursor/evidence.json) includes package integrity, the independent public import path, native version and command, bootstrap replies, ACP responses, native HTTP bytes, decoded run submission, provider rejection and cleanup. [Read-only source evidence](../examples/real-cursor/source-evidence.json) records installed file hashes and exact structural markers; it does not modify or redistribute the package.

## Reproduce

Use real Node 22 or later; this environment's default `node` is a Bun shim. The diagnostic requires macOS `sandbox-exec` and the installed native Cursor executable. `CORDYCEPS_CURSOR_BINARY` overrides the observed default executable path. Installation/launch/cleanup remain consumer responsibilities.

```sh
bun install --frozen-lockfile
node examples/real-cursor/run.mjs /tmp/cordyceps-cursor-evidence.json
```

Successful completion means the boundary assertions passed. The report deliberately retains `passed: false`. There is no Cursor provider recipe or provider codec advertised as validated.

## What the unmodified client does

1. Print mode exchanges the test key at `/auth/exchange_user_api_key`. A correctly shaped synthetic access/refresh response succeeds, but subsequent token persistence invokes macOS Keychain and fails under the outer sandbox. Both `--auth-token` and API-key authentication call `setAuthentication`; changing HOME alone cannot isolate this credential store.
2. ACP accepts the test API key before exchange. Its first session initialization can fail when persistence is denied. The native refresh implementation retains the ephemeral token before that failure; a subsequent session initialization proceeds without relaxing Keychain isolation or modifying the executable.
3. Explicit, consumer-owned protobuf metadata supplies a test model through `AiService/GetUsableModels` and `GetDefaultModelForCli`. Empty replies to auxiliary metadata calls are captured. These are diagnostic service bootstrap replies, not a model backend.
4. The real client creates an ACP session and submits `/agent.v1.AgentService/RunSSE` plus `/aiserver.v1.BidiService/BidiAppend`. The latter contains hexadecimal serialized `AgentClientMessage.run_request`. Decoding it reveals the actual fixture-read prompt, conversation ID, model selection and `ApiKeyCredentials.baseUrl` pointing at the test `/provider` URL. The test provider URL is submitted **to the agent service**; no request reaches it locally.
5. Read-only inspection of `agent-client` shows a complete `AgentRunRequest` sent to the service. The response is split into interaction, execution, checkpoint and key/value streams. Local execution results return as `execClientMessage` on that same agent stream. `AgentServerMessage` includes `exec_server_message`, `interaction_update`, and `conversation_checkpoint_update`. Thus writing a response codec that supplies text, execution RPCs, checkpoints and subsequent turns here would implement the missing agent service. It would not retain the real Cursor agent loop while replacing only its model.

The real BidiAppend bytes are also sent unchanged to the packed public Cordyceps provider, which rejects the proprietary envelope. That rejection alone is **not** the external prerequisite: the decisive evidence is the client/service split and provider credentials carried across it. The temporary fixture's random contents are never inserted into a mocked result, and are absent from captured requests. No file-read success is claimed.

The consumer kills the real ACP process group after the run submission and held service stream are observed. The service socket disconnects, the process exits by signal, and owned listeners/files are removed. This proves process/service-connection cancellation only; it does not establish provider cancellation or same-session reuse.

## Precise prerequisite and alternatives

For an injection-only test of the **actual complete Cursor agent**, an authentic Cursor agent backend must run in an authorized environment where its outgoing model calls can be routed to Cordyceps. No such backend artifact or service-side local-provider injection access was available in this run. A local codec for the visible remote-agent RPC alone cannot supply that missing implementation.

Cursor's [security documentation](https://www.cursor.com/security) states that prompt construction occurs on its servers and that custom provider keys do not make the app route directly to those providers. The [authentication reference](https://docs.cursor.com/en/cli/reference/authentication) documents the API-key and custom API-endpoint paths; [ACP documentation](https://prod.cursor.com/docs/cli/acp) documents ACP authentication and cancellation. The installed package and captured traffic establish the narrower CLI observations above; no assertion is made about every future release or private integration.

Viable next steps require one of these concrete changes:

- A vendor-provided local/test agent backend with a configurable model endpoint. Run that real backend and the native client in the same loopback-isolated test environment, then add the exact provider codec it emits.
- An authorized vendor staging integration that permits routing its model calls to a reachable test provider and guarantees no live inference fallback. This requires a separately approved environment/network scope; a developer machine's loopback URL is not automatically reachable from the remote backend.
- A separate **agent-service contract test** can emulate Cursor's execution/interaction protocol to test local tools, rendering and ACP cancellation. It must be labeled agent-service emulation and cannot count toward the requested native model-injection validation.

A disposable Linux installation could avoid macOS Keychain persistence, but would not move the remote agent loop into the client. It is not, by itself, a solution to the model boundary.

All observed subprocesses use fresh HOME/XDG/work directories, synthetic credentials, a loopback-only outbound OS sandbox, denied Keychain access, denied browser launch and restricted writes. User authentication/configuration and installed binaries remain unchanged. No paid/live provider calls or publication occurs.
