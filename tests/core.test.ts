import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { connect } from "node:net";
import { once } from "node:events";
import { dirname } from "node:path";
import { setImmediate } from "node:timers/promises";
import { prepare } from "../src/session.js";
import type { AISession, Route } from "../src/session.js";
import { createRegistry } from "../src/registry.js";

// Bun 1.3.13's node:http shim does not notify held handlers when the remote
// socket closes. Run the complete suite on the supported Node >=22 runtime.
const testNodeDisconnect = process.versions.bun === "1.3.13" ? test.skip : test;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function within<T>(promise: Promise<T>, ms = 1500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Test deadline exceeded")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

function registry(adapter = "anthropic-messages") {
  const registry = createRegistry({ builtins: false });
  registry.register({
    schemaVersion: 1, id: "synthetic-core",
    provider: { adapter, override: { env: { CORE_ENDPOINT: "${mock.baseUrl}", CORE_KEY: "${mock.apiKey}" }, unsetEnv: ["CORE_REMOVE"] } },
    modes: {
      interactive: {},
      acp: { args: ["--consumer-mode", "${input.label}", "${config.settings.path}"], configFiles: [
        { id: "settings", path: "config/settings.json", format: "json", values: { endpoint: "${mock.baseUrl}" } },
      ] },
    },
  });
  return registry;
}

function setup(extra: Partial<Parameters<typeof prepare>[0]> = {}) {
  return prepare({ harness: "synthetic-core", registry: registry(), ...extra });
}

function request(ai: AISession, text = "question", options: { stream?: boolean; signal?: AbortSignal; path?: string } = {}) {
  return fetch(`${ai.baseUrl}${options.path ?? "/v1/messages"}`, {
    method: "POST", headers: { "content-type": "application/json", "x-test": "synthetic-provider" },
    body: JSON.stringify({ model: "synthetic", max_tokens: 100, messages: [{ role: "user", content: text }], stream: options.stream ?? false }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

test("prepare isolates injection outputs and removes owned files on idempotent disposal", async () => {
  const before = { ...process.env };
  const ai = await setup({ mode: "acp", inputs: { label: "one" } });
  const file = ai.configFiles[0]!.path;
  try {
    const base = { PATH: "/consumer/bin", CORE_REMOVE: "remove", ORIGINAL: "keep" };
    const env = ai.environment(base);
    assert.equal(env.CORE_ENDPOINT, ai.baseUrl);
    assert.equal(env.CORE_KEY, ai.apiKey);
    assert.equal(env.CORE_REMOVE, undefined);
    assert.equal(env.PATH, base.PATH);
    assert.equal(base.CORE_REMOVE, "remove");
    assert.ok(JSON.stringify({ ...process.env }) === JSON.stringify(before), "prepare must not mutate process.env");
    assert.deepEqual(ai.args, ["--consumer-mode", "one", file]);
    assert.equal(JSON.parse(await readFile(file, "utf8")).endpoint, ai.baseUrl);
    ai.args.push("mutated");
    ai.configFiles[0]!.path = "mutated";
    assert.equal(ai.args.length, 3);
    assert.equal(ai.configFiles[0]!.path, file);
  } finally { await Promise.all([ai.dispose(), ai.dispose()]); }
  await assert.rejects(access(file));
  await assert.rejects(fetch(ai.baseUrl));
  assert.throws(() => ai.environment({}), /disposed/);
  assert.throws(() => ai.route(() => true, () => {}), /disposed/);
  assert.throws(() => ai.recordInput("late"), /disposed/);
  ai.assertHealthy();
});

test("invalid selection and pre-aborted preparation fail before serving", async () => {
  await assert.rejects(setup({ mode: "missing" }), /RECIPE_NOT_FOUND/);
  await assert.rejects(setup({ mode: "acp" }), /MISSING_INPUT/);
  await assert.rejects(setup({ maxRequestBodyBytes: 0 }), /maxRequestBodyBytes/);
  let getterCalled = false;
  const invalidInputs = { get label() { getterCalled = true; return "invalid"; } };
  await assert.rejects(setup({ mode: "acp", inputs: invalidInputs }), /INVALID_INPUT/);
  assert.equal(getterCalled, false);
  const controller = new AbortController();
  controller.abort(new Error("stop preparation"));
  await assert.rejects(setup({ signal: controller.signal }), /stop preparation/);
  const ai = await setup();
  await ai.dispose();
});

test("render failure rolls back its directory and the prepared listener", async () => {
  const definitions = registry();
  const definition = definitions.get("synthetic-core");
  definition.id = "render-failure";
  definition.modes.acp!.configFiles![0]!.path = "x".repeat(300);
  definitions.register(definition);
  let error: NodeJS.ErrnoException | undefined;
  try {
    await prepare({ harness: "render-failure", registry: definitions, mode: "acp", inputs: { label: "x" } });
    assert.fail("render should fail on an oversized filename");
  } catch (caught) { error = caught as NodeJS.ErrnoException; }
  assert.equal(error.code, "ENAMETOOLONG");
  assert.ok(error.path);
  await assert.rejects(access(dirname(error.path)));
  // A leaked listener also prevents this test process from exiting normally.
});

test("newest matching route wins, removers are idempotent, and captures are snapshots", async () => {
  const ai = await setup();
  try {
    ai.route(() => true, route => route.fulfill({ text: "fallback" }));
    const remove = ai.route(r => r.text.includes("special"), route => {
      (route.request.body as { model: string }).model = "mutated";
      return route.fulfill({ text: "specific" });
    });
    assert.match(await (await request(ai, "special")).text(), /specific/);
    remove(); remove();
    assert.match(await (await request(ai, "special")).text(), /fallback/);
    const captures = ai.requests;
    assert.equal(captures.length, 2);
    assert.equal(captures[0]!.raw.headers["x-test"], "synthetic-provider");
    assert.match(captures[0]!.raw.body, /special/);
    assert.equal((captures[0]!.body as { model: string }).model, "synthetic");
    captures[0]!.text = "changed";
    assert.match(ai.requests[0]!.text, /special/);
    assert.notEqual(captures[0]!.id, captures[1]!.id);
    assert.equal(ai.responses.length, 2);
    assert.equal(ai.responses[0]!.requestId, captures[0]!.id);
    assert.equal(ai.responses[0]!.status, 200);
    assert.equal(ai.responses[0]!.outcome, "completed");
    ai.responses[0]!.chunks.push("changed");
    assert.ok(!ai.responses[0]!.chunks.includes("changed"));
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

test("simultaneous sessions keep routes, observations, credentials, and failure state separate", async () => {
  const [a, b] = await Promise.all([setup(), setup()]);
  try {
    assert.notEqual(a.baseUrl, b.baseUrl);
    assert.notEqual(a.apiKey, b.apiKey);
    a.route(() => true, route => route.fulfill({ text: "reply-a" }));
    b.route(() => true, route => route.fulfill({ text: "reply-b" }));
    const [ra, rb] = await Promise.all([request(a, "a"), request(b, "b")]);
    assert.match(await ra.text(), /reply-a/);
    assert.match(await rb.text(), /reply-b/);
    assert.equal(a.requests.length, 1);
    assert.equal(b.requests.length, 1);
    a.recordInput("only a");
    assert.equal(b.inputs.length, 0);
    a.route(() => true, () => { throw new Error("a failed"); });
    assert.equal((await request(a)).status, 500);
    assert.throws(() => a.assertHealthy());
    b.assertHealthy();
    await a.dispose();
    assert.match(await (await request(b)).text(), /reply-b/);
  } finally { await Promise.all([a.dispose(), b.dispose()]); }
});

test("request waits include history and future and independently reject bad predicates", async () => {
  const ai = await setup();
  try {
    ai.route(() => true, route => route.fulfill({ text: "ok" }));
    const future = ai.waitForRequest(r => r.text.includes("future"));
    const second = ai.waitForRequest(r => r.text.includes("future"));
    const broken = ai.waitForRequest(() => { throw new Error("predicate failure"); });
    const checkedBroken = assert.rejects(broken, /predicate failure/);
    await (await request(ai, "future")).text();
    const [first, other] = await Promise.all([future, second]);
    assert.equal(first.id, other.id);
    await checkedBroken;
    const history = await ai.waitForRequest(r => r.id === first.id);
    assert.equal(history.id, first.id);
    history.text = "changed";
    assert.match(ai.requests[0]!.text, /future/);
    await assert.rejects(ai.waitForRequest(() => { throw new Error("history predicate"); }), /history predicate/);
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

test("waits settle on timeout, abort, disposal, and invalid options", async () => {
  const ai = await setup();
  try {
    await assert.rejects(ai.waitForRequest(() => false, { timeout: 5 }), /Timed out/);
    await assert.rejects(ai.waitForRequest(() => false, { timeout: -1 }), /timeout/);
    const controller = new AbortController();
    const waiting = ai.waitForRequest(() => true, { timeout: 0, signal: controller.signal });
    controller.abort(new Error("stop wait"));
    await assert.rejects(waiting, /stop wait/);
    await assert.rejects(ai.waitForRequest(() => true, { signal: controller.signal }), /stop wait/);
    const disposalWait = assert.rejects(ai.waitForRequest(() => true, { timeout: 0 }), /disposed/);
    await ai.dispose();
    await disposalWait;
    await assert.rejects(ai.waitForRequest(() => true), /disposed/);
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

test("unmatched requests and handler errors surface without making disposal mask the error", async () => {
  for (const scenario of ["unmatched", "throw", "predicate", "unfulfilled", "double"] as const) {
    const ai = await setup();
    try {
      if (scenario === "throw") ai.route(() => true, () => { throw new Error("handler exploded"); });
      if (scenario === "predicate") ai.route(() => { throw new Error("route predicate exploded"); }, () => {});
      if (scenario === "unfulfilled") ai.route(() => true, () => {});
      if (scenario === "double") ai.route(() => true, async route => {
        await route.fulfill({ text: "first" });
        await route.fulfill({ text: "second" });
      });
      const wait = assert.rejects(ai.waitForRequest(() => false, { timeout: 0 }));
      const response = await request(ai);
      if (scenario !== "double") assert.equal(response.status, 500);
      await response.text().catch(() => {});
      await wait;
      assert.equal(ai.failures.length, 1);
      assert.equal(ai.failures[0]!.requestId, ai.requests[0]!.id);
      assert.throws(() => ai.assertHealthy(), AggregateError);
      assert.equal(ai.responses[0]!.outcome, "failed");
    } finally { await ai.dispose(); }
    assert.throws(() => ai.assertHealthy(), AggregateError);
  }
});

test("malformed bodies, unsupported endpoints, and request size limits fail visibly", async () => {
  for (const scenario of ["json", "path", "large"] as const) {
    const ai = await setup({ maxRequestBodyBytes: 256 });
    try {
      const response = scenario === "json"
        ? await fetch(`${ai.baseUrl}/v1/messages`, { method: "POST", body: "{" })
        : await request(ai, scenario === "large" ? "x".repeat(1024) : "ok", scenario === "path" ? { path: "/wrong" } : {});
      assert.equal(response.status, { json: 400, path: 404, large: 413 }[scenario]);
      assert.match(await response.text(), /cordyceps_error/);
      assert.equal(ai.failures.length, 1);
      assert.throws(() => ai.assertHealthy());
    } finally { await ai.dispose(); }
  }
});

test("scripted provider HTTP errors are intentional responses, not session failures", async () => {
  const ai = await setup();
  try {
    ai.route(() => true, route => route.fulfill({ error: { status: 429, message: "test throttle" } }));
    const response = await request(ai);
    assert.equal(response.status, 429);
    assert.match(await response.text(), /test throttle/);
    assert.equal(ai.responses[0]!.status, 429);
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

test("synthetic tool call responses and subsequent results remain provider observations", async () => {
  const ai = await setup();
  try {
    ai.route(() => true, route => route.fulfill({ toolCall: { id: "call-1", name: "read_fixture", input: { path: "/fixture" } } }));
    const response = await fetch(`${ai.baseUrl}/v1/messages`, {
      method: "POST", body: JSON.stringify({ model: "synthetic", messages: [{ role: "user", content: "read" }],
        tools: [{ name: "read_fixture", input_schema: { type: "object" } }] }),
    });
    assert.match(await response.text(), /call-1/);
    assert.equal(ai.requests[0]!.tools[0]!.name, "read_fixture");
    ai.route(() => true, route => {
      assert.equal(route.request.toolResults[0]!.text, "synthetic result");
      return route.fulfill({ text: "done" });
    });
    await (await fetch(`${ai.baseUrl}/v1/messages`, { method: "POST", body: JSON.stringify({ model: "synthetic", messages: [
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "synthetic result" }] },
    ] }) })).text();
    assert.equal(ai.protocolMessages.length, 0);
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

test("shared lifecycle serves the OpenAI Responses codec too", async () => {
  const ai = await setup({ registry: registry("openai-responses") });
  try {
    ai.route(() => true, route => {
      assert.match(route.request.text, /question/);
      return route.fulfill({ text: "responses reply" });
    });
    const response = await fetch(`${ai.baseUrl}/v1/responses`, { method: "POST", body: JSON.stringify({ model: "synthetic", input: "question" }) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /responses reply/);
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

testNodeDisconnect("held request sees client disconnect and the session can serve another request", async () => {
  const ai = await setup();
  const reached = deferred<Route>();
  const released = deferred();
  const client = connect(Number(new URL(ai.baseUrl).port), "127.0.0.1");
  client.on("error", () => {});
  try {
    const remove = ai.route(() => true, async route => {
      reached.resolve(route);
      await route.untilAborted();
      released.resolve();
    });
    await once(client, "connect");
    const body = JSON.stringify({ model: "synthetic", messages: [{ role: "user", content: "held" }] });
    client.write(`POST /v1/messages HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    const route = await within(reached.promise);
    assert.equal(route.signal.aborted, false);
    client.destroy();
    await within(released.promise);
    assert.equal(route.signal.aborted, true);
    await route.untilAborted();
    remove();
    ai.route(() => true, route => route.fulfill({ text: "reused" }));
    assert.match(await (await request(ai)).text(), /reused/);
    assert.equal(ai.responses[0]!.outcome, "aborted");
    ai.assertHealthy();
  } finally { client.destroy(); await ai.dispose(); }
});

test("route.abort breaks a provider connection without poisoning the session", async () => {
  const ai = await setup();
  try {
    ai.route(() => true, route => { route.abort(); route.abort(); });
    await assert.rejects(request(ai));
    assert.equal(ai.responses[0]!.outcome, "aborted");
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});

test("gated streams deliver an initial segment while the remainder is pending", async () => {
  const ai = await setup();
  const gate = deferred();
  try {
    ai.route(() => true, route => route.fulfill({ stream: (async function* () {
      yield { text: "first-marker" };
      await gate.promise;
      yield { text: "last-marker" };
    })() }));
    const response = await request(ai, "stream", { stream: true });
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("first-marker")) {
      const part = await within(reader.read());
      assert.equal(part.done, false);
      text += new TextDecoder().decode(part.value);
    }
    assert.ok(!text.includes("last-marker"));
    assert.equal(ai.responses[0]!.outcome, "pending");
    gate.resolve();
    while (true) {
      const part = await within(reader.read());
      if (part.done) break;
      text += new TextDecoder().decode(part.value);
    }
    assert.ok(text.indexOf("first-marker") < text.indexOf("last-marker"));
    assert.equal(ai.responses[0]!.outcome, "completed");
    ai.assertHealthy();
  } finally { gate.resolve(); await ai.dispose(); }
});

test("dispose releases held handlers, uncooperative gates, waiters, and incomplete bodies", async () => {
  for (const scenario of ["held", "handler", "stream", "body"] as const) {
    const ai = await setup();
    const reached = deferred();
    const streamBlocked = deferred();
    let signal: AbortSignal | undefined;
    let pending: Promise<unknown> | undefined;
    let socket: ReturnType<typeof connect> | undefined;
    try {
      if (scenario === "body") {
        socket = connect(Number(new URL(ai.baseUrl).port), "127.0.0.1");
        socket.on("error", () => {});
        await once(socket, "connect");
        socket.write("POST /v1/messages HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100000\r\n\r\n{");
      } else {
        ai.route(() => true, async route => {
          signal = route.signal;
          reached.resolve();
          if (scenario === "held") await route.untilAborted();
          if (scenario === "handler") await new Promise<void>(() => {});
          if (scenario === "stream") await route.fulfill({ stream: (async function* () {
            yield { text: "start" };
            streamBlocked.resolve();
            await new Promise<void>(() => {});
          })() });
        });
        pending = request(ai, "dispose", { stream: scenario === "stream" }).then(response => response.text()).catch(() => undefined);
        await within(reached.promise);
        if (scenario === "stream") await within(streamBlocked.promise);
      }
      const wait = assert.rejects(ai.waitForRequest(() => false, { timeout: 0 }), /disposed/);
      await within(Promise.all([ai.dispose(), ai.dispose()]));
      await wait;
      if (pending) await within(pending);
      if (signal) assert.equal(signal.aborted, true);
      ai.assertHealthy();
    } finally { socket?.destroy(); await ai.dispose(); }
  }
});

testNodeDisconnect("disconnect during open SSE aborts the route without waiting on its source gate", async () => {
  const ai = await setup();
  const gate = deferred();
  const stopped = deferred();
  const blocked = deferred();
  const client = connect(Number(new URL(ai.baseUrl).port), "127.0.0.1");
  client.on("error", () => {});
  try {
    ai.route(() => true, async route => {
      route.signal.addEventListener("abort", () => stopped.resolve(), { once: true });
      await route.fulfill({ stream: (async function* () {
        yield { text: "sse-start" };
        blocked.resolve();
        await gate.promise;
        yield { text: "sse-end" };
      })() });
    });
    await once(client, "connect");
    const body = JSON.stringify({ model: "synthetic", messages: [], stream: true });
    client.write(`POST /v1/messages HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    await within(blocked.promise);
    client.destroy();
    await within(stopped.promise);
    await within(ai.dispose());
    assert.equal(ai.responses[0]!.outcome, "aborted");
    ai.assertHealthy();
  } finally { client.destroy(); gate.resolve(); await ai.dispose(); }
});

test("late handler rejection stays observed after disposal; abort listeners can reenter dispose", async () => {
  const ai = await setup();
  const gate = deferred();
  const reached = deferred();
  let reentered: Promise<void> | undefined;
  ai.route(() => true, async route => {
    route.signal.addEventListener("abort", () => { reentered = ai.dispose(); }, { once: true });
    reached.resolve();
    await gate.promise;
    throw new Error("late handler failure");
  });
  const pending = request(ai).catch(() => undefined);
  try {
    await within(reached.promise);
    const disposing = ai.dispose();
    await within(disposing);
    assert.equal(reentered, disposing);
    await pending;
    gate.resolve();
    await setImmediate();
    assert.equal(ai.failures.length, 1);
    assert.match(ai.failures[0]!.error.message, /late handler failure/);
    assert.throws(() => ai.assertHealthy());
  } finally { gate.resolve(); await ai.dispose(); }
});

test("prepare signal also disposes an active session and rejects pending waits", async () => {
  const controller = new AbortController();
  const ai = await setup({ signal: controller.signal });
  const pending = assert.rejects(ai.waitForRequest(() => true, { timeout: 0 }), /disposed/);
  controller.abort();
  await pending;
  await within(ai.dispose());
  await assert.rejects(fetch(ai.baseUrl));
  ai.assertHealthy();
});

test("stream exceptions are recorded even when the consumer did not await fulfill", async () => {
  const ai = await setup();
  try {
    ai.route(() => true, route => {
      void route.fulfill({ stream: (async function* () {
        yield { text: "before failure" };
        throw new Error("stream exploded");
      })() });
    });
    await request(ai, "broken", { stream: true }).then(response => response.text()).catch(() => {});
    assert.equal(ai.failures.length, 1);
    assert.match(ai.failures[0]!.error.message, /stream exploded/);
    assert.throws(() => ai.assertHealthy());
  } finally { await ai.dispose(); }
});

test("consumer input and native protocol payloads preserve independent snapshots", async () => {
  const ai = await setup();
  try {
    const data = new Uint8Array([0, 255, 10]);
    const metadata = { source: "consumer", extension: { sequence: 1 } };
    ai.recordInput(data, metadata);
    const payload = { jsonrpc: "2.0", id: 42, method: "session/update", params: { sessionId: "native-session", unknownExtension: [1, { full: true }] } };
    const recorded = ai.recordProtocolMessage("agent-to-client", payload, metadata);
    ai.recordProtocolMessage("client-to-agent", { jsonrpc: "2.0", id: 42, result: { extension: "kept" } });
    payload.params.sessionId = "mutated";
    metadata.extension.sequence = 9;
    data[0] = 99;
    (recorded.payload as typeof payload).params.sessionId = "also-mutated";
    assert.deepEqual(ai.inputs[0]!.data, new Uint8Array([0, 255, 10]));
    assert.equal((ai.inputs[0]!.metadata as typeof metadata).extension.sequence, 1);
    assert.equal((ai.protocolMessages[0]!.payload as typeof payload).params.sessionId, "native-session");
    assert.deepEqual((ai.protocolMessages[0]!.payload as typeof payload).params.unknownExtension, [1, { full: true }]);
    assert.equal(ai.protocolMessages[0]!.direction, "agent-to-client");
    assert.ok(!Object.hasOwn(ai.protocolMessages[0]!.payload as object, "timestamp"));
    assert.equal(ai.requests.length, 0);
    assert.throws(() => ai.recordProtocolMessage("invented" as never, {}), /direction/);
    ai.assertHealthy();
  } finally { await ai.dispose(); }
});
