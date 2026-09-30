import { expect, test } from "bun:test";
import { codebuff } from "../src/provider/codebuff.js";
import type { CapturedRequest, RawHttpRequest } from "../src/provider/types.js";
const raw = (path: string, body = "{}", method = "POST"): RawHttpRequest => ({
  method,
  path,
  body,
  headers: {},
});
const capture = (raw: RawHttpRequest): CapturedRequest => ({
  id: "test",
  timestamp: 0,
  raw,
  ...codebuff.decode(raw),
});
const consume = async (body: AsyncIterable<string | Uint8Array>) => {
  let text = "";
  for await (const part of body)
    text += typeof part === "string" ? part : new TextDecoder().decode(part);
  return text;
};

test("Codebuff scopes the model endpoint and observed auxiliary methods", () => {
  expect(codebuff.matches("POST", "/api/v1/chat/completions")).toBe(true);
  expect(codebuff.matches("GET", "/api/v1/me?fields=id,email")).toBe(true);
  expect(codebuff.matches("POST", "/api/v1/me")).toBe(false);
  expect(codebuff.matches("POST", "/api/v1/delete-account")).toBe(false);
  expect(codebuff.matches("POST", "/v1/chat/completions")).toBe(false);
  expect(() => codebuff.decode(raw("/unknown"))).toThrow("Unsupported");
});

test("Codebuff preserves native Chat tools, results and provider SSE completion", async () => {
  const request = capture(
    raw(
      "/api/v1/chat/completions",
      JSON.stringify({
        model: "fixture",
        stream: true,
        messages: [
          { role: "user", content: "read fixture" },
          {
            role: "tool",
            tool_call_id: "native-id",
            content: "actual-file-token",
          },
        ],
        tools: [
          {
            type: "function",
            function: { name: "read_files", parameters: { type: "object" } },
          },
        ],
      }),
    ),
  );
  expect(request.text).toBe("read fixture");
  expect(request.toolResults[0]?.id).toBe("native-id");
  expect(request.toolResults[0]?.text).toBe("actual-file-token");
  expect(request.tools[0]?.name).toBe("read_files");
  expect(request.raw.path).toBe("/api/v1/chat/completions");
  const encoded = codebuff.encode(
    request,
    {
      toolCall: {
        id: "read-id",
        name: "read_files",
        input: { paths: ["fixture.txt"] },
      },
    },
    new AbortController().signal,
  );
  const wire = await consume(encoded.body);
  expect(encoded.headers["content-type"]).toContain("text/event-stream");
  expect(wire).toContain("read_files");
  expect(wire).toContain("tool_calls");
  expect(wire).toContain("[DONE]");
});

test("Codebuff account state requires explicit object JSON or explicit error", async () => {
  const request = capture(raw("/api/v1/me", "", "GET")),
    signal = new AbortController().signal;
  expect(request.text).toBe("");
  expect(request.tools).toEqual([]);
  for (const text of ["hello", "[]", "null"])
    expect(() => codebuff.encode(request, { text }, signal)).toThrow();
  expect(() => codebuff.encode(request, { health: true }, signal)).toThrow();
  expect(() =>
    codebuff.encode(request, { text: "{}", health: true } as never, signal),
  ).toThrow();
  const object = { id: "local-fixture" };
  expect(
    JSON.parse(
      await consume(
        codebuff.encode(request, { text: JSON.stringify(object) }, signal).body,
      ),
    ),
  ).toEqual(object);
  const error = codebuff.encode(
    request,
    { error: { status: 401, message: "fixture rejection" } },
    signal,
  );
  expect(error.status).toBe(401);
  expect(await consume(error.body)).toContain("fixture rejection");
});
