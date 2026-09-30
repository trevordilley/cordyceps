# Real proprietary-agent probes and Antigravity validation

These are observations from **real installed binaries**, not a support/version gate. Seven native DevSwarm enum entries were exercised on macOS 15.7.4 with Node 22.22.3, against a packed, independently installed Cordyceps artifact. Antigravity passed text, real tool execution, streaming, and cancellation. The other six have captured, reproducible failures in this discovery phase; none is counted here as a successful harness validation. Q and Auggie codec implementation has been handed to dedicated siblings, so those are pending implementation rather than external blockers. Follow-up investigation of the remaining service protocols is ongoing.

The mapping was read from DevSwarm `d7c33873380e092018140ccf6e90529e1605fff0`, `libs/shared/types/src/ai-agent.ts` and `libs/desktop/utils/src/agent.ts`. In particular, Antigravity means **`agy`**, Rovo means **`acli rovodev`**, and Amazon Q means **the installed `q` command**. The local `q` wrapper invokes Kiro; that identity change is retained in the evidence. The corresponding `*-wsl` entries were not run on this macOS host.

## Reproduce

Use real Node first on PATH; the default development `node` shim can be Bun. No agent executable is discovered, downloaded, or launched by the public library.

```sh
export PATH=/Users/20idemo/.nvm/versions/node/v22.22.3/bin:$PATH
hivecontrol exec oneshot 3m -- bun install --frozen-lockfile
hivecontrol exec oneshot 3m -- node examples/real-gated-agents/run.mjs /tmp/agy.json --antigravity
hivecontrol exec oneshot 5m -- node examples/real-gated-agents/run.mjs /tmp/gated.json
```

The first command after install is an assertion-based validation and fails if any Antigravity scenario fails. The second is a **diagnostic collection**: successful completion means it saved observations, not that the agents passed. Its records retain `passed: false`, the exact command, stdout/stderr, raw HTTP, decoder failures, and unexercised tool/stream prerequisites. A final comma-separated argument selects diagnostic agents, for example `q,cursor,auggie`.

`probe.mjs` lists the observed installation paths. Override an executable with `CORDYCEPS_<AGENT>_BINARY`; names are `Q`, `ROVO`, `AMP`, `CURSOR`, `AUGGIE`, `ANTIGRAVITY`, and `QODO`. Installed paths and versions are observations, not fixed support requirements.

Every process has a disposable HOME, XDG directories, work directory, test-only credentials, and an outer `sandbox-exec` boundary that permits outbound loopback only and writes only in owned temporary directories. Keychain access and `/usr/bin/open` are denied. The executable process group is reaped before owned files/listeners are removed. Proxies are removed for Cursor because its API-key exchange did not honor the loopback exclusion with the trap proxy. The outer network boundary remains enforced. No real account login, paid inference, publication, or user configuration mutation occurs.

The diagnostic capture proxy forwards bytes unchanged to the packed provider; it has no upstream fallback or fabricated service responses. It preserves proprietary requests that the Anthropic decoder rejects. This makes a service protocol mismatch inspectable without misrepresenting it as a successful provider exchange. The Antigravity success cases connect directly to the packed native Gemini codec.

Committed raw evidence: [Antigravity validation](../examples/real-gated-agents/antigravity-evidence.json), [six-agent discovery](../examples/real-gated-agents/diagnostic-evidence.json), [current Amp attempts](../examples/real-gated-agents/current-amp-evidence.json), and [current Amp help](../examples/real-gated-agents/current-amp-help.json).

## Observed outcomes

