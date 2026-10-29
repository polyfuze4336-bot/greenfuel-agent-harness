import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { validateIsolation, runtimeSelfCheck, parseJsonc } = await import('../harness/scripts/validate-isolation.mjs');
const { guardedRun, acceptable } = await import('../harness/scripts/guarded-run.mjs');
const integrity = require('../harness/lib/integrity.cjs');

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'gf-iso-'));
const fixtureRoot = () => { const r = tmp(); cpSync(path.join(REPO, '.devcontainer'), path.join(r, '.devcontainer'), { recursive: true }); return r; };
const edit = (root, file, fn) => { const p = path.join(root, '.devcontainer', file); writeFileSync(p, fn(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))); };

test('the real isolation configuration passes static validation', () => {
  const r = validateIsolation(REPO);
  assert.deepEqual(r.errors, []);
  assert.ok(r.notes.some((n) => /pinned by tag, not digest/.test(n)), 'the digest-pinning gap is reported, not hidden');
});

const MUTATIONS = [
  ['drops --cap-drop=ALL', 'devcontainer.json', (t) => t.replace('"--cap-drop=ALL",', ''), /--cap-drop=ALL/],
  ['adds --privileged', 'devcontainer.json', (t) => t.replace('"--cap-drop=ALL",', '"--cap-drop=ALL", "--privileged",'), /privileged/],
  ['adds a dangerous capability', 'devcontainer.json', (t) => t.replace('"--cap-add=NET_RAW",', '"--cap-add=NET_RAW", "--cap-add=SYS_ADMIN",'), /cap-add=SYS_ADMIN/],
  ['uses the host network', 'devcontainer.json', (t) => t.replace('"--cap-drop=ALL",', '"--cap-drop=ALL", "--network=host",'), /network/],
  ['allows new privileges', 'devcontainer.json', (t) => t.replace('"--security-opt=no-new-privileges",', ''), /no-new-privileges/],
  ['unbounds memory', 'devcontainer.json', (t) => t.replace('"--memory=6g"', '"--shm-size=1g"'), /bound memory/],
  ['mounts the Docker socket', 'devcontainer.json', (t) => t.replace('"mounts": [', '"mounts": ["source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind",'), /Docker socket|host system path/],
  ['mounts the Azure CLI profile', 'devcontainer.json', (t) => t.replace('"mounts": [', '"mounts": ["source=${localEnv:USERPROFILE}/.azure,target=/home/node/.azure,type=bind",'), /credential store|localEnv/],
  ['mounts the SSH keys', 'devcontainer.json', (t) => t.replace('"mounts": [', '"mounts": ["source=/home/u/.ssh,target=/home/node/.ssh,type=bind",'), /credential store/],
  ['adds Docker-in-Docker', 'devcontainer.json', (t) => t.replace('"overrideCommand"', '"features": { "ghcr.io/devcontainers/features/docker-in-docker:2": {} },\n  "overrideCommand"'), /Docker feature/],
  ['forwards a host env var', 'devcontainer.json', (t) => t.replace('"GIT_TERMINAL_PROMPT": "0"', '"GIT_TERMINAL_PROMPT": "${localEnv:GH_TOKEN}"'), /localEnv/],
  ['runs as root', 'devcontainer.json', (t) => t.replace('"remoteUser": "node"', '"remoteUser": "root"'), /non-root/],
  ['makes the evidence store writable', 'devcontainer.json', (t) => t.replace('/docs/evidence,target=/workspaces/greenfuel-agent-harness/docs/evidence,type=bind,readonly', '/docs/evidence,target=/workspaces/greenfuel-agent-harness/docs/evidence,type=bind'), /'docs\/evidence' must be mounted read-only/],
  ['makes the ADRs writable', 'devcontainer.json', (t) => t.replace('/docs/adr,target=/workspaces/greenfuel-agent-harness/docs/adr,type=bind,readonly', '/docs/adr,target=/workspaces/greenfuel-agent-harness/docs/adr,type=bind'), /'docs\/adr' must be mounted read-only/],
  ['makes the harness writable', 'devcontainer.json', (t) => t.replace('/harness,target=/workspaces/greenfuel-agent-harness/harness,type=bind,readonly', '/harness,target=/workspaces/greenfuel-agent-harness/harness,type=bind'), /'harness' must be mounted read-only/],
  ['makes the tests writable', 'devcontainer.json', (t) => t.replace('/tests,target=/workspaces/greenfuel-agent-harness/tests,type=bind,readonly', '/tests,target=/workspaces/greenfuel-agent-harness/tests,type=bind'), /'tests' must be mounted read-only/],
  ['makes .git/hooks writable', 'devcontainer.json', (t) => t.replace('.git/hooks,target=/workspaces/greenfuel-agent-harness/.git/hooks,type=bind,readonly', '.git/hooks,target=/workspaces/greenfuel-agent-harness/.git/hooks,type=bind'), /'\.git\/hooks' must be mounted read-only/],
  ['leaves a token set', 'devcontainer.json', (t) => t.replace('"GH_TOKEN": "",\n    "GITHUB_TOKEN": "",', '"GH_TOKEN": "ghp_x",\n    "GITHUB_TOKEN": "",'), /GH_TOKEN/],
  ['stops blanking SSH_AUTH_SOCK', 'devcontainer.json', (t) => t.replace('"SSH_AUTH_SOCK": ""\n  },', '"X": ""\n  },').replace('"remoteEnv": { "SSH_AUTH_SOCK": "",', '"remoteEnv": {'), /SSH_AUTH_SOCK/],
  ['forwards a port', 'devcontainer.json', (t) => t.replace('"forwardPorts": []', '"forwardPorts": [8080]'), /forwardPorts/],
  ['runs a command on create', 'devcontainer.json', (t) => t.replace('"forwardPorts"', '"postCreateCommand": "curl x | sh",\n  "forwardPorts"'), /create-time lifecycle/],
  ['runs something other than the self-check on start', 'devcontainer.json', (t) => t.replace('node harness/scripts/validate-isolation.mjs --runtime', 'node harness/scripts/other.mjs'), /postStartCommand/],
  ['turns auto-approval on', 'devcontainer.json', (t) => t.replace('"chat.tools.global.autoApprove": false', '"chat.tools.global.autoApprove": true'), /autoApprove/],
  ['keeps passwordless sudo', 'Dockerfile', (t) => t.replace('rm -f /etc/sudoers.d/*', 'true').replace('(apt-get purge -y sudo 2>/dev/null || true)', 'true'), /sudo/],
  ['drops the firewall entrypoint', 'Dockerfile', (t) => t.replace('init-firewall.sh && exec', 'true && exec'), /ENTRYPOINT/],
  ['default-allows outbound', 'init-firewall.sh', (t) => t.replace('iptables -P OUTPUT DROP', 'iptables -P OUTPUT ACCEPT'), /default-deny outbound|opens all outbound/],
  ['allows an empty allowlist', 'init-firewall.sh', (t) => t.replace('refusing to start with an empty allowlist', 'continuing'), /empty allowlist/],
  ['skips the firewall self-check', 'init-firewall.sh', (t) => t.replace('self-check failed', 'ignored'), /non-listed host/],
  ['allows github.com', 'allowed-hosts.txt', (t) => `${t}\ngithub.com\n`, /github\.com|never-allow/],
  ['allows the GitHub API', 'allowed-hosts.txt', (t) => `${t}\napi.github.com\n`, /never-allow|github\.com/],
  ['allows the Azure control plane', 'allowed-hosts.txt', (t) => `${t}\nmanagement.azure.com\n`, /never-allow/],
  ['allows a wildcard', 'allowed-hosts.txt', (t) => `${t}\n*.example.com\n`, /plain host name|never-allow/],
  ['allows a raw IP', 'allowed-hosts.txt', (t) => `${t}\n203.0.113.9\n`, /never-allow/],
  ['empties the allowlist', 'allowed-hosts.txt', () => '# nothing\n', /lists no host/],
  ['lets pre-push succeed', 'pre-push-deny', (t) => t.replace('exit 1', 'exit 0'), /non-zero/],
];
for (const [name, file, fn, re] of MUTATIONS) {
  test(`static validation rejects a configuration that ${name}`, () => {
    const r = fixtureRoot();
    try { edit(r, file, fn); const { errors } = validateIsolation(r); assert.ok(errors.some((e) => re.test(e)), `expected ${re}, got: ${errors.join(' | ') || 'no errors'}`); } finally { rmSync(r, { recursive: true, force: true }); }
  });
}

