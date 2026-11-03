'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileText, Hammer, ListRestart, RefreshCcw, RotateCcw, ShieldAlert, Undo2, XCircle } from 'lucide-react';
import { useQueryState } from '@/lib/use-query-state.ts';
import type { DeckView } from '@/lib/deck/server.ts';
import type { SlideView } from '@/lib/deck/service.ts';
import { Card, EmptyState, Section, Skeleton, Tag, TonePill, btn, btnPrimary, type ToneName } from '../ui.tsx';
import { api, type SessionInfo } from '../queue/queue-data.tsx';

type Me = { login: string | null; canEdit: boolean; canApprove: boolean };
type Payload = DeckView & { me: Me };
type Problem = { detail?: string; code?: string };

const STATUS: Record<SlideView['status'], { tone: ToneName; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  approved: { tone: 'accepted', label: 'Approved' },
  rejected: { tone: 'rejected', label: 'Rejected' },
  'stale-approved': { tone: 'deferred', label: 'Approval out of date' },
  'stale-rejected': { tone: 'deferred', label: 'Rejection out of date' },
};
const TIER = { executive: 'Executive story', technical: 'Technical defence', appendix: 'Appendix' } as const;
const VISUAL_LABEL: Record<string, string> = { bars: 'Bar chart', stats: 'Key figures', table: 'Table', matrix: 'Verdict matrix', cards: 'Cards', timeline: 'Timeline', flow: 'Flow', 'trust-chain': 'Chain of trust', hero: 'Title', cells: 'Architecture', 'edge-flow': 'Data flow', autonomy: 'Autonomy ladder', topology: 'Azure topology', review: 'Review placeholder' };

const mins = (s: number) => `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
const gh = (commit: string, p: string) => `https://github.com/polyfuze4336-bot/greenfuel-agent-harness/blob/${commit}/${p}`;