| DevSwarm entry / actual binary | Observed version | Result and narrow prerequisite |
| --- | --- | --- |
| `Q=q` / `q` → installed `kiro-cli` | `kiro-cli 2.3.0` | The custom service setting reaches loopback and sends native AWS JSON requests, including the real prompt and tools. AWS CodeWhisperer codec implementation handed to the Q protocol sibling; this discovery run has no controlled text or fixture result. |
| `ROVO=acli` / `acli rovodev` | `1.3.13-stable` | `run --help` and actual `run <prompt>` stop at scoped-token authentication. Test-token login in disposable config fails authentication. No provider request. A testable Rovo authentication/service path is still required. |
| `AMP=amp` / installed Amp | `0.0.1777394542-g1e2759` | Loopback receives `/api/internal?getUserInfo`; the service bootstrap fails with 404. |
| `AMP=amp` / additional temporary native Amp | `0.0.1790726504-g9299b2` | Current custom-URL setup for both Responses and Anthropic reaches `/api/internal?checkModelProviderAccess` first. Service-mediated connection provisioning requires an Amp service seam; no direct localhost provider exchange demonstrated. |
| `CURSOR=cursor-agent` / installed Cursor Agent | `2026.04.28-e984b46` | Real API-key attempt reaches loopback `/auth/exchange_user_api_key`, then reports invalid API key on the unimplemented response. Direct test `--auth-token` still encounters denied Keychain access. Missing isolated auth/bootstrap and Cursor native service protocol; no standard provider request. |
| `AUGGIE=auggie` / installed Auggie | `0.35.0`, commit `9a7f3836` | Valid-shaped test session reaches `/chat-stream` with actual prompt/tools. `--provider-base-url` is serialized as `third_party_override.base_url` inside that request. Augment codec implementation handed to the Auggie protocol sibling; the endpoint seam is established. |
| `ANTIGRAVITY=antigravity` / `agy` | `1.1.17` | **Passed** controlled text, actual `view_file` read with unpredictable token in the next provider request, incremental native output, and cancellation with provider disconnect. |
| `QODO=qodo` / installed `@qodo/command` | `0.36.0` | Test key and `QODO_API_BASE_URL`/`QODO_BASE_URL` reach `/v2/info/get-things`; CLI stops after 404 with an environment-availability message. Missing Qodo bootstrap/agent service codec; no standard model request demonstrated. |

For the six blocked agents, real tool execution and stream/cancel validation remain **unproved**, because controlled text never completed. A command exiting zero is insufficient: Kiro printed its service error while returning zero. These results do not establish that future releases or other authorized integration paths cannot work.

## Antigravity details

The local `harnesses/antigravity.json` recipe selects `google-genai`, sets `GEMINI_API_KEY` and `GOOGLE_GEMINI_BASE_URL`, and creates `.gemini/antigravity-cli/settings.json` with `modelProvider: "gemini"` under a session-owned HOME. That HOME also isolates CLI state. The consumer loads the recipe through public `createRegistry().loadFile()` before `prepare()`. Executable selection, model-independent prompt flags, permission flags, process management, and cleanup stay in the consumer.

