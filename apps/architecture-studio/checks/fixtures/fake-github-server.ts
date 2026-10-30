// Runs the GitHub stand-in as a process for the browser tests. Test use only: it is not GitHub and it is steerable over HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { FakeGitHub } from './fake-github.ts';

const dir = process.env.FAKE_GITHUB_DIR;
const port = Number(process.env.FAKE_GITHUB_PORT ?? 3105);
if (!dir) throw new Error('FAKE_GITHUB_DIR is required');
const fake = new FakeGitHub({
  remoteGitDir: path.join(dir, 'origin.git'),
  repo: process.env.FAKE_GITHUB_REPO ?? 'acme/greenfuel',
  appId: process.env.FAKE_GITHUB_APP_ID ?? '12345',
  installationId: process.env.FAKE_GITHUB_INSTALLATION_ID ?? '678',
  publicKeyPem: fs.readFileSync(path.join(dir, 'app-public-key.pem'), 'utf8'),
  allowControl: true,
});
const url = await fake.start(port);
console.log(`fake GitHub listening on ${url}`);
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => void fake.stop().then(() => process.exit(0)));
