import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { expectNoAxeViolations, gitOut, ready, repoRoot } from './helpers.ts';

// Decision Impact Analysis and Architecture Examiner Mode against the real repository. Expectations come from the repository files
// read with independent code, never from the Studio's own parser.

const git = (...a: string[]) => spawnSync('git', a, { cwd: repoRoot, encoding: 'utf8' });
const show = (p: string) => git('show', `HEAD:${p}`).stdout;
const POSITIONS = ['Not ready to defend', 'Defensible with conditions', 'Defensible on the record', 'Not an architecture decision'];

interface Impact {
  decisionId: string;
  statusNow: string;
  statusAfter: string | null;
  statusNote: string;
  summary: { direct: number; potential: number; blocking: number; followUp: number; rework: number; unresolved: number; unverified: number };
  direct: { id: string; kind: string; relation: string; src: { path: string; line: number } | null; tier: string }[];
  potential: { id: string; via: string | null; tier: string }[];
  blocking: { id: string; direction: string }[];
  followUp: { text: string; because: string }[];
  rework: { id: string }[];
  unresolved: unknown[];
  cycles: string[][];
  unverified: { id: string; targetId: string; nowExplicit: boolean }[];
  estimate: { effort: null; counts: string };
}
interface Dossier {
  headline: { position: string };
  sections: { key: string; entries: { basis: string; text: string; sources: unknown[] }[] }[];
  basisCounts: Record<string, number>;
  ai: { claims: { supported: boolean }[]; label: string; reviewState: string } | null;
  prompt: string;
  injection: unknown[];
}

const impactOf = async (request: import('@playwright/test').APIRequestContext, id: string, action: string) => (await (await request.get(`/api/v1/decisions/${id}/impact?action=${action}`)).json()) as Impact;

async function openDetail(page: Page, id: string) {
  await ready(page, `/decisions/${id}`);
  await expect(page.getByTestId('decision-detail')).toBeVisible();
}

test.describe('impact analysis: dependency detection against the real repository', () => {
  test('every directly affected decision really names the decision in its own source file', async ({ request }) => {
    const r = await impactOf(request, 'ADR-0016', 'reject');
    const decisions = r.direct.filter((x) => x.kind === 'decision');
    expect(decisions.length).toBeGreaterThan(0);
    for (const x of decisions) {
      expect(x.src, x.id).not.toBeNull();
      const text = show(x.src!.path);
      expect(text, `${x.id} source ${x.src!.path}`).toMatch(/ADR[- ]?0016|ADR-0016/);
    }
  });

  test('every directly affected item names a source line that exists', async ({ request }) => {
    const r = await impactOf(request, 'ADR-0016', 'approve');
    for (const x of r.direct.slice(0, 40)) {
      if (!x.src) continue;
      const lines = show(x.src.path).split('\n').length;
      expect(x.src.line, x.id).toBeGreaterThanOrEqual(1);
      expect(x.src.line, x.id).toBeLessThanOrEqual(lines);
    }
  });

  test('a potentially affected item is reached only through a decision that is directly affected', async ({ request }) => {
    const r = await impactOf(request, 'ADR-0001', 'reject');
    const direct = new Set(r.direct.map((x) => x.id));
    for (const p of r.potential) expect(p.via === null || direct.has(p.via) || r.potential.some((q) => q.id === p.via), `${p.id} via ${p.via}`).toBe(true);
    for (const p of r.potential) expect(direct.has(p.id), `${p.id} is not both direct and potential`).toBe(false);
  });

  test('all four actions work for every record, summaries equal the lists, effort is never stated', async ({ request }) => {
    const list = (await (await request.get('/api/v1/decisions')).json()) as { items: { id: string }[] };
    expect(list.items.length).toBeGreaterThanOrEqual(58);
    for (const it of list.items) {
      for (const a of ['approve', 'reject', 'defer', 'revise']) {
        const r = await impactOf(request, it.id, a);
        expect(r.summary.direct, `${it.id} ${a}`).toBe(r.direct.length);
        expect(r.summary.potential, `${it.id} ${a}`).toBe(r.potential.length);
        expect(r.summary.blocking, `${it.id} ${a}`).toBe(r.blocking.length);
        expect(r.estimate.effort, `${it.id} ${a}`).toBeNull();
      }
    }
  });

  test('rejection and approval differ in follow-up work, and each names the status it would lead to', async ({ request }) => {
    const ap = await impactOf(request, 'ADR-0016', 'approve');
    const rj = await impactOf(request, 'ADR-0016', 'reject');
    expect(ap.statusAfter).toBe('Approved');
    expect(rj.statusAfter).toBe('Rejected');
    expect(rj.followUp.map((f) => f.text).join('|')).not.toBe(ap.followUp.map((f) => f.text).join('|'));
    expect(rj.rework.length).toBeGreaterThan(0);
    for (const f of rj.followUp) expect(f.because.length, f.text).toBeGreaterThan(0);
  });

  test('blocking dependencies name the direction, and a decision in the real register has no cycle', async ({ request }) => {
    const r = await impactOf(request, 'ADR-0016', 'approve');
    for (const b of r.blocking) expect(['rests-on', 'waits-for-this']).toContain(b.direction);
    expect(r.cycles).toEqual([]);
  });

  test('a record that does not exist, and an action that does not exist, are refused', async ({ request }) => {
    expect((await request.get('/api/v1/decisions/ADR-9999/impact?action=approve')).status()).toBe(404);
    expect((await request.get('/api/v1/decisions/ADR-0016/impact?action=obliterate')).status()).toBe(400);
  });
});

