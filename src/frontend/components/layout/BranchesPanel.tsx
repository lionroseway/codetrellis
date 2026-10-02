/**
 * Phase 32 E5 — branches and pull requests, in the Changes tab.
 *
 * Every branch here with its upstream and how far ahead and behind it is,
 * the remote branches as last fetched, and the pull requests as gh last
 * read them. Fetch now reaches the remotes; keeping them current is a
 * setting (Settings → Git, off by default), said here either way. Each row
 * reads plainly first, then in git's words, and picking one compares it in
 * "Compare two points" above.
 */

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, GitBranch, GitCompareArrows, GitPullRequest, Loader2, RefreshCw } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useSourceControlStore, type RefPair } from '../../stores/source-control-store';
import { pullPair, useBranchesStore, type BranchListing, type BranchRow, type PullRequest } from '../../stores/branches-store';
import { GitCommand } from './SourceControlPanel';

const ago = (ms: number | null) => {
  if (ms === null) return '';
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
};

const STATE: Record<PullRequest['state'], { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'border-emerald-400/40 text-emerald-300' },
  draft: { label: 'Draft', tone: 'border-white/20 text-foreground-subtle' },
  merged: { label: 'Merged', tone: 'border-violet-400/40 text-violet-300' },
  closed: { label: 'Closed', tone: 'border-red-400/40 text-red-300' },
};

function Heading({ title, command }: { title: string; command: string }) {
  return (
    <div className="flex items-baseline gap-1.5 px-1.5 pt-1.5">
      <span className="text-[9.5px] uppercase tracking-[0.1em] text-foreground-subtle" data-testid="br-heading">{title}</span>
      <span className="min-w-0 flex-1"><GitCommand command={command} className="" testId="br-command" /></span>
    </div>
  );
}

/** The pair a branch row compares: this checkout's branch against it, from where they split; the checked-out branch against its upstream. */
function pairFor(row: BranchRow, listing: BranchListing): RefPair {
  if (row.current && row.upstream) return { before: `commit:refs/remotes/${row.upstream}`, after: row.spec, fromSplit: false };
  return { before: listing.branch ? `commit:refs/heads/${listing.branch}` : 'commit:HEAD', after: row.spec, fromSplit: true };
}

