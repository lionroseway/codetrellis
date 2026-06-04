import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Zap, Link2, Image as ImageIcon, Video, Code, Hash, Folder } from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useProjectStore } from '../../../stores/project-store';
import type { PlanItem, TaskAttachment } from '@shared/types';

/**
 * Phase 15 §15.D.2 — unified `@`-mention picker.
 *
 * Sits invisibly attached to a textarea. When the user types `@`,
 * pops a unified fuzzy picker over:
 *
 *   1. Plan items (Objects + Actions) — local, instant
 *   2. Attachments — local, instant
 *   3. **Code files** — searched via `/api/symbols/search` (debounced)
 *   4. **Symbols** — searched via `/api/symbols/search` (debounced)
 *
 * Picking inserts an inline markdown chip:
 *
 *   - Item:       `[[item:<uid>|<title>]]`
 *   - Attachment: `[[attach:<uid>|<label>]]`
 *   - File:       `[[file:<path>|<filename>]]`
 *   - Symbol:     `[[symbol:<name>@<path>|<name>]]`
 *
 * The `onFileTarget` / `onSymbolTarget` callbacks allow the host to
 * also write to the item's `fileSpecs` / `symbolSpecs` (15.D.2
 * targets strip auto-derivation). If not provided, chips are
 * insert-only.
 *
 * Returns the wrapper props the host textarea should spread.
 */

export interface MentionPickerHook {
  /** Spread onto the host <textarea>. */
  textareaProps: {
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onInput: (e: React.FormEvent<HTMLTextAreaElement>) => void;
  };
  /** Render this somewhere near the textarea (it positions itself). */
  picker: React.ReactNode;
}

/** API search result shape from /api/symbols/search */
interface SymbolSearchResult {
  name: string;
  kind: string;
  filePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
}

