// A throw-away world for the review workflow: a working repository, a bare "GitHub" remote, a fake pull-request service
// and test identities. Nothing here touches the real repository or GitHub. Used by the unit checks and the browser tests.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __setAuthForTests } from '../../src/lib/auth/config.ts';
import { trustFrom } from '../../src/lib/auth/signing.ts';
import type { NormalizedDecision } from '../../src/lib/intel/schema.ts';

export const ROLE_ALIASES = {
  'programme-owner': ['programme owner'],
  'quality-manager': ['quality manager'],
  'security-architect': ['security architect'],
  'compliance-counsel': ['compliance counsel'],
  'enterprise-architect': ['enterprise architect'],
  'sovereignty-lead': ['sovereignty lead'],
  'port-operations': ['port operations'],
  'commercial-lead': ['commercial lead'],
  'data-protection-lead': ['data protection lead'],
};

const person = (login: string, id: number, holder: string, roles: string[]) => ({
  subject: `github:${id}`,
  kind: 'human',
  login,
  holder,
  roles,
  enrolledAt: '2026-01-01T00:00:00Z',
  enrollment: { basis: 'bootstrap', requestedBy: null, approvedBy: null, reference: 'test fixture' },
});

/** Two architecture owners (so one can approve what the other proposed), a security reviewer, an administrator and a contributor. */
export const PEOPLE = [
  person('test-owner', 1001, 'Test Owner', ['architecture-owner']),
  person('test-owner2', 1005, 'Test Owner Two', ['architecture-owner']),
  person('test-security', 1002, 'Test Security Reviewer', ['security-reviewer']),
  person('test-admin', 1006, 'Test Administrator', ['administrator']),
  person('test-contrib', 1007, 'Test Contributor', ['contributor']),
];

export const USERS = {
  owner: { login: 'test-owner', id: 1001, name: 'Test Owner', type: 'User' },
  owner2: { login: 'test-owner2', id: 1005, name: 'Test Owner Two', type: 'User' },
  security: { login: 'test-security', id: 1002, name: 'Test Security Reviewer', type: 'User' },
  admin: { login: 'test-admin', id: 1006, name: 'Test Administrator', type: 'User' },
  contrib: { login: 'test-contrib', id: 1007, name: 'Test Contributor', type: 'User' },
  outsider: { login: 'test-outsider', id: 1003, name: 'Test Outsider', type: 'User' },
  bot: { login: 'some-agent[bot]', id: 1004, name: null, type: 'Bot' },
  // Same login as the owner, different GitHub id: a renamed or recycled account must get no roles.
  impostor: { login: 'test-owner', id: 9999, name: 'Not The Owner', type: 'User' },
};

export const subjectOf = (u: { id: number }) => `github:${u.id}`;

/** The classification rules the repository ships, so test policies classify real records the way the real policy does. */
export const DEFAULT_RULES = [
  { domain: 'regulatory', approverTextMatches: ['quality manager', 'compliance counsel'] },
  { domain: 'security', approverTextMatches: ['security architect'] },
  { domain: 'architecture', kinds: ['adr'], approverTextMatches: ['programme owner', 'enterprise architect'] },
];

export interface PolicyOptions {
  people?: unknown[];
  ownership?: unknown[];
  segregation?: Record<string, unknown>;
  session?: Record<string, unknown>;
  classification?: unknown;
  approvalProviders?: string[];
  tenantId?: string | null;
}

