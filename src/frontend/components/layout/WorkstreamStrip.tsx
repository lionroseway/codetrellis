import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, Users, AlertTriangle, FileText, FolderPlus, ClipboardList } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { usePlanStore } from '../../stores/plan-store';
import { useToastStore } from '../../stores/toast-store';
import { useUiStore } from '../../stores/ui-store';
import { agentBadge, formatLastSeen } from './ConnectedAgents';
import { stripWorkstreams, chipLabel, shapeWords, sharedNote, shortFolder, changeWords, statusLetter, symbolSummary, signatureLines, signatureWords, signalsFor, chipSeverity, signalWords, intentLines, MAX_CHIPS, MAX_LISTED_FILES } from '../../lib/workstream-strip';
import type { AwarenessSignal, Workstream } from '@shared/types';
import { singleFlight } from '../../lib/single-flight';

/**
 * The workstreams strip (Phase 32 A1.3): one chip per line of parallel work
 * in the repository — a worktree, or a folder agents share — with its
 * branch and who is in it. Click a chip for its folder and agents.
 *
 * It sits beside `ConnectedAgents`, which answers "who is connected"; this
 * answers "where is each one working". When the answer is just "one agent,
 * in the project itself" it stays out of the way (see `stripWorkstreams`).
 *
 * Refreshed when sessions change (the same event ConnectedAgents follows),
 * and every 15 s, because a worktree made from a terminal, or a Claude
 * session that never connects, announces nothing.
 */

const REFRESH_MS = 15_000;

/** A pending folder request as the server lists it (A1.7c). */
interface FolderRequestView {
  id: string;
  folder: string;
  agentType: string;
  reportedAt: number;
}

/** A task worked as a workstream (A6.1): a session on it through get_brief. */
interface TaskWorkstreamView {
  id: string;
  itemUid: string;
  title: string;
  planTitle: string;
  status: string;
  agents: Workstream['agents'];
  materials: number;
  outputs: number;
}

const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;

