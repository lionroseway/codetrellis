/**
 * Phase 17.J — Live Execution Dashboard.
 *
 * Compact real-time view of what agents are doing right now. Shows:
 *   - Active task spotlight (which items are in_progress, who's working)
 *   - File change stream (recent file changes detected by the watcher)
 *   - Agent heartbeat (last-seen, model, active plan)
 *
 * Renders as a collapsible panel inside the activity drawer (right-side
 * of the plan workspace). Listens to WebSocket events for live updates.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileText,
  Radio,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { usePlanStore } from '../../../stores/plan-store';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import type { PlanItem, AgentSessionInfo } from '@shared/types';

/**
 * Active task spotlight — items currently being worked on.
 */
function ActiveTasks({ items }: { items: PlanItem[] }) {
  const active = items.filter(
    (i) => i.kind === 'action' && (i.status === 'in_progress' || i.status === 'assigned'),
  );

  if (active.length === 0) {
    return (
      <div className="text-[11.5px] text-foreground-subtle italic px-1">
        No tasks in progress.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {active.map((item) => (
        <ActiveTaskRow key={item.uid} item={item} />
      ))}
    </div>
  );
}

function ActiveTaskRow({ item }: { item: PlanItem }) {
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const isAssigned = item.status === 'assigned';
  const isInProgress = item.status === 'in_progress';

  return (
    <button
      onClick={() => selectItem(item.uid)}
      className="w-full flex items-start gap-2 px-2.5 py-2 rounded-lg border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] hover:border-accent/20 text-left transition-colors"
    >
      <div className="mt-0.5">
        {isInProgress ? (
          <div className="relative">
            <Zap size={12} className="text-accent" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          </div>
        ) : (
          <Zap size={12} className="text-blue-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-foreground truncate font-medium">{item.title}</div>
        <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-foreground-subtle">
          <span className={isInProgress ? 'text-accent' : 'text-blue-400'}>
            {isInProgress ? 'running' : 'assigned'}
          </span>
          {item.assignee && (
            <>
              <span>·</span>
              <span className="text-cyan-300">{item.assignee}</span>
            </>
          )}
          {typeof item.progressPercent === 'number' && (
            <>
              <span>·</span>
              <span>{item.progressPercent}%</span>
            </>
          )}
        </div>
        {typeof item.progressPercent === 'number' && (
          <div className="mt-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full bg-accent/60 rounded-full transition-all duration-500"
              style={{ width: `${item.progressPercent}%` }}
            />
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * Connected agents sidebar.
 */
function ConnectedAgents({ sessions }: { sessions: AgentSessionInfo[] }) {
  const active = (Array.isArray(sessions) ? sessions : []).filter((s) => s.status === 'active');

  if (active.length === 0) {
    return (
      <div className="text-[11.5px] text-foreground-subtle italic px-1">
        No agents connected.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {active.map((session) => (
        <div
          key={session.sessionId}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.02] border border-white/[0.04]"
        >
          <Radio size={10} className="text-green-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] text-foreground font-medium truncate">
              {session.agentType}
            </div>
            <div className="text-[10px] text-foreground-subtle">
              {session.model ?? 'unknown'} · {formatTimeSince(session.lastSeen)}
            </div>
          </div>
          {session.activePlanUid && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
              active
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function formatTimeSince(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

/**
 * Main dashboard component.
 */
export function ExecutionDashboard() {
  const plan = usePlanStore((s) => s.activePlan);
  const sessions = usePlanStore((s) => s.sessions);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['tasks', 'agents']),
  );

  const items = useMemo(() => Object.values(itemsByUid), [itemsByUid]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!plan) return null;

  // Quick stats
  const actions = items.filter((i) => i.kind === 'action');
  const inProgress = actions.filter((i) => i.status === 'in_progress' || i.status === 'assigned');
  const done = actions.filter((i) => i.status === 'done');
  const blocked = actions.filter((i) => i.status === 'blocked');

  return (
    <div className="p-3 space-y-4">
      {/* Quick stats bar */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex items-center gap-1.5">
          <Activity size={11} className="text-accent" />
          <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
            Live
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-[10.5px] text-foreground-subtle">
          {inProgress.length > 0 && (
            <span className="flex items-center gap-1 text-accent">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {inProgress.length} active
            </span>
          )}
          <span>{done.length}/{actions.length} done</span>
          {blocked.length > 0 && (
            <span className="text-red-400">{blocked.length} blocked</span>
          )}
        </div>
      </div>

      {/* Active tasks */}
      <Section
        title="Active tasks"
        icon={<Zap size={11} className="text-accent" />}
        count={inProgress.length}
        expanded={expandedSections.has('tasks')}
        onToggle={() => toggleSection('tasks')}
      >
        <ActiveTasks items={items} />
      </Section>

      {/* Connected agents */}
      <Section
        title="Agents"
        icon={<Cpu size={11} className="text-green-400" />}
        count={(Array.isArray(sessions) ? sessions : []).filter((s) => s.status === 'active').length}
        expanded={expandedSections.has('agents')}
        onToggle={() => toggleSection('agents')}
      >
        <ConnectedAgents sessions={sessions} />
      </Section>
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left px-1 py-1 hover:bg-white/[0.02] rounded transition-colors"
      >
        <Chevron size={10} className="text-zinc-500" />
        {icon}
        <span className="text-[11px] font-medium text-foreground-muted uppercase tracking-wider">
          {title}
        </span>
        {typeof count === 'number' && count > 0 && (
          <span className="text-[10px] text-foreground-subtle">{count}</span>
        )}
      </button>
      {expanded && <div className="mt-1.5">{children}</div>}
    </div>
  );
}