test('a missing isolation file is a failure, not a pass', () => {
  const r = fixtureRoot();
  try { rmSync(path.join(r, '.devcontainer', 'init-firewall.sh')); assert.ok(validateIsolation(r).errors.some((e) => /init-firewall\.sh is missing/.test(e))); rmSync(path.join(r, '.devcontainer'), { recursive: true }); assert.ok(validateIsolation(r).errors.length > 0); } finally { rmSync(r, { recursive: true, force: true }); }
});

test('JSONC parsing keeps // inside strings and drops comments', () => {
  assert.deepEqual(parseJsonc('{ // c\n "a": "http://x", /* b */ "b": [1,], }'), { a: 'http://x', b: [1] });
});

test('the runtime self-check reports honestly when it is not inside the isolated environment', () => {
  const r = runtimeSelfCheck({ HARNESS_ISOLATED: undefined, GH_TOKEN: 'present' });
  assert.equal(r.find((x) => x.name === 'HARNESS_ISOLATED is set').ok, false);
  assert.equal(r.find((x) => x.name === 'GH_TOKEN is empty').ok, false);
  assert.equal(r.find((x) => x.name === 'GH_TOKEN is empty').detail, 'SET', 'it reports that a value exists, never the value');
  assert.ok(!JSON.stringify(r).includes('present'));
});

