# Real Plandex consumer

`examples/real-plandex` validates the actual Plandex CLI and self-hosted backend
against an installed Cordyceps tarball. It imports only the public `cordyceps`
package. It verifies controlled text, then Plandex's genuine server-directed
context read and the fresh fixture token in the next main provider request.
No provider inference, cloud account, or paid credentials are used.

## Reproduce

Prerequisites: macOS with `sandbox-exec`, real Node >=22, Bun, npm, Go, Git,
Python 3.12 through `uv`, and a working Docker daemon. Port 4000 must be free:
upstream hardcodes its local LiteLLM readiness service there. The consumer
refuses an occupied port instead of using or stopping someone else's service.
The example fails explicitly on other platforms.

Use Node >=22 first on PATH:

```sh
bun install --frozen-lockfile
node examples/real-plandex/bootstrap.mjs /tmp/cordyceps-plandex-source-path.txt
PLANDEX_TEST_SOURCE="$(cat /tmp/cordyceps-plandex-source-path.txt)"
node examples/real-plandex/run.mjs /tmp/cordyceps-plandex-evidence.json "$PLANDEX_TEST_SOURCE"
node examples/real-plandex/summarize.mjs /tmp/cordyceps-plandex-evidence.json /tmp/cordyceps-plandex-summary.json
```

The consumer owns the PostgreSQL and Plandex backend processes and stops them during cleanup.

The bootstrap creates a fresh source directory, checks out upstream commit
`e2d772072efadbe41d2946d97d79be55532dbab5`, builds both Go binaries without
source changes, creates a private Python environment, and pulls PostgreSQL.
It does not install a system `plandex` or alter shell startup files. It retains
that source/build directory for repeated runs; remove that exact directory
when finished. Each validation run removes its own database container,
labeled database volume, dedicated Docker network, account/state directory,
mock configuration, listener, and temporary npm consumer. Images and ordinary
dependency caches remain installed.

The initial bootstrap was executed as these tracked commands against a fresh
clone at `/tmp/cordyceps-plandex-source-59ae5b3c`:

```sh
git clone --depth 1 https://github.com/plandex-ai/plandex.git /tmp/cordyceps-plandex-source-59ae5b3c
# Working directory: SOURCE/app/cli
go build -o /tmp/cordyceps-plandex-source-59ae5b3c/plandex .
# Working directory: SOURCE/app/server
go build -o /tmp/cordyceps-plandex-source-59ae5b3c/plandex-server .
uv venv /tmp/cordyceps-plandex-source-59ae5b3c/venv
uv pip install --python /tmp/cordyceps-plandex-source-59ae5b3c/venv/bin/python 'litellm==1.72.6' 'fastapi==0.115.12' 'uvicorn==0.34.1'
```

The recorded run used Node **22.22.3**, Go **1.26.1 darwin/arm64**, Python
**3.12.8**, Docker server **29.6.1**, PostgreSQL **16.15**, and Plandex's **2.2.1** source version.
The CLI prints **development**, because the unmodified `go build` does not
inject release ldflags. The exact upstream commit, binary SHA-256 values,
PostgreSQL image digest, Python dependency versions, and packed artifact
integrity are recorded in `examples/real-plandex/evidence.json`. These are
observations, not a version compatibility guarantee.

## Observed evidence

| Case | Main requests | Result |
| --- | --- | --- |
| Controlled text | 1 | Actual CLI terminal contains `CORDYCEPS_PLANDEX_TEXT_OK`; exit 0. |
| Actual context read | 2 | First request lacks a fresh fixture UUID; the next main request contains it; terminal contains `CORDYCEPS_PLANDEX_READ_OK`; exit 0. |

Plandex also issues a summary request after each reply: the recorded run has
six provider requests total, three main and three summaries. A summary request
can occur between the read directive and the next main request. Summary
traffic receives a separate explicit response and is preserved in evidence.
It is not counted as read proof.