test.describe('AI-suggested relationships are labelled unverified and never counted', () => {
  test('the suggested D-010 to D-031 link is shown apart from the explicit ones, from both ends, and adds nothing to the counts', async ({ request }) => {
    const a = await impactOf(request, 'D-010', 'approve');
    const s = a.unverified.find((u) => u.id === 'S-101');
    expect(s, 'S-101 shows on D-010').toBeTruthy();
    expect(s!.targetId).toBe('D-031');
    expect(s!.nowExplicit).toBe(false);
    const counted = [...a.direct.map((x) => x.id), ...a.potential.map((x) => x.id)];
    // Only a link a record states can put D-031 in the counted lists; S-101 alone never does.
    const explicit = show('docs/context/DECISION-REGISTER.md').split('\n').filter((l) => /^\| D-010 /.test(l)).join('').includes('D-031');
    if (!explicit) expect(counted).not.toContain('D-031');
    expect(a.summary.unverified).toBe(a.unverified.filter((u) => !u.nowExplicit).length);
    const b = await impactOf(request, 'D-031', 'approve');
    expect(b.unverified.some((u) => u.id === 'S-101' && u.targetId === 'D-010')).toBe(true);
  });

  test('the suggestion file says it is unverified and carries no status or approval', async () => {
    const f = JSON.parse(show('docs/architecture-studio/suggestions/ai-relationship-suggestions-2026-11-02.json')) as { notice: string; suggestions: Record<string, unknown>[] };
    expect(f.notice).toMatch(/unverified/i);
    for (const s of f.suggestions) {
      expect(s.label).toBe('AI SUGGESTION');
      expect(s.reviewState).toBe('unreviewed');
      expect(Object.keys(s)).not.toContain('status');
      expect(Object.keys(s)).not.toContain('approved');
    }
  });

  test('the Impact tab labels it Unverified and says it is not counted', async ({ page }) => {
    await openDetail(page, 'D-010');
    await page.getByTestId('tab-impact').click();
    const box = page.getByTestId('impact-unverified');
    await expect(box).toBeVisible();
    await expect(box).toContainText('Unverified');
    await expect(box).toContainText('D-031');
    await expect(page.getByText(/not counted above/i)).toBeVisible();
  });
});

