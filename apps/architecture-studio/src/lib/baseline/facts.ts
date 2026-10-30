// What the harness says at a ref: the phase, the approver registry, and which signed approvals are real. The approval rules live in
// harness/approvals/approval-gates.cjs and are used as they are, never re-implemented, so a baseline can never accept an approval that
// the harness itself would refuse. That code reads files from a folder, so the files the rules need are copied out of git at the ref
// into a temporary folder first. The code that runs comes from `codeRoot` (in CI, the trusted base checkout); the data comes from the ref.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { GitRepositoryAdapter } from '../repo/git.ts';

export interface ApprovalInfo {
  approval: string;
  file: string;
  signers: string[];
  issuedAt: string;
}

export interface HarnessFacts {
  phase: number;
  /** Phase 0 needs no approval. Above 0 it needs a valid signed phase approval of the architecture and deployment classes. */
  phaseApproved: boolean;
  architectureKeys: number;
  deploymentKeys: number;
  /** Valid decision approvals by "type:id", for example "adr:0016", "review:RV-0003", "phase:phase-1", "baseline:BL-0001". */
  valid: Record<string, ApprovalInfo[]>;
  invalid: { file: string; reason: string }[];
  /** ADR numbers accepted before signed approvals existed. A fixed list in the harness. */
  grandfathered: string[];
  problems: string[];
}

interface GatesModule {
  validApprovals(root: string): { valid: Map<string, ApprovalInfo[]>; invalid: { file: string; reason: string }[]; trusted: { classes?: string[] }[] };
  GRANDFATHERED_ADRS: Set<string>;
  gateProblems(root: string): { errors: string[]; warnings: string[]; stats: Record<string, unknown> };
}

const NEEDED_PREFIXES = ['docs/approvals/', 'docs/adr/', 'docs/architecture/reviews/', 'docs/baselines/'];
const NEEDED_FILES = ['harness/policy/approvers.json', 'harness/policy/command-policy.json'];

/** Copy the files the approval rules read from git at the ref into a throw-away folder. */
export function materialize(adapter: GitRepositoryAdapter): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-facts-'));
  const paths = [...NEEDED_FILES.filter((p) => adapter.has(p)), ...NEEDED_PREFIXES.flatMap((p) => adapter.list(p))];
  adapter.preload(paths);
  const root = path.resolve(dir);
  for (const p of paths) {
    const text = adapter.read(p);
    if (text === undefined) continue;
    // A name in a git tree is not trusted: on Windows a backslash or a drive prefix would otherwise let a crafted entry leave this folder.
    if (/[\\:]|(^|\/)\.\.(\/|$)/.test(p)) continue;
    const out = path.resolve(root, p);
    if (!out.startsWith(root + path.sep)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
  }
  return dir;
}

interface RegistryModule {
  canonical(v: unknown): string;
  sha256(s: string): string;
}

/** The harness's own canonical JSON and hash, so a manifest is hashed exactly the way the approval rules hash it. */
export function loadRegistry(codeRoot: string): RegistryModule {
  const req = createRequire(path.join(codeRoot, 'package.json'));
  return req(path.join(codeRoot, 'harness', 'approvals', 'registry.cjs')) as RegistryModule;
}

export function loadGates(codeRoot: string): GatesModule {
  const req = createRequire(path.join(codeRoot, 'package.json'));
  return req(path.join(codeRoot, 'harness', 'approvals', 'approval-gates.cjs')) as GatesModule;
}

export function harnessFacts(adapter: GitRepositoryAdapter, codeRoot: string): HarnessFacts {
  const gates = loadGates(codeRoot);
  const dir = materialize(adapter);
  try {
    const problems: string[] = [];
    let phase = 0;
    try {
      phase = (JSON.parse(adapter.read('harness/policy/command-policy.json') ?? '{}') as { phase?: number }).phase ?? 0;
    } catch {
      problems.push('harness/policy/command-policy.json is unreadable, so the phase is treated as not raised.');
    }
    const v = gates.validApprovals(dir);
    const valid: Record<string, ApprovalInfo[]> = {};
    for (const [k, list] of v.valid) valid[k] = list;
    return {
      phase,
      phaseApproved: phase === 0 ? false : Number.isInteger(phase) && phase > 0 && !!valid[`phase:phase-${phase}`],
      architectureKeys: v.trusted.filter((k) => k.classes?.includes('architecture')).length,
      deploymentKeys: v.trusted.filter((k) => k.classes?.includes('deployment')).length,
      valid,
      invalid: v.invalid,
      grandfathered: [...gates.GRANDFATHERED_ADRS],
      problems,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
