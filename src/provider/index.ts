import { anthropicMessages } from './anthropic-messages.js';
import { openaiResponses } from './openai-responses.js';
import { openaiChatCompletions } from './openai-chat-completions.js';
import type { ProviderCodec } from './types.js';

export const codecIds: readonly string[] = Object.freeze(['anthropic-messages', 'openai-responses', 'openai-chat-completions']);

export function getCodec(id: string): ProviderCodec {
  switch (id) {
    case 'anthropic-messages': return anthropicMessages;
    case 'openai-responses': return openaiResponses;
    case 'openai-chat-completions': return openaiChatCompletions;
    default: throw new Error(`Unknown provider codec: ${id}`);
  }
}
