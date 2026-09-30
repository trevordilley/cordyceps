# Harness registry and injection

Cordyceps definitions describe provider injection data. The consumer chooses and launches its executable or ACP adapter, supplies prompts, owns its ACP client, and closes its processes. Registration and rendering do not probe binaries, read shell startup files, invoke commands, mutate `process.env`, or certify a harness.

`createRegistry()` loads the bundled definitions listed in the [DevSwarm agent observations](devswarm-agents.md) and [Superset/Orca agent audit](orchestrator-agents.md), including the separate `claude-code-acp` recipe. `createRegistry({ builtins: false })` starts empty. `register(unknown)` validates and snapshots a definition; `await loadFile(path)` parses a local JSON file through the same validator. Duplicate IDs fail rather than replace an entry. `get(id)` returns an independent definition snapshot or throws `DEFINITION_NOT_FOUND`. `list()` returns independent snapshots in registration order. Changes to input objects, inspection results, or later registry registrations cannot modify an already captured definition.

## Definition shape

This custom example uses fictional environment names and adapter arguments. They are **not** Claude Code or Codex flags:

```json
{
  "schemaVersion": 1,
  "id": "my-adapter",
  "provider": {
    "adapter": "anthropic-messages",
    "override": {
      "env": {
        "MY_PROVIDER_CONFIG": "${config.provider.path}",
        "MY_PROVIDER_KEY": "${mock.apiKey}"
      },
      "unsetEnv": ["MY_OLD_PROFILE"],
      "configFiles": [{
        "id": "provider",
        "path": "provider/config.json",
        "format": "json",
        "values": { "baseUrl": "${mock.baseUrl}" }
      }]
    }
  },
  "modes": {
    "interactive": { "args": [] },
    "acp": { "args": ["--example-harness", "${input.harnessPath}"] }
  }
}
```

Only the displayed top-level fields are supported. `provider.override` and each mode can contain `env`, `unsetEnv`, `args`, and `configFiles`; all four recipe fields are optional. Empty recipes are valid. `provider.override` is required; use `{}` when empty. At least one named mode is required. IDs and mode/input names start with an ASCII letter or digit and contain only letters, digits, underscores, and hyphens. Environment names use `[A-Za-z_][A-Za-z0-9_]*`.

Definitions must be acyclic plain JSON data: strings, finite numbers, booleans, null, arrays, and plain objects, with a maximum depth of 64. Getters, functions, symbol keys, sparse arrays, custom prototypes, non-enumerable fields, and unknown schema fields fail. Strings must be valid Unicode without NUL. No executable, version, platform, shell, or probe fields are accepted. Provider adapters must appear in the library's `codecIds` (`anthropic-messages`, `openai-responses`, `openai-chat-completions`, `google-genai`, `amazon-q`, `augment`, `atlassian-rovo`, `amp-service`, `hermes`, `muse-code`, and `grok-build`).

Common and selected-mode arguments concatenate in that order. Environment assignments cannot repeat across recipes, even with equal values, or also appear in removals. Repeated removals are deduplicated. File IDs must be unique in each combined recipe. Paths cannot duplicate, differ only in case, or overlap as a file and directory. These are declaration checks: Cordyceps does not parse consumer arguments or determine which effective setting a harness will use.

## Tokens and selection

Templates support exactly `${mock.baseUrl}`, `${mock.apiKey}`, `${session.dir}`, `${config.<id>.path}`, and `${input.<name>}`. Substitution runs once on environment values, argv entries, and nested string **values** in config files. Keys and file paths are literal. Inputs are opaque strings; a path input is never resolved or inspected, and token-looking input text is not expanded recursively. Unknown or malformed tokens and references to absent config files fail at registration. Required input values are checked at selection time; empty strings count as supplied values.

Internally, `validateSelection(definition, mode = 'interactive', inputs = {})` is synchronous and allocates no resources. Core calls it before allocating its listener. It validates a fresh definition snapshot, the requested mode and codec, conflicts, and required inputs. Modes have no fallback: requesting a missing `acp` recipe produces `RECIPE_NOT_FOUND`. Custom definitions may use `acp` or other names without Cordyceps making any claims about the selected executable's protocol support.

Validation failures are `DefinitionError` instances with `code`, `definitionId`, and `field`. Messages identify the definition and JSON field. Codes include `INVALID_DEFINITION`, `INVALID_JSON`, `DUPLICATE_ID`, `DEFINITION_NOT_FOUND`, `CODEC_NOT_FOUND`, `RECIPE_NOT_FOUND`, `UNKNOWN_TOKEN`, `MISSING_INPUT`, `INVALID_INPUT`, and `INJECTION_CONFLICT`. Filesystem errors retain their original errors and codes.

## Rendering and ownership

Consumers use the root `prepare` export. `validateSelection` and `renderInjection` below are implementation helpers, not root package exports.

Internally, `await renderInjection(definition, mode, inputs, { baseUrl, apiKey }, signal?)` captures definitions and inputs before its first asynchronous operation. It repeats selection validation, creates a private temporary directory, serializes config, and returns:

- `environment(base)`: a new object containing the supplied base, declared removals, and rendered overrides. Neither the base nor global environment is changed; no implicit environment is read.
- `args`: common then selected-mode argv values, without shell quoting or an executable name.
- `configFiles`: `{ id, path, format }` entries with absolute generated paths.
- `dispose()`: removes the owned temporary directory, including any state the consumer's harness placed inside it. Concurrent and repeated successful calls are idempotent. A failed cleanup can be retried.