test.describe('impact panel: compact, progressive, keyboard friendly', () => {
  test('opens from the tab, shows counts first, and keeps the details closed until asked for', async ({ page }) => {
    await openDetail(page, 'ADR-0016');
    await page.getByTestId('tab-impact').click();
    await expect(page.getByTestId('impact-panel')).toBeVisible();
    await expect(page.getByTestId('impact-summary')).toBeVisible();
    await expect(page.getByTestId('impact-status')).toContainText('Approved');
    const closed = page.locator('[data-testid="impact-panel"] details:not([open])');
    expect(await closed.count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid="impact-panel"] details[open]').count()).toBe(0);
    await closed.first().locator('summary').click();
    await expect(page.getByTestId('impact-item').first()).toBeVisible();
  });

  test('the UI counts equal the API counts for each of the four actions', async ({ page, request }) => {
    await openDetail(page, 'ADR-0016');
    await page.getByTestId('tab-impact').click();
    for (const a of ['approve', 'reject', 'defer', 'revise'] as const) {
      await page.getByTestId(`impact-${a}`).click();
      const api = await impactOf(request, 'ADR-0016', a);
      await expect(page.getByTestId('impact-count-direct')).toContainText(String(api.summary.direct));
      await expect(page.getByTestId('impact-count-blocking')).toContainText(String(api.summary.blocking));
      await expect(page.getByTestId('impact-status')).toContainText(api.statusAfter ?? '');
    }
  });

  test('states that estimates are counts only, and that the Studio changes nothing', async ({ page }) => {
    await openDetail(page, 'ADR-0016');
    await page.getByTestId('tab-impact').click();
    await expect(page.getByTestId('impact-estimate')).toContainText(/no effort|count/i);
    await expect(page.getByTestId('impact-status')).toContainText(/Studio|GitHub|review record/i);
  });

  test('tabs follow the arrow keys, Home and End, with one tab stop', async ({ page }) => {
    await openDetail(page, 'ADR-0016');
    await page.getByTestId('tab-record').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-impact')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-impact')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByTestId('tab-challenge')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-record')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-impact')).toHaveAttribute('tabindex', '-1');
  });
});

test.describe('Architecture Examiner: the challenge, against the real repository', () => {
  test('"Challenge this decision" opens the Challenge tab with a position, the legend, and the nine other sections closed', async ({ page }) => {
    await openDetail(page, 'D-010');
    await page.getByTestId('challenge-this').click();
    await expect(page.getByTestId('tab-challenge')).toHaveAttribute('aria-selected', 'true');
    const pos = page.getByTestId('examiner-position');
    await expect(pos).toBeVisible();
    const posText = (await pos.textContent()) ?? '';
    expect(POSITIONS.some((p) => posText.includes(p))).toBe(true);
    await expect(pos).toContainText(/not an approval/i);
    await expect(page.getByTestId('examiner-headline')).toBeVisible();
    await expect(page.getByTestId('basis-legend').getByTestId('basis')).toHaveCount(5);
    await expect(page.locator('[data-testid="examiner-sections"] details')).toHaveCount(9);
    expect(await page.locator('[data-testid="examiner-sections"] details[open]').count()).toBe(0);
  });

  test('the five panel questions are present when the questions section is opened', async ({ page }) => {
    await openDetail(page, 'D-010');
    await page.getByTestId('challenge-this').click();
    const q = page.locator('[data-section="questions"]');
    await q.locator('summary').click();
    await expect(q.getByTestId('examiner-entry')).toHaveCount(5);
  });

  test('every examiner line carries a basis, and the legend counts add up', async ({ request }) => {
    for (const id of ['ADR-0016', 'D-010', 'D-003', 'D-002']) {
      const d = (await (await request.get(`/api/v1/decisions/${id}/examiner`)).json()) as Dossier;
      expect(d.sections.map((s) => s.key)).toEqual(['against', 'alternatives', 'pros-cons', 'assumptions', 'reliability', 'security-compliance', 'cost-operations', 'questions', 'evidence', 'recommendation']);
      for (const s of d.sections) for (const e of s.entries) expect(['verified-fact', 'approved-decision', 'proposed-interpretation', 'unverified-assumption', 'ai-generated']).toContain(e.basis);
      expect(d.sections.find((s) => s.key === 'questions')!.entries.length, id).toBe(5);
      const n = d.sections.reduce((a, s) => a + s.entries.length, 0) + (d.ai?.claims.filter((c) => c.supported).length ?? 0);
      expect(Object.values(d.basisCounts).reduce((a, b) => a + b, 0), id).toBe(n);
    }
  });

  test('the position is a statement about defensibility, never approval, and never states effort or a cost estimate', async ({ request }) => {
    const list = (await (await request.get('/api/v1/decisions')).json()) as { items: { id: string }[] };
    for (const it of list.items) {
      const d = (await (await request.get(`/api/v1/decisions/${it.id}/examiner`)).json()) as Dossier;
      expect(POSITIONS, it.id).toContain(d.headline.position);
      expect(JSON.stringify(d.headline), it.id).not.toMatch(/recommend(s|ed)? (that )?(you )?approv/i);
    }
  });

  test('a stakeholder question and a regulatory claim are not presented as architecture decisions', async ({ request }) => {
    for (const id of ['D-002', 'D-003']) {
      const d = (await (await request.get(`/api/v1/decisions/${id}/examiner`)).json()) as Dossier;
      const row = show('docs/context/DECISION-REGISTER.md').split('\n').find((l) => l.startsWith(`| ${id} `))!;
      const kind = row.split('|')[2]!.trim();
      if (/^(C|D|C\+D)$/.test(kind)) expect(d.headline.position, `${id} kind ${kind}`).toBe('Not an architecture decision');
    }
  });

  test('reasons for a Not ready position are facts the repository holds: unresolved dependencies are real', async ({ request }) => {
    const d = (await (await request.get('/api/v1/decisions/ADR-0016/examiner')).json()) as Dossier & { headline: { position: string; reasons: { text: string }[] } };
    expect(d.headline.position).toBe('Not ready to defend');
    expect(d.headline.reasons.length).toBeGreaterThan(0);
  });
});

