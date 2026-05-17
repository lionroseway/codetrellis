/**
 * Phase 17.A — Codebase Orientation.
 *
 * Shows a compact summary of the scanned codebase: file count, symbol
 * count, top directories, language breakdown, symbol kinds, and
 * most-imported files. Helps the user (or an agent reading a handoff)
 * understand the codebase shape before creating plan items.
 *
 * Fetches from GET /api/architecture-summary on mount. Shown on the
 * plan home page — collapsed by default when the plan has content,
 * expanded when the plan is empty.
 */

import { useEffect, useState } from 'react';
import {
  Compass,
  FolderTree,
  Code2,
  FileCode,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Layers,
  RefreshCw,
} from 'lucide-react';

interface ArchitectureSummary {
  fileCount: number;
  symbolCount: number;
  importCount: number;
  topDirectories: Array<{ dir: string; fileCount: number }>;
  languageBreakdown: Array<{ language: string; count: number }>;
  symbolsByKind: Array<{ kind: string; count: number }>;
  mostImported: Array<{ path: string; importerCount: number }>;
}

const LANG_COLORS: Record<string, string> = {
  typescript: 'bg-blue-400',
  tsx: 'bg-blue-300',
  javascript: 'bg-yellow-400',
  jsx: 'bg-yellow-300',
  python: 'bg-green-400',
  rust: 'bg-orange-400',
  php: 'bg-purple-400',
  java: 'bg-red-400',
};

const KIND_LABELS: Record<string, string> = {
  function: 'Functions',
  class: 'Classes',
  method: 'Methods',
  interface: 'Interfaces',
  type: 'Types',
  enum: 'Enums',
  variable: 'Variables',
  constant: 'Constants',
  export: 'Exports',
  import: 'Imports',
};

export function CodebaseOrientation({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const [data, setData] = useState<ArchitectureSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/architecture-summary');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  if (error && !data) {
    return null; // Silently hide if no data available (project not scanned yet)
  }

  if (!data) {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-[12px] text-foreground-subtle py-2">
          <RefreshCw size={12} className="animate-spin" />
          Loading codebase summary…
        </div>
      );
    }
    return null;
  }

  // Don't show if the database is empty (no files scanned)
  if (data.fileCount === 0) return null;

  const totalLangFiles = data.languageBreakdown.reduce((s, l) => s + l.count, 0);

  return (
    <div className="space-y-2">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <Compass size={13} className="text-cyan-400" />
        <span className="text-[12px] font-semibold text-foreground-muted uppercase tracking-wider flex-1">
          Codebase at a glance
        </span>
        {/* Quick stats always visible */}
        <span className="text-[11px] text-foreground-subtle tabular-nums">
          {data.fileCount.toLocaleString()} files · {data.symbolCount.toLocaleString()} symbols
        </span>
        {expanded ? (
          <ChevronUp size={11} className="text-foreground-subtle" />
        ) : (
          <ChevronDown size={11} className="text-foreground-subtle" />
        )}
      </button>

      {expanded && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4 space-y-5">
          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              icon={<FileCode size={14} className="text-blue-400" />}
              label="Files"
              value={data.fileCount}
            />
            <StatCard
              icon={<Code2 size={14} className="text-purple-400" />}
              label="Symbols"
              value={data.symbolCount}
            />
            <StatCard
              icon={<ArrowUpRight size={14} className="text-green-400" />}
              label="Imports"
              value={data.importCount}
            />
          </div>

          {/* Language breakdown — bar chart */}
          {data.languageBreakdown.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-foreground-subtle uppercase tracking-wider">
                Languages
              </div>
              {/* Stacked bar */}
              <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden flex">
                {data.languageBreakdown.map((l) => (
                  <div
                    key={l.language}
                    className={`h-full ${LANG_COLORS[l.language] ?? 'bg-zinc-500'} opacity-70 first:rounded-l-full last:rounded-r-full`}
                    style={{ width: `${(l.count / totalLangFiles) * 100}%` }}
                    title={`${l.language}: ${l.count} files`}
                  />
                ))}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {data.languageBreakdown.map((l) => (
                  <div key={l.language} className="flex items-center gap-1.5 text-[11px] text-foreground-subtle">
                    <div className={`w-2 h-2 rounded-sm ${LANG_COLORS[l.language] ?? 'bg-zinc-500'} opacity-70`} />
                    <span>{l.language}</span>
                    <span className="text-foreground-subtle/60 tabular-nums">{l.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two-column: top directories + symbol kinds */}
          <div className="grid grid-cols-2 gap-4">
            {/* Top directories */}
            {data.topDirectories.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-foreground-subtle uppercase tracking-wider flex items-center gap-1.5">
                  <FolderTree size={11} />
                  Top directories
                </div>
                <div className="space-y-0.5">
                  {data.topDirectories.slice(0, 8).map((d) => (
                    <div key={d.dir} className="flex items-center gap-2 text-[11.5px]">
                      <span className="text-foreground-muted font-mono truncate flex-1">
                        {d.dir}/
                      </span>
                      <span className="text-foreground-subtle/60 tabular-nums shrink-0">
                        {d.fileCount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Symbol breakdown */}
            {data.symbolsByKind.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-foreground-subtle uppercase tracking-wider flex items-center gap-1.5">
                  <Layers size={11} />
                  Symbol breakdown
                </div>
                <div className="space-y-0.5">
                  {data.symbolsByKind.slice(0, 8).map((s) => (
                    <div key={s.kind} className="flex items-center gap-2 text-[11.5px]">
                      <span className="text-foreground-muted truncate flex-1">
                        {KIND_LABELS[s.kind] ?? s.kind}
                      </span>
                      <span className="text-foreground-subtle/60 tabular-nums shrink-0">
                        {s.count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Most imported files — highest fan-in */}
          {data.mostImported.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-foreground-subtle uppercase tracking-wider">
                Most-imported files (highest fan-in)
              </div>
              <div className="space-y-0.5">
                {data.mostImported.slice(0, 6).map((m) => (
                  <div key={m.path} className="flex items-center gap-2 text-[11.5px]">
                    <FileCode size={10} className="text-foreground-subtle/40 shrink-0" />
                    <span className="text-foreground-muted font-mono truncate flex-1">
                      {m.path}
                    </span>
                    <span className="text-foreground-subtle/60 tabular-nums shrink-0">
                      {m.importerCount} importers
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Refresh button */}
          <button
            onClick={fetchSummary}
            disabled={loading}
            className="flex items-center gap-1.5 text-[11px] text-foreground-subtle hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/[0.05] bg-white/[0.02]">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-foreground tabular-nums">
          {value.toLocaleString()}
        </div>
        <div className="text-[10px] text-foreground-subtle uppercase tracking-wider">
          {label}
        </div>
      </div>
    </div>
  );
}
