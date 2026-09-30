import type { ProviderCodec } from './types.js';
import { encoded, json, object } from './common.js';
import { openaiResponses } from './openai-responses.js';

const catalog = (method: string, path: string) => method.toUpperCase() === 'GET' && path === '/muse-code/models';
/** Muse's observed catalog bootstrap plus its native Responses model transport. */
export const museCode: ProviderCodec = Object.freeze({
  id: 'muse-code',
  matches: (method: string, path: string) => catalog(method, path) || openaiResponses.matches(method, path),
  decode(raw) {
    if (!catalog(raw.method, raw.path)) return openaiResponses.decode(raw);
    if (raw.body) throw new TypeError('Muse catalog request must have an empty body');
    return { model: '', stream: false, text: '', tools: [], toolResults: [], body: null };
  },
  encode(request, response, signal) {
    if (!catalog(request.raw.method, request.raw.path) || response.error !== undefined)
      return openaiResponses.encode(request, response, signal);
    if (Object.keys(response).length !== 1 || typeof response.text !== 'string')
      throw new TypeError('Muse catalog requires explicit JSON object text');
    const body: unknown = JSON.parse(response.text);
    if (!object(body)) throw new TypeError('Muse catalog requires explicit JSON object text');
    return encoded(json(body), signal, false);
  },
} satisfies ProviderCodec);