Paths are static, portable, session-relative names with `/` separators. Components allow ASCII letters, digits, `_`, `-`, and `.`, excluding `.`/`..`, trailing dots, and Windows device names. Absolute paths, drive names, backslashes, empty components, traversal, and tokenized paths fail before allocation. Files are created exclusively (`wx`) with mode `0600`; nested directories use `0700`. Existing consumer configuration files are never opened for writing. Filesystem permissions may vary on Windows.

JSON accepts the JSON values above. TOML accepts the same values except null, which fails before allocation, including in nested arrays. JSON config files accept an object or array at the root; TOML requires an object. Scalar JSON roots remain unsupported. Array-root JSON uses the same validated values, token substitution and exclusive file creation as object-root configuration. TOML uses quoted keys, basic strings, arrays, and inline tables; dates, raw syntax, comments, and arbitrary-precision integers are not supported. Unsafe JavaScript integers serialize as TOML floats rather than out-of-range integer literals. Structured serialization preserves quoting, escapes, dotted keys, empty objects, and nested arrays without treating values as config syntax.

The optional signal cancels **preparation**. Already aborted signals allocate nothing. Cancellation or failure during creation removes acquired files/directories before rejecting. If rollback also fails, an `AggregateError` retains both causes. A successful renderer hands ownership to the caller, who must call `dispose()`; core handles its longer session signal lifetime and listener rollback separately. Close consumer processes before disposing files they may still need. Temporary-directory isolation and cleanup do not provide a sandbox for a malicious process modifying that directory.

## Bundled recipes and documentation evidence

`claude-code` and `codex` have `interactive` and `nonInteractive` modes. The separate `claude-code-acp` definition has only `acp` mode, verified with the official Claude Agent ACP adapter. Missing modes still fail explicitly; selecting `claude-code` with `mode: 'acp'` does not silently choose an adapter.

### Claude Code (`claude-code`)

The recipe sets `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`, removes competing inherited provider/auth switches, and sets `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Interactive mode adds no arguments; non-interactive mode adds `--print`. Settings and semantics were checked on 2026-09-29 against the official [environment variables reference](https://code.claude.com/docs/en/env-vars), [gateway documentation](https://code.claude.com/docs/en/llm-gateway), and [CLI reference](https://code.claude.com/docs/en/cli-reference).

Interactive Claude Code can ask the user to approve an API key. Settings files can also override inherited environment values; this recipe does not edit them. The consumer remains responsible for its harness settings and for asserting that provider traffic reaches the mock. Disabling nonessential traffic is not a network-isolation guarantee.

### Codex (`codex`)

The recipe creates `config.toml` in the owned session directory and supplies that directory as `CODEX_HOME`. It selects a custom `cordyceps` provider with the mock URL plus `/v1`, `wire_api="responses"`, `supports_websockets=false`, and `env_key="CORDYCEPS_API_KEY"`. `CORDYCEPS_API_KEY` is a library-chosen variable name referenced by that documented `env_key` setting; it is not presented as a built-in Codex variable. Interactive mode adds no arguments; non-interactive mode adds the `exec` subcommand, which the consumer places before its prompt and invocation-specific arguments.

Verified on 2026-09-29 against official [advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), and [developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli). These are the current destinations of the developers.openai.com Codex documentation links. `CODEX_HOME` relocates Codex config **and state**; the recipe intentionally uses an isolated directory and does not copy the consumer's existing settings, credentials, or history. Other consumer flags/config layers can still affect effective settings. It does not select a model, permissions, approval policy, or ACP adapter.

### Claude Agent ACP (`claude-code-acp`)

Select `prepare({ harness: 'claude-code-acp', mode: 'acp' })`, then launch your own `@agentclientprotocol/claude-agent-acp` process with the returned environment and arguments. The recipe routes Anthropic traffic to the mock, sets an isolated `CLAUDE_CONFIG_DIR`, disables nonessential traffic, and removes inherited authentication/provider/executable overrides. The consumer retains executable choice, ACP SDK setup, session options, permissions and process cleanup. The [real ACP example](real-acp.md) shows the exact adapter configuration and verified lifecycle.

Bundling means a data recipe, not executable certification. Registry unit tests use JSON and generated files; the separate packed [CLI](real-cli.md) and [ACP](real-acp.md) examples launch real consumers and record actual outcomes.

## Verification

`tests/registry.test.ts` covers strict validation, duplicates, snapshots, missing codecs/modes/inputs, finite tokens, conflicts, environment purity, single-pass opaque inputs, JSON/TOML rendering, bundled/local parity, concurrent isolation, partial-write rollback, abort rollback, and cleanup retries. TOML ordinary values round-trip through Bun's independent TOML parser; exact escape fixtures cover controls that Bun 1.3.13's parser mishandles. A separate verification with Python's standard `tomllib` confirmed the complete quoted/control-character/nested-value fixture round-trips. No TOML runtime dependency or package change is required.

## Contributing a definition

To keep a recipe private, register it or load its JSON file in your own test setup. To contribute a bundled recipe, submit a pull request with `harnesses/<id>.json`, add its ID to the bundled loader in `src/registry.ts`, and add focused rendering/validation tests in `tests/registry.test.ts`. Include links to the harness's actual documented provider settings and a packed-artifact consumer example proving controlled text and an actual tool result with the authentic harness. Leave executable selection and launch in consumer code. Test the expected environment, arguments and generated config using synthetic values; an installed-binary certification report or version/OS matrix is not required.

A new harness sharing an existing wire format uses the existing codec ID. A new wire format also needs a real codec implementation, registration in `src/provider/index.ts`, and synthetic wire fixtures covering its text, tools, streaming, errors and cancellation behavior. Fictional settings are suitable for clearly labeled private test fixtures, not bundled real-harness recipes. Acceptance of a contribution and npm release remain maintainer actions.
