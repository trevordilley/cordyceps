# Five real provider-injected agents

`examples/real-provider-agents/run.mjs` builds and packs Cordyceps, installs that tarball in a disposable npm project, and copies the consumer outside this repository. That consumer uses only public `prepare` and `createRegistry` imports. It loads the five JSON recipes explicitly, so this example does not depend on their being added to the bundled registry loader.

The observed macOS binaries are GitHub Copilot CLI 1.0.88, Goose 1.27.2, Factory Droid 0.112.0, OpenCode 1.18.33 and Crush 0.97.1. These are observations, not fixed support gates. Real Node 22.22.3 runs the consumer; the program rejects Bun's `node` shim. All five use the existing `anthropic-messages` codec without library changes.

## Reproduce

Install repository dependencies with `bun install --frozen-lockfile`. Use your installed binaries or install missing tools into a disposable npm project. The observed missing tools were obtained with:

```sh
PATH=/Users/20idemo/.nvm/versions/node/v22.22.3/bin:$PATH \
  hivecontrol exec oneshot 5m -- npm install \
  --prefix /tmp/cordyceps-provider-tools --no-audit --no-fund \
  opencode-ai @charmland/crush
```

Run from the repository root, substituting real executable paths on your machine:

```sh
PATH=/Users/20idemo/.nvm/versions/node/v22.22.3/bin:$PATH \
COPILOT_BINARY=/opt/homebrew/bin/copilot \
GOOSE_BINARY=/Users/20idemo/.local/bin/goose \
DROID_BINARY=/Users/20idemo/.local/bin/droid \
OPENCODE_BINARY=/tmp/cordyceps-provider-tools/node_modules/.bin/opencode \
CRUSH_BINARY=/tmp/cordyceps-provider-tools/node_modules/@charmland/crush/bin/crush \
  hivecontrol exec oneshot 6m -- node examples/real-provider-agents/run.mjs \
  /tmp/cordyceps-provider-evidence.json
```

Arguments after the evidence path optionally select comma-separated agent IDs and scenarios, for example `goose,crush text,tool`. Defaults run all five agents with `text,tool,stream,cancel`. If an executable environment override is absent, the runner uses `which`; it never installs anything implicitly. Outside DevSwarm invoke the same Node command directly. npm installation is a developer step before the isolated agent processes run.

Every agent invocation, including its version probe, uses macOS `sandbox-exec` with outbound network restricted to loopback and filesystem writes restricted to its disposable home/work area and Cordyceps-owned configuration directory. Its environment is allowlisted; it receives test-only credentials, isolated HOME/XDG/TMPDIR paths and dead external proxy endpoints. The example fails on other platforms instead of dropping the sandbox. There are no live provider calls, changes to user authentication/configuration, or npm publishing. Process groups close before the mock and disposable files are removed.

## Actual assertions

The final run passed all 20 scenarios. [Structured per-agent observations](../examples/real-provider-agents/observations.json) can be regenerated with `node examples/real-provider-agents/summarize.mjs`.

The committed [evidence](../examples/real-provider-agents/evidence.json) records the tarball integrity, Node runtime, exact binary paths/versions, argv, stdout/stderr, captured provider requests and responses, assertions and cleanup for every case.

| Agent | Controlled text | Actual disposable fixture tool | Incremental output | Process cancellation |
| --- | --- | --- | --- | --- |
| Copilot | Passed | `view({path})` | Passed | Passed |
| Goose | Passed | `shell({command: "/bin/cat …", timeout_secs: 5})` | Passed | Passed |
| Droid | Passed | `Read({file_path})` | Buffered until completion | Passed |
| OpenCode | Passed | `read({filePath})` | Buffered until completion | Passed |
| Crush | Passed | `view({file_path})` | Passed | Passed |

Text cases require the actual prompt in a captured request and the controlled response in the real binary's output. Tool cases create a fresh unpredictable fixture token, assert it is absent from the first prompt request, emit a tool call using an actual advertised tool, and require the token in the actual next prompt request's successful tool result. The consumer never reads the fixture on behalf of a tool. Goose and Crush generate separate title requests; those receive an explicit title reply and cannot satisfy the main prompt assertions.

