import { useEffect, useState } from 'react';
import { useHighlight } from '../../lib/use-highlight';
import { ChevronDown, ChevronRight, Pause, OctagonAlert, X, PenLine } from 'lucide-react';
import { useReplayState } from '../../stores/replay-store';
import { hhmm } from '../../lib/replay';
import { useBreakpointsStore } from '../../stores/breakpoints-store';
import { useAwarenessStore } from '../../stores/awareness-store';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';
import { ago, sideLabel } from '../../lib/awareness-view';
import { hitHeadline, hitWhy, decisionLabels, breakpointLabel, agentName, changedLines } from '../../lib/breakpoint-view';
import { proposalWhere, evidenceWords, repliesLine, impactLabel, impactWho } from '@shared/lib/proposal-words';
import { SIGNAL_BREAK_KINDS, type BreakpointHit, type BreakpointDecision } from '@shared/types';

/**
 * Breakpoints in the inbox (Phase 32 B4.3, observability doc §10.2): the
 * agent calls waiting on the person, first; then what is set, with the rules
 * on serious signals.
 *
 * A pause says what the agent wanted and why it waits; a breach says what
 * already happened and that it could not be stopped. Either is answered
 * continue, continue with a note the agent reads, or stop.
 *
 * A proposed spec change (B7.4) waits here too, as its own card: what would
 * change and why, what each relying plan said, and Accept, Amend or Reject.
 */

const REFRESH_MS = 30_000;

/**
 * Keeps the breakpoints store current and returns how many calls wait on
 * the person. Mounted by `PlanPanel` whether or not the tab is open.
 */
export function useBreakpointsFeed(): number {
  const root = useProjectStore((s) => s.root);
  const refresh = useBreakpointsStore((s) => s.refresh);
  const waiting = useBreakpointsStore((s) => s.waiting.length);
  useEffect(() => {
    if (!root) return;
    const run = () => { void refresh(); };
    run();
    window.addEventListener('breakpoints-changed', run);
    const id = setInterval(run, REFRESH_MS);
    return () => { window.removeEventListener('breakpoints-changed', run); clearInterval(id); };
  }, [root, refresh]);
  return root ? waiting : 0;
}

function Heading({ title, count }: { title: string; count: number }) {
  return (
    <span className="text-[9px] uppercase tracking-wider text-foreground-subtle">
      {title} <span className="text-foreground-muted">{count}</span>
    </span>
  );
}

/** The calls waiting on the person: the top of the inbox. Nothing when none wait. */
export function BreakpointsWaiting({ now: liveNow }: { now: number }) {
  const live = useBreakpointsStore((s) => s.waiting);
  const storeError = useBreakpointsStore((s) => s.error);
  // B5.3: while replaying, what was waiting at the cursor's moment, read-only.
  const replay = useReplayState();
  const waiting = replay ? replay.waiting : live;
  const error = replay ? null : storeError;
  const now = replay ? replay.at : liveNow;
  if (waiting.length === 0 && !error) return null;
  return (
    <section data-testid="breakpoints-waiting">
      <div className="mb-1"><Heading title="Waiting on you" count={waiting.length} /></div>
      {error && (
        <div role="alert" className="text-[10px] text-danger px-1 mb-1">Could not refresh the breakpoints ({error}). What is shown may be out of date.</div>
      )}
      <div className="space-y-1.5">
        {waiting.map((h) => (h.kind === 'proposal'
          ? <ProposalCard key={h.ref} hit={h} now={now} replayed={!!replay} />
          : <WaitingCard key={h.ref} hit={h} now={now} replayed={!!replay} />))}
      </div>
    </section>
  );
}

