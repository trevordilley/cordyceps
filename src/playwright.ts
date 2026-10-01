import { test as base, expect } from '@playwright/test';
import { prepare } from './session.js';

export interface CordycepsFixtures {
  ai: Awaited<ReturnType<typeof prepare>>;
  cordyceps: Parameters<typeof prepare>[0] | undefined;
  cordycepsSecrets: readonly string[];
}

/** Test-scoped adapter over the standalone backend. Consumer fixtures own their app. */
export const test = base.extend<CordycepsFixtures>({
  cordyceps: [undefined, { option: true }],
  cordycepsSecrets: [[], { option: true }],
  ai: async ({ cordyceps, cordycepsSecrets }, use, testInfo) => {
    if (!cordyceps) throw new Error('Set test.use({ cordyceps: { harness, mode } }) before requesting the ai fixture.');
    const ai = await prepare(cordyceps);
    try {
      await use(ai);
    } finally {
      // Cleanup runs even when the app/test fails; asynchronous route assertions must
      // also fail the test when its HTTP caller ignored the backend's error response.
      const errors: unknown[] = [];
      try { await ai.dispose(); } catch (error) { errors.push(error); }
      try { ai.assertHealthy(); } catch (error) { errors.push(error); }
      if (errors.length || testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('cordyceps-transcript', {
          contentType: 'application/json', body: Buffer.from(JSON.stringify(ai.exportTranscript({ secrets: cordycepsSecrets }), null, 2)),
        });
      }
      if (errors.length) throw new AggregateError(errors, errors.map(error => error instanceof Error ? error.message : String(error)).join('\n'));
    }
  },
});
export { expect };
