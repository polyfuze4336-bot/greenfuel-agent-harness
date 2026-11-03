import { expect, test, type APIRequestContext } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { gitOut, repoRoot, ready } from './helpers.ts';

// The Decision Workspace against the real repository: every record is represented, each kind of record is treated as what it is, and
// reading changes nothing. Expectations are derived from the repository files with independent code, not from the Studio's own parser.

const git = (...a: string[]) => spawnSync('git', a, { cwd: repoRoot, encoding: 'utf8' });
const show = (p: string) => git('show', `HEAD:${p}`).stdout;

interface Rec {
  id: string;
  kind: 'adr' | 'register-entry';
  title: string;
  status: string;
  statusRaw: string;
  natures: string[];
  missing: string[];
  fieldSources: Record<string, { path: string; line: number; rule: string }>;
  source: { path: string; line: number; commit: string; blob: string };
  invalidReferences: unknown[];
  relatedRequirements: { id: string }[];
}

async function allRecords(request: APIRequestContext): Promise<Rec[]> {
  const list = (await (await request.get('/api/v1/decisions')).json()) as { items: { id: string }[] };
  const out: Rec[] = [];
  for (const it of list.items) {
    const s = (await (await request.get(`/api/v1/decisions/${encodeURIComponent(it.id)}/sheet`)).json()) as { decision: Rec };
    out.push(s.decision);
  }
  return out;
}

/** What the files say, read without the Studio's parser. */
function fromFiles() {
  const adrs = git('ls-tree', '-r', '--name-only', 'HEAD', 'docs/adr').stdout.split('\n').filter((f) => /\/\d{4}-.*\.md$/.test(f) && !/\/0000-/.test(f)); // 0000 is the template, not a decision
  const adrStatus = new Map<string, string>();
  for (const f of adrs) {
    const n = /\/(\d{4})-/.exec(f)![1]!;
    adrStatus.set(`ADR-${n}`, /^- \*\*Status:\*\*\s*(.+)$/m.exec(show(f))?.[1]?.trim() ?? '');
  }
  const rows = show('docs/context/DECISION-REGISTER.md')
    .split('\n')
    .filter((l) => /^\| D-\d{3} /.test(l))
    .map((l) => {
      const c = l.split('|').map((x) => x.trim());
      return { id: c[1]!, kind: c[2]!, status: c[8]! };
    });
  const lanes = { architecture: adrs.length, stakeholder: 0, verification: 0 };
  for (const r of rows) {
    if (r.kind.includes('D')) lanes.verification++;
    else if (r.kind.includes('C')) lanes.stakeholder++;
    else lanes.architecture++;
  }
  return { adrs, adrStatus, rows, lanes };
}

