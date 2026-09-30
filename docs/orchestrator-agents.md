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
agent's actual tool and present in the next provider request. A mock service
that decides the agent's tool actions on its behalf does not qualify. Failed
or unavailable integrations remain excluded; documentation and diagnostic
receipts explain the boundary without offering a recipe.

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
Verification is in progress. Only completed entries in the inventory are evidence;
pending candidates are not supported integrations.
<!-- orchestrator-results:end -->

All installation, process launch, permissions, source builds, state and cleanup
belong to consumer examples. The library continues to provide provider mocks
and injection settings only. Runs use isolated configuration, test credentials,
and a loopback-only outer sandbox; none uses a paid provider response.
