import { anthropicMessages } from './anthropic-messages.js';
import { openaiResponses } from './openai-responses.js';
import type { ProviderCodec } from './types.js';

export const codecIds: readonly string[] = Object.freeze(['anthropic-messages', 'openai-responses']);

export function getCodec(id: string): ProviderCodec {
  switch (id) {
    case 'anthropic-messages': return anthropicMessages;
    case 'openai-responses': return openaiResponses;
    default: throw new Error(`Unknown provider codec: ${id}`);
  }
}
