import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(path.join(ROOT, 'harness/policy/agent-policy.json'), 'utf8')).agents;
const doc = readFileSync(path.join(ROOT, 'docs/harness/AGENT-CONNECTIVITY.md'), 'utf8');
const diagram1 = doc.split('```mermaid')[1].split('```')[0];
const ID = { orchestrator: 'ORC', 'principal-architect': 'PA', 'maritime-domain': 'MD', 'azure-platform': 'AZ', 'application-engineer': 'APP', 'ai-engineer': 'AI', 'data-engineer': 'DE', 'security-reviewer': 'SR', 'sre-engineer': 'SRE', 'qa-engineer': 'QA', 'architecture-critic': 'AC', 'design-reviewer': 'DR' };

test('every agent in the policy appears in the diagram and in the roster table, and nothing else does', () => {
  assert.deepEqual(Object.keys(ID).sort(), Object.keys(policy).sort(), 'the test mapping covers exactly the policy roster');
  for (const [name, id] of Object.entries(ID)) {
    assert.match(diagram1, new RegExp(`\\b${id}\\["${name}`), `${name} is a node in diagram 1`);
    assert.ok(doc.includes(`| ${name} | ${policy[name].class} |`), `${name} has a table row with its policy class`);
  }
  const nodes = [...diagram1.matchAll(/^\s+([A-Z]+)\["/gm)].map((m) => m[1]).sort();
  assert.deepEqual(nodes, Object.values(ID).sort(), 'no node without a policy agent');
});

test('every delegation and prerequisite edge in the policy is drawn, and no extra edge is drawn', () => {
  const drawnDeleg = new Set([...diagram1.matchAll(/^\s+([A-Z]+) ==>\|delegates\| ([A-Z]+)$/gm)].map((m) => `${m[1]}>${m[2]}`));
  const drawnPrereq = new Set([...diagram1.matchAll(/^\s+([A-Z]+) -\.-> ([A-Z]+)$/gm)].map((m) => `${m[1]}>${m[2]}`));
  const wantDeleg = new Set(); const wantPrereq = new Set();
  for (const [name, a] of Object.entries(policy)) {
    for (const d of a.delegatesTo) wantDeleg.add(`${ID[name]}>${ID[d]}`);
    for (const d of a.dependsOn) wantPrereq.add(`${ID[d]}>${ID[name]}`);
  }
  assert.deepEqual([...drawnDeleg].sort(), [...wantDeleg].sort());
  assert.deepEqual([...drawnPrereq].sort(), [...wantPrereq].sort());
});

test('the README embeds exactly the same roster diagram', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r/g, '');
  assert.equal(readme.split('```mermaid\n')[1].split('```')[0].trim(), diagram1.replace(/\r/g, '').trim());
});

test('only the orchestrator delegates, and the prerequisite graph has no cycle', () => {
  for (const [name, a] of Object.entries(policy)) if (name !== 'orchestrator') assert.deepEqual(a.delegatesTo, [], `${name} must not delegate`);
  const seen = new Set(); const stack = new Set();
  const visit = (n) => { if (stack.has(n)) assert.fail(`prerequisite cycle through ${n}`); if (seen.has(n)) return; seen.add(n); stack.add(n); for (const d of policy[n].dependsOn) visit(d); stack.delete(n); };
  Object.keys(policy).forEach(visit);
});

test('the table states each agent write scope and none for read-only classes', () => {
  for (const [name, a] of Object.entries(policy)) {
    const row = doc.split('\n').find((l) => l.startsWith(`| ${name} |`));
    assert.ok(row, name);
    if (!a.writes.length && !a.writesPhase1.length) assert.match(row, /\| nothing \| nothing \|/, `${name} is shown as unable to write`);
    else assert.doesNotMatch(row, /\| nothing \| nothing \|/, `${name} is not shown as read-only`);
  }
});
