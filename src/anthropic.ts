import type { AISession } from './session.js';
import type { ScenarioRoute } from './scenario.js';

export const anthropic = {
  /** Explicit, named auxiliary routes; requests remain visible in captures and matches. */
  background({ inputTokens }: { inputTokens: number }): ScenarioRoute[] {
    if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) throw new TypeError('inputTokens must be a nonnegative safe integer');
    return [
      { name: 'anthropic.health', match: request => request.raw.method === 'HEAD' && request.raw.path.split('?')[0] === '/api/hello',
        handle: route => route.fulfill({ health: true }) },
      { name: 'anthropic.token-count', match: request => request.raw.method === 'POST' && request.raw.path.split('?')[0] === '/v1/messages/count_tokens',
        handle: route => route.fulfill({ inputTokens }) },
    ];
  },
  routeBackground(ai: AISession, options: { inputTokens: number }): () => void {
    const remove = anthropic.background(options).map(route => ai.route(route.match, route.handle, { name: route.name }));
    return () => { for (const unregister of remove) unregister(); };
  },
};
