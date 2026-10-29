import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAcceptance, renderCoverage, renderIndex } from '../harness/scripts/acceptance-reports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copy = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gf-acceptance-'));
  for (const f of readdirSync(ROOT)) if (!['.git', 'node_modules', 'out', 'dist'].includes(f)) cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });
  return dir;
};

test('the committed coverage and evidence index are exactly what the generator produces', () => {
  assert.deepEqual(validateAcceptance(ROOT), []);
});

test('the generator is deterministic and the coverage names every requirement of the baseline exactly once', () => {
  const a = renderCoverage(ROOT); assert.equal(a, renderCoverage(ROOT)); assert.equal(renderIndex(ROOT), renderIndex(ROOT));
  const ids = [...readFileSync(path.join(ROOT, 'docs/context/REQUIREMENTS.md'), 'utf8').matchAll(/^\| ([A-Z]{2,4}-\d{3}) \|/gm)].map((m) => m[1]);
  assert.ok(ids.length > 50, 'the baseline was read');
  for (const id of ids) assert.equal(a.split('\n').filter((l) => l.startsWith(`| ${id} |`)).length, 1, `${id} has exactly one row`);
});

test('a hand-edited generated document, a changed evidence record and a missing document are all rejected', () => {
  const dir = copy();
  try {
    assert.deepEqual(validateAcceptance(dir), []);
    const cov = path.join(dir, 'docs/acceptance/REQUIREMENTS-COVERAGE.md');
    writeFileSync(cov, readFileSync(cov, 'utf8').replace('SPECIFIED ONLY', 'TESTED AND PASSING'));
    assert.ok(validateAcceptance(dir).some((e) => /REQUIREMENTS-COVERAGE\.md does not match/.test(e.msg)), 'an edit that promotes a requirement is caught');
    cpSync(path.join(ROOT, 'docs/acceptance/REQUIREMENTS-COVERAGE.md'), cov);
    const rec = path.join(dir, 'docs/evidence/records/EV-0001.json'); const j = JSON.parse(readFileSync(rec, 'utf8')); j.exitCode = 1; writeFileSync(rec, JSON.stringify(j, null, 2));
    assert.ok(validateAcceptance(dir).some((e) => /TEST-EVIDENCE-INDEX\.md does not match/.test(e.msg)), 'a changed evidence record no longer matches the index');
    rmSync(path.join(dir, 'docs/acceptance/TEST-EVIDENCE-INDEX.md'));
    assert.ok(validateAcceptance(dir).some((e) => /missing docs\/acceptance\/TEST-EVIDENCE-INDEX\.md/.test(e.msg)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