function WaitingCard({ hit, now, replayed = false }: { hit: BreakpointHit; now: number; replayed?: boolean }) {
  const pointed = useHighlight('breakpoint', hit.ref);
  const answer = useBreakpointsStore((s) => s.answer);
  const workstreams = useAwarenessStore((s) => s.workstreams);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = decisionLabels(hit);
  const where = hit.workstreamRoot ? sideLabel(hit.workstreamRoot, workstreams) : null;
  // A plan document changed on disk (B7.5b): no agent is waiting to read a note.
  const disk = hit.action === 'disk';

  const act = async (decision: BreakpointDecision) => {
    setBusy(true);
    const err = await answer(hit.ref, decision, note.trim() || undefined);
    setBusy(false);
    setError(err);
    if (err) useToastStore.getState().addToast({ type: 'error', title: 'Could not answer the breakpoint', message: err });
  };

  const edge = hit.breach ? 'border-l-danger/70' : 'border-l-warning/70';
  return (
    <div ref={pointed.ref} data-testid="breakpoint-waiting" data-ref={hit.ref} data-breach={hit.breach ? 'true' : 'false'}
      data-highlighted={pointed.highlighted ? 'true' : undefined}
      className={`rounded-md border border-border-subtle border-l-2 ${edge} bg-surface/40 px-2.5 py-2${pointed.ring}`}>
      <div className="flex items-center gap-1.5">
        {hit.breach
          ? <span className="flex items-center gap-1 text-[8px] uppercase font-semibold px-1 rounded bg-danger/15 text-danger"><OctagonAlert size={9} /> Breach</span>
          : <span className="flex items-center gap-1 text-[8px] uppercase font-semibold px-1 rounded bg-warning-muted/40 text-warning"><Pause size={9} /> {disk ? 'Held' : 'Paused'}</span>}
        <span className="ml-auto text-[9px] text-foreground-subtle" title={new Date(hit.hitAt).toLocaleString()}>
          {hit.breach ? 'seen' : 'waiting since'} {ago(hit.hitAt, now)}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-foreground leading-snug">{hitHeadline(hit, where)}</div>
      <div className="mt-0.5 text-[10px] text-foreground-muted leading-snug" data-testid="breakpoint-why">{hitWhy(hit)}</div>
      {hit.breakpointNote && (
        <div className="mt-1 pl-2 border-l border-accent/30 text-[10px] text-foreground-subtle">
          Your note on the breakpoint: <span className="italic text-foreground-muted">&ldquo;{hit.breakpointNote}&rdquo;</span>
        </div>
      )}
      {hit.diskChange && <DiskChange change={hit.diskChange} />}
      {replayed ? (
        <div data-testid="breakpoint-replayed" className="mt-1.5 text-[10px] text-foreground-subtle">
          {hit.answeredAt
            ? `Answered later, at ${hhmm(hit.answeredAt)}: ${labels[hit.decision ?? 'continue']}${hit.note ? `, “${hit.note}”` : ''}.`
            : 'Not answered yet. Go back to live to answer it.'}
        </div>
      ) : (<>
      {!disk && <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        aria-label="A note the agent will read"
        placeholder={hit.breach ? 'A note for the agent (optional)' : 'Steer (optional): a note the agent will read'}
        className="mt-1.5 w-full text-[10px] px-2 py-1 rounded border border-border-subtle bg-background/40 text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/60"
      />}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {(disk ? ['continue', 'stop'] as const : ['continue', 'steer', 'stop'] as const).map((d) => (
          <button
            key={d}
            onClick={() => act(d)}
            disabled={busy || (d === 'steer' && !note.trim())}
            title={d === 'steer' && !note.trim() ? 'Write the note first' : undefined}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${d === 'continue'
              ? 'border-accent/50 bg-accent/10 text-foreground hover:bg-accent/20'
              : 'border-border-subtle text-foreground-muted hover:text-foreground hover:bg-surface-hover'}`}
          >
            {labels[d]}
          </button>
        ))}
        {error && <span role="alert" className="text-[10px] text-danger">{error}</span>}
      </div>
      </>)}
    </div>
  );
}

/** The app's version of a plan document beside the file's (B7.5b). */
function DiskChange({ change }: { change: NonNullable<BreakpointHit['diskChange']> }) {
  const retitled = change.beforeTitle !== change.afterTitle;
  const lines = changedLines(change.before, change.after);
  const at = lines.from > 1 ? ` · from line ${lines.from}` : '';
  return (
    <div className="mt-1 grid grid-cols-1 gap-1" data-testid="disk-change">
      {retitled && (
        <div className="text-[10px] text-foreground-muted">Title: “{change.beforeTitle}” → “{change.afterTitle}”</div>
      )}
      {(lines.before || lines.after) && <>
      <div>
        <div className="text-[9px] uppercase tracking-wider text-foreground-subtle">In the app (kept){at}</div>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[10px] px-1.5 py-1 rounded bg-background/40 text-foreground-muted">{lines.before || '(empty)'}</pre>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-wider text-foreground-subtle">On disk{at}</div>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[10px] px-1.5 py-1 rounded bg-warning-muted/20 text-foreground">{lines.after || '(empty)'}</pre>
      </div>
      </>}
    </div>
  );
}

interface ProposalView {
  uid: string; pageUid: string; pageTitle: string; section: string; sectionTitle: string | null;
  beforeText: string; proposedText: string; why: string; author: string; affectedWords: string | null;
  affected: Array<{ itemUid: string }>; pageChangedSince: boolean; status: string;
  evidence: { tests?: string[]; files?: string[]; commits?: string[]; note?: string };
  impacts: Array<{ id: number; impact: 'none' | 'changes'; words: string; tasks: number | null; itemTitle: string | null; planTitle: string | null; author: string }>;
  /** A spec breakpoint the person set on the page (B7.5a): it does not hold a proposal, but its note is shown. */
  pageBreakpoint?: { id: string; note: string | null } | null;
}

const clip = (text: string) => text.replace(/\n+$/, '');

/** A proposed spec change waiting on the person (B7.4): decided here, never by an agent. */
function ProposalCard({ hit, now, replayed = false }: { hit: BreakpointHit; now: number; replayed?: boolean }) {
  const refresh = useBreakpointsStore((s) => s.refresh);
  const [p, setP] = useState<ProposalView | null>(null);
  const [amending, setAmending] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = hit.breakpointTarget;

  useEffect(() => {
    if (!uid) return;
    let live = true;
    const load = () => fetch(`/api/spec-proposals/${encodeURIComponent(uid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: ProposalView | null) => { if (live && body) setP(body); })
      .catch(() => { /* the card still shows who and when */ });
    void load();
    window.addEventListener('spec-proposals-changed', load);
    return () => { live = false; window.removeEventListener('spec-proposals-changed', load); };
  }, [uid]);

  const decide = async (decision: 'accept' | 'amend' | 'reject') => {
    if (!uid) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/spec-proposals/${encodeURIComponent(uid)}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note.trim() || undefined, ...(decision === 'amend' ? { text } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const told = (body.flagged ?? []).length;
      useToastStore.getState().addToast(decision === 'reject'
        ? { type: 'info', title: 'Proposal rejected', message: 'The page is unchanged; the proposer is told why.' }
        : { type: 'success', title: 'Spec updated', message: told ? `${told} relying ${told === 1 ? 'task is' : 'tasks are'} marked "spec changed"; their agents are told.` : 'Nothing relied on it yet.' });
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const where = p ? proposalWhere(p) : `“${hit.itemTitle ?? 'a spec page'}”`;
  const ev = p ? evidenceWords(p.evidence) : '';
  return (
    <div data-testid="proposal-waiting" data-ref={hit.ref} data-proposal={uid ?? ''}
      className="rounded-md border border-border-subtle border-l-2 border-l-violet-400/70 bg-surface/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 text-[8px] uppercase font-semibold px-1 rounded bg-violet-400/15 text-violet-200"><PenLine size={9} /> Spec change</span>
        <span className="ml-auto text-[9px] text-foreground-subtle" title={new Date(hit.hitAt).toLocaleString()}>proposed {ago(hit.hitAt, now)}</span>
      </div>
      <div className="mt-1 text-[11px] text-foreground leading-snug" data-testid="proposal-headline">
        ✎ {agentName(hit.agent)} proposes a change to {where}
      </div>
      {p && <div className="mt-0.5 text-[10px] text-foreground leading-snug">Why: {p.why}</div>}
      {p?.pageBreakpoint && (
        <div className="mt-1 pl-2 border-l border-accent/30 text-[10px] text-foreground-subtle" data-testid="proposal-guard">
          You guard this page with a breakpoint{p.pageBreakpoint.note
            ? <>: <span className="italic text-foreground-muted">&ldquo;{p.pageBreakpoint.note}&rdquo;</span></>
            : '.'}
        </div>
      )}
      {ev && <div className="text-[10px] text-foreground-subtle leading-snug">Evidence: {ev}</div>}
      {p && (
        <div className="mt-1 grid grid-cols-1 gap-1" data-testid="proposal-diff">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-foreground-subtle">Now</div>
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[10px] px-1.5 py-1 rounded bg-background/40 text-foreground-muted">{clip(p.beforeText) || '(empty)'}</pre>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-foreground-subtle">Proposed</div>
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[10px] px-1.5 py-1 rounded bg-violet-400/[0.06] text-foreground">{clip(p.proposedText)}</pre>
          </div>
        </div>
      )}
      {p && (
        <div className="mt-1 text-[10px]" data-testid="proposal-impacts">
          <div className="text-foreground-muted">
            {repliesLine(p)}
          </div>
          {p.impacts.map((i) => (
            <div key={i.id} className="flex flex-wrap gap-x-1.5 pl-2" data-testid="proposal-impact">
              <span className={`shrink-0 whitespace-nowrap ${i.impact === 'changes' ? 'text-amber-300' : 'text-emerald-300'}`}>
                {impactLabel(i)}
              </span>
              <span className="shrink-0 whitespace-nowrap text-foreground-muted">{impactWho(i)}</span>
              {i.words && <span className="text-foreground">— {i.words}</span>}
            </div>
          ))}
          {p.pageChangedSince && <div className="text-amber-300">The page has changed since this was proposed.</div>}
        </div>
      )}
      {replayed ? (
        <div data-testid="breakpoint-replayed" className="mt-1.5 text-[10px] text-foreground-subtle">
          {hit.answeredAt ? `Decided later, at ${hhmm(hit.answeredAt)}.` : 'Not decided yet. Go back to live to decide it.'}
        </div>
      ) : (<>
        {amending && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="The text as it should read"
            rows={Math.min(10, Math.max(3, text.split('\n').length))}
            className="mt-1.5 w-full font-mono text-[10px] px-2 py-1 rounded border border-accent/40 bg-background/40 text-foreground focus:outline-none focus:border-accent/60"
          />
        )}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          aria-label="A note for the proposer"
          placeholder="A note for the proposer (optional)"
          className="mt-1.5 w-full text-[10px] px-2 py-1 rounded border border-border-subtle bg-background/40 text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/60"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {amending ? (<>
            <button onClick={() => decide('amend')} disabled={busy || !text.trim()}
              className="text-[10px] px-2 py-0.5 rounded border border-accent/50 bg-accent/10 text-foreground hover:bg-accent/20 disabled:opacity-50">Accept amended</button>
            <button onClick={() => setAmending(false)} disabled={busy}
              className="text-[10px] px-2 py-0.5 rounded border border-border-subtle text-foreground-muted hover:text-foreground hover:bg-surface-hover disabled:opacity-50">Cancel</button>
          </>) : (<>
            <button onClick={() => decide('accept')} disabled={busy || !p}
              className="text-[10px] px-2 py-0.5 rounded border border-accent/50 bg-accent/10 text-foreground hover:bg-accent/20 disabled:opacity-50">Accept</button>
            <button onClick={() => { setText(p ? clip(p.proposedText) : ''); setAmending(true); }} disabled={busy || !p}
              className="text-[10px] px-2 py-0.5 rounded border border-border-subtle text-foreground-muted hover:text-foreground hover:bg-surface-hover disabled:opacity-50">Amend</button>
            <button onClick={() => decide('reject')} disabled={busy || !p}
              className="text-[10px] px-2 py-0.5 rounded border border-border-subtle text-foreground-muted hover:text-foreground hover:bg-surface-hover disabled:opacity-50">Reject</button>
          </>)}
          {error && <span role="alert" className="text-[10px] text-danger">{error}</span>}
        </div>
      </>)}
    </div>
  );
}

/** What is set: each breakpoint with Clear, and the rules on serious signals. */
export function BreakpointsSet() {
  const root = useProjectStore((s) => s.root);
  const breakpoints = useBreakpointsStore((s) => s.breakpoints);
  const setBp = useBreakpointsStore((s) => s.set);
  const clear = useBreakpointsStore((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Code and signal breakpoints belong to a project; only the opened one's are shown.
  const shown = breakpoints.filter((b) => b.kind === 'task' || b.kind === 'spec' || b.projectRoot === root);
  const rules = new Map(shown.filter((b) => b.kind === 'signal').map((b) => [b.target, b.id]));

  const run = async (p: Promise<string | null>) => {
    setBusy(true);
    const err = await p;
    setBusy(false);
    setError(err);
  };

  return (
    <section data-testid="breakpoints-set">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 mb-1 hover:text-foreground" aria-expanded={open}>
        {open ? <ChevronDown size={11} className="text-foreground-subtle" /> : <ChevronRight size={11} className="text-foreground-subtle" />}
        <Heading title="Breakpoints" count={shown.length} />
      </button>
      {open && (
        <div className="space-y-1.5 pl-1">
          <div data-testid="breakpoint-signal-rules" className="flex flex-wrap items-center gap-2 text-[10px] text-foreground-muted">
            <span>Ask me when there is a serious</span>
            {SIGNAL_BREAK_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rules.has(k)}
                  disabled={busy}
                  onChange={() => run(rules.has(k) ? clear(rules.get(k)!) : setBp({ kind: 'signal', signal: k }))}
                />
                {k}
              </label>
            ))}
            <span className="text-foreground-subtle">signal</span>
          </div>
          {shown.length === 0 && (
            <div className="text-[10px] text-foreground-subtle">
              None set. Set one on a task in its Routing panel, on a file or function by right-clicking it in the graph, or tick a kind of signal above.
            </div>
          )}
          {shown.filter((b) => b.kind !== 'signal').map((b) => {
            const { what, when } = breakpointLabel(b);
            return (
              <div key={b.id} data-testid="breakpoint-set" className="flex items-center gap-2 text-[10px]">
                <Pause size={10} className="text-warning shrink-0" />
                <span className="text-foreground truncate" title={b.target}>{what}</span>
                <span className="text-foreground-subtle truncate">{when}</span>
                <button
                  onClick={() => run(clear(b.id))}
                  disabled={busy}
                  aria-label={`Clear the breakpoint on ${what}`}
                  className="ml-auto flex items-center gap-0.5 px-1.5 py-px rounded border border-border-subtle text-foreground-muted hover:text-foreground hover:bg-surface-hover disabled:opacity-50"
                >
                  <X size={9} /> Clear
                </button>
              </div>
            );
          })}
          {error && <div role="alert" className="text-[10px] text-danger">{error}</div>}
        </div>
      )}
    </section>
  );
}
