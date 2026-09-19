import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { FileCode, GitCompare, Code2, History, X } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useUiStore } from '../../stores/ui-store';
import { CodePreview, type FileContent } from '../inspector/CodePreview';
import { PlaybackBar, type PlaybackFrame } from '../inspector/PlaybackBar';
import type { FileOverlay } from '../../lib/plan-overlay';

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

  /**
   * A node id is not a path.
   *
   * `selectedNodeId` carries whatever the graph selected: a file path,
   * but also `/abs/path/file.ts::function:foo` for a symbol and a
   * directory path from the sidebar. This surface read all three as
   * paths, so clicking a symbol in graph mode and switching to Code mode
   * fetched a file that cannot exist and rendered "File not found" over
   * an empty pane; a directory produced "Path is a directory". The
   * inspector has routed on `kind` since it was written — this did not.
   */
  const selectedNode = useMemo(() => {
    if (selectedNodeKind === 'symbol') return selectedNodeMeta.parentFilePath ?? null;
    if (selectedNodeKind === 'directory' || selectedNodeKind === 'cluster') return null;
    return selectedNodeId;
  }, [selectedNodeId, selectedNodeKind, selectedNodeMeta]);

  /** What to say instead of an error when the selection has no file. */
  const nonFileSelection =
    selectedNodeId && !selectedNode
      ? selectedNodeKind === 'directory'
        ? 'That is a directory. Pick a file inside it to read it.'
        : 'That selection groups several files. Pick one of them to read it.'
      : null;

  const [mode, setMode] = useState<Mode>('read');
  const [content, setContent] = useState<FileContent | null>(null);
  const [overlay, setOverlay] = useState<FileOverlay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [frames, setFrames] = useState<PlaybackFrame[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [showTimeline, setShowTimeline] = useState(false);

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
          <CodePreview content={content} error={error} overlay={overlay} />
        ) : (
          <Suspense
            fallback={<div className="text-[10.5px] text-foreground-subtle">Loading the diff editor…</div>}
          >
            <CodeDiffView
              projectPath={root}
              relativePath={relativePath}
              before={diffBefore}
              after="live"
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