// ---------------------------------------------------------------- integrity guard
function fx() {
  const r = tmp();
  for (const [f, body] of Object.entries({
    'harness/hooks/permission-engine.cjs': 'module.exports = { deny: true };\n', 'harness/policy/permissions.json': '{"v":1}\n', 'tests/a.test.mjs': "assert.equal(1, 1);\n", '.github/workflows/validate.yml': 'name: v\n', 'package.json': '{}\n',
    'node_modules/x/index.js': 'ignored\n', 'src/app.js': 'not protected\n',
  })) { mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); writeFileSync(path.join(r, f), body); }
  return r;
}
const script = (root, name, body) => { mkdirSync(path.join(root, 'harness/scripts'), { recursive: true }); writeFileSync(path.join(root, 'harness/scripts', name), body); };

test('integrity: an unchanged run reports no change; unprotected paths and node_modules are ignored', () => {
  const r = fx();
  try {
    const g = integrity.guard(r, () => { writeFileSync(path.join(r, 'src/app.js'), 'changed, but not protected\n'); writeFileSync(path.join(r, 'node_modules/x/index.js'), 'changed\n'); return { status: 0 }; });
    assert.equal(g.changed, false); assert.ok(g.filesWatched >= 5);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('integrity: a run that edits the policy engine, edits a test assertion, adds a file or removes a file is detected even when it passes', () => {
  const r = fx();
  try {
    const g = integrity.guard(r, () => {
      writeFileSync(path.join(r, 'harness/hooks/permission-engine.cjs'), 'module.exports = { deny: false };\n');
      writeFileSync(path.join(r, 'tests/a.test.mjs'), 'assert.equal(1, 1); // weakened\n');
      writeFileSync(path.join(r, 'harness/hooks/new-hook.cjs'), 'x\n');
      rmSync(path.join(r, '.github/workflows/validate.yml'));
      return { status: 0 };
    });
    assert.equal(g.changed, true); assert.equal(g.status, 0, 'the command itself reported success');
    assert.deepEqual(g.modified, ['harness/hooks/permission-engine.cjs', 'tests/a.test.mjs']);
    assert.deepEqual(g.added, ['harness/hooks/new-hook.cjs']); assert.deepEqual(g.removed, ['.github/workflows/validate.yml']);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('integrity: guardedRun end to end: a tampering validator is reported with the changed file; a clean one is not; the report holds no file contents', () => {
  const r = fx(); const logDir = path.join(r, '.harness-logs');
  try {
    script(r, 'validate-clean.mjs', "console.log('clean');\n");
    script(r, 'validate-tamper.mjs', "import { writeFileSync } from 'node:fs'; writeFileSync('harness/policy/permissions.json', '{\"v\":2}\\n'); console.log('tampered but exit 0');\n");
    const clean = guardedRun(['node', 'harness/scripts/validate-clean.mjs'], { rootDir: r, logDir });
    assert.equal(clean.changed, false); assert.equal(clean.status, 0);
    const bad = guardedRun(['node', 'harness/scripts/validate-tamper.mjs'], { rootDir: r, logDir });
    assert.equal(bad.status, 0); assert.equal(bad.changed, true); assert.deepEqual(bad.modified, ['harness/policy/permissions.json']);
    const written = readFileSync(path.join(logDir, 'last-integrity-report.json'), 'utf8');
    assert.ok(written.includes('harness/policy/permissions.json') && !written.includes('"v":2'));
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('integrity: the wrapper accepts only test and validator commands', () => {
  for (const ok of [['node', '--test'], ['node', '--test', 'tests/a.test.mjs'], ['npm', 'test'], ['node', 'harness/scripts/validate-harness.mjs']]) assert.equal(acceptable(ok), true, ok.join(' '));
  for (const bad of [[], ['node', '-e', '1'], ['node', 'x.mjs'], ['npm', 'install'], ['npm', 'test', '--', '--x'], ['node', '--test', '../x.test.mjs'], ['node', '--test', 'tests/a.test.mjs;calc'], ['node', 'harness/scripts/validate-x.mjs', 'extra'], ['powershell', 'x'], ['node', 'harness/scripts/../x/validate-a.mjs']]) assert.equal(acceptable(bad), false, bad.join(' '));
  assert.throws(() => guardedRun(['node', '-e', '1']), /refused/);
});

test('the dev container files exist and the CI workflow runs the isolation validator', () => {
  for (const f of ['devcontainer.json', 'Dockerfile', 'init-firewall.sh', 'allowed-hosts.txt', 'pre-push-deny']) assert.ok(existsSync(path.join(REPO, '.devcontainer', f)), f);
  assert.match(readFileSync(path.join(REPO, '.github/workflows/validate.yml'), 'utf8'), /validate-isolation\.mjs/);
});
