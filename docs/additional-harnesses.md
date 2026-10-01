# Additional verified harnesses

These 25 profiles supplement the [native harnesses](native-harnesses.md).

## What verification means

A retained integration needs a built and packed Cordyceps artifact installed
outside the checkout, public imports, the authentic agent executable, a captured
prompt and controlled returned text, and a fresh fixture token read by that
agent's actual tool and present in the next provider request. Emulating a remote
agent service instead of running the real agent loop does not qualify. Excluded identities have no bundled recipe; documentation and diagnostic
receipts explain the observed boundary. A verified source profile does not
validate a failing released artifact of the same product.

Versions describe the tested executable, not a compatibility guarantee. Kiro evidence uses the installed `q` wrapper; Rovo evidence uses the installed `acli` plugin directly.

Claude Teams and arbitrary custom launch modes have not been verified.

## Outcomes

The repository has **43 verified native families**. Launch aliases, headless/TUI variants and ACP recipes do not count as additional families.

Every newly retained profile passed controlled native text and an actual fixture
read through an installed Cordyceps tarball. The linked records give exact
versions, commands, captures and limits:

| Newly verified identities/profiles | Evidence and reproduction |
| --- | --- |
| Pi, Oh My Pi, Mastra Code, Kimi Code, Prime Agent, ZCode | [Six native agents](real-pi-agents.md); selected streaming and process-cancellation checks, with buffered output explicitly recorded. |
| Kilo Code, Continue CLI, Autohand, Command Code | [Four native CLIs](real-extra-cli.md); lifecycle results are per-profile. |
| Hermes, OpenClaw | [Local agents](real-local-agents.md). |
| Grok Build, Muse Code, fx, Ante, MiniMax Code | [Vendor agents](real-vendor-agents.md); MiniMax uses the official `mcode` distribution. |
| OpenClaude, Freebuff, CodeBuddy | [OpenClaude and native Freebuff TUI](real-source-agents.md), [both CodeBuddy launch aliases](real-source-codebuddy-qoder.md). |
| MiMo Code, DeepSeek Harness, OpenCode 2 beta | [Headless and native terminal consumers](real-source-opencode-mimo-dsh.md); DeepSeek and OpenCode 2 include their actual TUI paths. |
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

Excluded integrations:

| Identity | Observed boundary |
| --- | --- |
| Cursor | [Remote agent-service boundary](real-cursor.md); local model injection was not established. |
| Devin | [Native protobuf bootstrap](real-vendor-agents.md) with test-only local credentials reaches service requests, then fails to start an ACP session on explicit diagnostic 404s. No controlled model/text/read workflow was established. |
| UFO | [Native workspace conversation service](real-source-agents.md#ufo-excluded-at-the-remote-agent-boundary); its separate `llm` command ignores the tested provider base override. |
| Qoder | [Authentication boundary](real-source-codebuddy-qoder.md); isolated custom models and test PAT probes do not reach the local model endpoint. |
| TRAE CN CLI | [Official distribution failure](real-vendor-agents.md); both installer entry points returned HTTP 403 from the test host. No authentic executable or substitute was tested. |

These exclusions record tested boundaries or unavailable prerequisites. They do not establish that all future versions will have the same limits.

All installation, process launch, permissions, source builds, state and cleanup
belong to consumer examples. The library continues to provide provider mocks
and injection settings only. Runs use isolated configuration, test credentials,
and a loopback-only outer sandbox; none uses a paid provider response.