function Branch({ row, onCompare }: { row: BranchRow; onCompare: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onCompare}
        className="w-full text-left px-2 py-1 rounded-md hover:bg-surface-hover"
        title={row.current && row.upstream ? `Compare ${row.upstream} with your ${row.name}` : `Compare ${row.name} with this checkout, from where they split`}
        data-testid="br-row"
        data-name={row.name}
      >
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-[11.5px] ${row.current ? 'text-foreground' : 'text-foreground-muted'}`}>{row.name}</span>
          {row.current && <span className="shrink-0 text-[9px] text-accent">checked out</span>}
          <span className="flex-1" />
          {row.ahead ? <span className="shrink-0 flex items-center text-[9.5px] text-amber-300 tabular-nums" aria-label={`${row.ahead} ahead`}><ArrowUp size={9} />{row.ahead}</span> : null}
          {row.behind ? <span className="shrink-0 flex items-center text-[9.5px] text-sky-300 tabular-nums" aria-label={`${row.behind} behind`}><ArrowDown size={9} />{row.behind}</span> : null}
          {row.at !== null && <span className="shrink-0 w-7 text-right text-[9.5px] text-foreground-subtle tabular-nums">{ago(row.at)}</span>}
        </div>
        {/* The plain sentence is the point, so it wraps rather than being cut. */}
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-[10px] leading-snug text-foreground-subtle" data-testid="br-words">{row.words}</span>
          <span className="font-mono text-[9px] px-1 rounded bg-white/[0.05] text-foreground-subtle" data-testid="br-term" title="What git calls it">{row.term}</span>
        </div>
      </button>
    </li>
  );
}

function Pull({ pr, onCompare }: { pr: PullRequest; onCompare: (() => void) | null }) {
  const s = STATE[pr.state];
  return (
    <li className="px-2 py-1 rounded-md hover:bg-white/[0.02]" data-testid="br-pull" data-number={pr.number}>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-[10px] text-foreground-subtle">#{pr.number}</span>
        <span className="truncate text-[11.5px] text-foreground-muted" title={pr.title}>{pr.title}</span>
        <span className="flex-1" />
        <span className={`shrink-0 text-[9px] px-1.5 rounded-full border ${s.tone}`} data-testid="br-pull-state">{s.label}</span>
      </div>
      <p className="text-[10px] leading-snug text-foreground-subtle" data-testid="br-pull-words">{pr.words}</p>
      <div className="flex items-center gap-2 pt-0.5">
        {onCompare ? (
          <button type="button" onClick={onCompare} className="flex items-center gap-1 text-[10px] text-accent hover:underline" data-testid="br-pull-compare" title={`Compare ${pr.head} with ${pr.base}, from where they split`}>
            <GitCompareArrows size={10} /> Compare
          </button>
        ) : (
          <span className="text-[10px] text-foreground-subtle" title="Fetch to bring its branch here">Its branch is not fetched here</span>
        )}
        {pr.url && (
          <a href={pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] text-foreground-subtle hover:text-foreground" data-testid="br-pull-link">
            <ExternalLink size={10} /> On GitHub
          </a>
        )}
      </div>
    </li>
  );
}

export function BranchesPanel() {
  const root = useProjectStore((s) => s.root);
  const { listing, loading, error, fetching, fetchWords, fetchFailed, load, fetchNow } = useBranchesStore();
  const setPair = useSourceControlStore((s) => s.setPair);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !root) return;
    void load(root);
    const again = () => { void load(root); useSourceControlStore.getState().loadRefs(root); };
    window.addEventListener('git-remotes-changed', again);
    return () => window.removeEventListener('git-remotes-changed', again);
  }, [open, root, load]);

  if (!root) return null;
  const compare = (pair: RefPair) => { void setPair(root, pair); };
  const openPulls = listing?.pulls.pulls.filter((p) => p.state === 'open' || p.state === 'draft').length ?? 0;

  return (
    <section className="px-1 pb-1.5 border-b border-border-subtle" data-testid="branches">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-1.5 py-1.5 text-[10.5px] font-medium text-foreground-muted hover:text-foreground"
        data-testid="branches-toggle"
        title="Branches here and on the remotes, and pull requests"
      >
        <GitBranch size={12} className="shrink-0 text-foreground-subtle" />
        <span className="min-w-0 truncate text-left">Branches and pull requests</span>
        <span className="flex-1" />
        {listing && (
          <span className="shrink-0 text-[9.5px] font-normal text-foreground-subtle tabular-nums" data-testid="branches-count" title={`${listing.branches.length} branches; ${openPulls} pull requests open`}>
            {listing.branches.length} · {openPulls} PR
          </span>
        )}
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="px-1.5 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-foreground-muted" data-testid="br-fetched">
              {listing ? listing.fetch.words : loading ? 'Reading git…' : ''}
            </span>
            <button
              type="button"
              onClick={() => { void fetchNow(root); }}
              disabled={fetching || (listing !== null && listing.remotes.length === 0)}
              className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md border border-border text-[10px] text-foreground-muted hover:text-foreground hover:border-accent-glow disabled:opacity-50"
              title="Bring the remotes' branches here (git fetch), then read the pull requests (gh)"
              data-testid="br-fetch"
            >
              {fetching ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              {fetching ? 'Fetching…' : 'Fetch now'}
            </button>
          </div>
          {listing && <GitCommand command={listing.fetch.command} className="" testId="br-fetch-command" />}
          {fetchWords && <p className={`text-[10.5px] ${fetchFailed ? 'text-danger' : 'text-foreground-muted'}`} data-testid="br-fetch-words">{fetchWords}</p>}
          {listing && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('open-settings', { detail: { section: 'git' } }))}
              className="block text-left text-[10px] leading-snug text-foreground-subtle hover:text-foreground"
              data-testid="br-auto"
              title="Settings → Git"
            >
              {listing.fetch.auto.words}
            </button>
          )}
          {error && <p className="text-[10.5px] text-danger">Could not read the branches: {error}</p>}
          {listing && (
            <>
              <Heading title="Branches" command={listing.commands.branches} />
              <ul data-testid="br-branches">
                {listing.branches.map((b) => <Branch key={b.spec} row={b} onCompare={() => compare(pairFor(b, listing))} />)}
              </ul>
              {listing.remoteBranches.length > 0 && (
                <>
                  <Heading title="Remote branches" command={listing.commands.remoteBranches} />
                  <ul data-testid="br-remote-branches">
                    {listing.remoteBranches.map((b) => <Branch key={b.spec} row={b} onCompare={() => compare(pairFor(b, listing))} />)}
                  </ul>
                </>
              )}
              <Heading title="Pull requests" command={listing.pulls.command} />
              <p className="flex items-start gap-1 px-2 text-[10.5px] leading-snug text-foreground-muted" data-testid="br-pulls-words">
                <GitPullRequest size={11} className="shrink-0 mt-px text-foreground-subtle" />
                {listing.pulls.words}
              </p>
              <ul data-testid="br-pulls">
                {listing.pulls.pulls.map((p) => {
                  const pair = p.compare ? pullPair(p.compare) : null;
                  return <Pull key={p.number} pr={p} onCompare={pair ? () => compare(pair) : null} />;
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