test.describe('every supported record is represented, and the counts reconcile with the repository', () => {
  test('one record per ADR file and per register row, in the API and in the table', async ({ page, request }) => {
    const f = fromFiles();
    const list = (await (await request.get('/api/v1/decisions')).json()) as { count: number; items: { id: string; kind: string }[]; commit: string };
    expect(list.commit).toBe(gitOut('rev-parse', 'HEAD'));
    expect(list.items.filter((i) => i.kind === 'adr')).toHaveLength(f.adrs.length);
    expect(list.items.filter((i) => i.kind === 'register-entry')).toHaveLength(f.rows.length);
    expect(list.count).toBe(f.adrs.length + f.rows.length);
    expect(new Set(list.items.map((i) => i.id)).size, 'no duplicate id is shown as one record').toBe(list.count);
    for (const r of f.rows) expect(list.items.some((i) => i.id === r.id), `${r.id} is in the register but not in the Studio`).toBe(true);
    await ready(page, '/decisions');
    await expect(page.getByTestId('decision-row')).toHaveCount(list.count);
  });

  test('the three kinds add up to the whole register and match the Kind column', async ({ page, request }) => {
    const f = fromFiles();
    const recs = await allRecords(request);
    const lane = (r: Rec) => (r.natures.includes('regulatory-verification') ? 'verification' : r.natures.includes('stakeholder-clarification') ? 'stakeholder' : r.natures.includes('architecture-choice') ? 'architecture' : 'unclassified');
    const got = { architecture: 0, stakeholder: 0, verification: 0, unclassified: 0 };
    for (const r of recs) got[lane(r)]++;
    expect(got).toEqual({ ...f.lanes, unclassified: 0 });
    expect(got.architecture + got.stakeholder + got.verification + got.unclassified).toBe(recs.length);
    for (const l of ['architecture', 'stakeholder', 'verification'] as const) {
      await ready(page, `/decisions?lane=${l}`);
      await expect(page.getByTestId('decision-row')).toHaveCount(f.lanes[l]);
    }
  });

  test('existing statuses are preserved exactly as written', async ({ request }) => {
    const f = fromFiles();
    const recs = await allRecords(request);
    const expected: Record<string, string[]> = { Accepted: ['Approved'], Proposed: ['Proposed', 'Blocked'], Rejected: ['Rejected'], Deferred: ['Deferred'], Superseded: ['Superseded'] };
    for (const [id, raw] of f.adrStatus) {
      const r = recs.find((x) => x.id === id)!;
      expect(r.statusRaw, `${id} keeps its status text`).toBe(raw);
      const word = /^(Accepted|Proposed|Rejected|Deferred|Superseded)/.exec(raw)?.[1];
      if (word) expect(expected[word], `${id} ${raw}`).toContain(r.status);
    }
    for (const row of f.rows) {
      const r = recs.find((x) => x.id === row.id)!;
      expect(r.statusRaw, row.id).toBe(row.status);
      expect(r.status, `${row.id} is open in the register, so it is not approved`).toBe('Pending Review');
    }
  });

  test('every record has a recorded nature, a real source file and line, and the blob git reports', async ({ request }) => {
    const recs = await allRecords(request);
    for (const r of recs) {
      expect(r.natures.length, `${r.id} has a nature`).toBeGreaterThan(0);
      expect(r.fieldSources.natures?.rule, `${r.id} says where its nature came from`).toBeTruthy();
      expect(git('cat-file', '-e', `HEAD:${r.source.path}`).status, `${r.id}: ${r.source.path} exists`).toBe(0);
      const lines = show(r.source.path).split('\n').length;
      expect(r.source.line).toBeGreaterThanOrEqual(1);
      expect(r.source.line).toBeLessThanOrEqual(lines);
      expect(r.source.blob, `${r.id} blob`).toBe(git('rev-parse', `HEAD:${r.source.path}`).stdout.trim());
      if (r.kind === 'register-entry') expect(show(r.source.path).split('\n')[r.source.line - 1]).toContain(r.id);
    }
  });

  test('a field no source states is shown as not stated, never filled in', async ({ page, request }) => {
    const d = ((await (await request.get('/api/v1/decisions/D-003/sheet')).json()) as { decision: Rec & { implications: Record<string, unknown>; recommendedOption: unknown } }).decision;
    expect(d.recommendedOption).toBeNull();
    expect(Object.values(d.implications).every((v) => v === null)).toBe(true);
    for (const f of ['recommendedOption', 'implications.cost', 'implications.security', 'implications.reliability', 'implications.dataSovereignty']) expect(d.missing, f).toContain(f);
    await ready(page, '/decisions/D-003');
    const detail = page.getByTestId('decision-detail');
    await expect(detail.getByTestId('missing-fields')).toContainText('Cost implications');
    await expect(detail.getByText('Not stated in any source.').first()).toBeVisible();
  });

  test('citations resolve: no record cites a decision or requirement that does not exist at this commit', async ({ request }) => {
    const recs = await allRecords(request);
    for (const r of recs) expect(r.invalidReferences, `${r.id} cites something that does not exist`).toEqual([]);
    const model = (await (await request.get('/api/v1/repository')).json()) as { warnings: string[] };
    expect(model.warnings.filter((w) => /does not exist/.test(w))).toEqual([]);
  });
});