export function policyJson(o: PolicyOptions = {}) {
  const people = o.people ?? PEOPLE;
  return `${JSON.stringify(
    {
      version: 2,
      description: 'Test access policy.',
      authentication: { tenantId: o.tenantId ?? null, clientId: null, approvalProviders: o.approvalProviders ?? ['entra'], entraRoleMap: { 'Studio.Architect': 'architect', 'Studio.ArchitectureOwner': 'architecture-owner', 'Studio.Administrator': 'administrator', 'Studio.Viewer': 'viewer', 'Studio.SecurityReviewer': 'security-reviewer', 'Studio.DeploymentApprover': 'deployment-approver', 'Studio.Contributor': 'contributor' }, entraGroupMap: {} },
      session: { idleMinutes: 30, absoluteHours: 8, approvalMaxAuthAgeMinutes: 15, requireMfaForApproval: true, ...o.session },
      roleAliases: ROLE_ALIASES,
      critical: { priorities: ['Must'], includeBlocked: true },
      classification: o.classification ?? { rules: DEFAULT_RULES, overrides: {} },
      ownership: o.ownership ?? [
        { domain: 'architecture', scope: { all: true }, owners: ['github:1001', 'github:1005'] },
        { domain: 'security', scope: { all: true }, owners: ['github:1002'] },
      ],
      segregation: { enforce: true, requireIndependentRecommendation: false, authorBindings: [], ...o.segregation },
      people,
    },
    null,
    2,
  )}\n`;
}

