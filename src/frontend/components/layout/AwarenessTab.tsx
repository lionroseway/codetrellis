import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Radar, ArrowLeftRight, ArrowRight, History, MessageSquare } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useReplayState, useReplayStore } from '../../stores/replay-store';
import { hhmm, signalsAsOf } from '../../lib/replay';
import { useAwarenessStore } from '../../stores/awareness-store';
import { usePlanItemsStore } from '../../stores/plan-items-store';
import { usePlanStore } from '../../stores/plan-store';
import { sectionsByBranch } from '../../lib/section-worktrees';
import { projectPrefix, toProjectPath } from '../../lib/graph-overlays';
import { openFileAt } from '../../lib/open-file-at';
import { useGraphStore } from '../../stores/graph-store';
import { useUiStore } from '../../stores/ui-store';
import { useToastStore } from '../../stores/toast-store';
import {
  groupSignals, needsYouCount, digestLine, kindWords, sidesOf, sideRootsOf, sideLabel, stateWords, actionsFor, ago, toldWords, reopenedWords,
  replyReadWords, replyFromWords,
} from '../../lib/awareness-view';
import { buildDigest } from '@shared/lib/awareness-digest';
import { sideWords } from '@shared/lib/signal-words';
import type { AwarenessSignal, SettableSignalState, Workstream } from '@shared/types';
import { UnverifiedIf } from '../UnverifiedTag';
import { BreakpointsWaiting, BreakpointsSet } from './Breakpoints';
import { useHighlight } from '../../lib/use-highlight';
import { PlannedOverlapNotices } from './PlannedOverlapNotices';
import { RecurringDue } from './RecurringDue';
import { singleFlight } from '../../lib/single-flight';

/**
 * The Awareness tab (Phase 32 A1.8, awareness spec §7.2): what overlaps
 * between the parallel lines of work in this repository, and a person's
 * answer to each overlap.
 *
 * Breakpoints waiting on you come first (B4.3), then a digest line and the
 * signals: what needs you (open, high or medium), low-priority notes, what
 * you have seen, and what you set aside; the breakpoints set come last.
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
    const run = singleFlight(() => refresh(root));
    void run();
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

/** When the person last had the tab open, per browser (A3.1). Unreadable storage just means "no last visit". */
const LAST_VIEWED_KEY = 'codetrellis.awareness.lastViewed';
/** A visit sooner than this after the last is not worth catching up on. */
const CATCH_UP_AFTER_MS = 5 * 60 * 1000;

