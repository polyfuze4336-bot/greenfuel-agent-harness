import { defineConfig, devices } from '@playwright/test';

// Three production servers, each started by Playwright so the run is repeatable:
//   3100  normal, reads HEAD
//   3101  STUDIO_REF points at a ref that does not exist, to prove the error state
//   3102  adds a 700 ms delay to repository reads (test-only), to prove the loading skeletons
const serve = (port: number, env: Record<string, string> = {}) => ({ command: `npx next start --hostname localhost --port ${port}`, port, reuseExistingServer: false, timeout: 120_000, env, gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 3000 } });

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: { baseURL: 'http://localhost:3100', channel: 'msedge', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: { width: 1440, height: 900 } } }],
  webServer: [serve(3100), serve(3101, { STUDIO_REF: 'no-such-ref-for-error-test' }), serve(3102, { STUDIO_E2E_DELAY_MS: '700' })],
});
