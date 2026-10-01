# Injection at the consumer boundary {#current-injection-boundary}

Current scope: Cordyceps supplies a mock provider and environment, argument and optional configuration-file values. The app owns executable discovery, installation, invocation, shell startup, terminals and `.zshrc`. Cordyceps does not implement shell adapters, executable discovery, binary version probing, native launchers or a harness compatibility suite.

Use `ai.environment(baseEnv)` to construct an environment without modifying the original, and apply declared `ai.args` or generated config through the app’s existing configuration seam. The app retains its normal binary launch. A missing definition/codec is a library configuration error; installed-binary behavior belongs to the consumer's tests.

The original exploratory investigation below is retained as historical context. Its proposed shell adapters, wrapper platform support, binary probes and cross-platform delivery gates are superseded by this scope correction. They are not implementation requirements. The recorded experiments remain past observations, not a certification commitment.

# Historical investigation — superseded proposal {#historical-investigation}

# Configure the application launch {#configure-application-launch}

Recommendation: ship an npm library with a standalone session API and a Playwright adapter. Prepare the mock backend and provider configuration before launching the application under test, then give that application the session's environment. Offer PATH wrappers and an explicit wrapper path as additional integration choices. The real installed AI binary continues to execute.

The npm distribution and consumer-owned installation are user-confirmed constraints. The API below is a design sketch, not an implemented or agreed interface:

In this historical snippet, `cordyceps` and `ai` are proposed library APIs, `electron.launch` and the returned `app` methods belong to Playwright, and `appPath` is a consumer-supplied executable path. `process.env` is Node’s environment. The broader wrapper proposal remains superseded.

```ts
const ai = await cordyceps.prepare({ harness: 'claude-code' });
// Register provider request/response handlers before the app can make requests.
const app = await electron.launch({
  executablePath: appPath,
  env: ai.environment(process.env),
});
try {
  // Existing app code still discovers and runs `claude -p ...`.
  // Playwright drives the frontend; ai controls the provider responses.
} finally {
  await app.close();
  await ai.dispose();
}
```

The setup boundary is the application's process launch, including any backend or extension host that launches the harness. A test callback alone does not propagate environment changes into an already-running application. Playwright's Electron launcher accepts an explicit environment; Node documents child environment and PATH lookup semantics.[^launch-env]

# Application startup constraints {#application-startup}

Configure the application before it captures a shell environment or starts extension hosts. Cached environments, shell startup files and absolute executable paths can bypass later changes to PATH or provider settings. Application-side permission and trust setup must use the same isolated configuration as the harness.

# Integration choices {#integration-choices}

| Mechanism | Useful when | Boundary |
| --- | --- | --- |
| Provider environment and isolated config | App forwards its launch environment, including when it discovers an absolute binary path | Startup files, explicit child env, or provider settings can replace values |
| PATH directory containing a launcher | App discovers a command by name; launch configuration must be applied immediately before the real binary starts | Startup files, aliases/functions, cached or explicit paths can bypass it |
| Explicit launcher path | App already supports a configurable executable path | Requires setting that existing configuration; cannot transparently replace a hardcoded path |
| Shell startup adapter | App starts supported interactive/login shells and their startup files change PATH or provider env | Shell-specific and opt-in; arbitrary startup scripts are not universally controllable |
| Prepared settings in a disposable workspace/user profile | Provider reads native config and env forwarding is unavailable | Provider-specific precedence and trust rules; changes the tested profile/workspace |
| Process-spawn monkeypatch | Narrow Node-only experiment | Cannot cover native launches, another process, imported/cached functions, PTYs, or remote hosts; unsuitable as the default |

A symlink to the installed binary does not add an environment or config. The useful object is a launcher that sets provider configuration and delegates to a pinned absolute executable. A symlink can point to that launcher, but cannot replace it. The local probe confirms this distinction.[^probe]

Prefer the environment path first because it retains the application's actual binary-discovery behavior. A wrapper is an additional choice for enforcing config at invocation time. Tests should report which integration mode and real executable they exercised; substituting a PATH wrapper demonstrates discovery of that wrapper and execution of its target, rather than independently proving how the original install would rank on PATH.

# Shell handling {#shell-handling}

For zsh, `-l` alone does not load `.zshrc`; interactive mode does. The ordering is `.zshenv`, login `.zprofile`, interactive `.zshrc`, then login `.zlogin`, with corresponding system files. `ZDOTDIR` selects the user startup-file location.[^zsh]

Proposed adapter behavior: use session-owned forwarding startup files, run the user's original startup files at their normal phases, and reapply the Cordyceps environment and PATH afterwards. Preserve the real home directory so discovery through nvm and other user setup can still happen. Do not edit the user's startup files. Resolve/pin the real executable before exposing a wrapper with the same command name, preventing recursion.

The experiment proves this for controlled startup files only. Production support must account for existing `ZDOTDIR`, startup code changing it, shell functions/aliases, nested shells, startup failures, and hooks that alter state after initialization. Bash, fish, PowerShell and WSL require separate supported adapters or explicit environment/path integration; a zsh solution is not portable by itself. A shell that deliberately discards the supplied settings is outside a transparent guarantee.

