// Plain-text and Markdown renderings of a readiness result: the build-readiness report, the dependency matrix and the baseline's
// architecture summary. Deterministic: the same input gives the same bytes, so a baseline's artifacts can be hashed and re-made.
import type { Readiness, AreaReadiness } from './readiness.ts';
import type { ReadinessInput } from './readiness.ts';
import type { BaselineManifest } from './manifest.ts';

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function hintFor(code: string): string {
  const h: Record<string, string> = {
    'phase-0': 'A human raises the phase with signed architecture and deployment approvals (harness/scripts/approval.mjs). This capability does not do that.',
    'phase-unsigned': 'Add the missing signed phase approval; text in command-policy.json is not enough.',
    'no-approver': 'Enroll an architecture-class approver (docs/security/APPROVER-ENROLLMENT.md).',
    'no-branch-protection': 'Turn on branch protection or a ruleset on main with the validate check and the architecture gate required (TODO T14).',
    rejected: 'Rework the design that depends on it, then take the decision again. A rejection is never resolved by itself.',
    deferred: 'Decide it, or change the policy so that nothing requires it (a reviewed policy change).',
    pending: 'Decide it in the Studio review workflow, or by an ADR with a signed approval.',
    missing: 'The id is named by the policy but is not in the register: fix the policy or add the decision.',
    review: 'Approve the design review through its gate, with a signed architecture approval.',
    baseline: 'Generate a baseline when the architecture is ready, then have a human authorize it with a signed approval.',
    'baseline-uncontrolled-change': 'The approved architecture changed without an authorized reopening. Revert it, or have a human authorize a reopening and then re-baseline.',
    'baseline-reopened': 'Finish the reopened decisions, generate a new baseline version and have a human authorize it.',
  };
  return h[code] ?? '';
}

export function renderReport(r: Readiness): string {
  const out: string[] = [];
  out.push('# Build-readiness report', '');
  out.push(`Generated from commit \`${r.commit}\`. Policy \`${r.policyHash.slice(0, 12)}\`. ${r.signatures === 'verified' ? 'Review-record signatures were checked.' : '**Review-record signatures were not checked** (the signing key is not available here); the hash chain and enrollment were.'}`, '');
  out.push('Derived file: regenerate with `node apps/architecture-studio/scripts/baseline.ts report --write`. It states what is true at that commit and authorizes nothing.', '');
  if (r.policyProblems.length) out.push('**The baseline policy is invalid, so nothing can be authorized:**', '', ...r.policyProblems.map((p) => `- ${p}`), '');
  const g = r.global;
  out.push(`Register: ${g.decisions} decisions, ${g.approved} approved, ${g.pending} not yet decided, ${g.rejected} rejected, ${g.deferred} deferred, ${g.superseded} superseded. Requirements: ${g.requirements} (${g.mustRequirements} Must).`, '');
  out.push('| Area | Stage | Ready | Blockers |', '|---|---|---|---|');
  for (const a of r.areas) out.push(`| ${a.id} | ${a.stage} | ${a.ready ? 'yes' : '**no**'} | ${a.blockers.length} |`);
  out.push('');
  for (const a of r.areas) {
    out.push(`## ${a.title} (\`${a.id}\`)`, '', `Stage: ${a.stageTitle}. Paths: ${a.paths.map((p) => `\`${p}\``).join(', ')}.`, '');
    out.push('| Measure | Count | Blocks this area | Members |', '|---|---|---|---|');
    for (const m of a.metrics) out.push(`| ${cell(m.label)} | ${m.count} | ${m.blocks ? (m.count ? '**yes**' : 'would') : 'no'} | ${cell(short(m.members.join(', ') || '-', 120))} |`);
    out.push('');
    if (a.blockers.length) {
      out.push('**Why this area is blocked**', '');
      a.blockers.forEach((b, i) => out.push(`${i + 1}. ${b.text}${hintFor(b.code) ? ` *To unblock:* ${hintFor(b.code)}` : ''}`));
      out.push('');
    } else out.push('Nothing blocks this area at this commit. A baseline must still be generated and authorized by a human.', '');
    if (a.deferredNonBlocking.length) out.push(`Deferred decisions that nothing in this area needs (non-blocking): ${a.deferredNonBlocking.map((d) => d.id).join(', ')}.`, '');
  }
  return `${out.join('\n')}\n`;
}

export function renderMatrix(r: Readiness, i: ReadinessInput): string {
  const out: string[] = ['# Dependency matrix', '', `Commit \`${r.commit}\`. Derived; authorizes nothing.`, ''];
  const gates = new Map<string, { title: string; source: string }>();
  for (const a of r.areas) for (const g of a.gates) gates.set(g.id, { title: g.title, source: g.source });
  out.push('## Areas and the gates they need', '', `| Gate | ${r.areas.map((a) => a.id).join(' | ')} |`, `|---|${r.areas.map(() => '---').join('|')}|`);
  for (const [id] of gates) out.push(`| ${id} | ${r.areas.map((a) => { const g = a.gates.find((x) => x.id === id); return g ? (g.satisfied ? 'met' : '**UNMET**') : '-'; }).join(' | ')} |`);
  out.push('', '`-` means the area does not need that gate at its stage.', '');
  out.push('## Gates and the decisions behind them', '', '| Gate | Needs | Status |', '|---|---|---|');
  const seen = new Set<string>();
  for (const a of r.areas) for (const g of a.gates) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    const rows = [...g.decisions, ...g.designReviews];
    if (!rows.length) out.push(`| ${g.id} | harness check | ${g.satisfied ? 'met' : 'UNMET'} |`);
    for (const id of g.decisions) { const d = a.requiredDecisions.find((x) => x.id === id); out.push(`| ${g.id} | ${id} | ${d ? d.status : 'not in the register'}${d?.approved ? ' (approved)' : ''} |`); }
    for (const id of g.designReviews) out.push(`| ${g.id} | ${id} (design review) | ${a.requiredReviews.find((x) => x.id === id)?.satisfied ? 'approved' : 'not approved'} |`);
  }
  out.push('');
  const requires = i.edges.filter((e) => e.type === 'requires');
  for (const a of r.areas) {
    out.push(`## Required decisions: ${a.id}`, '', '| Decision | Status | Approved | Required by | Domain | Requires |', '|---|---|---|---|---|---|');
    for (const d of a.requiredDecisions) out.push(`| ${d.id} | ${d.status} | ${d.approved ? 'yes' : 'no'} | ${cell(d.requiredBy.join('; '))} | ${d.domain} | ${requires.filter((e) => e.from === d.id).map((e) => e.to).join(', ') || '-'} |`);
    if (!a.requiredDecisions.length) out.push('| (none) | | | | | |');
    out.push('');
    if (a.requiredReviews.length) out.push(`Design reviews required: ${a.requiredReviews.map((x) => `${x.id} (${x.satisfied ? 'approved' : 'not approved'})`).join(', ')}.`, '');
    if (a.closureItems.length) out.push(`Other work reached by requires links: ${a.closureItems.join(', ')}.`, '');
  }
  return `${out.join('\n')}\n`;
}

