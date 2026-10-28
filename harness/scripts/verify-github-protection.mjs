#!/usr/bin/env node
// Compares the GitHub protection specification (harness/policy/github-protection.json) with what GitHub actually enforces.
// Read-only: it makes GET requests through the gh CLI and never changes anything. It prints, but never runs, the commands
// a human would use to apply the specification.
//   node harness/scripts/verify-github-protection.mjs [--print-apply]
// Exit codes: 0 matches, 1 differs, 3 protection is unavailable on this plan or could not be read, 4 usage.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function compare(spec, actual) {
  const want = spec.branches.main;
  const diffs = [];
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  const checks = [
    ['requirePullRequest', get(actual, 'required_pull_request_reviews') !== undefined, want.requirePullRequest],
    ['requiredApprovingReviews', get(actual, 'required_pull_request_reviews.required_approving_review_count') ?? 0, want.requiredApprovingReviews, (a, b) => a >= b],
    ['dismissStaleReviews', Boolean(get(actual, 'required_pull_request_reviews.dismiss_stale_reviews')), want.dismissStaleReviews],
    ['requireCodeOwnerReview', Boolean(get(actual, 'required_pull_request_reviews.require_code_owner_reviews')), want.requireCodeOwnerReview],
    ['requiredStatusChecks', (get(actual, 'required_status_checks.contexts') ?? []).concat((get(actual, 'required_status_checks.checks') ?? []).map((c) => c.context)), want.requiredStatusChecks, (a, b) => b.every((x) => a.includes(x))],
    ['requireBranchesUpToDate', Boolean(get(actual, 'required_status_checks.strict')), want.requireBranchesUpToDate],
    ['enforceAdmins', Boolean(get(actual, 'enforce_admins.enabled')), want.enforceAdmins],
    ['allowForcePushes', Boolean(get(actual, 'allow_force_pushes.enabled')), want.allowForcePushes],
    ['allowDeletions', Boolean(get(actual, 'allow_deletions.enabled')), want.allowDeletions],
    ['requireLinearHistory', Boolean(get(actual, 'required_linear_history.enabled')), want.requireLinearHistory],
    ['requireConversationResolution', Boolean(get(actual, 'required_conversation_resolution.enabled')), want.requireConversationResolution],
  ];
  for (const [name, a, b, eq] of checks) if (!(eq ? eq(a, b) : a === b)) diffs.push(`${name}: expected ${JSON.stringify(b)}, found ${JSON.stringify(a)}`);
  return diffs;
}

// Classifies a failed gh call without trusting its text beyond a status code.
export function classifyFailure(stderr) {
  const s = String(stderr);
  if (/HTTP 403|Upgrade to GitHub Pro|\b403\b/.test(s)) return { status: 'UNAVAILABLE', detail: s.split('\n')[0] };
  if (/HTTP 404|Branch not protected/.test(s)) return { status: 'NOT-PROTECTED', detail: s.split('\n')[0] };
  return { status: 'ERROR', detail: s.split('\n')[0] };
}

export function applyCommands(spec) {
  const w = spec.branches.main;
  const body = {
    required_status_checks: { strict: w.requireBranchesUpToDate, contexts: w.requiredStatusChecks },
    enforce_admins: w.enforceAdmins,
    required_pull_request_reviews: { dismiss_stale_reviews: w.dismissStaleReviews, require_code_owner_reviews: w.requireCodeOwnerReview, required_approving_review_count: w.requiredApprovingReviews },
    restrictions: null, required_linear_history: w.requireLinearHistory, allow_force_pushes: w.allowForcePushes, allow_deletions: w.allowDeletions, required_conversation_resolution: w.requireConversationResolution,
  };
  return [`gh api --method PUT repos/${spec.repository}/branches/main/protection --input - <<'JSON'\n${JSON.stringify(body, null, 2)}\nJSON`, `gh api --method PUT repos/${spec.repository}/vulnerability-alerts`];
}

function main() {
  const spec = JSON.parse(readFileSync(path.join(root, 'harness/policy/github-protection.json'), 'utf8'));
  if (process.argv.includes('--print-apply')) {
    console.log('Commands for a HUMAN to review and run. This script never runs them, and applying them is a remote change that needs the owner:\n');
    for (const c of applyCommands(spec)) console.log(`${c}\n`);
    return;
  }
  let out;
  try {
    out = execFileSync('gh', ['api', `repos/${spec.repository}/branches/main/protection`], { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const f = classifyFailure(`${e.stderr ?? ''}${e.stdout ?? ''}`);
    console.log(`verify-github-protection: ${f.status}. ${f.detail}`);
    process.exit(f.status === 'ERROR' ? 2 : f.status === 'NOT-PROTECTED' ? 1 : 3);
  }
  const diffs = compare(spec, JSON.parse(out));
  if (diffs.length) { console.log('verify-github-protection: DIFFERS'); diffs.forEach((d) => console.log(`  - ${d}`)); process.exit(1); }
  console.log('verify-github-protection: matches the specification');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
