import type { ProviderCodec } from './types.js';
import { encoded, json, object } from './common.js';
import { openaiChatCompletions } from './openai-chat-completions.js';

const auxiliary = (method: string, path: string) => {
  const name = path.split('?')[0]!;
  return method.toUpperCase() === 'GET' && (
    ['/api/v1/models', '/api/tags', '/v1/props', '/props', '/version', '/v1/models', '/models'].includes(name)
    || /^\/v1\/models\/[^/]+$/.test(name))
    || method.toUpperCase() === 'POST' && name === '/api/show';
};

/** Hermes probes local endpoint metadata before using its Chat Completions client.
 * Each probe remains captured and requires an explicit consumer reply. */
export const hermes: ProviderCodec = Object.freeze({
  id: 'hermes',
  matches: (method: string, path: string) => openaiChatCompletions.matches(method, path) || auxiliary(method, path),
  decode(raw) {
    if (openaiChatCompletions.matches(raw.method, raw.path)) return openaiChatCompletions.decode(raw);
    if (!auxiliary(raw.method, raw.path)) throw new TypeError('Unsupported Hermes endpoint');
    const body: unknown = raw.body ? JSON.parse(raw.body) : null;
    if (body !== null && !object(body)) throw new TypeError('Hermes metadata request requires an object');
    return { model: '', stream: false, text: '', tools: [], toolResults: [], body };
  },
  encode(request, response, signal) {
    if (openaiChatCompletions.matches(request.raw.method, request.raw.path)) return openaiChatCompletions.encode(request, response, signal);
    if (!auxiliary(request.raw.method, request.raw.path)) throw new TypeError('Unsupported Hermes endpoint');
    if (response.error !== undefined) return openaiChatCompletions.encode(request, response, signal);
    if (typeof response.text !== 'string') throw new TypeError('Hermes metadata replies require explicit JSON object text');
    const body: unknown = JSON.parse(response.text);
    if (!object(body)) throw new TypeError('Hermes metadata replies require explicit JSON object text');
    return encoded(json(body), signal, false);
  },
} satisfies ProviderCodec);
