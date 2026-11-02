import { STATUSES, type NormalizedDecision, type ValidationIssue } from './schema.ts';

// Schema validation for normalized records. It checks structure and the engine's own honesty rules; it cannot
// check that the content is true, only that every populated field has a source and every empty field is declared.

const HEX = /^[0-9a-f]+$/;

export const populated: Record<string, (r: NormalizedDecision) => boolean> = {
  description: (r) => !!r.description,
  businessJustification: (r) => !!r.businessJustification,
  category: (r) => !!r.category,
  natures: (r) => r.natures.length > 0,
  priority: (r) => !!r.priority,
  recommendedOption: (r) => !!r.recommendedOption,
  options: (r) => r.options.length > 0,
  'implications.cost': (r) => !!r.implications.cost,
  'implications.security': (r) => !!r.implications.security,
  'implications.reliability': (r) => !!r.implications.reliability,
  'implications.dataSovereignty': (r) => !!r.implications.dataSovereignty,
  'implications.operational': (r) => !!r.implications.operational,
  requiredApproverRole: (r) => !!r.requiredApproverRole,
  decisionOwner: (r) => !!r.decisionOwner,
  decisionDate: (r) => !!r.decisionDate,
  approvalHistory: (r) => r.approvalHistory.length > 0,
  evidence: (r) => r.evidence.length > 0,
  rubric: (r) => r.rubric.length > 0,
};

/** Fields that must carry a source when populated. */
const NEEDS_SOURCE = ['description', 'businessJustification', 'category', 'natures', 'priority', 'recommendedOption', 'options', 'implications.cost', 'implications.security', 'implications.reliability', 'implications.dataSovereignty', 'implications.operational', 'requiredApproverRole', 'decisionOwner', 'decisionDate'];

export function validateRecord(r: NormalizedDecision): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const bad = (field: string, message: string) => out.push({ id: r.id || '(no id)', field, message });
  if (!/^(ADR-\d{4}|D-\d{3})$/.test(r.id)) bad('id', 'must look like ADR-0001 or D-001');
  if (!r.title?.trim()) bad('title', 'is empty');
  if (!(STATUSES as readonly string[]).includes(r.status)) bad('status', `"${r.status}" is not one of the seven statuses`);
  if (typeof r.statusRaw !== 'string') bad('statusRaw', 'must preserve the source status text');
  if (!r.statusRule) bad('statusRule', 'must state the rule that produced the status');
  if (!r.source?.path || !(r.source.line >= 1)) bad('source', 'needs a file path and a line of 1 or more');
  if (!HEX.test(r.source?.commit ?? '') || (r.source?.commit ?? '').length !== 40) bad('source.commit', 'must be a 40-character commit SHA');
  if (!HEX.test(r.source?.blob ?? '') || (r.source?.blob ?? '').length < 40) bad('source.blob', 'must be a git object id');
  if (!HEX.test(r.contentHash) || r.contentHash.length !== 64) bad('contentHash', 'must be a SHA-256');

  const keys = r.options.map((o) => o.key);
  if (new Set(keys).size !== keys.length) bad('options', 'option keys must be unique');
  const recs = r.options.filter((o) => o.recommended);
  if (recs.length > 1 && !r.flags.some((f) => f.code === 'multiple-recommended')) bad('options', 'more than one option is marked recommended without a flag');
  if (r.recommendedOption && !r.options.some((o) => o.key === r.recommendedOption!.key)) bad('recommendedOption', 'is not one of the options');
  for (const o of r.options) for (const c of [...o.pros, ...o.cons, ...o.conditional, ...o.unknown]) {
    if (c.basis !== 'recorded' || !c.src?.path || !(c.src.line >= 1)) bad(`options.${o.key}`, 'every pro, con, condition and unknown must be recorded text with a source');
  }

  if (r.status === 'Approved' && r.approvalHistory.length === 0) bad('status', 'Approved without any approval event in the history');
  if (r.approvalBasis === 'signed' && !r.approvalHistory.some((e) => e.signed)) bad('approvalBasis', 'says signed but no signed approval event exists');
  if (r.status !== 'Approved' && r.approvalBasis !== 'none') bad('approvalBasis', 'an approval basis is set on a decision that is not Approved');

  for (const [name, isPopulated] of Object.entries(populated)) {
    const listed = r.missing.includes(name);
    if (isPopulated(r) && listed) bad(name, 'is populated but listed as missing');
    if (!isPopulated(r) && !listed) bad(name, 'is empty but not listed as missing');
  }
  for (const f of NEEDS_SOURCE) if (populated[f]!(r) && !r.fieldSources[f]) bad(f, 'is populated without a recorded source');
  for (const [f, s] of Object.entries(r.fieldSources)) if (!s.path || !(s.line >= 1) || !s.rule) bad(`fieldSources.${f}`, 'needs a path, a line and a rule');
  return out;
}

export function validateAll(records: NormalizedDecision[]): { checked: number; valid: number; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const bad = new Set<string>();
  for (const r of records) {
    const i = validateRecord(r);
    if (i.length) bad.add(r.id);
    issues.push(...i);
  }
  const ids = records.map((r) => r.id);
  for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) {
    issues.push({ id, field: 'id', message: 'appears more than once' });
    bad.add(id);
  }
  return { checked: records.length, valid: records.length - bad.size, issues };
}
