# Real ACP consumer against the packed artifact

`examples/real-acp` runs a real ACP client and adapter against Cordyceps' local
Anthropic provider. Only provider HTTP responses are scripted. The consumer
launches the adapter, owns its process group, negotiates ACP, implements permission
and filesystem handlers, records native JSON-RPC, and checks completion.

## Run

Use macOS with `/usr/bin/sandbox-exec`, real Node 22 or newer, npm, and Bun 1.3.13 (repository build tooling). From the
repository after `bun install --frozen-lockfile`:

```sh
node examples/real-acp/verify.mjs
# Equivalent repository script:
npm run test:real-acp
```

Inside DevSwarm, run the bounded command through its process tracker:

```sh
hivecontrol exec oneshot 5m -- node examples/real-acp/verify.mjs
```

The script rejects Bun-backed `node` shims. If necessary, use the absolute path to
a real Node binary; the bootstrap prepends that binary's directory to its child
PATH. It builds the repository, runs `npm pack`, copies the locked example into a
temporary consumer directory, installs its dependencies and the tarball, runs the
scenario, and removes the directory. It never imports `src/` or a workspace link.
No global adapter install or real provider account is needed. npm needs network
access on an uncached install; the provider endpoint used during the scenario is
loopback.

For native/provider evidence, set an absolute output directory:

```sh
ACP_EVIDENCE_DIR=/tmp/my-acp-evidence node examples/real-acp/verify.mjs
```

`native.json` contains complete directional JSON-RPC payloads and separate
observer metadata. `provider.json` contains the actual HTTP requests/responses.
These are separate observations, with separate IDs. Evidence includes temporary
paths, synthetic local credentials, and disposable fixture contents; it is not
committed. Failed runs also save evidence after stopping the adapter.

## Pinned integration and configuration

The consumer pins `@agentclientprotocol/claude-agent-acp` **0.84.0** and
`@agentclientprotocol/sdk` **1.5.1**, with transitive Claude Agent SDK **0.3.284**.
The adapter is the current successor to `@zed-industries/claude-code-acp`; it
ships the platform-specific Claude native executable through its SDK dependency.
The scenario uses the ACP SDK's current `client().onRequest().onNotification()`
API and `ndJsonStream`, over real child-process stdio.

The `claude-code-acp` registry definition provides `ANTHROPIC_BASE_URL`, a synthetic
`ANTHROPIC_API_KEY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and a temporary
`CLAUDE_CONFIG_DIR`. Its only mode is `acp`, with no adapter CLI arguments. This is
a launch-injection recipe, not an executable selector or ACP implementation.
The existing `claude-code` and `codex` definitions do not acquire an ACP mode.

The example additionally uses a minimal child environment, disposable HOME/config and cwd, and an outer macOS sandbox allowing network access only to the actual mock port. It fails explicitly on other platforms. It
passes `settingSources: []` through the adapter's `_meta.claudeCode.options`, and
selects `claude-sonnet-4-6` with the documented `--bare` mode through SDK
`extraArgs`. No user configuration or authentication is edited or
copied. The adapter receives its SDK options through `session/new`; adding Claude
CLI flags to the adapter's own command line is not equivalent. Machine-managed
policies can still affect the real harness; this example does not override them.

Official references consulted on 2026-09-29:

- [Adapter repository and current package name](https://github.com/agentclientprotocol/claude-agent-acp).
- [ACP TypeScript client migration and current API](https://github.com/agentclientprotocol/typescript-sdk/blob/main/MIGRATION_0.26_0.27.md).
- [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup).
- [Claude CLI configuration flags](https://code.claude.com/docs/en/cli-reference).
- [Anthropic token-count endpoint](https://platform.claude.com/docs/en/api/messages/count_tokens).

## Assertions and interpretation

The scenario performs eight real prompt turns across two independently created
sessions on one real adapter connection:

1. Initialize and inspect the returned protocol version, agent identity, and
   capabilities. It does not fabricate a handshake or claim that every advertised
   capability has been tested.
2. Complete a text turn, then a followup whose actual model request contains the
   earlier prompt and assistant reply.
3. Prompt the other session and check that neither its provider history nor its
   client text contains the first session's marker/reply.
4. Gate a provider stream between two segments. Observe native assistant text
   before releasing the gate, while `session/prompt` is still pending. Assert the
   final combined text after completion, without equating provider chunk sizes
   and ACP notification boundaries.
5. Inspect the actual offered `Read` schema, return its tool call, approve the
   actual ACP permission request using its offered `allow_once` option, and
   require the next model request to contain the randomly generated contents of
   a real disposable file outside the session cwd. Assert native tool-call and
   completion updates. This adapter executes `Read` inside Claude; its negotiated
   client `fs/read_text_file` handler is available but was not invoked in this
   version. Permission handling is consumer-owned.
6. In the second session, choose the real offered `reject_once` option for another
   disposable file. Require the next model request to contain a tool error, not
   that file's secret contents, and complete the turn normally.
7. Hold an actual provider request, notify `session/cancel`, require the original
   prompt response to say `cancelled`, and separately observe provider abort.
8. Reuse the same session for another completed prompt. The adapter process stays
   alive through turn completion.

Every outbound prompt is captured as consumer input. The transparent stream taps
record complete incoming/outgoing native payloads without adding fields to them.
The scenario compares these snapshots with independently collected transport
payloads and correlates each prompt response to its actual JSON-RPC request ID.
`end_turn`, `cancelled`, HTTP abort, tool completion, and process exit are checked
as distinct events.

The real adapter also sends `HEAD /api/hello` and
`POST /v1/messages/count_tokens?beta=true`. Routes explicitly return `{ health:
true }` and `{ inputTokens: 32 }` for those exact endpoints. The token count is a
scripted fixture, not a tokenizer estimate. These requests remain observable and
subject to the normal health checks. Routes are installed before session creation
because probes begin during `session/new`. One observed count request was
`{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"foo"}],"tools":[]}`;
its scripted HTTP response was `{"input_tokens":32}`.

Background model requests can occur independently of a user turn. The example
responds explicitly to tool-less auxiliary prompts and scripts the main turns
only when the actual request offers `Read`. It does not assume that every request
is a new user prompt or rely on one global HTTP request count.

Cleanup releases the stream gate, closes the ACP connection, terminates the
consumer-owned process group (with a bounded force-kill fallback), checks provider
health including shutdown traffic, disposes Cordyceps, and removes the files.
The process-group cleanup and network policy here target macOS; other operating systems have not been verified. This is one pinned integration example, not a harness or
ACP conformance certification, and it does not test load/resume, every advertised
capability, malformed ACP frames, or real hosted-model behavior.

## Verification record

Verified on 2026-09-29, macOS arm64, real Node **22.22.3**, with the versions above
and a freshly built and installed `cordyceps-0.1.0.tgz`. The run completed all
eight turns, negotiated ACP **1**, returned two distinct session IDs, and invoked
two permission callbacks. A representative run captured **29** provider requests
and **65** native messages; these totals can change with auxiliary activity and
are reported rather than enforced. Both the cancellation response and subsequent
reuse completed, and provider health passed after adapter shutdown.

The initial current-adapter experiment exposed unsupported health/token-count
requests. Explicit Anthropic codec response variants resolved those failures; no
health check was skipped. The consumer itself found no further library API gap.
