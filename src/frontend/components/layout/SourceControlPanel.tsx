/**
 * Phase 32 E1 — the Changes panel: source control with no plan needed.
 *
 * As an editor's source control tab lists them: this checkout's staged,
 * unstaged and untracked files; what was committed since you opened the
 * project (an agent that commits leaves a clean working tree, and the
 * graph still shows its work); then each other worktree or branch, with
 * the agents in it. Picking a file opens the code view on its diff between
 * the group's two points, said in the header.
 */

import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, GitBranch, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useSourceControlStore, type SourceChangeStatus, type SourceGroup } from '../../stores/source-control-store';
import { ComparePair } from './RefPicker';

const REFRESH_MS = 10_000;

export const STATUS_MARK: Record<SourceChangeStatus, { letter: string; tone: string; words: string }> = {
  modified: { letter: 'M', tone: 'text-amber-300', words: 'modified' },
  added: { letter: 'A', tone: 'text-emerald-300', words: 'added' },
  untracked: { letter: 'U', tone: 'text-emerald-300', words: 'untracked' },
  deleted: { letter: 'D', tone: 'text-red-300', words: 'deleted' },
  renamed: { letter: 'R', tone: 'text-sky-300', words: 'renamed' },
};

const split = (p: string) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? { name: p, dir: '' } : { name: p.slice(i + 1), dir: p.slice(0, i) };
};

/** Keeps source control current while the sidebar is shown (its Changes count is on the tab). */
export function useSourceControlFeed(root: string | null) {
  const refresh = useSourceControlStore((s) => s.refresh);
  const refreshVersion = useProjectStore((s) => s.refreshVersion);
  useEffect(() => {
    const run = () => { void refresh(root); };
    run();
    if (!root) return;
    window.addEventListener('workstreams-changed', run);
    window.addEventListener('awareness-changed', run);
    window.addEventListener('focus', run);
    const id = setInterval(run, REFRESH_MS);
    return () => {
      window.removeEventListener('workstreams-changed', run);
      window.removeEventListener('awareness-changed', run);
      window.removeEventListener('focus', run);
      clearInterval(id);
    };
  }, [root, refresh, refreshVersion]);
}

/**
 * The git command that lists what a group shows (Track E: beginners and
 * advanced users alike). Small and quiet, to learn from or to copy.
 */
export function GitCommand({ command, className = 'px-5 pb-1', testId = 'sc-git-command' }: { command: string; className?: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <code className="truncate font-mono text-[9.5px] text-foreground-subtle/80" data-testid={testId} title={command}>$ {command}</code>
      <button
        type="button"
        className="shrink-0 p-0.5 rounded text-foreground-subtle hover:text-foreground"
        title="Copy the command"
        aria-label="Copy the command"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {});
        }}
      >
        {copied ? <Check size={9} /> : <Copy size={9} />}
      </button>
    </div>
  );
}

