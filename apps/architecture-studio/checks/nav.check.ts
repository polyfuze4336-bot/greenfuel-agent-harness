import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NAV, SECTION_TABS, isActive, tabActive, tabsFor } from '../src/components/shell/nav.ts';

describe('navigation model', () => {
  it('has exactly four primary destinations, each with a distinct address and go-to key', () => {
    assert.deepEqual(NAV.map((n) => n.label), ['Overview', 'Decisions', 'Changes', 'Presentation']);
    assert.equal(new Set(NAV.map((n) => n.href)).size, 4);
    assert.equal(new Set(NAV.map((n) => n.key)).size, 4);
    assert.ok(NAV.every((n) => /^[a-z]$/.test(n.key) && n.key !== 'g'), 'g is the prefix, so no destination can use it');
  });

  it('keeps a destination current on its own pages and its sub-pages, and on nothing else', () => {
    const d = NAV.find((n) => n.label === 'Decisions')!;
    const c = NAV.find((n) => n.label === 'Changes')!;
    for (const p of ['/decisions', '/decisions/ADR-0004', '/decisions/ADR-0004/review', '/queue', '/queue/blocking', '/architecture']) assert.equal(isActive(p, d), true, p);
    for (const p of ['/changes', '/approvals', '/baseline']) assert.equal(isActive(p, c), true, p);
    assert.equal(isActive('/approvals', d), false);
    assert.equal(isActive('/decisions', c), false);
    assert.equal(isActive('/decisionsX', d), false, 'a prefix match must respect the path boundary');
    const o = NAV.find((n) => n.label === 'Overview')!;
    assert.equal(isActive('/', o), true);
    assert.equal(isActive('/decisions', o), false);
  });

  it('every page that is part of a destination is covered by exactly one destination', () => {
    const pages = Object.values(SECTION_TABS).flat().map((t) => t.href);
    for (const p of pages) assert.equal(NAV.filter((n) => isActive(p, n)).length, 1, p);
  });

  it('shows section tabs on the pages themselves, never on a single record or on the home page', () => {
    assert.equal(tabsFor('/decisions')?.section, '/decisions');
    assert.equal(tabsFor('/queue')?.section, '/decisions');
    assert.equal(tabsFor('/queue/blocking')?.section, '/decisions');
    assert.equal(tabsFor('/approvals')?.section, '/changes');
    assert.equal(tabsFor('/baseline')?.section, '/changes');
    for (const p of ['/', '/presentation', '/decisions/ADR-0004', '/decisions/ADR-0004/review', '/access']) assert.equal(tabsFor(p), null, p);
  });

  it('marks exactly one tab current, and the blocking view belongs to the work queue tab', () => {
    for (const [section, tabs] of Object.entries(SECTION_TABS)) {
      for (const t of tabs) assert.equal(tabs.filter((x) => tabActive(t.href, x)).length, 1, `${section} ${t.href}`);
    }
    const q = SECTION_TABS['/decisions']!.find((t) => t.label === 'Work queue')!;
    assert.equal(tabActive('/queue/blocking', q), true);
  });
});
