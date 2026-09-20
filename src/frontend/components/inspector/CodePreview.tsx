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
import {
  lineVerdict, gitMark, verdictTooltip, VERDICT_STYLE,
} from '../../lib/line-verdict';

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
}

export function CodePreview({ content, error, highlightLine, onClose, overlay, onOpenItem }: Props) {
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
    />
  );
}

function CodePreviewInner({
  content,
  highlightLine,
  onClose,
  overlay,
  onOpenItem,
}: {
  content: FileContent;
  highlightLine?: number;
  onClose?: () => void;
  overlay?: FileOverlay | null;
  onOpenItem?: (itemUid: string, planUid: string) => void;
}) {
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);
  const [showPopover, setShowPopover] = useState(false);

  const language = useMemo(() => resolvePrismLanguage(content.language), [content.language]);
  // Expanded once per overlay rather than searched per line — spans are
  // small and every line renders anyway.
  const overlayIndex: OverlayIndex = useMemo(() => indexMarkers(overlay?.markers ?? []), [overlay]);
  const lines = useMemo(() => content.content.split('\n'), [content.content]);
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
    <div className={`rounded-md border ${driftBorder} bg-black/30 overflow-hidden`}>
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
                      onClick={(e) => handleLineClick(lineNum, e)}
                      getLineProps={getLineProps}
                      line={line}
                      getTokenProps={getTokenProps}
                      planMarkers={overlayIndex.get(lineNum)}
                      onOpenItem={onOpenItem}
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

function LineRow({
  lineNum,
  annotation,
  inSelection,
  isHighlighted,
  onClick,
  getLineProps,
  line,
  getTokenProps,
  planMarkers,
  onOpenItem,
}: {
  lineNum: number;
  annotation: LineAnnotation | undefined;
  inSelection: boolean;
  isHighlighted: boolean;
  onClick: (e: React.MouseEvent) => void;
  getLineProps: any;
  line: any[];
  getTokenProps: any;
  planMarkers?: OverlayMarker[];
  onOpenItem?: (itemUid: string, planUid: string) => void;
}) {
  const lineProps = getLineProps({ line });
  const marker = planMarkers && planMarkers.length > 0 ? planMarkers[0] : null;
  const showLabel = marker ? isSpanStart(marker, lineNum) : false;

  // The join. Git says what changed, the plan says what was meant to —
  // neither is the answer on its own, and the reader used to be left to
  // compare two faint colours per line. See `lib/line-verdict`.
  const verdict = lineVerdict(annotation, Boolean(marker));
  const style = verdict ? VERDICT_STYLE[verdict] : null;
  const mark = gitMark(annotation);

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
      onClick={onClick}
      title={verdictTooltip(verdict, annotation, marker?.itemTitle, marker?.intent)}
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
      {/* Raw git state, demoted: our verdict is the answer, this is its input. */}
      <span className="select-none w-3 text-center shrink-0 text-[10px] leading-snug text-foreground-subtle/70">
        {mark}
      </span>
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
