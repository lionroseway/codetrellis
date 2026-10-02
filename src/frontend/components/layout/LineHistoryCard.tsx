/**
 * Phase 32 E4 — the card for a chosen run of lines: the commit, its git
 * author, and what CodeTrellis knows of who made it and how it knows; the
 * session, task and plan where known; and where to go next (how the file
 * changed around it, replay at that moment, the task).
 */

import { GitBranch, History, ListChecks, X } from 'lucide-react';
import { HOW_WORDS, type LineHistoryData, type LineHunk } from '../../lib/line-history';
import { GitCommand } from './SourceControlPanel';

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function LineHistoryCard({ data, hunk, onClose, onEvolution, onReplay, onOpenTask }: {
  data: LineHistoryData;
  hunk: LineHunk;
  onClose: () => void;
  onEvolution: (sha: string) => void;
  onReplay: (at: number) => void;
  onOpenTask: (planUid: string, itemUid: string) => void;
}) {
  const lines = hunk.start === hunk.end ? `Line ${hunk.start}` : `Lines ${hunk.start}–${hunk.end}`;
  const c = hunk.sha ? data.commits[hunk.sha] : null;
  return (
    <div className="mb-2 rounded-md border border-sky-400/30 bg-sky-400/[0.04] px-3 py-2 space-y-1" data-testid="line-card">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[11px] text-foreground" data-testid="line-card-subject">
          <span className="text-foreground-subtle">{lines}: </span>
          {c ? c.subject : 'changed in the working copy, not yet committed'}
        </p>
        <button type="button" onClick={onClose} className="shrink-0 p-0.5 rounded text-foreground-subtle hover:text-foreground" aria-label="Close" data-testid="line-card-close"><X size={11} /></button>
      </div>
      {c && (
        <>
          <p className="text-[10.5px] text-foreground-muted" data-testid="line-card-author">
            {c.author} &lt;{c.email}&gt; · {when(c.at)} · <span className="font-mono">{c.short}</span>
          </p>
          {c.attribution ? (
            <p className="text-[10.5px] text-accent" data-testid="line-card-attribution">
              {c.attribution.words}
              {c.attribution.sessionId ? <span className="text-foreground-subtle"> · session {c.attribution.sessionId}</span> : null}
              <span className="block text-[10px] text-foreground-subtle" data-testid="line-card-how">How CodeTrellis knows: {HOW_WORDS[c.attribution.how]}.</span>
            </p>
          ) : (
            <p className="text-[10.5px] text-foreground-subtle" data-testid="line-card-attribution">CodeTrellis knows only the git author for this commit.</p>
          )}
          {c.attribution?.task && (
            <p className="text-[10.5px] text-foreground-muted" data-testid="line-card-task">
              Worked on the task “{c.attribution.task.title}”{c.attribution.plan ? ` in the plan “${c.attribution.plan.title}”` : ''}.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button type="button" onClick={() => onEvolution(c.sha)} className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-[10px] text-foreground-muted hover:text-foreground" data-testid="line-card-evolution">
              <GitBranch size={10} /> How the file changed around it
            </button>
            <button type="button" onClick={() => onReplay(c.at)} className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-[10px] text-foreground-muted hover:text-foreground" data-testid="line-card-replay">
              <History size={10} /> Replay that moment
            </button>
            {c.attribution?.task && c.attribution.plan && (
              <button type="button" onClick={() => onOpenTask(c.attribution!.plan!.uid, c.attribution!.task!.uid)} className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-[10px] text-foreground-muted hover:text-foreground" data-testid="line-card-task-open">
                <ListChecks size={10} /> Open the task
              </button>
            )}
          </div>
          <GitCommand command={`git show ${c.short}`} className="" testId="line-card-command" />
        </>
      )}
    </div>
  );
}
