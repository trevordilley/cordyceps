# Genuine CodeBuddy and Qoder source identities

Scope authority is the read-only Orca checkout at commit
`98039676f363d6f0c06dbed25f3180463e5952af`, specifically
`src/shared/tui-agent-config.ts`, `codebuddy-agent.test.ts`,
`qoder-agent.test.ts`, `agent-node-package-entrypoints.ts`, and the reference
pages `docs/reference/codebuddy-harness.md` and `qoder-integration.md`.
CodeBuddy's executable identities are `codebuddy` / `cbc`; Qoder's is
`qodercli` (including versioned native binaries). Qoder is not Qodo, and no Qodo
package, diagnostic or result is used here.

Official distribution and configuration sources:

- [CodeBuddy installation](https://www.codebuddy.ai/docs/cli/quickstart) names
  `@tencent-ai/codebuddy-code`.
  [CLI reference](https://www.codebuddy.ai/docs/cli/reference) documents both aliases
  and print mode. [Environment reference](https://www.codebuddy.ai/docs/cli/env-vars)
  documents `CODEBUDDY_BASE_URL`, `CODEBUDDY_API_KEY`, and model overrides for an
  Anthropic-compatible endpoint.
- [Qoder installation](https://docs.qoder.com/cli/installation) names
  `@qoder-ai/qodercli`. Its actual npm manifest exports `qodercli` and a separate
  `qoder` dispatcher. This consumer uses `qodercli` exactly.
  [Qoder's official changelog repository](https://github.com/QoderAI/changelog-CLI)
  also documents the `qodercli` executable.
- [Qoder custom models](https://docs.qoder.com/cli/custom-models) directs users to
  the `/model` Custom wizard and says provider/model/credential options depend on
  the account's BYOK catalog; it explicitly advises against hand-configuring
  BYOK in `settings.json`.
  [Settings reference](https://docs.qoder.com/cli/settings-reference) documents
  `QODER_PERSONAL_ACCESS_TOKEN`, `QODER_CONFIG_DIR`, and `QODER_MODEL`.
  [Network configuration](https://docs.qoder.com/cli/network) documents HTTP(S)
  proxies. A proxy is not a local model endpoint override.

## Observed results

[Recorded evidence](../examples/real-source-agents/codebuddy-qoder/evidence.json)
contains four successful CodeBuddy cases and three successful **boundary
assertions**, not Qoder workflow passes. The run used Node 22.22.3 on macOS and
installed the packed Cordyceps 0.1.0 tarball outside the repository.

| Identity | Release | Text | Actual fixture read |
| --- | --- | --- | --- |
| `codebuddy` | 2.160.0 | Pass, one captured request and controlled native output | Pass, two requests; real `Read` token in request two |
| `cbc` (same official executable) | 2.160.0 | Pass, one captured request and controlled native output | Pass, two requests; real `Read` token in request two |
| `qodercli` | 1.1.64 | Unsupported under the isolated account-free constraints below | Not reached; no success recipe |

For the observed CodeBuddy release, the working injection is
`CODEBUDDY_BASE_URL=${mock.baseUrl}/v1` plus the test key and model overrides in
[the local recipe](../examples/real-source-agents/codebuddy-qoder/codebuddy.json).
It sends **OpenAI Chat Completions** to `/v1/chat/completions`, despite using a
Claude model name. The consumer selects the existing `openai-chat-completions`
codec. The initial Anthropic codec attempt and then a base URL without `/v1`
failed visibly; neither counts as a pass. No library changes were necessary.

The verified command is `--print --dangerously-skip-permissions --output-format
stream-json --verbose <prompt>`. All six successful provider requests requested
streaming. These results establish text and read workflows, not incremental
native-output timing, cancellation, interactive UI, ACP or other platforms.
Both aliases belong to one CodeBuddy family.

## Reproduction

Use real Node >=22, npm, Bun and macOS `sandbox-exec`. Install dependencies into
scratch, without changing the normal user's configuration:

```sh
hivecontrol exec oneshot 5m -- /bin/zsh -c '
  mkdir -p /tmp/cordyceps-codebuddy-qoder-deps/home
  export HOME=/tmp/cordyceps-codebuddy-qoder-deps/home
  npm install --prefix /tmp/cordyceps-codebuddy-qoder-deps --no-audit --no-fund \
    @tencent-ai/codebuddy-code@2.160.0 @qoder-ai/qodercli@1.1.64
'
hivecontrol exec oneshot 5m -- bun install --frozen-lockfile
hivecontrol exec oneshot 6m -- node \
  examples/real-source-agents/codebuddy-qoder/run.mjs \
  /tmp/cordyceps-codebuddy-qoder-evidence.json \
  /tmp/cordyceps-codebuddy-qoder-deps
```

The driver builds and packs Cordyceps, installs the tarball into a disposable
consumer outside the repository, and copies the consumer files there. The
consumer uses only public `cordyceps` imports. Distribution versions, bin maps,
registry URLs/integrities and packed Cordyceps integrity are recorded with the
resolved installed package entry.

Each executable case has a fresh HOME and working directory, an allowlisted
child environment and test-only keys. `sandbox-exec` restricts outbound traffic
to loopback and writes to the case's owned scratch root (plus `/dev/null` and
`/dev/tty`). No inherited provider credentials or user settings are passed.
The verifier kills process groups, closes listeners, removes scratch roots,
and checks cleanup. Package installation downloads official distributions;
agent execution cannot contact paid providers.

The CodeBuddy recipe is consumer-local. It is not a library registry entry;
Cordyceps still injects provider configuration only. Binary discovery,
installation, process launch, sandboxing and assertions belong to the consumer.
The tool case scripts a native `Read` call, never a tool result: its random
fixture token must be absent from the initial provider request and appear in
the immediately following provider request. Both provider exchanges and actual
native stdout/stderr are retained separately.

Qoder diagnostic probes reject outbound proxy connections with HTTP 502. They
never synthesize authentication, entitlements, model catalogs, remote-agent
choices or tool results. Diagnostics do not count as successful text/read
workflows and there is no Qoder success recipe.

## Qoder 1.1.64 boundary

Three real `qodercli` probes establish a boundary before model inference:

| Configuration | Native observation | Local model traffic |
| --- | --- | --- |
| Fresh HOME, no credential | Exit 1; `authentication_failed`; “Not logged in · Please run /login”; result `is_error: true`, zero input/output tokens | None |
| Test-only `QODER_PERSONAL_ACCESS_TOKEN` | Exit 1; stack enters `exchangePersonalToken` and `loginWithPAT`; proxy refuses `openapi.qoder.sh:443` | None |
| Scratch `modelConfigs.customModels`, explicit `--model cordyceps/local`, test key and loopback baseURL | Same native login failure despite selecting the local model | Zero requests to the configured local endpoint |

The additional settings probe tests the parser actually present in the shipped
bundle; it is a diagnostic, not a recommendation to disregard the current BYOK
documentation. The bundle's `getSettingsBYOKModels()` contributes settings models
to the runtime catalog, while local custom-provider enablement checks
`isAuthenticated()` and rejects service-account identity. Its custom-provider
access controller also calls `getUserStatus()`. These source observations support
the native failure evidence; they do not substitute for a model exchange.

The bundle also contains `QODER_SDK_CUSTOM_BASE_URL_BYOK` and an SDK-specific
startup branch. That branch is not evidence that the source-roster CLI's print
mode accepts unauthenticated local models, and SDK/ACP/interactive wizard
success is not claimed. The result is specifically **unsupported for this
account-free, isolated CLI text/read workflow on 1.1.64**, not a claim that Qoder
lacks BYOK generally. No user login, UID, encrypted model cache, account
entitlement or remote model decision was supplied or fabricated.

The native Qoder error record labels its own model `<synthetic>`; that string
comes directly from Qoder's authentication-error output. It is not a response
created by this test. Similarly, its result subtype says `success` while
`is_error` is true and the process exits 1; the verifier checks the error fields
rather than treating that subtype as a pass.
