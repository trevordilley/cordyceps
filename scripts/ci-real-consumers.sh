#!/usr/bin/env bash
# CI orchestration belongs to this consumer example, never the library API.
set -euo pipefail
: "${RUNNER_TEMP:?Set RUNNER_TEMP to an owned scratch directory}"
consumer_group="${1:?Expected baseline, extra-cli, pi, or vendors}"
consumer_root="$RUNNER_TEMP/cordyceps-ci-$consumer_group"
evidence_root="$RUNNER_TEMP/cordyceps-ci-evidence"
mkdir -p "$consumer_root" "$evidence_root"
node_dir="$(dirname "$(command -v node)")"
case "$consumer_group" in
  baseline)
    npm install --prefix "$consumer_root" --no-audit --no-fund \
      @anthropic-ai/claude-code@2.1.283 @openai/codex@0.155.1
    export CLAUDE_BINARY="$consumer_root/node_modules/.bin/claude"
    export CODEX_BINARY="$consumer_root/node_modules/.bin/codex"
    export ACP_EVIDENCE_DIR="$evidence_root/acp"
    export FRONTEND_EVIDENCE_DIR="$evidence_root/frontend"
    node node_modules/@playwright/test/cli.js install chromium
    node examples/real-cli/run.mjs "$evidence_root/cli.json"
    node examples/real-acp/verify.mjs
    node examples/real-frontend/verify-packed.mjs
    ;;
  extra-cli)
    npm install --prefix "$consumer_root" --no-audit --no-fund \
      @kilocode/cli@7.8.1 @continuedev/cli@1.5.47 autohand-cli@0.9.8 command-code@1.72.4
    export EXTRA_CLI_DEPS="$consumer_root"
    node examples/real-extra-cli/run.mjs "$evidence_root/extra-cli.json"
    ;;
  pi)
    npm install --prefix "$consumer_root" --no-audit --no-fund \
      @earendil-works/pi-coding-agent@0.99.1 @oh-my-pi/pi-coding-agent@18.4.4 \
      mastracode@0.43.0 @moonshot-ai/kimi-code@2.1.1 bun@1.4.2
    node examples/real-pi-agents/install-native.mjs "$consumer_root"
    python3 -m venv "$consumer_root/prime-venv"
    "$consumer_root/prime-venv/bin/python" -m pip install \
      "$consumer_root/prime/prime-agent-runtime" ipykernel requests httpx PyYAML \
      tomli python-dotenv pandas numpy scipy beautifulsoup4 lxml
    export PATH="$node_dir:$consumer_root/node_modules/.bin:$PATH"
    export CORDYCEPS_BUN_DIR="$consumer_root/node_modules/.bin"
    export PRIME_AGENT_BINARY="$consumer_root/prime/prime-agent"
    export PRIME_AGENT_KERNEL_PYTHON="$consumer_root/prime-venv/bin/python"
    export ZCODE_BINARY="$consumer_root/zcode-glm/zcode.cjs"
    node examples/real-pi-agents/run.mjs "$evidence_root/pi.json"
    ;;
  vendors)
    python3 examples/real-vendor-agents/install.py "$consumer_root" --agents fx,ante,grok,muse,minimax
    export CORDYCEPS_VENDOR_BIN_DIR="$consumer_root"
    node examples/real-vendor-agents/run.mjs "$evidence_root/vendors.json" fx,ante,grok-build,muse,minimax
    ;;
  *) printf 'Unknown consumer group: %s\n' "$consumer_group" >&2; exit 2 ;;
esac
