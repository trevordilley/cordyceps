import type { ProviderCodec } from './types.js';
import { encoded, json } from './common.js';
import { openaiChatCompletions } from './openai-chat-completions.js';

const prewarm = (method: string, path: string) => method.toUpperCase() === 'GET' && path === '/';
/** Official Grok Build's observed origin prewarm and Chat Completions requests. */
export const grokBuild: ProviderCodec = Object.freeze({
  id: 'grok-build',
  matches: (method: string, path: string) => prewarm(method, path) || openaiChatCompletions.matches(method, path),
  decode(raw) {
    if (!prewarm(raw.method, raw.path)) return openaiChatCompletions.decode(raw);
    if (raw.body) throw new TypeError('Grok prewarm request must have an empty body');
    return { model: '', stream: false, text: '', tools: [], toolResults: [], body: null };
  },
  encode(request, response, signal) {
    if (!prewarm(request.raw.method, request.raw.path) || response.error !== undefined)
      return openaiChatCompletions.encode(request, response, signal);
    if (Object.keys(response).length !== 1 || response.health !== true)
      throw new TypeError('Grok prewarm requires explicit health response');
    return encoded(json({ ok: true }), signal, false);
  },
} satisfies ProviderCodec);
