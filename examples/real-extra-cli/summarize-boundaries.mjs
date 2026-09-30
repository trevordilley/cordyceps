// Compact real receipts without replacing native tool results or fabricating support verdicts.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const [workflowPath, diagnosticPath, destination] = process.argv.slice(2);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const request = (r) => ({
  id: r.id,
  method: r.raw.method,
  path: r.raw.path,
  model: r.model,
  stream: r.stream,
  rawBodyBytes: Buffer.byteLength(r.raw.body),
  rawBodySHA256: hash(r.raw.body),
  offeredTools: r.tools.map((t) => t.name),
  toolResults: r.toolResults,
  nativeAssistantCalls: r.body?.messages
    ?.filter((m) => m.role === "assistant")
    .flatMap((m) => m.tool_calls ?? []),
  promptMessages: r.body?.messages?.filter((m) => m.role === "user"),
});
const receipts = [];
for (const file of [workflowPath, diagnosticPath]) {
  const bytes = await readFile(file);
  const receipt = JSON.parse(bytes);
  receipts.push({
    date: receipt.date,
    packageEntry: receipt.packageEntry,
    artifact: receipt.artifact,
    fullReceiptSHA256: hash(bytes),
    cases: receipt.cases.map((c) => {
      const { providerRequests, logs, serviceRequests, ...rest } = c;
      return {
        ...rest,
        providerRequests: providerRequests?.map(request),
        serviceRequests: serviceRequests.map((r) => ({
          method: r.method,
          url: r.url,
          bodyBytes: Buffer.byteLength(r.body),
          bodySHA256: hash(r.body),
        })),
        logs: logs?.map((l) => ({
          path: l.path,
          tailSHA256: hash(l.tail),
          messages: l.tail.split("\n").flatMap((line) => {
            try {
              const value = JSON.parse(line);
              return [value.msg ?? value.debug ?? value.error].filter(Boolean);
            } catch {
              return [];
            }
          }),
        })),
      };
    }),
  });
}
await writeFile(
  destination,
  JSON.stringify(
    {
      note: "Positive workflows and released-binary diagnostics are separate; counts include only actual captured requests.",
      receipts,
    },
    null,
    2,
  ) + "\n",
);
