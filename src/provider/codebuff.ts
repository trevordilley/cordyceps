import { encoded, errorStatus, json, object } from "./common.js";
import { openaiChatCompletions } from "./openai-chat-completions.js";
import type { ProviderCodec, RawHttpRequest } from "./types.js";

const modelPath = "/api/v1/chat/completions";
const metadata = new Set([
  "GET /api/healthz",
  "GET /api/v1/me",
  "POST /api/v1/usage",
  "GET /api/user/subscription",
  "GET /api/v1/ads/policy",
  "POST /api/agents/validate",
  "POST /api/v1/agent-runs",
  "POST /api/logs",
  "POST /batch/",
]);
const path = (value: string) => value.split("?")[0]!;
const isModel = (raw: RawHttpRequest) =>
  raw.method.toUpperCase() === "POST" && path(raw.path) === modelPath;

/** Codebuff's native hosted-provider path. Account/log fixtures remain explicitly consumer-scripted. */
export const codebuff: ProviderCodec = Object.freeze({
  id: "codebuff",
  matches(method, url) {
    return (
      (method.toUpperCase() === "POST" && path(url) === modelPath) ||
      metadata.has(`${method.toUpperCase()} ${path(url)}`)
    );
  },
  decode(raw) {
    if (isModel(raw)) return openaiChatCompletions.decode(raw);
    if (!metadata.has(`${raw.method.toUpperCase()} ${path(raw.path)}`))
      throw new TypeError("Unsupported Codebuff operation");
    // Telemetry can be compressed. Preserve its raw body rather than pretending it is a model prompt.
    let body: unknown = raw.body;
    if (raw.body) {
      try {
        body = JSON.parse(raw.body);
      } catch {
        /* opaque telemetry */
      }
    }
    return {
      model: "",
      stream: false,
      text: "",
      tools: [],
      toolResults: [],
      body,
    };
  },
  encode(request, response, signal) {
    if (isModel(request.raw))
      return openaiChatCompletions.encode(request, response, signal);
    if (
      !metadata.has(
        `${request.raw.method.toUpperCase()} ${path(request.raw.path)}`,
      )
    )
      throw new TypeError("Unsupported Codebuff operation");
    if (
      Object.keys(response).length !== 1 ||
      Object.keys(response).some((key) => key !== "text" && key !== "error")
    )
      throw new TypeError("Codebuff metadata requires text or error only");
    if (response.error)
      return encoded(
        json({ error: response.error.message }),
        signal,
        false,
        errorStatus(response.error),
      );
    if (typeof response.text !== "string")
      throw new TypeError(
        "Codebuff metadata requires an explicitly scripted JSON object text or error",
      );
    const value: unknown = JSON.parse(response.text);
    if (!object(value))
      throw new TypeError("Codebuff metadata reply must be a JSON object");
    return encoded(json(value), signal, false);
  },
} satisfies ProviderCodec);
