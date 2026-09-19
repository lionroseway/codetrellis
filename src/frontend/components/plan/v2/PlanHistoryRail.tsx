/**
 * Plan History Rail — Phase 6.2 + 6.3.
 *
 * Time-travel slider for plans: shows commits that touched the plan's
 * manifest, lets the user select one to view the plan as it stood at
 * that point. Includes a search box for decision archaeology (6.3).
 *
 * Rendered as a drawer within the plan workspace.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  History,
  GitCommit,
  
  Search,
  
  
  Diff,
  User,
  Bot,
  X,
} from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';

interface CommitEntry {
  hash: string;
  timestamp: string;
  author: string;
  subject: string;
  agentAttribution?: { agentType: string; model?: string } | null;
}

interface HistoricalPlanState {
  commitHash: string;
  timestamp: string;
  plan: { uid: string; title: string; status: string; description?: string } | null;
  items: Array<{ uid: string; title: string; kind: string; status?: string; visibility?: string; assignee?: string }>;
}

interface DiffResult {
  added: Array<{ uid: string; title: string }>;
  removed: Array<{ uid: string; title: string }>;
  modified: Array<{ uid: string; title: string; fields: Array<{ field: string; before: unknown; after: unknown }> }>;
  planMetaChanged: boolean;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function PlanHistoryRail({
  planSlug,
  onClose,
}: {
  planSlug: string;
  onClose?: () => void;
}) {
  const projectPath = useProjectStore((s) => s.root);
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HistoricalPlanState | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CommitEntry[] | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  // Fetch commit history
  const fetchHistory = useCallback(async () => {
    if (!projectPath || !planSlug) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/plan-history/${encodeURIComponent(planSlug)}?project=${encodeURIComponent(projectPath)}&limit=50`,
      );
      if (res.ok) {
        const data = await res.json();
        setCommits(data.commits ?? []);
      }
    } catch { /* non-git project */ }
    finally { setLoading(false); }
  }, [projectPath, planSlug]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Fetch snapshot when a commit is selected
  useEffect(() => {
    if (!projectPath || !planSlug || !selectedHash) {
      setSnapshot(null);
      setDiff(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/plan-history/${encodeURIComponent(planSlug)}/at/${selectedHash}?project=${encodeURIComponent(projectPath)}`,
        );
        if (res.ok) setSnapshot(await res.json());
      } catch { /* ignore */ }

      // Also compute diff vs HEAD
      if (showDiff) {
        try {
          const dRes = await fetch(
            `/api/plan-history/${encodeURIComponent(planSlug)}/diff?project=${encodeURIComponent(projectPath)}&base=${selectedHash}&head=HEAD`,
          );
          if (dRes.ok) setDiff(await dRes.json());
        } catch { /* ignore */ }
      }
    })();
  }, [projectPath, planSlug, selectedHash, showDiff]);

  // Search (6.3 decision archaeology)
  const handleSearch = useCallback(async () => {
    if (!projectPath || !planSlug || !searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/plan-history/${encodeURIComponent(planSlug)}/search?project=${encodeURIComponent(projectPath)}&q=${encodeURIComponent(searchQuery)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results ?? []);
      }
    } catch { /* ignore */ }
  }, [projectPath, planSlug, searchQuery]);

  const displayCommits = searchResults ?? commits;

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <History size={14} className="text-accent" />
          <span className="text-xs font-medium text-foreground">Plan History</span>
          {commits.length > 0 && (
            <span className="text-[10px] text-foreground-subtle">({commits.length} commits)</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowDiff(!showDiff)}
            className={`p-1 rounded text-xs ${showDiff ? 'text-accent bg-accent-muted' : 'text-foreground-muted hover:text-foreground'}`}
            title="Toggle diff view"
          >
            <Diff size={12} />
          </button>
          {onClose && (
            <button onClick={onClose} className="p-1 text-foreground-muted hover:text-foreground rounded">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Search bar (6.3) */}
      <div className="px-3 py-1.5 border-b border-border/50">
        <div className="flex items-center gap-1 bg-surface-raised rounded px-2 py-1">
          <Search size={11} className="text-foreground-subtle shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search plan history…"
            className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-foreground-subtle outline-none"
          />
          {searchResults && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults(null); }}
              className="text-foreground-subtle hover:text-foreground"
            >
              <X size={10} />
            </button>
          )}
        </div>
        {searchResults && (
          <div className="text-[10px] text-foreground-subtle mt-1">
            {searchResults.length} commit{searchResults.length !== 1 ? 's' : ''} match "{searchQuery}"
          </div>
        )}
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-foreground-muted text-xs">Loading…</div>
        ) : displayCommits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-foreground-muted text-xs gap-1">
            <History size={20} className="text-foreground-subtle" />
            <span>{searchResults ? 'No matching commits' : 'No commit history'}</span>
          </div>
        ) : (
          displayCommits.map((c) => (
            <button
              key={c.hash}
              onClick={() => setSelectedHash(selectedHash === c.hash ? null : c.hash)}
              className={`w-full text-left px-3 py-2 border-b border-border/30 transition-colors ${
                selectedHash === c.hash
                  ? 'bg-accent-muted border-l-2 border-l-accent'
                  : 'hover:bg-surface-hover border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <GitCommit size={11} className="text-foreground-subtle shrink-0" />
                <span className="text-[11px] text-foreground truncate flex-1">{c.subject}</span>
                <span className="text-[10px] text-foreground-subtle shrink-0">{relativeTime(c.timestamp)}</span>
              </div>
              <div className="flex items-center gap-1 mt-0.5 ml-4">
                {c.agentAttribution ? (
                  <Bot size={9} className="text-cyan-400" />
                ) : (
                  <User size={9} className="text-foreground-subtle" />
                )}
                <span className="text-[10px] text-foreground-subtle">{c.author}</span>
                <span className="text-[10px] text-foreground-subtle font-mono">{c.hash.slice(0, 7)}</span>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Snapshot preview */}
      {snapshot && selectedHash && (
        <div className="border-t border-border max-h-[40%] overflow-y-auto">
          <div className="px-3 py-1.5 bg-surface-raised border-b border-border/50">
            <div className="text-[10px] font-medium text-foreground-subtle uppercase tracking-wider">
              Snapshot at {snapshot.commitHash.slice(0, 7)}
            </div>
            {snapshot.plan && (
              <div className="text-[11px] text-foreground mt-0.5">
                {snapshot.plan.title} · <span className="text-foreground-subtle">{snapshot.plan.status}</span>
              </div>
            )}
          </div>
          <div className="px-3 py-1">
            {snapshot.items.map((item) => (
              <div key={item.uid} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                <span className={item.kind === 'action' ? 'text-emerald-400' : 'text-blue-400'}>●</span>
                <span className="text-foreground truncate">{item.title}</span>
                {item.status && <span className="text-foreground-subtle text-[10px]">{item.status}</span>}
              </div>
            ))}
          </div>

          {/* Diff section */}
          {showDiff && diff && (
            <div className="px-3 py-1.5 border-t border-border/50">
              <div className="text-[10px] font-medium text-foreground-subtle uppercase tracking-wider mb-1">
                Changes since this commit
              </div>
              {diff.added.length > 0 && (
                <div className="text-[10px] text-emerald-400">
                  + {diff.added.length} added: {diff.added.map((a) => a.title).join(', ')}
                </div>
              )}
              {diff.removed.length > 0 && (
                <div className="text-[10px] text-red-400">
                  − {diff.removed.length} removed: {diff.removed.map((r) => r.title).join(', ')}
                </div>
              )}
              {diff.modified.length > 0 && (
                <div className="text-[10px] text-amber-400">
                  ∆ {diff.modified.length} modified: {diff.modified.map((m) => m.title).join(', ')}
                </div>
              )}
              {diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0 && (
                <div className="text-[10px] text-foreground-subtle">No item changes</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
