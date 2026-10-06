import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { AlertTriangle, Columns2, Loader2, Rows3 } from 'lucide-react';
import { languageExtensionFor, languageForPath } from '../../lib/codemirror-lang';
import { findingHover, placeFindings, type PlacedFinding, type RunFinding } from '../../../shared/lib/open-findings';
import { ATTENTION, TONES } from '../../lib/visual-language';
import { useUiStore } from '../../stores/ui-store';

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
  /**
   * Comparand specs — `live`, `commit:<ref>`, `checkpoint:<id>`, `baseline`,
   * or another workstream's copy, `workstream:<branch or id>` (Phase 32 B3.2).
   */
  before: string;
  after: string;
  /** Names for the sides in place of the comparands' own, e.g. "this copy (billing-v2)". */
  labels?: { before?: string; after?: string };
  /** Each side's own path, when the file was renamed between them (Phase 32 E3); `relativePath` otherwise. */
  beforePath?: string;
  afterPath?: string;
  /** Language tag; inferred from the path when omitted. */
  language?: string | null;
  authHeaders?: Record<string, string>;
  /**
   * Phase 33 G10 — what the latest check run found in the file as it is now.
   * Marked on the after side only, and only when that side is the live file:
   * a finding is about the code as it stands.
   */
  findings?: { runId: string; findings: RunFinding[] } | null;
}

type Layout = 'split' | 'unified';

/** Phase 33 G10 — the ⊘ in the after side's gutter: the finding in words on hover, the run on a click. */
class FindingMarker extends GutterMarker {
  constructor(readonly findings: PlacedFinding[], readonly onOpen: (runId: string) => void) { super(); }
  eq(other: FindingMarker) { return other.findings === this.findings; }
  toDOM() {
    const words = this.findings.map(findingHover).join('\n');
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = ATTENTION.breach.glyph;
    el.title = `${words}\nOpen the check run`;
    el.setAttribute('aria-label', `Line ${this.findings[0].line}: ${words}. Open the check run`);
    el.dataset.testid = 'diff-finding';
    el.dataset.line = String(this.findings[0].line);
    el.className = `${this.findings.some((f) => f.failing) ? TONES[ATTENTION.breach.tone].text : TONES.attention.text} px-0.5 leading-none`;
    el.addEventListener('click', (e) => { e.stopPropagation(); this.onOpen(this.findings[0].runId); });
    return el;
  }
}

/** Holds the gutter's width: the glyph, hidden, with nothing to click or find. */
class FindingSpacer extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.textContent = ATTENTION.breach.glyph;
    el.className = 'px-0.5';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
}

function findingGutter(placed: PlacedFinding[], onOpen: (runId: string) => void): Extension {
  const byLine = new Map<number, PlacedFinding[]>();
  for (const f of placed) byLine.set(f.line, [...(byLine.get(f.line) ?? []), f]);
  const markers = new Map([...byLine].map(([line, list]) => [line, new FindingMarker(list, onOpen)]));
  return gutter({
    class: 'cm-findings-gutter',
    lineMarker: (view, block) => markers.get(view.state.doc.lineAt(block.from).number) ?? null,
    initialSpacer: () => new FindingSpacer(),
  });
}

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
  labels,
  beforePath,
  afterPath,
  findings,
}: Props) {
  const openCheckRun = useUiStore((s) => s.openCheckRun);
  const host = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const unifiedRef = useRef<EditorView | null>(null);

  const [layout, setLayout] = useState<Layout>('split');
  const [loading, setLoading] = useState(true);
  const [sides, setSides] = useState<{ before: FileAtResult; after: FileAtResult } | null>(null);

  const findingsKey = findings ? `${findings.runId}:${findings.findings.map((f) => `${f.rule}>${f.imports}`).join(',')}` : '';

  const languageExt = useMemo(
    () => languageExtensionFor(language ?? languageForPath(relativePath)),
    [language, relativePath],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchFileAt(projectPath, beforePath ?? relativePath, before, authHeaders),
      fetchFileAt(projectPath, afterPath ?? relativePath, after, authHeaders),
    ])
      .then(([b, a]) => {
        if (cancelled) return;
        setSides({
          before: labels?.before ? { ...b, label: labels.before } : b,
          after: labels?.after ? { ...a, label: labels.after } : a,
        });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, relativePath, beforePath, afterPath, before, after, authHeaders, labels?.before, labels?.after]);

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
    // G10: the after side carries the findings, placed on its lines.
    const placed = findings && after === 'live' ? placeFindings(findings.findings, findings.runId, afterDoc) : [];
    const afterExt = placed.length > 0 ? [...base, findingGutter(placed, openCheckRun)] : base;

    // Two genuinely different views, not one view with a cosmetic flag.
    // Neither offers accept/reject controls: this is a read-only review
    // of what already happened, not a merge conflict to resolve.
    if (layout === 'unified') {
      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: afterDoc,
          extensions: [
            ...afterExt,
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
      b: { doc: afterDoc, extensions: afterExt },
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
    // `findingsKey`, not `findings`: a fresh fetch of the same runs must not rebuild the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sides, languageExt, layout, findingsKey, after, openCheckRun]);

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
