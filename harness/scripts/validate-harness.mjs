#!/usr/bin/env node
// Structural and policy validation for this repository. Zero dependencies.
// Usage: node harness/scripts/validate-harness.mjs [--root <dir>] [--json]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContext, contextStats } from './validate-context.mjs';
import { validateArchitecture } from './validate-architecture.mjs';
import { validateAgents } from './validate-agents.mjs';
import { validateTools } from './validate-tools.mjs';
import { validatePermissions } from './validate-permissions.mjs';
import { validateOrchestration } from './validate-orchestration.mjs';
import { validateMemory } from './validate-memory.mjs';
import { validateLoop } from './validate-loop.mjs';
import { validateEvaluation } from './validate-evaluation.mjs';
import { validateAzure } from './validate-azure.mjs';

export const PILLARS = [
  'Context & Instructions',
  'Tools & Azure Integration',
  'Orchestration & Role Separation',
  'Guardrails & Human Approval',
  'Memory & Resumability',
  'Verification & Evidence',
];
const REQUIRED = [
  'README.md', 'AGENTS.md', 'PROBLEMSTATEMENT.md', 'package.json', 'harness/policy/command-policy.json',
  'docs/harness/REFERENCE-ASSESSMENT.md', 'docs/harness/HARNESS-ARCHITECTURE.md', 'docs/harness/CAPABILITY-MATRIX.md',
  'docs/harness/IMPLEMENTATION-ROADMAP.md', 'docs/harness/OPEN-QUESTIONS.md', 'docs/state/STATE.md', 'docs/state/TODO.md',
  ...['BUSINESS-CASE', 'REQUIREMENTS', 'NON-FUNCTIONAL-REQUIREMENTS', 'DATA-CLASSIFICATION', 'SOVEREIGNTY-MATRIX', 'AGENT-AUTONOMY-MATRIX',
    'CERTIFICATION-SCHEMES', 'ASSUMPTIONS', 'REQUIREMENTS-TRACEABILITY', 'DECISION-REGISTER', 'CONTEXT-LOADING-STRATEGY'].map((n) => `docs/context/${n}.md`),
  'docs/context/context-manifest.json',
  ...['GOVERNANCE', 'HARD-CONSTRAINTS', 'REVIEW-PERSPECTIVES', 'REVIEW-CHECKPOINTS', 'DESIGN-REVIEW-GATE', 'DEFENSE-QUESTION-BANK', 'RISK-REGISTER'].map((n) => `docs/architecture/${n}.md`),
  'docs/architecture/templates/DESIGN.template.md', 'docs/architecture/templates/REVIEW-RECORD.template.md', 'docs/architecture/templates/ADR-DESIGN.template.md',
  'docs/agents/AGENT-ROSTER.md', 'harness/policy/agent-policy.json', 'harness/hooks/agent-guard.cjs',
  'harness/tools/tool-registry.json', 'harness/tools/mcp-candidates.json', 'harness/policy/secret-patterns.json', 'harness/hooks/tool-output-guard.cjs',
  'harness/mcp/greenfuel-tools-server.mjs', 'harness/scripts/spec-validators.mjs', '.vscode/mcp.json', '.mcp.json',
  'docs/harness/TOOL-REGISTRY.md', 'docs/harness/MCP-SECURITY.md', 'docs/harness/TOOL-COMPATIBILITY.md', 'docs/specs/README.md',
  'harness/policy/permissions.json', 'harness/policy/approvers.json', 'harness/policy/azure-identities.json', 'harness/policy/github-protection.json',
  'harness/hooks/permission-engine.cjs', 'harness/scripts/approval.mjs', 'harness/scripts/audit-denials.mjs', 'harness/scripts/verify-github-protection.mjs',
  '.github/CODEOWNERS', 'docs/approvals/README.md', 'tests/permission-negative.test.mjs',
  'harness/policy/orchestration-policy.json', 'harness/orchestration/engine.cjs', 'harness/hooks/delegation-guard.cjs', '.github/hooks/orchestration.json', 'harness/scripts/tasks.mjs', 'harness/scripts/validate-orchestration.mjs',
  'docs/orchestration/ORCHESTRATION.md', 'docs/orchestration/TASK-CONTRACT.md', 'docs/orchestration/templates/EXAMPLE-PLAN.json',
  'harness/policy/memory-policy.json', 'harness/memory/store.cjs', 'harness/scripts/memory.mjs', 'harness/scripts/validate-memory.mjs', 'memory/README.md', 'docs/memory/MEMORY-MODEL.md', 'docs/memory/MEMORY-GOVERNANCE.md',
  'harness/policy/loop-policy.json', 'harness/loop/loop.cjs', 'harness/scripts/loop.mjs', 'harness/scripts/validate-loop.mjs', 'docs/loop/LOOP.md', 'docs/loop/LOOP-VALIDATION-REPORT.md',
  'harness/policy/evaluation-policy.json', 'harness/eval/eval.cjs', 'harness/scripts/evaluate.mjs', 'harness/scripts/validate-evaluation.mjs', 'evaluation/catalogue/harness.json', 'evaluation/catalogue/production.json',
  'evaluation/checks/harness.eval.mjs', 'evaluation/checks/production-contract.eval.mjs', 'docs/evaluation/EVALUATION-FRAMEWORK.md', 'docs/evaluation/EVALUATION-REPORT.md',
  'harness/scripts/validate-azure.mjs', 'infra/main.bicep', 'infra/README.md', '.github/workflows/infra-validate.yml', 'docs/azure/data/port-assessments.json', 'docs/azure/data/deployment-gates.json',
  ...['AZURE-REFERENCE-ARCHITECTURE', 'REGIONAL-AVAILABILITY', 'SOVEREIGNTY-DEPLOYMENT-MATRIX', 'DEPLOYMENT-STRATEGY', 'RESOURCE-INVENTORY', 'COST-AND-CAPACITY', 'OPERATIONS-AND-DR', 'AZURE-READINESS-ASSESSMENT'].map((n) => `docs/azure/${n}.md`),
  ...['PERMISSION-MODEL', 'APPROVAL-WORKFLOWS', 'BREAK-GLASS', 'SECRETS-HANDLING', 'ENFORCEMENT-STATUS', 'DENIED-ACTION-AUDIT', 'NEGATIVE-TESTS'].map((n) => `docs/security/${n}.md`),
];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.harness-logs']);
const FALLBACK_SECRET_PATTERNS = ['-----BEGIN [A-Z ]*PRIVATE KEY-----', 'AccountKey=[A-Za-z0-9+/=]{20,}', '\\bghp_[A-Za-z0-9]{30,}', '\\bgithub_pat_[A-Za-z0-9_]{30,}'];

