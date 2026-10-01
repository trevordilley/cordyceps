import type { EncodedResponse } from './provider/types.js';

export interface RawHttpResponse {
  status: number;
  headers?: Record<string, string>;
  /** Bytes are sent without provider serialization; useful for invalid JSON or SSE. */
  body: string | Uint8Array | AsyncIterable<string | Uint8Array>;
}
export function encodeRaw(response: RawHttpResponse): EncodedResponse {
  if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599)
    throw new TypeError('Raw response status must be between 200 and 599');
  const body = response.body;
  if (typeof body !== 'string' && !(body instanceof Uint8Array) &&
    (!body || typeof body[Symbol.asyncIterator] !== 'function')) throw new TypeError('Raw response requires text, bytes or an async iterable');
  return { status: response.status, headers: { ...response.headers }, body: (async function* () {
    if (typeof body === 'string' || body instanceof Uint8Array) yield body;
    else for await (const chunk of body) {
      if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) throw new TypeError('Raw response chunks must be strings or bytes');
      yield chunk;
    }
  })() };
}