The read uses Plandex's native context protocol. The first model response is:

```text
### Files
- `fixture.txt`
```

The real server emits `loadContext`, the real CLI reads the fixture, and the
real backend's `AutoLoadContextHandler` processes the result. Only then does
the next main Chat Completions request contain the unpredictable file token.
The example never uploads the file's contents itself or manufactures a tool
result. It asserts the initial absence, subsequent presence, server handler
completion, main request count, terminal completion, process exit, library
health, and cleanup. This is a harness context read, not an OpenAI
`tool_calls`/`tool` message exchange or evidence of shell execution.

The full local evidence preserves raw provider requests/responses, real CLI
transcripts, and backend logs. The checked-in summary keeps selected proof,
raw body hashes, our terminal output and versions; it omits vendor system
prompts and disposable authentication tokens.

## Injection and consumer ownership

The private, loadable recipe is `examples/real-plandex/plandex.json`:

```js
import { cordyceps } from 'cordyceps';
const registry = cordyceps.createRegistry({ builtins: false });
await registry.loadFile('/absolute/path/to/plandex.json');
const ai = await cordyceps.prepare({ harness: 'plandex', mode: 'nonInteractive', registry });
```

It renders the documented custom providers/models/model-packs JSON and a test
API-key environment variable. Every model role selects the custom loopback
provider, using `openai-chat-completions`. The consumer copies the rendered
file to its own writable location because Plandex saves an adjacent `.hash`,
then runs `models custom --file FILE --save`, `set-model default cordyceps`,
`new`, and `chat`. The real local backend API creates the disposable account
and organization; its returned test session is written only beneath the
consumer's temporary HOME.

The recipe does not install or launch anything and is not registered as a
bundled library default. CLI/server paths, database creation, local account
setup, custom-model synchronization, model selection, terminal transport and
cleanup remain consumer responsibilities. No shared registry or Saga files
are changed by this example.

Even `plandex chat PROMPT` starts a Bubble Tea stream UI. A pipe-only launch
reached the real mock but failed with `Could not open a new TTY`. The consumer's
Python PTY driver provides a real controlling terminal, answers terminal
capability queries, records output, and waits for the real CLI's exit code.
It does not emulate Plandex or implement a file-read handler.

The CLI, backend and its real LiteLLM subprocess run beneath a macOS sandbox
that permits only loopback network connections and writes in the disposable
run directory or terminal devices. An explicit environment carries no user
provider credentials, proxies, HOME configuration or cloud authentication.
Only static tokenizer data is downloaded before the isolated processes start;
its URL and checksum are recorded. The custom OpenAI-compatible provider uses
Plandex's direct Go client; LiteLLM is still the real required startup service.

PostgreSQL is separate from those sandboxed processes. It receives only test
database credentials, has a UUID name and task label, a separately labeled volume, and publishes its port
only on `127.0.0.1` on a dedicated bridge. Docker's `--internal` network did not
publish a usable host port on this host, so the consumer uses an ordinary
dedicated bridge. It does not join existing application networks or touch
existing containers, volumes, databases, user config or auth. Database readiness
uses TCP: the temporary Unix-socket server used during PostgreSQL initialization
can report ready before the requested database exists.

## Upstream references

- [Custom models and providers](https://docs.plandex.ai/models/custom-models/): custom provider `baseUrl` support requires self-hosting.
- [CLI and backend source at the tested revision](https://github.com/plandex-ai/plandex/tree/e2d772072efadbe41d2946d97d79be55532dbab5/app).
- [Native context loading](https://github.com/plandex-ai/plandex/blob/e2d772072efadbe41d2946d97d79be55532dbab5/app/server/model/plan/tell_stream_finish.go).
- [CLI custom-model synchronization](https://github.com/plandex-ai/plandex/blob/e2d772072efadbe41d2946d97d79be55532dbab5/app/cli/cmd/models.go).
