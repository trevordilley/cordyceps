import { encodeRaw } from "./raw-response.js";
import type { RawHttpResponse } from "./raw-response.js";
import { exportTranscript } from "./transcript.js";
import type { TranscriptOptions } from "./transcript.js";
import { normalizeMessages } from "./matching.js";
import { createScenario } from "./scenario.js";
import type { ScenarioStep, ScenarioOptions, StepExpectation, RouteMatch } from "./scenario.js";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { createRegistry } from "./registry.js";
import type { HarnessRegistry } from "./registry.js";
import { renderInjection, validateSelection } from "./injection.js";
import { getCodec } from "./provider/index.js";
import type { CapturedRequest, RawHttpRequest, ScriptedResponse, EncodedResponse } from "./provider/types.js";
import { installClaudeSettings } from "./claude-settings.js";
import type { ClaudeSettingsOptions, ClaudeSettingsInstallation } from "./claude-settings.js";
import { createObservations } from "./observations.js";
import type { ConsumerObservations } from "./observations.js";

export type RequestPredicate = (request: CapturedRequest) => boolean;
export type RouteHandler = (route: Route) => void | Promise<void>;

export interface Route {
  readonly request: CapturedRequest;
  readonly signal: AbortSignal;
  fulfill(response: ScriptedResponse): Promise<void>;
  fulfillRaw(response: RawHttpResponse): Promise<void>;
  /** Hold the response until client disconnect, explicit abort, or session disposal. */
  untilAborted(): Promise<void>;
  /** Break this provider connection, including a response already streaming. */
  abort(): void;
}

export interface WaitOptions {
  /** Milliseconds; defaults to 5000. Zero disables the timeout. */
  timeout?: number;
  signal?: AbortSignal;
  /** Only inspect requests after this requestCursor() value. */
  after?: number;
}

export interface PrepareOptions {
  harness: string;
  /** Loopback listening port; 0 (the default) selects an available port. */
  port?: number;
  mode?: string;
  registry?: HarnessRegistry;
  inputs?: Record<string, string>;
  signal?: AbortSignal;
  /** Maximum incoming HTTP body size; defaults to 16 MiB. */
  maxRequestBodyBytes?: number;
}

export interface SessionFailure {
  timestamp: number;
  requestId?: string;
  error: Error;
}

/** Wire chunks accepted by the HTTP writer, not decoded text or ACP messages. */
export interface ResponseObservation {
  requestId: string;
  timestamp: number;
  status: number | null;
  headers: Record<string, string>;
  chunks: (string | Uint8Array)[];
  outcome: "pending" | "completed" | "aborted" | "failed";
}

type Injection = Awaited<ReturnType<typeof renderInjection>>;

export interface AISession extends ConsumerObservations {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly args: Injection["args"];
  readonly configFiles: Injection["configFiles"];
  installClaudeSettings(options: ClaudeSettingsOptions): Promise<ClaudeSettingsInstallation>;
  environment: Injection["environment"];
  route(predicate: RequestPredicate, handler: RouteHandler, options?: { name?: string }): () => void;
  scenario(steps: readonly ScenarioStep[], options?: ScenarioOptions): void;
  readonly expectations: readonly StepExpectation[];
  readonly matches: readonly RouteMatch[];
  /** Aborts on the first provider/route/scenario failure, for consumer-owned cancellation. */
  readonly failureSignal: AbortSignal;
  guard<T>(work: PromiseLike<T> | (() => PromiseLike<T>)): Promise<T>;
  requestCursor(): number;
  waitForNextRequest(predicate: RequestPredicate, options?: Omit<WaitOptions, 'after'>): Promise<CapturedRequest>;
  assertComplete(): void;
  exportTranscript(options?: TranscriptOptions): unknown;
  readonly requests: readonly CapturedRequest[];
  readonly responses: readonly ResponseObservation[];
  readonly failures: readonly SessionFailure[];
  /** Searches existing requests first, then subscribes to future captures. */
  waitForRequest(predicate: RequestPredicate, options?: WaitOptions): Promise<CapturedRequest>;
  assertHealthy(): void;
  /** Idempotent cleanup. Recorded scenario failures are reported by assertHealthy. */
  dispose(): Promise<void>;
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error), { cause: error });
}

