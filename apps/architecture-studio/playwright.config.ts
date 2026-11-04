import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { makeFixture, policyJson } from './checks/fixtures/review-fixture.ts';
import { makeAppKeys } from './checks/fixtures/fake-github.ts';
import { FakeEntra, entraE2ePolicy } from './checks/fixtures/fake-entra.ts';
import crypto from 'node:crypto';
import { makeAcceptanceWorld } from './checks/fixtures/acceptance-world.ts';

// Four production servers, each started by Playwright so the run is repeatable:
//   3100  normal, reads HEAD
//   3101  STUDIO_REF points at a ref that does not exist, to prove the error state
//   3102  adds a 700 ms delay to repository reads (test-only), to prove the loading skeletons
//   3103  TEST MODE against a throw-away clone with a local bare "GitHub" remote, a simulated pull-request service and test
//         identities, to exercise the whole decision-review workflow without touching the real repository or GitHub
const serve = (port: number, env: Record<string, string> = {}) => ({ command: `npx next start --hostname localhost --port ${port}`, port, reuseExistingServer: false, timeout: 120_000, env: { STUDIO_CACHE_DIR: path.join(os.tmpdir(), `studio-e2e-cache-${process.pid}-${port}`), STUDIO_WARM: '0', ...env }, gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 3000 } });

