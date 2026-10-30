import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PEOPLE, makeFixture, policyJson } from './checks/fixtures/review-fixture.ts';

// Four production servers, each started by Playwright so the run is repeatable:
//   3100  normal, reads HEAD
//   3101  STUDIO_REF points at a ref that does not exist, to prove the error state
//   3102  adds a 700 ms delay to repository reads (test-only), to prove the loading skeletons
//   3103  TEST MODE against a throw-away clone with a local bare "GitHub" remote, a simulated pull-request service and test
//         identities, to exercise the whole decision-review workflow without touching the real repository or GitHub
const serve = (port: number, env: Record<string, string> = {}) => ({ command: `npx next start --hostname localhost --port ${port}`, port, reuseExistingServer: false, timeout: 120_000, env: { STUDIO_CACHE_DIR: path.join(os.tmpdir(), `studio-e2e-cache-${process.pid}-${port}`), ...env }, gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 3000 } });

// The fixture is created once, by the process that loads this file first; workers inherit the folder through the environment.
const reviewDir = (process.env.STUDIO_E2E_REVIEW_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-review-')));
if (!fs.existsSync(path.join(reviewDir, 'work'))) makeFixture({ dir: reviewDir, cloneFrom: path.resolve(process.cwd(), '..', '..'), policy: policyJson([...PEOPLE, { githubLogin: 'test-owner2', githubId: 1005, holder: 'Test Owner Two', roles: ['programme-owner'] }]) });

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: { baseURL: 'http://localhost:3100', channel: 'msedge', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: { width: 1440, height: 900 } } }],
  webServer: [
    serve(3100),
    serve(3101, { STUDIO_REF: 'no-such-ref-for-error-test' }),
    serve(3102, { STUDIO_E2E_DELAY_MS: '700' }),
    serve(3103, { STUDIO_REPO_ROOT: path.join(reviewDir, 'work'), STUDIO_TEST_MODE: '1', STUDIO_TEST_FIXTURE_DIR: path.join(reviewDir, 'state'), STUDIO_TEST_REMOTE_GIT_DIR: path.join(reviewDir, 'origin.git'), STUDIO_CACHE_DIR: path.join(reviewDir, 'cache') }),
  ],
});
