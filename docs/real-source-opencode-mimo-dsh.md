# OpenCode 2 beta, MiMo Code, and DeepSeek Harness source identities

The consumer implementation lives in `examples/real-source-agents/opencode-mimo-dsh/`. Its three verified recipes are bundled by the default registry.

## Distribution provenance

| Source identity | Actual distribution | Observation |
| --- | --- | --- |
| `opencode2`, launch `opencode2 --standalone` | `@opencode-ai/cli@0.0.0-beta-19271`; npm bin `opencode2` | Historical beta package from `anomalyco/opencode`. Current official v2 installer now uses `opencode` and `@opencode/cli`; that newer identity is not substituted. |
| `mimo-code`, executable `mimo` | `@mimo-ai/cli@0.1.15` | Xiaomi's official distribution, from `XiaomiMiMo/MiMo-Code`. The similarly named `@xiaomi-mimo/cli` is not this harness. |
| `dsh`, launch `dsh-tui` | `@deepseek-ai/dsh@0.2.0-rc.2` and `@deepseek-harness-tui/dsh-tui@0.12.0` | DeepSeek's official runtime and the separate community TUI package from `ccch1mneyyy/dsh-TUI`. The latter delegates to `dsh --profile dsh-tui`. |

Official source links: [OpenCode v2 install](https://opencode.ai/v2/docs/), [historical beta package](https://registry.npmjs.org/@opencode-ai/cli/0.0.0-beta-19271), [Xiaomi installation](https://github.com/XiaomiMiMo/MiMo-Code#quick-start), [Xiaomi endpoint configuration](https://github.com/XiaomiMiMo/MiMo-Code#custom-openai-compatible-endpoints), [DeepSeek runtime](https://github.com/deepseek-ai/deepseek-harness), [roster TUI launcher](https://github.com/ccch1mneyyy/dsh-TUI).

The installed DeepSeek `llm-deepseek` 0.2.0-rc.2 uses **Anthropic Messages**, including its `DEEPSEEK_BASE_URL` override. It must not be assumed to use Chat Completions solely from the provider name. Xiaomi's custom OpenAI-compatible endpoint uses Chat Completions. OpenCode's current v2 provider configuration uses `providers.*.settings`, unlike the earlier v1 shape; actual beta behavior must be measured against the beta executable.

## Isolation and acceptance

`run.mjs` copies the library build inputs into a disposable directory, builds and packs that copy, installs the tarball in another disposable consumer, and copies this example there. `consumer.mjs` imports only `prepare` and `createRegistry` from the installed `cordyceps` package. The library never installs or launches agents.

Each case gets an empty HOME, XDG directories, work directory and TMPDIR. Child environments are allowlisted and contain test credentials only. macOS `sandbox-exec` denies outbound network except loopback and denies file writes except owned temporary directories and terminal devices. No real provider, account, user config, or inherited key is used. Installation is a separate network-enabled scratch dependency step before the isolated harness tests.

Text acceptance requires the actual prompt in provider captures, controlled text in native process stdout with successful headless exit, or a controlled marker on the rendered native TUI screen. Persistent TUI sessions are deliberately closed by the consumer; the PTY transport exit is not an agent-completion assertion. Tool acceptance additionally requires a new unpredictable token written only to `fixture.txt`, absent from the initial request and present in the real tool result in the next provider request. The consumer never reads the fixture on the harness's behalf. Provider captures and native stdout/stderr are retained separately. Child process groups are killed before listeners/config directories are disposed. On Darwin, the consumer allows terminal teardown to settle briefly and requires `ps` to show no live processes in its exact owned groups before cleanup succeeds. Generated files, listener disposal and scratch-root removal are also asserted.

## Reproduction

Use real Node 22 or newer, Bun, and macOS. Dependency installation is a separate developer setup step, never a Cordyceps API. The installer records registry integrity and the installed versions in its scratch directory.

```sh
node examples/real-source-agents/opencode-mimo-dsh/install.mjs /tmp/cordyceps-omd-deps
node examples/real-source-agents/opencode-mimo-dsh/run.mjs /tmp/cordyceps-omd.json /tmp/cordyceps-omd-deps mimo,dsh,dsh-tui,opencode2,opencode2-run
```

The MiMo and DeepSeek cases load the actual JSON recipes through `createRegistry().loadFile()` from the packed consumer. MiMo's recipe provides the custom provider/model settings. DeepSeek's recipe exposes both the headless and interactive configuration; the consumer selects the separate `dsh-tui` executable, installs an ordinary local profile pointing at the already installed official packages, and supplies its initial prompt. Its PTY helper handles terminal capability queries and captures the real output before closing the persistent TUI. The consumer renders the captured terminal with `@xterm/headless` 6.0.0 and asserts the controlled marker in the screen: the native TUI paints words in cursor-positioned fragments, so stripping ANSI sequences is insufficient. This is deliberately narrower than graceful completion, cancellation, session reuse, ACP, or streaming certification; none of those is inferred from these cases.

## Observed results

All ten workflows passed against installed Cordyceps tarballs using public imports. These represent three source identities, not five separate agents.

| Native workflow | Text capture count | Tool capture count | Actual tool |
| --- | ---: | ---: | --- |
| MiMo Code `mimo run` | 2 | 3 | `read` with `file_path` |
| DeepSeek `dsh --profile headless` | 2 | 3 | `read` with `file_path` |
| DeepSeek `dsh-tui` native profile | 2 | 3 | `read` with `file_path` |
| OpenCode 2 beta `opencode2 --standalone` TUI | 2 | 3 | `read` with `path` |
| OpenCode 2 beta `opencode2 run --standalone` | 2 | 3 | `read` with `path` |

Counts include a separately scripted native title request. The real unpredictable file token must appear in the next main conversation request; title requests cannot satisfy that assertion. Both TUI workflows use actual terminal input/output and terminal rendering, never a synthetic consumer standing in for the agent.

[MiMo/DeepSeek compact evidence](../examples/real-source-agents/opencode-mimo-dsh/evidence-mimo-dsh.json) and [OpenCode 2 compact evidence](../examples/real-source-agents/opencode-mimo-dsh/evidence-opencode2.json) retain actual output, selected tool schemas/results and raw-request SHA-256. [Recipes](../examples/real-source-agents/opencode-mimo-dsh/recipes/) are loaded directly by the external packed consumer. No provider codec changes were needed for these three identities.

## OpenCode 2 initialization findings

This example tests the historical OpenCode 2 beta. Its official beta successfully uses the existing Anthropic Messages codec. The recipe generates the native `opencode/opencode.json` beneath an isolated `XDG_CONFIG_HOME`, selects an Anthropic model, and injects its base URL and test key. Both recipe modes request a private `--standalone` server; the consumer owns launch and cleanup.

The earlier `OPENCODE_CONFIG`-only attempt did not establish the configured default in this beta. Actual native output selected OpenCode Zen's free model and attempted `opencode.ai`, which the OS sandbox blocked. Native XDG configuration fixes model selection. A second genuine startup race occurred when supplying TUI `--prompt`: it could submit before the asynchronous model catalog applied the configured default, or remain prefilled in the composer. The final consumer launches the normal standalone TUI, waits until its configured Anthropic model is visible, types the real prompt and presses Enter. Both text and real read then pass. The print workflow uses the native explicit `--model` option. The beta's actual `read` schema expects `path`, unlike the earlier v1 `filePath` guess; scripts now use the captured schema. Native title prompts are handled explicitly.

The consumer does not patch OpenCode, fabricate catalog/authentication responses, or emulate a remote agent service. These are exact reproduction findings for this installed beta, not a guarantee about every future OpenCode version. Incremental output, cancellation, ACP, follow-up sessions and graceful TUI completion were not asserted here.
