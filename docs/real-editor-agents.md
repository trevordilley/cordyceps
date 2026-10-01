# Real Aider and Cline consumers

These examples install the built Cordyceps tarball in an external temporary Node project and use only public imports. The consumer owns executable selection, process groups, prompts, permission responses, isolated HOME/configuration, and cleanup. The library supplies the local provider and declarative injection.

Run with real Node >=22 first on PATH, installed `aider` and `cline`, and macOS `sandbox-exec`:

```sh
node examples/real-editor-agents/verify.mjs /tmp/cordyceps-editors.json
# Run one agent while debugging:
node examples/real-editor-agents/verify.mjs /tmp/cordyceps-cline.json cline
```

Versions are recorded in evidence, not accepted/rejected as a compatibility gate. Other operating systems require an equivalent consumer network/filesystem boundary and are not verified here.

The four cases each require real captured provider traffic and actual agent output. Text requires one request and a controlled completion. The read scenario writes an unpredictable disposable fixture token, verifies it is absent from the first request, scripts the agent's own read mechanism, and requires that token in its second provider request before responding with a completion. The mock never reads the fixture to manufacture a tool result.

## Aider

The `aider` recipe uses the documented `OPENAI_API_BASE` and `OPENAI_API_KEY` settings with the Chat Completions codec. The consumer selects the model and disables repository mutation, auto-commits, analytics, update checks and repository mapping. Empty explicit config/env files and a disposable HOME prevent loading user configuration.

Aider's real shell workflow consumes a fenced `bash` command in model text. The consumer explicitly answers the prompts to run `/bin/cat fixture.txt` and add its output to the conversation, then submits a follow-up. This is a real shell read; it is not a native provider `tool_call`. Its result appears in conversational text rather than `toolResults`.

An initial test used `--yes-always` and failed: Aider intentionally answers **no** to a shell action requiring explicit consent when that option is enabled. The working consumer answers the actual prompts. Aider may display calculated token prices or blocked model-price-download warnings; the outer sandbox permits only this test's loopback provider port, so those estimates are not paid usage.

Sources: [provider settings](https://aider.chat/docs/config/options.html), [shell workflow](https://aider.chat/docs/usage/commands.html), and the installed Aider implementation's `InputOutput.confirm_ask`/`Coder.handle_shell_commands`.

## Cline

The `cline` recipe creates a separate configuration directory containing JSON provider settings, a test API key and an empty MCP configuration. The field layout was observed from the real CLI's own `cline auth --provider openai --apikey TEST --modelid gpt-4o --baseurl MOCK/v1 --config TEMP` output. Consumers supply `inputs: { model: 'gpt-4o' }`. The final verifier exercises these generated files directly; it does not invoke authentication or copy user state.

The observed OpenAI-compatible mode requests Chat Completions with XML tool instructions in its system prompt and no native `tools` array. The controlled reply invokes `<read_file>`; Cline reads the actual file, adds the result to its next request, and consumes a subsequent `<attempt_completion>`. A plain textual response alone caused Cline to retry until its consecutive-mistakes limit, so the example uses the actual completion protocol. Both requests and native CLI JSON output are retained separately.

Process permission selection (`--yolo`), timeout and JSON output are explicit consumer choices, scoped by an outer OS sandbox. They are not hidden library defaults. This example does not claim ACP, IDE-extension behavior, session restoration, or Cline configurations using other tool formats.
