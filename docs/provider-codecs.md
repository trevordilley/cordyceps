# Provider codecs

`src/provider/index.ts` exports `codecIds` and `getCodec(id)`. The IDs are
`anthropic-messages`, `openai-responses`, `openai-chat-completions`, and
`google-genai`, `amazon-q`, and `augment`; unknown IDs throw. Their shared
interfaces live in `src/provider/types.ts`.
Both the ID list and codec singleton objects are frozen, so callers cannot
replace codec methods globally and affect another session.

The codecs transform provider HTTP data only. Core owns request capture,
the listener, socket writes, backpressure, route failures, and racing pending
iterator pulls against cancellation. Codecs do not run tools, produce tool
results, launch harnesses, infer ACP identities, or contact a live provider.

## Request normalization

| Codec | Matched POST path | Offered tools | Incoming results |
| --- | --- | --- | --- |
| `anthropic-messages` | `/v1/messages` | Named client tools with `input_schema` | `tool_result` content blocks, keyed by `tool_use_id` |
| `openai-responses` | `/v1/responses` | `function` tools with `parameters` | `function_call_output` input items, keyed by `call_id` |
| `openai-chat-completions` | `/v1/chat/completions` | Nested `function` definitions | `role: tool` messages, keyed by `tool_call_id` |
| `amazon-q` | `/` with an explicitly supported `X-Amz-Target` | Native `toolSpecification` | `toolResults`, keyed by `toolUseId` |
| `augment` | `/chat-stream` | Native tool schemas | Type-1 tool-result nodes |
| `google-genai` | `/v1beta/models/<model>:generateContent` or `:streamGenerateContent` (also `/v1`) | `functionDeclarations` | `functionResponse` parts |

Query strings are accepted. Prefix paths, trailing slashes, other endpoints,
and other HTTP methods do not match. The injection base URL must produce one of the codec’s explicit paths.
Gemini streaming requires `alt=sse`; Vertex project/location paths are not supported.
Anthropic also accepts exactly `HEAD /api/hello` and
`POST /v1/messages/count_tokens` (including query strings), observed from real
Claude SDK consumers. These use ordinary capture, consumer routes and failure
reporting; there is no automatic reply. General model listings and response
retrieval/deletion remain unsupported; this is not complete vendor API emulation.

Anthropic and OpenAI decoding requires a JSON object with a nonempty string `model`, except for the bodyless hello probe. Gemini takes the model from the URL and retains the original JSON body. `stream`, when
present, must be boolean; absent means false. Tool and message/input arrays
must be arrays when supplied (Responses also accepts a string `input`). This
is envelope validation, not a complete provider schema validator.

`text` joins explicit conversational text with newlines in request order:
Anthropic system text followed by message text; Responses instructions
followed by message input/output text or string input. It includes history,
not only the last user message. Tool results are separate in `toolResults`.
Images, files, reasoning, tool arguments, and unknown block types are not
converted to prose. They remain available in `body` and the raw capture.

Each normalized tool/result retains its original parsed object in `raw`.
Anthropic result `isError` is true only for `is_error: true`. Responses has no
standard function-output error flag, so its `isError` is false: consumers must
interpret their tool's actual output when needed. Neither codec guesses an
error from words such as “error” in result text. Text result blocks are joined
with newlines; nontext result content stays raw.

The decoder preserves all parsed JSON fields in `body` and leaves its
`RawHttpRequest` argument unchanged. Core attaches that original HTTP data
(including the exact body string and headers) to `CapturedRequest.raw`.

## Scripted responses

`{text}`, `{toolCall}`, `{stream}`, and `{error}` use the shared discriminated
union. Tool calls need nonempty `id` and `name` strings and JSON object input.
Input is JSON-serialized and snapshotted when consumed; ordinary JSON
serialization rules apply, and circular input fails. Names, IDs, and arguments
come from the consumer; the codecs neither select a tool nor execute it.

For the Anthropic, OpenAI and Gemini codecs, `request.stream` selects the wire format, independently of the script shape:

- False: consume the script to completion and emit one JSON response.
- True: emit provider SSE frames as the script produces events. A text event
  is one text delta; adjacent text events form one content block/message. A
  tool event describes one complete call. Following text starts a new block.
- An empty iterable completes with empty content/output. An explicit empty
  text response produces an empty text block.

Anthropic uses message/content-block events with `text_delta` or
`input_json_delta`. Its final stop reason is `tool_use` if any call appeared,
otherwise `end_turn`, followed by `message_stop`.

Responses uses `response.created`, `response.in_progress`, output-item and
content-part events, text or function-arguments delta/done events, and
`response.completed`. Sequence numbers increase from zero. The completed
response includes all finished output items; function item IDs are distinct
from the consumer's `call_id`. No Chat Completions `[DONE]` sentinel is emitted.

Provider message/response IDs are generated locally. Usage counters are zero
placeholders, not tokenizer estimates or billing evidence. Responses are not
stored, and `previous_response_id` does not retrieve prior input or state.

## Anthropic auxiliary requests

Register specific routes after a catch-all model route (newest match wins):

```js
ai.route(r => r.raw.method === 'HEAD' && r.raw.path.split('?')[0] === '/api/hello',
  route => route.fulfill({ health: true }));
ai.route(r => r.raw.method === 'POST' && r.raw.path.split('?')[0] === '/v1/messages/count_tokens',
  route => route.fulfill({ inputTokens: 100 }));
```