test.describe('a stakeholder question or a regulatory claim is never presented as an architecture option to approve', () => {
  const SAMPLE = [
    { id: 'D-003', lane: 'stakeholder', optionsTitle: /^Possible answers \(\d+\)$/, notice: /stakeholder clarification, not an architecture decision/i },
    { id: 'D-001', lane: 'verification', optionsTitle: /^Ways to verify \(\d+\)$/, notice: /Needs verification by a qualified person/ },
    { id: 'D-010', lane: 'architecture', optionsTitle: /^Alternative options \(\d+\)$/, notice: null },
    { id: 'ADR-0016', lane: 'architecture', optionsTitle: /^Alternative options \(\d+\)$/, notice: null },
  ] as const;

  for (const s of SAMPLE) {
    test(`${s.id} (${s.lane}) is labelled, and offers only what its kind allows`, async ({ page }) => {
      await ready(page, `/decisions/${s.id}`);
      const detail = page.getByTestId('decision-detail');
      await expect(detail.getByRole('heading', { level: 3, name: s.optionsTitle })).toBeVisible();
      if (s.notice) await expect(detail.getByTestId('lane-notice')).toContainText(s.notice);
      else await expect(detail.getByTestId('lane-notice')).toHaveCount(0);
      const review = detail.getByRole('link', { name: s.lane === 'architecture' ? 'Review and decide' : 'Comment and track' });
      await expect(review).toBeVisible();
      await expect(detail.getByRole('link', { name: 'Compare alternatives' })).toHaveCount(s.lane === 'architecture' ? 1 : 0);
      await expect(detail.getByTestId('nature').first()).toBeVisible();
    });
  }

  test('the review page says the same thing, and the queue holds only architecture decisions', async ({ page, request }) => {
    await ready(page, '/decisions/D-003/review');
    await expect(page.getByTestId('lane-notice')).toContainText(/not an architecture decision/);
    const lanes = new Map((await allRecords(request)).map((r) => [r.id, r.natures]));
    let after = '';
    const seen: string[] = [];
    for (let i = 0; i < 80; i++) {
      const n = (await (await request.get(`/api/v1/review/next${after ? `?after=${after}` : ''}`)).json()) as { next: { id: string } | null };
      if (!n.next) break;
      seen.push(n.next.id);
      after = n.next.id;
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const id of seen) expect(lanes.get(id), `${id} is in the review queue`).toEqual(['architecture-choice']);
    for (const id of ['D-001', 'D-003', 'D-004', 'D-011']) expect(seen, `${id} must not be offered for review`).not.toContain(id);
  });

  test('"Review architecture decisions" starts at an architecture decision and its count is the queue', async ({ page, request }) => {
    await ready(page, '/decisions');
    const total = ((await (await request.get('/api/v1/review/next')).json()) as { total: number }).total;
    await expect(page.getByTestId('start-review')).toContainText(`Review architecture decisions (${total})`);
    await page.getByTestId('start-review').click();
    await expect(page).toHaveURL(/\/decisions\/(ADR-\d{4}|D-(010|013|018|021|027|030|036))\/review$/);
  });

  test('the Overview separates the three kinds of work, with real counts', async ({ page }) => {
    const f = fromFiles();
    await ready(page, '/');
    const attention = page.locator('#attention');
    await expect(attention).toContainText(`${f.lanes.stakeholder} answers needed`);
    await expect(attention).toContainText(`${f.lanes.verification} to verify`);
    await expect(attention).toContainText('to decide');
  });
});

