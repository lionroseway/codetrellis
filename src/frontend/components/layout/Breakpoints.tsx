import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Pause, OctagonAlert, X } from 'lucide-react';
import { useReplayState } from '../../stores/replay-store';
import { useBreakpointsStore } from '../../stores/breakpoints-store';
import { useAwarenessStore } from '../../stores/awareness-store';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';
import { ago, sideLabel } from '../../lib/awareness-view';
import { hitHeadline, hitWhy, decisionLabels, breakpointLabel } from '../../lib/breakpoint-view';
import { SIGNAL_BREAK_KINDS, type BreakpointHit, type BreakpointDecision } from '@shared/types';

/**
 * Breakpoints in the inbox (Phase 32 B4.3, observability doc §10.2): the
 * agent calls waiting on the person, first; then what is set, with the rules
 * on serious signals.
 *
 * A pause says what the agent wanted and why it waits; a breach says what
 * already happened and that it could not be stopped. Either is answered
 * continue, continue with a note the agent reads, or stop.
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
        {waiting.map((h) => <WaitingCard key={h.ref} hit={h} now={now} replayed={!!replay} />)}
      </div>
    </section>
  );
}

function WaitingCard({ hit, now, replayed = false }: { hit: BreakpointHit; now: number; replayed?: boolean }) {
  const answer = useBreakpointsStore((s) => s.answer);
  const workstreams = useAwarenessStore((s) => s.workstreams);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = decisionLabels(hit);
  const where = hit.workstreamRoot ? sideLabel(hit.workstreamRoot, workstreams) : null;

  const act = async (decision: BreakpointDecision) => {
    setBusy(true);
    const err = await answer(hit.ref, decision, note.trim() || undefined);
    setBusy(false);
    setError(err);
    if (err) useToastStore.getState().addToast({ type: 'error', title: 'Could not answer the breakpoint', message: err });
  };

  const edge = hit.breach ? 'border-l-danger/70' : 'border-l-warning/70';
  return (
    <div data-testid="breakpoint-waiting" data-ref={hit.ref} data-breach={hit.breach ? 'true' : 'false'}
      className={`rounded-md border border-border-subtle border-l-2 ${edge} bg-surface/40 px-2.5 py-2`}>
      <div className="flex items-center gap-1.5">
        {hit.breach
          ? <span className="flex items-center gap-1 text-[8px] uppercase font-semibold px-1 rounded bg-danger/15 text-danger"><OctagonAlert size={9} /> Breach</span>
          : <span className="flex items-center gap-1 text-[8px] uppercase font-semibold px-1 rounded bg-warning-muted/40 text-warning"><Pause size={9} /> Paused</span>}
        <span className="ml-auto text-[9px] text-foreground-subtle" title={new Date(hit.hitAt).toLocaleString()}>
          {hit.breach ? 'seen' : 'waiting since'} {ago(hit.hitAt, now)}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-foreground leading-snug">{hitHeadline(hit, where)}</div>
      <div className="mt-0.5 text-[10px] text-foreground-muted leading-snug">{hitWhy(hit)}</div>
      {hit.breakpointNote && (
        <div className="mt-1 pl-2 border-l border-accent/30 text-[10px] text-foreground-subtle">
          Your note on the breakpoint: <span className="italic text-foreground-muted">&ldquo;{hit.breakpointNote}&rdquo;</span>
        </div>
      )}
      {replayed ? (
        <div data-testid="breakpoint-replayed" className="mt-1.5 text-[10px] text-foreground-subtle">
          {hit.answeredAt
            ? `Answered later, at ${new Date(hit.answeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${labels[hit.decision ?? 'continue']}${hit.note ? `, “${hit.note}”` : ''}.`
            : 'Not answered yet. Go back to live to answer it.'}
        </div>
      ) : (<>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        aria-label="A note the agent will read"
        placeholder={hit.breach ? 'A note for the agent (optional)' : 'Steer (optional): a note the agent will read'}
        className="mt-1.5 w-full text-[10px] px-2 py-1 rounded border border-border-subtle bg-background/40 text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/60"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {(['continue', 'steer', 'stop'] as const).map((d) => (
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