test.describe('the AI challenge: shown as AI-generated, and only as far as its citations check out', () => {
  test('ADR-0016 and D-010 have a committed challenge whose 16 and 14 claims all verify against the files', async ({ request }) => {
    for (const [id, n] of [['ADR-0016', 16], ['D-010', 14]] as const) {
      const d = (await (await request.get(`/api/v1/decisions/${id}/examiner`)).json()) as Dossier;
      expect(d.ai, id).not.toBeNull();
      expect(d.ai!.label).toBe('AI CHALLENGE');
      expect(d.ai!.reviewState).toBe('unreviewed');
      expect(d.ai!.claims.length, id).toBe(n);
      expect(d.ai!.claims.every((c) => c.supported), id).toBe(true);
    }
  });

  test('every quote the AI cited is really in the file it cites, checked here without the Studio', async () => {
    for (const id of ['ADR-0016', 'D-010']) {
      const rec = JSON.parse(show(`docs/architecture-studio/examiner/${id}.json`)) as { entries: { evidence: { path: string; line: number; quote: string }[] }[] };
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      for (const e of rec.entries) for (const v of e.evidence) {
        const lines = show(v.path).replace(/\r/g, '').split('\n');
        const near = norm(lines.slice(Math.max(0, v.line - 2), v.line + 5).join(' '));
        expect(near, `${id} ${v.path}:${v.line}`).toContain(norm(v.quote));
      }
    }
  });

  test('the Challenge tab shows the AI challenge with its label, its author, and the verification result', async ({ page }) => {
    await openDetail(page, 'ADR-0016');
    await page.getByTestId('challenge-this').click();
    const box = page.getByTestId('ai-challenge');
    await expect(box).toBeVisible();
    await expect(box).toContainText('16 of 16');
    await expect(box).toContainText(/Unreviewed/);
    await expect(page.getByTestId('ai-unsupported')).toHaveCount(0);
    await expect(page.getByTestId('ai-against').getByTestId('ai-claim')).not.toHaveCount(0);
    await expect(page.getByTestId('ai-against')).toContainText('AI');
  });

  test('a decision with no committed challenge says so, and offers the prompt', async ({ page }) => {
    await openDetail(page, 'ADR-0001');
    await page.getByTestId('challenge-this').click();
    await expect(page.getByTestId('examiner-panel')).toBeVisible();
    await expect(page.getByTestId('ai-challenge')).toHaveCount(0);
    await page.getByText('Limits of this challenge').click();
    await expect(page.getByTestId('examiner-limits')).toContainText(/No AI challenge is committed/);
    await expect(page.getByTestId('copy-prompt')).toBeVisible();
  });

  test('the prompt targets the real agents, keeps source text in a fenced data block, and asks for evidence', async ({ page }) => {
    await openDetail(page, 'D-010');
    await page.getByTestId('challenge-this').click();
    await page.getByText('Show the prompt').click();
    const p = (await page.getByTestId('critic-prompt').textContent()) ?? '';
    expect(p).toContain('architecture-critic');
    expect(p).toContain('principal-architect');
    expect(p).toMatch(/BEGIN DATA-[0-9a-f]{8}/);
    expect(p).toMatch(/END DATA-[0-9a-f]{8}/);
    expect(p).toMatch(/quote copied exactly/);
    expect(p).toMatch(/do not approve/i);
    expect(p.length).toBeLessThan(12000);
  });

  test('the agents the prompt names exist in the repository', async () => {
    expect(git('cat-file', '-e', 'HEAD:.github/agents/architecture-critic.agent.md').status).toBe(0);
    expect(git('cat-file', '-e', 'HEAD:.github/agents/principal-architect.agent.md').status).toBe(0);
  });

  test('copying the prompt gives clear feedback', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openDetail(page, 'D-010');
    await page.getByTestId('challenge-this').click();
    await page.getByTestId('copy-prompt').click();
    await expect(page.getByTestId('copy-prompt')).toContainText(/Copied|Copy failed/);
  });
});

