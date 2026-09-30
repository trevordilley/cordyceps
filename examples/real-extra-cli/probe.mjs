// Pack first, then run the diagnostic through public imports outside this repository.
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = await mkdtemp(join(tmpdir(), "cordyceps-extra-probe-package-"));
const run = (binary, args, cwd = root) => {
  const r = spawnSync(binary, args, {
    cwd,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 16000000,
  });
  if (r.status !== 0 || r.error)
    throw Error(`${r.error ?? r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
try {
  run("bun", ["run", "build"], repo);
  const [artifact] = JSON.parse(
    run(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", root],
      repo,
    ),
  );
  const project = join(root, "consumer");
  await mkdir(project);
  await writeFile(
    join(project, "package.json"),
    '{"private":true,"type":"module"}',
  );
  run(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--omit=peer",
      join(root, artifact.filename),
    ],
    project,
  );
  for (const file of [
    "workflow.mjs",
    "diagnostic.mjs",
    "isolation.mjs",
    "drive-pty.py",
  ])
    await copyFile(
      join(repo, "examples/real-extra-cli", file),
      join(project, file),
    );
  for (const name of ["codebuff", "polygraph"])
    await copyFile(
      join(repo, "harnesses", name + ".json"),
      join(project, name + ".json"),
    );
  console.log(
    run(
      process.execPath,
      [
        process.argv[4] === "workflow" ? "workflow.mjs" : "diagnostic.mjs",
        resolve(process.argv[2] ?? "/tmp/extra-diagnostic.json"),
        process.env.EXTRA_CLI_DEPS ?? "/tmp/cordyceps-extra-deps",
        process.argv[3] ?? "codebuff",
        JSON.stringify({
          filename: artifact.filename,
          integrity: artifact.integrity,
        }),
      ],
      project,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