/** The server's signing key for tests, and the auth settings every test world needs. Call once per test file. */
export function installTestAuth(over: { devApprovals?: boolean } = {}) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const trust = trustFrom({ privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-auth-'));
  __setAuthForTests({ config: { mode: 'github-dev', devApprovals: over.devApprovals ?? true, policyPin: null, cacheDir, entra: null, secureCookies: false, problems: [] }, trust });
  return { trust, cacheDir, signer: trust.signer!, setApprovals: (on: boolean) => __setAuthForTests({ config: { mode: 'github-dev', devApprovals: on, policyPin: null, cacheDir, entra: null, secureCookies: false, problems: [] } }) };
}
export function git(cwd: string, ...a: string[]) {
  // A bare repository must be addressed with --git-dir (git may be configured with safe.bareRepository=explicit).
  const bare = cwd.endsWith('.git');
  const r = spawnSync('git', bare ? ['--git-dir', cwd, ...a] : a, { cwd: bare ? path.dirname(cwd) : cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export interface Fixture {
  dir: string;
  work: string;
  remote: string;
  state: string;
  setIdentity(u: (typeof USERS)[keyof typeof USERS] | null): void;
  /** What a person does on GitHub: merge the pull request (fast-forward). Throws if it cannot be a fast-forward. */
  merge(prNumber: number): void;
  /** Another person commits directly to the canonical branch. */
  commitToMain(files: Record<string, string>, message?: string, remove?: string[]): string;
  /** Put a branch on the remote that is not the proposal's. */
  pushBranch(branch: string, files: Record<string, string>): string;
  remoteGitDir: string;
  cleanup(): void;
}

export interface FixtureOptions {
  /** Clone this repository (at its HEAD) as the working copy instead of starting from a tiny one. */
  cloneFrom?: string;
  policy?: string | null;
  dir?: string;
}

export function makeFixture(opts: FixtureOptions = {}): Fixture {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'studio-review-'));
  fs.mkdirSync(dir, { recursive: true });
  const remote = path.join(dir, 'origin.git');
  const work = path.join(dir, 'work');
  const state = path.join(dir, 'state');
  fs.mkdirSync(state, { recursive: true });
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  if (opts.cloneFrom) {
    git(dir, 'clone', '-q', '--local', '--no-hardlinks', opts.cloneFrom, work);
  } else {
    fs.mkdirSync(work);
    git(work, 'init', '-q', '-b', 'main');
  }
  for (const [k, v] of [['user.email', 'fixture@example.invalid'], ['user.name', 'Fixture'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']] as const) git(work, 'config', k, v);
  if (!opts.cloneFrom) fs.writeFileSync(path.join(work, 'README.md'), '# fixture\n');
  if (opts.policy !== null) {
    fs.mkdirSync(path.join(work, 'harness', 'policy'), { recursive: true });
    fs.writeFileSync(path.join(work, 'harness', 'policy', 'access-policy.json'), opts.policy ?? policyJson());
  }
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'fixture base');
  try {
    git(work, 'remote', 'remove', 'origin');
  } catch {
    /* a fresh repository has no origin */
  }
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(work, 'fetch', '-q', 'origin');

  const identityFile = path.join(state, 'identity.json');
  const prsFile = path.join(state, 'prs.json');
  const other = path.join(dir, 'other');
  const ensureOther = () => {
    if (!fs.existsSync(other)) git(dir, 'clone', '-q', remote, other);
    git(other, 'config', 'user.email', 'other@example.invalid');
    git(other, 'config', 'user.name', 'Other');
    git(other, 'config', 'commit.gpgsign', 'false');
  };
  const write = (files: Record<string, string>) => {
    for (const [p, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(other, p)), { recursive: true });
      fs.writeFileSync(path.join(other, p), c);
    }
    git(other, 'add', '-A');
  };

  return {
    dir,
    work,
    remote,
    state,
    remoteGitDir: remote,
    setIdentity(u) {
      if (u === null) fs.rmSync(identityFile, { force: true });
      else fs.writeFileSync(identityFile, JSON.stringify(u));
    },
    merge(n) {
      const prs = JSON.parse(fs.readFileSync(prsFile, 'utf8')) as { prs: { number: number; headSha: string }[] };
      const pr = prs.prs.find((p) => p.number === n);
      if (!pr) throw new Error(`no pull request ${n}`);
      const base = git(remote, 'rev-parse', 'refs/heads/main');
      const ff = spawnSync('git', ['--git-dir', remote, 'merge-base', '--is-ancestor', base, pr.headSha], { windowsHide: true }).status === 0;
      if (!ff) throw new Error('not a fast-forward: the pull request would conflict');
      git(remote, 'update-ref', 'refs/heads/main', pr.headSha);
    },
    commitToMain(files, message = 'competing change', remove = []) {
      ensureOther();
      git(other, 'checkout', '-q', '-B', 'main', 'origin/main');
      git(other, 'pull', '-q', '--ff-only', 'origin', 'main');
      for (const p of remove) fs.rmSync(path.join(other, p), { force: true });
      write(files);
      git(other, 'commit', '-q', '-m', message);
      git(other, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
      return git(other, 'rev-parse', 'HEAD');
    },
    pushBranch(branch, files) {
      ensureOther();
      git(other, 'fetch', '-q', 'origin');
      git(other, 'checkout', '-q', '-B', 'scratch', 'origin/main');
      write(files);
      git(other, 'commit', '-q', '-m', 'unrelated branch');
      git(other, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
      return git(other, 'rev-parse', 'HEAD');
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A decision with every field present, so tests state only what matters to them. */
export function makeDecision(over: Partial<NormalizedDecision> & { id: string }): NormalizedDecision {
  const opt = (key: string, name: string, recommended: boolean) => ({ key, name, summary: null, disposition: null, recommended, tradeoffs: null, pros: [], cons: [], conditional: [], unknown: [], mapping: null, matrixColumn: null, src: { path: 'docs/adr/x.md', line: 1 } });
  const options = [opt('A', 'Do nothing', false), opt('B', 'Build it', true), opt('C', 'Buy it', false)];
  return {
    kind: 'adr',
    title: `Decision ${over.id}`,
    description: 'Something must be decided.',
    businessJustification: 'It matters.',
    category: 'Architecture',
    tags: [],
    milestone: null,
    priority: { value: 'Must', basis: 'REQ-1' },
    status: 'Proposed',
    statusRaw: 'Proposed',
    statusRule: 'ADR status line says Proposed',
    approvalBasis: 'none',
    recommendedOption: options[1]!,
    options,
    comparison: null,
    implications: { cost: null, security: null, reliability: null, dataSovereignty: null, operational: null },
    dependsOn: [],
    dependedOnBy: [],
    supersedes: [],
    supersededBy: [],
    blockingRequirements: [],
    relatedAdrs: [],
    relatedRisks: [],
    relatedTasks: [],
    relatedReviews: [],
    requiredApproverRole: { text: 'Programme owner', basis: 'test' },
    decisionOwner: 'Programme owner',
    decisionDate: null,
    approvalHistory: [],
    source: { path: 'docs/adr/x.md', line: 1, commit: 'c'.repeat(40), blob: 'b'.repeat(40) },
    citedBy: [],
    evidence: [],
    rubric: [],
    flags: [],
    missing: [],
    fieldSources: {},
    contentHash: `hash-${over.id}`,
    ...over,
  } as NormalizedDecision;
}