/** Always observes the losing promise, without waiting for consumer-owned work. */
function abortable<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

class HttpFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function readBody(request: IncomingMessage, limit: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off("data", data).off("end", end).off("error", error);
      signal.removeEventListener("abort", abort);
    };
    const error = (reason: unknown) => { cleanup(); reject(reason); };
    const abort = () => error(signal.reason);
    const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString("utf8")); };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        error(new HttpFailure(413, `Provider request exceeds ${limit} bytes`));
        request.resume();
      } else chunks.push(chunk);
    };
    request.on("data", data).once("end", end).once("error", error);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function prepare(options: PrepareOptions): Promise<AISession> {
  options.signal?.throwIfAborted();
  const definition = (options.registry ?? createRegistry()).get(options.harness);
  const mode = options.mode ?? "interactive";
  // Validate original descriptors before cloning: cloning would evaluate getters
  // and erase invalid prototypes that the injection validator must reject.
  validateSelection(definition, mode, options.inputs ?? {});
  const inputs = structuredClone(options.inputs ?? {});
  const codec = getCodec(definition.provider.adapter);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError("port must be an integer between 0 and 65535");
  const installations = new Set<Awaited<ReturnType<typeof installClaudeSettings>>>();
  const installationTasks = new Set<Promise<ClaudeSettingsInstallation>>();
  const bodyLimit = options.maxRequestBodyBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) throw new TypeError("maxRequestBodyBytes must be a positive safe integer");

  const requests: CapturedRequest[] = [];
  const responses: ResponseObservation[] = [];
  const failures: SessionFailure[] = [];
  const routes: { predicate: RequestPredicate; handler: RouteHandler; name: string }[] = [];
  const matches: RouteMatch[] = [];
  let scenario: ReturnType<typeof createScenario> | undefined;
  let routeNumber = 0;
  const failureController = new AbortController();
  const waiters = new Set<{ check(request: CapturedRequest): void; reject(error: unknown): void }>();
  const sockets = new Set<Socket>();
  const active = new Set<AbortController>();
  const tasks = new Set<Promise<void>>();
  const disposedError = abortError("Cordyceps session disposed");
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let injection: Injection | undefined;

  const ensureActive = () => { if (disposed) throw disposedError; };
  const observations = createObservations(ensureActive);
  const recordFailure = (error: unknown, requestId?: string) => {
    const failure = { timestamp: Date.now(), error: asError(error), ...(requestId === undefined ? {} : { requestId }) };
    failures.push(failure);
    if (!failureController.signal.aborted) failureController.abort(failure.error);
    for (const waiter of [...waiters]) waiter.reject(failure.error);
  };

  async function dispatch(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    const controller = new AbortController();
    const { signal } = controller;
    active.add(controller);
    let captured: CapturedRequest | undefined;
    let response: ResponseObservation | undefined;
    let failed = false;
    const fail = (error: unknown) => {
      if (signal.aborted && (error === signal.reason ||
        (error instanceof Error && error.name === "AbortError" && error.cause === signal.reason))) return;
      if (!failed) { failed = true; recordFailure(error, captured?.id); }
      if (response) response.outcome = "failed";
    };
    const disconnect = () => {
      if (!outgoing.writableFinished) controller.abort(abortError("Provider client disconnected"));
    };
    const transportError = (error: Error) => { fail(error); controller.abort(error); };
    incoming.once("aborted", disconnect);
    incoming.socket.once("close", disconnect);
    outgoing.once("close", disconnect).on("error", transportError);
    // An incomplete body can emit an error after its reader has been cancelled.
    incoming.on("error", disconnect);
    if (disposed) controller.abort(disposedError);
    try {
      signal.throwIfAborted();
      const raw: RawHttpRequest = {
        method: incoming.method ?? "GET", path: incoming.url ?? "/",
        headers: structuredClone(incoming.headers), body: await readBody(incoming, bodyLimit, signal),
      };
      if (!codec.matches(raw.method, raw.path)) throw new HttpFailure(404, `Unsupported provider request: ${raw.method} ${raw.path}`);
      try {
        const decoded = codec.decode(raw);
        captured = structuredClone({ ...decoded, messages: normalizeMessages(decoded), id: randomUUID(), timestamp: Date.now(), raw });
      } catch (error) { throw new HttpFailure(400, `Invalid provider request: ${asError(error).message}`); }
      requests.push(captured);
      response = { requestId: captured.id, timestamp: Date.now(), status: null, headers: {}, chunks: [], outcome: "pending" };
      responses.push(response);
      for (const waiter of [...waiters]) waiter.check(captured);
      signal.throwIfAborted();
      const selected = scenario ? scenario.select(captured)
        : [...routes].reverse().find(route => route.predicate(structuredClone(captured!)));
      if (!selected) throw new HttpFailure(500, `No route matched provider request ${captured.id}`);
      matches.push({ requestId: captured.id, name: selected.name, kind: 'kind' in selected ? selected.kind : 'route' });
      let responseTask: Promise<void> | undefined;
      let claimed = false;

      const deliver = async (encode: () => EncodedResponse) => {
        const encoded = encode();
        response!.status = encoded.status;
        response!.headers = { ...encoded.headers };
        outgoing.writeHead(encoded.status, encoded.headers);
        outgoing.flushHeaders();
        const iterator = encoded.body[Symbol.asyncIterator]();
        let ended = false;
        try {
          while (true) {
            signal.throwIfAborted();
            const next = await abortable(iterator.next(), signal);
            if (next.done) { ended = true; break; }
            signal.throwIfAborted();
            const writable = outgoing.write(next.value);
            response!.chunks.push(typeof next.value === "string" ? next.value : new Uint8Array(next.value));
            if (!writable) await once(outgoing, "drain", { signal });
          }
          const finished = once(outgoing, "finish", { signal });
          outgoing.end();
          await finished;
          if (!failed) response!.outcome = "completed";
        } finally {
          // return() can queue behind a user gate: request it, but never await it.
          if (!ended && iterator.return) {
            try { void Promise.resolve(iterator.return()).catch(fail); } catch (error) { fail(error); }
          }
        }
      };

      const route: Route = {
        request: structuredClone(captured), signal,
        fulfill(script) {
          signal.throwIfAborted();
          if (claimed) throw new Error("Provider request already handled");
          claimed = true;
          responseTask = deliver(() => codec.encode(structuredClone(captured!), script, signal));
          // Observe even an unawaited fulfill; dispatch also waits for its completion.
          void responseTask.catch(fail);
          return responseTask;
        },
        fulfillRaw(script) {
          signal.throwIfAborted();
          if (claimed) throw new Error("Provider request already handled");
          claimed = true;
          responseTask = deliver(() => encodeRaw(script));
          void responseTask.catch(fail);
          return responseTask;
        },
        untilAborted() {
          if (signal.aborted) return Promise.resolve();
          return new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
        },
        abort() {
          if (signal.aborted) return;
          if (outgoing.writableFinished) throw new Error("Provider response already completed");
          claimed = true;
          controller.abort(abortError("Provider request aborted by route"));
          outgoing.destroy();
        },
      };
      const handler = Promise.resolve().then(() => { signal.throwIfAborted(); return selected.handler(route); });
      void handler.catch(fail);
      await abortable(handler, signal);
      if (responseTask) await abortable(responseTask, signal);
      signal.throwIfAborted();
      if (!claimed) throw new Error(`Route returned without fulfilling or aborting provider request ${captured.id}`);
    } catch (error) {
      fail(error);
      if (signal.aborted) {
        if (response && !failed) response.outcome = "aborted";
        outgoing.destroy();
      } else if (!outgoing.headersSent && !outgoing.destroyed) {
        const status = error instanceof HttpFailure ? error.status : 500;
        const body = JSON.stringify({ error: { type: "cordyceps_error", message: asError(error).message } });
        const headers = { "content-type": "application/json", connection: "close" };
        if (response) { response.status = status; response.headers = headers; response.chunks.push(body); }
        outgoing.writeHead(status, headers);
        outgoing.end(body);
      } else outgoing.destroy();
      if (!signal.aborted) controller.abort(error);
    } finally {
      active.delete(controller);
      incoming.off("aborted", disconnect);
      incoming.socket.off("close", disconnect);
      // Keep error listeners until stream close, which can follow dispatch completion.
      incoming.once("close", () => incoming.off("error", disconnect));
      outgoing.once("close", () => outgoing.off("error", transportError));
    }
  }

  const server = createServer((incoming, outgoing) => {
    const task = dispatch(incoming, outgoing);
    tasks.add(task);
    void task.catch(recordFailure).finally(() => tasks.delete(task));
  });
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    if (disposed) socket.destroy();
  });
  server.on("error", recordFailure);

  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    disposed = true;
    options.signal?.removeEventListener("abort", onAbort);
    routes.length = 0;
    // Cache the promise before invoking consumer abort listeners (which may reenter).
    disposal = Promise.resolve().then(async () => {
      for (const waiter of [...waiters]) waiter.reject(disposedError);
      for (const controller of active) controller.abort(disposedError);
      // Start close before destroying sockets so no new connection escapes cleanup.
      const closed = new Promise<void>((resolve, reject) => {
        if (!server.listening) { resolve(); return; }
        server.close(error => error ? reject(error) : resolve());
      });
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled([...installationTasks]);
      const results = await Promise.allSettled([closed, Promise.all([...tasks]), Promise.resolve().then(() => injection?.dispose()), ...[...installations].map(setup => setup.dispose())]);
      const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      try { scenario?.assertComplete(); } catch (error) { errors.push(error); }
      if (scenario && failures.length) errors.push(new AggregateError(failures.map(failure => failure.error), failures.map(failure => failure.error.message).join("; ")));
      if (errors.length) throw new AggregateError(errors, `Cordyceps cleanup/completion failed: ${errors.map(error => asError(error).message).join('; ')}`);
    });
    return disposal;
  };
  const onAbort = () => { void dispose().catch(recordFailure); };

  try {
    await new Promise<void>((resolve, reject) => {
      const error = (reason: Error) => { server.off("listening", listening); reject(reason); };
      const listening = () => { server.off("error", error); resolve(); };
      server.once("error", error).once("listening", listening);
      server.listen(port, "127.0.0.1");
    });
    options.signal?.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Mock provider did not acquire a TCP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const apiKey = `cordyceps-${randomUUID()}`;
    injection = await renderInjection(definition, mode, inputs, { baseUrl, apiKey }, options.signal);
    options.signal?.throwIfAborted();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const prepared = injection;
    const session: AISession = {
      baseUrl, apiKey,
      failureSignal: failureController.signal,
      exportTranscript(options) {
        return exportTranscript({ requests, responses: options?.redact === false ? responses : responses.map(({ chunks, ...response }) => ({
          ...response, chunkCount: chunks.length, body: Buffer.concat(chunks.map(chunk => typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk))).toString('utf8'),
        })), failures, matches,
          expectations: scenario?.expectations ?? [], inputs: observations.inputs, protocolMessages: observations.protocolMessages }, options, [apiKey]);
      },
      guard(work) {
        ensureActive();
        failureController.signal.throwIfAborted();
        return abortable(typeof work === 'function' ? Promise.resolve().then(work) : work, failureController.signal);
      },
      requestCursor() { ensureActive(); return requests.length; },
      waitForNextRequest(predicate, options) { return session.waitForRequest(predicate, { ...options, after: requests.length }); },
      scenario(steps, options) {
        ensureActive();
        if (scenario || requests.length || routes.length) throw new Error('Register one scenario before requests or routes; declare background traffic in its options');
        scenario = createScenario(steps, options);
      },
      get expectations() { return scenario?.expectations ?? []; },
      get matches() { return structuredClone(matches); },
      assertComplete() { scenario?.assertComplete(); session.assertHealthy(); },
      installClaudeSettings(options) {
        ensureActive();
        if (!['claude-code', 'claude-code-acp'].includes(definition.id)) throw new TypeError('Claude settings require a Claude Code recipe');
        const task = installClaudeSettings(options, baseUrl, apiKey, base => { ensureActive(); return prepared.environment(base); })
          .then(async setup => {
            if (disposed) { await setup.dispose(); throw disposedError; }
            installations.add(setup);
            const { dispose: cleanup, ...publicSetup } = setup;
            return publicSetup;
          });
        installationTasks.add(task);
        void task.finally(() => installationTasks.delete(task)).catch(() => {});
        return task;
      },
      get args() { return structuredClone(prepared.args); },
      get configFiles() { return structuredClone(prepared.configFiles); },
      environment(base) { ensureActive(); return prepared.environment(base); },
      get inputs() { return observations.inputs; },
      get protocolMessages() { return observations.protocolMessages; },
      recordInput: observations.recordInput,
      recordProtocolMessage: observations.recordProtocolMessage,
      get requests() { return structuredClone(requests); },
      get responses() { return structuredClone(responses); },
      get failures() { return structuredClone(failures); },
      route(predicate, handler, options = {}) {
        ensureActive();
        if (typeof predicate !== "function" || typeof handler !== "function") throw new TypeError("route requires a predicate and handler");
        if (scenario) throw new Error("Use explicit scenario background routes instead of route() after scenario registration");
        const registration = { predicate, handler, name: options.name ?? `route-${++routeNumber}` };
        routes.push(registration);
        return () => { const index = routes.indexOf(registration); if (index >= 0) routes.splice(index, 1); };
      },
      async waitForRequest(predicate, { timeout = 5000, signal, after = 0 } = {}) {
        ensureActive();
        signal?.throwIfAborted();
        if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2 ** 31 - 1) throw new TypeError("timeout must be between 0 and 2147483647 milliseconds");
        if (!Number.isSafeInteger(after) || after < 0 || after > requests.length) throw new TypeError("after must be a requestCursor() from this session");
        for (const request of requests.slice(after)) {
          const snapshot = structuredClone(request);
          if (predicate(snapshot)) return structuredClone(request);
        }
        ensureActive();
        signal?.throwIfAborted();
        if (failures.length) throw new AggregateError(failures.map(failure => failure.error), "Cordyceps session has failures");
        return new Promise<CapturedRequest>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); waiters.delete(waiter); };
          const abort = () => waiter.reject(signal!.reason);
          const waiter = {
            reject(error: unknown) { cleanup(); reject(error); },
            check(request: CapturedRequest) {
              try {
                if (predicate(structuredClone(request))) { cleanup(); resolve(structuredClone(request)); }
              } catch (error) { waiter.reject(error); }
            },
          };
          waiters.add(waiter);
          signal?.addEventListener("abort", abort, { once: true });
          if (timeout > 0) timer = setTimeout(() => waiter.reject(new Error(`Timed out waiting for provider request after ${timeout}ms`)), timeout);
        });
      },
      assertHealthy() {
        if (failures.length) throw new AggregateError(failures.map(failure => failure.error), `Cordyceps recorded ${failures.length} failure(s):\n${failures.map(failure => failure.error.message).join("\n")}`);
      },
      dispose,
    };
    return session;
  } catch (error) {
    try { await dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Cordyceps preparation and cleanup failed"); }
    throw error;
  }
}
