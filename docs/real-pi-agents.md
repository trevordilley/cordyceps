# Real Pi, OMP, Mastra Code, Kimi Code, Prime Agent and ZCode consumers

The consumer in `examples/real-pi-agents/` builds and packs Cordyceps, installs the tarball into a disposable npm project outside the repository, and imports only public `prepare` and `createRegistry`. Recipes are loaded explicitly with `registry.loadFile()`; no bundled registry registration is required. Executable discovery, process launch, tool choices, permissions, Python setup and daemon shutdown are consumer code, not library features.

## Reproduce

Use macOS and real Node 24.15.0 or newer. The example rejects Bun masquerading as Node and fails on other platforms rather than removing its sandbox. OMP 18.4.4 requires Bun >=1.3.14; the observed scratch installation uses Bun 1.4.2. Repository build dependencies must be installed first:

```sh
hivecontrol exec oneshot 3m -- bun install --frozen-lockfile
hivecontrol exec oneshot 6m -- npm install --prefix /tmp/cordyceps-pi-tools \
  --no-audit --no-fund @earendil-works/pi-coding-agent@0.99.1 \
  @oh-my-pi/pi-coding-agent@18.4.4 mastracode@0.43.0 \
  @moonshot-ai/kimi-code@2.1.1 bun@1.4.2
```

Use an actual Node installation first on `PATH` for npm and the example. Dependency installation is a separate developer step, before sandboxed agent execution; the verifier never installs agents or signs in automatically. `install-native.mjs` downloads the pinned official Prime and ZCode artifacts into a supplied scratch directory and verifies their SHA-256 checksums before extracting:

```sh
hivecontrol exec oneshot 3m -- node examples/real-pi-agents/install-native.mjs /tmp/cordyceps-pi-tools
hivecontrol exec oneshot 3m -- uv venv /tmp/cordyceps-pi-tools/prime-venv
hivecontrol exec oneshot 3m -- uv pip install \
  --python /tmp/cordyceps-pi-tools/prime-venv/bin/python \
  /tmp/cordyceps-pi-tools/prime/prime-agent-runtime \
  ipykernel requests httpx PyYAML tomli python-dotenv pandas numpy scipy beautifulsoup4 lxml
```

Prime's released Python runtime requires Python >=3.11; the observed environment is Python 3.12.8. Its own runtime validates the listed default packages. Installing only `ipykernel` and `prime-agent-runtime` produces a genuine tool error, not a fixture-read pass.

Run all candidates and scenarios:

```sh
PATH=/path/to/node24/bin:/tmp/cordyceps-pi-tools/node_modules/.bin:$PATH \
CORDYCEPS_BUN_DIR=/tmp/cordyceps-pi-tools/node_modules/.bin \
PRIME_AGENT_BINARY=/tmp/cordyceps-pi-tools/prime/prime-agent \
PRIME_AGENT_KERNEL_PYTHON=/tmp/cordyceps-pi-tools/prime-venv/bin/python \
ZCODE_BINARY=/tmp/cordyceps-pi-tools/zcode-glm/zcode.cjs \
  hivecontrol exec oneshot 6m -- node examples/real-pi-agents/run.mjs /tmp/pi-agents.json
node examples/real-pi-agents/summarize.mjs /tmp/pi-agents.json /tmp/pi-observations.json
```

After the evidence path, optional positional arguments select comma-separated candidates and scenarios, for example `pi,omp text,tool`. Executable overrides are `PI_BINARY`, `OMP_BINARY`, `MASTRA_CODE_BINARY`, `KIMI_CODE_BINARY`, `PRIME_AGENT_BINARY`, and `ZCODE_BINARY`; otherwise the runner uses `which` (`mastracode` and `kimi` for their respective IDs). Outside DevSwarm use the same commands without `hivecontrol exec oneshot`.

## Isolation and assertions

Every CLI invocation, including its help/version probe and Prime shutdown, runs inside macOS `sandbox-exec`. Outbound IP connections are restricted to loopback. Unix-socket connections are allowed only under the test's private work/config directories. Writes are restricted to those directories and `/dev/null`/`/dev/tty`. Each scenario has a fresh HOME, XDG directories, TMPDIR and empty working directory. The child environment is allowlisted; provider credentials are Cordyceps test keys. No inherited user authentication, live provider traffic, paid calls or global installation is required.

