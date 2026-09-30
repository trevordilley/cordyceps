# GitHub Actions

`.github/workflows/ci.yml` moves verification onto standard GitHub-hosted runners.
It runs on pull requests, pushes to `main` and `implementation/**`, and manual
`workflow_dispatch`. No provider credentials or repository secrets are required.
Standard hosted runners are [free for public repositories](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
These jobs use `ubuntu-24.04` and standard arm64 `macos-15`, not paid larger runners.

## Jobs

- Two Linux jobs run strict TypeScript, Bun tests, Node lifecycle tests, build,
  and clean installed-package checks on Node 22.22.3 and 24.15.0. They retain the
  resulting tarball.
- Eleven macOS groups (up to four in parallel) build and install the actual package, then run the
  real consumer examples. `baseline` covers Claude Code and Codex text/read,
  the official Claude ACP adapter lifecycle, and the three Chromium frontend
  tests. `extra-cli` covers Kilo, Continue, Autohand and Command Code; `pi`
  covers Pi, OMP, Mastra Code, Kimi, Prime Agent and ZCode; `vendors` covers
  Grok Build, Muse, fx, Ante and MiniMax Code. `source-clis` covers MiMo,
  DeepSeek headless/TUI, and OpenCode 2 headless/TUI. `codebuff-polygraph`
  covers the pinned official Codebuff source and Polygraph→Claude; `providers`
  covers Copilot, OpenCode, Crush, Goose and Droid; `google` covers Gemini,
  Qwen and Mistral Vibe; `editors` covers Cline and Aider; `auggie` and
  `openclaw` cover their named agents.

That is an configured automated set of **34 native agent families**, plus ACP and
browser scenarios. Other verified local integrations remain documented in
`verification.md` and the source inventories; they are not silently counted
as hosted CI coverage. The remaining nine are Amazon Q, Amp, Antigravity,
Rovo Dev, Plandex, Hermes, OpenClaude, CodeBuddy and Freebuff. New groups should use the same real packed consumers
and supply ordinary reproducible installation steps.

`scripts/ci-real-consumers.sh` is consumer-owned setup and execution code. It
installs tools into runner scratch directories, keeps dependency installation
separate from sandboxed agent execution, and never calls a real model provider.
The actual agent processes retain the examples' loopback-only macOS sandbox,
isolated HOME/configuration, test keys, assertions and cleanup. macOS is required
by those examples; moving them to Linux requires an equivalent network/process
isolation implementation rather than removing the sandbox.

Npm agent versions and Prime/ZCode artifacts are pinned to observed reproduction
versions. The vendor installer follows official current download manifests and
records the installed versions. The Pi group installs Bun 1.4.2 for its
agent runtime and packing; other groups use Bun 1.3.13. These are reproduction choices, not a version
certification matrix. Changes upstream can fail CI and require investigation.

Jobs have explicit time limits, cancel superseded runs on the same ref, and keep
failure receipts/browser reports for seven days. External Actions are pinned to
commit SHAs. Checkout does not persist credentials and the workflow token has
only read access to repository contents. No job publishes npm or merges code.

## Hosted verification

The repository is [trevordilley/cordyceps](https://github.com/trevordilley/cordyceps).
[Run 36740569377](https://github.com/trevordilley/cordyceps/actions/runs/36740569377)
at code commit `8a8bbfe` completed successfully: **all 13 jobs passed**. The
11 native consumer groups cover **34 families and 107 real cases**, plus the
official ACP adapter lifecycle and all three Chromium tests. Both Linux jobs
passed strict TypeScript, 149 Bun tests (two known Bun skips; 1,246 assertions),
all 21 mandatory Node lifecycle tests, build and installed-package checks.

The ACP consumer verified eight prompts across separate sessions, 65 native
messages, two permission requests, real file reading, incremental output,
cancellation, same-session reuse and owned process-group cleanup. Provider
auxiliary traffic varies between runs; native ACP messages are not counted as
provider chunks. Compact [hosted receipts](../examples/orchestrator-agents/hosted-verification.json)
retain actual outcomes, artifact integrity, full-receipt hashes and job URLs,
including the earlier failures.

Fresh runners exposed four corrections: Claude requires `CLAUDE_CODE_TMPDIR`
inside owned scratch state; Auggie's optional `/find-missing` probe needs an
explicitly scripted auxiliary error; Codebuff source requires its official
agent-generation step; and ACP teardown needs to verify that no live member
remains in its owned process group after bounded TERM/KILL attempts. The
Polygraph download also changed upstream; its new runtime `2609.29.0017` was
inspected, pinned by hash and reverified. Isolation and genuine tool assertions
remain enabled throughout.

The nine additional locally verified families listed above are not included in
these hosted totals. See [all observed consumer outcomes](verification.md) for
that distinction and the per-profile limitations. A copy of the workflow on the
default branch enables the manual Run workflow button; branch pushes and pull
requests already execute it.

The same group can be exercised locally on macOS with an owned scratch directory:

```sh
RUNNER_TEMP=/path/to/owned/scratch bash scripts/ci-real-consumers.sh baseline
```

Use actual Node 24, Python 3.12 and Bun 1.3.13 first on PATH, with repository
packages already installed. Inside DevSwarm, wrap that command with
`hivecontrol exec oneshot 15m -- ...` so local resource usage remains tracked.
