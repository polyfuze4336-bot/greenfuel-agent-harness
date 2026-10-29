#!/usr/bin/env node
// Validates the approver registry and every approval gate in the repository: signed decision approvals for ADR acceptance, design review approval
// and phase changes. Text saying "Accepted" or "Approved" satisfies nothing without a valid signed approval bound to the exact document.
// Usage: node harness/scripts/validate-approvals.mjs [--root <dir>] [--json]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const gates = require('../approvals/approval-gates.cjs');

export function validateApprovals(root) {
  try { return gates.gateProblems(root).errors.map((msg) => ({ check: 'approvals', msg })); } catch (e) { return [{ check: 'approvals', msg: `the approval gates could not be checked (${e.message})` }]; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const ri = args.indexOf('--root');
  const root = ri >= 0 ? path.resolve(args[ri + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const r = gates.gateProblems(root);
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    for (const e of r.errors) console.error(`FAIL ${e}`);
    for (const w of r.warnings) console.error(`WARN ${w}`);
    const s = r.stats;
    console.log(`validate-approvals: ${r.errors.length ? 'FAILED' : 'OK'}. Registry: ${s.trustedApprovers} trusted approver(s). ADRs accepted: ${s.adrAccepted} (${s.adrGrandfathered} grandfathered, unsigned, accepted by chat instruction before signing existed; ${s.adrSigned} signed). Reviews approved: ${s.reviewApproved}. Phase: ${s.phase}. ${s.trustedApprovers === 0 ? 'No approver is enrolled: no signed approval of any class can exist.' : ''}`);
  }
  process.exit(r.errors.length ? 1 : 0);
}