This uses the official [Antigravity API-key and custom-endpoint workflow](https://antigravity.google/docs/cli/install). The installed `agy --help` confirms `--print`, `--output-format stream-json`, `--print-timeout`, and `--dangerously-skip-permissions`. Permissions are relaxed only inside the outer network/filesystem sandbox.

Observed paths were `/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse` and an auxiliary title request using `gemini-3.1-flash-lite-preview`. The consumer recognizes the title prompt independently. Successful request totals were 2 for text, 3 for tool, 2 for stream, and 1 for cancellation; title traffic is not counted as another conversation turn.

The `view_file` response names the real absolute fixture path with `toolSummary` and `toolAction`. The initial provider request lacks the fixture-only random token. The actual binary's next request contains that token in a native function response, and the consumer then returns the controlled completion marker. Streaming observes native partial stdout before the final chunk. Cancellation kills the consumer-owned process group only after the held real provider request arrives and asserts the route's abort signal and response outcome. All four cases assert captured prompt traffic, cleanup, and provider health.

## Blocker investigations

### Amazon Q mapping and Kiro service override

The installed `q` file is a 74-byte shell wrapper invoking `/Users/20idemo/.local/bin/kiro-cli --show-legacy-warning`. A temporary `~/.local/bin/kiro-cli-chat` symlink points to the existing installed Kiro subprocess; without it, an isolated HOME produced `No such file or directory`. No different enum agent or synthetic client replaces `q`.

`KIRO_API_KEY` accepts a nonempty test key. `AWS_ENDPOINT_URL` did not redirect inference; the first run attempted the blocked `q.us-east-1.amazonaws.com` host. The installed binary includes `api.codewhisperer.service`, `api.q.service`, and `api.kiroauth.service` settings. The [upstream endpoint resolver](https://github.com/aws/amazon-q-developer-cli/blob/main/crates/chat-cli/src/api_client/endpoints.rs) supplies the `{endpoint, region}` shape. Writing those settings only to temporary `~/.kiro/settings/cli.json` successfully redirected the next actual run.

Captured `application/x-amz-json-1.0` POSTs had `X-Amz-Target` values `AmazonCodeWhispererService.ListAvailableModels`, `AmazonCodeWhispererStreamingService.GenerateAssistantResponse`, and `AmazonCodeWhispererService.SendTelemetryEvent`. The inference body has `conversationState`, tools and the real test prompt. It is neither Anthropic Messages nor OpenAI Responses. The [upstream client](https://github.com/aws/amazon-q-developer-cli/blob/main/crates/chat-cli/src/api_client/mod.rs) constructs the streaming service explicitly. A native AWS event-stream implementation is still needed for controlled output/tool proof; the endpoint seam itself is demonstrated.

### Amp current custom URL investigation

The installed April binary has `AMP_URL`/`AMP_API_KEY` and no `config model-providers` command. The current [model-routing documentation](https://ampcode.app/docs/customize/model-routing) describes service-managed connections, including custom URLs supporting Responses and Anthropic. To test that current path, the native September build was downloaded into `/tmp/cordyceps-amp-current/amp`, using URLs from the official installer, without running its shell-profile/linking steps. The SHA-256 matched the official checksum: `f74245cbd5ed9e8280434d7d1131d8015224483742e6ef77a35aada676653c13`.

The exact download URLs are derived from `https://static.ampcode.com/cli/cli-version.txt`: version directory `0.0.1790726504-g9299b2`, files `amp-darwin-arm64.gz` and `darwin-arm64-amp.sha256`. This is reproduction metadata, not a version gate. Repeat current-version selection when investigating another build.

Both actual `config model-providers add-router custom-url --personal --api-key-file <test-file> --base-url http://127.0.0.1:<port> --api-format responses|anthropic-messages --model-mapping '*/*'` attempts first sent `checkModelProviderAccess` with `operation: "add"` and `type: "model_provider_custom_url"` to `AMP_URL`. The existing Cordyceps codec rejects this service request. The CLI error is `Unexpected error inside Amp CLI.` No remote connection was created. The evidence does not claim that a remotely stored custom connection can reach the developer machine's loopback address.

### Rovo, Cursor, Auggie and Qodo

Rovo's installed `acli` gates `rovodev run --help` on authentication. The actual prompt and `auth login --email cordyceps-test@example.invalid --token` with stdin test token were also exercised under isolated `ACLI_CONFIG_DIR`. Official [Rovo configuration](https://support.atlassian.com/rovo/docs/manage-rovo-dev-cli-settings/) documents model selection and config-file paths; it does not itself prove a direct provider override. The outcome is limited to the observed authentication gate, not a universal unsupported verdict.

Cursor's [authentication reference](https://docs.cursor.com/en/cli/reference/authentication) documents API keys and a custom endpoint. The installed package source additionally exposes hidden `--endpoint`, `--agent-endpoint`, and `--auth-token` flags, while native RPC types include `agent.v1.GetUsableModelsRequest`. The real API-key request is captured. A denied Keychain read on the separate token attempt is preserved rather than relaxing access to user credentials. The package selects Keychain storage on macOS, so HOME isolation alone is insufficient for that path.

Auggie requires `{accessToken, tenantURL, scopes}` in `AUGMENT_SESSION_AUTH`; omitting `scopes` was a consumer error and was corrected. Its installed help documents session JSON and automated print mode. Installed `@augmentcode/auggie/augment.mjs` exposes `--provider-model`, `--provider-api-key`, and `--provider-base-url`; inspection plus a real second run confirmed these become `third_party_override` in `/chat-stream`, including the chosen local URL and test key. Bootstrap requests include `/get-models`, `/settings/get-mcp-tenant-configs`, `/settings/get-mcp-user-configs`, and `/agents/list-remote-tools`. See the official [CLI product](https://www.augmentcode.com/product/cli) and [authentication example](https://github.com/augmentcode/augment-agent/blob/main/README.md).

Qodo's installed `dist/auth/index.js` defines `QODO_API_BASE_URL`, and `dist/utils/serverData.js` defines `QODO_BASE_URL` and the required `/v2/info/get-things` bootstrap. The actual CLI reaches that path and then exits. Its [official repository](https://github.com/qodo-ai/command) and [CLI docs](https://docs.qodo.ai/qodo-documentation/qodo-gen-cli) identify this package. No additional public provider recipe is bundled for these service protocols until there is a working codec and real text/tool evidence.
