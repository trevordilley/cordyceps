# Codex endpoint probe

Observed on macOS, 2026-09-29, with installed `codex-cli 0.155.1`.

Reproduce:

```sh
hivecontrol exec oneshot 90s -- node experiments/codex-endpoint.mjs /Users/20idemo/.local/bin/codex
```

The probe starts two loopback HTTP servers, supplies a dummy API key, and runs
the real `codex exec` binary with fresh temporary HOME and CODEX_HOME directories.
It does not read the user's config or credentials. HTTP(S) proxy settings point
at the local server to block unintended external requests; it is not a tunnel.
Temporary directories and servers are removed afterwards.

| Case | Observed result |
| --- | --- |
| Only `OPENAI_BASE_URL` supplies the endpoint | Neither mock received a request. Diagnostics named `wss://api.openai.com/v1/responses`; the local proxy blocked the connection. Process killed after the 20-second bound. |
| `openai_base_url` in temporary config, with a conflicting `OPENAI_BASE_URL` | Config endpoint received seven WebSocket-attempt GETs, then POST `/v1/responses`. Codex printed `MOCK_REPLY_CONFIG`, completed the turn, and exited 0. |
| Selected custom provider with `base_url`, `wire_api = "responses"`, and `env_key = "OPENAI_API_KEY"`, plus conflicting `OPENAI_BASE_URL` | Config endpoint received POST `/v1/responses`. Codex printed `MOCK_REPLY_CONFIG`, completed the turn, and exited 0. |

The script intentionally exits nonzero when the first hypothesis (environment-only
redirection) fails. That is an observed negative result, not an implemented library test.

For this build, Cordyceps should prepare a session-specific config and supply its
location through the child environment's CODEX_HOME. This can preserve the consuming
application's binary invocation while configuring the endpoint without a wrapper.
Moving CODEX_HOME also changes config/state discovery; preserving selected settings
and normal permission behavior requires adapter design and separate validation.

The mock supplies a minimal Responses API event stream with assistant text. The
built-in provider attempts WebSockets before falling back to HTTP streaming; the
tested custom provider went directly to HTTP streaming. A production mock needs an
explicit transport policy. No interactive, tool execution, app-server, ChatGPT-login,
Windows, or full application integration path was tested here. Results are specific
to this installed version and API-key authentication.

Official documentation independently describes `openai_base_url`, custom providers,
and the CODEX_HOME config/state location:
[Advanced Configuration](https://learn.chatgpt.com/docs/config-file/config-advanced).
