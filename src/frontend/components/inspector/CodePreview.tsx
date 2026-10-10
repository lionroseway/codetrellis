import { hunkAt, hunkLabel, type LineHistoryData } from '../../lib/line-history';
import { useEffect, useMemo, useState, useCallback, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { Highlight, themes } from 'prism-react-renderer';
import { Plus, AlertTriangle, ShieldCheck, Hourglass, MinusCircle, ChevronDown, Check } from 'lucide-react';
import { AddToTaskPopover } from './AddToTaskPopover';
import { resolvePrismLanguage } from '../../lib/prism-lang';
import { usePlanStore } from '../../stores/plan-store';
import { useUiStore } from '../../stores/ui-store';
import { useProjectStore } from '../../stores/project-store';
import {
  indexMarkers, markerLabel, intentTint, isSpanStart,
  type FileOverlay, type OverlayIndex, type OverlayMarker,
} from '../../lib/plan-overlay';
import { lineVerdict, verdictTooltip, VERDICT_STYLE } from '../../lib/line-verdict';
import { ownGlyph, type GutterMark, type GutterMarks } from '../../lib/line-marks';
import { findingHover, placeFindings, type PlacedFinding, type RunFinding } from '../../../shared/lib/open-findings';
import { ATTENTION, TONES } from '../../lib/visual-language';

export type LineAnnotation = 'unchanged' | 'added' | 'modified';

export type DriftStatus = 'on_track' | 'pending' | 'unexpected' | 'untouched' | 'no_plan';

export interface FileContent {
  path: string;
  content: string;
  startLine: number;
  endLine?: number;
  lineCount: number;
  bytes: number;
  truncated: boolean;
  language?: string;
  annotations?: LineAnnotation[];
  /**
   * How many lines were deleted immediately above a given line, keyed by
   * 1-based line number within this window. A removal is not a property
   * of any surviving line, so it cannot live in `annotations`.
   */
  deletedBefore?: Record<string, number>;
  drift?: {
    status: DriftStatus;
    activePlanUids: string[];
    activeTaskUids: string[];
    hasActivePlan: boolean;
    comparedAgainstPlanUid?: string | null;
    comparedAgainstPlanTitle?: string | null;
  };
}

interface Props {
  content: FileContent | null;
  error: string | null;
  highlightLine?: number;
  onClose?: () => void;
  /**
   * Phase 26 — what the plan wants changed in this file, placed on the
   * lines it applies to. Optional: the inspector can render code with no
   * plan context at all, and should not look broken when it does.
   */
  overlay?: FileOverlay | null;
  /** Open the plan item a marker belongs to. */
  onOpenItem?: (itemUid: string, planUid: string) => void;
  /**
   * Phase 32 B3.2 — the workstream gutter: this copy's own changes against
   * its merge base, and other workstreams' changes. Absent, no column.
   */
  workMarks?: GutterMarks | null;
  /**
   * Phase 32 E4 — line history: who wrote each run of lines, in a column
   * beside the line numbers; choosing a run opens its card.
   */
  lineHistory?: LineHistoryGutter | null;
  /**
   * Phase 33 G10 — what the latest check run found in this file: a ⊘ on the
   * line that makes the import, the finding in words on hover, and a click
   * opens the run in the Checks view. Absent, no column.
   */
  findings?: { runId: string; findings: RunFinding[] } | null;
}

/** Line history for the gutter: the runs, the chosen line, and how to choose one. */
export interface LineHistoryGutter {
  data: LineHistoryData;
  chosenLine: number | null;
  onChoose: (line: number) => void;
}

export function CodePreview({ content, error, highlightLine, onClose, overlay, onOpenItem, workMarks, lineHistory, findings }: Props) {

  if (error) {
    return (
      <div className="rounded-md border border-red-500/20 bg-red-500/[0.04] px-3 py-2 text-[10.5px] text-red-200">
        Failed to load source: {error}
      </div>
    );
  }
  if (!content) {
    return (
      <div className="rounded-md border border-white/[0.06] bg-black/20 px-3 py-3 text-[10.5px] text-foreground-subtle italic">
        Loading source…
      </div>
    );
  }

  return (
    <CodePreviewInner
      content={content}
      highlightLine={highlightLine}
      onClose={onClose}
      overlay={overlay}
      onOpenItem={onOpenItem}
      workMarks={workMarks}
      lineHistory={lineHistory}
      findings={findings}
    />
  );
}

function CodePreviewInner({
  content,
  highlightLine,
  onClose,
  overlay,
  onOpenItem,
  workMarks,
  lineHistory,
  findings,
}: {
  content: FileContent;
  highlightLine?: number;
  onClose?: () => void;
  overlay?: FileOverlay | null;
  onOpenItem?: (itemUid: string, planUid: string) => void;
  workMarks?: GutterMarks | null;
  lineHistory?: LineHistoryGutter | null;
  findings?: { runId: string; findings: RunFinding[] } | null;
}) {
  /**
   * Scroll the highlighted line into view.
   *
   * `highlightLine` tinted a row and did nothing else, so "open this file
   * at line 25" opened the file at line 1 and marked something you could
   * not see. Every caller that means "go here" — the plan diff, a review
   * row, `navigate_to({target:'code', line})` — was landing at the top of
   * the file and leaving the reader to find it.
   *
   * `center` rather than `start` because the line usually only makes
   * sense with what is around it.
   */
  const highlightRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlightLine == null) return;
    const el = highlightRowRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      // Instant, not smooth. A smooth scroll is animated by
      // requestAnimationFrame, which does not run while the window is
      // behind another app — so "open at line 25" left the reader at the
      // top whenever it was triggered from somewhere else, an agent
      // included. A jump to a line should be a jump anyway.
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
    }, 80);
    return () => clearTimeout(t);
  }, [highlightLine, content?.path]);
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);
  const [showPopover, setShowPopover] = useState(false);

  const language = useMemo(() => resolvePrismLanguage(content.language), [content.language]);
  // Expanded once per overlay rather than searched per line — spans are
  // small and every line renders anyway.
  const overlayIndex: OverlayIndex = useMemo(() => indexMarkers(overlay?.markers ?? []), [overlay]);
  const lines = useMemo(() => content.content.split('\n'), [content.content]);
  // Phase 33 G10 — each finding on the line that imports it, in the text shown.
  const findingsByLine = useMemo(() => {
    const by = new Map<number, PlacedFinding[]>();
    if (!findings) return null;
    for (const f of placeFindings(findings.findings, findings.runId, content.content, content.startLine)) {
      by.set(f.line, [...(by.get(f.line) ?? []), f]);
    }
    return by.size > 0 ? by : null;
  }, [findings, content.content, content.startLine]);
  const driftBorder = useMemo(() => driftBorderClass(content.drift?.status), [content.drift?.status]);

  const handleLineClick = useCallback((lineNum: number, e: React.MouseEvent) => {
    if (e.shiftKey && selectedRange) {
      // Extend selection
      const start = Math.min(selectedRange.start, lineNum);
      const end = Math.max(selectedRange.end, lineNum);
      setSelectedRange({ start, end });
    } else if (selectedRange?.start === lineNum && selectedRange?.end === lineNum) {
      // Toggle off if clicking the only-selected line
      setSelectedRange(null);
    } else {
      setSelectedRange({ start: lineNum, end: lineNum });
    }
  }, [selectedRange]);

  const selectedSnippet = useMemo(() => {
    if (!selectedRange) return '';
    const startIdx = selectedRange.start - content.startLine;
    const endIdx = selectedRange.end - content.startLine;
    return lines.slice(startIdx, endIdx + 1).join('\n');
  }, [selectedRange, lines, content.startLine]);

  return (
    // `data-code-file` is what is RENDERED, as opposed to what is selected.
    // The two disagree while a new file is being fetched, and a screenshot
    // taken in that gap shows the previous file under the new one's name —
    // which is exactly what happened to the demo's "aligned" shot. See the
    // `ui_ready` responder in useWebSocket.
    <div
      data-code-file={content.path}
      className={`rounded-md border ${driftBorder} bg-black/30 overflow-hidden`}
    >
      <Header content={content} onClose={onClose} />

      {selectedRange && (
        <SelectionBar
          range={selectedRange}
          onAdd={() => setShowPopover(true)}
          onClear={() => setSelectedRange(null)}
        />
      )}

      {/* Phase 26 — what the plan wants from this file as a whole, and
          what it wanted from lines that no longer exist. Both belong
          above the code rather than on any single line. */}
      <PlanOverlayBanner overlay={overlay ?? null} onOpenItem={onOpenItem} />

      <div className="text-[11px] font-mono leading-snug max-h-[460px] overflow-auto">
        <Highlight code={content.content} language={language} theme={themes.nightOwl}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={className}
              style={{ ...style, background: 'transparent', margin: 0 }}
            >
              {tokens.map((line, i) => {
                const lineNum = content.startLine + i;
                const annotation = content.annotations?.[i];
                const inSelection = selectedRange != null && lineNum >= selectedRange.start && lineNum <= selectedRange.end;
                const isHighlighted = highlightLine != null && lineNum === highlightLine;
                // A removal has no line of its own — it sits in the gap
                // above this one. Rendering it here is the only way the
                // reader ever sees deleted code referenced at all.
                const removed = content.deletedBefore?.[String(i + 1)];
                return (
                  <Fragment key={i}>
                    {removed ? <DeletedGap count={removed} /> : null}
                    <LineRow
                      lineNum={lineNum}
                      annotation={annotation}
                      inSelection={inSelection}
                      isHighlighted={isHighlighted}
                    rowRef={isHighlighted ? highlightRowRef : undefined}
                      onClick={(e) => handleLineClick(lineNum, e)}
                      getLineProps={getLineProps}
                      line={line}
                      getTokenProps={getTokenProps}
                      planMarkers={overlayIndex.get(lineNum)}
                    fileClaim={overlay?.fileLevel?.[0]}
                      onOpenItem={onOpenItem}
                      work={workMarks ? { own: workMarks.own.get(lineNum), others: workMarks.others.get(lineNum) } : undefined}
                      blame={lineHistory ? blameCell(lineHistory, lineNum) : undefined}
                      findings={findingsByLine ? findingsByLine.get(lineNum) ?? [] : undefined}
                    />
                  </Fragment>
                );
              })}
              {/* A deletion at the very end of the file has no following
                  line to hang from. */}
              {content.deletedBefore?.[String(tokens.length + 1)] ? (
                <DeletedGap count={content.deletedBefore[String(tokens.length + 1)]} />
              ) : null}
            </pre>
          )}
        </Highlight>
      </div>

      {showPopover && selectedRange && (
        <AddToTaskPopover
          filePath={content.path}
          startLine={selectedRange.start}
          endLine={selectedRange.end}
          codeSnippet={selectedSnippet}
          onClose={() => setShowPopover(false)}
        />
      )}
    </div>
  );
}

