# Required scenarios and diagnostics

Routes describe possible responses. A scenario describes interactions that must
happen. Use one when a test should fail if the app never reaches the provider.

```js
import { test, expect } from 'cordyceps/playwright';
import { match, anthropic, validateToolCall } from 'cordyceps';
import { startApp } from './support/app.js'; // Your app's launch/cleanup helper.

test.use({ cordyceps: { harness: 'claude-code', mode: 'nonInteractive' } });

test('the app reads the requested file', async ({ ai, page }) => {
  ai.scenario([
    {
      name: 'request a read',
      match: match.lastUserMessage('Read fixture.txt'),
      handle: route => {
        const call = { id: 'read-fixture', name: 'Read',
          input: { file_path: '/test-workspace/fixture.txt' } };
        validateToolCall(route.request, call);
        return route.fulfill({ toolCall: call });
      },
    },
    {
      name: 'receive the real file',
      match: match.toolResult({ id: 'read-fixture', isError: false }),
      handle: route => {
        const result = route.request.messages.flatMap(m => m.toolResults)
          .findLast(r => r.id === 'read-fixture');
        expect(result?.text).toContain('fixture-only-value');
        return route.fulfill({ text: 'File read successfully' });
      },
    },
  ], { background: anthropic.background({ inputTokens: 32 }) });

  const app = await startApp({ env: ai.environment(process.env) });
  try {
    // guard rejects on the first route/scenario failure, before an app retry timeout.
    await ai.guard(async () => {
      await page.goto(app.url);
      await page.getByLabel('Prompt').fill('Read fixture.txt');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(page.getByLabel('Reply')).toHaveText('File read successfully');
    });
  } finally { await app.close(); }
});
```

Replace the helper, selectors and fixture path with your app's setup. The fixture
value should be written into the disposable workspace before launch, not included
in the prompt or scripted tool call.

Steps run in request-arrival order. Each defaults to one required call; `times: 2`
requires two consecutive matching calls before the next step. Missing steps,
extra calls, out-of-order matches and undeclared traffic fail. Make matchers
specific enough to distinguish steps; if two steps deliberately match the same
request, the current step wins. Counts measure requests accepted by a step, not
successful application turns.

Explicit `background` routes are checked first and don't consume steps. The
Anthropic helpers handle only health and token-count endpoints; token counts are
scripted values, not estimates. Their requests and named matches remain visible.
For ordinary routing, use `anthropic.routeBackground(ai, { inputTokens: 32 })`.

Register one scenario before requests or routes arrive. Don't mix it with
`ai.route()`; put allowed background traffic in the scenario options. A scenario
is checked automatically during `dispose()`, including Playwright fixture
teardown. `ai.assertComplete()` checks it earlier. Ordinary routes retain their
existing behavior: zero matching requests are allowed, and `assertHealthy()`
checks recorded failures.

## Match the current turn

`request.messages` preserves message roles, text and tool results separately for
Anthropic Messages, OpenAI Chat Completions/Responses, Gemini, and Amazon Q
conversations, including gateways that delegate those formats. Other provider
shapes remain available in `request.body` and `request.raw`. `request.text` stays
available as a flattened search across the conversation.

- `match.lastUserMessage('hello')` matches the last textual user message exactly.
  It also accepts a regular expression or a text predicate. System instructions,
  assistant messages and tool-result bodies don't become user text.
- `match.toolResult({ id, text, isError })` inspects tool results at the end of the
  conversation. Each filter is optional; text accepts the same matchers.
- `ai.requestCursor()` records the current request count. Pass it as `after` to
  exclude older captures, even if the same prompt is used again.

```js
const cursor = ai.requestCursor();
await app.send('Hello again');
const request = await ai.waitForRequest(match.lastUserMessage('Hello again'), {
  after: cursor,
});
```

Or register `ai.waitForNextRequest(predicate)` **before** triggering the action.
It only observes requests arriving after that call. Plain `waitForRequest()`
continues to search existing captures first.

## Failures and artifacts

The Playwright fixture attaches `cordyceps-transcript` JSON on test, route, or
scenario failure. It contains requests, responses, named route/step matches,
errors and required call counts. `ai.exportTranscript()` provides the same
redacted snapshot in standalone tests.

```js
const transcript = ai.exportTranscript({ secrets: ['an-extra-sensitive-value'] });
```

Exports redact known credential fields, authorization/cookie headers, URL
credentials, the session key and explicitly supplied secret values. Stream chunks
are joined for redaction so a credential split across chunks is still removed.
Arbitrary sensitive prose needs an explicit `secrets` entry. For automatic
Playwright attachments, set `test.use({ cordycepsSecrets: ['extra-sensitive-value'] })`. The original
`ai.requests` and `ai.responses` remain unchanged for assertions; an explicit
`{ redact: false }` exports raw data.

Use `ai.guard(() => appOperation())` to race an application operation against the
first recorded failure. It doesn't cancel that operation or own the app: close
your app in `finally`, or use `ai.failureSignal` with your own cancellation code.
Without a guard, the fixture still reports the failure at teardown. Route names
can also be supplied outside scenarios with `ai.route(match, handler, { name })`.

## Invalid wire responses

`fulfillRaw()` bypasses provider serialization while retaining capture, abort and
cleanup behavior. It works on the provider endpoints understood by the selected
codec. HTTP status/headers still follow Node's HTTP rules; the payload can be
invalid JSON, malformed SSE or arbitrary bytes.

```js
ai.route(() => true, route => route.fulfillRaw({
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
  body: (async function* () {
    yield 'event: content_block_delta\n';
    yield 'data: {not valid JSON}\n\n';
  })(),
}));
```

`validateToolCall(request, call)` checks the offered name/namespace and input
JSON Schema before you send it. It reports available tools if, for example, the
agent offers `Edit` and `Read` but no `Write`. Validation is opt-in so tests can
still deliberately send unsupported calls through `fulfill()` or raw replies.
Draft-07 and 2020-12 schemas are supported; schemas must be self-contained and
synchronous. The helper does not coerce inputs or execute the tool.
