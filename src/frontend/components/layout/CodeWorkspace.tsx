import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { FileCode, GitCompare, Code2, History, X } from 'lucide-react';
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

type Mode = 'read' | 'diff';

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
    const load = () => {
      fetch(`/api/workstreams/changes?project=${encodeURIComponent(root)}&path=${encodeURIComponent(relativePath)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { changes?: WorkstreamLineChanges[] } | null) => { if (!cancelled) setLineChanges(data?.changes ?? null); })
        .catch(() => { if (!cancelled) setLineChanges(null); });
    };
    load();
    window.addEventListener('awareness-changed', load);
    return () => { cancelled = true; window.removeEventListener('awareness-changed', load); };
  }, [relativePath, root]);

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
    : defaultBefore;

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
        ) : mode === 'read' ? (
          <CodePreview
            content={content}
            error={error}
            overlay={overlay}
            workMarks={workMarks}
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
        ) : (
          <Suspense
            fallback={<div className="text-[10.5px] text-foreground-subtle">Loading the diff editor…</div>}
          >
            <CodeDiffView
              projectPath={root}
              relativePath={relativePath}
              // Compare with another workstream's copy (B3.2): both sides
              // named, theirs before and this copy after.
              before={compareWith ? `workstream:${compareWith.id}` : diffBefore}
              after="live"
              labels={compareWith ? { after: ownName ? `this copy (${ownName})` : 'this copy' } : undefined}
            />
          </Suspense>
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
