# Installed CLI consumer dogfooding

Run from the repository on macOS with **real Node >=22**, Bun (build only), npm,
Claude Code and Codex already installed on PATH. The recorded run used Claude
Code **2.1.283** and Codex **0.155.1**; versions are observations, not gates:

```sh
hivecontrol exec oneshot 3m -- node examples/real-cli/run.mjs /tmp/cordyceps-real-cli-evidence.json
node examples/real-cli/summarize.mjs /tmp/cordyceps-real-cli-evidence.json /tmp/cordyceps-real-cli-summary.json
```

Without DevSwarm, run the same `node` command directly. This host's default
`node` is a Bun shim; the executed command prepended
`/Users/20idemo/.nvm/versions/node/v22.22.3/bin` to PATH and used that directory's
Node binary. The runner rejects Bun. It builds, packs, installs the actual
`.tgz` offline into an isolated consumer directory, and copies `consumer.mjs`
there. That consumer imports only `cordyceps`; it has no source or dist imports,
Playwright dependency, symlink to the checkout, or replacement CLI implementation.
No package is published and no harness is downloaded.

The four assertions exercise real installed processes:

| Harness | Scenario | Captured requests | Observed outcome |
| --- | --- | --- | --- |
| Claude Code 2.1.283 | Controlled text | 1 | JSON result contains `CORDYCEPS_claude-code_text_OK` |
| Claude Code 2.1.283 | Scripted `Read` | 2 | Real fixture contents in next request, then controlled completion |
| Codex 0.155.1 | Controlled text | 1 | JSONL agent message contains `CORDYCEPS_codex_text_OK` |
| Codex 0.155.1 | Scripted `exec_command` | 2 | Real `/bin/cat fixture.txt` contents in next request, then controlled completion |

The file contains a fresh UUID token absent from both the prompt and scripted
tool call. The consumer asserts that the real tool result contains it, uses the
same call ID, and arrives in the second request. It checks process exit, final
output, request count, captured input and library health. An absent binary,
failed version probe or file read, unexpected retry, or missing reply fails the run.
The checked-in `examples/real-cli/evidence.json` records selected exact wire
fields, actual CLI output, tarball integrity, and raw request body hashes.
The command's full local JSON additionally retains all captured requests and
responses; these include vendor system prompts and are deliberately not committed.

## Consumer ownership and isolation

The example owns process launch, timeout and process-group cleanup. Every case
has a disposable working directory, HOME, Claude config directory and temporary
files. Codex's recipe generates its isolated CODEX_HOME. An allowlisted environment
carries no inherited credentials, provider selection, hooks, or proxies. Only
synthetic mock authentication is supplied. Claude settings/customizations and
MCP discovery are disabled. The mock binds loopback and never forwards traffic.
The outer macOS `sandbox-exec` profile permits outbound connections only to
loopback and filesystem writes only to consumer-owned directories plus terminal
and null devices. Proxy variables also point to an unavailable loopback endpoint.
The example refuses other platforms rather than dropping OS network isolation.
Disposal verifies the mock listener is closed and generated config files removed;
consumer cleanup verifies the disposable directory no longer exists.

The first Codex read attempt used both the outer sandbox and Codex `-s read-only`.
Its *real tool result* was:

```text
Process exited with code 71
Output:
sandbox-exec: sandbox_apply: Operation not permitted
```

macOS rejected the nested sandbox. The successful consumer uses Codex
`-s danger-full-access` **inside the outer consumer-owned OS sandbox**, and
scripts only `/bin/cat fixture.txt` with `login: false`. It does not enable a
live provider, relax the outer network policy, or fabricate the failed read's
result. Baseline codecs and recipes needed no changes for these four workflows.

These are executed observations for the versions above, not certification of
other releases, platforms, interactive sessions or ACP adapters.

## Real interactive input

With Python 3 available, run the installed Claude Code TUI in a consumer-owned PTY:

```sh
hivecontrol exec oneshot 2m -- node examples/real-cli/run.mjs /tmp/cordyceps-real-cli-interactive.json --interactive-claude
hivecontrol exec oneshot 30s -- node --test examples/real-cli/pty.test.mjs
```

The executed Claude Code 2.1.283 case types the prompt through the PTY (the
prompt is not a CLI argument), captures the resulting provider request, and
observes `CORDYCEPS_claude-code_interactive_OK` in actual terminal output.
Claude also sends a session-title request; an explicit route supplies title
JSON, while only the main request receives the completion marker. Assertions
require exactly one main request and at most one title request. The recorded
run has two requests, successful output, and verified cleanup.
`examples/real-cli/interactive-claude-evidence.json` preserves exact selected
requests and the terminal transcript.

The consumer creates `.claude/.claude.json` solely beneath its temporary HOME.
The fields were observed in configuration generated by this CLI during an
isolated onboarding run: `hasCompletedOnboarding`, approval of the mock API
key's final 20 characters in `customApiKeyResponses.approved`, and
`projects[canonicalDisposableWorkPath].hasTrustDialogAccepted`. This prepares
the fixture directory, not a user's workspace. These are consumer settings
for the observed installed version, not a new library recipe or promised
stable vendor API. `--bare --restricted --safe-mode`, empty tool selection,
local-only networking and restricted filesystem writes remain in effect.

The driver responds to terminal capability queries, sends the prompt followed
by carriage return (Enter), captures the reply and closes the persistent
session. A newline had inserted a line break in Claude's composer rather than
submitting; the successful run uses carriage return. The PTY master must close
before `waitpid` on macOS, or an exiting child can remain in its terminal exit
path. The separate transport regression verifies real PTY input/output and
bounded cleanup; it is not counted as an installed-harness test.

## Remaining Codex interactive limitation

The optional Codex probe remains a **failing diagnostic**, separate from the
successful noninteractive Codex cases and interactive Claude case:

```sh
hivecontrol exec oneshot 2m -- node examples/real-cli/run.mjs /tmp/cordyceps-real-cli-codex-pty.json --interactive
```

On Codex 0.155.1, it draws the directory trust screen but captures zero provider
requests. Alternatives tried include CR, LF, `1` + return, delaying trust-screen
input, a canonical project trust `-c` override, the documented approval/sandbox
bypass flag inside the unchanged outer OS sandbox, terminal-device write
permission, and terminal capability replies. The cause remains unresolved
before the provider boundary; no upstream/external blocker is established.
`examples/real-cli/interactive-evidence.json` preserves a failed actual
transcript, arguments, and empty request list. The current repro exits nonzero
after its 20-second bound and verifies cleanup. No paid provider fallback or
user configuration change was used. The default four-case command excludes
these PTY probes and does not require Python.
