import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Radar, ArrowLeftRight, ArrowRight } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useAwarenessStore } from '../../stores/awareness-store';
import { useToastStore } from '../../stores/toast-store';
import {
  groupSignals, needsYouCount, digestLine, kindWords, sidesOf, stateWords, actionsFor, ago, toldWords,
} from '../../lib/awareness-view';
import type { AwarenessSignal, SettableSignalState, Workstream } from '@shared/types';
import { UnverifiedIf } from '../UnverifiedTag';

/**
 * The Awareness tab (Phase 32 A1.8, awareness spec §7.2): what overlaps
 * between the parallel lines of work in this repository, and a person's
 * answer to each overlap.
 *
 * A digest line on top, then the signals: what needs you (open, high or
 * medium), low-priority notes, what you have seen, and what you set aside.
 * Answering moves a signal down, never away, so it can be taken back; a
 * signal leaves only when its cause does.
 */

const REFRESH_MS = 30_000;

/**
 * Keeps the awareness store current for the opened project and returns the
 * number the tab shows. Mounted by `PlanPanel` whether or not the tab is
 * open, so the count is right before anyone looks.
 */
export function useAwarenessFeed(): number {
  const root = useProjectStore((s) => s.root);
  const refresh = useAwarenessStore((s) => s.refresh);
  const signals = useAwarenessStore((s) => s.signals);

  useEffect(() => {
    const run = () => { void refresh(root); };
    run();
    window.addEventListener('awareness-changed', run);
    window.addEventListener('workstreams-changed', run);
    const id = setInterval(run, REFRESH_MS);
    return () => {
      window.removeEventListener('awareness-changed', run);
      window.removeEventListener('workstreams-changed', run);
      clearInterval(id);
    };
  }, [root, refresh]);

  return needsYouCount(signals);
}

export function AwarenessTab() {
  const root = useProjectStore((s) => s.root);
  const { workstreams, signals, loaded, error } = useAwarenessStore();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!root) {
    return <div className="text-[11px] text-foreground-subtle py-6 text-center">Open a project to see its parallel work.</div>;
  }
  if (!loaded) {
    return <div className="text-[11px] text-foreground-subtle py-6 text-center">Checking for overlaps…</div>;
  }

  const groups = groupSignals(signals);
  const digest = digestLine(workstreams, signals);

  return (
    <div data-testid="awareness-tab" className="text-[11px] space-y-3 max-w-3xl">
      <div data-testid="awareness-digest" className="flex gap-2.5 rounded-lg border border-border-subtle bg-surface/60 px-3 py-2.5">
        <Radar size={14} className={`shrink-0 mt-0.5 ${groups.needsYou.length > 0 ? 'text-warning' : 'text-foreground-subtle'}`} />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">{digest.headline}</div>
          <div className="mt-0.5 text-[10px] text-foreground-muted leading-snug">{digest.detail}</div>
        </div>
      </div>

      {error && (
        <div role="alert" className="text-[10px] text-danger px-1">
          Could not refresh the overlaps ({error}). What is shown may be out of date.
        </div>
      )}

      <Section title="Needs you" signals={groups.needsYou} workstreams={workstreams} now={now} testId="awareness-needs-you" />
      <Section title="Low priority" signals={groups.lowPriority} workstreams={workstreams} now={now} testId="awareness-low" collapsible />
      <Section title="Seen" signals={groups.seen} workstreams={workstreams} now={now} testId="awareness-seen" />
      <Section title="Set aside" signals={groups.setAside} workstreams={workstreams} now={now} testId="awareness-set-aside" collapsible />
    </div>
  );
}

