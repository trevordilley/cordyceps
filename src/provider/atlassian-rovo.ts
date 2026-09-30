import type { ProviderCodec, RawHttpRequest } from './types.js';
import { encoded, json, object } from './common.js';
import { openaiChatCompletions } from './openai-chat-completions.js';

const pathOnly = (path: string) => path.split('?')[0];
const isChat = (raw: Pick<RawHttpRequest, 'method' | 'path'>) => raw.method.toUpperCase() === 'POST'
  && pathOnly(raw.path) === '/v1/openai/v1/chat/completions';
const auxiliary = (method: string, path: string) => {
  const name = pathOnly(path);
  return method.toUpperCase() === 'GET' && name === '/v3/credits/check'
    || method.toUpperCase() === 'POST' && name === '/prompt-moderation/';
};

/** The observed Rovo gateway paths, not arbitrary aliases for Chat Completions. */
export const atlassianRovo: ProviderCodec = Object.freeze({
  id: 'atlassian-rovo',
  matches: (method: string, path: string) => isChat({ method, path }) || auxiliary(method, path),
  decode(raw) {
    if (isChat(raw)) return openaiChatCompletions.decode({ ...raw, path: '/v1/chat/completions' });
    if (!auxiliary(raw.method, raw.path)) throw new TypeError('Unsupported Rovo endpoint');
    const body: unknown = raw.body ? JSON.parse(raw.body) : null;
    if (body !== null && !object(body)) throw new TypeError('Rovo auxiliary body must be an object');
    return { model: '', stream: false, text: object(body) && typeof body.prompt === 'string' ? body.prompt : '', tools: [], toolResults: [], body };
  },
  encode(request, response, signal) {
    if (isChat(request.raw) || response.error !== undefined)
      return openaiChatCompletions.encode(request, response, signal);
    if (!auxiliary(request.raw.method, request.raw.path)) throw new TypeError('Unsupported Rovo endpoint');
    // The consumer scripts the actual metadata object as JSON text. No implicit
    // moderation decision, credit allocation, authentication or upstream call.
    if (typeof response.text !== 'string') throw new TypeError('Rovo auxiliary replies require JSON object text');
    const body: unknown = JSON.parse(response.text);
    if (!object(body)) throw new TypeError('Rovo auxiliary replies require JSON object text');
    return encoded(json(body), signal, false);
  },
} satisfies ProviderCodec);