The hello request normalizes to empty `model`/`text`, no tools/results, `body:
null`, and `stream: false`; its raw HTTP capture remains available. Its explicit
health reply is HTTP 200 with no body. Token counting retains ordinary Messages
normalization and raw body, always returns JSON `{input_tokens: 100}`, and requires
a nonnegative safe integer. This number is scripted, never a tokenizer estimate.
Each auxiliary response shape is rejected on other endpoints, including Responses.
`{error}` can script errors for auxiliary requests too. An unhandled auxiliary
request still fails session health, just like an unhandled model request.

## Gates, errors, and cancellation

Encoding does not start an async script. Body iteration pulls it lazily;
there is no prefetch or timer-based chunking. SSE lifecycle headers can precede
the first gated event. Nonstream bodies wait for the whole script. Gate timing
is controlled by the consumer's async iterable.

An abort is checked before pulls and before/after yields. It throws the
signal's reason and prevents further wire output or successful terminal
framing. A user iterator blocked inside `next()` cannot be forcibly interrupted
by a codec: **core must race that call against the signal and must not await a
blocked `return()` during disposal**. Normal early iterator return propagates
cleanup through the script. Script exceptions propagate to core and do not
become a successful provider completion.

`{error: {status, message, type?}}` requires an integer HTTP status from 400 to
599. It emits a JSON provider error envelope with that status, even for
streaming requests. Anthropic uses its error type/message envelope and matching
request ID body/header; Responses uses error message/type with null param/code
and an `x-request-id` header. A supplied error type overrides the default.
Midstream error scripting is outside the current `ProviderEvent` union;
throwing from an iterable is a recorded script failure, not a scripted HTTP
error after headers have been sent.

## Sources and validation limits

Wire shapes were checked against official primary documentation on
2026-09-29:

- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)
  for request text, client tools, results, and JSON messages.
- [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
  for content block deltas and terminal events.
- [Anthropic errors](https://platform.claude.com/docs/en/api/errors)
  for HTTP error shapes and status types.
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
  for function tools, call IDs, arguments, and output items.
- [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
  for event payloads, sequence numbers, and response completion.

`tests/codecs.test.ts` uses synthetic fixtures only. It covers normalization,
raw preservation, JSON and SSE text/tools, mixed and empty streams, gate
ordering, errors, cancellation checkpoints, and iterator cleanup. It does not
certify any harness, SDK version, model, real tool execution, socket behavior,
or ACP integration. Hosted tools, custom tools, multimodal output, reasoning
output, stored responses, and provider-side schema enforcement are outside
this initial encoding subset. Unsupported request fields remain inspectable.


## Chat Completions and Gemini

Chat Completions produces ordinary `chat.completion` JSON or data-only SSE
`chat.completion.chunk` objects. Tool deltas retain stable IDs and increasing
per-call indices. Successful streaming ends with the appropriate `stop` or
`tool_calls` finish reason, optional requested usage chunk, and `[DONE]`.
Usage numbers remain explicit zero placeholders. Legacy `functions` /
`function_call`, multiple choices, audio and reasoning output are not implemented.
See the official [function-calling wire examples](https://developers.openai.com/api/docs/guides/function-calling).

Gemini produces native candidate `content.parts` containing text or
`functionCall`, followed by `finishReason: STOP`. Streaming uses data-only SSE,
without the OpenAI `[DONE]` sentinel. Incoming function responses retain their
reported ID; clients omitting IDs are represented by their function name, so
consumers must inspect raw parts when same-name calls need disambiguation.
Thought/image data stays raw. This codec covers Developer API generation,
not Vertex routing, token counting, model discovery or thought signatures.

Some agents implement their tool protocol within model text. Verified Aider
shell instructions and Cline XML tools use ordinary Chat Completions text,
and their real results occur in subsequent conversation text. The library
preserves these exchanges; it does not pretend they were native function calls
or parse agent-specific instructions into `toolResults`.


## Amazon Q and Augment native services

`amazon-q` accepts exactly the three native `X-Amz-Target` operations documented
in [the Q consumer](real-q.md). Generation emits binary AWS event-stream frames,
including length fields and CRC32, rather than SSE. Assistant deltas and tool
start/input/stop events terminate at HTTP EOF. Q buffers one content delta while
looking for citations, so the consumer emits two before testing a held stream.
Model discovery and telemetry are captured auxiliary requests that require
explicit `{amazonQ: {models: [...]}}` or `{amazonQ: {telemetry: true}}` replies.
There is no automatic startup response or generated tool result.

`augment` emits newline-delimited JSON for `/chat-stream`, with native text and
tool nodes and a terminal stop reason. The exact `/get-models` bootstrap accepts
`{augmentModels: {defaultModel: 'fixture-model'}}`; the real client needs this
metadata to include its initial prompt. The three other observed startup routes
are captured and require explicit scripted errors in the verified example.
Unknown service routes still fail. See [the Auggie consumer](real-auggie.md) for
the installed-package protocol evidence and exact limits. Both codecs retain
auxiliary captures separately from the generation exchanges. These narrow
service subsets do not claim full vendor API emulation.