export function DeckStudio() {
  const [data, setData] = useState<Payload | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const qs = useQueryState();
  const listRef = useRef<HTMLUListElement>(null);

  const load = useCallback(async () => {
    setError(null);
    const [d, s] = await Promise.all([api<Payload>('/api/v1/deck'), api<SessionInfo>('/api/v1/auth/session')]);
    if (s.ok && s.body) setSession(s.body);
    if (d.ok && d.body) setData(d.body);
    else setError(d.body?.detail ?? `The deck could not be prepared (HTTP ${d.status}).`);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (url: string, body: Record<string, unknown>, label: string) => {
      setBusy(label);
      setNotice(null);
      try {
        const r = await api<Payload & { build?: unknown }>(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-csrf': session?.csrf ?? '' }, body: JSON.stringify(body) });
        if (!r.ok) {
          setNotice({ kind: 'error', text: r.body?.detail ?? `Refused (HTTP ${r.status}).` });
          if (r.status === 409) await load();
          return false;
        }
        await load();
        return true;
      } catch {
        setNotice({ kind: 'error', text: 'The Studio server could not be reached.' });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [session?.csrf, load],
  );

  const slides = data?.model.slides ?? [];
  const tier = qs.get('tier');
  const status = qs.get('status');
  const q = qs.get('q').trim().toLowerCase();
  const shown = useMemo(() => slides.filter((s) => (!tier || s.tier === tier) && (!status || s.status === status || (status === 'stale' && s.status.startsWith('stale'))) && (!q || `${s.id} ${s.title} ${s.section}`.toLowerCase().includes(q))), [slides, tier, status, q]);
  const selectedId = qs.get('slide');
  const selected = slides.find((s) => s.id === selectedId) ?? shown[0] ?? null;

  const move = (delta: number) => {
    if (!shown.length) return;
    const i = Math.max(0, shown.findIndex((s) => s.id === selected?.id));
    const next = shown[Math.min(shown.length - 1, Math.max(0, i + delta))]!;
    qs.set({ slide: next.id }, 'replace');
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-slide="${next.id}"]`)?.focus());
  };

  if (error)
    return (
      <Card className="p-5">
        <div role="alert" data-testid="deck-error" className="flex items-start gap-3 text-[13.5px] text-[var(--s-rejected-fg)]">
          <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">The deck could not be prepared.</p>
            <p>{error}</p>
            <button type="button" className={`${btn} mt-3`} onClick={() => void load()}>
              <RefreshCcw aria-hidden className="size-3.5" />
              Retry
            </button>
          </div>
        </div>
      </Card>
    );
  if (!data)
    return (
      <div role="status" aria-busy="true" aria-label="Preparing the deck from the repository" className="space-y-4" data-testid="deck-loading">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );

  const { model, latest, me } = data;
  const t = model.totals;
  const built = !!latest;
  // A preview is the nth slide of the build, so look the slide up in the build's own order.
  const previewPos = (s: SlideView) => (latest?.slideOrder ? latest.slideOrder.indexOf(s.id) + 1 : model.reordered ? 0 : model.slides.indexOf(s) + 1);
  const previewFresh = (s: SlideView) => !!latest && previewPos(s) > 0 && latest.slideHashes[s.id] === s.contentHash;
  const orderStale = !!latest?.slideOrder && latest.slideOrder.join('|') !== model.slides.map((s) => s.id).join('|');
  const changedBy = model.slides.filter((s) => s.changedDecisions.length > 0);
  const signedIn = !!me.login;

  return (
    <div className="space-y-8" data-testid="deck-studio">
      <Card className="p-5" data-testid="deck-summary">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px] text-ink-2">
          <span>
            Generated from commit <span className="font-mono text-ink">{model.commit.slice(0, 7)}</span>
            {model.branch ? <> on <span className="font-mono text-ink">{model.branch}</span></> : null}
          </span>
          <span data-testid="count-slides"><b className="tnum text-ink">{t.slides}</b> slides, about {mins(Object.values(t.secondsByTier).reduce((a, b) => a + b, 0))} if all are shown</span>
          <span data-testid="count-approved"><b className="tnum text-ink">{t.approved}</b> approved</span>
          <span><b className="tnum text-ink">{t.draft}</b> draft</span>
          <span><b className="tnum text-ink">{t.rejected}</b> rejected</span>
          {t.stale ? <span><b className="tnum text-ink">{t.stale}</b> need review again</span> : null}
          <span data-testid="count-placeholders"><b className="tnum text-ink">{t.placeholders}</b> review placeholders</span>
        </div>
        {model.uncommitted > 0 ? <p className="mt-2 text-[12.5px] text-[var(--s-open-fg)]">{model.uncommitted} tracked files differ from this commit, so figures may not match it. A final deck needs a clean tree.</p> : null}
        {changedBy.length > 0 ? (
          <div role="status" data-testid="decision-changed-banner" className="mt-3 rounded-lg border border-[var(--s-open-fg)]/40 bg-[var(--s-open-bg)] p-3 text-[13px]">
            <p className="font-semibold text-[var(--s-open-fg)]">{changedBy.length} reviewed slide{changedBy.length === 1 ? '' : 's'} lean on a decision that has changed since the review</p>
            <p className="mt-0.5 text-ink-2">Nothing was rewritten. Each slide is shown as needing review again, and its review no longer counts until a person looks at the current version.</p>
            <ul className="mt-1.5 space-y-1">
              {changedBy.map((s) => (
                <li key={s.id} data-testid="decision-changed-row">
                  <button type="button" className="font-mono text-[12.5px] text-accent hover:underline" onClick={() => qs.set({ slide: s.id, tier: null, status: null, q: null }, 'replace')}>{s.id}</button>{' '}
                  {s.changedDecisions.map((c) => `${c.id}: ${c.was} → ${c.now}`).join('; ')}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {model.reordered ? (
          <p className="mt-2 text-[12.5px] text-ink-3" data-testid="reordered-note">
            The slide order differs from the generated one. The speaker notes still say what comes next as they were written, so read them again after moving slides.{' '}
            <button type="button" className="font-medium text-accent hover:underline disabled:opacity-50" data-testid="reset-order" disabled={!!busy || !signedIn || !me.canEdit} onClick={() => void post('/api/v1/deck/actions', { action: 'reset-order', expectedRevision: model.revision }, 'Restoring the generated order')}>
              Restore the generated order
            </button>
          </p>
        ) : null}
        {orderStale ? <p className="mt-2 text-[12.5px] text-[var(--s-open-fg)]" data-testid="order-stale">The slide order changed after the latest build, so the exported file has the old order. Build again before exporting.</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button type="button" className={btn} disabled={!!busy} onClick={() => void load()} data-testid="regenerate-outline">
            <ListRestart aria-hidden className="size-4" />
            Generate outline
          </button>
          <button type="button" className={btnPrimary} disabled={!!busy || !signedIn || !me.canEdit} onClick={() => void post('/api/v1/deck/build', { mode: 'sample' }, 'Building the sample deck')} data-testid="build-sample">
            <Hammer aria-hidden className="size-4" />
            Build sample deck
          </button>
          <button type="button" className={btn} disabled={!!busy || !signedIn || !me.canApprove} onClick={() => void post('/api/v1/deck/build', { mode: 'final' }, 'Checking the gate for a final deck')} data-testid="build-final" title="Refused, with the reasons, until the gate below is met">
            Build final deck
          </button>
          <a className={`${btn} ${built ? '' : 'pointer-events-none opacity-50'}`} href={built ? '/api/v1/deck/export/pptx' : undefined} aria-disabled={!built} data-testid="export-pptx">
            <Download aria-hidden className="size-4" />
            Export PowerPoint
          </a>
          <a className={`${btn} ${latest?.pdfBytes ? '' : 'pointer-events-none opacity-50'}`} href={latest?.pdfBytes ? '/api/v1/deck/export/pdf' : undefined} aria-disabled={!latest?.pdfBytes} data-testid="export-pdf">
            <FileText aria-hidden className="size-4" />
            Export PDF
          </a>
          {!signedIn ? (
            <button type="button" className={btn} onClick={() => void (session?.mode === 'entra' ? window.location.assign(`/api/v1/auth/entra/login?next=${encodeURIComponent('/presentation/deck')}`) : api('/api/v1/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(load))} data-testid="deck-signin">
              Sign in to edit and approve
            </button>
          ) : (
            <span className="text-[12.5px] text-ink-3" data-testid="deck-identity">Signed in as {me.login}{me.canApprove ? '' : me.canEdit ? ' (can edit, cannot approve)' : ' (read only)'}</span>
          )}
        </div>
        <div role="status" aria-live="polite" className="mt-3 min-h-5 text-[13px]" data-testid="deck-notice">
          {busy ? <span aria-busy="true" className="text-ink-2">{busy}…{busy.startsWith('Building') ? ' This renders with PowerPoint and takes about 20 seconds.' : ''}</span> : null}
          {notice ? <span className={notice.kind === 'error' ? 'text-[var(--s-rejected-fg)]' : 'text-[var(--s-accepted-fg)]'}>{notice.text}</span> : null}
        </div>
        {latest ? (
          <p className="mt-1 text-[12.5px] leading-5 text-ink-3" data-testid="latest-build">
            Latest build <span className="font-mono">{latest.id}</span>: <b className="text-ink-2">{latest.mode.toUpperCase()}</b>, from commit <span className="font-mono">{latest.commit.slice(0, 7)}</span>, by {latest.builtBy}; {latest.rendered ? `rendered by PowerPoint, ${latest.previews} previews` : 'not rendered'}; quality {latest.qa.errors} errors, {latest.qa.warnings} warnings. {latest.mode === 'sample' ? 'A sample is not approved for presentation.' : ''}
          </p>
        ) : (
          <p className="mt-1 text-[12.5px] text-ink-3">No deck has been built yet. A sample deck is always buildable and is marked as a sample.</p>
        )}
      </Card>

      <Section title="Can a final deck be generated?" aside={model.gate.finalAllowed ? 'All blocking items met' : `${model.gate.items.filter((i) => i.blocking && !i.met).length} blocking items unmet`}>
        <Card>
          <ul className="divide-y divide-hairline" data-testid="deck-gate">
            {model.gate.items.map((g) => (
              <li key={g.id} className="flex gap-3 px-5 py-3 text-[13.5px]" data-testid={`gate-${g.id}`} data-met={g.met}>
                {g.met ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--s-accepted-fg)]" /> : <ShieldAlert aria-hidden className={`mt-0.5 size-4 shrink-0 ${g.blocking ? 'text-[var(--s-rejected-fg)]' : 'text-[var(--s-open-fg)]'}`} />}
                <div>
                  <p className="font-medium">{g.title}{!g.blocking ? <span className="ml-2 text-[12px] font-normal text-ink-3">informational</span> : null}</p>
                  <p className="text-ink-2">{g.detail}</p>
                  {!g.met && g.hint ? <p className="text-[12.5px] text-ink-3">To meet it: {g.hint}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="Slides" aside={`${shown.length} of ${slides.length} shown`}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-[12.5px] text-ink-2">
            <span className="block">Search</span>
            <input data-testid="slide-search" className="mt-1 w-64 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13.5px]" value={qs.get('q')} onChange={(e) => qs.set({ q: e.target.value || null }, 'replace')} placeholder="Title, id or section" />
          </label>
          <label className="text-[12.5px] text-ink-2">
            <span className="block">Part of the deck</span>
            <select data-testid="filter-tier" className="mt-1 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13.5px]" value={tier} onChange={(e) => qs.set({ tier: e.target.value || null }, 'replace')}>
              <option value="">All</option>
              {Object.entries(TIER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="text-[12.5px] text-ink-2">
            <span className="block">Review status</span>
            <select data-testid="filter-status" className="mt-1 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13.5px]" value={status} onChange={(e) => qs.set({ status: e.target.value || null }, 'replace')}>
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="stale">Needs review again</option>
            </select>
          </label>
          {(tier || status || q) ? <button type="button" className={btn} onClick={() => qs.set({ tier: null, status: null, q: null }, 'replace')}>Clear filters</button> : null}
        </div>

        {shown.length === 0 ? (
          <EmptyState icon={XCircle} title="No slide matches">Change or clear the filters.</EmptyState>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <Card className="max-h-[44rem] overflow-y-auto">
              <ul
                ref={listRef}
                aria-label="Slides in deck order"
                data-testid="slide-list"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'j') (e.preventDefault(), move(1));
                  if (e.key === 'ArrowUp' || e.key === 'k') (e.preventDefault(), move(-1));
                }}
                className="divide-y divide-hairline"
              >
                {shown.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" data-slide={s.id} data-testid={`slide-${s.id}`} aria-current={selected?.id === s.id ? 'true' : undefined} onClick={() => qs.set({ slide: s.id }, 'replace')} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2 ${selected?.id === s.id ? 'bg-accent-soft' : ''}`}>
                      <span className="tnum mt-0.5 w-6 shrink-0 text-[12px] text-ink-3">{slides.indexOf(s) + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] leading-5 font-medium">{s.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                          <span className="font-mono">{s.id}</span>
                          <TonePill name={STATUS[s.status].tone}>{STATUS[s.status].label}</TonePill>
                          {s.placeholders.length ? <Tag title="This slide shows a review placeholder">placeholder</Tag> : null}
                          {s.edited ? <Tag title="Edited by a person">edited</Tag> : null}
                          {s.changedDecisions.length ? <Tag title="A decision this slide leans on changed after it was reviewed">decision changed</Tag> : null}
                        </span>
                      </span>
                      <span className="sr-only">{i + 1} of {shown.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            {selected ? <SlideDetail key={selected.id} s={selected} model={model} me={me} busy={!!busy} fresh={previewFresh(selected)} previewPos={previewPos(selected)} hasBuild={built} index={slides.indexOf(selected) + 1} post={post} onPrev={() => move(-1)} onNext={() => move(1)} /> : null}
          </div>
        )}
      </Section>

      <Section title="Rubric coverage" aside="Presentation criteria B and C">
        <Card className="overflow-x-auto">
          <table data-testid="rubric-coverage" className="w-full min-w-[640px] text-left text-[13.5px]">
            <caption className="sr-only">Which slides serve each presentation criterion</caption>
            <thead>
              <tr className="border-b border-hairline text-[11.5px] tracking-wide text-ink-3 uppercase">
                <th scope="col" className="px-4 py-2.5">Criterion</th>
                <th scope="col" className="px-3 py-2.5">Assessed by</th>
                <th scope="col" className="px-4 py-2.5">Slides that serve it</th>
              </tr>
            </thead>
            <tbody>
              {model.rubricCoverage.map((r) => (
                <tr key={r.id} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-4 py-2 font-medium">{r.id} {r.title}</th>
                  <td className="px-3 py-2 text-ink-2">{r.mode}</td>
                  <td className="px-4 py-2 text-ink-2">{r.slides.length ? r.slides.join(', ') : 'No slide: assessed live, and not verified until a person rehearses'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-3 text-[12.5px] leading-5 text-ink-3">The official rubric file is not in the repository; this uses the derived traceability. Delivery, listening and composure are not verified by a deck.</p>
      </Section>
    </div>
  );
}

function SlideDetail({ s, model, me, busy, fresh, previewPos, hasBuild, index, post, onPrev, onNext }: { s: SlideView; model: DeckView['model']; me: Me; busy: boolean; fresh: boolean; previewPos: number; hasBuild: boolean; index: number; post: (u: string, b: Record<string, unknown>, l: string) => Promise<boolean>; onPrev: () => void; onNext: () => void }) {
  const [title, setTitle] = useState(s.title);
  const [notes, setNotes] = useState(s.notes.say);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  // The script shown follows the server: after a regenerate or another person's edit it is the current one.
  useEffect(() => setNotes(s.notes.say), [s.notes.say]);
  const act = (body: Record<string, unknown>, label: string) => post('/api/v1/deck/actions', { slideId: s.id, expectedRevision: model.revision, contentHash: s.contentHash, ...body }, label);
  const signedIn = !!me.login;
  const needsAck = s.placeholders.length > 0;
  // The title slide stays first, so no slide moves into its place and it moves nowhere.
  const canEarlier = index >= 3;
  const canLater = index >= 2 && index < model.slides.length;

  return (
    <div className="min-w-0 space-y-5" data-testid="slide-detail" data-slide-id={s.id}>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-ink-3">
          <span className="font-mono text-ink-2">{s.id}</span>
          <span>Slide {index} of {model.slides.length}</span>
          <span className="inline-flex gap-1.5" role="group" aria-label="Move this slide">
            <button type="button" className={btn} data-testid="move-up" disabled={busy || !me.canEdit || !canEarlier} title={index === 1 ? 'The title slide stays first' : canEarlier ? 'Move this slide one place earlier' : 'The title slide stays first'} onClick={() => void act({ action: 'move', direction: 'up' }, 'Moving the slide')}>Move earlier</button>
            <button type="button" className={btn} data-testid="move-down" disabled={busy || !me.canEdit || !canLater} title={index === 1 ? 'The title slide stays first' : canLater ? 'Move this slide one place later' : 'This is the last slide'} onClick={() => void act({ action: 'move', direction: 'down' }, 'Moving the slide')}>Move later</button>
          </span>
          <span>{TIER[s.tier]}</span>
          <span>{s.section}</span>
          <span>about {s.seconds} s</span>
          <TonePill name={STATUS[s.status].tone}>{STATUS[s.status].label}</TonePill>
        </div>
        <label className="mt-3 block text-[12.5px] text-ink-2">
          <span className="block">Title (one message)</span>
          <div className="mt-1 flex gap-2">
            <input data-testid="title-input" maxLength={160} className="min-w-0 flex-1 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-[15px] font-medium" value={title} onChange={(e) => setTitle(e.target.value)} />
            <button type="button" className={btn} data-testid="title-save" disabled={busy || !me.canEdit || title.trim() === s.title} onClick={() => void act({ action: 'retitle', title }, 'Saving the title')}>Save title</button>
          </div>
        </label>
        <p className="mt-3 text-[13.5px] leading-6 text-ink-2">{s.message}</p>
        {s.edited ? <p className="mt-2 text-[12.5px] text-ink-3">Edited by a person from the generated version: “{s.generatedTitle}” as {VISUAL_LABEL[s.generatedVisualKind] ?? s.generatedVisualKind}.</p> : null}
      </Card>

      <Card className="p-5">
        <h3 className="text-[13px] font-semibold text-ink-2">Preview</h3>
        {hasBuild && fresh ? (
          // The preview is a rendered image of this slide in the latest build; the slide itself is built from native, editable objects.
          // eslint-disable-next-line @next/next/no-img-element
          <img data-testid="slide-preview" src={`/api/v1/deck/preview/${previewPos}?v=${s.contentHash.slice(0, 8)}`} alt={`Rendered preview of slide ${index}: ${s.title}`} className="mt-3 w-full rounded-lg border border-hairline" />
        ) : (
          <p data-testid="preview-missing" className="mt-2 text-[13px] text-ink-2">{hasBuild ? 'This slide changed after the latest build, so its preview is out of date. Build again.' : 'No preview yet. Build the sample deck to render one.'}</p>
        )}
        {s.variants.length > 1 ? (
          <fieldset className="mt-4">
            <legend className="text-[12.5px] font-medium text-ink-2">Alternative visuals</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {s.variants.map((v) => (
                <label key={v} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] ${s.visualKind === v ? 'border-accent bg-accent-soft' : 'border-hairline-strong bg-surface'}`}>
                  <input type="radio" name={`visual-${s.id}`} className="accent-[var(--accent)]" checked={s.visualKind === v} disabled={busy || !me.canEdit} onChange={() => void act({ action: 'choose-visual', visual: v }, 'Changing the visual')} />
                  {VISUAL_LABEL[v] ?? v}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-ink-3">Only conversions that lose no information are offered.</p>
          </fieldset>
        ) : null}
      </Card>

      <Card className="p-5">
        <h3 className="text-[13px] font-semibold text-ink-2">Evidence</h3>
        <ul className="mt-2 space-y-1.5 text-[13.5px]" data-testid="slide-sources">
          {s.sources.map((r) => (
            <li key={r.path} className="flex flex-wrap items-center gap-2">
              <a className="font-mono text-[12.5px] text-accent hover:underline" href={gh(model.commit, r.path)} target="_blank" rel="noreferrer">{r.path}</a>
              {r.chip ? <Tag>{r.chip}</Tag> : null}
            </li>
          ))}
        </ul>
        <h4 className="mt-4 text-[12.5px] font-semibold text-ink-2">Claims and what was checked</h4>
        <ul className="mt-1.5 space-y-1 text-[13px]" data-testid="slide-claims">
          {s.claims.map((c) => (
            <li key={c.id} className="flex gap-2" data-ok={c.ok}>
              {c.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--s-accepted-fg)]" /> : <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--s-rejected-fg)]" />}
              <span>{c.text}{!c.ok ? <span className="block text-[var(--s-rejected-fg)]">{c.problems.join(' ')}</span> : null}</span>
            </li>
          ))}
          {!s.claims.length ? <li className="text-ink-3">This slide makes no checkable claim.</li> : null}
        </ul>
        <p className="mt-1.5 text-[12px] text-ink-3">A check proves a source exists at this commit and says what the claim relies on. It does not prove the claim true; that is the reviewer&apos;s judgment.</p>
        {s.decisions.length ? (
          <>
            <h4 className="mt-4 text-[12.5px] font-semibold text-ink-2">Decisions this slide leans on (status from the register)</h4>
            <ul className="mt-1.5 flex flex-wrap gap-2 text-[13px]" data-testid="slide-decisions">
              {s.decisions.map((d) => (
                <li key={d.id} className="inline-flex items-center gap-1.5">
                  <a className="font-mono text-[12.5px] text-accent hover:underline" href={`/decisions/${d.id}`}>{d.id}</a>
                  <TonePill name={d.status === 'Approved' ? 'accepted' : d.status === 'Blocked' ? 'blocked' : 'open'}>{d.status}</TonePill>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {s.placeholders.length ? (
          <div className="mt-4 rounded-lg border border-[var(--s-open-fg)]/40 bg-[var(--s-open-bg)] p-3 text-[13px]" data-testid="slide-placeholders">
            <p className="font-semibold text-[var(--s-open-fg)]">Review placeholders: evidence the repository does not hold</p>
            <ul className="mt-1.5 space-y-1.5">
              {s.placeholders.map((p) => (
                <li key={p.id}><span className="font-mono text-[12px]">{p.id}</span> {p.what}. <span className="text-ink-2">{p.why} Needed from: {p.neededFrom}.</span></li>
              ))}
            </ul>
          </div>
        ) : null}
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-medium text-accent">Speaker notes, timing and rubric</summary>
          <div className="mt-2 space-y-2 text-[13px] leading-6 text-ink-2" data-testid="slide-notes">
            <label className="block text-[12.5px] text-ink-2">
              <span className="block">Spoken script {s.notesEdited ? <Tag title="Written by a person. The claim checks do not read it.">edited, not claim-checked</Tag> : null}</span>
              <textarea data-testid="notes-input" rows={7} maxLength={4000} className="mt-1 w-full rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-[13.5px] leading-6" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="flex flex-wrap items-center gap-2.5">
              <button type="button" className={btn} data-testid="notes-save" disabled={busy || !me.canEdit || notes.trim() === s.notes.say.trim() || notes.trim().length < 10} onClick={() => void act({ action: 'edit-notes', notes }, 'Saving the speaker notes')}>Save notes</button>
              <span className="text-[12px] text-ink-3">Saving withdraws any review of this slide. Regenerate the slide to go back to the generated script.</span>
            </div>
            {s.notes.honesty ? <p><b className="text-ink">Say plainly:</b> {s.notes.honesty}</p> : null}
            {s.notes.next ? <p><b className="text-ink">Next:</b> {s.notes.next}</p> : null}
            <p className="text-ink-3">About {s.seconds} seconds. Serves: {s.rubric.join(', ') || 'no criterion'}.</p>
          </div>
        </details>
      </Card>

      <Card className="p-5" data-testid="slide-review">
        <h3 className="text-[13px] font-semibold text-ink-2">Review</h3>
        <p className="mt-1 text-[13px] text-ink-2">
          {s.status === 'approved' ? <>Approved by <b>{s.decidedBy}</b> at this content.{s.reason ? ` Note: ${s.reason}` : ''}</> : null}
          {s.status === 'rejected' ? <>Rejected by <b>{s.decidedBy}</b>: {s.reason}</> : null}
          {s.status.startsWith('stale') ? <>A decision was recorded for an earlier version of this slide. It no longer applies; review the current version.{s.changedDecisions.length ? <span data-testid="stale-because"> Reason: {s.changedDecisions.map((c) => `${c.id} was ${c.was} and is now ${c.now}`).join('; ')}.</span> : null}</> : null}
          {s.status === 'draft' ? 'Not reviewed. This is a slide-level editorial decision, not an architecture approval; it authorizes nothing outside the deck.' : null}
        </p>
        {!signedIn ? <p className="mt-2 text-[13px] text-ink-2">Sign in above to edit or review.</p> : !me.canApprove ? <p className="mt-2 text-[13px] text-ink-2" data-testid="cannot-approve">Your role can{me.canEdit ? '' : 'not'} edit but cannot approve or reject slides.</p> : null}
        <div className="mt-3 space-y-3">
          {needsAck || rejecting ? (
            <label className="block text-[12.5px] text-ink-2">
              <span className="block">{rejecting ? 'Reason for rejecting (required)' : 'Acknowledge the placeholder (required to approve this slide)'}</span>
              <textarea data-testid="review-reason" rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-[13.5px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={rejecting ? 'What must change' : 'For example: present this as a stated gap, not a result'} />
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" className={btnPrimary} data-testid="approve" disabled={busy || !me.canApprove || s.status === 'approved'} onClick={() => void act({ action: 'approve', reason }, 'Approving the slide').then((ok) => ok && setReason(''))}>
              <CheckCircle2 aria-hidden className="size-4" />
              Approve slide
            </button>
            {rejecting ? (
              <button type="button" className={btn} data-testid="reject-confirm" disabled={busy || !me.canApprove || reason.trim().length < 5} onClick={() => void act({ action: 'reject', reason }, 'Rejecting the slide').then((ok) => ok && (setReason(''), setRejecting(false)))}>
                <XCircle aria-hidden className="size-4" />
                Confirm rejection
              </button>
            ) : (
              <button type="button" className={btn} data-testid="reject" disabled={busy || !me.canApprove || s.status === 'rejected'} onClick={() => (setRejecting(true), setReason(''))}>
                <XCircle aria-hidden className="size-4" />
                Reject slide…
              </button>
            )}
            {rejecting ? <button type="button" className={btn} onClick={() => (setRejecting(false), setReason(''))}>Cancel</button> : null}
            <button type="button" className={btn} data-testid="reset" disabled={busy || !me.canEdit || s.status === 'draft'} onClick={() => void act({ action: 'reset' }, 'Resetting the review')}>
              <Undo2 aria-hidden className="size-4" />
              Reset review
            </button>
            <button type="button" className={btn} data-testid="regenerate" disabled={busy || !me.canEdit} title="Discard edits and take the slide as the current repository sources produce it" onClick={() => void act({ action: 'regenerate' }, 'Regenerating the slide').then((ok) => ok && setTitle(s.generatedTitle))}>
              <RotateCcw aria-hidden className="size-4" />
              Regenerate slide
            </button>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 text-[12.5px]">
          <button type="button" className={btn} onClick={onPrev}>Previous</button>
          <button type="button" className={btn} onClick={onNext}>Next</button>
          <span className="text-ink-3">Arrow keys move through the list.</span>
        </div>
        {s.events.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] font-medium text-accent">History ({s.events.length})</summary>
            <ol className="mt-2 space-y-1 text-[12.5px] text-ink-2" data-testid="slide-history">
              {[...s.events].reverse().map((e, i) => (
                <li key={i}><span className="font-mono">{e.at.slice(0, 19).replace('T', ' ')}</span> {e.actor} {e.action}{e.detail ? `: ${e.detail}` : ''}</li>
              ))}
            </ol>
          </details>
        ) : null}
      </Card>
    </div>
  );
}
