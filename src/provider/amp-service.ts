import type { ProviderCodec, RawHttpRequest } from './types.js';
import { encoded, json, object } from './common.js';
import { anthropicMessages } from './anthropic-messages.js';

const pathOnly = (path: string) => path.split('?')[0];
const isChat = (raw: Pick<RawHttpRequest, 'method' | 'path'>) => raw.method.toUpperCase() === 'POST'
  && pathOnly(raw.path) === '/api/provider/anthropic/v1/messages';
const auxiliary = (method: string, path: string) => method.toUpperCase() === 'POST' && [
  '/api/internal?getUserInfo', '/api/internal?getThread',
  '/api/internal?getUserFreeTierStatus', '/api/internal?uploadThread',
].includes(path);

/** The observed Amp service and Anthropic gateway paths. */
export const ampService: ProviderCodec = Object.freeze({
  id: 'amp-service',
  matches: (method: string, path: string) => isChat({ method, path }) || auxiliary(method, path),
  decode(raw) {
    if (isChat(raw)) return anthropicMessages.decode({ ...raw, path: '/v1/messages' });
    if (!auxiliary(raw.method, raw.path)) throw new TypeError('Unsupported Amp endpoint');
    const body: unknown = raw.body ? JSON.parse(raw.body) : null;
    if (body !== null && !object(body)) throw new TypeError('Amp auxiliary body must be an object');
    return { model: '', stream: false, text: object(body) && typeof body.prompt === 'string' ? body.prompt : '', tools: [], toolResults: [], body };
  },
  encode(request, response, signal) {
    if (isChat(request.raw) || response.error !== undefined)
      return anthropicMessages.encode(request, response, signal);
    if (!auxiliary(request.raw.method, request.raw.path)) throw new TypeError('Unsupported Amp endpoint');
    // The consumer scripts the actual metadata object as JSON text. No implicit
    // account state, thread persistence, authentication or upstream call.
    if (typeof response.text !== 'string') throw new TypeError('Amp auxiliary replies require JSON object text');
    const body: unknown = JSON.parse(response.text);
    if (!object(body)) throw new TypeError('Amp auxiliary replies require JSON object text');
    return encoded(json(body), signal, false);
  },
} satisfies ProviderCodec);
