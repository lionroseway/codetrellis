import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, Users, AlertTriangle, FileText } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { usePlanStore } from '../../stores/plan-store';
import { agentBadge, formatLastSeen } from './ConnectedAgents';
import { stripWorkstreams, chipLabel, shapeWords, sharedNote, shortFolder, changeWords, statusLetter, MAX_CHIPS, MAX_LISTED_FILES } from '../../lib/workstream-strip';
import type { Workstream } from '@shared/types';

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

export function WorkstreamStrip() {
  const root = useProjectStore((s) => s.root);
  const sessions = usePlanStore((s) => s.sessions);
  const [all, setAll] = useState<Workstream[]>([]);
  const [open, setOpen] = useState<{ root: string | null; top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    if (!root) { setAll([]); return; }
    fetch(`/api/workstreams?project=${encodeURIComponent(root)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ws: Workstream[]) => setAll(Array.isArray(ws) ? ws : []))
      .catch(() => {});
  }, [root]);

  useEffect(() => { refresh(); }, [refresh, sessions]);
  // A watched folder's changed files moved (A1.4).
  useEffect(() => {
    window.addEventListener('workstreams-changed', refresh);
    return () => window.removeEventListener('workstreams-changed', refresh);
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

  const shown = stripWorkstreams(all);
  if (shown.length === 0) return null;

  const chips = shown.length > MAX_CHIPS ? shown.slice(0, MAX_CHIPS - 1) : shown;
  const overflow = shown.length - chips.length;
  const toggle = (e: React.MouseEvent<HTMLButtonElement>, wsRoot: string | null) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setOpen((cur) => (cur && cur.root === wsRoot ? null : { root: wsRoot, top: rect.bottom + 4, left: rect.left }));
  };
  const listed = open ? (open.root === null ? shown.slice(chips.length) : shown.filter((w) => w.root === open.root)) : [];

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
            title={[chipLabel(w), shapeWords(w), changeWords(w), w.agents.length === 0 ? 'no agent working' : null].filter(Boolean).join(' — ')}
            className={`flex items-center gap-1.5 max-w-[160px] text-[11px] px-2 py-1 rounded-lg border bg-surface transition-all ${
              shared ? 'border-warning/50 text-foreground' : 'border-border text-foreground hover:border-border-glow'
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

      {open && listed.length > 0 && createPortal(
        <div
          data-workstream-popover
          data-testid="workstream-popover"
          style={{ position: 'fixed', top: open.top, left: Math.min(open.left, window.innerWidth - 300), zIndex: 9999 }}
          className="w-72 bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] py-1 max-h-[360px] overflow-y-auto"
        >
          {listed.map((w) => <WorkstreamDetail key={w.root} ws={w} />)}
        </div>,
        document.body,
      )}
    </div>
  );
}

function WorkstreamDetail({ ws }: { ws: Workstream }) {
  const note = sharedNote(ws);
  return (
    <div className="border-b border-white/[0.06] last:border-b-0">
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <GitBranch size={12} className="text-foreground-subtle shrink-0" />
          <span className="text-[12px] font-medium text-foreground truncate">{chipLabel(ws)}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-foreground-muted">{shapeWords(ws)}</div>
        <div className="mt-1 flex items-center gap-1 text-[10px] font-mono text-foreground-subtle" title={ws.root}>
          <FileText size={10} className="shrink-0" />
          <span className="truncate">{shortFolder(ws.root)}</span>
        </div>
      </div>
      {note && (
        <div className="mx-3 mb-2 px-2 py-1.5 rounded-md bg-warning-muted/30 flex gap-1.5">
          <AlertTriangle size={11} className="text-warning shrink-0 mt-0.5" />
          <span className="text-[10px] text-warning leading-snug">{note}</span>
        </div>
      )}
      <ChangedFiles ws={ws} />
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-foreground-subtle mb-1">
          <Users size={10} /> {ws.agents.length === 0 ? 'No agent working here' : ws.agents.length === 1 ? '1 agent' : `${ws.agents.length} agents`}
        </div>
        {ws.agents.map((a) => {
          const { Icon, tint, label } = agentBadge(a.agentType);
          return (
            <div key={a.sessionId} data-testid="workstream-agent" className="flex items-center gap-2 py-0.5">
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
        return (
          <div key={f.path} className="flex items-center gap-1.5 py-px" title={f.from ? `${f.from} → ${f.path}` : f.path}>
            <span className={`w-3 text-[9px] font-mono font-semibold shrink-0 ${LETTER_TINT[letter]}`}>{letter}</span>
            <span className="text-[10px] font-mono text-foreground-muted truncate">{shortFolder(f.path, 44)}</span>
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