test.describe('search, filter, grouping, history and source provenance', () => {
  test('search and the Kind filter combine, and status grouping reflects the statuses', async ({ page }) => {
    await ready(page, '/decisions?lane=stakeholder&q=port');
    const rows = page.getByTestId('decision-row');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await expect(rows.nth(i)).toContainText(/Stakeholder/);
    await ready(page, '/decisions?group=status');
    await expect(page.locator('th[scope="colgroup"]').first()).toBeVisible();
  });

  test('last modified commit and the file history match git', async ({ page, request }) => {
    const p = 'docs/adr/0016-sovereign-evidence-cells-per-jurisdiction-with-federated-coordination.md';
    const file = git('ls-tree', '-r', '--name-only', 'HEAD', 'docs/adr').stdout.split('\n').find((f) => f.includes('/0016-'))!;
    const expected = git('log', '-n20', '--format=%H', 'HEAD', '--', file).stdout.trim().split('\n');
    const h = (await (await request.get(`/api/v1/history?path=${encodeURIComponent(file)}&limit=20`)).json()) as { entries: { sha: string; onGitHub: boolean }[] };
    expect(h.entries.map((e) => e.sha)).toEqual(expected);
    expect(p.length).toBeGreaterThan(0);
    await ready(page, '/decisions/ADR-0016');
    await expect(page.getByTestId('last-modified')).toContainText(expected[0]!.slice(0, 7));
    await expect(page.getByTestId('file-commit').first()).toContainText('Last modified');
    await expect(page.getByTestId('file-commit')).toHaveCount(expected.length);
  });

  test('every source link either points at a commit that holds the file, or says it is local only', async ({ page }) => {
    test.setTimeout(120_000);
    const checked = new Set<string>();
    for (const id of ['ADR-0016', 'ADR-0001', 'D-003', 'D-001', 'D-010']) {
      await ready(page, `/decisions/${id}`);
      const detail = page.getByTestId('decision-detail');
      const hrefs = await detail.locator('a[href*="/blob/"]').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLAnchorElement).href))]);
      for (const href of hrefs) {
        const m = /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/([0-9a-f]{40})\/(.+?)#L(\d+)$/.exec(href);
        expect(m, `${id}: ${href}`).not.toBeNull();
        const [, commit, enc, line] = m!;
        const file = decodeURIComponent(enc!);
        const key = `${commit}:${file}`;
        if (!checked.has(key)) {
          checked.add(key);
          const body = git('show', key);
          expect(body.status, `${id}: ${file} exists at ${commit!.slice(0, 7)}`).toBe(0);
          expect(Number(line)).toBeLessThanOrEqual(body.stdout.split('\n').length);
        }
      }
      const local = await detail.getByText('Local only').count();
      expect(hrefs.length + local, `${id} shows its source one way or the other`).toBeGreaterThan(0);
    }
  });
  test('a permalink on GitHub opens the same file (checked live when a permalink exists)', async ({ page, request }) => {
    await ready(page, '/decisions/ADR-0001');
    const href = await page.getByTestId('decision-detail').locator('a[href*="/blob/"]').first().getAttribute('href');
    test.skip(!href, 'The commit being read has not been pushed, so there is no permalink to check.');
    const raw = href!.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/blob/', '/').replace(/#L\d+$/, '');
    let status = 0;
    try {
      status = (await request.get(raw, { timeout: 15_000 })).status();
    } catch {
      test.skip(true, 'GitHub could not be reached from this machine.');
    }
    expect(status).toBe(200);
  });
});

test.describe('reading changes nothing', () => {
  test('opening every record, every page and every read endpoint leaves the repository as it was', async ({ page, request }) => {
    test.setTimeout(240_000);
    const fingerprint = () => {
      const h = crypto.createHash('sha256');
      h.update(git('diff', 'HEAD').stdout);
      for (const f of git('ls-files', '--others', '--exclude-standard').stdout.split('\n').filter(Boolean).sort()) h.update(f);
      return { head: gitOut('rev-parse', 'HEAD'), refs: git('for-each-ref').stdout, status: git('status', '--porcelain').stdout, work: h.digest('hex') };
    };
    const before = fingerprint();
    const recs = await allRecords(request);
    for (const r of recs) {
      expect((await request.get(`/decisions/${encodeURIComponent(r.id)}`)).status(), r.id).toBe(200);
      expect((await request.get(`/api/v1/decisions/${encodeURIComponent(r.id)}`)).status(), r.id).toBe(200);
    }
    for (const p of ['/', '/decisions', '/changes', '/queue', '/approvals', '/baseline', '/architecture', '/presentation']) await ready(page, p);
    for (const p of ['/api/v1/repository', '/api/v1/register', '/api/v1/queue', '/api/v1/version', '/api/v1/review/next']) expect((await request.get(p)).status(), p).toBe(200);
    expect((await request.post('/api/v1/refresh')).ok()).toBe(true);
    expect(fingerprint()).toEqual(before);
  });
});