// One list for the repository scan, the MCP configuration check and the output hook: harness/policy/secret-patterns.json.
function secretPatterns(root) {
  const p = path.join(root, 'harness', 'policy', 'secret-patterns.json');
  const list = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).repository : FALLBACK_SECRET_PATTERNS;
  return list.map((s) => new RegExp(s));
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function frontmatter(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

export function validate(root) {
  const errors = [];
  const fail = (check, msg) => errors.push({ check, msg });
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const read = (p) => readFileSync(path.join(root, p), 'utf8');
  const files = walk(root);

  for (const f of REQUIRED) if (!existsSync(path.join(root, f))) fail('required-files', `missing ${f}`);

  const agentsDir = path.join(root, '.github', 'agents');
  for (const f of existsSync(agentsDir) ? readdirSync(agentsDir).filter((n) => n.endsWith('.agent.md')) : []) {
    const fm = frontmatter(read(`.github/agents/${f}`));
    if (!fm) { fail('agents', `${f}: missing frontmatter`); continue; }
    for (const k of ['name', 'description', 'tools']) if (!fm[k]) fail('agents', `${f}: frontmatter '${k}' is required (tools must be explicit, never implicit-all)`);
  }

  const skillsDir = path.join(root, '.github', 'skills');
  for (const d of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    const p = `.github/skills/${d}/SKILL.md`;
    if (!existsSync(path.join(root, p))) { fail('skills', `${d}: missing SKILL.md`); continue; }
    const fm = frontmatter(read(p));
    if (!fm || fm.name !== d || !fm.description) fail('skills', `${p}: frontmatter name must equal folder name and description is required`);
  }

  const instrDir = path.join(root, '.github', 'instructions');
  for (const f of existsSync(instrDir) ? readdirSync(instrDir).filter((n) => n.endsWith('.instructions.md')) : []) {
    const fm = frontmatter(read(`.github/instructions/${f}`));
    if (!fm || !fm.applyTo) fail('instructions', `${f}: applyTo is required`);
  }

  const hooksDir = path.join(root, '.github', 'hooks');
  for (const f of existsSync(hooksDir) ? readdirSync(hooksDir).filter((n) => n.endsWith('.json')) : []) {
    try {
      const cfg = JSON.parse(read(`.github/hooks/${f}`));
      if (cfg.version !== 1 || typeof cfg.hooks !== 'object') fail('hooks', `${f}: expected { version: 1, hooks: {...} }`);
      for (const list of Object.values(cfg.hooks ?? {})) for (const h of list) {
        const script = String(h.command ?? '').split(/\s+/).find((t) => /\.(c|m)?js$/.test(t));
        if (script && !existsSync(path.join(root, script))) fail('hooks', `${f}: script not found: ${script}`);
      }
    } catch (e) { fail('hooks', `${f}: invalid JSON (${e.message})`); }
  }

  if (existsSync(path.join(root, '.vscode', 'settings.json'))) {
    try {
      if (JSON.parse(read('.vscode/settings.json'))['chat.tools.global.autoApprove'] === true) fail('settings', 'chat.tools.global.autoApprove must not be true');
    } catch (e) { fail('settings', `.vscode/settings.json invalid JSON (${e.message})`); }
  }

  for (const f of files.filter((p) => /[\\/]\.github[\\/]workflows[\\/].+\.ya?ml$/.test(p))) {
    const text = readFileSync(f, 'utf8');
    if (!/^permissions:/m.test(text)) fail('workflows', `${rel(f)}: top-level permissions block is required`);
    for (const m of text.matchAll(/uses:\s*([^\s#]+)/g)) if (!m[1].startsWith('./') && !/@[0-9a-f]{40}$/.test(m[1])) fail('workflows', `${rel(f)}: ${m[1]} is not pinned to a commit SHA`);
  }

  // Captured delegate replies are untrusted model output stored by the task engine, not authored documents; their links are not checked.
  for (const f of files.filter((p) => p.endsWith('.md') && !/docs[\\/]state[\\/]runs[\\/][^\\/]+[\\/]results[\\/]/.test(p))) {
    const text = readFileSync(f, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (!existsSync(path.resolve(path.dirname(f), decodeURIComponent(target)))) fail('links', `${rel(f)}: broken link -> ${m[1]}`);
    }
  }

  const self = new Set(['harness/scripts/validate-harness.mjs', 'tests/validate-harness.test.mjs', 'tests/policy-guard.test.mjs']);
  const secretRes = secretPatterns(root);
  for (const f of files) {
    if (self.has(rel(f)) || statSync(f).size > 1_000_000) continue;
    const text = readFileSync(f, 'utf8');
    for (const re of secretRes) if (re.test(text)) fail('secrets', `${rel(f)}: matches secret pattern ${re}`);
  }

  if (existsSync(path.join(root, 'harness/policy/command-policy.json'))) {
    const policy = JSON.parse(read('harness/policy/command-policy.json'));
    if (policy.phase === 0) {
      // ADR 0014: the one exception is the non-deployable infrastructure scaffold under infra/. validate-azure enforces everything about it.
      const scaffold = existsSync(path.join(root, 'infra/main.bicep')) && /SCAFFOLD, NOT DEPLOYABLE/.test(read('infra/main.bicep'));
      for (const p of ['src', 'infra', '.azure', 'azure.yaml', 'Dockerfile']) if (existsSync(path.join(root, p)) && !(p === 'infra' && scaffold)) fail('phase-gate', `phase 0 forbids '${p}'`);
      for (const f of files) if (/\.(bicep|bicepparam|tf|tfvars)$/.test(f) && !(scaffold && /\.bicep$/.test(f) && rel(f).startsWith('infra/'))) fail('phase-gate', `phase 0 forbids ${rel(f)}`);
    }
  }

  if (existsSync(path.join(root, 'package.json'))) {
    const pkg = JSON.parse(read('package.json'));
    for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) if (Object.keys(pkg[k] ?? {}).length) fail('dependencies', `package.json ${k} must be empty (zero-dependency harness)`);
  }

  for (const doc of ['docs/harness/HARNESS-ARCHITECTURE.md', 'docs/harness/CAPABILITY-MATRIX.md']) {
    if (!existsSync(path.join(root, doc))) continue;
    const text = read(doc);
    for (const p of PILLARS) if (!text.includes(p)) fail('pillars', `${doc}: pillar '${p}' not represented`);
  }

  return [...errors, ...validateContext(root), ...validateArchitecture(root), ...validateAgents(root), ...validateTools(root), ...validatePermissions(root), ...validateOrchestration(root), ...validateMemory(root), ...validateLoop(root), ...validateEvaluation(root), ...validateAzure(root)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (process.argv.includes('--stats')) { console.log(JSON.stringify(contextStats(root), null, 2)); process.exit(0); }
  const errors = validate(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ root, ok: !errors.length, errors }, null, 2));
  else if (errors.length) { for (const e of errors) console.error(`FAIL [${e.check}] ${e.msg}`); console.error(`${errors.length} problem(s).`); }
  else console.log('validate-harness: OK');
  process.exit(errors.length ? 1 : 0);
}
