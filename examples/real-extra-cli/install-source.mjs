// Ordinary local development setup, never a Cordyceps API or a harness launch.
import assert from "node:assert/strict";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const root = resolve(process.argv[2] ?? "/tmp/cordyceps-extra-deps");
const commit = "fb2a17d442feb9a3482c0ed32863a4cd5fe37009";
const source = join(root, "codebuff-source");
const run = (binary, args, cwd = root) =>
  execFileSync(binary, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
await mkdir(root, { recursive: true });
try {
  await access(join(source, ".git"));
} catch {
  run("git", [
    "clone",
    "--filter=blob:none",
    "https://github.com/CodebuffAI/codebuff.git",
    source,
  ]);
}
assert.equal(
  run("git", ["status", "--porcelain"], source).trim(),
  "",
  "Do not overwrite source edits",
);
run("git", ["checkout", "--detach", commit], source);
const bun = process.env.BUN_BINARY ?? run("/usr/bin/which", ["bun"]).trim();
run(bun, ["install", "--frozen-lockfile"], source);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
await writeFile(
  join(root, "codebuff-source-cli"),
  `#!/bin/sh\nexec ${quote(bun)} ${quote(join(source, "cli/src/entry.ts"))} "$@"\n`,
  { mode: 0o755 },
);
// npm's actual offline cache lets the unmodified Claude plugin's npx command resolve its pinned observed release.
run("npm", [
  "cache",
  "add",
  "@polygraph/mcp@0.3.1",
  "--cache",
  join(root, "polygraph-npm-cache"),
]);
console.log(
  JSON.stringify({
    source,
    commit,
    bun: run(bun, ["--version"]).trim(),
    polygraphMcp: "0.3.1",
  }),
);
