export default {
  testDir: '.', testMatch: 'frontend.spec.mjs', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 20_000 },
  use: { browserName: 'chromium', headless: true, trace: 'retain-on-failure' },
};
