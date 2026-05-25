/**
 * Team Activity Panel — Phase 6.1.
 *
 * A "what happened recently" feed drawn from the git history of the
 * .codetrellis/ manifest directory. Shows who created, updated, or
 * deleted plans, items, channel events, system docs, and config.
 *
 * Accessible from the plan workspace as a drawer/tab.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Clock,
  FilePlus,
  FileEdit,
  Trash2,
  FileText,
  MessageSquare,
  Settings,
  Package,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';

interface ActivityEntry {
  timestamp: string;
  author: string;
  agentAttribution?: { agentType: string; model?: string } | null;
  action: string;
  entityType: string;
  entityTitle: string;
  planSlug: string | null;
  commitHash: string;
  commitSubject: string;
}

const ACTION_ICONS: Record<string, typeof FilePlus> = {
  created: FilePlus,
  updated: FileEdit,
  deleted: Trash2,
  resolved: MessageSquare,
  dismissed: MessageSquare,
  verified: FileText,
};

const ENTITY_COLORS: Record<string, string> = {
  plan: 'text-blue-400',
  item: 'text-emerald-400',
  'channel-event': 'text-amber-400',
  'system-doc': 'text-purple-400',
  config: 'text-zinc-400',
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 604_800_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function TeamActivityPanel({ onClose }: { onClose?: () => void }) {
  const projectPath = useProjectStore((s) => s.root);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [daysBack, setDaysBack] = useState(7);

  const fetchActivity = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
      const res = await fetch(`/api/team-activity?project=${encodeURIComponent(projectPath)}&since=${since}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch {
      // silently fail — non-git projects won't have activity
    } finally {
      setLoading(false);
    }
  }, [projectPath, daysBack]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  // Group entries by date
  const grouped = groupByDate(entries);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent" />
          <span className="text-xs font-medium text-foreground">Team Activity</span>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={daysBack}
            onChange={(e) => setDaysBack(Number(e.target.value))}
            className="text-[10px] bg-surface-raised text-foreground-muted border border-border rounded px-1 py-0.5"
          >
            <option value={1}>Last 24h</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button
            onClick={fetchActivity}
            className="p-1 text-foreground-muted hover:text-foreground rounded"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-foreground-muted hover:text-foreground rounded"
              title="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-foreground-muted text-xs">
            Loading activity…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-foreground-muted text-xs gap-1">
            <Activity size={20} className="text-foreground-subtle" />
            <span>No manifest activity found</span>
            <span className="text-[10px]">Commits touching .codetrellis/ will appear here</span>
          </div>
        ) : (
          <div className="py-1">
            {grouped.map(([dateLabel, dayEntries]) => (
              <div key={dateLabel}>
                <div className="sticky top-0 bg-surface px-3 py-1 text-[10px] font-medium text-foreground-subtle uppercase tracking-wider border-b border-border/50">
                  {dateLabel}
                </div>
                {dayEntries.map((entry, i) => (
                  <ActivityRow key={`${entry.commitHash}-${i}`} entry={entry} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const Icon = ACTION_ICONS[entry.action] ?? FileEdit;
  const entityColor = ENTITY_COLORS[entry.entityType] ?? 'text-foreground-muted';

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors group">
      <div className="mt-0.5 shrink-0">
        <Icon size={12} className={entityColor} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[11px]">
          <span className="font-medium text-foreground truncate">{entry.author}</span>
          <span className="text-foreground-subtle">{entry.action}</span>
          <span className={`truncate ${entityColor}`}>{entry.entityTitle}</span>
        </div>
        {entry.planSlug && (
          <div className="flex items-center gap-1 text-[10px] text-foreground-subtle mt-0.5">
            <Package size={9} />
            <span className="truncate">{entry.planSlug}</span>
          </div>
        )}
      </div>
      <div className="shrink-0 text-[10px] text-foreground-subtle flex items-center gap-1">
        <Clock size={9} />
        {relativeTime(entry.timestamp)}
      </div>
    </div>
  );
}

function groupByDate(entries: ActivityEntry[]): [string, ActivityEntry[]][] {
  const groups = new Map<string, ActivityEntry[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();

  for (const entry of entries) {
    const dateStr = new Date(entry.timestamp).toDateString();
    let label: string;
    if (dateStr === today) label = 'Today';
    else if (dateStr === yesterday) label = 'Yesterday';
    else label = new Date(entry.timestamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    const existing = groups.get(label);
    if (existing) existing.push(entry);
    else groups.set(label, [entry]);
  }

  return Array.from(groups.entries());
}
