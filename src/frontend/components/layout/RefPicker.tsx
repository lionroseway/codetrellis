/**
 * Phase 32 E2 — compare any two points: a branch, a remote branch as last
 * fetched, a tag, another worktree as it is now, this checkout, or where two
 * of them split. One pair, chosen here, for the code view and the graph.
 *
 * Every point reads two ways (Track E): its name and what it is in plain
 * words, git's own word beside it, and the command that shows the same diff
 * beneath the files.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronDown, GitCompareArrows, Loader2, Search } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import {
  canSplit, useSourceControlStore, type GitRef, type RefListing, type RefPair,
} from '../../stores/source-control-store';
import { GitCommand, STATUS_MARK } from './SourceControlPanel';

/** A side's point among the listing, or a stand-in when it is not listed. */
function findRef(refs: RefListing | null, spec: string): GitRef | null {
  for (const g of refs?.groups ?? []) {
    const r = g.refs.find((x) => x.spec === spec);
    if (r) return r;
  }
  return null;
}

const ago = (ms: number | null) => {
  if (ms === null) return '';
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
};

/** One side: what it is, and a list of every point to choose from, grouped as git groups them. */
export function RefPicker({ side, value, onChange }: { side: 'before' | 'after'; value: string; onChange: (spec: string) => void }) {
  const refs = useSourceControlStore((s) => s.refs);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const chosen = findRef(refs, value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (refs?.groups ?? [])
      .map((g) => ({ ...g, refs: f ? g.refs.filter((r) => `${r.name} ${r.term} ${r.sha ?? ''} ${r.subject ?? ''}`.toLowerCase().includes(f)) : g.refs }))
      .filter((g) => g.refs.length > 0);
  }, [refs, filter]);

  return (
    <div className="relative min-w-0 flex-1" ref={box} data-testid="ref-picker" data-side={side}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-surface text-left hover:border-accent-glow"
        title={chosen ? `${chosen.name}: ${chosen.words}` : value}
        data-testid="ref-picker-open"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] uppercase tracking-[0.1em] text-foreground-subtle">{side === 'before' ? 'From' : 'To'}</span>
          <span className="flex items-center gap-1 min-w-0">
            <span className="truncate text-[11px] text-foreground" data-testid="ref-picker-name">{chosen?.name ?? value}</span>
            {chosen && <span className="shrink-0 font-mono text-[9px] px-1 rounded bg-white/[0.05] text-foreground-subtle">{chosen.term}</span>}
          </span>
        </span>
        <ChevronDown size={11} className="shrink-0 text-foreground-subtle" />
      </button>
      {open && (
        <div className="absolute z-30 left-0 mt-1 w-[300px] max-h-[360px] flex flex-col rounded-lg border border-border bg-surface shadow-xl" data-testid="ref-menu">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-subtle">
            <Search size={11} className="text-foreground-subtle shrink-0" />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a branch, tag or worktree"
              className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-foreground-subtle"
              data-testid="ref-filter"
            />
          </div>
          <div className="overflow-y-auto py-1">
            {groups.length === 0 && <p className="px-3 py-2 text-[10.5px] text-foreground-subtle">Nothing matches.</p>}
            {groups.map((g) => (
              <div key={g.kind}>
                <div className="flex items-baseline gap-1.5 px-2.5 pt-1.5 pb-0.5" title={g.words}>
                  <span className="text-[9.5px] uppercase tracking-[0.1em] text-foreground-subtle" data-testid="ref-group-title">{g.title}</span>
                  <code className="font-mono text-[9px] text-foreground-subtle/70">$ {g.git.command}</code>
                </div>
                {g.refs.map((r) => (
                  <button
                    key={r.spec}
                    type="button"
                    onClick={() => { onChange(r.spec); setOpen(false); setFilter(''); }}
                    className={`w-full flex items-center gap-1.5 px-2.5 py-1 text-left hover:bg-surface-hover ${r.spec === value ? 'text-accent' : 'text-foreground-muted'}`}
                    title={r.words}
                    data-testid="ref-option"
                    data-spec={r.spec}
                  >
                    <span className="truncate text-[11px]">{r.name}</span>
                    {r.current && <span className="shrink-0 text-[9px] text-accent">checked out</span>}
                    {r.agents?.length ? <span className="truncate text-[9.5px] text-accent/80">{r.agents.join(', ')}</span> : null}
                    <span className="flex-1" />
                    {r.sha && <span className="shrink-0 font-mono text-[9.5px] text-foreground-subtle">{r.sha}</span>}
                    {r.at !== null && <span className="shrink-0 w-7 text-right text-[9.5px] text-foreground-subtle tabular-nums">{ago(r.at)}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The default pair: this checkout's branch (or last commit) against the working copy. */
function defaultPair(refs: RefListing | null): RefPair {
  return { before: refs?.branch ? `commit:refs/heads/${refs.branch}` : 'commit:HEAD', after: 'live', fromSplit: false };
}

/**
 * Compare two points: the pickers, from where they split, what differs as a
 * file list, and the command. Picking a file opens its diff in the code view.
 */
export function ComparePair() {
  const root = useProjectStore((s) => s.root);
  const { refs, loadRefs, pair, pairResult, pairLoading, pairError, setPair, openPairFile, compare } = useSourceControlStore();
  const [open, setOpen] = useState(pair !== null);

  useEffect(() => { if (open && root) void loadRefs(root); }, [open, root, loadRefs]);
  useEffect(() => {
    if (open && root && !pair && refs) void setPair(root, defaultPair(refs));
  }, [open, root, pair, refs, setPair]);

  if (!root) return null;
  const change = (next: Partial<RefPair>) => {
    const p = { ...(pair ?? defaultPair(refs)), ...next };
    if (!canSplit(p)) p.fromSplit = false;
    void setPair(root, p);
  };

  return (
    <section className="px-1 pb-1.5 border-b border-border-subtle" data-testid="compare-pair">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-1.5 py-1.5 text-[10.5px] font-medium text-foreground-muted hover:text-foreground"
        data-testid="compare-pair-toggle"
        title="Compare any two points: branches, remote branches, tags, worktrees, or this checkout"
      >
        <GitCompareArrows size={12} className="shrink-0 text-foreground-subtle" />
        Compare two points
        <span className="flex-1" />
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="px-1.5 space-y-1.5">
          <div className="flex items-center gap-1">
            <RefPicker side="before" value={pair?.before ?? defaultPair(refs).before} onChange={(spec) => change({ before: spec })} />
            <button
              type="button"
              onClick={() => pair && change({ before: pair.after, after: pair.before })}
              className="shrink-0 p-1 rounded text-foreground-subtle hover:text-foreground hover:bg-surface-hover"
              title="Swap the two sides"
              aria-label="Swap the two sides"
              data-testid="compare-swap"
            >
              <ArrowLeftRight size={11} />
            </button>
            <RefPicker side="after" value={pair?.after ?? 'live'} onChange={(spec) => change({ after: spec })} />
          </div>
          <label
            className={`flex items-center gap-1.5 text-[10px] ${pair && canSplit(pair) ? 'text-foreground-muted' : 'text-foreground-subtle/60'}`}
            title="Only what the second side changed since the two split, as git's three dots (a...b) compare"
          >
            <input
              type="checkbox"
              disabled={!pair || !canSplit(pair)}
              checked={Boolean(pair?.fromSplit)}
              onChange={(e) => change({ fromSplit: e.target.checked })}
              data-testid="compare-from-split"
            />
            From where they split
            <span className="font-mono text-[9px] text-foreground-subtle">merge base</span>
          </label>
          {pairLoading && (
            <p className="flex items-center gap-1 text-[10px] text-foreground-subtle" data-testid="pair-loading"><Loader2 size={10} className="animate-spin" /> Comparing…</p>
          )}
          {pairError && <p className="text-[10.5px] text-danger" data-testid="pair-error">{pairError}</p>}
          {pairResult && !pairLoading && (
            <>
              <p className="text-[10.5px] leading-snug text-foreground-muted" data-testid="pair-words">{pairResult.words}</p>
              {pairResult.command && <GitCommand command={pairResult.command} className="pb-0.5" testId="pair-git-command" />}
              <ul>
                {pairResult.files.map((f) => {
                  const mark = STATUS_MARK[f.status];
                  const i = f.path.lastIndexOf('/');
                  const name = i < 0 ? f.path : f.path.slice(i + 1);
                  const dir = i < 0 ? '' : f.path.slice(0, i);
                  const picked = compare?.groupId === 'pair' && compare.path === f.path;
                  return (
                    <li key={f.path}>
                      <button
                        type="button"
                        onClick={() => openPairFile(root, f)}
                        className={`w-full flex items-center gap-1.5 pl-2 pr-1.5 py-[3px] text-[11.5px] rounded-md text-left ${picked ? 'bg-accent-muted text-accent' : 'text-foreground-muted hover:bg-surface-hover'}`}
                        title={`${f.path}: ${mark.words}${f.from ? ` from ${f.from}` : ''}`}
                        data-testid="pair-file"
                        data-path={f.path}
                      >
                        <span className="truncate">{name}</span>
                        {dir && <span className="truncate text-[10px] text-foreground-subtle">{dir}</span>}
                        <span className="flex-1" />
                        <span className={`shrink-0 font-mono text-[10px] font-semibold ${mark.tone}`} aria-label={mark.words}>{mark.letter}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
