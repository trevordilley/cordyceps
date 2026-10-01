# Real additional vendor agents

This investigation uses authentic current vendor distributions, not similarly named npm projects. Each verified entry requires a built and packed Cordyceps artifact installed into a disposable consumer outside the repository, public `cordyceps` imports, a captured controlled-text prompt and matching native output, and a fresh file-only random token returned by the actual agent's read tool in a later provider request. Native processes run under macOS `sandbox-exec` with outbound networking restricted to loopback, scratch HOME/XDG directories, no inherited provider credentials, denied Keychain service access, and writes confined to owned temporary directories. No paid inference, real login, user configuration change, publication or review is involved.

## Identity and distribution

MiniMax here means the official **MiniMax Code `mcode`** distribution, not the `mmx-cli` media client. TRAE CN uses `traecli`; the unrelated `bytedance/trae-agent` installs `trae-cli`.

| Agent | Actual distribution observed | Result |
| --- | --- | --- |
| Grok Build | `grok` 1.0.44, x.ai official native macOS arm64 download | Text and real `read_file` verified. |
| Muse Code | `muse` 1.4.1-R4503.1, Meta native macOS arm64 artifact | Text and real namespaced `muse.read_file` verified. |
| Devin CLI | `devin` 3000.11.3 (`9c803229faa4`), official native release bundle | Excluded: service bootstrap reached, no controlled model/text/read proof. |
| fx | `fx` 0.0.11, vercel-labs/fx official release CDN | Text and real `read_file` verified. |
| Ante | `ante` 0.2.6, Antigma official stable native release | Text and real `Read` verified. |
| MiniMax Code | `@minimax-ai/code` 0.5.9, `mcode` | Text and real `read` verified. |
| TRAE CN CLI | Official `traecli` installer URLs | Excluded: both official download entry points return HTTP 403; the prior installer explicitly reports `denied by region block`. No substitute binary tested. |

[Distribution receipts](../examples/real-vendor-agents/distribution-evidence.json) record exact URLs and SHA-256 values. Ante and Devin archive checksums matched their official manifests; Muse's downloaded binary matched both official size and checksum. Grok and fx hashes identify the downloaded artifacts but were not checked against separately advertised vendor checksums. `AntigmaLabs/ante-preview` redirects to the current official [AntigmaLabs/ante](https://github.com/AntigmaLabs/ante) repository; the distribution is from its documented `ante.run`/`download.ante.run` installer channel.

## Reproduce

Use macOS arm64, Python 3 with tarfile's `filter='data'` support, Bun, npm, and actual Node 22+ first on PATH. The library does not install, discover or launch executables; the following are consumer examples.

```sh
bun install --frozen-lockfile
python3 examples/real-vendor-agents/install.py /tmp/cordyceps-vendor-investigation
node examples/real-vendor-agents/run.mjs /tmp/cordyceps-vendors.json fx,ante,grok-build,minimax,muse
node examples/real-vendor-agents/diagnose-devin.mjs /tmp/cordyceps-devin.json
```

The installer resolves current public channel manifests and downloads binaries directly; it does not execute vendor install scripts or modify shell startup files. `--agents fx,ante` selects downloads. Set `CORDYCEPS_VENDOR_BIN_DIR` for a different scratch installation root; `CORDYCEPS_DEVIN_BINARY` overrides the diagnostic binary. `probe.mjs <output.json> <comma-separated agents>` records isolated native version/help output. The validation command builds, packs and offline-installs Cordyceps, copies the consumer into that independent directory, loads distinct recipes with `createRegistry({builtins:false}).loadFile()`, and asserts every selected case. Failure exits nonzero. The Devin command is explicitly diagnostic: successful collection is not an agent support pass.

The recipes select the native mode and inject the provider endpoint, model and test credentials. Permission choices belong to the consumer: this sandboxed fixture explicitly adds fx `--auto`, Grok `--always-approve`, MiniMax `--permission full`, and Muse `--yolo`. The consumer also supplies Ante's skill/memory/session switches, Grok's subagent/web-search switches and telemetry environment, and Muse's session-log switch. For Grok it appends `[cli] use_leader = false` to its disposable generated configuration to keep this fixture to one agent. These settings limit or enable behavior for this test; they are not public recipe defaults. The final argument order is preserved, including adjacency between Ante/Grok prompt flags and their prompt values.

The [committed verification receipt](../examples/real-vendor-agents/verified-evidence.json) contains all ten passing cases, native commands/output, artifact integrity, request-body hashes, fixture tokens and native tool results. The full evidence is emitted to the requested output path; its SHA-256 is retained in the receipt. Regenerate a compact receipt with `node examples/real-vendor-agents/summarize.mjs <full.json> <receipt.json>`.

The vendor branch's final regression command was `sh -c 'bun run check && bun test tests && bun run test:node'`, with Node 22 first on PATH. TypeScript passed; Bun 1.3.13 passed 141 tests with 1,014 assertions and the two existing disconnect tests skipped on Bun; all 21 Node lifecycle tests passed, including both disconnect cases. These branch-local counts precede integration with other new agent recipes.

## Injection details and boundaries