function readLastViewed(): number | null {
  try {
    const v = Number(window.localStorage.getItem(LAST_VIEWED_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}
function writeLastViewed(at: number): void {
  try { window.localStorage.setItem(LAST_VIEWED_KEY, String(at)); } catch { /* private window, blocked storage */ }
}

export function AwarenessTab() {
  const root = useProjectStore((s) => s.root);
  const { workstreams, signals: liveSignals, loaded, error } = useAwarenessStore();
  const [liveNow, setNow] = useState(() => Date.now());
  // B5.3: while replaying, the signals open at the cursor's moment.
  const replay = useReplayState();
  const signals = useMemo(() => (replay ? signalsAsOf(replay) : liveSignals), [replay, liveSignals]);
  const now = replay ? replay.at : liveNow;
  // What was new is measured from the visit before this one; leaving marks this one.
  const [lastViewed] = useState(readLastViewed);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    const leave = () => writeLastViewed(Date.now());
    window.addEventListener('beforeunload', leave);
    return () => { clearInterval(id); window.removeEventListener('beforeunload', leave); leave(); };
  }, []);

  if (!root) {
    return <div className="text-[11px] text-foreground-subtle py-6 text-center">Open a project to see its parallel work.</div>;
  }
  if (!loaded) {
    return (
      <div className="text-[11px] space-y-3 max-w-3xl">
        <BreakpointsWaiting now={now} />
        <div className="text-foreground-subtle py-6 text-center">Checking for overlaps…</div>
      </div>
    );
  }

  const groups = groupSignals(signals);
  const digest = digestLine(workstreams, signals);
  const distilled = buildDigest(signals, (r) => sideLabel(r, workstreams), { since: lastViewed });

  return (
    <div data-testid="awareness-tab" className="text-[11px] space-y-3 max-w-3xl">
      <BreakpointsWaiting now={now} />
      <PlannedOverlapNotices />
      <RecurringDue />
      <div data-testid="awareness-digest" className="flex gap-2.5 rounded-lg border border-border-subtle bg-surface/60 px-3 py-2.5">
        <Radar size={14} className={`shrink-0 mt-0.5 ${groups.needsYou.length > 0 ? 'text-warning' : 'text-foreground-subtle'}`} />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">{digest.headline}</div>
          {!replay && distilled.newSince != null && distilled.newSince > 0 && lastViewed && (
            <div data-testid="awareness-new-since" className="mt-0.5 text-[10px] text-warning">
              {distilled.newSince} new since you last looked ({new Date(lastViewed).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})
            </div>
          )}
          {/* Catch-up (B5.4): what happened since the last visit, played at 4×. */}
          {!replay && lastViewed && liveNow - lastViewed > CATCH_UP_AFTER_MS && (
            <button
              type="button"
              data-testid="catch-up"
              onClick={() => { if (root) void useReplayStore.getState().enter(root, lastViewed, { catchUp: true }); }}
              className="mt-1 flex items-center gap-1 text-[10px] text-accent hover:underline"
              title="Step through every recorded moment since then: the graph, the tasks and this inbox as they were"
            >
              <History size={10} />Watch what happened since {hhmm(lastViewed)} at 4×
            </button>
          )}
          {/* The digest (A3.1): what needs you, a line per pair of workstreams, not a stream. */}
          {distilled.lines.length > 0 && (
            <ul data-testid="awareness-digest-lines" className="mt-1.5 space-y-1">
              {distilled.lines.map((l) => (
                <li key={l.signalIds[0]} data-testid="awareness-digest-line" className="flex gap-1.5 leading-snug">
                  <span className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${l.severity === 'high' ? 'bg-danger' : 'bg-warning'}`} aria-label={l.severity} />
                  <span className="min-w-0">
                    <Summary text={l.text} />
                    {l.told && <span className="text-[10px] text-foreground-subtle"> · Agents told.</span>}
                    <span className="block text-[10px] text-foreground-muted">Waiting on you: {l.question}</span>
                  </span>
                </li>
              ))}
              {distilled.moreLines > 0 && (
                <li className="text-[10px] text-foreground-subtle pl-3">and {distilled.moreLines} more below</li>
              )}
            </ul>
          )}
          <div className="mt-1 text-[10px] text-foreground-muted leading-snug">{digest.detail}</div>
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
      <BreakpointsSet />
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
/** A signature after its name: Java's and C#'s begin with the return type, so a space (A2.7). */
const afterName = (signature: string) => (/^[(<[]/.test(signature) ? signature : ` ${signature}`);

function ContractDetail({ subject }: { subject: AwarenessSignal['subject'] }) {
  const files = subject.importers ?? [];
  return (
    <div data-testid="awareness-contract" className="mt-1.5 space-y-1">
      {subject.signature ? (
        <div className="font-mono text-[10px] leading-snug space-y-px">
          <div className="text-red-300/70 line-through break-all" data-testid="contract-before">{subject.symbol}{afterName(subject.signature.before)}</div>
          <div className="text-emerald-300/90 break-all" data-testid="contract-after">{subject.symbol}{afterName(subject.signature.after)}</div>
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

/**
 * A material signal (A6.4): what each task is doing with the file, in the
 * words the phone and the digest use. The tasks are named by title.
 */
function MaterialDetail({ signal: s, workstreams }: { signal: AwarenessSignal; workstreams: Workstream[] }) {
  const lines = sideWords(s, (root) => sideLabel(root, workstreams));
  return (
    <ul data-testid="awareness-material" className="mt-1.5 space-y-0.5 text-[10.5px] text-foreground-muted">
      {lines.map((l) => <li key={l.root}>{l.words}</li>)}
    </ul>
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
      {/* Phase 33 R9 — the rules about where it went, guides included. */}
      {(subject.rules ?? []).length > 0 && (
        <div className="mt-1 space-y-0.5" data-testid="awareness-drift-rules">
          {(subject.rules ?? []).map((r) => (
            <div key={r.id} data-testid="awareness-drift-rule">
              The rule <span className="text-foreground-muted">“{r.words}”</span> ({r.suite}, {r.strength}) is about {r.files.join(', ')}.
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The rule a workstream's new imports break (A7.2): the rule and why, each
 * import across it, and the way to change the rule if the import is right.
 */
function RuleDetail({ subject }: { subject: AwarenessSignal['subject'] }) {
  const edges = subject.edges ?? [];
  return (
    <div data-testid="awareness-rule" className="mt-1.5 text-[10px] text-foreground-subtle">
      <div data-testid="awareness-rule-words">
        The rule <span className="text-foreground-muted">“{subject.rule?.words ?? 'an architecture rule'}”</span>
        {subject.rule?.because ? <>, because {subject.rule.because}</> : null}:
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {edges.map((e) => (
          <li key={`${e.from}\0${e.to}`} data-testid="awareness-rule-edge" className="font-mono text-foreground-muted">
            {e.from} <ArrowRight size={9} className="inline text-foreground-subtle" aria-label="imports" /> {e.to}
          </li>
        ))}
      </ul>
      <button
        data-testid="awareness-rule-change"
        onClick={() => useUiStore.getState().setWorkspaceMode('rules')}
        className="mt-1 text-[10px] text-sky-300/90 hover:underline"
      >
        See the rule in the Rules view
      </button>
    </div>
  );
}

/**
 * The person's messages to the agents about a signal (A4.1), and who has
 * read each. The agents' answers are under "told", in their own words.
 */
function SignalReplies({ signal: s, now }: { signal: AwarenessSignal; now: number }) {
  if (!s.replies?.length) return null;
  return (
    <div data-testid="awareness-replies" className="mt-1.5 space-y-1">
      {s.replies.map((r) => (
        <div key={r.id} data-testid="awareness-reply" className="pl-2 border-l border-sky-400/40 text-[10px]">
          <div className="text-foreground whitespace-pre-wrap break-words">“{r.message}”</div>
          <div className="text-foreground-subtle">
            {replyFromWords(r)}<UnverifiedIf type={r.by.actorType} /> · {ago(r.at, now)} · <span data-testid="awareness-reply-read">{replyReadWords(r, now)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * "Message the agents" (A4.1, awareness spec §7.2): the person's words reach
 * each agent working on either side, once, on its next step.
 */
function MessageAgents({ signal: s, sides }: { signal: AwarenessSignal; sides: string[] }) {
  const reply = useAwarenessStore((st) => st.reply);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Opened near the bottom of a short panel: bring Send into view too, not only the textbox.
  useEffect(() => { if (open) boxRef.current?.scrollIntoView({ block: 'nearest' }); }, [open]);
  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setBusy(true);
    const err = await reply(s.id, message);
    setBusy(false);
    if (err) { useToastStore.getState().addToast({ type: 'error', title: 'Could not send the message', message: err }); return; }
    setText('');
    setOpen(false);
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="awareness-message-agents"
        title="Your words reach each agent working on either side, on its next step"
        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-border-subtle text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors"
      >
        <MessageSquare size={10} /> Message the agents
      </button>
    );
  }
  return (
    <div ref={boxRef} data-testid="awareness-message-box" className="order-last basis-full mt-1 space-y-1">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
          if (e.key === 'Escape') setOpen(false);
        }}
        maxLength={1000}
        rows={2}
        aria-label="Message to the agents"
        placeholder="e.g. Keep the old signature until checkout-fix has moved its callers"
        className="w-full rounded border border-border-subtle bg-surface px-2 py-1 text-[11px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/50"
      />
      <div className="flex items-center gap-1.5 text-[10px]">
        <button
          type="button"
          onClick={() => { void send(); }}
          disabled={busy || !text.trim()}
          className="px-2 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50 transition-colors"
        >
          Send
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-0.5 rounded text-foreground-muted hover:text-foreground">
          Cancel
        </button>
        <span className="text-foreground-subtle">Each agent in {sides.join(' and ')} reads it on its next step.</span>
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

/**
 * Phase 32 B3.3b — from a signal to where it is: "Show on graph" switches to
 * the graph and focuses the file's node (or the cluster holding it); "Show
 * lines" opens it in the code view, where each workstream's lines are marked.
 * The signal's path is the repository's; the graph and the code view take the
 * project's.
 */
function SignalFileChips({ signal: s, workstreams }: { signal: AwarenessSignal; workstreams: Workstream[] }) {
  const root = useProjectStore((st) => st.root);
  const file = s.subject.file ?? s.subject.files?.[0];
  // A task's material is not code: it has no node on the graph and no lines to mark (A6.4).
  if (!file || s.subject.material) return null;
  const prefix = projectPrefix(root, workstreams);
  const here = prefix === null ? file : toProjectPath(file, prefix);
  if (here === null) return null; // outside the open project: nothing here to show
  const chip = 'text-[10px] px-1.5 py-px rounded border border-sky-400/30 text-sky-300 hover:bg-sky-500/10';
  return (
    <span className="ml-auto flex items-center gap-1">
      <button
        data-testid="signal-show-on-graph"
        className={chip}
        title={`Focus the graph on ${here}`}
        onClick={() => {
          useUiStore.getState().setWorkspaceMode('graph');
          useGraphStore.getState().focusNode(here);
        }}
      >
        Show on graph
      </button>
      <button
        data-testid="signal-show-lines"
        className={chip}
        title={`Open ${here} with each workstream's changed lines marked`}
        onClick={() => { void openFileAt(here); }}
      >
        Show lines
      </button>
    </span>
  );
}

function SignalCard({ signal: s, workstreams, now }: { signal: AwarenessSignal; workstreams: Workstream[]; now: number }) {
  const pointed = useHighlight('signal', s.id);
  const answer = useAwarenessStore((st) => st.answer);
  // Answering is for now: a replayed signal is shown as it was, without actions.
  const replayed = useReplayState() !== null;
  const [busy, setBusy] = useState(false);
  const answered = stateWords(s, now);
  const quiet = s.state !== 'open';
  const sides = sidesOf(s, workstreams);
  // C5.3b — the open plan's sections on each side, so an overlap between two
  // sections of one plan says which.
  const itemsByUid = usePlanItemsStore((st) => st.itemsByUid);
  const planTitle = usePlanStore((st) => st.plans.find((p) => p.uid === st.activePlanUid)?.title ?? null);
  const sectionMap = sectionsByBranch(itemsByUid);
  const sideSections = sideRootsOf(s).map((r) => {
    const branch = workstreams.find((w) => w.root === r)?.branch;
    return branch ? sectionMap.get(branch) ?? [] : [];
  });
  const namedSections = sideSections.filter((x) => x.length > 0);

  const act = async (state: SettableSignalState) => {
    setBusy(true);
    const err = await answer(s.id, state);
    setBusy(false);
    if (err) useToastStore.getState().addToast({ type: 'error', title: 'Could not update the signal', message: err });
  };

  return (
    <div
      ref={pointed.ref}
      data-testid="awareness-signal"
      data-signal-id={s.id}
      data-highlighted={pointed.highlighted ? 'true' : undefined}
      data-state={s.state}
      data-severity={s.severity}
      className={`rounded-md border border-border-subtle border-l-2 ${SEVERITY_EDGE[s.severity]} bg-surface/40 px-2.5 py-2 ${quiet ? 'opacity-75' : ''}${pointed.ring}`}
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
            {i > 0 && (s.kind === 'contract' && !s.subject.material
              ? <ArrowRight size={9} className="text-foreground-subtle" aria-label="imported by" />
              : <ArrowLeftRight size={9} className="text-foreground-subtle" />)}
            <span className="text-[10px] font-mono px-1.5 py-px rounded border border-border-subtle text-foreground">{name}</span>
            {sideSections[i]?.length ? <span className="text-[10px] text-sky-300/90">({sideSections[i].join(', ')})</span> : null}
          </span>
        ))}
        {(s.subject.file ?? s.subject.material) && (
          <span className="ml-1 text-[10px] font-mono text-foreground-subtle truncate" title={s.subject.file ?? s.subject.material}>
            {s.subject.file ?? s.subject.material}{s.subject.symbol ? ` · ${s.subject.symbol}` : ''}
          </span>
        )}
      </div>

      {namedSections.length >= 2 && (
        <div data-testid="awareness-sections" className="mt-1 text-[10px] text-foreground-muted">
          Two sections of {planTitle ? <>“{planTitle}”</> : 'this plan'}: {namedSections.map((x) => x.join(', ')).join(' and ')}.
        </div>
      )}

      {s.subject.material
        ? <MaterialDetail signal={s} workstreams={workstreams} />
        : (
          <>
            {s.kind === 'contract' && <ContractDetail subject={s.subject} />}
            {s.kind === 'drift' && <DriftDetail subject={s.subject} />}
            {s.kind === 'rule' && <RuleDetail subject={s.subject} />}
          </>
        )}

      {reopenedWords(s, now) && (
        <div data-testid="awareness-reopened" className="mt-1 text-[10px] text-warning">{reopenedWords(s, now)}</div>
      )}

      <AgentsTold signal={s} now={now} />
      <SignalReplies signal={s} now={now} />

      {answered && <div data-testid="awareness-answered" className="mt-1 text-[9px] text-foreground-subtle italic">{answered}<UnverifiedIf type={s.stateBy?.actorType} /></div>}

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span data-testid="awareness-actions" className="flex items-center gap-1">
          {!replayed && actionsFor(s.state, s.kind).map((a) => (
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
        </span>
        {!replayed && <MessageAgents signal={s} sides={sides} />}
        {/* Where it is, beside what to do about it (B3.3b). */}
        <SignalFileChips signal={s} workstreams={workstreams} />
      </div>
    </div>
  );
}
