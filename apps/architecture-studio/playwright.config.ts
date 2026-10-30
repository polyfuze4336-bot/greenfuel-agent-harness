import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PEOPLE, makeFixture, policyJson } from './checks/fixtures/review-fixture.ts';
import { makeAppKeys } from './checks/fixtures/fake-github.ts';

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

// A second throw-away world for the GitHub App path: a clone, a bare remote that the stand-in GitHub serves, and an app key pair.
const appDir = (process.env.STUDIO_E2E_APP_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-app-')));
if (!fs.existsSync(path.join(appDir, 'work'))) {
  makeFixture({ dir: appDir, cloneFrom: path.resolve(process.cwd(), '..', '..'), policy: policyJson([...PEOPLE, { githubLogin: 'test-owner2', githubId: 1005, holder: 'Test Owner Two', roles: ['programme-owner'] }]) });
  makeAppKeys(appDir);
}
export const APP_WEBHOOK_SECRET = 'whsec-e2e-secret';

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
    // The stand-in for the GitHub REST API (test only), and a Studio configured as a GitHub App against it.
    { command: 'node checks/fixtures/fake-github-server.ts', port: 3105, reuseExistingServer: false, timeout: 60_000, env: { FAKE_GITHUB_DIR: appDir, FAKE_GITHUB_PORT: '3105' }, gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 3000 } },
    serve(3104, {
      STUDIO_REPO_ROOT: path.join(appDir, 'work'),
      STUDIO_TEST_MODE: '1',
      STUDIO_TEST_FIXTURE_DIR: path.join(appDir, 'state'),
      STUDIO_CACHE_DIR: path.join(appDir, 'cache'),
      STUDIO_GITHUB_APP_ID: '12345',
      STUDIO_GITHUB_APP_INSTALLATION_ID: '678',
      STUDIO_GITHUB_REPO: 'acme/greenfuel',
      STUDIO_GITHUB_APP_PRIVATE_KEY_FILE: path.join(appDir, 'app-private-key.pem'),
      STUDIO_GITHUB_API_URL: 'http://127.0.0.1:3105',
      STUDIO_GITHUB_GIT_URL: path.join(appDir, 'origin.git'),
      STUDIO_GITHUB_WEBHOOK_SECRET: APP_WEBHOOK_SECRET,
      STUDIO_WEBHOOK_HOSTS: 'hooks.example.test',
    }),
  ],
});