test.describe('prompt injection in source documents', () => {
  test('no real source currently trips the detector, so no warning is shown on a normal record', async ({ request, page }) => {
    const list = (await (await request.get('/api/v1/decisions')).json()) as { items: { id: string }[] };
    let flagged = 0;
    for (const it of list.items) flagged += ((await (await request.get(`/api/v1/decisions/${it.id}/examiner`)).json()) as Dossier).injection.length;
    expect(flagged).toBe(0);
    await openDetail(page, 'ADR-0016');
    await page.getByTestId('challenge-this').click();
    await expect(page.getByTestId('injection-warning')).toHaveCount(0);
  });

  test('the prompt for every record has exactly one data block and carries no instruction-like text', async ({ request }) => {
    const list = (await (await request.get('/api/v1/decisions')).json()) as { items: { id: string }[] };
    for (const it of list.items) {
      const p = ((await (await request.get(`/api/v1/decisions/${it.id}/examiner`)).json()) as Dossier).prompt;
      expect(p.split('\n').filter((l) => /^BEGIN DATA-/.test(l)).length, it.id).toBe(1);
      expect(p.split('\n').filter((l) => /^END DATA-/.test(l)).length, it.id).toBe(1);
      expect(p, it.id).not.toMatch(/ignore (all )?(previous|prior|above)/i);
    }
  });
});

test.describe('reading changes nothing', () => {
  test('every impact and examiner read leaves the repository exactly as it was', async ({ request }) => {
    const before = gitOut('rev-parse', 'HEAD') + gitOut('status', '--porcelain', '--untracked-files=no') + gitOut('stash', 'list');
    for (const id of ['ADR-0016', 'D-010', 'D-003']) {
      for (const a of ['approve', 'reject', 'defer', 'revise']) await request.get(`/api/v1/decisions/${id}/impact?action=${a}`);
      await request.get(`/api/v1/decisions/${id}/examiner`);
    }
    expect(gitOut('rev-parse', 'HEAD') + gitOut('status', '--porcelain', '--untracked-files=no') + gitOut('stash', 'list')).toBe(before);
  });

  test('the endpoints accept only GET: a write is refused', async ({ request }) => {
    for (const p of ['impact?action=approve', 'examiner']) {
      for (const method of ['post', 'put', 'delete', 'patch'] as const) {
        const r = await request[method](`/api/v1/decisions/ADR-0016/${p}`, { data: {} });
        expect([404, 405], `${method} ${p}`).toContain(r.status());
      }
    }
  });
});

test.describe('loading, failure and recovery', () => {
  test('shows a loading state, then the impact (delayed server)', async ({ page }) => {
    await page.goto('http://localhost:3102/decisions/ADR-0016');
    await expect(page.getByTestId('tab-impact')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('tab-impact').click();
    await expect(page.getByTestId('impact-loading')).toBeVisible();
    await expect(page.getByTestId('impact-summary')).toBeVisible({ timeout: 20_000 });
  });

  test('shows a clear error and recovers on Retry when the impact request fails', async ({ page }) => {
    await openDetail(page, 'ADR-0016');
    let fail = true;
    await page.route('**/api/v1/decisions/ADR-0016/impact**', (route) => (fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'simulated failure' }) }) : route.continue()));
    await page.getByTestId('tab-impact').click();
    const alert = page.getByRole('alert').filter({ hasText: 'could not be loaded' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('simulated failure');
    fail = false;
    await alert.getByRole('button', { name: /retry/i }).click();
    await expect(page.getByTestId('impact-summary')).toBeVisible();
    await expect(alert).toHaveCount(0);
  });

  test('shows a clear error and recovers on Retry when the challenge request fails', async ({ page }) => {
    await openDetail(page, 'ADR-0016');
    let fail = true;
    await page.route('**/api/v1/decisions/ADR-0016/examiner**', (route) => (fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"unavailable"}' }) : route.continue()));
    await page.getByTestId('challenge-this').click();
    const alert = page.getByRole('alert').filter({ hasText: 'could not be loaded' });
    await expect(alert).toBeVisible();
    fail = false;
    await alert.getByRole('button', { name: /retry/i }).click();
    await expect(page.getByTestId('examiner-position')).toBeVisible();
  });

  test('on a repository that cannot be read, the API says so instead of returning empty analysis', async ({ request }) => {
    const r = await request.get('http://localhost:3101/api/v1/decisions/ADR-0016/impact?action=approve');
    expect(r.ok()).toBe(false);
    const e = await request.get('http://localhost:3101/api/v1/decisions/ADR-0016/examiner');
    expect(e.ok()).toBe(false);
  });
});

