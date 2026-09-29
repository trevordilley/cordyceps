import { test as base, expect } from '@playwright/test';
import { prepare } from './session.js';

export interface CordycepsFixtures {
  ai: Awaited<ReturnType<typeof prepare>>;
  cordyceps: Parameters<typeof prepare>[0] | undefined;
}

/** Test-scoped adapter over the standalone backend. Consumer fixtures own their app. */
export const test = base.extend<CordycepsFixtures>({
  cordyceps: [undefined, { option: true }],
  ai: async ({ cordyceps }, use) => {
    if (!cordyceps) throw new Error('Set test.use({ cordyceps: { harness, mode } }) before requesting the ai fixture.');
    const ai = await prepare(cordyceps);
    try {
      await use(ai);
    } finally {
      // Cleanup runs even when the app/test fails; asynchronous route assertions must
      // also fail the test when its HTTP caller ignored the backend's error response.
      await ai.dispose();
      ai.assertHealthy();
    }
  },
});
export { expect };
