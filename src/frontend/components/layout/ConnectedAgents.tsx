import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cpu, Sparkles, Bot, Plug } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import type { AgentSessionInfo } from '@shared/types';

/**
 * Multi-agent visibility widget. Replaces the single "Agent active"
 * pill with a count + popover that lists every MCP session: which
 * agent type, which model, which plan they're working on, and how
 * long ago they were last seen. Updated live by `useWebSocket` on
 * `mcp-session-changed` / `session-registered` events.
 *
 * Why: multiple Claude Code instances OR Claude Code + Codex + Cursor
 * can all connect at once. The human needs to see who is in the room
 * and what each one is doing — not just "an agent is active".
 */

function agentBadge(agentType: string): { Icon: typeof Cpu; tint: string; label: string } {
  const t = agentType.toLowerCase();
  if (t.includes('claude')) return { Icon: Sparkles, tint: 'text-amber-300', label: 'Claude Code' };
  if (t.includes('codex')) return { Icon: Bot, tint: 'text-emerald-300', label: 'Codex' };
  if (t.includes('cursor')) return { Icon: Bot, tint: 'text-cyan-300', label: 'Cursor' };
  if (t.includes('aider')) return { Icon: Bot, tint: 'text-purple-300', label: 'Aider' };
  if (t === 'mcp-client') return { Icon: Plug, tint: 'text-foreground-subtle', label: 'MCP client' };
  return { Icon: Cpu, tint: 'text-foreground-muted', label: agentType };
}

function formatLastSeen(ts: number): string {
  const ageMs = Date.now() - ts;
  if (ageMs < 5_000) return 'now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  return `${Math.floor(ageMs / 3_600_000)}h ago`;
}

function shortSessionId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function ConnectedAgents() {
  const sessions = usePlanStore((s) => s.sessions);
  const plans = usePlanStore((s) => s.plans);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Tick once a minute so "Xm ago" labels stay fresh while popover is open.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const popover = document.querySelector('[data-connected-agents-popover]');
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        (!popover || !popover.contains(target))
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const active = sessions.filter((s) => s.status === 'active');
  const count = active.length;

  return (
    <div ref={wrapperRef}>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-lg border shrink-0 transition-all ${
          count > 0
            ? 'bg-surface border-border text-foreground hover:border-border-glow'
            : 'bg-surface border-border text-foreground-muted hover:text-foreground'
        }`}
        title={count > 0 ? `${count} agent${count === 1 ? '' : 's'} connected via MCP` : 'No agents connected'}
      >
        <Cpu size={12} className={count > 0 ? 'text-success drop-shadow-[0_0_4px_rgba(34,197,94,0.5)]' : 'text-foreground-subtle'} />
        <span className={`w-1.5 h-1.5 rounded-full ${count > 0 ? 'bg-success shadow-[0_0_6px_rgba(34,197,94,0.5)] animate-pulse' : 'bg-foreground-subtle'}`} />
        <span>
          {count === 0 ? 'No agents' : count === 1 ? '1 agent' : `${count} agents`}
        </span>
      </button>

      {open && createPortal(
        <div
          data-connected-agents-popover
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="w-72 bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] py-1"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <span className="text-[10px] uppercase tracking-wider text-foreground-subtle">
              Connected agents
            </span>
            <span className="text-[10px] text-foreground-subtle">{count} active</span>
          </div>

          {active.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-foreground-subtle leading-relaxed">
              No agents connected via MCP. Use the
              <span className="mx-1 text-foreground-muted">Connect Agent</span>
              button to copy the MCP config.
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              {active.map((s) => (
                <SessionRow key={s.sessionId} session={s} planTitle={plans.find((p) => p.uid === s.activePlanUid)?.title} />
              ))}
            </div>
          )}

          {sessions.length > active.length && (
            <div className="px-3 py-1 border-t border-white/[0.06] text-[9px] text-foreground-subtle">
              {sessions.length - active.length} recently disconnected
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function SessionRow({ session, planTitle }: { session: AgentSessionInfo; planTitle?: string }) {
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const { Icon, tint, label } = agentBadge(session.agentType);

  return (
    <div className="px-3 py-2 hover:bg-surface-hover/60 transition-colors">
      <div className="flex items-center gap-2">
        <Icon size={12} className={tint} />
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        {session.model && (
          <span className="text-[9px] text-foreground-subtle font-mono truncate">{session.model}</span>
        )}
        <span className="ml-auto text-[9px] text-foreground-subtle">{formatLastSeen(session.lastSeen)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-foreground-subtle">
        <span className="font-mono opacity-60">{shortSessionId(session.sessionId)}</span>
        {session.activePlanUid ? (
          <button
            onClick={() => setActivePlan(session.activePlanUid)}
            className="ml-auto text-accent hover:underline truncate max-w-[180px] text-right"
            title={`Open plan: ${planTitle || session.activePlanUid}`}
          >
            {planTitle || session.activePlanUid}
          </button>
        ) : (
          <span className="ml-auto opacity-60">no active plan</span>
        )}
      </div>
    </div>
  );
}