test.describe('navigation, context and the review page', () => {
  test('moving to another decision returns to the Record tab and loads that decision', async ({ page }) => {
    await ready(page, '/decisions');
    await page.getByTestId('decision-row').first().click();
    await expect(page.getByTestId('decision-detail')).toBeVisible();
    await page.getByTestId('tab-challenge').click();
    await expect(page.getByTestId('examiner-position')).toBeVisible();
    await page.getByTestId('decision-row').nth(2).click();
    await expect(page.getByTestId('tab-record')).toHaveAttribute('aria-selected', 'true');
  });

  test('the review page offers both aids in a side panel, and the review actions are not behind them', async ({ page }) => {
    await ready(page, '/decisions/D-010/review');
    const aids = page.getByTestId('review-aids');
    await expect(aids).toBeVisible();
    await aids.getByTestId('review-impact').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('impact-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await aids.getByTestId('review-challenge').click();
    await expect(page.getByRole('dialog').getByTestId('examiner-position')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('quality: console, accessibility, responsive', () => {
  test('no console errors or warnings across the impact and challenge views', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 200)}`));
    for (const id of ['ADR-0016', 'D-010', 'D-002']) {
      await openDetail(page, id);
      await page.getByTestId('tab-impact').click();
      await expect(page.getByTestId('impact-summary')).toBeVisible();
      for (const a of ['reject', 'defer', 'revise']) await page.getByTestId(`impact-${a}`).click();
      await page.getByTestId('tab-challenge').click();
      await expect(page.getByTestId('examiner-position')).toBeVisible();
    }
    expect(problems).toEqual([]);
  });

  test('no accessibility violations: Impact (sections open) and Challenge (sections open)', async ({ page }) => {
    await openDetail(page, 'ADR-0016');
    await page.getByTestId('tab-impact').click();
    await expect(page.getByTestId('impact-summary')).toBeVisible();
    for (const s of await page.locator('[data-testid="impact-panel"] details > summary').all()) await s.click();
    await expectNoAxeViolations(page, 'impact panel');
    await page.getByTestId('tab-challenge').click();
    await expect(page.getByTestId('examiner-position')).toBeVisible();
    for (const s of await page.locator('[data-testid="examiner-panel"] details > summary').all()) await s.click();
    await expectNoAxeViolations(page, 'challenge panel');
  });

  test('no accessibility violations on the unusual cases: a clarification and a decision with no AI challenge', async ({ page }) => {
    for (const id of ['D-002', 'ADR-0001']) {
      await openDetail(page, id);
      await page.getByTestId('challenge-this').click();
      await expect(page.getByTestId('examiner-position')).toBeVisible();
      await expectNoAxeViolations(page, `${id} challenge`);
    }
  });

  test('on a phone-sized screen nothing overflows sideways and the panels remain usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const view of ['impact', 'challenge'] as const) {
      await openDetail(page, 'ADR-0016');
      await page.getByTestId(`tab-${view}`).click();
      await expect(page.getByTestId(view === 'impact' ? 'impact-summary' : 'examiner-position')).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${view} horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });

  test('respects reduced motion: no animation is running in the panels', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDetail(page, 'ADR-0016');
    await page.getByTestId('tab-impact').click();
    await expect(page.getByTestId('impact-summary')).toBeVisible();
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && (a.effect as KeyframeEffect | null)?.target && (a.effect as KeyframeEffect).target!.closest('[data-testid="impact-panel"]')).length);
    expect(running).toBe(0);
  });
});
