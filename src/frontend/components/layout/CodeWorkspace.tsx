import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { FileCode, GitBranch, GitCompare, Code2, History, Loader2, UserRound, X } from 'lucide-react';
import { LineHistoryCard } from './LineHistoryCard';
import { hunkAt, type LineHistoryData } from '../../lib/line-history';
import { useReplayStore } from '../../stores/replay-store';
import { EvolutionView } from './EvolutionView';
import { useSourceControlStore, groupOfFile, changeWords } from '../../stores/source-control-store';
import { GitCommand } from './SourceControlPanel';
import { useProjectStore } from '../../stores/project-store';
import { useUiStore } from '../../stores/ui-store';
import { CodePreview, type FileContent } from '../inspector/CodePreview';
import { PlaybackBar, type PlaybackFrame } from '../inspector/PlaybackBar';
import type { FileOverlay } from '../../lib/plan-overlay';
import { resolveSelectedFile } from '../../lib/selected-file';
import { openItemFromCode } from '../../lib/open-file-at';
import { gutterMarks } from '../../lib/line-marks';
import { lineCounts } from '@shared/lib/line-changes';
import type { WorkstreamLineChanges } from '@shared/types';
import { singleFlight } from '../../lib/single-flight';

const CodeDiffView = lazy(() =>
  import('../inspector/CodeDiffView').then((m) => ({ default: m.CodeDiffView })),
);

/**
 * The code-first workspace — Phase 26, layer D.
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * A peer of the graph, not a panel inside it. **When this is the active
 * mode the graph does not mount**, so its layout cost — dagre plus
 * d3-force over hundreds of nodes — is not paid at all.
 *
 * That is the point of the whole phase: the expensive thing is also the
 * optional thing, and every signal the graph draws is already per-file or
 * per-line. This shows the same information, cheaper to render, to people
 * who think in files.
 *
 * The three other layers all land here: the plan overlay on the lines,
 * the diff editor, and the transport bar driving both.
 */

type Mode = 'read' | 'diff' | 'evolution';

