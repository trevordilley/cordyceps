// Consumer-owned real Codebuff source and Polygraph→Claude workflows. No process/client code belongs to the library.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  cp,
  rm,
  realpath,
  copyFile,
  chmod,
  readdir,
  readFile,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { prepare, createRegistry } from "cordyceps";
import { launch, environment } from "./isolation.mjs";
const [destination, deps, selection, artifactJSON] = process.argv.slice(2);
const evidence = {
  date: new Date().toISOString(),
  packageEntry: import.meta.resolve("cordyceps"),
  artifact: JSON.parse(artifactJSON),
  cases: [],
};
for (const candidate of selection.split(",")) {
  assert.ok(
    [
      "polygraph-text",
      "polygraph-tool",
      "codebuff-source-text",
      "codebuff-source-tool",
    ].includes(candidate),
  );
  const source = candidate.startsWith("codebuff-source"),
    scenario = candidate.endsWith("-tool") ? "tool" : "text";
  const root = await realpath(await mkdtemp("/tmp/cordyceps-extra-workflow-")),
    home = join(root, "home"),
    work = join(root, "work");
  await mkdir(home);
  await mkdir(work);
  const record = {
    candidate,
    workflowVerified: false,
    serviceRequests: [],
    blockedConnections: [],
  };
  evidence.cases.push(record);
  const token = `fixture-${randomUUID()}`;
  await writeFile(join(work, "fixture.txt"), token + "\n");
  const registry = createRegistry({ builtins: false });
  await registry.loadFile("./codebuff.json");
  await registry.loadFile("./polygraph.json");
  const ai = await prepare({
    registry,
    harness: source ? "codebuff" : "polygraph",
    mode: source ? "interactive" : "nonInteractive",
  });
  const marker = "CORDYCEPS_REAL_" + scenario.toUpperCase() + "_OK";
  let issued = false,
    returned = false;
  const metadata = {
    "/api/healthz": { status: "ok" },
    "/api/v1/me": { id: "fixture-user", email: "fixture@example.invalid" },
    "/api/v1/usage": { remainingBalance: 1000, next_quota_reset: null },
    "/api/user/subscription": { subscription: null },
    "/api/agents/validate": { validationErrors: [] },
    "/api/v1/agent-runs": { runId: "fixture-run", success: true },
    "/api/v1/ads/policy": {},
    "/batch/": {},
    "/api/logs": {},
  };
  ai.route(
    () => true,
    (route) => {
      const req = route.request,
        path = req.raw.path.split("?")[0];
      if (source && metadata[path])
        return route.fulfill({ text: JSON.stringify(metadata[path]) });
      if (path.endsWith("/count_tokens"))
        return route.fulfill({ inputTokens: 100 });
      if (scenario === "text") return route.fulfill({ text: marker });
      if (issued) {
        let id = "fixture_read";
        if (source) {
          const messages = req.body.messages;
          const calls = messages
            .filter((m) => m.role === "assistant")
            .flatMap((m) => m.tool_calls ?? []);
          const call = calls.find(
            (c) =>
              c.function?.name === "read_files" &&
              JSON.parse(c.function.arguments).paths?.[0] === "fixture.txt",
          );
          assert.ok(
            call,
            "Native assistant read call must correlate the returned result",
          );
          id = call.id;
        }
        const result = req.toolResults.find((r) => r.id === id);
        assert.ok(
          result?.text.includes(token),
          "Actual next native request must include fixture contents",
        );
        assert.equal(result.isError, false);
        returned = true;
        return route.fulfill({ text: marker });
      }
      assert.ok(
        !req.raw.body.includes(token),
        "Fixture token leaked before native read",
      );
      const name = source ? "read_files" : "Read";
      assert.ok(req.tools.some((t) => t.name === name));
      issued = true;
      record.scriptedCall = {
        id: "fixture_read",
        name,
        input: source
          ? { paths: ["fixture.txt"] }
          : { file_path: join(work, "fixture.txt") },
      };
      return route.fulfill({ toolCall: record.scriptedCall });
    },
  );
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    record.serviceRequests.push({ method: req.method, url: req.url, body });
    const path = new URL(req.url, url).pathname;
    // Static account/catalogue metadata only. Unknown endpoints (including model/service decisions) fail closed.
    const bootstrap = {
      "/nx-cloud/polygraph/user/organizations": {
        organizations: [{ id: "cordyceps-org", name: "Cordyceps" }],
      },
      "/nx-cloud/polygraph/user": { enabledAgentTypes: ["claude"] },
      "/nx-cloud/polygraph/sessions/candidates": {
        candidates: [
          {
            id: "fixture-repo",
            name: "Fixture",
            vcsConfiguration: { repositoryFullName: "fixture/repo" },
          },
        ],
      },
      "/api/healthz": { status: "ok" },
      "/api/v1/agent-runs": { runId: "fixture-run", success: true },
      "/nx-cloud/polygraph/sessions/prepare": {
        repositories: [],
        credentials: [],
      },
      "/nx-cloud/polygraph/sessions/init": {
        sessionId:
          path === "/nx-cloud/polygraph/sessions/init"
            ? JSON.parse(body).sessionId
            : "fixture-session",
        repositories: [],
        intervalId: null,
      },
      "/api/v1/me": { id: "fixture-user", email: "fixture@example.invalid" },
      "/api/v1/usage": { remainingBalance: 1000, next_quota_reset: null },
      "/api/agents/validate": { validationErrors: [] },
    };
    const reply =
      path === "/nx-cloud/polygraph/sessions/candidates" && body !== "{}"
        ? undefined
        : bootstrap[path];
    res.writeHead(reply ? 200 : 404, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        reply ?? { error: "unconfigured consumer service endpoint" },
      ),
    );
  });
  server.on("connect", (req, socket) => {
    record.blockedConnections.push({ method: "CONNECT", authority: req.url });
    socket.end(
      "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    let env = ai.environment({
        ...environment(home, root),
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
        CLAUDE_CODE_TMPDIR: root,
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        MCP_TIMEOUT: "5000",
        HTTPS_PROXY: url,
        HTTP_PROXY: url,
        ALL_PROXY: url,
      }),
      binary,
      args;
    await mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
    await writeFile(
      join(env.CLAUDE_CONFIG_DIR, ".claude.json"),
      JSON.stringify({
        hasCompletedOnboarding: true,
        customApiKeyResponses: {
          approved: [ai.apiKey.slice(-20)],
          rejected: [],
        },
        projects: { [work]: { hasTrustDialogAccepted: true } },
      }),
    );
    if (candidate.startsWith("polygraph")) {
      const bin = join(root, "bin");
      await mkdir(bin);
      const claudeSource = await realpath(process.env.CLAUDE_BINARY ?? "/Users/20idemo/.local/bin/claude");
    if (/\.(?:m?js|cjs)$/.test(claudeSource)) {
      // Preserve package-relative imports for npm's real CLI entrypoint in clean CI.
      await symlink(claudeSource, join(bin, "claude"));
    } else {
      // The native installation may live under a credential-protected HOME directory.
      await copyFile(claudeSource, join(bin, "claude"));
      await chmod(join(bin, "claude"), 0o755);
    }
    env.PATH = bin + ":" + env.PATH;
      await cp(join(deps, "polygraph-npm-cache"), join(home, ".npm"), {
        recursive: true,
      });
      env.npm_config_offline = "true";
      env.npm_config_cache = join(home, ".npm");
      {
        const market = join(root, "marketplace");
        await mkdir(join(market, ".claude-plugin"), { recursive: true });
        await cp(
          join(deps, "polygraph-claude-plugin/package"),
          join(market, "plugin"),
          { recursive: true },
        );
        await writeFile(
          join(market, ".claude-plugin/marketplace.json"),
          JSON.stringify({
            name: "polygraph-plugins",
            owner: { name: "Cordyceps local test mirror" },
            plugins: [{ name: "polygraph", source: "./plugin" }],
          }),
        );
        record.pluginSetup = [];
        for (const pluginArgs of [
          ["plugins", "marketplace", "add", market, "--scope", "user"],
          ["plugins", "install", "polygraph@polygraph-plugins", "-s", "user"],
          ["plugins", "list", "--json"],
        ]) {
          const result = await launch(
            join(bin, "claude"),
            pluginArgs,
            work,
            env,
            [root],
          );
          record.pluginSetup.push({ args: pluginArgs, ...result });
          assert.equal(result.code, 0, result.stderr);
        }
      }
      // Cache the exact unmodified official bundle; the shell permits offline cached startup.
      const host = new URL(url).host.replace(/[^a-zA-Z0-9.-]+/g, "_");
      const cache = join(home, ".polygraph/bundles", host);
      await mkdir(cache, { recursive: true });
      const runtimeArtifact = JSON.parse(await readFile(join(deps, "polygraph-runtime.json"), "utf8"));
      assert.match(runtimeArtifact.version, /^\d{4}\.\d{2}\.\d{4}$/);
      record.runtimeArtifact = runtimeArtifact;
      await cp(join(deps, "polygraph-runtime"), join(cache, runtimeArtifact.version), {
        recursive: true,
      });
      await writeFile(
        join(home, ".polygraph/config.json"),
        JSON.stringify({
          agentOptions: {
            claude: {
              sandbox: false,
              extraArgs: [
                "--print",
                "--model",
                "claude-sonnet-4-6",
                "--tools",
                "Read",
                "--allowedTools",
                "Read",
                "--permission-mode",
                "dontAsk",
                "--no-session-persistence",
                "--output-format",
                "json",
              ],
            },
          },
        }),
      );
      await mkdir(join(home, ".config/polygraph"), { recursive: true });
      await writeFile(
        join(home, ".config/polygraph/polygraph.ini"),
        `[oauth:${url.replaceAll(".", "\\.")}]\naccessToken=cordyceps-test-only\ntokenType=Bearer\naccessTokenExpiresAt=${Date.now() + 3600000}\n`,
      );
      env = {
        ...env,
        POLYGRAPH_URL: url,
        POLYGRAPH_CREDENTIAL_WAIT_TIMEOUT_MS: "1000",
        POLYGRAPH_DISABLE_ANIMATIONS: "1",
      };
      binary = join(deps, "node_modules/.bin/polygraph");
      args = [
        ...ai.args,
        "--multiplexer",
        "none",
        "--no-primary",
        "--title",
        "Cordyceps fixture",
        "--",
        "cordyceps-polygraph: read fixture.txt and report completion",
      ];
    } else {
      binary =
        process.env.CODEBUFF_SOURCE_BINARY ?? join(deps, "codebuff-source-cli");
      // Current official source requires build-environment placeholders. The real app URL/key come from the recipe above.
      env = {
        ...env,
        CODEBUFF_NO_TERMINAL_WATCHDOG: "1",
        NEXT_PUBLIC_CB_ENVIRONMENT: "prod",
        NEXT_PUBLIC_SUPPORT_EMAIL: "test@example.invalid",
        NEXT_PUBLIC_POSTHOG_API_KEY: "test",
        NEXT_PUBLIC_POSTHOG_HOST_URL: ai.baseUrl,
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "test",
        NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL: url,
        NEXT_PUBLIC_WEB_PORT: "3000",
      };
      args = [
        "--lite",
        "cordyceps-codebuff: read fixture.txt and report completion",
      ];
    }
    record.binary = binary;
    record.args = args;
    record.version = await launch(binary, ["--version"], work, env, [root]);
    assert.equal(record.version.code, 0, record.version.stderr);
    if (!source)
      record.underlyingVersion = await launch(
        join(root, "bin/claude"),
        ["--version"],
        work,
        env,
        [root],
      );
    record.process = candidate.startsWith("codebuff")
      ? await launch(binary, args, work, env, [root], null, 40000, marker)
      : await launch(binary, args, work, env, [root], null, 30000);
    const files = await readdir(home, { recursive: true });
    record.logs = [];
    for (const file of files.filter((f) => /\.(log|jsonl|ndjson)$/.test(f))) {
      const content = await readFile(join(home, file), "utf8").catch(
        () => null,
      );
      if (content)
        record.logs.push({ path: file, tail: content.slice(-16000) });
    }
    if (!source) {
      record.mcpConnected = record.logs.some(
        (log) =>
          log.path.includes("mcp-logs") &&
          log.tail.includes("Successfully connected (transport: stdio)"),
      );
      assert.ok(
        record.mcpConnected,
        "Official Polygraph MCP must initialize through its unmodified plugin",
      );
    }
    record.providerRequests = ai.requests;
    record.providerResponses = ai.responses;
    ai.assertHealthy();
    assert.equal(record.process.code, 0, record.process.stderr);
    assert.equal(record.process.timedOut, false);
    assert.ok(
      record.process.stdout.includes(marker),
      "Native output must contain controlled reply",
    );
    const prompts = ai.requests.filter(
      (r) =>
        r.raw.path.includes(source ? "chat/completions" : "/messages") &&
        !r.raw.path.includes("count_tokens"),
    );
    assert.equal(prompts.length, scenario === "tool" ? 2 : 1);
    assert.ok(
      prompts[0].text.includes(
        source ? "cordyceps-codebuff" : "cordyceps-polygraph",
      ),
    );
    if (source)
      assert.equal(prompts[0].raw.headers.authorization, "Bearer " + ai.apiKey);
    else assert.equal(prompts[0].raw.headers["x-api-key"], ai.apiKey);
    assert.ok(!prompts[0].raw.body.includes(token));
    if (scenario === "tool") assert.ok(issued && returned);
    record.assertions = {
      actualPromptCaptured: true,
      nativeOutput: true,
      tokenAbsentBeforeRead: true,
      realToolResultInNextRequest: scenario === "tool" ? returned : null,
    };
    record.workflowVerified = true;
    record.tokenInProviderRequest = ai.requests.some((r) =>
      r.raw.body.includes(token),
    );
  } catch (e) {
    record.error = String(e.stack ?? e);
  } finally {
    record.providerRequests ??= ai.requests;
    record.providerResponses ??= ai.responses;
    await ai.dispose();
    await assert.rejects(fetch(ai.baseUrl));
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
    record.cleanedUp = true;
    await writeFile(destination, JSON.stringify(evidence, null, 2) + "\n");
    console.log(
      JSON.stringify({
        candidate,
        serviceRequests: record.serviceRequests.map(
          ({ method, url, body }) => ({ method, url, bodyBytes: body.length }),
        ),
        providerRequests: record.providerRequests?.length,
        error: record.error,
        exit: record.process?.code,
      }),
    );
  }
}

assert.ok(
  evidence.cases.every((c) => c.workflowVerified),
  "At least one native workflow failed; inspect evidence",
);