function Header({ content, onClose }: { content: FileContent; onClose?: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-white/[0.04] text-[9px] uppercase tracking-wider text-foreground-subtle">
      <span>
        {content.lineCount} line{content.lineCount === 1 ? '' : 's'}
        {content.truncated ? ' · truncated' : ''}
      </span>
      <DriftBadge drift={content.drift} />
      <div className="flex-1" />
      {onClose && (
        <button onClick={onClose} className="hover:text-foreground transition-colors normal-case tracking-normal text-[10px]">
          Hide
        </button>
      )}
    </div>
  );
}

function DriftBadge({ drift }: { drift?: FileContent['drift'] }) {
  const root = useProjectStore((s) => s.root);
  const plans = usePlanStore((s) => s.plans);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const driftComparePlanUid = useUiStore((s) => s.driftComparePlanUid);
  const setDriftComparePlanUid = useUiStore((s) => s.setDriftComparePlanUid);

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Lazy-load plans the first time the popover opens, in case the user
  // hasn't visited the Plans tab yet.
  useEffect(() => {
    if (open && root && plans.length === 0) {
      fetchPlans(root);
    }
  }, [open, root, plans.length, fetchPlans]);

  useEffect(() => {
    if (!open) return;
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopoverPos({ top: rect.bottom + 4, left: rect.left });
    }
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      const popover = document.querySelector('[data-drift-popover]');
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        (!popover || !popover.contains(target))
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!drift) return null;
  const meta = driftBadgeMeta(drift.status);
  if (!meta) return null;

  const effectivePlanUid = driftComparePlanUid ?? activePlanUid ?? null;
  const comparedTitle = drift.comparedAgainstPlanTitle
    ?? plans.find((p) => p.uid === effectivePlanUid)?.title
    ?? null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border normal-case tracking-normal text-[9.5px] hover:brightness-125 transition-all ${meta.className}`}
        title="Click to pick which plan drift compares against"
      >
        <meta.icon size={9} />
        <span>{meta.label}</span>
        {comparedTitle && (
          <span className="opacity-70 max-w-[100px] truncate">· {comparedTitle}</span>
        )}
        <ChevronDown size={9} className="opacity-70" />
      </button>

      {open && popoverPos && createPortal(
        <div
          data-drift-popover
          style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, zIndex: 9999 }}
          className="w-[260px] bg-[#0b1020]/95 backdrop-blur-md border border-white/[0.08] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] py-1"
        >
          <div className="px-3 py-1.5 text-[9px] text-foreground-subtle uppercase tracking-wider border-b border-white/[0.04]">
            Compare drift against
          </div>

          <button
            onClick={() => { setDriftComparePlanUid(null); setOpen(false); }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-white/[0.04] transition-colors ${
              driftComparePlanUid == null ? 'text-accent' : 'text-foreground-muted'
            }`}
          >
            {driftComparePlanUid == null ? <Check size={11} /> : <span className="w-[11px]" />}
            <span className="flex-1 truncate">
              Follow active plan
              {activePlanUid && (
                <span className="text-foreground-subtle ml-1">
                  · {plans.find((p) => p.uid === activePlanUid)?.title || activePlanUid.slice(0, 6)}
                </span>
              )}
            </span>
          </button>

          {plans.length > 0 && (
            <div className="border-t border-white/[0.04] py-1 max-h-[260px] overflow-y-auto">
              {plans.map((p) => (
                <button
                  key={p.uid}
                  onClick={() => { setDriftComparePlanUid(p.uid); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-white/[0.04] transition-colors ${
                    driftComparePlanUid === p.uid ? 'text-accent' : 'text-foreground-muted'
                  }`}
                >
                  {driftComparePlanUid === p.uid ? <Check size={11} /> : <span className="w-[11px]" />}
                  <span className="flex-1 truncate">{p.title}</span>
                  <span className="text-[9px] text-foreground-subtle shrink-0">
                    {p.completedTaskCount ?? 0}/{p.taskCount ?? 0}
                  </span>
                </button>
              ))}
            </div>
          )}

          {plans.length === 0 && (
            <div className="px-3 py-2 text-[10.5px] text-foreground-subtle italic">
              No plans yet — drift will fall back to "any active plan."
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function SelectionBar({
  range,
  onAdd,
  onClear,
}: {
  range: { start: number; end: number };
  onAdd: () => void;
  onClear: () => void;
}) {
  const lineCount = range.end - range.start + 1;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-accent/10 border-b border-accent/20 text-[10.5px] text-accent">
      <span>
        Selected lines {range.start}{range.start !== range.end ? `–${range.end}` : ''}
        <span className="text-accent/60 ml-1">({lineCount} line{lineCount === 1 ? '' : 's'})</span>
      </span>
      <div className="flex-1" />
      <button
        onClick={onAdd}
        className="flex items-center gap-1 px-2 py-0.5 rounded bg-accent/20 hover:bg-accent/30 border border-accent/30 text-accent transition-colors"
      >
        <Plus size={10} />
        Add to plan
      </button>
      <button
        onClick={onClear}
        className="text-accent/70 hover:text-accent transition-colors normal-case"
      >
        Clear
      </button>
    </div>
  );
}

/**
 * The place where lines used to be.
 *
 * Deliberately not a fake line: no line number, no code, nothing that
 * could be mistaken for content that exists. Just a marker saying how
 * much went, so a refactor that cuts forty lines and adds two stops
 * reading as two added lines.
 */
function DeletedGap({ count }: { count: number }) {
  return (
    <div
      className="flex items-center select-none"
      title={`${count} line${count === 1 ? '' : 's'} deleted here since HEAD`}
    >
      <span className="w-[3px] shrink-0 bg-rose-400/70" aria-hidden="true" />
      <span className="w-4 text-center shrink-0 text-[11px] leading-snug font-semibold text-rose-300">
        −
      </span>
      <span className="w-3 shrink-0" />
      <span className="w-10 shrink-0 border-r border-white/[0.04]" />
      <span className="px-2 text-[10.5px] leading-snug text-rose-300/80 italic">
        {count} line{count === 1 ? '' : 's'} deleted
      </span>
      <span className="flex-1 ml-2 h-px bg-rose-400/20" />
    </div>
  );
}

const OWN_INK: Record<GutterMark['kind'], string> = {
  added: 'text-emerald-400', changed: 'text-amber-300', removed: 'text-rose-400',
};

function WorkGutter({ own, others }: { own?: GutterMark[]; others?: GutterMark[] }) {
  const glyph = ownGlyph(own);
  const ownKind = own?.find((m) => m.kind === 'changed')?.kind ?? own?.[0]?.kind;
  return (
    <span className="select-none flex shrink-0 w-6 items-stretch text-[10.5px] leading-snug">
      <span
        data-testid={glyph ? 'work-mark-own' : undefined}
        data-kind={ownKind}
        title={own?.map((m) => m.sentence).join('\n')}
        className={`w-3.5 text-center font-semibold ${ownKind ? OWN_INK[ownKind] : ''}`}
      >
        {glyph}
      </span>
      <span
        data-testid={others?.length ? 'work-mark-other' : undefined}
        data-who={others?.length ? [...new Set(others.map((m) => m.who))].join(',') : undefined}
        title={others?.map((m) => m.sentence).join('\n')}
        className="w-2.5 flex justify-center"
      >
        {others?.length ? <span className="w-[3px] rounded-full bg-sky-400/80" /> : null}
      </span>
    </span>
  );
}

function LineRow({
  lineNum,
  annotation,
  inSelection,
  isHighlighted,
  rowRef,
  onClick,
  getLineProps,
  line,
  getTokenProps,
  planMarkers,
  fileClaim,
  onOpenItem,
  work,
  blame,
  findings,
}: {
  lineNum: number;
  annotation: LineAnnotation | undefined;
  inSelection: boolean;
  isHighlighted: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
  onClick: (e: React.MouseEvent) => void;
  getLineProps: any;
  line: any[];
  getTokenProps: any;
  planMarkers?: OverlayMarker[];
  /** A plan item claiming the whole file, when no line span applies. */
  fileClaim?: OverlayMarker;
  onOpenItem?: (itemUid: string, planUid: string) => void;
  /** Phase 32 B3.2 — present when the workstream gutter is shown. */
  work?: { own?: GutterMark[]; others?: GutterMark[] };
  /** Phase 32 E4 — present when line history is shown. */
  blame?: BlameCell;
  /** Phase 33 G10 — present when the file has findings: this line's, maybe none. */
  findings?: PlacedFinding[];
}) {
  const lineProps = getLineProps({ line });
  const marker = planMarkers && planMarkers.length > 0 ? planMarkers[0] : null;
  const fileClaimed = Boolean(fileClaim);
  const showLabel = marker ? isSpanStart(marker, lineNum) : false;

  // The join. Git says what changed, the plan says what was meant to —
  // neither is the answer on its own, and the reader used to be left to
  // compare two faint colours per line. See `lib/line-verdict`.
  const verdict = lineVerdict(annotation, Boolean(marker), fileClaimed);
  const style = verdict ? VERDICT_STYLE[verdict] : null;

  // Selection COMPOSES over the verdict rather than replacing it. The old
  // chain put `inSelection` first, so clicking the line you were
  // inspecting removed the tint you were inspecting it for.
  const rowBg = style?.row ?? '';
  const selectionRing = inSelection
    ? 'ring-1 ring-inset ring-accent/60'
    : isHighlighted
      ? 'ring-1 ring-inset ring-accent/30'
      : '';

  return (
    <div
      ref={rowRef}
      // Machine-readable verdict, so a check can count what rendered
      // instead of trusting that the right file on screen means the
      // right marks on it.
      data-verdict={verdict ?? undefined}
      data-line={lineNum}
      onClick={onClick}
      title={verdictTooltip(
        verdict,
        annotation,
        marker?.itemTitle ?? fileClaim?.itemTitle,
        marker?.intent ?? fileClaim?.intent,
        !marker && Boolean(fileClaim),
      )}
      className={`flex cursor-pointer ${rowBg} ${selectionRing} hover:bg-white/[0.04] transition-colors`}
    >
      {/* Verdict stripe — carries the signal even under a selection ring,
          and is the one mark that survives every other state. */}
      <span
        className={`select-none w-[3px] shrink-0 ${style ? style.stripe : 'bg-transparent'}`}
        aria-hidden="true"
      />
      {/* Verdict glyph. Shape as well as colour, so it reads without it. */}
      <span
        className={`select-none w-4 text-center shrink-0 text-[11px] leading-snug font-semibold ${style ? style.ink : ''}`}
      >
        {style?.glyph ?? ''}
      </span>
      {/*
        The raw git mark is NOT a column.

        It had one, and that was three pieces of furniture — stripe,
        verdict, git mark — before the line number and four before any
        code. Git state is the verdict's INPUT; the comment saying so was
        already here while it still occupied width of its own. It lives
        in the tooltip now, which is where someone goes when the glyph is
        not enough.
      */}
      {/* Phase 32 B3.2 — the workstream gutter: this copy's own change
          (＋ added, ～ changed, − lines removed below), then a bar for lines
          another workstream changes. Who, which lines, which function and
          whether it is committed are in words on hover. */}
      {work && <WorkGutter own={work.own} others={work.others} />}
      {/* Phase 32 E4 — line history: who wrote this run of lines, on its first line. */}
      {blame && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); blame.onChoose(); }}
          className={`select-none w-48 shrink-0 truncate text-left px-1.5 text-[10px] font-sans leading-snug border-r border-white/[0.04] ${
            blame.chosen ? 'bg-sky-400/10 text-sky-200' : blame.agent ? 'text-accent/80 hover:text-accent' : 'text-foreground-subtle hover:text-foreground'
          } ${blame.first ? '' : 'text-transparent hover:text-transparent'}`}
          title={blame.title}
          aria-label={blame.first ? `Line history: ${blame.title}` : undefined}
          tabIndex={blame.first ? 0 : -1}
          data-testid="blame-cell"
          data-first={blame.first ? 'true' : undefined}
        >
          {blame.first ? blame.text : '·'}
        </button>
      )}
      {/* Phase 33 G10 — a rule breach the latest check found here. */}
      {findings && <FindingMark findings={findings} lineNum={lineNum} />}
      {/* line number */}
      <span className="select-none text-foreground-subtle/50 w-10 text-right pr-2 shrink-0 border-r border-white/[0.04]">
        {lineNum}
      </span>
      {/* code */}
      <code {...lineProps} className={`${lineProps.className || ''} px-2 whitespace-pre flex-1 min-w-0`}>
        {line.map((token: any, key: number) => (
          <span key={key} {...getTokenProps({ token })} />
        ))}
      </code>

      {/* Phase 26 — the plan marker rail. The bar runs the whole span so
          the extent is visible; the label sits only on the first line so
          a twenty-line span does not repeat itself twenty times. */}
      {marker && (
        <span className="flex items-center shrink-0 pl-1 pr-2 max-w-[45%] gap-1.5">
          <span className={`w-[2px] self-stretch rounded-full ${
            marker.intent === 'remove' ? 'bg-rose-400/70'
              : marker.intent === 'add' ? 'bg-emerald-400/70'
              : 'bg-accent/70'
          }`} />
          {showLabel && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenItem?.(marker.itemUid, marker.planUid); }}
              title={marker.instruction || marker.itemTitle}
              className={`truncate text-[9.5px] hover:underline ${intentTint(marker.intent)}`}
            >
              {markerLabel(planMarkers ?? [])}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * Phase 33 G10 — the ⊘ for an import the latest check run found breaking a
 * rule: the finding in words on hover, the run on a click. The column is there
 * on every line once the file has a finding, so the code does not shift.
 */
function FindingMark({ findings, lineNum }: { findings: PlacedFinding[]; lineNum: number }) {
  const openCheckRun = useUiStore((s) => s.openCheckRun);
  if (findings.length === 0) return <span className="select-none w-4 shrink-0" aria-hidden="true" />;
  const words = findings.map(findingHover).join('\n');
  const failing = findings.some((f) => f.failing);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openCheckRun(findings[0].runId); }}
      title={`${words}\nOpen the check run`}
      aria-label={`Line ${lineNum}: ${words}. Open the check run`}
      className={`select-none w-4 shrink-0 text-center text-[11px] leading-snug ${failing ? TONES[ATTENTION.breach.tone].text : TONES.attention.text} hover:bg-white/[0.06]`}
      data-testid="code-finding"
      data-line={lineNum}
      data-rule={findings.map((f) => f.rule).join(' ')}
    >
      {ATTENTION.breach.glyph}
    </button>
  );
}

/**
 * File-level plan context: what the plan wants from this file without
 * naming lines, and what it wanted from lines that are no longer there.
 *
 * The unanchored group is the one a reader most needs told about — it
 * means the plan refers to a version of the file that no longer exists —
 * so it is stated rather than silently dropped.
 */
/**
 * The intent, in a word a reader can act on.
 *
 * `intentTint` has always coloured the marker by intent; nothing ever said
 * it. A file a plan intends to CREATE and one it intends to MODIFY looked
 * identical apart from a green versus amber triangle.
 */
function intentWord(intent: string | null): string {
  switch (intent) {
    case 'add':
    case 'create':
      return 'new file';
    case 'remove':
    case 'delete':
      return 'delete';
    case 'replace':
      return 'rewrite';
    case 'modify':
      return 'modify';
    default:
      return 'planned';
  }
}

function PlanOverlayBanner({
  overlay,
  onOpenItem,
}: {
  overlay: FileOverlay | null;
  onOpenItem?: (itemUid: string, planUid: string) => void;
}) {
  if (!overlay) return null;
  if (overlay.fileLevel.length === 0 && overlay.unanchored.length === 0) return null;

  return (
    <div className="mb-1.5 space-y-1">
      {overlay.fileLevel.map((m, i) => (
        <button
          key={`f${i}`}
          onClick={() => onOpenItem?.(m.itemUid, m.planUid)}
          className="group w-full flex items-start gap-1.5 rounded-md border border-accent/20 bg-accent/[0.05] px-2 py-1 text-left hover:bg-accent/[0.09] transition-colors"
        >
          <span className={`text-[10px] shrink-0 ${intentTint(m.intent)}`}>▸</span>
          {/* Say the intent, do not just tint a triangle. "Is this a new
              file or a change to an existing one" is the first question a
              reader has, and the answer was encoded as the colour of a
              4px glyph. */}
          <span
            className={`text-[9px] uppercase tracking-wider shrink-0 mt-[1px] ${intentTint(m.intent)}`}
          >
            {intentWord(m.intent)}
          </span>
          <span className="text-[10px] text-foreground-muted truncate flex-1">
            <span className="text-foreground">{m.itemTitle}</span>
            {m.instruction ? ` — ${m.instruction}` : ' wants this file'}
          </span>
          <span className="text-[9px] text-foreground-subtle shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            open item →
          </span>
        </button>
      ))}

      {overlay.unanchored.map((m, i) => (
        <div
          key={`u${i}`}
          className="flex items-start gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-2 py-1"
        >
          <AlertTriangle size={10} className="text-amber-300 shrink-0 mt-[2px]" />
          <span className="text-[10px] text-amber-100/80">
            <span className="text-amber-100">{m.itemTitle}</span> could not be placed: {m.reason}
          </span>
        </div>
      ))}
    </div>
  );
}

function driftBorderClass(status: DriftStatus | undefined): string {
  switch (status) {
    case 'unexpected':
      return 'border-red-500/40 shadow-[0_0_0_1px_rgba(239,68,68,0.18),0_0_18px_rgba(239,68,68,0.18)]';
    case 'on_track':
      return 'border-emerald-500/30';
    case 'pending':
      return 'border-amber-500/30';
    case 'untouched':
    case 'no_plan':
    default:
      return 'border-white/[0.06]';
  }
}

function driftBadgeMeta(status: DriftStatus): { label: string; icon: typeof AlertTriangle; className: string } | null {
  switch (status) {
    case 'unexpected':
      return { label: 'Drift · unexpected', icon: AlertTriangle, className: 'bg-red-500/15 border-red-500/30 text-red-200' };
    case 'on_track':
      return { label: 'On track', icon: ShieldCheck, className: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200' };
    case 'pending':
      return { label: 'Planned · pending', icon: Hourglass, className: 'bg-amber-500/15 border-amber-500/30 text-amber-200' };
    case 'untouched':
      return { label: 'Outside any plan', icon: MinusCircle, className: 'bg-white/5 border-white/10 text-foreground-subtle' };
    case 'no_plan':
    default:
      return null;
  }
}

/** One line's cell in the line-history column. */
interface BlameCell { first: boolean; text: string; title: string; chosen: boolean; agent: boolean; onChoose: () => void }

function blameCell(g: LineHistoryGutter, line: number): BlameCell | undefined {
  const hunk = hunkAt(g.data, line);
  if (!hunk) return undefined;
  const text = hunkLabel(g.data, hunk);
  const c = hunk.sha ? g.data.commits[hunk.sha] : null;
  const chosen = g.chosenLine != null && g.chosenLine >= hunk.start && g.chosenLine <= hunk.end;
  return {
    first: line === hunk.start, text, chosen, agent: Boolean(c?.attribution),
    title: c ? `${c.subject} · ${c.author} · ${c.short}${c.attribution ? ` · ${c.attribution.words}` : ''}` : text,
    onChoose: () => g.onChoose(hunk.start),
  };
}
