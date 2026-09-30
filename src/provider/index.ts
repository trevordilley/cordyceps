import { amazonQ } from './amazon-q.js';
import { augment } from './augment.js';
import { googleGenai } from './google-genai.js';
import { anthropicMessages } from './anthropic-messages.js';
import { openaiResponses } from './openai-responses.js';
import { openaiChatCompletions } from './openai-chat-completions.js';
import type { ProviderCodec } from './types.js';

export const codecIds: readonly string[] = Object.freeze(['anthropic-messages', 'openai-responses', 'openai-chat-completions', 'google-genai', 'amazon-q', 'augment']);

export function getCodec(id: string): ProviderCodec {
  switch (id) {
    case 'amazon-q': return amazonQ;
    case 'augment': return augment;
    case 'google-genai': return googleGenai;
    case 'anthropic-messages': return anthropicMessages;
    case 'openai-responses': return openaiResponses;
    case 'openai-chat-completions': return openaiChatCompletions;
    default: throw new Error(`Unknown provider codec: ${id}`);
  }
}
