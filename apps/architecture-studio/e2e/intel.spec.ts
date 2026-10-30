import { expect, test } from '@playwright/test';
import { ready } from './helpers.ts';

interface Rec {
  id: string;
  kind: string;
  status: string;
  statusRaw: string;
  approvalBasis: string;
  recommendedOption: { key: string } | null;
  options: { key: string; pros: unknown[]; cons: unknown[]; conditional: unknown[]; unknown: unknown[] }[];
  implications: Record<string, unknown>;
  missing: string[];
  source: { path: string; line: number; commit: string; blob: string };
  approvalHistory: { type: string; signed: boolean }[];
}

const api = async <T,>(request: import('@playwright/test').APIRequestContext, path: string) => (await (await request.get(path)).json()) as T;

test.describe('the register is populated from repository data', () => {
  test('API: every ADR and register entry is present, valid, and carries its source commit', async ({ request }) => {
    const { items, commit } = await api<{ items: Rec[]; commit: string }>(request, '/api/v1/decisions');
    const reg = await api<{ commit: string; stats: { total: number; byKind: Record<string, number> }; validation: { checked: number; valid: number; issues: unknown[] } }>(request, '/api/v1/register');
    expect(items.length).toBe(reg.stats.total);
    expect(items.filter((r) => r.kind === 'adr').length).toBe(20);
    expect(items.filter((r) => r.kind === 'register-entry').length).toBe(37);
    expect(reg.validation).toMatchObject({ checked: items.length, valid: items.length, issues: [] });
    for (const r of items) {
      expect(r.source.commit).toBe(commit);
      expect(r.source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(r.source.path).toMatch(/^docs\//);
      expect(r.source.line).toBeGreaterThanOrEqual(1);
    }
  });

  test('API: approved stays approved (unsigned), proposed is never approved, nothing is rejected without a source saying so', async ({ request }) => {
    const { items } = await api<{ items: Rec[] }>(request, '/api/v1/decisions');
    const adrs = items.filter((r) => r.kind === 'adr');
    for (const r of adrs.filter((x) => /^Accepted/.test(x.statusRaw))) {
      expect(r.status, r.id).toBe('Approved');
      expect(r.approvalBasis, r.id).not.toBe('signed');
      expect(r.approvalHistory.some((e) => e.signed), r.id).toBe(false);
    }
    for (const r of adrs.filter((x) => /^Proposed/.test(x.statusRaw))) expect(['Proposed', 'Blocked'], r.id).toContain(r.status);
    for (const r of items.filter((x) => x.status === 'Rejected')) expect(r.statusRaw, r.id).toMatch(/^Rejected/);
    for (const r of items.filter((x) => x.kind === 'register-entry')) expect(r.status, r.id).toBe('Pending Review');
    expect(adrs.filter((r) => r.status === 'Approved').length).toBe(13);
  });

  test('API: missing fields are declared, never fabricated', async ({ request }) => {
    const { items } = await api<{ items: Rec[] }>(request, '/api/v1/decisions');
    for (const r of items.filter((x) => x.kind === 'register-entry')) {
      expect(r.recommendedOption, `${r.id} has no chosen option in the register`).toBeNull();
      expect(Object.values(r.implications).every((v) => v === null), r.id).toBe(true);
      for (const o of r.options) expect([o.pros.length, o.cons.length, o.conditional.length, o.unknown.length], `${r.id} ${o.key}`).toEqual([0, 0, 0, 0]);
      for (const f of ['recommendedOption', 'implications.cost', 'implications.security', 'decisionDate', 'approvalHistory']) expect(r.missing, `${r.id} ${f}`).toContain(f);
    }
  });

  test('API: statuses filter, unknown statuses are refused, a record carries alternatives and suggestions separately', async ({ request }) => {
    expect((await api<{ count: number }>(request, '/api/v1/decisions?status=Approved')).count).toBe(13);
    expect((await api<{ count: number }>(request, '/api/v1/decisions?status=Blocked')).count).toBe(6);
    expect((await request.get('/api/v1/decisions?status=Maybe')).status()).toBe(400);
    const d = await api<{ decision: Rec; alternatives: { recommendedKey: string | null; options: { key: string; recorded: { pros: unknown[] }; suggested: { pros: unknown[] } }[] }; suggestions: unknown[] }>(request, '/api/v1/decisions/ADR-0004');
    expect(d.alternatives.recommendedKey).toBe('C');
    expect(d.alternatives.options[0]!.key).toBe('C');
    expect(d.decision.status).toBe('Blocked');
    const d10 = await api<{ alternatives: { options: { recorded: { pros: unknown[]; cons: unknown[] }; suggested: { pros: unknown[] } }[] }; suggestions: { label: string; reviewState: string }[] }>(request, '/api/v1/decisions/D-010');
    expect(d10.alternatives.options.every((o) => o.recorded.pros.length === 0 && o.recorded.cons.length === 0)).toBe(true);
    expect(d10.alternatives.options.some((o) => o.suggested.pros.length > 0)).toBe(true);
    expect(d10.suggestions.every((s) => s.label === 'AI SUGGESTION' && s.reviewState === 'unreviewed')).toBe(true);
  });

  test('UI: the register health strip reports validation, overlaps and suggestions from the API', async ({ page, request }) => {
    const reg = await api<{ duplicates: unknown[]; suggestions: { count: number }; validation: { valid: number; checked: number } }>(request, '/api/v1/register');
    await ready(page, '/decisions');
    const health = page.getByTestId('register-health');
    await expect(health.getByTestId('health-schema')).toHaveText(`${reg.validation.valid} of ${reg.validation.checked} valid`);
    await expect(health.getByTestId('health-overlap')).toHaveText(String(reg.duplicates.length));
    await expect(health.getByTestId('health-ai')).toHaveText(String(reg.suggestions.count));
    await health.getByText('How complete is the register?').click();
    await expect(health.getByTestId('completeness-table').locator('tr')).toHaveCount(17);
    await expect(health.getByTestId('completeness-table')).toContainText('Description');
    await expect(health.getByTestId('completeness-table')).toContainText('of 57');
  });

  test('UI: status chips carry the seven normalized statuses and their counts', async ({ page }) => {
    await ready(page, '/decisions');
    for (const [s, n] of [['Proposed', 1], ['Pending Review', 37], ['Approved', 13], ['Rejected', 0], ['Deferred', 0], ['Superseded', 0], ['Blocked', 6]] as const) {
      const chip = page.getByRole('button', { name: new RegExp(`^${s} ${n}$`) });
      await expect(chip, s).toBeVisible();
    }
  });
});

test.describe('a decision shows every schema field with its source', () => {
  test('ADR-0004: status rule, recommended option, alternatives, implications, evidence, rubric, provenance', async ({ page, request }) => {
    const commit = (await api<{ commit: string }>(request, '/api/v1/register')).commit;
    await ready(page, '/decisions?id=ADR-0004');
    const d = page.getByTestId('decision-detail');
    await expect(d).toContainText('Blocked');
    await expect(d.locator('blockquote')).toHaveText('Proposed');
    await expect(d).toContainText('design review it names is declared Blocked');
    await expect(d.getByRole('heading', { name: 'Recommended option' })).toBeVisible();
    await expect(d).toContainText('Jurisdiction-local authoritative stores');
    await expect(d.getByText(/Alternative options \(5\)/)).toBeVisible();
    for (const label of ['Cost', 'Security', 'Reliability', 'Data sovereignty', 'Operational']) await expect(d.getByText(label, { exact: true }).first()).toBeVisible();
    await expect(d).toContainText('Evidence references');
    await expect(d.getByText('EV-0007').first()).toBeVisible();
    await expect(d.getByText(/Rubric mapping \(\d+\)/)).toBeVisible();
    await expect(d.getByTestId('source-commit')).toHaveText(commit);
    await d.getByText(/Field provenance/).click();
    await expect(d.getByTestId('provenance-table').locator('tbody tr')).not.toHaveCount(0);
    await expect(d.getByTestId('provenance-table')).toContainText('ADR "Date" header');
    await expect(d.getByText('Possible duplicates and overlaps')).toBeVisible();
  });

  test('D-013: nothing is invented, gaps are listed, and AI suggestions are labelled and separate', async ({ page }) => {
    await ready(page, '/decisions?id=D-013');
    const d = page.getByTestId('decision-detail');
    await expect(d.getByText('None. The register records known options and states that none is chosen.')).toBeVisible();
    await d.getByTestId('option-card').first().locator('summary').click();
    await expect(d.getByText('No pros or cons are recorded for this option. The Studio does not invent them.').first()).toBeVisible();
    await expect(d.getByText('Not stated in any source.').first()).toBeVisible();
    await expect(d.getByTestId('missing-fields')).toContainText('Description');
    await expect(d.getByTestId('missing-fields')).toContainText('Cost implications');
    const ai = d.getByTestId('suggestion-list');
    await expect(ai.locator(':scope > li')).toHaveCount(6);
    await expect(ai.getByText('AI suggestion · unreviewed · not evidence').first()).toBeVisible();
    await expect(ai).toContainText('A suggestion, not a fact');
    await expect(d.getByText('Written by an AI to help a person think.')).toBeVisible();
  });

  test('approval history shows the real status-line event and the owner log for an approved ADR', async ({ page }) => {
    await ready(page, '/decisions?id=ADR-0008');
    const h = page.getByTestId('approval-history');
    await expect(h).toContainText('Status line');
    await expect(h).toContainText('2026-10-28');
    await expect(h).not.toContainText('Signed approval record');
  });
});

test.describe('Compare Alternatives', () => {
  test('ADR-0004: the recommended option first, beside the others, from recorded comparison data', async ({ page }) => {
    await ready(page, '/decisions?id=ADR-0004');
    await page.getByRole('link', { name: 'Compare alternatives' }).click();
    await expect(page).toHaveURL(/\/decisions\/ADR-0004\/compare/);
    await expect(page.getByRole('heading', { level: 1, name: 'Compare alternatives' })).toBeVisible();
    const t = page.getByTestId('compare-table');
    await expect(t.locator('thead th')).toHaveCount(6);
    await expect(t.getByTestId('recommended-column')).toHaveCount(1);
    await expect(t.locator('thead th').nth(1)).toContainText('Recommended');
    await expect(t.locator('thead th').nth(1)).toContainText('Jurisdiction-local authoritative stores');
    await expect(t.getByTestId('matrix-row')).toHaveCount(10);
    await expect(t.getByText('Does not meet').first()).toBeVisible();
    await expect(t.getByText('Conditional').first()).toBeVisible();
    await expect(t.getByText('Rejected (hard constraint)', { exact: true })).toBeVisible();
    await expect(page.getByText('Counts of verdicts are deliberately not totalled')).toBeVisible();
  });

  test('narrowing to one alternative keeps the recommended option and changes nothing else', async ({ page }) => {
    await page.goto('/decisions/ADR-0004/compare');
    const t = page.getByTestId('compare-table');
    await page.getByLabel('Compare the recommended option against').selectOption('B');
    await expect(t.locator('thead th')).toHaveCount(3);
    await expect(t.locator('thead th').nth(1)).toContainText('Recommended');
    await expect(t.locator('thead th').nth(2)).toContainText('Single central store');
    await page.getByLabel('Compare the recommended option against').selectOption('');
    await expect(t.locator('thead th')).toHaveCount(6);
  });

  test('AI suggestions sit in their own labelled section and never inside the recorded table', async ({ page }) => {
    await page.goto('/decisions/D-010/compare');
    await expect(page.getByText('No option is recommended in the source.')).toBeVisible();
    const rec = page.getByTestId('compare-table');
    await expect(rec).toContainText('Azure in-country region');
    await expect(rec).not.toContainText('Managed platform services');
    await expect(rec.getByText('None recorded').first()).toBeVisible();
    const ai = page.getByTestId('ai-section');
    await expect(ai.getByText('AI suggestion · unreviewed · not evidence').first()).toBeVisible();
    await expect(ai.getByTestId('suggestion-table')).toContainText('Managed platform services');
    await expect(ai).toContainText('Confidence is not proof');
  });

  test('a decision with no options says so instead of inventing any', async ({ page, request }) => {
    const { items } = await api<{ items: Rec[] }>(request, '/api/v1/decisions');
    const none = items.find((r) => r.options.length === 0);
    test.skip(!none, 'every decision has options at this commit');
    await page.goto(`/decisions/${none!.id}/compare`);
    await expect(page.getByTestId('compare-empty')).toContainText('No options are recorded');
  });

  test('an unknown decision is not found', async ({ page }) => {
    await page.goto('/decisions/ADR-9999/compare');
    await expect(page.getByText('That record is not at this commit')).toBeVisible();
  });
});

test.describe('read-only source preview', () => {
  test('shows the cited line, highlighted, at the commit being read, and cannot edit', async ({ page, request }) => {
    const commit = (await api<{ commit: string }>(request, '/api/v1/register')).commit;
    await ready(page, '/decisions?id=D-003');
    await page.getByRole('button', { name: 'Preview source' }).click();
    const dlg = page.getByTestId('source-preview');
    await expect(dlg).toContainText('Source preview, read-only');
    await expect(dlg).toContainText('docs/context/DECISION-REGISTER.md');
    await expect(dlg).toContainText(commit.slice(0, 12));
    const hit = dlg.locator('tr[data-highlight="true"]');
    await expect(hit).toHaveCount(1);
    await expect(hit).toContainText('D-003');
    await expect(dlg.getByText('The Studio cannot edit this file.')).toBeVisible();
    expect(await dlg.locator('textarea, input, [contenteditable=true]').count()).toBe(0);
    const before = await dlg.locator('tbody tr').count();
    await dlg.getByRole('button', { name: 'Show more context' }).click();
    await expect.poll(() => dlg.locator('tbody tr').count()).toBeGreaterThan(before);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('a failing preview is reported and can be retried', async ({ page }) => {
    let fail = true;
    await page.route('**/api/v1/source**', (route) => (fail ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'simulated read failure' }) }) : route.continue()));
    await ready(page, '/decisions?id=D-003');
    await page.getByRole('button', { name: 'Preview source' }).click();
    const dlg = page.getByTestId('source-preview');
    await expect(dlg.getByRole('alert')).toContainText('simulated read failure');
    fail = false;
    await dlg.getByRole('button', { name: 'Retry' }).click();
    await expect(dlg.locator('tr[data-highlight="true"]')).toHaveCount(1);
  });

  test('the source API only serves documentation and policy files', async ({ request }) => {
    for (const p of ['../package.json', 'package.json', '.env', 'apps/architecture-studio/package.json', '/etc/passwd', 'docs/../package.json', 'docs\\x.md', 'docs/context/DECISION-REGISTER.md.exe', 'harness/hooks/anything.cjs']) {
      expect((await request.get(`/api/v1/source?path=${encodeURIComponent(p)}`)).status(), p).toBe(400);
    }
    expect((await request.get('/api/v1/source?path=docs/nope.md')).status()).toBe(404);
    const ok = await api<{ lines: unknown[]; highlight: number; totalLines: number }>(request, '/api/v1/source?path=docs/context/DECISION-REGISTER.md&line=30&context=5');
    expect(ok.lines.length).toBeLessThanOrEqual(11);
    expect(ok.highlight).toBe(30);
  });
});

