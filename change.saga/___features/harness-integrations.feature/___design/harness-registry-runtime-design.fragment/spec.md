# Current implementation — 2026-09-29 {#registry-runtime-delivered}

The implementation provides strict manifest validation, createRegistry/register/loadFile/get/list snapshots, pure environment merging, additional argv and isolated JSON/TOML config files. prepare validates before listener allocation and rolls back failed rendering; dispose releases owned backend/config resources. Conflicts and unknown modes/codecs/inputs fail explicitly, and tokens expand once. Registry and renderer helpers are internal; consumers use the root prepare API. Claude Code and Codex retain interactive/nonInteractive recipes. The separate claude-code-acp recipe has actual packed-consumer evidence through the official adapter and standard ACP SDK. It only supplies injection data; consumers still choose and launch their own executable and perform negotiation, tool permissions and cleanup.

This section describes delivered library behavior; exact code evidence is attached to its heading. Current implementation slides precede the retained proposal slides. Verification limits and consumer acceptance gaps are recorded in docs/verification.md; implementation evidence is not a product approval or a real-harness certification.

# Original proposal and design context {#original-proposal-and-design-context}

The material below preserves the original proposal. Its API sketches and statements that no implementation exists are historical; the current section above and package guides take precedence for shipped behavior.

# Injection registry implementation proposal {#injection-registry-implementation}

The accepted scope is data-driven injection around a consumer-owned binary. Cordyceps owns its mock backend and configuration artifacts. The app owns binary selection, discovery, launching, shells and ACP clients. There is no harness runner, binary version probing, compatibility matrix or harness certification service.

## Data flow {#data-flow}

```text
local or bundled JSON → registry → selected injection recipe
                                         + mock endpoint
                                         + caller inputs
                                                ↓
                          environment / extra args / config files
                                                ↓
                               consumer's existing app setup
                                                ↓
                     app launches its own real binary or ACP adapter
                                                ↓
                       provider requests → Cordyceps → scripted replies
```

## Modules {#modules}

One npm package contains `manifest` (JSON validation), `registry` (local/bundled data), `injection` (environment/args/config rendering), `provider` (mock backend and codecs) and `playwright` (fixture lifecycle over the same core). Bundled definitions live in `harnesses/`. These are proposed modules. No binary resolver, shell adapter, version manager or process runner is part of them.

## Registry {#registry}

`createRegistry({builtins: true})` creates a registry. `loadFile(path)` and `register(definition)` add data; duplicate IDs fail. `get(id)` supports inspection. Preparation captures a snapshot so later registrations cannot change an active test. A default registry contains bundled definitions. No remote marketplace, package downloading or executable hooks are required.

Validate only the data contract: supported JSON format, field types, known provider codec, finite token names, valid generated-file references and requested mode existence. Validation must not read an installed executable, run `--version`, inspect a user's shell or claim the harness understands its settings. Errors name the definition and JSON field. An unknown mode is `RECIPE_NOT_FOUND`, not a binary compatibility failure.

## Injection recipe {#injection-recipe}

A definition selects a provider codec and declares common provider overrides. A `modes` entry supplies the additional settings/arguments for a consumer-selected mode such as ACP. There are no automatic binary/platform/version variants. The caller selects an appropriate named definition; the library does not infer one by examining the machine.

Initial outputs are:

- `ai.environment(baseEnv)`: returns a new object after declared removals and overrides; never mutates the base or global environment.
- `ai.args`: additional arguments to apply to the consumer's chosen command. No executable path is selected or returned.
- `ai.configFiles`: generated files identified by definition ID and path, owned until dispose.
- Existing `ai.route`, request observations and `ai.dispose` for mock-provider control.

Common provider settings and mode-specific additions are merged deterministically; conflicting definitions of an injection field are rejected instead of relying on implicit precedence. `environment` applies removals and final overrides to the caller-provided base. The caller controls its complete command and other arguments. Cordyceps does not parse arbitrary application flags to certify their effective behavior.

Finite substitution tokens include `mock.baseUrl`, `mock.apiKey`, `session.dir`, `config.<id>.path` and explicit `input.<name>` values. Inputs can include a path that an ACP adapter expects; it is an opaque string supplied by the consumer, not a path Cordyceps discovers or verifies. Unknown tokens and missing inputs fail. No shell expansion or executable expressions.

Typed `configFiles` specify an ID, session-relative path, format (`json` or `toml`) and values. Serialize structured data rather than concatenating syntax. Do not edit user config files. A definition can expose the generated path through env or args. File ownership and cleanup apply to Cordyceps artifacts only.

## Preparation lifecycle {#preparation-lifecycle}

`prepare({registry, harness, mode, inputs})` validates the selected data, starts the mock backend, creates any needed config directory/files and returns injection outputs. It never starts the harness. An AbortSignal may cancel preparation; failure rolls back acquired backend/filesystem resources. Register routes before the consumer starts its app.

