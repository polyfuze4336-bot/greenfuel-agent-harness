// A throw-away world for the review workflow: a working repository, a bare "GitHub" remote, a fake pull-request service
// and test identities. Nothing here touches the real repository or GitHub. Used by the unit checks and the browser tests.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

export const PEOPLE = [
  { githubLogin: 'test-owner', githubId: 1001, holder: 'Test Owner', roles: ['programme-owner'] },
  { githubLogin: 'test-quality', githubId: 1002, holder: 'Test Quality Manager', roles: ['quality-manager'] },
];

export const USERS = {
  owner: { login: 'test-owner', id: 1001, name: 'Test Owner', type: 'User' },
  quality: { login: 'test-quality', id: 1002, name: 'Test Quality Manager', type: 'User' },
  outsider: { login: 'test-outsider', id: 1003, name: 'Test Outsider', type: 'User' },
  bot: { login: 'some-agent[bot]', id: 1004, name: null, type: 'Bot' },
  // Same login as the owner, different GitHub id: a renamed or recycled account must get no roles.
  impostor: { login: 'test-owner', id: 9999, name: 'Not The Owner', type: 'User' },
};

export function policyJson(people: unknown[] = PEOPLE) {
  return `${JSON.stringify({ version: 1, description: 'Test policy.', people, roleAliases: ROLE_ALIASES, critical: { priorities: ['Must'], includeBlocked: true, requiredRoles: ['programme-owner'] }, reopen: { requiredRoles: ['programme-owner'] } }, null, 2)}\n`;
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
    fs.writeFileSync(path.join(work, 'harness', 'policy', 'decision-workflow.json'), opts.policy ?? policyJson());
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