test.describe('change detection and synchronisation', () => {
  test('API: comparing with another ref lists what changed, with alerts and files', async ({ request }) => {
    const r = await api<{ mode: string; changes: { counts: { added: number; changed: number; removed: number; unchanged: number; alerts: number }; records: { id: string; kind: string }[]; files: { path: string; change: string }[]; fromCommit: string; toCommit: string } }>(request, '/api/v1/register/changes?from=origin/capstone/rubric-enhancement');
    expect(r.mode).toBe('ref');
    expect(r.changes.fromCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(r.changes.counts.added).toBeGreaterThan(0);
    expect(r.changes.records.some((x) => x.kind === 'added')).toBe(true);
    expect(r.changes.files.length).toBeGreaterThan(0);
    expect(r.changes.counts.added + r.changes.counts.changed + r.changes.counts.unchanged).toBe(57);
  });

  test('API: bad refs are refused and unknown refs are reported', async ({ request }) => {
    expect((await request.get('/api/v1/register/changes?from=--upload-pack%3Dx')).status()).toBe(400);
    expect((await request.get('/api/v1/register/changes?from=a..b')).status()).toBe(400);
    expect((await request.get('/api/v1/register/changes?from=no-such-ref-xyz')).status()).toBe(404);
  });

  test('UI and API: first sync saves a baseline, the second reports nothing changed and re-parses nothing', async ({ page, request }) => {
    await ready(page, '/decisions');
    const section = page.getByTestId('register-health');
    await section.getByText('Repository changes and synchronisation').click();
    await section.getByRole('button', { name: 'Sync now' }).click();
    await expect(section.getByText(/First synchronisation: 57 records were read|0 added, 0 changed, 0 removed, 57 unchanged/)).toBeVisible();
    await expect(section.getByText(/Last sync: commit/)).toBeVisible();
    await section.getByRole('button', { name: 'Sync now' }).click();
    const res = section.getByTestId('changes-result');
    await expect(res).toContainText('0 added, 0 changed, 0 removed, 57 unchanged');
    await expect(res).toContainText('The register and its source files are unchanged.');
    const again = await (await request.post('/api/v1/register/sync')).json();
    expect(again.stats.filesReparsed).toBe(0);
    expect(again.stats.filesReused).toBe(again.stats.filesRead);
    const since = await api<{ mode: string; baseline: { commit: string }; changes: { counts: { added: number; changed: number; removed: number } } }>(request, '/api/v1/register/changes');
    expect(since.mode).toBe('baseline');
    expect([since.changes.counts.added, since.changes.counts.changed, since.changes.counts.removed]).toEqual([0, 0, 0]);
  });

  test('UI: comparing with a remote branch shows added records and files, as a person can read them', async ({ page }) => {
    await ready(page, '/decisions');
    const section = page.getByTestId('register-health');
    await section.getByText('Repository changes and synchronisation').click();
    await section.getByLabel('Compare with').selectOption('origin/capstone/rubric-enhancement');
    await section.getByRole('button', { name: 'Show changes' }).click();
    const res = section.getByTestId('changes-result');
    await expect(res).toContainText(/\d+ added/);
    await expect(res.locator('li').first()).toBeVisible();
    await expect(res.getByText(/source file\(s\) differ/)).toBeVisible();
    await expect(res.getByRole('button', { name: /^Show all \d+ records$/ })).toBeVisible();
    await expect(res.locator(':scope > ul > li')).toHaveCount(10);
    await res.getByRole('button', { name: /^Show all/ }).click();
    expect(await res.locator(':scope > ul > li').count()).toBeGreaterThan(10);
  });

  test('UI: a failing comparison is reported', async ({ page }) => {
    await page.route('**/api/v1/register/changes**', (route) => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'simulated failure' }) }));
    await ready(page, '/decisions');
    const section = page.getByTestId('register-health');
    await section.getByText('Repository changes and synchronisation').click();
    await section.getByRole('button', { name: 'Show changes' }).click();
    await expect(section.getByRole('alert')).toContainText('simulated failure');
  });
});