**Grok Build.** The [official custom-model workflow](https://docs.x.ai/build/overview) and [settings reference](https://docs.x.ai/build/settings) define `$GROK_HOME/config.toml`, `[model.<id>]`, `base_url`, `env_key`, and `api_backend`. The recipe registers a named local Chat Completions model, isolates `GROK_HOME`, and uses test `XAI_API_KEY`. The downloaded binary contains the same custom-model documentation. [Headless mode](https://docs.x.ai/build/cli/headless-scripting) uses `-p` and `--model`. A real `GET /` origin prewarm originally made `assertHealthy()` fail even though the CLI printed the controlled marker. The narrow `grok-build` codec now captures that exact request and requires an explicit `{health:true}` response; the normal model requests delegate to Chat Completions. Other unknown routes still fail. `read_file` takes `target_file`, not `path`.

The first release gate also observed Grok 1.0.46 making a separate, tool-free
dashboard-summary request after the verified reply. The consumer explicitly
handles that request only after completing the main turn and matching its
summary prompt and original reply. The real file-read assertion remains required
before the main tool turn can complete.

**fx.** The [Vercel repository](https://github.com/vercel-labs/fx) points to `https://fx.sh/setup.sh`. Its current installer resolves `https://releases.fx.sh/latest.txt` and the native archive. [Custom model connections](https://fx.sh/docs/configure-fx/custom-model-connections) specify `~/.fx/settings.json`: named `providers`, `protocol: openai-chat-completions`, `base_url`, bearer auth from an environment variable, per-provider model selection and optional model limits. The recipe writes that file under a session-owned HOME. The consumer uses `fx ask` and validates real `read_file` execution.

**Ante.** The [official catalog reference](https://docs.antigma.ai/reference/catalog-reference) describes `$ANTE_HOME/catalog.json`, `wire_style: OpenAiCompatible`, `base_url`, bearer `env_key`, and `preferred_models`. The recipe selects this provider/model; the consumer uses native headless `--prompt`. No account or hosted orchestration is needed. The actual `Read` tool receives the disposable absolute `file_path` and returns its unpredictable contents.

**MiniMax Code.** The [official installation guide](https://github.com/MiniMax-AI/minimax-code/blob/main/docs/installation.md) identifies `@minimax-ai/code` and `mcode`. Its [custom provider examples](https://github.com/MiniMax-AI/minimax-code/blob/main/docs/examples.md) define `custom_provider` in the active profile's `config.yaml`. Current 0.5.9 uses model selectors such as `custom_provider:cordyceps/fixture-model`. The recipe writes JSON syntax, accepted by its YAML parser, into `.minimax/config.yaml` under a session-owned HOME. It uses the native Anthropic-compatible client and existing token-count codec; the consumer explicitly scripts `inputTokens:100` for observed count requests. This is a fixture count, not a tokenizer claim. Native `read` uses `path`.

**Muse Code.** The [official installation and headless documentation](https://dev.meta.ai/docs/muse-code) identifies Meta's `muse`, its own native binary and `muse exec`. Its [configuration documentation](https://dev.meta.ai/docs/muse-code/configuration) explains separate headless and TUI flag sets. Native `exec --help` documents `--provider meta`, `--base-url`, `--model`, and test-key injection through `META_API_KEY`; the `echo` provider is not used. The real binary first fetches `GET /muse-code/models`, then POSTs to `/v1/responses`. The `muse-code` codec recognizes only that catalog bootstrap in addition to Responses and requires explicit JSON-object metadata. The consumer supplies the catalog; no catalog/account state is implicit in the library.

Muse sends functions inside a Responses `namespace` tool declaration. The earlier decoder silently omitted them. Responses now preserves `ToolDefinition.namespace`, and optional `ToolCall.namespace` survives event snapshotting and appears in native function-call output items, including streaming add/done/completed events. Ordinary unnamespaced tools retain their existing shape; other provider codecs reject a namespaced scripted call rather than silently drop its namespace. The real harness also issues separate background-observer model calls offering `submit_reminder_decision`; the consumer distinguishes their offered tools and scripts explicit provider replies. This controls actual model requests while leaving the agent's orchestration and file tools intact.

[Devin diagnostic receipts](../examples/real-vendor-agents/devin-diagnostic.json) retain native output and exact protobuf request bytes.

## Exclusions with exact diagnostics

**Devin.** [Official installation](https://docs.devin.ai/cli/index) selects `https://cli.devin.ai/install.sh`; that script selects the checksum-backed manifest at `https://static.devin.ai/cli/current/manifest.json`. [Authentication documentation](https://docs.devin.ai/cli/enterprise/devin-auth) locates `credentials.toml` at `$XDG_DATA_HOME/devin/credentials.toml`. The empty-HOME attempt exits 1 with `Error: Login canceled` and no provider traffic. A scratch credentials file with test-only `windsurf_api_key`, `api_server_url`, `devin_api_url` and `devin_webapp_host` pointing to loopback crosses that initial gate. It reaches native protobuf service paths including `GetUserStatus`, `GetCliModelConfigs`, `GetCliTeamSettings` and `/v3/self`, then exits 1 with `Error: failed to start ACP agent session` when the diagnostic collector returns explicit 404s. The collector records original request bytes as base64 and does not fabricate account entitlement, model assignments, or remote agent actions. No locally injectable model protocol was established; no Devin recipe is supplied. This is a bounded unresolved service/bootstrap limit, not a claim that every future or authorized Devin deployment is impossible.

**TRAE CN.** The [official quickstart](https://docs.trae.cn/cli_get-started-with-trae-code-cli-2) names `traecli`. The current v2 installer `https://trae.cn/trae-cli/install_v2.sh` and prior official `https://trae.cn/trae-cli/install.sh` both returned HTTP 403 from this host. The prior installer explicitly reports `denied by region block`; the v2 response is a generic CDN 403 without a stated reason. Exact bodies and headers are retained in the distribution receipt. We did not replace it with the unrelated open-source `trae-agent` or a name-matching npm package. No authentic binary execution, model control or tool success is claimed, and no recipe is supplied.

The verified cases establish text and native file-read workflows on these observed macOS distributions only. They do not establish incremental terminal streaming, cancellation, ACP lifecycles, remote session orchestration, Windows/WSL support, or account authentication. The verifiers reap owned process groups before disposing listeners/config files and remove their scratch workspaces and package installation.
