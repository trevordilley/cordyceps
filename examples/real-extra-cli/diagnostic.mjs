// This is an asserted failure boundary, never a verified agent workflow.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  cp,
  rm,
  realpath,
  readdir,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prepare, createRegistry } from "cordyceps";
import { launch, environment } from "./isolation.mjs";
const [destination, deps, selection, artifactJSON] = process.argv.slice(2);
assert.equal(
  selection,
  "codebuff",
  "Use workflow mode for the working source CLI or Polygraph",
);
const registry = createRegistry({ builtins: false });
await registry.loadFile("./codebuff.json");
const ai = await prepare({
  registry,
  harness: "codebuff",
  mode: "interactive",
});
ai.route(
  () => true,
  (route) =>
    route.fulfill({
      error: { status: 401, message: "diagnostic fixture rejection" },
    }),
);
const root = await realpath(await mkdtemp("/tmp/cordyceps-codebuff-release-"));
const home = join(root, "home"),
  work = join(root, "work");
await mkdir(home);
await mkdir(work);
const record = {
  candidate: "codebuff",
  workflowVerified: false,
  diagnosticVerified: false,
  serviceRequests: [],
  blockedConnections: [],
};
const evidence = {
  date: new Date().toISOString(),
  packageEntry: import.meta.resolve("cordyceps"),
  artifact: JSON.parse(artifactJSON),
  cases: [record],
};
const proxy = createServer((req, res) => {
  record.serviceRequests.push({ method: req.method, url: req.url, body: "" });
  res.writeHead(403);
  res.end();
});
proxy.on("connect", (req, socket) => {
  record.blockedConnections.push({ method: "CONNECT", authority: req.url });
  socket.end(
    "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
  );
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
try {
  await cp(join(deps, "codebuff-runtime"), join(root, "runtime"), {
    recursive: true,
  });
  const binary = join(root, "runtime/codebuff");
  record.binarySHA256 = createHash("sha256")
    .update(await readFile(binary))
    .digest("hex");
  assert.equal(
    record.binarySHA256,
    "486d0ad8fe7f2000f7c2c58d96a603bdfe0352d59676c4e5f04d5ee97e0480da",
  );
  const env = ai.environment({
    ...environment(home, root),
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    CODEBUFF_BYOK_OPENROUTER: "cordyceps-test-only",
    OPENAI_BASE_URL: ai.baseUrl + "/v1",
    OPENROUTER_BASE_URL: ai.baseUrl + "/v1",
    CODEBUFF_NO_TERMINAL_WATCHDOG: "1",
    NEXT_PUBLIC_POSTHOG_HOST_URL: ai.baseUrl,
  });
  record.binary = binary;
  record.args = ["--lite", "cordyceps released-binary endpoint probe"];
  record.version = await launch(binary, ["--version"], work, env, [root]);
  assert.equal(record.version.stdout.trim(), "1.0.688");
  record.process = await launch(
    binary,
    record.args,
    work,
    env,
    [root],
    null,
    40000,
    "CORDYCEPS_DIAGNOSTIC_OK",
  );
  record.providerRequests = ai.requests;
  record.providerResponses = ai.responses;
  record.logs = [];
  for (const path of (await readdir(home, { recursive: true })).filter((p) =>
    p.endsWith(".jsonl"),
  )) {
    record.logs.push({
      path,
      tail: (await readFile(join(home, path), "utf8")).slice(-16000),
    });
  }
  assert.equal(
    ai.requests.length,
    0,
    "A changed runtime reached the injected provider; re-investigate instead of retaining exclusion",
  );
  assert.equal(record.serviceRequests.length, 0);
  assert.ok(
    record.blockedConnections.some(
      (r) => r.authority === "www.codebuff.com:443",
    ),
  );
  assert.equal(
    record.process.code,
    1,
    "PTY must not observe a controlled reply",
  );
  record.diagnosticVerified = true;
} catch (error) {
  record.error = String(error.stack ?? error);
} finally {
  record.providerRequests ??= ai.requests;
  record.providerResponses ??= ai.responses;
  await ai.dispose();
  await assert.rejects(fetch(ai.baseUrl));
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
  await rm(root, { recursive: true, force: true });
  record.cleanedUp = true;
  await writeFile(destination, JSON.stringify(evidence, null, 2) + "\n");
}
assert.ok(record.diagnosticVerified, record.error);
console.log(
  JSON.stringify({
    candidate: "codebuff",
    diagnosticVerified: true,
    workflowVerified: false,
    modelRequests: 0,
    blockedAuthorities: [
      ...new Set(record.blockedConnections.map((r) => r.authority)),
    ],
  }),
);
