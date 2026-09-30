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

## Activation and verification status

The destination is [trevordilley/cordyceps](https://github.com/trevordilley/cordyceps).
Pushing this implementation branch starts the workflow; a default-branch copy
also enables the manual Run workflow button. [Actions run results](https://github.com/trevordilley/cordyceps/actions)
establish runner-specific behavior; local verification alone does not. Local `actionlint` and `bash -n` passed. The exact `baseline` setup also passed
locally with freshly npm-installed Claude/Codex on Node 24.15.0: four CLI cases,
eight ACP turns with cancellation/session reuse, and all three Chromium tests.
The [first hosted run](https://github.com/trevordilley/cordyceps/actions/runs/36737813993)
passed both Linux library jobs and the four non-baseline consumer groups
(18 native families). Baseline failed before its first provider request because
Claude defaults to `/tmp/claude-UID` even with `TMPDIR` set. The consumers now
set the documented `CLAUDE_CODE_TMPDIR` to their owned scratch directory;
filesystem isolation remains intact. The [second hosted run](https://github.com/trevordilley/cordyceps/actions/runs/36738685084)
confirmed that fix: CLI, ACP and all three browser tests passed. Nine native
consumer groups passed, covering 31 families. Auggie text reached its controlled
output but exposed an unrecognized background `/find-missing` request; the
codec must capture that explicit auxiliary error. Codebuff/Polygraph setup
correctly stopped because the official Polygraph bundle changed. The inspected
new runtime is pinned for revalidation; neither failure is counted as a pass. Baseline now attempts CLI, ACP and browser independently
and still fails the job if any scenario fails.

The same group can be exercised locally on macOS with an owned scratch directory:

```sh
RUNNER_TEMP=/path/to/owned/scratch bash scripts/ci-real-consumers.sh baseline
```

Use actual Node 24, Python 3.12 and Bun 1.3.13 first on PATH, with repository
packages already installed. Inside DevSwarm, wrap that command with
`hivecontrol exec oneshot 15m -- ...` so local resource usage remains tracked.