Apply launch-time environment and configuration before the application captures its shell environment or starts extension hosts. Shell overlays require an explicit integration point in the application.

# Provider configuration and process behavior {#provider-config}

Claude documents `ANTHROPIC_BASE_URL`, `CLAUDE_CONFIG_DIR`, and settings-file environment blocks. Settings can overwrite inherited environment variables. A provider adapter must therefore handle configuration precedence and conflicting provider-selection settings, rather than assume a base URL export wins. Use a session-owned provider config directory; preserve application HOME and the normal tool permission behavior.[^claude]

Proposed session outputs:

- `environment(baseEnv)`: a complete child environment after provider-specific overrides and removals, avoiding accidental retention of a conflicting provider setting. Normalize Windows PATH casing.
- `binDir`: an optional directory of command-name launchers for PATH discovery.
- `executablePath`: an optional explicit launcher for apps that expose that setting.
- A shell-specific overlay option, plus an inspection report describing executable selection, configuration, and whether the mock actually received traffic.

All surfaces refer to one backend session and share request handlers and observations. The wrapper uses an absolute real target, forwards argv and preserves cwd and inherited standard streams. A POSIX `exec` launcher is a useful starting point; signal, cancellation, PTY resizing, and terminal identity require explicit compatibility tests. Windows needs an actual native launcher for native applications; npm distribution can include platform helpers. Renaming a script to `.exe` does not make one, and `.cmd` requires a shell.[^node-windows]

A global `process.env` mutation around an async callback is process-wide and races other work. Prefer a separate application process per isolated session or an explicit session-routing contract for a shared app. A Playwright web server started before a test, an already-running Electron instance, a remote daemon, or a cached shell cannot be reconfigured merely by changing the test worker's environment. Apply configuration where those processes start. This is an integration constraint, not a reason to replace their internal binary invocation code.

# Observation boundary {#observation-boundary}

The backend can record requests it receives, but cannot reconstruct the exact stdin bytes sent to the harness. An exec launcher can observe argv at launch; it cannot tee ongoing stdin after replacing itself. Exact raw input/output capture needs consumer-provided process hooks or an optional I/O proxy/PTY driver. Such a driver must prove that it preserves interactive behavior. The existing raw-input requirements remain requirements; this investigation identifies an unresolved design obligation and does not silently replace them with provider-request observations.

Provider reachability should be proved by observed traffic from the actual launched path, with a bounded diagnostic failure if interception is absent. Environment configuration alone is not a network-isolation guarantee. A strict guarantee against live-provider traffic would need an additional egress boundary.

# Experiment and limits {#experiment}

Ran `node experiments/launch-injection.mjs /Users/20idemo/.local/bin/claude` on macOS with Node `v22.22.3`. All 11 assertions passed:[^probe]

1. A symlink alone does not inject configuration.
2. A PATH launcher applies configuration and forwards arguments containing spaces.
3. An absolute binary path receives inherited configuration.
4. An absolute path bypasses a PATH-only launcher.
5. Login-only zsh does not read the synthetic `.zshrc`.
6. Interactive login startup files overwrite the initial PATH and provider setting.
7. An explicit launcher restores configuration after startup.
8. Forwarding startup files preserve the synthetic rc behavior and restore the overlay.
9. Discovery then resolves the launcher.
10. An exec launcher preserves the tested stdin/stdout payload.
11. An already-running child retains its launch environment.

The optional real-binary check delegated `--version` to installed Claude Code and returned `2.1.283 (Claude Code)`. Most assertions use a synthetic executable and synthetic rc files; no personal dotfiles were changed. This is not a real model-protocol test, PTY test, Windows run, or full application E2E. No Cordyceps library implementation has been built.

Recommended next proof: launch a packaged application with session-owned environment/config before startup; exercise both a terminal and chat through the real installed Claude, then script a file-read tool call and verify the actual result. Follow with native Windows launch coverage before claiming cross-platform transparency. Those are proposed next experiments, not completed evidence.

# Sources {#sources}

[^launch-env]: [Playwright Electron launch](https://playwright.dev/docs/api/class-electron#electron-launch) documents its `env` option. [Node child-process documentation](https://nodejs.org/api/child_process.html) documents child environment inheritance, PATH lookup and Windows key casing. Consulted 2026-09-29.

[^zsh]: [Official zsh startup-file documentation](https://zsh.sourceforge.io/Doc/Release/Files.html), consulted 2026-09-29. Startup-order summary plus the controlled probe, not a guarantee for arbitrary user scripts.

[^claude]: [Claude Code environment variables and precedence](https://code.claude.com/docs/en/env-vars), consulted 2026-09-29. Actual supported routing and precedence must be tested against each supported binary version.

[^node-windows]: [Node Windows batch-launch restrictions](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows), consulted 2026-09-29.

[^probe]: Reproducible local experiment: `experiments/launch-injection.mjs`. Results described above were observed on 2026-09-29, before committing this investigation. This experiment is evidence about launch mechanics, not delivery evidence for the library.