The sandbox uses canonical `/private/tmp` paths. Short paths also keep Prime's daemon/worker Unix sockets below macOS pathname limits. Prime's CLI is a client of its own real local daemon and worker: the consumer invokes `shutdown --force` under the same isolated environment before removing files. Cancellation kills the CLI and shuts down that owned daemon, then requires a captured provider abort. It does not claim that merely closing a Prime client stops its background agent.

Each text case requires the actual prompt in the captured provider request and the controlled marker in CLI stdout. Each tool case creates a fresh UUID token only in `fixture.txt`, verifies its absence from the initial request, returns a tool call using the agent's advertised tool, and requires the token in the **next** provider request's tool result before completing. The consumer writes the fixture but never reads it on behalf of the agent. No remote agent service is replaced with scripted tool execution.

Streaming sends a prefix, holds the provider stream for one second, checks native stdout, then releases a distinct tail. Cancellation holds the actual provider request, terminates the owned runtime, and requires both the route's aborted signal and an aborted response observation. These are fresh-process tests, not native ACP cancellation or same-session reuse. All cases assert provider health, process completion, closed listeners and deleted generated config/work directories. Failures preserve captured evidence and fail the command.

## Observed results

The final consolidated run passed **24 of 24 cases**, with 30 captured provider requests (1/2/1/1 per agent). The committed `evidence.json` contains artifact integrity, installed public package location, executable metadata, argv, native output, compact request projections, response observations, assertions and cleanup. Full native request bodies remain in the emitted local run file; the committed projection retains their hashes and the actual tool results. `sources.json` records npm tarball integrity and official native download/checksum URLs. `observations.json` is the compact projection generated by `summarize.mjs`. Versions are observations rather than compatibility gates.

| Agent | Observed version | Native fixture tool | Text/read | Streaming stdout | Cancellation |
| --- | --- | --- | --- | --- | --- |
| Pi | 0.99.1 | `read({path})` | Pass | Incremental | Pass |
| Oh My Pi | 18.4.4 | `read({path})` | Pass | Incremental | Pass |
| Mastra Code | 0.43.0 | `view({path})` | Pass | Incremental | Pass |
| Kimi Code | 2.1.1 | `Read({path})` | Pass | Buffers until completion | Pass |
| Prime Agent | 0.9.8 | `ipython({code: "print(open(...).read())"})` | Pass | Incremental | CLI kill + owned daemon shutdown |
| ZCode | 0.16.9 | `Read({file_path})` | Pass | Buffers until completion | Pass |

Kimi's `--output-format stream-json` emits complete assistant messages; consumption of provider SSE is established, incremental stdout is not. Mastra lacks a working `--version` in this headless release; the consumer records the installed `mastracode/package.json` version and separately captures its real `--help` output.

## Injection recipes and official sources

Sources were inspected on 2026-09-29 PDT (2026-09-30 UTC), including installed package source and actual CLI probes:

