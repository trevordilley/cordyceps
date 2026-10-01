# Real Hermes and OpenClaw consumers

`examples/real-local-agents/run.mjs` builds Cordyceps, packs it, installs the
tarball into a temporary project outside this checkout, and runs
`consumer.mjs` using public `prepare` and `createRegistry` imports. Its
processes, test dependencies, scratch homes, permissions and cleanup are
consumer code, not public library API.

## Setup and run

Use actual Node 22 or newer, Bun for the library build, and macOS
`sandbox-exec`. Install ordinary local dependencies in a disposable directory:

```sh
LOCAL_AGENT_TOOLS=$(mktemp -d)
npm install --prefix "$LOCAL_AGENT_TOOLS" --no-audit --no-fund openclaw@2026.9.2

HERMES_SOURCE=$(mktemp -d)
git clone https://github.com/NousResearch/hermes-agent.git "$HERMES_SOURCE"
git -C "$HERMES_SOURCE" checkout ddd0cc6944908d2655db2095786ac089a7c3ba0c
HERMES_VENV=$(mktemp -d)
uv venv --python 3.14 "$HERMES_VENV"
uv pip install --python "$HERMES_VENV/bin/python" -e "$HERMES_SOURCE"

OPENCLAW_BINARY="$LOCAL_AGENT_TOOLS/node_modules/.bin/openclaw" \
HERMES_BINARY="$HERMES_VENV/bin/hermes" \
node examples/real-local-agents/run.mjs /tmp/cordyceps-local-evidence.json hermes,openclaw
```

Hermes's official source deliberately rejects wheel builds and supports an
editable installation; the executable above runs that unmodified source.
This does not change the Cordyceps artifact requirement: the consumer always
installs and imports the actual packed library. Remove the three setup
directories when finished.

The optional final comma-separated argument selects one agent. Missing
executables and failed assertions are errors, never successful skips. Versions
and source hashes are reproduction context, not version gates.

## Provider and native tool boundary

OpenClaw's recipe supplies an explicit custom provider and selects its
`openclaw` runtime. `agent exec --config` uses that generated configuration;
the consumer supplies its own state directory and working directory. The
actual native `read` tool returns a newly generated file token to the next
Chat Completions request. The JSON output mode consumes provider SSE but
buffers the final assistant output.

Hermes's recipe supplies isolated `HERMES_HOME`, a custom OpenAI-compatible
endpoint and JSON-formatted `config.yaml` (JSON is accepted by its YAML
loader). Its actual `read_file` tool takes `path`, not `file_path`. The
consumer selects the native file toolset and reads the random fixture through
that tool. Native stream-JSON text is observed before the held response tail
is released. A separate title-generation model request receives an explicitly
scripted title.

Hermes first probes local model metadata. The dedicated `hermes` codec
recognizes the observed metadata paths and delegates model requests to the
Chat Completions codec. Every probe is captured; this consumer explicitly
answers each with a scripted 404. No default model catalog, implicit success,
or ignored unexpected traffic is introduced. Unknown paths still fail.

Each cancellation case holds an actual model request, kills the consumer's
process group, and asserts that the provider observes abort. It does not
claim native ACP cancellation or same-session reuse. Those remain distinct
from the [Claude ACP verification](real-acp.md).

## Isolation and cleanup

Child environments are built from an explicit allowlist, with temporary HOME,
configuration and state, test keys, and no inherited provider credentials.
The outer macOS sandbox denies non-loopback network requests and file writes
outside the owned scratch paths. It remains active even where the native
headless command permits tools.

OpenClaw 2026.9.2 places SQLite coordinator locks under a fixed
`/tmp/openclaw-state-locks-UID` directory rather than TMPDIR. The consumer
permits only the exact filenames derived from its own random state/database
paths, refuses pre-existing locks, and removes only those files. It does not
grant write access to the whole shared lock directory or another user's
OpenClaw state. Provider listeners, generated config files, scratch homes,
process groups and owned lock files are checked after cleanup.

The compact [evidence receipt](../examples/real-local-agents/evidence.json)
records artifact integrity, versions, commands, provider request hashes,
tool results, output and assertions. The full runtime receipt is written to
the path supplied to the run command.
