import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { GitRepositoryAdapter } from '../src/lib/repo/git.ts';
import { buildModel } from '../src/lib/repo/build.ts';
import { rowMatches, toRow } from '../src/lib/intel/row.ts';
import type { StudioModel } from '../src/lib/repo/types.ts';

let model: StudioModel;
before(() => {
  model = buildModel(new GitRepositoryAdapter(GitRepositoryAdapter.findRoot(process.cwd()), 'HEAD').open());
});

// The search the register had before rows existed: every typed word must appear in this text. Kept here as the specification.
const oldHay = (d: StudioModel['register']['records'][number]) =>
  `${d.id} ${d.title} ${d.description ?? ''} ${d.businessJustification ?? ''} ${d.decisionOwner ?? ''} ${d.statusRaw} ${d.milestone ?? ''} ${d.category ?? ''} ${d.options.map((o) => o.name).join(' ')}`.toLowerCase();
const oldMatches = (d: StudioModel['register']['records'][number], text: string) => !text || text.split(/\s+/).every((t) => oldHay(d).includes(t));

describe('decision rows (B3)', () => {
  it('searching rows finds exactly the decisions the full records would', () => {
    const queries = ['', 'sovereignty', 'adr-0016', 'quality manager', 'residency port', 'm1', 'zzzzqqqq', 'cell jurisdiction', 'programme owner approve'];
    for (const q of queries) {
      const a = model.register.records.filter((d) => oldMatches(d, q)).map((d) => d.id);
      const b = model.register.records.map(toRow).filter((r) => rowMatches(r, q)).map((r) => r.id);
      assert.deepEqual(b, a, `query "${q}"`);
    }
  });

  it('keeps what the table, the filters and the group-by need', () => {
    for (const d of model.register.records) {
      const r = toRow(d);
      assert.equal(r.id, d.id);
      assert.equal(r.status, d.status);
      assert.equal(r.priority, d.priority?.value ?? null);
      assert.equal(r.flagged, d.flags.length > 0);
      assert.equal(r.hasMissing, d.missing.length > 0);
      assert.deepEqual(r.relatedReviews, d.relatedReviews);
      assert.equal(r.source.path, d.source.path);
    }
  });

  it('is far smaller than the full records, which is the point', () => {
    const full = JSON.stringify(model.register.records).length;
    const rows = JSON.stringify(model.register.records.map(toRow)).length;
    assert.ok(rows < full / 3, `rows ${rows} bytes against ${full} bytes of full records`);
    assert.ok(rows < 150 * 1024, `rows are ${Math.round(rows / 1024)} KB`);
  });

  it('carries no pros, cons, options, field sources or citations', () => {
    const keys = new Set(Object.keys(toRow(model.register.records[0]!)));
    for (const heavy of ['options', 'fieldSources', 'citedBy', 'implications', 'comparison', 'recommendedOption', 'approvalHistory', 'evidence']) assert.ok(!keys.has(heavy), `row has ${heavy}`);
  });
});
