# Real Auggie consumer

`examples/real-auggie/verify.mjs` builds Cordyceps, packs it, installs the tarball in a disposable Node consumer, and imports only `cordyceps`. The consumer loads `auggie.json` from that installed artifact. It launches the installed Auggie executable and owns HOME, files, test credentials, process groups, timeouts, and cleanup. No process or tool execution occurs in the library.

Reproduce on macOS with Bun for building and real Node 22 first on PATH:

```sh
hivecontrol exec oneshot 3m -- env \
  PATH=/Users/20idemo/.nvm/versions/node/v22.22.3/bin:/Users/20idemo/.bun/bin:/usr/bin:/bin \
  AUGGIE_BINARY=/Users/20idemo/.bun/bin/auggie \
  /Users/20idemo/.nvm/versions/node/v22.22.3/bin/node \
  examples/real-auggie/verify.mjs /tmp/cordyceps-auggie-evidence.json
```

The verifier accepts `AUGGIE_BINARY`; otherwise it resolves `auggie` on PATH. It rejects Bun masquerading as Node. The consumer's macOS sandbox denies outbound network except the mock's loopback port and denies writes outside its scratch root, `/dev/null`, and `/dev/tty`. HOME and XDG paths are scratch directories; the environment is explicitly constructed without inherited credentials. The fixture contains a random token never included in the prompt or scripted tool arguments. Actual tools run only in the disposable workspace. User auth and settings are not modified. Installing Auggie remains the developer's responsibility.

## Protocol and injection

The `auggie` recipe selects the `augment` codec. `AUGMENT_SESSION_AUTH` contains the test key, loopback `tenantURL`, and required `scopes: ["email"]`. The recipe also supplies `--provider-model`, `--provider-api-key`, and `--provider-base-url`. These flags produce `third_party_override` inside the native service request; they do not make Auggie send an OpenAI or Anthropic request directly. `inputs.model` selects that override name. Interactive mode adds no mode arguments; the verified noninteractive mode adds `--print`. Interactive TUI and ACP are not claimed by this example.

The codec handles exactly these POST paths (optional query allowed):

- `/chat-stream`: JSON requests with current/history text nodes, `input_schema_json` tool definitions, and `tool_result_node` results. The effective model is `third_party_override.provider_model_name`, falling back to `model`. Opaque nodes remain in the raw/body capture. Responses are newline-delimited JSON, with text/type-0 nodes, type-5 tool nodes containing JSON argument strings, and one native `END_TURN` or `TOOL_USE_REQUESTED` stop reason. Text nodes retain content for native conversation history.
- `/get-models`: explicitly fulfill `{ augmentModels: { defaultModel: "cordyceps-test" } }` to return a native default-model value and empty model/language arrays. This narrow bootstrap is not a full model registry or feature-flag API. Scripted HTTP errors are also supported.
- `/settings/get-mcp-tenant-configs`, `/settings/get-mcp-user-configs`, `/agents/list-remote-tools`: decoded and captured, with explicit scripted HTTP errors only. The consumer chooses 404 responses to disable optional remote services. These calls and their retries are not hidden or automatically fulfilled.
- `/find-missing`: the native `DiskFileManager` may probe fixture blob hashes in `mem_object_names`, with an optional `model`. The JSON object is captured unchanged as an auxiliary request, with no generation text, tools or results. Only an explicit scripted HTTP error is accepted; the consumer returns 404. No missing-blob list, successful indexing response, upload or remote index is synthesized. Neighboring `/batch-upload` and `/checkpoint-blobs` APIs remain unsupported.

All other paths fail visibly. Unhandled supported requests still fail; all responses use the shared HTTP listener's captures, failure ledger, backpressure and abort signal. Generation does not accept bootstrap responses. Other provider codecs reject `augmentModels`.

A successful `/get-models` bootstrap is necessary for prompt evidence in Auggie 0.35.0. Its `promptEnhancement` setup requires successful feature flags even when enhancement is disabled. Returning 404 makes its `enhancedNodes` getter return an empty array: the binary can make a chat request and execute a scripted tool without sending the user's initial prompt. The consumer therefore asserts the actual prompt in captured chat traffic, independently of CLI argv and input observations.

## Verified observations

Observed with installed `@augmentcode/auggie` 0.35.0 and Node 22.22.3 on macOS. Evidence records the actual executable SHA-256, package integrity, public installed entry, captured requests, wire responses, process output, and cleanup.

- Text: the captured initial prompt produces the controlled stdout marker and exit code 0.
- Tool: a native `view` call reads `fixture.txt`. The next captured request contains the unpredictable token in a successful result with the exact tool-call ID. The token is absent from the initial request, and the controlled final marker appears with exit code 0. No tool result is synthesized by the backend.
- Stream: the actual process prints the first text segment while the response remains pending. Only that observed stdout event releases the final segment; the process then exits 0.
- Cancel: after actual partial stdout, the consumer kills the process group. The HTTP route observes abort, records an aborted response, and no final segment appears. This proves consumer-owned process cancellation, not native session reuse or an interactive interrupt command.

Each run asserts a healthy failure ledger, the exact count of generation requests (one, two, one, one), scratch cleanup, and a closed listener. Optional bootstrap retries are recorded separately. Full evidence is written to the caller's output path; `examples/real-auggie/evidence.json` is a compact checked-in summary. Unsupported service APIs, model registry entries, indexing, hosted tools, multimodal output, reasoning, and other releases are not claimed.

## Hosted reproduction finding

A hosted macOS run of the same Auggie 0.35.0 produced the expected native text,
but failed the healthy-ledger assertion because background `DiskFileManager`
issued `POST /find-missing` before that reply completed. Its debug receipt showed
the real fixture hash being enqueued, a one-blob probe and an HTTP 404 failure.
The other tool, stream and cancellation cases passed. The codec now recognizes
that exact auxiliary path so the existing consumer's explicit 404 script can
reject remote indexing while retaining the request and its response in the
shared capture/failure lifecycle. An unhandled probe still fails; the consumer
does not filter it out. The correction passed all four real cases in
[hosted run 36739752968](https://github.com/trevordilley/cordyceps/actions/runs/36739752968).

## Source evidence

Inspected 2026-09-29: the installed `@augmentcode/auggie/augment.mjs` 0.35.0 contains `callApiStream`'s newline parser, `toChatResult`/`zpt`'s text/nodes/stop-reason mapping, `toGetModelsResult`'s bootstrap parser, the type-5 tool-node construction, and `pushToolCallResult`'s type-1 result construction. Inspection on 2026-09-30 of the same installed release confirmed that `findMissing` constructs a POST body containing sorted `mem_object_names` and an optional `model`; `DiskFileManager` calls it while probing local blob hashes. This supports capturing the probe, not implementing its successful indexing response. The installed package is the source of the proprietary wire subset; this is not presented as a stable published service API.

Official [Auggie README](https://github.com/augmentcode/auggie) documents `--print` and developer installation. Augment's [CI integration guide](https://www.augmentcode.com/guides/cicd-ai-agents-pipeline-integration) documents `AUGMENT_SESSION_AUTH` and disabling auto-update. Those general CLI references do not specify the native service schema above.