Streaming cases require a native streaming request, send a prefix, leave the response unfinished for one second, record whether the prefix is already visible in binary stdout, then send and assert a distinct tail. All five consume the streamed reply successfully. Copilot, Goose and Crush show incremental text. Droid `stream-json` and OpenCode `--format json` buffer assistant text until completion; their evidence records `incrementalNativeOutput: false`, not a skipped or fabricated incremental pass. Inspection found Droid routes `debug` through the same completed-message emitter, while [OpenCode's CLI source](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts) prints text only after the part has an end timestamp in both JSON and default formats. Incremental TUI/ACP alternatives are outside this example. Cancellation cases hold the actual main provider request, terminate the consumer-owned process group with SIGKILL, and require both the route's abort signal and an aborted provider response observation. This establishes process-disconnect cancellation; it does not claim native TUI/ACP cancellation, graceful interruption, or same-session reuse. Each scenario starts fresh. All cases assert closed listeners and removed generated configuration/work directories.

## Recipes and observed setup details

- **Copilot:** [`harnesses/copilot.json`](../harnesses/copilot.json) selects Anthropic BYOK through `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_BASE_URL` and `COPILOT_PROVIDER_API_KEY`, and removes competing key-command/bearer/header and GitHub credentials. The consumer selects the model and prompt mode, disables built-in MCPs, custom instructions and auto-update, and grants tools permission inside the outer sandbox. Source: installed `copilot help providers` and [GitHub's BYOK documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models).
- **Goose:** [`harnesses/goose.json`](../harnesses/goose.json) sets `GOOSE_PROVIDER=anthropic`, `ANTHROPIC_HOST`, `ANTHROPIC_API_KEY`, disables keyring use and places Goose state under `GOOSE_PATH_ROOT` in the owned session directory. The consumer uses `run --no-profile --no-session --with-builtin developer --max-turns 3 --output-format stream-json`, chooses a model and grants automatic tool permission. This installed developer extension advertises `shell`, not `developer__shell`; the example follows the captured schema. Sources: [provider reference](https://github.com/aaif-goose/goose/blob/main/documentation/docs/getting-started/providers.md), [test-environment isolation](https://github.com/aaif-goose/goose/blob/main/CONTRIBUTING.md), installed `goose run --help`.
- **Droid:** [`harnesses/droid.json`](../harnesses/droid.json) generates runtime `customModels` settings and supplies them with `exec --settings`. It also supplies a test-only `FACTORY_API_KEY`, disables keyring use/auto-update, and removes inherited runtime-settings/home overrides. With only the BYOK model key, this binary stopped before provider traffic with `Authentication failed. Please log in using /login or set a valid FACTORY_API_KEY environment variable.` A nonempty test-only Factory key allowed the real local model exchange; no real Factory credentials were used. The available model diagnostic revealed that the selector uses the display name: `custom:Cordyceps-0`. The consumer selects this model with `--auto low --output-format stream-json`. Sources: [Factory BYOK](https://docs.factory.ai/model-independence/byok), installed `droid exec --help` and the actual diagnostic. This is an observed local startup behavior, not a claim that arbitrary Factory service authentication succeeds.
- **OpenCode:** [`harnesses/opencode.json`](../harnesses/opencode.json) generates an `OPENCODE_CONFIG` file with `provider.anthropic.options.baseURL` ending in `/v1` and `apiKey`. The consumer uses `run --pure --model anthropic/claude-sonnet-4-5-20250929 --title Cordyceps --format json`, isolates all XDG state, and disables model fetching, default plugins and auto-update. Source: [OpenCode provider configuration](https://opencode.ai/docs/providers/) and installed `opencode run --help`.
- **Crush:** [`harnesses/crush.json`](../harnesses/crush.json) writes `crush.json` with a custom Anthropic provider, explicit model metadata and large/small model choices. `CRUSH_GLOBAL_CONFIG` points to the containing session **directory**, not to the JSON file. Provider auto-update and metrics are disabled. The consumer uses `run --quiet --model cordyceps/claude-sonnet-4-5-20250929 --small-model cordyceps/claude-sonnet-4-5-20250929`. Source: [Crush configuration and custom providers](https://github.com/charmbracelet/crush#custom-providers), [schema](https://github.com/charmbracelet/crush/blob/main/schema.json) and installed `crush run --help`.

The consumer selects model and permissions; recipes only render provider injection data and the requested noninteractive mode. They do not discover/install/launch agents or certify versions. WSL variants of the DevSwarm enum were not executed on macOS. No ACP coverage beyond the separate existing ACP baseline is claimed here.