export function WorkstreamStrip() {
  const root = useProjectStore((s) => s.root);
  const sessions = usePlanStore((s) => s.sessions);
  const [all, setAll] = useState<Workstream[]>([]);
  const [signals, setSignals] = useState<AwarenessSignal[]>([]);
  const [requests, setRequests] = useState<FolderRequestView[]>([]);
  const [tasks, setTasks] = useState<TaskWorkstreamView[]>([]);
  const [open, setOpen] = useState<{ root: string | null; top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // One read at a time, all four together: the strip listens to every
  // workstream and signal broadcast, which come in bursts (HD4).
  const refresh = useMemo(() => singleFlight(async () => {
    if (!root) { setAll([]); setSignals([]); setTasks([]); return; }
    await Promise.all([
      fetch(`/api/workstreams?project=${encodeURIComponent(root)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((ws: Workstream[]) => setAll(Array.isArray(ws) ? ws : []))
        .catch(() => {}),
      // Tasks a session is on through get_brief (A6.1): work with no folder.
      fetch(`/api/workstreams/tasks?project=${encodeURIComponent(root)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((ts: TaskWorkstreamView[]) => setTasks(Array.isArray(ts) ? ts : []))
        .catch(() => {}),
      // Folders an agent reported that are not opened (A1.7c).
      fetch('/api/workstreams/folder-requests')
        .then((r) => (r.ok ? r.json() : []))
        .then((rs: FolderRequestView[]) => setRequests(Array.isArray(rs) ? rs : []))
        .catch(() => {}),
      // What overlaps (A1.6). A failure leaves the chips as they are, unmarked.
      fetch(`/api/awareness?project=${encodeURIComponent(root)}`)
        .then((r) => (r.ok ? r.json() : { signals: [] }))
        .then((body: { signals?: AwarenessSignal[] }) => setSignals(Array.isArray(body.signals) ? body.signals : []))
        .catch(() => {}),
    ]);
  }), [root]);

  useEffect(() => { void refresh(); }, [refresh, sessions]);
  // A watched folder's changed files moved (A1.4).
  useEffect(() => {
    window.addEventListener('workstreams-changed', refresh);
    window.addEventListener('awareness-changed', refresh);
    window.addEventListener('folder-requests-changed', refresh);
    return () => {
      window.removeEventListener('workstreams-changed', refresh);
      window.removeEventListener('awareness-changed', refresh);
      window.removeEventListener('folder-requests-changed', refresh);
    };
  }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const pop = document.querySelector('[data-workstream-popover]');
      if (!wrapperRef.current?.contains(t) && !pop?.contains(t)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = stripWorkstreams(all, signals);
  if (shown.length === 0 && requests.length === 0 && tasks.length === 0) return null;

  const chips = shown.length > MAX_CHIPS ? shown.slice(0, MAX_CHIPS - 1) : shown;
  const overflow = shown.length - chips.length;
  const toggle = (e: React.MouseEvent<HTMLButtonElement>, wsRoot: string | null) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setOpen((cur) => (cur && cur.root === wsRoot ? null : { root: wsRoot, top: rect.bottom + 4, left: rect.left }));
  };
  // From an overlap to where it is answered (A1.8).
  const review = () => { setOpen(null); useUiStore.getState().openPlanPanelTab('awareness'); };
  const listed = open ? (open.root === null ? shown.slice(chips.length) : shown.filter((w) => w.root === open.root)) : [];
  const openTask = open?.root?.startsWith('task:') ? tasks.find((t) => t.id === open.root) ?? null : null;
  const openRequest = open?.root?.startsWith('request:') ? requests.find((r) => `request:${r.id}` === open.root) ?? null : null;
  const answer = async (r: FolderRequestView, action: 'include' | 'dismiss') => {
    setOpen(null);
    const toast = useToastStore.getState().addToast;
    try {
      const res = await fetch(`/api/workstreams/folder-requests/${encodeURIComponent(r.id)}/${action}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (action === 'include') {
        if (res.ok) toast({ type: 'success', title: 'Clone included', message: `${folderName(r.folder)} is now a workstream of this project.` });
        else toast({ type: res.status === 403 ? 'error' : 'info', title: 'Not included', message: body.reason ?? body.error ?? `Server returned ${res.status}` });
      }
    } catch {
      toast({ type: 'error', title: 'Could not reach CodeTrellis', message: 'Try again in a moment.' });
    }
    refresh();
  };

  return (
    <div ref={wrapperRef} data-testid="workstream-strip" className="flex items-center gap-1 shrink-0" aria-label="Workstreams">
      {chips.map((w) => {
        const shared = w.shape === 'shared';
        return (
          <button
            key={w.root}
            data-testid="workstream-chip"
            onClick={(e) => toggle(e, w.root)}
            aria-expanded={open?.root === w.root}
            title={[chipLabel(w), shapeWords(w), changeWords(w), w.agents.length === 0 ? 'no agent working' : null, signalWords(signalsFor(w.root, signals))].filter(Boolean).join(' — ')}
            data-severity={chipSeverity(signalsFor(w.root, signals)) ?? undefined}
            className={`flex items-center gap-1.5 max-w-[160px] text-[11px] px-2 py-1 rounded-lg border bg-surface transition-all ${
              // What overlaps other work is the thing worth a look (A1.6).
              chipSeverity(signalsFor(w.root, signals)) === 'high' ? 'border-danger/70 text-foreground shadow-[0_0_8px_rgba(239,68,68,0.25)]'
              : chipSeverity(signalsFor(w.root, signals)) === 'medium' || shared ? 'border-warning/50 text-foreground'
              : 'border-border text-foreground hover:border-border-glow'
            } ${open?.root === w.root ? 'border-border-glow' : ''}`}
          >
            {/* Green while an agent works there; grey for work left behind. */}
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${w.agents.length > 0 ? 'bg-success' : 'bg-foreground-subtle'}`} aria-hidden />
            <span className="truncate">{chipLabel(w)}</span>
            {w.changes.files.length > 0 && (
              <span data-testid="workstream-change-count" className="text-[10px] text-foreground-muted tabular-nums shrink-0" aria-label={changeWords(w) ?? undefined}>
                {w.changes.files.length}{w.changes.truncated ? '+' : ''}
              </span>
            )}
            <span className="flex items-center -space-x-0.5 shrink-0" aria-hidden>
              {w.agents.slice(0, 3).map((a) => {
                const { Icon, tint } = agentBadge(a.agentType);
                return <Icon key={a.sessionId} size={11} className={tint} />;
              })}
            </span>
            {shared && <AlertTriangle size={11} className="text-warning shrink-0" aria-label="shared folder" />}
          </button>
        );
      })}
      {/* A task a session is on (A6.1): work that is not code, with no folder. */}
      {tasks.map((t) => {
        const sev = chipSeverity(signalsFor(t.id, signals));
        return (
          <button
            key={t.id}
            data-testid="task-workstream-chip"
            onClick={(e) => toggle(e, t.id)}
            aria-expanded={open?.root === t.id}
            title={[`Task · ${t.title}`, t.planTitle, t.agents.length === 0 ? 'no agent working' : null, signalWords(signalsFor(t.id, signals))].filter(Boolean).join(' — ')}
            data-severity={sev ?? undefined}
            className={`flex items-center gap-1.5 max-w-[180px] text-[11px] px-2 py-1 rounded-lg border bg-surface transition-all ${
              sev === 'high' ? 'border-danger/70 text-foreground' : sev === 'medium' ? 'border-warning/50 text-foreground' : 'border-border text-foreground hover:border-border-glow'
            } ${open?.root === t.id ? 'border-border-glow' : ''}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.agents.length > 0 ? 'bg-success' : 'bg-foreground-subtle'}`} aria-hidden />
            <ClipboardList size={11} className="text-foreground-subtle shrink-0" aria-hidden />
            <span className="truncate">Task · {t.title}</span>
            <span className="flex items-center -space-x-0.5 shrink-0" aria-hidden>
              {t.agents.slice(0, 3).map((a) => {
                const { Icon, tint } = agentBadge(a.agentType);
                return <Icon key={a.sessionId} size={11} className={tint} />;
              })}
            </span>
          </button>
        );
      })}
      {/* An agent in a folder that is not opened (A1.7c): asked, never assumed. */}
      {requests.map((r) => (
        <button
          key={r.id}
          data-testid="folder-request-chip"
          onClick={(e) => toggle(e, `request:${r.id}`)}
          aria-expanded={open?.root === `request:${r.id}`}
          title={`An agent is working in ${r.folder}, which CodeTrellis has not opened`}
          className="flex items-center gap-1.5 max-w-[180px] text-[11px] px-2 py-1 rounded-lg border border-dashed border-accent/60 bg-surface text-foreground-muted hover:text-foreground"
        >
          <FolderPlus size={11} className="text-accent shrink-0" />
          <span className="truncate">Agent in {folderName(r.folder)}</span>
        </button>
      ))}
      {overflow > 0 && (
        <button
          data-testid="workstream-overflow"
          onClick={(e) => toggle(e, null)}
          className="text-[11px] px-2 py-1 rounded-lg border border-border bg-surface text-foreground-muted hover:text-foreground"
          title={`${overflow} more workstream${overflow === 1 ? '' : 's'}`}
        >
          +{overflow}
        </button>
      )}

      {openTask && open && createPortal(
        <div
          data-workstream-popover
          data-testid="task-workstream-popover"
          style={{ position: 'fixed', top: open.top, left: Math.min(open.left, window.innerWidth - 300), zIndex: 9999 }}
          className="w-72 bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] py-1"
        >
          <div className="px-3 py-2">
            <div className="flex items-center gap-1.5">
              <ClipboardList size={12} className="text-foreground-subtle shrink-0" />
              <span className="text-[12px] font-medium text-foreground truncate">{openTask.title}</span>
            </div>
            <div className="mt-0.5 text-[10px] text-foreground-muted">
              A task in {openTask.planTitle}. Work that is not code: its agents are on it through its brief, not a folder.
            </div>
            <div className="mt-1 text-[10px] text-foreground-subtle">
              {openTask.materials} {openTask.materials === 1 ? 'material' : 'materials'} · {openTask.outputs} {openTask.outputs === 1 ? 'output' : 'outputs'}
            </div>
          </div>
          <Overlaps signals={signalsFor(openTask.id, signals)} onReview={review} />
          <div className="px-3 pb-2">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-foreground-subtle mb-1">
              <Users size={10} /> {openTask.agents.length === 0 ? 'No agent on it now' : openTask.agents.length === 1 ? '1 agent' : `${openTask.agents.length} agents`}
            </div>
            {openTask.agents.map((a) => {
              const { Icon, tint, label } = agentBadge(a.agentType);
              return (
                <div key={a.sessionId} data-testid="task-workstream-agent" className="flex items-center gap-2 py-0.5">
                  <Icon size={11} className={tint} />
                  <span className="text-[11px] text-foreground">{label}</span>
                  {a.model && <span className="text-[9px] font-mono text-foreground-subtle truncate">{a.model}</span>}
                  <span className="ml-auto text-[9px] text-foreground-subtle whitespace-nowrap">{a.lastSeen ? formatLastSeen(a.lastSeen) : ''}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}

      {openRequest && open && createPortal(
        <div
          data-workstream-popover
          data-testid="folder-request-popover"
          style={{ position: 'fixed', top: open.top, left: Math.min(open.left, window.innerWidth - 300), zIndex: 9999 }}
          className="w-72 bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] p-3"
        >
          <div className="flex items-center gap-1.5">
            <FolderPlus size={12} className="text-accent shrink-0" />
            <span className="text-[12px] font-medium text-foreground">An agent is working elsewhere</span>
          </div>
          <div className="mt-1.5 text-[10px] font-mono text-foreground-subtle break-all">{openRequest.folder}</div>
          <p className="mt-2 text-[11px] text-foreground-muted leading-snug">
            {agentBadge(openRequest.agentType).label} reported this folder, which CodeTrellis has not opened. If it is a
            clone of this repository, include it to see its work here. Nothing has been read from it, and nothing will be
            unless you include it.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              data-testid="folder-request-dismiss"
              onClick={() => answer(openRequest, 'dismiss')}
              className="text-[11px] px-2.5 py-1 rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-hover"
            >
              Not now
            </button>
            <button
              data-testid="folder-request-include"
              onClick={() => answer(openRequest, 'include')}
              className="text-[11px] px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent/90"
            >
              Include
            </button>
          </div>
        </div>,
        document.body,
      )}

      {open && listed.length > 0 && createPortal(
        <div
          data-workstream-popover
          data-testid="workstream-popover"
          style={{ position: 'fixed', top: open.top, left: Math.min(open.left, window.innerWidth - 300), zIndex: 9999 }}
          className="w-72 bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] py-1 max-h-[360px] overflow-y-auto"
        >
          {listed.map((w) => <WorkstreamDetail key={w.root} ws={w} signals={signalsFor(w.root, signals)} onReview={review} />)}
        </div>,
        document.body,
      )}
    </div>
  );
}

function WorkstreamDetail({ ws, signals, onReview }: { ws: Workstream; signals: AwarenessSignal[]; onReview: () => void }) {
  const note = sharedNote(ws);
  return (
    <div className="border-b border-white/[0.06] last:border-b-0">
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <GitBranch size={12} className="text-foreground-subtle shrink-0" />
          <span className="text-[12px] font-medium text-foreground truncate">{chipLabel(ws)}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-foreground-muted">{shapeWords(ws)}</div>
        {/* A branch has no folder here: say which ref it is instead. */}
        <div className="mt-1 flex items-center gap-1 text-[10px] font-mono text-foreground-subtle" title={ws.ref ?? ws.root}>
          {ws.shape === 'branch' ? <GitBranch size={10} className="shrink-0" /> : <FileText size={10} className="shrink-0" />}
          <span className="truncate">{shortFolder(ws.ref ?? ws.root)}</span>
        </div>
      </div>
      {note && (
        <div className="mx-3 mb-2 px-2 py-1.5 rounded-md bg-warning-muted/30 flex gap-1.5">
          <AlertTriangle size={11} className="text-warning shrink-0 mt-0.5" />
          <span className="text-[10px] text-warning leading-snug">{note}</span>
        </div>
      )}
      <Overlaps signals={signals} onReview={onReview} />
      <ChangedFiles ws={ws} />
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-foreground-subtle mb-1">
          <Users size={10} /> {ws.agents.length === 0 ? (ws.shape === 'branch' ? 'No agent on this machine' : 'No agent working here') : ws.agents.length === 1 ? '1 agent' : `${ws.agents.length} agents`}
        </div>
        {ws.agents.map((a) => {
          const { Icon, tint, label } = agentBadge(a.agentType);
          const intent = ws.intents?.find((i) => i.sessionId === a.sessionId);
          return (
            <div key={a.sessionId}>
            <div data-testid="workstream-agent" className="flex items-center gap-2 py-0.5">
              <Icon size={11} className={tint} />
              <span className="text-[11px] text-foreground">{label}</span>
              {a.model && <span className="text-[9px] font-mono text-foreground-subtle truncate">{a.model}</span>}
              <span
                className="ml-auto text-[9px] text-foreground-subtle whitespace-nowrap"
                title={a.source === 'claude-log' ? "Seen in Claude Code's own session log. It hasn't connected to CodeTrellis, so it can't be messaged or told about other work." : undefined}
              >
                {a.source === 'claude-log' ? 'from its log' : a.lastSeen ? formatLastSeen(a.lastSeen) : ''}
              </span>
            </div>
            {/* What it said it is about to change (A2.4), in its own words, then what that claims. */}
            {intent && (
              <div data-testid="workstream-intent" className="ml-[19px] mb-1 pl-2 border-l border-accent/30">
                <div className="text-[9px] uppercase tracking-wider text-foreground-subtle">
                  Declared {formatLastSeen(intent.declaredAt).replace(/^now$/, 'just now')}
                </div>
                <div className="text-[10.5px] text-foreground-muted italic leading-snug" title="The agent's own words">
                  &ldquo;{intent.summary}&rdquo;
                </div>
                {intentLines(intent).map((line) => (
                  <div key={line} className="text-[10px] font-mono text-foreground-subtle truncate" title={line}>{line}</div>
                ))}
              </div>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LETTER_TINT = { A: 'text-success', M: 'text-warning', D: 'text-danger', R: 'text-accent' } as const;

/** What the workstream has changed since it branched, most of it at a glance. */
function ChangedFiles({ ws }: { ws: Workstream }) {
  const { files, truncated } = ws.changes;
  if (files.length === 0) return null;
  const shown = files.slice(0, MAX_LISTED_FILES);
  const more = files.length - shown.length;
  return (
    <div className="px-3 pb-2" data-testid="workstream-changes">
      <div className="text-[9px] uppercase tracking-wider text-foreground-subtle mb-1">
        {changeWords(ws)}{ws.main ? ', not yet committed' : ' since it branched'}
      </div>
      {shown.map((f) => {
        const letter = statusLetter(f.status);
        const symbols = symbolSummary(f.symbols);
        return (
          <div key={f.path} className="py-px" title={f.from ? `${f.from} → ${f.path}` : f.path}>
            <div className="flex items-center gap-1.5">
              <span className={`w-3 text-[9px] font-mono font-semibold shrink-0 ${LETTER_TINT[letter]}`}>{letter}</span>
              <span className="text-[10px] font-mono text-foreground-muted truncate">{shortFolder(f.path, 44)}</span>
            </div>
            {/* Which symbols it touched (A1.5): ~ modified, + added, − removed;
                `()` when the signature changed, before and after on hover (A2.1). */}
            {symbols && (
              <div
                data-testid="workstream-file-symbols"
                className="pl-[18px] text-[9px] font-mono text-foreground-subtle truncate"
                title={signatureLines(f.symbols) ?? undefined}
              >
                {symbols}
              </div>
            )}
            {/* What callers feel, said in words, with the shapes on hover. */}
            {signatureWords(f.symbols) && (
              <div
                data-testid="workstream-file-signature"
                className="pl-[18px] text-[9px] text-warning truncate"
                title={signatureLines(f.symbols) ?? undefined}
              >
                {signatureWords(f.symbols)}
              </div>
            )}
          </div>
        );
      })}
      {(more > 0 || truncated) && (
        <div className="text-[9px] text-foreground-subtle mt-0.5">
          and {more}{truncated ? '+' : ''} more
        </div>
      )}
    </div>
  );
}

const SEVERITY_PILL = {
  high: 'bg-danger/15 text-danger',
  medium: 'bg-warning-muted/40 text-warning',
  low: 'bg-surface-hover text-foreground-muted',
} as const;

const ANSWERED = { acknowledged: 'seen', intended: 'intended', dismissed: 'dismissed' } as const;

/**
 * What overlaps other work (A1.6): collisions first, then a stale base. An
 * overlap a person has answered says so (A1.8); the answers themselves are
 * given in the Awareness tab, which the link opens.
 */
function Overlaps({ signals, onReview }: { signals: AwarenessSignal[]; onReview: () => void }) {
  if (signals.length === 0) return null;
  return (
    <div className="px-3 pb-2" data-testid="workstream-signals">
      <div className="text-[9px] uppercase tracking-wider text-foreground-subtle mb-1">Overlaps with other work</div>
      {signals.map((s) => (
        <div key={s.id} data-testid="workstream-signal" data-state={s.state} className={`flex items-start gap-1.5 py-0.5 ${s.state === 'open' ? '' : 'opacity-60'}`}>
          <span className={`text-[8px] uppercase font-semibold px-1 rounded shrink-0 mt-px ${SEVERITY_PILL[s.severity]}`}>{s.severity}</span>
          {/* Backticks mark names in the summary; shown as plain text. */}
          <span className="text-[10px] text-foreground leading-snug">
            {s.summary.replace(/`/g, '')}
            {s.state in ANSWERED && <span className="text-foreground-subtle"> · {ANSWERED[s.state as keyof typeof ANSWERED]}</span>}
          </span>
        </div>
      ))}
      <button data-testid="workstream-review-awareness" onClick={onReview} className="mt-1 text-[10px] text-accent hover:underline">
        Review in Awareness
      </button>
    </div>
  );
}