export function CodeWorkspace() {
  const root = useProjectStore((s) => s.root);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const selectedNodeKind = useUiStore((s) => s.selectedNodeKind);
  const selectedNodeMeta = useUiStore((s) => s.selectedNodeMeta);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);

  const [mode, setMode] = useState<Mode>('read');
  // Phase 32 B3.2 — this file's changed lines in every workstream, and the
  // copy "Compare with…" picked (null: the usual history diff).
  const [lineChanges, setLineChanges] = useState<WorkstreamLineChanges[] | null>(null);
  const [compareWith, setCompareWith] = useState<{ id: string; label: string } | null>(null);
  const ownBranch = useProjectStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.branch ?? null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [overlay, setOverlay] = useState<FileOverlay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [frames, setFrames] = useState<PlaybackFrame[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [showTimeline, setShowTimeline] = useState(false);
  // Phase 32 E4 — line history: on or off, read on demand, and the run chosen for its card.
  const [lineHistoryOn, setLineHistoryOn] = useState(false);
  const [lineHistory, setLineHistory] = useState<{ path: string; loading: boolean; error: string | null; data: LineHistoryData | null }>({ path: '', loading: false, error: null, data: null });
  const [chosenLine, setChosenLine] = useState<number | null>(null);
  // Where Evolution starts when the line card opens it at a commit.
  const [evolutionStart, setEvolutionStart] = useState<{ left: string; right: string } | null>(null);

  // A node id is not a path — see `resolveSelectedFile`, which holds the
  // rule for all four kinds because two of them used to be wrong here.
  const { filePath: selectedNode, explanation: nonFileSelection } = useMemo(
    () => resolveSelectedFile(selectedNodeId, selectedNodeKind, selectedNodeMeta),
    [selectedNodeId, selectedNodeKind, selectedNodeMeta],
  );

  const relativePath = useMemo(() => {
    if (!selectedNode || !root) return null;
    return selectedNode.startsWith('/') ? selectedNode.slice(root.length + 1) : selectedNode;
  }, [selectedNode, root]);

  const absPath = useMemo(() => {
    if (!selectedNode) return null;
    if (selectedNode.startsWith('/')) return selectedNode;
    return root ? `${root}/${selectedNode}` : selectedNode;
  }, [selectedNode, root]);

  // File contents + the plan overlay travel together: the overlay's item
  // count is shown before the source is read.
  useEffect(() => {
    if (!absPath || !root) {
      setContent(null);
      setOverlay(null);
      return;
    }
    setError(null);

    fetch(`/api/file/content?path=${encodeURIComponent(absPath)}&project=${encodeURIComponent(root)}`)
      .then((r) => r.json())
      .then((data) => (data?.error ? setError(data.error) : setContent(data)))
      .catch((err) => setError(String(err)));

    fetch(`/api/file/overlay?path=${encodeURIComponent(absPath)}&project=${encodeURIComponent(root)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setOverlay(data && !data.error ? data : null))
      .catch(() => setOverlay(null));
  }, [absPath, root]);

  // Phase 32 B3.2 — who else changes this file, line by line, from git.
  // Refetched when awareness changes (a workstream edited, committed, came
  // or went), which is when the answer can have moved.
  useEffect(() => {
    // A comparison is of one file: another file opens as source.
    setCompareWith((was) => {
      if (was) setMode('read');
      return null;
    });
    if (!relativePath || !root) { setLineChanges(null); return; }
    let cancelled = false;
    const load = singleFlight(() =>
      fetch(`/api/workstreams/changes?project=${encodeURIComponent(root)}&path=${encodeURIComponent(relativePath)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { changes?: WorkstreamLineChanges[] } | null) => { if (!cancelled) setLineChanges(data?.changes ?? null); })
        .catch(() => { if (!cancelled) setLineChanges(null); }));
    void load();
    window.addEventListener('awareness-changed', load);
    return () => { cancelled = true; window.removeEventListener('awareness-changed', load); };
  }, [relativePath, root]);

  // Phase 32 E1: a comparison picked in the Changes panel, for this file;
  // otherwise where this file's change is, so the diff is the one the graph
  // and the panel mean (an agent's commit since the baseline, not this
  // checkout's clean working tree against its last commit).
  const sourceControl = useSourceControlStore((s) => s.data);
  const pickedCompare = useSourceControlStore((s) => s.compare);
  const clearCompare = useSourceControlStore((s) => s.clearCompare);
  const picked = pickedCompare && pickedCompare.path === relativePath ? pickedCompare : null;
  const changeGroup = useMemo(() => groupOfFile(sourceControl, relativePath), [sourceControl, relativePath]);
  useEffect(() => {
    if (pickedCompare && pickedCompare.path !== relativePath) clearCompare();
  }, [relativePath, pickedCompare, clearCompare]);
  useEffect(() => {
    if (picked) { setCompareWith(null); setMode('diff'); }
  }, [picked]);

  const workMarks = useMemo(
    () => (lineChanges ? gutterMarks(lineChanges, root, (c) => c.branch ?? c.workstream.split(/[\\/]/).pop() ?? c.workstream) : null),
    [lineChanges, root],
  );
  // This copy, named for the diff: its branch where known.
  const ownName = workMarks?.ownChanges?.branch ?? ownBranch;

  /**
   * The comparand to diff against when the timeline is closed.
   *
   * It was hardcoded to `commit:HEAD`. In a directory that is not a git
   * repository — or one freshly `git init`-ed with no commit, both of
   * which the scanner accepts — `git show HEAD:<path>` fails, and
   * `readFileAt` cannot tell "no such ref" from "file not in that tree",
   * so it answers `content: null`. The diff view reads that as
   * `addedWholesale` and renders the entire file as an insertion badged
   * "added in this range".
   *
   * That is the confident wrong answer the compare module's header says
   * it refuses to give. The honest one is that this project has no
   * commits to compare against, so the default comes from the project's
   * real comparand list and falls back to the baseline.
   */
  const [defaultBefore, setDefaultBefore] = useState<string>('baseline');

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    fetch(`/api/comparands?project=${encodeURIComponent(root)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Array<{ spec: string; kind: string }> | null) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        const newestCommit = list.find((c) => c.kind === 'commit');
        const baseline = list.find((c) => c.kind === 'baseline');
        setDefaultBefore(newestCommit?.spec ?? baseline?.spec ?? 'live');
      })
      .catch(() => { if (!cancelled) setDefaultBefore('baseline'); });
    return () => { cancelled = true; };
  }, [root]);

  // The timeline is fetched only when it is opened — a repository's
  // history is not needed to read one file.
  useEffect(() => {
    if (!showTimeline || !root || frames.length > 0) return;
    fetch(`/api/playback?project=${encodeURIComponent(root)}`)
      .then((r) => r.json())
      .then((data: { frames?: PlaybackFrame[]; notes?: string[] }) => {
        setFrames(data.frames ?? []);
        setNotes(data.notes ?? []);
        setFrameIndex(Math.max((data.frames?.length ?? 1) - 1, 0));
      })
      .catch(() => setFrames([]));
  }, [showTimeline, root, frames.length]);

  /**
   * The comparand the diff reads as "before".
   *
   * While the timeline is open it follows the scrubber, so playing
   * forward walks the file through its own history. Otherwise it is the
   * last commit — not the baseline, which `scanProject` re-pins on every
   * run, making baseline → live empty right after a scan.
   */
  const diffBefore = showTimeline && frames[frameIndex]
    ? frames[frameIndex].spec
    // Committed since the baseline and clean now: against the baseline's commit, or there is nothing to see.
    : changeGroup?.kind === 'since-opened' ? changeGroup.before
      : defaultBefore;
  const diffSides = picked && !showTimeline
    ? { before: picked.before, after: picked.after, labels: picked.labels, words: `${picked.title}: ${picked.words}`, command: picked.command }
    : compareWith
      ? null
      : { before: diffBefore, after: 'live', labels: undefined as { before: string; after: string } | undefined, words: null as string | null, command: null as string | null };

  useEffect(() => {
    setChosenLine(null);
    if (!lineHistoryOn || !root || !relativePath) return;
    let cancelled = false;
    setLineHistory({ path: relativePath, loading: true, error: null, data: null });
    fetch(`/api/git/line-history?project=${encodeURIComponent(root)}&path=${encodeURIComponent(relativePath)}&at=live`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (cancelled) return;
        setLineHistory(r.ok
          ? { path: relativePath, loading: false, error: null, data: body as LineHistoryData }
          : { path: relativePath, loading: false, error: body?.error || `Server returned ${r.status}`, data: null });
      })
      .catch((e) => { if (!cancelled) setLineHistory({ path: relativePath, loading: false, error: e instanceof Error ? e.message : String(e), data: null }); });
    return () => { cancelled = true; };
  }, [lineHistoryOn, root, relativePath]);
  const lineData = lineHistory.path === relativePath ? lineHistory.data : null;
  const chosenHunk = lineData && chosenLine != null ? hunkAt(lineData, chosenLine) : null;

  if (!root) {
    return (
      <div className="h-full flex items-center justify-center text-[11px] text-foreground-subtle">
        Open a project to browse its code.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle">
        <FileCode size={13} className="text-blue-400 shrink-0" />
        <span className="text-[11px] font-mono text-foreground truncate">
          {relativePath ?? 'No file selected'}
        </span>

        {overlay && overlay.itemCount > 0 && (
          <span className="text-[9.5px] text-accent shrink-0">
            {overlay.itemCount} plan item{overlay.itemCount === 1 ? '' : 's'}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setMode('read')}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
            mode === 'read' ? 'bg-accent/10 text-accent' : 'text-foreground-subtle hover:text-foreground'
          }`}
        >
          <Code2 size={10} /> Source
        </button>
        <button
          onClick={() => setMode('diff')}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
            mode === 'diff' ? 'bg-accent/10 text-accent' : 'text-foreground-subtle hover:text-foreground'
          }`}
        >
          <GitCompare size={10} /> Diff
        </button>
        {/* Phase 32 E3: the file at two points, each scrubbing its own history. */}
        <button
          onClick={() => setMode('evolution')}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
            mode === 'evolution' ? 'bg-accent/10 text-accent' : 'text-foreground-subtle hover:text-foreground'
          }`}
          title="This file at two points side by side, each scrubbing back through its commits"
          data-testid="code-evolution"
        >
          <GitBranch size={10} /> Evolution
        </button>
        {/* Phase 32 E4: who wrote each line, as git blame does, and what CodeTrellis knows. */}
        <button
          onClick={() => { setLineHistoryOn((v) => !v); setMode('read'); }}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
            lineHistoryOn && mode === 'read' ? 'bg-accent/10 text-accent' : 'text-foreground-subtle hover:text-foreground'
          }`}
          title="Who wrote each line, and why (git blame)"
          aria-pressed={lineHistoryOn}
          data-testid="code-line-history"
        >
          <UserRound size={10} /> Line history
        </button>
        <button
          onClick={() => setShowTimeline((v) => !v)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
            showTimeline ? 'bg-accent/10 text-accent' : 'text-foreground-subtle hover:text-foreground'
          }`}
          title="Play the project's history forward"
        >
          <History size={10} /> Timeline
        </button>
        <button
          onClick={() => setWorkspaceMode('graph')}
          className="text-foreground-subtle hover:text-foreground p-1 rounded hover:bg-surface-hover transition-colors"
          title="Back to the graph"
        >
          <X size={12} />
        </button>
      </div>

      {relativePath && mode === 'read' && changeGroup && (
        <div className="px-3 py-1 border-b border-border-subtle flex items-center gap-2 text-[10.5px]" data-testid="code-changed-chip">
          <span className="text-amber-300">●</span>
          <span className="text-foreground-muted truncate">{changeWords(changeGroup)}</span>
          <button
            type="button"
            className="shrink-0 text-accent hover:underline"
            onClick={() => {
              const f = changeGroup.files.find((x) => x.path === relativePath);
              if (f && root) useSourceControlStore.getState().openCompare(root, changeGroup, f);
            }}
          >
            Show the diff
          </button>
        </div>
      )}

      {relativePath && workMarks && (
        <CodeWorkstreamStrip
          marks={workMarks}
          ownName={ownName}
          comparing={compareWith?.id ?? null}
          onCompare={(target) => { setCompareWith(target); setMode(target ? 'diff' : 'read'); }}
        />
      )}

      {showTimeline && (
        <div className="px-3 py-1.5 border-b border-border-subtle">
          <PlaybackBar frames={frames} index={frameIndex} onIndexChange={setFrameIndex} notes={notes} />
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        {nonFileSelection ? (
          // Not an error. The selection is real, it just is not a file —
          // saying "File not found" over an empty pane blamed the user's
          // click on the filesystem.
          <div className="text-[11px] text-foreground-subtle">{nonFileSelection}</div>
        ) : !relativePath ? (
          <div className="text-[11px] text-foreground-subtle">
            Pick a file from the sidebar to read it, see what the plan wants from it, and diff it
            against any point in the project's history.
          </div>
        ) : mode === 'evolution' ? (
          <EvolutionView key={evolutionStart ? `${evolutionStart.left}|${evolutionStart.right}` : 'pair'} root={root} relativePath={relativePath} start={evolutionStart} />
        ) : mode === 'read' ? (
          <>
          {lineHistoryOn && (lineHistory.loading || lineHistory.error || lineData) && (
            <div className="mb-1.5 flex items-center gap-2 text-[10px] text-foreground-subtle" data-testid="line-history-status">
              {lineHistory.loading && <><Loader2 size={10} className="animate-spin" /> Reading who wrote each line…</>}
              {lineHistory.error && <span className="text-danger">{lineHistory.error}</span>}
              {lineData && !lineHistory.loading && (
                <>
                  <span data-testid="line-history-words">
                    {lineData.hunks.length} run{lineData.hunks.length === 1 ? '' : 's'} of lines from {Object.keys(lineData.commits).length} commit{Object.keys(lineData.commits).length === 1 ? '' : 's'}
                    {lineData.uncommitted ? `; ${lineData.uncommitted} line${lineData.uncommitted === 1 ? '' : 's'} not yet committed` : ''}. Choose a run to see who and why.
                  </span>
                  <GitCommand command={lineData.command} className="" testId="line-history-command" />
                </>
              )}
            </div>
          )}
          {lineData && chosenHunk && (
            <LineHistoryCard
              data={lineData}
              hunk={chosenHunk}
              onClose={() => setChosenLine(null)}
              onEvolution={(sha) => { setEvolutionStart({ left: `commit:${sha}`, right: 'live' }); setMode('evolution'); }}
              onReplay={(at) => { void useReplayStore.getState().enter(root, at - 30 * 60_000, { to: at + 30 * 60_000 }); }}
              onOpenTask={(planUid, itemUid) => {
                void openItemFromCode(planUid, itemUid, { filePath: selectedNode!, line: chosenHunk.start, label: selectedNode!.split('/').pop() ?? 'the file' });
              }}
            />
          )}
          <CodePreview
            content={content}
            error={error}
            overlay={overlay}
            workMarks={workMarks}
            lineHistory={lineData ? { data: lineData, chosenLine, onChoose: setChosenLine } : null}
            // The banner has always been a button. Nothing ever gave it
            // anything to do, so "Rework the ledger wants this file" had
            // hover feedback and no behaviour — worse than not looking
            // clickable at all.
            highlightLine={selectedNodeMeta?.line}
            // Leaving a breadcrumb on the way out. Without it the only
            // route back was the top bar's Code button, which is a mode
            // toggle and does not know what you were reading — so "go
            // look at the item" cost you your place in the file.
            onOpenItem={(itemUid, planUid) => {
              void openItemFromCode(planUid, itemUid, {
                filePath: selectedNode!,
                line: selectedNodeMeta?.line ?? null,
                label: selectedNode!.split('/').pop() ?? 'the file',
              });
            }}
          />
          </>
        ) : (
          <>
          {/* What is compared with what, said before the editor loads. */}
          {diffSides?.words && (
            <p className="text-[10.5px] text-foreground-muted" data-testid="code-compare-words">{diffSides.words}</p>
          )}
          {diffSides?.command && <GitCommand command={diffSides.command} className="mb-2" testId="code-git-command" />}
          <Suspense
            fallback={<div className="text-[10.5px] text-foreground-subtle">Loading the diff editor…</div>}
          >
              <CodeDiffView
                projectPath={root}
                relativePath={relativePath}
                // Compare with another workstream's copy (B3.2): both sides
                // named, theirs before and this copy after.
                before={compareWith ? `workstream:${compareWith.id}` : diffSides!.before}
                after={compareWith ? 'live' : diffSides!.after}
                labels={compareWith ? { after: ownName ? `this copy (${ownName})` : 'this copy' } : diffSides?.labels}
              />
          </Suspense>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Phase 32 B3.2 — who else changes this file, above the code: each other
 * workstream with its line counts in words, or that no one else does, and
 * "Compare with…" to open their copy against this one.
 */
function CodeWorkstreamStrip({
  marks,
  ownName,
  comparing,
  onCompare,
}: {
  marks: ReturnType<typeof gutterMarks>;
  ownName: string | null;
  comparing: string | null;
  onCompare: (target: { id: string; label: string } | null) => void;
}) {
  const others = marks.otherChanges;
  const name = (c: WorkstreamLineChanges) => c.branch ?? c.workstream.split(/[\\/]/).pop() ?? c.workstream;
  // Main is always a choice (unless this copy is main); then each other workstream changing the file.
  const targets = [
    ...(ownName && ownName !== 'main' ? [{ id: 'main', label: 'main' }] : []),
    ...others.filter((c) => c.branch !== 'main').map((c) => ({ id: c.branch ?? c.workstream, label: name(c) })),
  ];
  const own = marks.ownChanges;
  return (
    <div data-testid="code-workstreams" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 border-b border-border-subtle text-[10.5px] text-foreground-subtle">
      {own && own.status === 'changed' && (
        <span data-testid="code-own-changes" title={`This copy against main: ${lineCounts(own.added, own.removed).words}`}>
          This copy: <span className="text-foreground-muted">{lineCounts(own.added, own.removed).short}</span>
        </span>
      )}
      {others.length === 0 ? (
        <span data-testid="code-no-others">No other workstream changes this file.</span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-2" data-testid="code-others">
          <span>Also changed in</span>
          {others.map((c) => {
            const counts = lineCounts(c.added, c.removed);
            const open = c.hunks.some((h) => !h.committed);
            const what = c.status === 'changed' ? counts.short : c.status.replace('-', ' ');
            return (
              <button
                key={c.workstream}
                data-testid="code-other"
                onClick={() => onCompare({ id: c.branch ?? c.workstream, label: name(c) })}
                title={c.status === 'changed'
                  ? `${name(c)}: ${counts.words}${open ? ', some not committed' : ''}. Compare its copy with this one.`
                  : `${name(c)} changes this file (${what}); no lines to show`}
                className="rounded border border-sky-400/25 bg-sky-500/10 px-1 font-mono text-sky-300 hover:bg-sky-500/20"
              >
                {name(c)} <span className="text-sky-200/80">{what}</span>{open ? <span className="text-amber-300/90"> · not committed</span> : null}
              </button>
            );
          })}
        </span>
      )}
      <div className="flex-1" />
      {targets.length > 0 && (
        <label className="flex items-center gap-1">
          <span>Compare with…</span>
          <select
            data-testid="compare-with"
            value={comparing ?? ''}
            onChange={(e) => {
              const t = targets.find((x) => x.id === e.target.value) ?? null;
              onCompare(t);
            }}
            className="bg-surface border border-border-subtle rounded px-1 py-0.5 text-[10.5px] text-foreground"
          >
            <option value="">(not comparing)</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