export function useMentionPicker(opts: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Apply a value change after the chip is inserted. */
  onChange: (next: string) => void;
  /** Called when a file chip is inserted — lets the host write to fileSpecs. */
  onFileTarget?: (path: string) => void;
  /** Called when a symbol chip is inserted — lets the host write to symbolSpecs. */
  onSymbolTarget?: (name: string, kind: string, filePath: string) => void;
}): MentionPickerHook {
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const contextByUid = usePlanItemsStore((s) => s.contextByUid);
  const fileTree = useProjectStore((s) => s.fileTree);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [highlight, setHighlight] = useState(0);

  // Code search state — debounced API call.
  const [codeResults, setCodeResults] = useState<SymbolSearchResult[]>([]);
  const codeSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The position of the `@` that opened the picker.
  const triggerStartRef = useRef<number | null>(null);

  const items = useMemo(() => Object.values(itemsByUid), [itemsByUid]);

  // Flatten attachments across all hydrated contexts.
  const attachments = useMemo(() => {
    const out: Array<{ a: TaskAttachment; itemUid: string }> = [];
    for (const [uid, ctx] of Object.entries(contextByUid)) {
      for (const a of ctx.attachments) out.push({ a, itemUid: uid });
    }
    return out;
  }, [contextByUid]);

  // Flatten file tree to a searchable list (cheap — typical project < 2000 files).
  const flatFiles = useMemo(() => {
    const out: Array<{ name: string; path: string; type: string }> = [];
    const walk = (nodes: typeof fileTree) => {
      if (!Array.isArray(nodes)) return;
      for (const n of nodes) {
        out.push({ name: n.name, path: n.path, type: n.type });
        if (n.children) walk(n.children);
      }
    };
    walk(fileTree);
    return out;
  }, [fileTree]);

  type Suggestion =
    | { kind: 'item'; item: PlanItem; score: number }
    | { kind: 'attachment'; attachment: TaskAttachment; itemUid: string; score: number }
    | { kind: 'file'; path: string; name: string; isDir: boolean; score: number }
    | { kind: 'symbol'; result: SymbolSearchResult; score: number };

  // Debounced code search — fires when filter is ≥2 chars.
  useEffect(() => {
    if (!open) return;
    if (filter.length < 2) {
      setCodeResults([]);
      return;
    }
    if (codeSearchTimerRef.current) clearTimeout(codeSearchTimerRef.current);
    codeSearchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(filter)}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setCodeResults(Array.isArray(data) ? data : []);
        }
      } catch {
        // Silently fail — items still show.
      }
    }, 180);
    return () => {
      if (codeSearchTimerRef.current) clearTimeout(codeSearchTimerRef.current);
    };
  }, [filter, open]);

  const suggestions: Suggestion[] = useMemo(() => {
    const q = filter.toLowerCase().trim();
    const scored: Suggestion[] = [];

    // Plan items — always show.
    for (const item of items) {
      const t = item.title.toLowerCase();
      if (!q || t.includes(q)) {
        scored.push({ kind: 'item', item, score: q ? (t.startsWith(q) ? 0 : 1) : 2 });
      }
    }

    // Attachments.
    for (const { a, itemUid } of attachments) {
      const label = (a.label ?? a.value).toLowerCase();
      if (!q || label.includes(q)) {
        scored.push({ kind: 'attachment', attachment: a, itemUid, score: q ? (label.startsWith(q) ? 0 : 1) : 3 });
      }
    }

    // Local file tree matches (fast, no network).
    if (q.length >= 2) {
      let fileCount = 0;
      for (const f of flatFiles) {
        if (fileCount >= 5) break;
        const nameL = f.name.toLowerCase();
        const pathL = f.path.toLowerCase();
        if (nameL.includes(q) || pathL.includes(q)) {
          scored.push({
            kind: 'file',
            path: f.path,
            name: f.name,
            isDir: f.type !== 'file',
            score: nameL.startsWith(q) ? 4 : 5,
          });
          fileCount++;
        }
      }
    }

    // Symbol search results (from API, arrive async).
    for (const r of codeResults) {
      scored.push({
        kind: 'symbol',
        result: r,
        score: 6,
      });
    }

    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 14);
  }, [filter, items, attachments, flatFiles, codeResults]);

  const closePicker = () => {
    setOpen(false);
    setFilter('');
    setHighlight(0);
    triggerStartRef.current = null;
    setCodeResults([]);
  };

  const reposition = () => {
    const ta = opts.textareaRef.current;
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split('\n').length;
    const lineHeight = 22;
    setAnchor({ top: rect.top + lines * lineHeight + 8, left: rect.left + 16 });
  };

  const insertChip = (suggestion: Suggestion) => {
    const ta = opts.textareaRef.current;
    if (!ta || triggerStartRef.current === null) {
      closePicker();
      return;
    }
    const start = triggerStartRef.current;
    const end = ta.selectionStart;
    let chip: string;

    if (suggestion.kind === 'item') {
      chip = `[[item:${suggestion.item.uid}|${suggestion.item.title || 'untitled'}]]`;
    } else if (suggestion.kind === 'attachment') {
      const label = suggestion.attachment.label ?? suggestion.attachment.value.slice(0, 40);
      chip = `[[attach:${suggestion.attachment.uid}|${label}]]`;
    } else if (suggestion.kind === 'file') {
      const label = suggestion.name;
      chip = `[[file:${suggestion.path}|${label}]]`;
      opts.onFileTarget?.(suggestion.path);
    } else {
      // symbol
      const r = suggestion.result;
      chip = `[[symbol:${r.name}@${r.relativePath}|${r.name}]]`;
      opts.onSymbolTarget?.(r.name, r.kind, r.relativePath);
    }

    const next = ta.value.slice(0, start) + chip + ' ' + ta.value.slice(end);
    opts.onChange(next);
    requestAnimationFrame(() => {
      const newPos = start + chip.length + 1;
      const liveTa = opts.textareaRef.current;
      if (liveTa) {
        liveTa.selectionStart = newPos;
        liveTa.selectionEnd = newPos;
        liveTa.focus();
      }
    });
    closePicker();
  };

  const onInput = () => {
    const ta = opts.textareaRef.current;
    if (!ta) return;
    const value = ta.value;
    const caret = ta.selectionStart;

    // Walk backwards from caret to find a `@` preceded by whitespace
    // / start-of-string, with no whitespace between it and the caret.
    let i = caret - 1;
    let triggerStart: number | null = null;
    while (i >= 0) {
      const ch = value[i];
      if (ch === '@') {
        const prev = i > 0 ? value[i - 1] : '';
        if (prev === '' || /\s/.test(prev)) {
          triggerStart = i;
        }
        break;
      }
      if (/\s/.test(ch)) break;
      i--;
    }

    if (triggerStart === null) {
      if (open) closePicker();
      return;
    }

    triggerStartRef.current = triggerStart;
    const fragment = value.slice(triggerStart + 1, caret);
    setFilter(fragment);
    setHighlight(0);
    if (!open) {
      reposition();
      setOpen(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions[highlight]) {
        e.preventDefault();
        insertChip(suggestions[highlight]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePicker();
    }
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const ta = opts.textareaRef.current;
      const target = e.target as Node;
      if (ta && (ta === target || ta.contains(target))) return;
      const picker = document.getElementById('mention-picker-floating');
      if (picker && picker.contains(target)) return;
      closePicker();
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open, opts.textareaRef]);

  // Category headers for visual grouping.
  const hasItems = suggestions.some((s) => s.kind === 'item' || s.kind === 'attachment');
  const hasCode = suggestions.some((s) => s.kind === 'file' || s.kind === 'symbol');

  const picker = open && suggestions.length > 0 ? (
    <div
      id="mention-picker-floating"
      className="fixed z-50 w-[400px] max-h-[380px] overflow-y-auto rounded-lg border border-white/[0.08] bg-[#0c0e1a]/95 backdrop-blur-md shadow-xl py-1.5"
      style={{ top: anchor.top, left: anchor.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {suggestions.map((s, i) => {
        // Insert category dividers.
        const prevKind = i > 0 ? suggestions[i - 1].kind : null;
        const curIsCode = s.kind === 'file' || s.kind === 'symbol';
        const prevIsCode = prevKind === 'file' || prevKind === 'symbol';
        const showCodeHeader = curIsCode && !prevIsCode && hasItems;

        return (
          <div key={getKey(s, i)}>
            {showCodeHeader && (
              <div className="px-3.5 pt-2 pb-1 text-[10.5px] uppercase tracking-wider text-foreground-subtle font-medium border-t border-white/[0.06] mt-1">
                Code
              </div>
            )}
            <SuggestionRow
              suggestion={s}
              highlighted={i === highlight}
              onPick={() => insertChip(s)}
              onHover={() => setHighlight(i)}
            />
          </div>
        );
      })}
      {filter.length >= 2 && !hasCode && (
        <div className="px-3.5 py-2 text-[12px] text-foreground-subtle italic border-t border-white/[0.06] mt-1">
          Searching code…
        </div>
      )}
    </div>
  ) : null;

  return {
    textareaProps: { onKeyDown, onInput },
    picker,
  };
}

function getKey(s: { kind: string; item?: PlanItem; attachment?: TaskAttachment; path?: string; result?: SymbolSearchResult }, i: number): string {
  if (s.kind === 'item' && s.item) return `i:${s.item.uid}`;
  if (s.kind === 'attachment' && s.attachment) return `a:${s.attachment.uid}`;
  if (s.kind === 'file') return `f:${(s as { path: string }).path}`;
  if (s.kind === 'symbol' && s.result) return `s:${s.result.name}@${s.result.relativePath}:${s.result.startLine}`;
  return `x:${i}`;
}

function SuggestionRow({
  suggestion, highlighted, onPick, onHover,
}: {
  suggestion: { kind: string; item?: PlanItem; attachment?: TaskAttachment; path?: string; name?: string; isDir?: boolean; result?: SymbolSearchResult; score: number };
  highlighted: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  if (suggestion.kind === 'item' && suggestion.item) {
    const item = suggestion.item;
    const KindIcon = item.kind === 'action' ? Zap : FileText;
    return (
      <button
        onClick={onPick}
        onMouseEnter={onHover}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left ${
          highlighted ? 'bg-accent/15' : 'hover:bg-white/[0.04]'
        }`}
      >
        <KindIcon size={14} className={item.kind === 'action' ? 'text-accent' : 'text-foreground-subtle'} />
        <span className="truncate flex-1 text-[13.5px] text-foreground">{item.title || 'untitled'}</span>
        <span className="text-[11px] uppercase tracking-wider text-foreground-subtle/70">
          {item.kind}
        </span>
      </button>
    );
  }

  if (suggestion.kind === 'attachment' && suggestion.attachment) {
    const a = suggestion.attachment;
    const KindIcon = a.kind === 'url' ? Link2 : a.kind === 'image' ? ImageIcon : a.kind === 'video' ? Video : a.kind === 'code_block' ? Code : FileText;
    return (
      <button
        onClick={onPick}
        onMouseEnter={onHover}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left ${
          highlighted ? 'bg-accent/15' : 'hover:bg-white/[0.04]'
        }`}
      >
        <KindIcon size={14} className="text-foreground-subtle" />
        <span className="truncate flex-1 text-[13px] text-foreground-muted">{a.label || a.value.slice(0, 60)}</span>
        <span className="text-[11px] uppercase tracking-wider text-foreground-subtle/70">{a.kind}</span>
      </button>
    );
  }

  if (suggestion.kind === 'file') {
    const Icon = suggestion.isDir ? Folder : FileText;
    return (
      <button
        onClick={onPick}
        onMouseEnter={onHover}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left ${
          highlighted ? 'bg-accent/15' : 'hover:bg-white/[0.04]'
        }`}
      >
        <Icon size={14} className="text-emerald-400" />
        <span className="truncate flex-1 text-[13px] font-mono text-foreground">{suggestion.name}</span>
        <span className="text-[10.5px] text-foreground-subtle truncate max-w-[160px]">
          {suggestion.path}
        </span>
      </button>
    );
  }

  if (suggestion.kind === 'symbol' && suggestion.result) {
    const r = suggestion.result;
    return (
      <button
        onClick={onPick}
        onMouseEnter={onHover}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left ${
          highlighted ? 'bg-accent/15' : 'hover:bg-white/[0.04]'
        }`}
      >
        <Hash size={14} className="text-cyan-400" />
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-mono text-foreground truncate block">{r.name}</span>
          <span className="text-[11px] text-foreground-subtle truncate block">{r.relativePath}:{r.startLine}</span>
        </div>
        <span className="text-[10.5px] uppercase tracking-wider text-foreground-subtle/70">{r.kind}</span>
      </button>
    );
  }

  return null;
}