Each prepared run owns routes, requests, held streams and generated files. `dispose()` aborts its pending provider work, closes its backend and removes its files; it is idempotent and attempts all cleanup after a partial failure. It does not kill, discover or inspect app processes. The consumer should finish/close its app before disposing configuration that the app may still need.

Concurrent tests may share immutable registry data, but each has independent backend/config/route state. No process.env swapping around async test callbacks. No installation, login-shell startup, dotfile forwarding, PATH rewriting, process-spawn interception or implicit binary wrapper.

## ACP remains the consumer's interface {#acp-consumer-interface}

A selected ACP recipe can return flags and config around whatever binary or adapter the consumer already launches. If the consumer's ACP adapter needs a harness path, the consumer supplies that input. Cordyceps does not decide between native ACP and an external adapter, resolve either executable, or prove an adapter forwards environment values.

The consumer's real ACP client negotiates version/capabilities, creates sessions, handles messages/tools/permissions and cancels turns. Protocol-version handling in that client is separate from the removed executable-version support policy. The existing ACP lifecycle examples describe consumer tests that Cordyceps enables, not a conformance suite the library requires or ships.

## Provider codec {#provider-codec}

The selected codec decodes actual provider HTTP requests and encodes scripted text, tool calls, streams and errors. Retain raw traffic alongside normalized observations; actual offered tool schemas remain authoritative. Codec response context tracks provider identifiers without inventing an ACP ID mapping.

Streaming handles backpressure, abort, disconnect and terminal framing. Route assertion failures surface to the consumer test, while deliberately scripted provider errors retain their intended semantics. Codec tests use synthetic request/response fixtures and verify Cordyceps behavior. A new provider wire format requires codec code; a new harness using an existing format can remain a JSON contribution. This requirement concerns network protocol behavior, not harness execution tooling.

## Usage examples {#usage-examples}

Standalone consumers use the same injection surface with ordinary process APIs or an existing app helper. They choose their own command and connection implementation.

The following is an API sketch. `cordyceps`, `registry`, `ai` and route controls are proposed library APIs; `process.env` is Node’s environment. The relative helper module and application assertions are supplied by the consumer.

```js
// Proposed Cordyceps package API; not implemented.
import { cordyceps } from 'cordyceps';
// Your own helpers; names, options and app methods are illustrative.
import { startMyApp, exerciseMyApp } from './your-test-helpers';

const ai = await cordyceps.prepare({ harness: 'my-harness', mode: 'acp' });
try {
  await ai.route(() => true, r => r.fulfill({ text: 'Hello' }));
  const app = await startMyApp({
    env: ai.environment(process.env), extraHarnessArgs: ai.args,
  });
  try { await exerciseMyApp(app); }
  finally { await app.close(); }
} finally { await ai.dispose(); }
```

Playwright owns the same prepared mock in a test fixture. `startMyApp` is imported from the consumer’s own test helpers, not Cordyceps. Its name, options, `exerciseMyApp` and returned app methods are illustrative consumer code; it applies the supplied settings at an existing application boundary and retains its normal process-launch logic. Browser-side assertions test the frontend's behavior through the real binary. Cordyceps does not need to understand how that application handles shell initialization or cached environments.

## Library verification and contributions {#library-verification}

| What Cordyceps tests | Fixture/assertion |
| --- | --- |
| Definition handling | Invalid fields, missing recipe/codec/input and duplicate ID diagnostics |
| Injection rendering | Known inputs produce expected env additions/removals, extra args and serialized config |
| Side effects | Preparation never probes a binary or mutates caller env/dotfiles |
| Mock protocol | Synthetic HTTP requests decode correctly; scripted text/tools/errors/streams encode correctly |
| Resources | Failed file rendering closes backend; dispose aborts held routes and removes owned files |
| Concurrent runs | Independent requests and replies; disposing one does not affect another |
| Distribution | Bundled and local JSON use the same loader and injection path |

A PR adds the definition plus examples or focused tests for this contract. It does not need a binary version range, OS support matrix, real-binary certification report, shell adapter or dedicated harness test tooling. The consumer decides which real-binary end-to-end tests to run for its own application.

## Implementation sequence {#implementation-sequence}

1. Define the small JSON schema and registry with bundled/local parity.
2. Implement pure injection rendering and session-owned config generation.
3. Connect mock provider codecs, routing and observation to prepared injection values.
4. Expose the same lifecycle through standalone and Playwright APIs.
5. Add bundled recipes through that same data contribution path.

Exact field naming and codec internals remain proposed. The first implementation should be small enough that adding a harness using an existing provider protocol is primarily a configuration change. No implementation code is delivered by this document.