function Group({ group, root, local }: { group: SourceGroup; root: string; local: boolean }) {
  const [open, setOpen] = useState(true);
  const compare = useSourceControlStore((s) => s.compare);
  const openCompare = useSourceControlStore((s) => s.openCompare);
  const Icon = group.kind === 'workstream' ? GitBranch : group.kind === 'since-opened' ? GitCommitHorizontal : null;
  return (
    <div data-testid="sc-group" data-kind={group.kind}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-1 px-1.5 py-1 text-[10.5px] text-foreground-muted hover:text-foreground rounded ${local ? '' : 'font-medium'}`}
        title={group.words}
      >
        {open ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
        {Icon && <Icon size={11} className="shrink-0 text-foreground-subtle" />}
        <span className="truncate" data-testid="sc-group-title">{group.title}</span>
        {group.git.term && (
          <span className="shrink-0 font-mono text-[9px] px-1 rounded bg-white/[0.05] text-foreground-subtle" data-testid="sc-git-term" title="What git calls it">{group.git.term}</span>
        )}
        {group.workstream?.agents.length ? (
          <span className="truncate text-[9.5px] text-accent/80">{group.workstream.agents.join(', ')}</span>
        ) : null}
        <span className="flex-1" />
        <span className="shrink-0 text-[9.5px] px-1.5 rounded-full bg-white/[0.06] tabular-nums">{group.files.length}{group.truncated ? '+' : ''}</span>
      </button>
      {open && (
        <div>
          <p className="px-5 text-[9.5px] text-foreground-subtle" data-testid="sc-group-words">{group.words}.</p>
          <GitCommand command={group.git.command} />
          <ul>
            {group.files.map((f) => {
              const mark = STATUS_MARK[f.status];
              const { name, dir } = split(f.path);
              const picked = compare?.groupId === group.id && compare.path === f.path;
              return (
                <li key={`${group.id}:${f.path}`}>
                  <button
                    type="button"
                    onClick={() => openCompare(root, group, f)}
                    data-testid="sc-file"
                    data-path={f.path}
                    className={`w-full flex items-center gap-1.5 pl-5 pr-1.5 py-[3px] text-[11.5px] rounded-md text-left ${
                      picked ? 'bg-accent-muted text-accent' : 'text-foreground-muted hover:bg-surface-hover'
                    }`}
                    title={`${f.path}: ${mark.words}${f.from ? ` from ${f.from}` : ''}. Opens its diff: ${group.words}.`}
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
        </div>
      )}
    </div>
  );
}

export function SourceControlPanel() {
  const root = useProjectStore((s) => s.root);
  const { data, loading, error, refresh } = useSourceControlStore();

  if (!root) return <div className="px-3 py-4 text-[11px] text-foreground-subtle">Open a project to see what has changed.</div>;

  const local = data?.groups.filter((g) => g.kind === 'staged' || g.kind === 'changes' || g.kind === 'untracked') ?? [];
  const since = data?.groups.filter((g) => g.kind === 'since-opened') ?? [];
  const others = data?.groups.filter((g) => g.kind === 'workstream') ?? [];

  return (
    <div className="flex flex-col min-h-0" data-testid="source-control">
      {data?.git && <ComparePair />}
      <div className="flex items-start gap-1.5 px-2.5 py-1.5">
        <span className="text-[10.5px] leading-snug text-foreground-muted" data-testid="sc-words">{data ? data.words : loading ? 'Reading git…' : ''}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => { void refresh(root); }}
          className="shrink-0 p-1 rounded text-foreground-subtle hover:text-foreground hover:bg-surface-hover"
          title="Read again"
          aria-label="Read again"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {error && <p className="px-3 pb-2 text-[10.5px] text-danger">Could not read source control: {error}</p>}
      {data?.git && (
        <div className="px-1 pb-2 space-y-1.5">
          <section>
            <div className="px-1.5 pt-1 pb-0.5 text-[9.5px] uppercase tracking-[0.1em] text-foreground-subtle" data-testid="sc-checkout">
              This checkout{data.branch ? ` · ${data.branch}` : ''}{data.head ? ` · ${data.head.sha}` : ''}
            </div>
            {local.length === 0
              ? <p className="px-3 py-0.5 text-[10.5px] text-foreground-subtle">No uncommitted changes.</p>
              : local.map((g) => <Group key={g.id} group={g} root={root} local />)}
          </section>
          {since.map((g) => (
            <section key={g.id}>
              <Group group={g} root={root} local={false} />
            </section>
          ))}
          {others.length > 0 && (
            <section>
              <div className="px-1.5 pt-1 pb-0.5 text-[9.5px] uppercase tracking-[0.1em] text-foreground-subtle">Other worktrees and branches</div>
              {others.map((g) => <Group key={g.id} group={g} root={root} local={false} />)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** How many files the Changes tab lists, each counted once per place it changed. */
export function changesCount(groups: readonly SourceGroup[] | undefined): number {
  return (groups ?? []).reduce((n, g) => n + g.files.length, 0);
}
