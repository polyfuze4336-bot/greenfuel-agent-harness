'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, GitCompare, ListChecks, SearchCheck } from 'lucide-react';
import Link from 'next/link';
import { useQueryState } from '@/lib/use-query-state.ts';
import { layoutColumns } from '@/lib/queue/layout.ts';
import type { RequirementImpactReport } from '@/lib/queue/snapshot.ts';
import { Sheet } from '../explorer-kit.tsx';
import { Card, EmptyState, Section, Tag, btn, btnPrimary } from '../ui.tsx';
import { ItemSheet } from './item-sheet.tsx';
import { api, useQueue, type QueueData } from './queue-data.tsx';
import { QueueError, QueueLoading, QueueTabs, SourceStrip } from './queue-frame.tsx';
import { PriorityTag, WorkStatusPill } from './work-bits.tsx';

type BlockNode = QueueData['blocking']['nodes'][number];

export function BlockingView() {
  const { data, session, error, loading, reload, signIn } = useQueue();
  const qs = useQueryState();
  const selectedId = qs.get('id');
  const open = (id: string) => qs.set({ id }, 'push');

  if (error && !data) return <QueueError message={error} onRetry={() => void reload()} />;
  if (loading || !data) return <QueueLoading />;

  const items = new Map(data.items.map((i) => [i.id, i]));
  const { analysis } = data.blocking;
  const readyIds = new Set(analysis.ready.map((r) => r.id));
  const waiting = analysis.blockers.filter((b) => !readyIds.has(b.id));
  const selected = selectedId ? items.get(selectedId) : undefined;
  const evidenceGaps = data.items.filter((i) => i.class === 'evidence-gap');
  const idLink = (id: string) => (
    <button type="button" onClick={() => open(id)} className="rounded-md border border-hairline bg-surface-2 px-1.5 py-px font-mono text-[11.5px] leading-5 text-ink-2 hover:bg-hairline/60">
      {id}
    </button>
  );

  return (
    <div>
      <QueueTabs />
      <SourceStrip data={data} />

      <Card className="mb-8 p-5" data-testid="blocking-summary">
        {analysis.unresolvedCount === 0 ? (
          <p className="text-[15px] leading-6">The repository records no unresolved work that the build requires. This is not a decision to start the build: the build still needs the owner’s approval.</p>
        ) : (
          <p className="text-[15px] leading-6">
            <span className="font-semibold tnum" data-testid="blocking-count">{analysis.unresolvedCount}</span> unresolved items stand between the repository and the application build.{' '}
            <span className="font-semibold tnum" data-testid="ready-count">{analysis.ready.length}</span> of them can be worked on now because nothing they depend on is still open. The other <span className="tnum">{waiting.length}</span> wait for those.
          </p>
        )}
        <p className="mt-2 text-[12.5px] leading-5 text-ink-3">
          The build waits on every build blocker the repository records, and on the work each one is stated to require. Work that is Done, Rejected or Superseded is no longer waited on. “Closed, no evidence” still blocks, because a claim of closure is not evidence. Starting the build also needs the owner’s approval under rule HC-11; resolving this list does not grant it.
          {analysis.cycles.length ? ` ${analysis.cycles.length} circular dependenc${analysis.cycles.length === 1 ? 'y was' : 'ies were'} found in the sources.` : ' No circular dependency was found.'}
        </p>
      </Card>

      <Section title="Work you can start now" aside={<span className="text-[12.5px] text-ink-3">Ordered by how much of the chain each item unlocks</span>}>
        {analysis.ready.length === 0 ? (
          <Card>
            <EmptyState icon={ListChecks} title="Nothing is ready to start">Every unresolved blocker waits for another one that is still open.</EmptyState>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ol data-testid="ready-list" className="divide-y divide-hairline">
              {analysis.ready.map((b) => {
                const i = items.get(b.id);
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3" data-testid="ready-item">
                    <Tag>{b.id}</Tag>
                    <button type="button" onClick={() => open(b.id)} className="min-w-0 flex-1 text-left text-[14px] font-medium hover:underline">
                      <span className="clamp-1">{i?.title ?? b.id}</span>
                    </button>
                    {i ? <PriorityTag priority={i.priority} /> : null}
                    {i ? <WorkStatusPill status={i.status} /> : null}
                    <span className="w-[92px] text-right text-[12.5px] text-ink-3 tnum">{b.unlocks ? `unlocks ${b.unlocks}` : 'unlocks none'}</span>
                  </li>
                );
              })}
            </ol>
          </Card>
        )}
      </Section>

      <Section title="Waiting on other work">
        {waiting.length === 0 ? (
          <p className="text-[13.5px] text-ink-3">No blocker is waiting on another.</p>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]" data-testid="waiting-table">
              <caption className="sr-only">Blockers that wait for other unresolved work</caption>
              <thead className="border-b border-hairline bg-surface-2 text-[12px] text-ink-3">
                <tr>
                  <th scope="col" className="w-[92px] py-2.5 pl-5 font-medium">ID</th>
                  <th scope="col" className="py-2.5 font-medium">Item</th>
                  <th scope="col" className="py-2.5 pr-5 font-medium">Waiting for</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {waiting.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2.5 pl-5 align-top"><Tag>{b.id}</Tag></td>
                    <td className="py-2.5 pr-4 align-top">
                      <button type="button" onClick={() => open(b.id)} className="text-left font-medium hover:underline">
                        <span className="clamp-1">{items.get(b.id)?.title ?? b.id}</span>
                      </button>
                    </td>
                    <td className="py-2.5 pr-5 align-top">
                      <span className="flex flex-wrap gap-1.5">{b.waitingFor.map((w) => <span key={w}>{idLink(w)}</span>)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>

      <Section title="Dependency graph" aside={<span className="text-[12.5px] text-ink-3">Left to right: what must be done first, leading to the build</span>}>
        <Graph nodes={data.blocking.nodes} edges={data.blocking.edges} open={open} />
      </Section>

      <Section title="Decisions that change what is blocked">
        {data.impacts.length === 0 ? (
          <Card>
            <EmptyState icon={SearchCheck} title="No decision is rejected or deferred as critical">
              A rejected decision flags the work that requires it for review. A critical decision that is deferred blocks the work that requires it. Neither is happening in the repository now.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="impact-list">
            {data.impacts.map((im) => (
              <Card key={im.decisionId} className="p-4">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                  {idLink(im.decisionId)}
                  <span className="text-ink-2">{im.rule === 'rejected' ? 'is rejected' : 'is critical and deferred'}</span>
                  <span className="clamp-1 font-normal text-ink-3">{items.get(im.decisionId)?.title}</span>
                </p>
                <p className="mt-1 text-[13px] text-ink-2">{im.note}</p>
                <div className="mt-2 grid gap-3 text-[13px] sm:grid-cols-2">
                  <div>
                    <p className="text-[12.5px] text-ink-3">{im.rule === 'rejected' ? 'Work that requires it' : 'Work that must stay blocked'}</p>
                    <span className="flex flex-wrap gap-1.5">{(im.rule === 'rejected' ? im.requiring.map((d) => d.id) : im.mustRemainBlocked).map((x) => <span key={x}>{idLink(x)}</span>)}</span>
                    {(im.rule === 'rejected' ? im.requiring.length : im.mustRemainBlocked.length) === 0 ? <span className="text-ink-3">none</span> : null}
                  </div>
                  <div>
                    <p className="text-[12.5px] text-ink-3">{im.rule === 'rejected' ? 'Work that only mentions it (may be affected)' : 'Other work that requires it'}</p>
                    <span className="flex flex-wrap gap-1.5">
                      {(im.rule === 'rejected' ? im.mentioning.map((d) => d.id) : im.requiring.map((d) => d.id).filter((x) => !im.mustRemainBlocked.includes(x))).slice(0, 14).map((x) => <span key={x}>{idLink(x)}</span>)}
                    </span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Requirement changes">
        <RequirementCheck data={data} open={open} />
      </Section>

      <Section title="Capstone rubric evidence gaps">
        <Card className="p-5" data-testid="evidence-gap-note">
          <p className="text-[14px] leading-6">
            <span className="font-semibold tnum">{evidenceGaps.length}</span> items are evidence the capstone rubric asks for that the repository does not yet hold. They are not engineering tasks, so they are kept out of the build-blocking chain and out of “All tasks”.
          </p>
          <p className="mt-2 text-[12.5px] leading-5 text-ink-3">The official rubric file is not in the workspace. These are read from the repository’s own rubric traceability, which is its record of the rubric, so their wording should be checked against the rubric itself.</p>
          <Link href="/queue?view=evidence" className={`${btn} mt-3`}>
            Open the evidence gaps
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Card>
      </Section>

      <Sheet open={!!selected} onClose={() => qs.set({ id: null })} title={selected ? selected.id : 'Work item'}>
        {selected ? <ItemSheet id={selected.id} data={data} session={session} onChanged={() => void reload()} onSignIn={signIn} onOpen={open} /> : null}
      </Sheet>
    </div>
  );
}

function Graph({ nodes, edges, open }: { nodes: BlockNode[]; edges: QueueData['blocking']['edges']; open: (id: string) => void }) {
  const [focus, setFocus] = useState<string | null>(null);
  const layout = useMemo(() => layoutColumns(nodes.map((n) => ({ id: n.id, depth: n.depth, unlocks: n.unlocks }))), [nodes]);
  const at = useMemo(() => new Map(layout.nodes.map((p) => [p.id, p])), [layout]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const pad = 8;
  const touching = (e: { from: string; to: string }) => focus !== null && (e.from === focus || e.to === focus);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-auto p-4" tabIndex={0} role="region" aria-label="Dependency graph. Scroll to pan. Each box is a work item; press Enter to open it.">
        <svg data-testid="dependency-graph" width={layout.width + pad * 2} height={layout.height + pad * 2} viewBox={`${-pad} ${-pad} ${layout.width + pad * 2} ${layout.height + pad * 2}`} className="block">
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
            </marker>
          </defs>
          <g fill="none" className="text-ink-3">
            {edges.map((e) => {
              const a = at.get(e.to);
              const b = at.get(e.from);
              if (!a || !b) return null;
              const x1 = a.x + layout.nodeW;
              const y1 = a.y + layout.nodeH / 2;
              const x2 = b.x;
              const y2 = b.y + layout.nodeH / 2;
              const mid = (x1 + x2) / 2;
              const hot = touching(e);
              return <path key={`${e.from}>${e.to}`} d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2 - 2} ${y2}`} stroke="currentColor" strokeWidth={hot ? 2 : 1} opacity={focus === null ? 0.35 : hot ? 1 : 0.08} markerEnd={hot ? 'url(#arrow)' : undefined} />;
            })}
          </g>
          {nodes.map((n) => {
            const p = at.get(n.id);
            if (!p) return null;
            const isBuild = n.kind === 'build';
            const label = isBuild ? 'BUILD' : n.id;
            const title = isBuild ? 'Start of the application build' : n.title;
            const shown = title.length > 31 ? `${title.slice(0, 30)}…` : title;
            return (
              <g
                key={n.id}
                role={isBuild ? 'img' : undefined}
                aria-label={isBuild ? `BUILD ${shown}. It waits for every item to its left.` : undefined}
                data-testid="graph-node"
                data-id={n.id}
                data-ready={n.ready ? '1' : '0'}
                transform={`translate(${p.x} ${p.y})`}
                onMouseEnter={() => setFocus(n.id)}
                onMouseLeave={() => setFocus(null)}
                className="[&:has(:focus-visible)>rect:first-child]:stroke-[var(--accent)] [&:has(:focus-visible)>rect:first-child]:stroke-[2.5]"
              >
                <rect width={layout.nodeW} height={layout.nodeH} rx={10} fill={isBuild ? 'var(--navy)' : 'var(--surface)'} stroke={n.ready ? 'var(--accent)' : 'var(--hairline-strong)'} strokeWidth={n.ready ? 1.75 : 1} />
                <text aria-hidden x={12} y={19} fontSize={12} fontWeight={600} fontFamily="ui-monospace, monospace" fill={isBuild ? '#fff' : 'var(--ink)'}>
                  {label}
                </text>
                <text aria-hidden x={12} y={35} fontSize={11.5} fill={isBuild ? 'rgba(255,255,255,.8)' : 'var(--ink-2)'}>
                  {shown}
                </text>
                {!isBuild && n.ready ? (
                  <text aria-hidden x={layout.nodeW - 12} y={19} fontSize={10.5} fontWeight={600} textAnchor="end" fill="var(--accent)">
                    READY
                  </text>
                ) : null}
                {isBuild ? null : (
                  // The one interactive element: a transparent box over the node, so its name is not compared with the drawn text.
                  <rect
                    role="button"
                    tabIndex={0}
                    data-testid="graph-hit"
                    aria-label={`${n.id} ${n.title}. ${n.ready ? 'Ready to start.' : 'Waiting on other work.'} Unlocks ${n.unlocks}.`}
                    width={layout.nodeW}
                    height={layout.nodeH}
                    rx={10}
                    fill="transparent"
                    className="cursor-pointer outline-none"
                    onFocus={() => setFocus(n.id)}
                    onBlur={() => setFocus(null)}
                    onClick={() => open(n.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open(n.id);
                      }
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="border-t border-hairline px-5 py-3 text-[12.5px] leading-5 text-ink-3">
        An outlined box is ready to start. Hover or focus a box to follow its dependencies. Arrows point from the work that must come first to the work that needs it.
        {focus && byId.get(focus) ? <span className="ml-1 font-mono text-ink-2">{focus}</span> : null}
      </div>
      <details className="border-t border-hairline px-5 py-3">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-2">The same graph as a list ({edges.length} dependencies)</summary>
        <ul data-testid="edge-list" className="mt-2 max-h-72 space-y-1 overflow-y-auto text-[13px]">
          {edges.map((e) => (
            <li key={`${e.from}>${e.to}`} className="flex flex-wrap items-baseline gap-x-2">
              <button type="button" className="font-mono text-[12px] hover:underline" onClick={() => e.from !== 'BUILD' && open(e.from)}>
                {e.from}
              </button>
              <span className="text-ink-3">requires</span>
              <button type="button" className="font-mono text-[12px] hover:underline" onClick={() => open(e.to)}>
                {e.to}
              </button>
              <span className="text-ink-3">· {e.basis}</span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function RequirementCheck({ data, open }: { data: QueueData; open: (id: string) => void }) {
  const [from, setFrom] = useState(data.canonical.ref);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RequirementImpactReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const check = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    const r = await api<RequirementImpactReport>(`/api/v1/queue/requirements?from=${encodeURIComponent(from.trim())}`);
    setBusy(false);
    if (r.ok && r.body) setResult(r.body);
    else setErr(r.body?.detail ?? `HTTP ${r.status}`);
  };
  return (
    <Card className="p-5" data-testid="requirement-check">
      <p className="text-[13.5px] leading-6 text-ink-2">Compare the requirements now with an earlier branch, tag or commit. A decision that a changed requirement directly touches is flagged for review. Nothing is changed and unrelated work is left alone.</p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (from.trim() && !busy) void check();
        }}
      >
        <label className="text-[13px] font-medium">
          Compare against
          <input value={from} onChange={(e) => setFrom(e.target.value)} spellCheck={false} className="mt-1 block h-9 w-[280px] max-w-full rounded-lg border border-hairline-strong bg-surface px-3 font-mono text-[13px]" />
        </label>
        <button type="submit" className={btnPrimary} disabled={busy || !from.trim()} aria-busy={busy}>
          <GitCompare aria-hidden className="size-4" />
          {busy ? 'Comparing…' : 'Find affected decisions'}
        </button>
      </form>
      {err ? (
        <p role="alert" className="mt-3 text-[13.5px] text-[var(--s-rejected-fg)]">
          {err}
        </p>
      ) : null}
      {result ? (
        <div className="mt-4" data-testid="requirement-result" aria-live="polite">
          {result.changes.length === 0 ? (
            <p className="text-[13.5px] text-ink-2">No requirement differs between <span className="font-mono">{result.from}</span> and the commit being read.</p>
          ) : (
            <>
              <p className="text-[13.5px] font-medium">
                {result.changes.length} requirement{result.changes.length === 1 ? '' : 's'} differ from <span className="font-mono">{result.from}</span>; {result.flagged.length} decision{result.flagged.length === 1 ? ' is' : 's are'} directly linked.
              </p>
              <ul className="mt-2 space-y-1 text-[13px]">
                {result.changes.map((c) => (
                  <li key={c.id}>
                    <Tag>{c.id}</Tag> <span className="text-ink-2">{c.change}{c.fields.length ? `: ${c.fields.join(', ')}` : ''}</span>
                  </li>
                ))}
              </ul>
              {result.flagged.length ? (
                <ul className="mt-3 space-y-1.5 text-[13px]" data-testid="flagged-decisions">
                  {result.flagged.map((f) => (
                    <li key={f.decisionId} className="flex flex-wrap items-baseline gap-2">
                      <button type="button" onClick={() => open(f.decisionId)} className="rounded-md border border-hairline bg-surface-2 px-1.5 py-px font-mono text-[11.5px] hover:bg-hairline/60">
                        {f.decisionId}
                      </button>
                      <span className="text-ink-2">review needed because {f.because.join(', ')} changed</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