- **Pi:** [`harnesses/pi.json`](../harnesses/pi.json) supplies `PI_CODING_AGENT_DIR` and `models.json` with a custom Chat Completions provider. This is the current `@earendil-works/pi-coding-agent` release; the older `@mariozechner` package was not substituted. Sources: [official repository](https://github.com/earendil-works/pi), [model configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md), installed `dist/config.js` and CLI help.
- **OMP:** [`harnesses/omp.json`](../harnesses/omp.json) uses its supported `PI_CODING_AGENT_DIR` override and `models.yml`. The recipe emits JSON syntax, which is valid YAML and was parsed by the actual release. No legacy migration is needed. Sources: [models](https://github.com/can1357/oh-my-pi/blob/main/docs/models.md), [settings](https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md), installed `@oh-my-pi/pi-utils/src/dirs.ts`. OMP's CLI does not accept Pi's `--no-prompt-templates`/`--no-context-files`; consumer arguments reflect its own flags.
- **Mastra Code:** [`harnesses/mastra-code.json`](../harnesses/mastra-code.json) sets `MASTRA_APP_DATA_DIR` and generates `settings.json` with `customProviders[{name,url,apiKey,models}]`. The headless CLI validates against its gateway-qualified catalog, so the consumer selects `mastracode/cordyceps/cordyceps-model`. `cordyceps/cordyceps-model` alone failed before provider traffic. Sources: [configuration](https://code.mastra.ai/configuration), [headless mode](https://code.mastra.ai/headless), installed `@mastra/code-sdk/dist/{utils/project,onboarding/settings,headless/run-mc,agents/mastracode-gateway}.js`.
- **Kimi Code:** [`harnesses/kimi-code.json`](../harnesses/kimi-code.json) selects a custom `openai` provider in `config.toml` under `KIMI_CODE_HOME`. The tested product is the current TypeScript `@moonshot-ai/kimi-code`, not archived Python `kimi-cli`. Prompt mode already chooses its own noninteractive permissions and rejects `--auto`; the consumer uses its actual supported prompt/output flags. Sources: [provider configuration](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/providers.md), [environment variables](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/env-vars.md), installed `dist/main.mjs`.
- **Prime Agent:** [`harnesses/prime-agent.json`](../harnesses/prime-agent.json) uses `PRIME_AGENT_CODING_AGENT_DIR`, custom `models.json`. The consumer separately writes owned settings disabling telemetry/retries. The actual model-facing native tool executes Python in the released `prime-agent-runtime`; no substitute shell handler is installed. Sources: [official installer](https://app.primeintellect.ai/prime-agent/install.sh), [repository](https://github.com/PrimeIntellect-ai/prime-agent), and the 0.9.8 archive's `docs/{models,usage,settings}.md` and `prime-agent-runtime/pyproject.toml`.
- **ZCode:** [`harnesses/zcode.json`](../harnesses/zcode.json) writes native Personal Provider Config schema version 1 with a `standard-personal` Chat Completions provider, test API key, and default model selection. `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` selects that file. The official [source](https://github.com/zai-org/ZCode/tree/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli) and [3.14.3 desktop component manifest](https://cdn-zcode.z.ai/zcode/electron/releases/3.14.3/manifest-darwin-arm64.json) identify the first-party runtime. The manifest's component label is `v0.13.3+464dc03681ff`, while the downloaded CLI reports `0.16.9`; both observations are retained. The desktop component omits the catalog needed by standalone CLI mode. The setup helper supplies the unmodified `config/provider/zcode-builtin.json` from that pinned official commit, also checking its hash. Download the exact artifact and verify its hash instead of inferring the executable version from that label. Literal `+` in the CDN path returns 404; `%2B` succeeds. No community compatibility patches or desktop account are used. In the sandbox, its optional built-in catalog refresh reports `invalid response`; the local catalog and explicitly selected personal provider still complete every asserted workflow. The diagnostic is preserved in stderr, not hidden or replaced by a fabricated service.

All verified candidates use the existing `openai-chat-completions` codec. No library launch logic, provider emulation beyond model responses, or codec changes were needed. The six data recipes are selectable through the default registry; the consumer also demonstrates loading the same definitions privately.

## Orchestrator identity mapping

The source roster was checked against [Superset 3049a31](https://github.com/superset-sh/superset/blob/3049a3114bd1ae48b944aae3e4cafdb0f521d1a5/packages/shared/src/builtin-terminal-agents.ts) and [Orca 9803967](https://github.com/stablyai/orca/blob/98039676f363d6f0c06dbed25f3180463e5952af/src/shared/tui-agent-config.ts). Superset's `mastracode` and `kimi` IDs map here to recipe IDs `mastra-code` and `kimi-code`; `pi`, `omp`, `prime-agent` and `zcode` retain those names. The actual launchers are `pi`, `omp`, `mastracode`, `kimi`, `prime-agent`, and the official `zcode.cjs`. These tests establish the agents' native headless workflows, not a Superset/Orca UI or terminal lifecycle test. No additional identities are inferred from a shared Pi ancestry.
