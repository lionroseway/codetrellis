import { useMemo, useState, useCallback } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { Plus, AlertTriangle, ShieldCheck, Hourglass, MinusCircle } from 'lucide-react';
import { AddToTaskPopover } from './AddToTaskPopover';

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
  drift?: {
    status: DriftStatus;
    activePlanUids: string[];
    activeTaskUids: string[];
    hasActivePlan: boolean;
  };
}

interface Props {
  content: FileContent | null;
  error: string | null;
  highlightLine?: number;
  onClose?: () => void;
}

const PRISM_LANG: Record<string, string> = {
  typescript: 'tsx', tsx: 'tsx', javascript: 'jsx', jsx: 'jsx',
  json: 'json', css: 'css', scss: 'scss', markup: 'markup',
  python: 'python', rust: 'rust', go: 'go', java: 'java',
  php: 'php', ruby: 'ruby', bash: 'bash', markdown: 'markdown',
  yaml: 'yaml', toml: 'toml', sql: 'sql',
  plaintext: 'plain',
};

export function CodePreview({ content, error, highlightLine, onClose }: Props) {
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

  return <CodePreviewInner content={content} highlightLine={highlightLine} onClose={onClose} />;
}

function CodePreviewInner({
  content,
  highlightLine,
  onClose,
}: {
  content: FileContent;
  highlightLine?: number;
  onClose?: () => void;
}) {
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);
  const [showPopover, setShowPopover] = useState(false);

  const language = useMemo(() => PRISM_LANG[content.language || 'plaintext'] || 'plain', [content.language]);
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
                return (
                  <LineRow
                    key={i}
                    lineNum={lineNum}
                    annotation={annotation}
                    inSelection={inSelection}
                    isHighlighted={isHighlighted}
                    onClick={(e) => handleLineClick(lineNum, e)}
                    getLineProps={getLineProps}
                    line={line}
                    getTokenProps={getTokenProps}
                  />
                );
              })}
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
  if (!drift) return null;
  const meta = driftBadgeMeta(drift.status);
  if (!meta) return null;
  return (
    <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded border normal-case tracking-normal text-[9.5px] ${meta.className}`}>
      <meta.icon size={9} />
      {meta.label}
    </span>
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

function LineRow({
  lineNum,
  annotation,
  inSelection,
  isHighlighted,
  onClick,
  getLineProps,
  line,
  getTokenProps,
}: {
  lineNum: number;
  annotation: LineAnnotation | undefined;
  inSelection: boolean;
  isHighlighted: boolean;
  onClick: (e: React.MouseEvent) => void;
  getLineProps: any;
  line: any[];
  getTokenProps: any;
}) {
  const lineProps = getLineProps({ line });
  const gutterClass = annotation === 'added'
    ? 'bg-emerald-500/20 text-emerald-200'
    : annotation === 'modified'
      ? 'bg-amber-500/20 text-amber-200'
      : '';
  const gutterMark = annotation === 'added' ? '+' : annotation === 'modified' ? '~' : '';

  const rowBg = inSelection
    ? 'bg-accent/10'
    : isHighlighted
      ? 'bg-accent/[0.06]'
      : annotation === 'added'
        ? 'bg-emerald-500/[0.04]'
        : annotation === 'modified'
          ? 'bg-amber-500/[0.04]'
          : '';

  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer ${rowBg} hover:bg-white/[0.03] transition-colors`}
    >
      {/* git gutter */}
      <span className={`select-none w-3 text-center shrink-0 text-[10px] leading-snug ${gutterClass}`}>
        {gutterMark}
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
