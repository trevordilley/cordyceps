import { randomUUID } from 'node:crypto';
import type { EncodedResponse, ProviderEvent, RawHttpRequest, ScriptedResponse } from './types.js';

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseRequest(raw: RawHttpRequest): Record<string, unknown> & { model: string } {
  const body: unknown = JSON.parse(raw.body);
  if (!object(body) || typeof body.model !== 'string' || !body.model) {
    throw new TypeError('Provider request must be a JSON object with a nonempty model');
  }
  if (body.stream !== undefined && typeof body.stream !== 'boolean') {
    throw new TypeError('Provider request stream must be a boolean');
  }
  return body as Record<string, unknown> & { model: string };
}

export function array(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

/** Only explicit text blocks are flattened; images, reasoning, and tool data stay raw. */
export function textContent(value: unknown, types: readonly string[]): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap(part => object(part) && typeof part.type === 'string'
    && types.includes(part.type) && typeof part.text === 'string' ? [part.text] : []);
}

export function matchesPath(method: string, path: string, endpoint: string): boolean {
  return method.toUpperCase() === 'POST' && path.split('?')[0] === endpoint;
}

export function wireId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function sse(type: string, fields: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
}

/** Check each pull and yield; core races a blocked next() against abort. */
export async function* guarded<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  signal.throwIfAborted();
  for await (const value of source) {
    signal.throwIfAborted();
    yield value;
    signal.throwIfAborted();
  }
  signal.throwIfAborted();
}

export function encoded(body: AsyncIterable<string>, signal: AbortSignal, stream: boolean, status = 200): EncodedResponse {
  return {
    status,
    headers: stream
      ? { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }
      : { 'content-type': 'application/json; charset=utf-8' },
    body: guarded(body, signal),
  };
}

export async function* json(value: unknown): AsyncGenerator<string> {
  yield JSON.stringify(value);
}

export function errorStatus(error: { status: number }): number {
  if (!Number.isInteger(error.status) || error.status < 400 || error.status > 599) {
    throw new TypeError('Scripted error status must be an integer from 400 to 599');
  }
  return error.status;
}

function event(value: unknown): ProviderEvent {
  if (!object(value)) throw new TypeError('Provider event must contain text or toolCall');
  if (typeof value.text === 'string' && value.toolCall === undefined) return { text: value.text };
  const call = value.toolCall;
  if (value.text === undefined && object(call) && typeof call.id === 'string' && call.id
    && typeof call.name === 'string' && call.name && object(call.input)) {
    // Snapshot arguments as JSON once, so later consumer mutation cannot change a done event.
    const input: unknown = JSON.parse(JSON.stringify(call.input));
    if (call.namespace !== undefined && (typeof call.namespace !== 'string' || call.namespace.length === 0))
      throw new TypeError('Tool namespace must be a nonempty string');
    if (object(input)) return { toolCall: { id: call.id, name: call.name, ...(call.namespace === undefined ? {} : { namespace: call.namespace }), input } };
  }
  throw new TypeError('Provider event requires text or a toolCall with id, name, and JSON object input');
}

export async function* events(response: ScriptedResponse, signal: AbortSignal, allowNamespace = false): AsyncGenerator<ProviderEvent> {
  signal.throwIfAborted();
  if (response.stream !== undefined) {
    for await (const value of guarded(response.stream, signal)) {
      const parsed = event(value);
      if (!allowNamespace && 'toolCall' in parsed && parsed.toolCall.namespace !== undefined)
        throw new TypeError('Tool namespaces require the OpenAI Responses codec');
      yield parsed;
    }
  } else {
    const parsed = event(response);
    if (!allowNamespace && 'toolCall' in parsed && parsed.toolCall.namespace !== undefined)
      throw new TypeError('Tool namespaces require the OpenAI Responses codec');
    yield parsed;
  }
}

/** Adjacent text deltas represent one text block, even in a nonstream response. */
export async function collect(response: ScriptedResponse, signal: AbortSignal, allowNamespace = false): Promise<ProviderEvent[]> {
  const result: ProviderEvent[] = [];
  for await (const value of events(response, signal, allowNamespace)) {
    const last = result.at(-1);
    if ('text' in value && last && 'text' in last) last.text += value.text;
    else result.push(value);
  }
  return result;
}