function Section({ title, signals, workstreams, now, testId, collapsible = false }: {
  title: string; signals: AwarenessSignal[]; workstreams: Workstream[]; now: number; testId: string; collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  if (signals.length === 0) return null;
  const heading = (
    <span className="text-[9px] uppercase tracking-wider text-foreground-subtle">
      {title} <span className="text-foreground-muted">{signals.length}</span>
    </span>
  );
  return (
    <section data-testid={testId}>
      {collapsible ? (
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 mb-1 hover:text-foreground" aria-expanded={open}>
          {open ? <ChevronDown size={11} className="text-foreground-subtle" /> : <ChevronRight size={11} className="text-foreground-subtle" />}
          {heading}
        </button>
      ) : (
        <div className="mb-1">{heading}</div>
      )}
      {open && (
        <div className="space-y-1.5">
          {signals.map((s) => <SignalCard key={s.id} signal={s} workstreams={workstreams} now={now} />)}
        </div>
      )}
    </section>
  );
}

const SEVERITY_PILL = {
  high: 'bg-danger/15 text-danger',
  medium: 'bg-warning-muted/40 text-warning',
  low: 'bg-surface-hover text-foreground-muted',
} as const;

const SEVERITY_EDGE = {
  high: 'border-l-danger/70',
  medium: 'border-l-warning/60',
  low: 'border-l-border-subtle',
} as const;

/** Backticks in a summary mark names; shown as code. */
function Summary({ text }: { text: string }) {
  const parts = text.split('`');
  return (
    <span className="text-[11px] text-foreground leading-snug">
      {parts.map((p, i) => (i % 2 === 1
        ? <code key={i} className="font-mono text-[10px] px-1 rounded bg-surface-hover text-foreground">{p}</code>
        : <span key={i}>{p}</span>))}
    </span>
  );
}

/**
 * What a contract signal changed and where it lands (A2.3): the signature
 * before and after, or that the export went, and the other side's files
 * that import it.
 */
function ContractDetail({ subject }: { subject: AwarenessSignal['subject'] }) {
  const files = subject.importers ?? [];
  return (
    <div data-testid="awareness-contract" className="mt-1.5 space-y-1">
      {subject.signature ? (
        <div className="font-mono text-[10px] leading-snug space-y-px">
          <div className="text-red-300/70 line-through break-all" data-testid="contract-before">{subject.symbol}{subject.signature.before}</div>
          <div className="text-emerald-300/90 break-all" data-testid="contract-after">{subject.symbol}{subject.signature.after}</div>
        </div>
      ) : subject.change === 'removed' ? (
        <div className="font-mono text-[10px] text-red-300/70 line-through">{subject.symbol}</div>
      ) : null}
      {files.length > 0 && (
        <div className="text-[10px] text-foreground-subtle">
          {subject.possibly ? 'Possibly used by (imports the module as a whole)' : 'Imported by'}{' '}
          {files.map((f, i) => (
            <span key={f}>{i > 0 && ', '}<code className="font-mono text-foreground-muted" title={f}>{f}</code></span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The files a drift signal found outside the workstream's scope (A2.5), and where the scope came from. */
function DriftDetail({ subject }: { subject: AwarenessSignal['subject'] }) {
  const items = subject.items?.length ?? 0;
  return (
    <div data-testid="awareness-drift" className="mt-1.5 text-[10px] text-foreground-subtle">
      <div>
        Outside the scope{items ? ` of ${items === 1 ? 'its claimed item' : `its ${items} claimed items`}` : ''}:
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
        {(subject.files ?? []).map((f) => <code key={f} className="font-mono text-foreground-muted" title={f}>{f}</code>)}
      </div>
    </div>
  );
}

/**
 * The agents told about a signal, and what each said with acknowledge_signal
 * (A2.6). Their words, quoted and attributed: they sit beside the person's
 * answer and never set it.
 */
function AgentsTold({ signal: s, now }: { signal: AwarenessSignal; now: number }) {
  const told = toldWords(s, now);
  const notes = (s.told ?? []).filter((t) => t.note);
  if (!told && notes.length === 0) return null;
  return (
    <div data-testid="awareness-told" className="mt-1.5 space-y-0.5 text-[10px] text-foreground-subtle">
      {told && <div>{told}</div>}
      {notes.map((t) => (
        <div key={t.sessionId} data-testid="awareness-agent-note" className="pl-2 border-l border-accent/30" title="The agent's own words">
          <span className="italic text-foreground-muted">&ldquo;{t.note}&rdquo;</span> &mdash; {t.agentType}
          {t.notedAt ? ` · ${ago(t.notedAt, now)}` : ''}
        </div>
      ))}
    </div>
  );
}

function SignalCard({ signal: s, workstreams, now }: { signal: AwarenessSignal; workstreams: Workstream[]; now: number }) {
  const answer = useAwarenessStore((st) => st.answer);
  const [busy, setBusy] = useState(false);
  const answered = stateWords(s, now);
  const quiet = s.state !== 'open';
  const sides = sidesOf(s, workstreams);

  const act = async (state: SettableSignalState) => {
    setBusy(true);
    const err = await answer(s.id, state);
    setBusy(false);
    if (err) useToastStore.getState().addToast({ type: 'error', title: 'Could not update the signal', message: err });
  };

  return (
    <div
      data-testid="awareness-signal"
      data-state={s.state}
      data-severity={s.severity}
      className={`rounded-md border border-border-subtle border-l-2 ${SEVERITY_EDGE[s.severity]} bg-surface/40 px-2.5 py-2 ${quiet ? 'opacity-75' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-[8px] uppercase font-semibold px-1 rounded ${SEVERITY_PILL[s.severity]}`}>{s.severity}</span>
        <span className="text-[10px] font-medium text-foreground-muted">{kindWords(s)}</span>
        <span className="ml-auto text-[9px] text-foreground-subtle" title={new Date(s.firstSeen).toLocaleString()}>
          since {ago(s.firstSeen, now)}
        </span>
      </div>

      <div className="mt-1"><Summary text={s.summary} /></div>

      {/* Both sides of the overlap, by the names the strip uses. */}
      <div data-testid="awareness-sides" className="mt-1.5 flex flex-wrap items-center gap-1">
        {sides.map((name, i) => (
          <span key={`${name}-${i}`} className="flex items-center gap-1">
            {/* A contract runs one way: the change, then who imports it (A2.3). */}
            {i > 0 && (s.kind === 'contract'
              ? <ArrowRight size={9} className="text-foreground-subtle" aria-label="imported by" />
              : <ArrowLeftRight size={9} className="text-foreground-subtle" />)}
            <span className="text-[10px] font-mono px-1.5 py-px rounded border border-border-subtle text-foreground">{name}</span>
          </span>
        ))}
        {s.subject.file && (
          <span className="ml-1 text-[10px] font-mono text-foreground-subtle truncate" title={s.subject.file}>
            {s.subject.file}{s.subject.symbol ? ` · ${s.subject.symbol}` : ''}
          </span>
        )}
      </div>

      {s.kind === 'contract' && <ContractDetail subject={s.subject} />}
      {s.kind === 'drift' && <DriftDetail subject={s.subject} />}

      <AgentsTold signal={s} now={now} />

      {answered && <div data-testid="awareness-answered" className="mt-1 text-[9px] text-foreground-subtle italic">{answered}<UnverifiedIf type={s.stateBy?.actorType} /></div>}

      <div className="mt-1.5 flex items-center gap-1">
        {actionsFor(s.state, s.kind).map((a) => (
          <button
            key={a.state}
            onClick={() => act(a.state)}
            disabled={busy}
            title={a.hint}
            className="text-[10px] px-2 py-0.5 rounded border border-border-subtle text-foreground-muted hover:text-foreground hover:bg-surface-hover disabled:opacity-50 transition-colors"
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
