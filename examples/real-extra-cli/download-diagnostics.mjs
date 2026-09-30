// Unauthenticated official runtime downloads. No CLI launch, login, or user configuration.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
assert.equal(process.platform, "darwin");
const workflowsOnly = process.argv[3] === "--workflows-only";
if (!workflowsOnly) assert.equal(process.arch, "arm64", "The released-binary diagnostic is pinned to arm64; --workflows-only downloads the portable Polygraph payloads");
const root = resolve(process.argv[2] ?? "/tmp/cordyceps-extra-deps");
await mkdir(root, { recursive: true });
// The official runtime endpoint is mutable. Update this version and its hash
// together only after inspecting the actual archive, then rerun native workflows.
const polygraphVersion = "2609.29.0017";
const artifacts = [
  [
    "codebuff",
    "https://codebuff.com/api/releases/download/1.0.688/codebuff-darwin-arm64.tar.gz",
    "5522f524fcbe64c9f471dee23ff0cb65c096393cf4bf0828dbb7a9a713528088",
  ],
  [
    "polygraph",
    "https://cloud.nx.app/nx-cloud/static/polygraph-bundle",
    "500aefb051bd7c868d67d38b7367b6c3002ef6b1e202d831c05c17422baab041",
  ],
  [
    "polygraph-claude-plugin",
    "https://registry.npmjs.org/@polygraph/claude-plugin/-/claude-plugin-0.5.4.tgz",
    "b378e0192ebe4c02420b9e5f613599994d2306213cc0f3f69975d76db9b20539",
    "polygraph-claude-plugin",
  ],
];
for (const [name, url, hash, directory] of artifacts) {
  if (workflowsOnly && name === "codebuff") continue;
  const response = await fetch(url);
  assert.ok(response.ok, `${url}: ${response.status}`);
  if (name === "polygraph") {
    assert.equal(response.headers.get("content-type")?.split(";")[0], "application/gzip");
    assert.match(
      response.headers.get("content-disposition") ?? "",
      new RegExp(`(?:^|;)\\s*filename="?${polygraphVersion.replaceAll(".", "\\.")}\\.tar\\.gz"?(?:;|$)`),
      "Polygraph runtime version changed; inspect its archive and reverify before updating the pin",
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    hash,
    `${name}: official artifact changed; inspect and reverify the new version, never silently reuse old evidence`,
  );
  const archive = join(root, `${name}-download.tar.gz`),
    target = join(root, directory ?? `${name}-runtime`);
  await writeFile(archive, bytes);
  await mkdir(target, { recursive: true });
  const result = spawnSync("/usr/bin/tar", ["-xzf", archive, "-C", target], {
    stdio: "inherit",
  });
  assert.equal(result.status, 0);
  if (name === "polygraph") {
    // Consumers use this verified version for the native runtime cache directory.
    // This is setup provenance, not a receipt that the new runtime passed E2E.
    await writeFile(join(root, "polygraph-runtime.json"), JSON.stringify({
      version: polygraphVersion,
      archiveSHA256: hash,
      url,
      resolvedUrl: response.url,
    }, null, 2) + "\n");
  }
  console.log(`${name}: verified ${hash}, extracted to ${target}`);
}