export function renderSummary(m: BaselineManifest): string {
  const out: string[] = [`# Architecture summary: baseline ${m.id} v${m.version}`, ''];
  out.push(`Scope: ${m.scope.areas.map((a) => `${a.id} (stage ${a.stage})`).join(', ')}. Source commit \`${m.source.commit}\`.`, '');
  out.push('This summary is assembled from recorded decisions, option names and statuses. It adds no analysis and no model-written text. It is not an approval: a baseline is authorized only by a signed approval of its manifest.', '');
  out.push('## What is decided', '');
  out.push('| Decision | Title | Approved option | Basis |', '|---|---|---|---|');
  for (const d of m.requiredDecisions) {
    const o = d.approvedOption;
    out.push(`| ${d.id} | ${cell(short(d.title, 80))} | ${o ? `${o.key}: ${cell(o.name)}${o.recommended ? '' : ' (not the recommended option)'}` : 'not recorded'} | ${cell(d.basis)} |`);
  }
  out.push('', '## What a human must read before authorizing', '');
  if (!m.caveats.length) out.push('No caveats recorded.');
  for (const c of m.caveats) out.push(`- ${c.decision}: ${c.text}`);
  out.push('', '## Deferred decisions that do not block this baseline', '');
  if (!m.deferredNonBlocking.length) out.push('None.');
  for (const d of m.deferredNonBlocking) out.push(`- ${d.id}: ${cell(d.title)}${d.milestone ? ` (needed by ${d.milestone})` : ''}`);
  out.push('', '## Gates satisfied', '');
  for (const g of m.gates) out.push(`- ${g.id}: ${g.title}`);
  out.push('', '## Measures at generation', '');
  for (const x of m.metrics) out.push(`- ${x.area}, ${x.label}: ${x.count}`);
  return `${out.join('\n')}\n`;
}

export function areaLine(a: AreaReadiness): string {
  return `${a.id}: ${a.ready ? 'ready' : `blocked (${a.blockers.length})`}`;
}
