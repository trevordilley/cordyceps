#!/usr/bin/env bash
# Consumer-owned CI setup; Cordyceps does not install or launch these agents.
# Requires macOS arm64, real Node 24, Python 3.12 and Bun 1.3.13 on PATH.
set -euo pipefail
: "${RUNNER_TEMP:?Set RUNNER_TEMP to an owned scratch directory}"
consumer_group="${1:?Expected providers, google, editors, auggie, or openclaw}"
case "$consumer_group" in
  providers|google|editors|auggie|openclaw) ;;
  *) printf 'Unknown consumer group: %s\n' "$consumer_group" >&2; exit 2 ;;
esac

mkdir -p "$RUNNER_TEMP"
consumer_root="$(mktemp -d "$RUNNER_TEMP/cordyceps-ci-$consumer_group.XXXXXX")"
evidence_root="$RUNNER_TEMP/cordyceps-ci-evidence"
mkdir -p "$evidence_root"
exec > >(tee "$evidence_root/$consumer_group-setup-and-run.log") 2>&1

# Always retain installation provenance, including when setup or a consumer fails.
# Scratch dependencies remain on this disposable runner; agent fixtures/processes
# are separately owned and cleaned up by the existing consumer verifiers.
finish() {
  consumer_exit_code=$?
  trap - EXIT
  set +e
  for package_file in package.json package-lock.json; do
    if [[ -f "$consumer_root/$package_file" ]]; then
      cp "$consumer_root/$package_file" "$evidence_root/$consumer_group-$package_file"
    fi
  done
  if [[ -d "$consumer_root/node_modules" ]]; then
    npm ls --prefix "$consumer_root" --depth=0 --json > "$evidence_root/$consumer_group-npm-tree.json" 2>&1
  fi
  for python_env in aider-venv vibe-venv; do
    if [[ -x "$consumer_root/$python_env/bin/python" ]]; then
      "$consumer_root/$python_env/bin/python" -m pip freeze > "$evidence_root/$consumer_group-$python_env-freeze.txt" 2>&1
    fi
  done
  printf '%s\n' "$consumer_exit_code" > "$evidence_root/$consumer_group-exit-code.txt"
  exit "$consumer_exit_code"
}
trap finish EXIT

node_dir="$(dirname "$(command -v node)")"
node -e 'const assert = require("node:assert/strict"); assert.equal(process.platform, "darwin"); assert.equal(process.arch, "arm64"); assert.equal(process.versions.bun, undefined); assert.equal(process.versions.node.split(".")[0], "24");'
test "$(bun --version)" = '1.3.13'
{
  node --version
  npm --version
  bun --version
  python3 --version
  uname -sm
  git rev-parse HEAD
} > "$evidence_root/$consumer_group-runtimes.txt"

# Only authentic, versioned native artifacts; no shell installer is executed.
download_checked() {
  local agent_name="$1" agent_version="$2" artifact_url="$3" expected_sha="$4" destination="$5"
  local actual_sha
  curl -fL --retry 3 --connect-timeout 20 --max-time 300 -o "$destination" "$artifact_url"
  actual_sha="$(shasum -a 256 "$destination" | awk '{print $1}')"
  printf '%s\t%s\t%s\t%s\t%s\n' "$agent_name" "$agent_version" "$artifact_url" "$expected_sha" "$actual_sha" \
    >> "$evidence_root/$consumer_group-downloads.tsv"
  test "$actual_sha" = "$expected_sha"
}

case "$consumer_group" in
  providers)
    npm install --prefix "$consumer_root" --include=optional --no-audit --no-fund \
      @github/copilot@1.0.88 opencode-ai@1.18.33 @charmland/crush@0.97.1
    mkdir -p "$consumer_root/goose" "$consumer_root/droid"
    printf 'agent\tversion\turl\texpected_sha256\tactual_sha256\n' > "$evidence_root/$consumer_group-downloads.tsv"
    download_checked goose 1.27.2 \
      https://github.com/aaif-goose/goose/releases/download/v1.27.2/goose-aarch64-apple-darwin.tar.bz2 \
      9e66353e19169f550a32054498ca60a2a2cb20238eb91aee38780a4347322ee9 \
      "$consumer_root/goose.tar.bz2"
    tar -xjf "$consumer_root/goose.tar.bz2" -C "$consumer_root/goose"
    download_checked droid 0.112.0 \
      https://downloads.factory.ai/factory-cli/releases/0.112.0/darwin/arm64/droid \
      a3e6f14c198947ff99cf9e3cca2a0a422729d978a39ddd69576766b8ce5c56c0 \
      "$consumer_root/droid/droid"
    chmod +x "$consumer_root/goose/goose" "$consumer_root/droid/droid"
    export COPILOT_BINARY="$consumer_root/node_modules/.bin/copilot"
    export OPENCODE_BINARY="$consumer_root/node_modules/.bin/opencode"
    export CRUSH_BINARY="$consumer_root/node_modules/.bin/crush"
    export GOOSE_BINARY="$consumer_root/goose/goose"
    export DROID_BINARY="$consumer_root/droid/droid"
    node examples/real-provider-agents/run.mjs "$evidence_root/providers.json"
    ;;
  google)
    python3 -c 'import sys; assert sys.version_info[:2] == (3, 12)'
    npm install --prefix "$consumer_root" --include=optional --no-audit --no-fund \
      @google/gemini-cli@0.39.1 @qwen-code/qwen-code@0.15.4
    python3 -m venv "$consumer_root/vibe-venv"
    "$consumer_root/vibe-venv/bin/python" -m pip install mistral-vibe==2.22.0
    export GEMINI_BINARY="$consumer_root/node_modules/.bin/gemini"
    export QWEN_BINARY="$consumer_root/node_modules/.bin/qwen"
    export VIBE_BINARY="$consumer_root/vibe-venv/bin/vibe"
    node examples/real-google-agents/run.mjs "$evidence_root/google.json"
    ;;
  editors)
    python3 -c 'import sys; assert sys.version_info[:2] == (3, 12)'
    npm install --prefix "$consumer_root" --include=optional --no-audit --no-fund cline@2.17.0
    python3 -m venv "$consumer_root/aider-venv"
    "$consumer_root/aider-venv/bin/python" -m pip install aider-chat==0.86.2
    # This verifier resolves both executables with which; it has no *_BINARY seam.
    export PATH="$node_dir:$consumer_root/node_modules/.bin:$consumer_root/aider-venv/bin:$PATH"
    node examples/real-editor-agents/verify.mjs "$evidence_root/editors.json"
    ;;
  auggie)
    npm install --prefix "$consumer_root" --include=optional --no-audit --no-fund @augmentcode/auggie@0.35.0
    export AUGGIE_BINARY="$consumer_root/node_modules/.bin/auggie"
    node examples/real-auggie/verify.mjs "$evidence_root/auggie.json"
    ;;
  openclaw)
    npm install --prefix "$consumer_root" --include=optional --no-audit --no-fund openclaw@2026.9.2
    export OPENCLAW_BINARY="$consumer_root/node_modules/.bin/openclaw"
    node examples/real-local-agents/run.mjs "$evidence_root/openclaw.json" openclaw
    ;;
esac
