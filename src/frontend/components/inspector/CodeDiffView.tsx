import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { AlertTriangle, Columns2, Loader2, Rows3 } from 'lucide-react';
import { languageExtensionFor, languageForPath } from '../../lib/codemirror-lang';

/**
 * The diff editor — Phase 26, layer B.
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * A real before/after for one file between any two points, rather than a
 * gutter mark saying a line changed. The comparands come from Phase 25,
 * so this introduces no new concept — it is the same picker the graph
 * uses, applied to one file.
 *
 * ## What it refuses to do
 *
 * A checkpoint and the baseline store content **hashes**, not blobs. They
 * can say which files changed, never how. When a side cannot supply
 * contents this renders the reason instead of a diff — falling back to
 * the live file would diff a file against itself and render as "no
 * changes", which is a confident wrong answer where the honest one is
 * "cannot".
 */

export interface FileAtResult {
  ok: boolean;
  content: string | null;
  unavailable?: string;
  label: string;
}

interface Props {
  projectPath: string;
  /** Project-relative path. */
  relativePath: string;
  /** Comparand specs — `live`, `commit:<ref>`, `checkpoint:<id>`, `baseline`. */
  before: string;
  after: string;
  /** Language tag; inferred from the path when omitted. */
  language?: string | null;
  authHeaders?: Record<string, string>;
}

type Layout = 'split' | 'unified';

/** Dark theme tuned to the app's surface, so the diff does not look bolted on. */
const THEME: Extension = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', fontSize: '11px' },
    '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'rgba(255,255,255,0.28)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-changedLine': { backgroundColor: 'rgba(245,158,11,0.10)' },
    '.cm-insertedLine': { backgroundColor: 'rgba(16,185,129,0.12)' },
    '.cm-deletedChunk': { backgroundColor: 'rgba(244,63,94,0.10)' },
    '.cm-scroller': { overflow: 'auto', maxHeight: '460px' },
  },
  { dark: true },
);

async function fetchFileAt(
  projectPath: string,
  relativePath: string,
  at: string,
  headers?: Record<string, string>,
): Promise<FileAtResult> {
  const url =
    `/api/file/at?project=${encodeURIComponent(projectPath)}` +
    `&path=${encodeURIComponent(relativePath)}&at=${encodeURIComponent(at)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, content: null, label: at, unavailable: body.error ?? `Request failed (${res.status})` };
  }
  return (await res.json()) as FileAtResult;
}

export function CodeDiffView({
  projectPath,
  relativePath,
  before,
  after,
  language,
  authHeaders,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const unifiedRef = useRef<EditorView | null>(null);

  const [layout, setLayout] = useState<Layout>('split');
  const [loading, setLoading] = useState(true);
  const [sides, setSides] = useState<{ before: FileAtResult; after: FileAtResult } | null>(null);

  const languageExt = useMemo(
    () => languageExtensionFor(language ?? languageForPath(relativePath)),
    [language, relativePath],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchFileAt(projectPath, relativePath, before, authHeaders),
      fetchFileAt(projectPath, relativePath, after, authHeaders),
    ])
      .then(([b, a]) => {
        if (cancelled) return;
        setSides({ before: b, after: a });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, relativePath, before, after, authHeaders]);

  useEffect(() => {
    if (!host.current || !sides) return;
    if (!sides.before.ok || !sides.after.ok) return;

    const base: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      THEME,
    ];
    if (languageExt) base.push(languageExt);

    const beforeDoc = sides.before.content ?? '';
    const afterDoc = sides.after.content ?? '';

    // Two genuinely different views, not one view with a cosmetic flag.
    // Neither offers accept/reject controls: this is a read-only review
    // of what already happened, not a merge conflict to resolve.
    if (layout === 'unified') {
      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: afterDoc,
          extensions: [
            ...base,
            unifiedMergeView({
              original: beforeDoc,
              highlightChanges: true,
              gutter: true,
              mergeControls: false,
              collapseUnchanged: { margin: 3, minSize: 6 },
            }),
          ],
        }),
      });
      unifiedRef.current = view;
      return () => {
        view.destroy();
        unifiedRef.current = null;
      };
    }

    const view = new MergeView({
      a: { doc: beforeDoc, extensions: base },
      b: { doc: afterDoc, extensions: base },
      parent: host.current,
      orientation: 'a-b',
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    mergeRef.current = view;

    return () => {
      view.destroy();
      mergeRef.current = null;
    };
  }, [sides, languageExt, layout]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-[10.5px] text-foreground-subtle">
        <Loader2 size={12} className="animate-spin" /> Loading both sides…
      </div>
    );
  }

  if (!sides) {
    return (
      <div className="rounded-md border border-red-500/20 bg-red-500/[0.04] px-3 py-2 text-[10.5px] text-red-200">
        Could not load this file.
      </div>
    );
  }

  // One side cannot supply contents — say which, and why.
  const blocked = !sides.before.ok ? sides.before : !sides.after.ok ? sides.after : null;
  if (blocked) {
    return (
      <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2">
        <div className="flex items-start gap-2">
          <AlertTriangle size={12} className="text-amber-300 shrink-0 mt-[1px]" />
          <div className="text-[10.5px] text-amber-100/90">
            <div className="text-amber-100">
              Cannot diff against <span className="font-mono">{blocked.label}</span>
            </div>
            <div className="mt-0.5 text-amber-100/70">{blocked.unavailable}</div>
          </div>
        </div>
      </div>
    );
  }

  const addedWholesale = sides.before.content === null;
  const removedWholesale = sides.after.content === null;

  return (
    <div className="rounded-md border border-white/[0.06] bg-black/20 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-white/[0.06] text-[10px]">
        <span className="font-mono text-foreground-subtle truncate">{relativePath}</span>
        <span className="text-foreground-subtle/60">
          {sides.before.label} → {sides.after.label}
        </span>
        {addedWholesale && <span className="text-emerald-300">added in this range</span>}
        {removedWholesale && <span className="text-rose-300">removed in this range</span>}
        <div className="flex-1" />
        <button
          onClick={() => setLayout((l) => (l === 'split' ? 'unified' : 'split'))}
          className="flex items-center gap-1 text-foreground-subtle hover:text-foreground transition-colors"
          title={layout === 'split' ? 'Switch to unified' : 'Switch to side-by-side'}
        >
          {layout === 'split' ? <Rows3 size={11} /> : <Columns2 size={11} />}
          {layout === 'split' ? 'Unified' : 'Split'}
        </button>
      </div>
      <div ref={host} className="cm-merge-host" />
    </div>
  );
}
