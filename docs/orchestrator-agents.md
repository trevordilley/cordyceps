# Agents listed by Superset and Orca

This audit extends the [DevSwarm consumer results](devswarm-agents.md) using the
actual named agent inventories in two other orchestrators. The orchestrators
launch terminal programs; their own support labels do not establish that a
program exposes a model endpoint Cordyceps can control.

The source snapshots are:

- Superset commit `3049a3114bd1ae48b944aae3e4cafdb0f521d1a5`,
  [`packages/shared/src/builtin-terminal-agents.ts`](https://github.com/superset-sh/superset/blob/3049a3114bd1ae48b944aae3e4cafdb0f521d1a5/packages/shared/src/builtin-terminal-agents.ts): 22 entries.
- Orca commit `98039676f363d6f0c06dbed25f3180463e5952af`,
  [`src/shared/tui-agent.ts`](https://github.com/stablyai/orca/blob/98039676f363d6f0c06dbed25f3180463e5952af/src/shared/tui-agent.ts): 43 entries,
  cross-checked against `src/shared/tui-agent-config.ts` for executable identity.
- Orca's [public agent table](https://www.onorca.dev/docs/agents/supported)
  additionally names MiniMax, which has no entry in that source union. Its
  distribution identity is tracked separately.

After explicit alias mappings, these comprise 48 audit entries, including the
separate Claude Teams launch mode. The [machine-readable inventory](../examples/orchestrator-agents/inventory.json)
preserves every source entry and its outcome. Check upstream roster drift with:

```sh
node examples/orchestrator-agents/check-inventory.mjs /path/to/superset /path/to/orca
```

## What verification means

A retained integration needs a built and packed Cordyceps artifact installed
outside the checkout, public imports, the authentic agent executable, a captured
prompt and controlled returned text, and a fresh fixture token read by that
agent's actual tool and present in the next provider request. Emulating a remote
agent service instead of running the real agent loop does not qualify. Excluded identities have no bundled recipe; documentation and diagnostic
receipts explain the observed boundary. A verified source profile does not
validate a failing released artifact of the same product.

This verifies native harness workflows, not the Superset or Orca desktop UI,
their launch defaults, account switching, or workspace lifecycle. Versions are
reproduction context, not a certification matrix. Existing Kiro evidence is
the observed DevSwarm `q` wrapper around Kiro; Rovo evidence uses the installed
`acli` plugin directly. The alias mapping does not claim separate verification
of every orchestrator wrapper. OpenCode 2, MiMo, Qoder, CodeBuddy, Freebuff,
OpenClaude, UFO and DeepSeek Harness retain distinct identities.

Claude Teams is an Orca launch mode with native panes and a team lifecycle.
Plain Claude Code's passing model-injection tests do not establish that mode,
so it has no separate supported recipe here. Arbitrary custom terminal
commands are likewise outside this finite source inventory.

## Outcomes

<!-- orchestrator-results:start -->
The 48 audit entries are resolved: **17 previously verified identities, 25 newly
verified identities/profiles, five excluded identities, and one excluded Claude
Teams mode**. There are no pending candidates. The wider repository now records
**43 verified native identities/profiles: 18 prior plus 25 new**. The difference
between 42 verified entries in this audit and 43 overall is previously verified
Plandex, which is absent from these Superset/Orca rosters. Launch aliases, headless
and TUI variants, and ACP recipes do not count as additional native identities.

Every newly retained profile passed controlled native text and an actual fixture
read through an installed Cordyceps tarball. The linked records give exact
versions, commands, captures and limits:

| Newly verified identities/profiles | Evidence and reproduction |
| --- | --- |
| Pi, Oh My Pi, Mastra Code, Kimi Code, Prime Agent, ZCode | [Six native agents](real-pi-agents.md); selected streaming and process-cancellation checks, with buffered output explicitly recorded. |
| Kilo Code, Continue CLI, Autohand, Command Code | [Four native CLIs](real-extra-cli.md); lifecycle results are per-profile. |
| Hermes, OpenClaw | [Local agents](real-local-agents.md). |
| Grok Build, Muse Code, fx, Ante, MiniMax Code | [Vendor agents](real-vendor-agents.md); MiniMax is the separately verified `mcode` distribution from Orca's public table. |
| OpenClaude, Freebuff, CodeBuddy | [OpenClaude and native Freebuff TUI](real-source-agents.md), [both CodeBuddy launch aliases](real-source-codebuddy-qoder.md). |
| MiMo Code, DeepSeek Harness, OpenCode 2 beta | [Headless and native terminal consumers](real-source-opencode-mimo-dsh.md); DeepSeek and OpenCode 2 include their actual source-roster TUI paths. |
| Codebuff official source CLI, Polygraph launching Claude Code | [Exact source and launcher profiles](real-codebuff-polygraph.md); the qualifications below are part of these results. |

**Codebuff is verified only from unmodified official source commit
`fb2a17d442feb9a3482c0ed32863a4cd5fe37009`**, whose CLI reports `1.0.0`.
Its actual model requests, text and native `read_files` round trip work with
explicit local account/usage fixtures. Published native **Codebuff 1.0.688 remains
excluded**: the genuine binary targets `www.codebuff.com` despite the tested
endpoint overrides, and the rejecting proxy observes no local model request.
The source recipe is not a claim of support for that release or evidence borrowed
from Freebuff.

**Polygraph's verified profile is shell 0.1.5/runtime 2609.28.0005 launching Claude
Code 2.1.283**, with official Claude plugin 0.5.4 and a genuinely connected MCP
transport. Claude performs the actual fixture read. Consumer fixtures supply
local organization and empty-session metadata. Other Polygraph agent backends,
hosted semantic search and remote repository management were not verified.
The clean hosted [run 36740569377](https://github.com/trevordilley/cordyceps/actions/runs/36740569377)
also passed both profiles, using Polygraph runtime `2609.29.0017` after its
upstream update. These two profiles do not add cancellation, session-reuse or
incremental-terminal output claims.

The excluded source identities are:

| Identity | Observed boundary |
| --- | --- |
| Cursor | [Remote agent-service boundary](real-cursor.md); local model injection was not established. |
| Devin | [Native protobuf bootstrap](real-vendor-agents.md) with test-only local credentials reaches service requests, then fails to start an ACP session on explicit diagnostic 404s. No controlled model/text/read workflow was established. |
| UFO | [Native workspace conversation service](real-source-agents.md#superset-ufo-excluded-at-the-remote-agent-boundary); its separate `llm` command ignores the tested provider base override. |
| Qoder | [Authentication boundary](real-source-codebuddy-qoder.md); isolated custom models and test PAT probes do not reach the local model endpoint. |
| TRAE CN CLI | [Official distribution failure](real-vendor-agents.md); both installer entry points returned HTTP 403 from the test host. No authentic executable or substitute was tested. |

Claude Teams is separately excluded as an unverified orchestrator launch mode,
as described above. These exclusions record tested boundaries or unavailable
prerequisites; they do not assert that every future or authorized deployment is
impossible. Published Codebuff's excluded release is a qualification on its one
source identity, not a 49th audit entry.
<!-- orchestrator-results:end -->

All installation, process launch, permissions, source builds, state and cleanup
belong to consumer examples. The library continues to provide provider mocks
and injection settings only. Runs use isolated configuration, test credentials,
and a loopback-only outer sandbox; none uses a paid provider response.