// The fixture is created once, by the process that loads this file first; workers inherit the folder through the environment.
const reviewDir = (process.env.STUDIO_E2E_REVIEW_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-review-')));
if (!fs.existsSync(path.join(reviewDir, 'work'))) makeFixture({ dir: reviewDir, cloneFrom: path.resolve(process.cwd(), '..', '..'), policy: policyJson() });

// A second throw-away world for the GitHub App path: a clone, a bare remote that the stand-in GitHub serves, and an app key pair.
const appDir = (process.env.STUDIO_E2E_APP_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-app-')));
if (!fs.existsSync(path.join(appDir, 'work'))) {
  makeFixture({ dir: appDir, cloneFrom: path.resolve(process.cwd(), '..', '..'), policy: policyJson() });
  makeAppKeys(appDir);
}
export const APP_WEBHOOK_SECRET = 'whsec-e2e-secret';

// A fifth world for the review-to-readiness journey (e2e/journey.spec.ts): a Studio configured as a GitHub App (3109) against its own
// stand-in for the GitHub API (3110), so the journey can approve, merge, push new commits and cause outages without disturbing the others.
const journeyDir = (process.env.STUDIO_E2E_JOURNEY_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-journey-')));
if (!fs.existsSync(path.join(journeyDir, 'work'))) {
  makeFixture({ dir: journeyDir, cloneFrom: path.resolve(process.cwd(), '..', '..'), policy: policyJson() });
  makeAppKeys(journeyDir);
}
export const JOURNEY_WEBHOOK_SECRET = 'whsec-journey-secret';

// A third world for Microsoft Entra sign-in: a clone with the Entra access policy, a signing key and client secret on disk (as an
// operator would provide them), and a stand-in identity provider on 3107. Studio on 3106 runs in Entra mode against it.
const entraDir = (process.env.STUDIO_E2E_ENTRA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-entra-')));
if (!fs.existsSync(path.join(entraDir, 'work'))) {
  makeFixture({ dir: entraDir, cloneFrom: path.resolve(process.cwd(), '..', '..'), policy: entraE2ePolicy() });
  fs.writeFileSync(path.join(entraDir, 'signing-key.pem'), crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(path.join(entraDir, 'client-secret.txt'), new FakeEntra().secret);
}

// A fourth world for the end-to-end acceptance chain (e2e/acceptance.spec.ts), served on 3108.
const accDir = (process.env.STUDIO_E2E_ACC_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-acc-')));
if (!fs.existsSync(path.join(accDir, 'work'))) makeAcceptanceWorld(accDir, path.resolve(process.cwd(), '..', '..'));

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
    // The read-only deployment, as it runs on Azure: no sign-in is possible and nothing shared may be written.
    serve(3111, { STUDIO_AUTH_MODE: 'public-readonly' }),
    serve(3108, { STUDIO_REPO_ROOT: path.join(accDir, 'work'), STUDIO_TEST_MODE: '1', STUDIO_TEST_FIXTURE_DIR: path.join(accDir, 'state'), STUDIO_TEST_REMOTE_GIT_DIR: path.join(accDir, 'origin.git'), STUDIO_CACHE_DIR: path.join(accDir, 'cache'), STUDIO_ALLOW_DEV_APPROVALS: '1' }),
    serve(3101, { STUDIO_REF: 'no-such-ref-for-error-test' }),
    serve(3102, { STUDIO_E2E_DELAY_MS: '700' }),
    serve(3103, { STUDIO_REPO_ROOT: path.join(reviewDir, 'work'), STUDIO_TEST_MODE: '1', STUDIO_TEST_FIXTURE_DIR: path.join(reviewDir, 'state'), STUDIO_TEST_REMOTE_GIT_DIR: path.join(reviewDir, 'origin.git'), STUDIO_CACHE_DIR: path.join(reviewDir, 'cache'), STUDIO_ALLOW_DEV_APPROVALS: '1' }),
    // The stand-in for the GitHub REST API (test only), and a Studio configured as a GitHub App against it.
    { command: 'node checks/fixtures/fake-github-server.ts', port: 3105, reuseExistingServer: false, timeout: 60_000, env: { FAKE_GITHUB_DIR: appDir, FAKE_GITHUB_PORT: '3105' }, gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 3000 } },
    { command: 'node checks/fixtures/fake-entra-server.ts', port: 3107, reuseExistingServer: false, timeout: 60_000, env: { FAKE_ENTRA_PORT: '3107' }, gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 3000 } },
    serve(3106, {
      STUDIO_AUTH_MODE: 'entra',
      STUDIO_ENTRA_TENANT_ID: new FakeEntra().tenantId,
      STUDIO_ENTRA_CLIENT_ID: new FakeEntra().clientId,
      STUDIO_ENTRA_CLIENT_SECRET_FILE: path.join(entraDir, 'client-secret.txt'),
      STUDIO_ENTRA_REDIRECT_URI: 'http://localhost:3106/api/v1/auth/entra/callback',
      STUDIO_ENTRA_AUTHORITY: 'http://127.0.0.1:3107',
      STUDIO_SIGNING_KEY_FILE: path.join(entraDir, 'signing-key.pem'),
      STUDIO_REPO_ROOT: path.join(entraDir, 'work'),
      STUDIO_TEST_MODE: '1',
      STUDIO_TEST_FIXTURE_DIR: path.join(entraDir, 'state'),
      STUDIO_TEST_REMOTE_GIT_DIR: path.join(entraDir, 'origin.git'),
      STUDIO_CACHE_DIR: path.join(entraDir, 'cache'),
    }),
    { command: 'node checks/fixtures/fake-github-server.ts', port: 3110, reuseExistingServer: false, timeout: 60_000, env: { FAKE_GITHUB_DIR: journeyDir, FAKE_GITHUB_PORT: '3110' }, gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 3000 } },
    serve(3109, {
      STUDIO_REPO_ROOT: path.join(journeyDir, 'work'),
      STUDIO_TEST_MODE: '1',
      STUDIO_TEST_FIXTURE_DIR: path.join(journeyDir, 'state'),
      STUDIO_CACHE_DIR: path.join(journeyDir, 'cache'),
      STUDIO_ALLOW_DEV_APPROVALS: '1',
      STUDIO_MERGE_POLICY_TTL_MS: '0',
      STUDIO_GITHUB_APP_ID: '12345',
      STUDIO_GITHUB_APP_INSTALLATION_ID: '678',
      STUDIO_GITHUB_REPO: 'acme/greenfuel',
      STUDIO_GITHUB_APP_PRIVATE_KEY_FILE: path.join(journeyDir, 'app-private-key.pem'),
      STUDIO_GITHUB_API_URL: 'http://127.0.0.1:3110',
      STUDIO_GITHUB_GIT_URL: path.join(journeyDir, 'origin.git'),
      STUDIO_GITHUB_WEBHOOK_SECRET: JOURNEY_WEBHOOK_SECRET,
    }),
    serve(3104, {
      STUDIO_REPO_ROOT: path.join(appDir, 'work'),
      STUDIO_TEST_MODE: '1',
      STUDIO_TEST_FIXTURE_DIR: path.join(appDir, 'state'),
      STUDIO_CACHE_DIR: path.join(appDir, 'cache'),
      STUDIO_ALLOW_DEV_APPROVALS: '1',
      STUDIO_MERGE_POLICY_TTL_MS: '0',
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
