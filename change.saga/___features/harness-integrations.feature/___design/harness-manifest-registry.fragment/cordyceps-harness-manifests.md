# Current implementation — 2026-09-30 {#manifest-delivered}

schemaVersion 1 uses provider.adapter/provider.override/modes. Local and bundled definitions share the validator. Supported tokens are mock.baseUrl, mock.apiKey, session.dir, config.<id>.path and input.<name>. Generated-file paths are static and session-relative; values are structured JSON or a documented TOML subset. JSON configuration roots accept objects or arrays, while TOML roots require objects and scalar JSON roots fail. Array roots retain validation, single-pass substitution, isolated file creation and cleanup; this supports native connection-list configuration without hand-written replacement files.

The expanded recipes are grounded in packed-artifact native text and actual file-read evidence in the verified harness inventories. A documented endpoint alone does not establish support. Codebuff's source-only profile and Polygraph's Claude-launching profile retain their actual identities and limits. Recipe data supplies mode/provider settings; consumers select permission, tool, logging and orchestration policy. Recipe selection does not itself establish a test outcome. Local packed-artifact evidence covers 43 native families; completed hosted run 36740569377 at 8a8bbfe passed all 34 configured families. Nine other locally verified families lack hosted setup; docs/ci.md names them and separates that coverage boundary from observed success.

Bundled claude-code and codex provide interactive/nonInteractive modes; the separate claude-code-acp definition provides only acp mode and isolated Claude config for the actual official adapter. Missing modes fail with RECIPE_NOT_FOUND. The packed ACP example verifies this data recipe without adding executable discovery, launch, capability negotiation or certification to the library. CLI presence does not imply ACP support.

This section describes delivered library behavior; exact code evidence is attached to its heading. Current implementation slides precede the retained proposal slides. Verification limits and consumer acceptance gaps are recorded in docs/verification.md; implementation evidence is not a product approval or a real-harness certification.

# Original proposal and design context {#original-proposal-and-design-context}

The material below preserves the original proposal. Its API sketches and statements that no implementation exists are historical; the current section above and package guides take precedence for shipped behavior.

# Harness injection definitions {#harness-injection-definitions}

Cordyceps is a mock provider with declarative injection settings. The consuming app owns installing, finding, selecting and launching its binary, including any ACP adapter, shell, terminal or `.zshrc` behavior. Cordyceps does not run version probes, manage binary compatibility ranges, certify harnesses, or require a special runner.

## One definition for local and bundled use {#one-definition}

A harness author or integration contributor describes provider overrides and mode-specific arguments/configuration in JSON. The same registry loads a private file or a bundled entry such as `claude-code.json`. A bundled entry means a provided configuration recipe, not certification of a binary or OS/version matrix.

A new harness using an existing provider API needs a definition. A new provider wire protocol needs a codec implementation to parse requests and encode replies; that codec still does not launch the harness.

## Example definition {#example-definition}

Fictional variable names and flags below illustrate the proposed format, not actual Claude Code or Codex settings.

```json
{
  "schemaVersion": 1,
  "id": "my-harness",
  "provider": {
    "adapter": "anthropic-messages",
    "override": {
      "env": {
        "MY_HARNESS_API_URL": "${mock.baseUrl}",
        "MY_HARNESS_API_KEY": "${mock.apiKey}"
      },
      "unsetEnv": ["MY_HARNESS_PROFILE"]
    }
  },
  "modes": {
    "interactive": { "args": [] },
    "nonInteractive": { "args": ["--print"] },
    "acp": { "args": ["--acp"] }
  }
}
```

`schemaVersion` concerns the JSON format only. There are no binary version ranges, executable discovery candidates, probe commands, platform selectors or automated compatibility gates. Modes name data recipes; an absent mode is a configuration error rather than a reason to try another invocation.

## Proposed use {#proposed-use}

The following is an API sketch. `cordyceps`, `registry`, `ai` and route controls are proposed library APIs; `process.env` is Node’s environment. The relative helper module and application assertions are supplied by the consumer.

```js
// Proposed Cordyceps package API; not implemented.
import { cordyceps } from 'cordyceps';
// Your own helpers; names, options and app methods are illustrative.
import { startMyApp, exerciseMyFrontend } from './your-test-helpers';

const registry = cordyceps.createRegistry();
await registry.loadFile('./my-harness.json');
const ai = await cordyceps.prepare({
  registry, harness: 'my-harness', mode: 'acp',
});
try {
  await ai.route(() => true, r => r.fulfill({ text: 'Hello' }));
  const app = await startMyApp({
    env: ai.environment(process.env),
    extraHarnessArgs: ai.args,
  });
  try { await exerciseMyFrontend(app); }
  finally { await app.close(); }
} finally { await ai.dispose(); }
```

`startMyApp` is imported from the consumer’s own test helpers and is not a Cordyceps API. The helper name, options, `exerciseMyFrontend` and returned app methods are illustrative consumer code. The app retains its binary and adapter selection, process creation and ACP client. A consumer may use ordinary process APIs directly outside Playwright. Supplying injection data through the app's existing configuration seam does not imply modifying or replacing its binary implementation.

## Configuration and ownership {#configuration-and-ownership}

Definitions can supply environment additions/removals, additional argv values and structured JSON/TOML files in a Cordyceps-owned temporary directory. The library substitutes backend-generated endpoint values and optional caller-supplied inputs, serializes files, and exposes the resulting data. Caller-provided binary paths, if needed in an argument, are opaque inputs; Cordyceps does not resolve, inspect or launch them.

`environment(baseEnv)` is a pure merge into a returned object. It neither changes global process.env nor reads startup files. The app chooses where to apply the values through its own process setup. Shell configuration, environment caching and forwarding are application responsibilities, not library features. No shell adapter, native launcher, binary shim or PATH wrapper is required by this proposal.

ACP mode can declare arguments and config for the consumer's chosen invocation. The real consumer client negotiates protocol version and capabilities with the real process. The JSON definition is not a capability certificate and the mock backend does not create ACP messages itself.

## Contributions and library tests {#contributions-and-library-tests}

A contribution supplies the definition and examples or focused library tests of its data transformation. Test JSON validation, token replacement, environment merging, generated config, request decoding, response encoding, streaming, route isolation and cleanup using library-owned fixtures and synthetic provider requests. Do not require installed binaries or a harness certification suite to contribute.

Consumers can use Cordyceps in their own end-to-end tests to prove their app works through a real installed binary. Those tests and their platform coverage belong to the consumer. Prior shell/binary experiments were exploratory evidence and create no Cordyceps version-support obligation.

This is a proposed API and format; no implementation is claimed.
