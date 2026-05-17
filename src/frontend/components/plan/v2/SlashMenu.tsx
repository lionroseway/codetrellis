import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Zap, Heading1, Heading2, Heading3, ListChecks, Code, Quote, Minus, Hash } from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { usePlanStore } from '../../../stores/plan-store';
import { useToastStore } from '../../../stores/toast-store';

/**
 * Phase 15 §15.D — slash menu for any body editor.
 *
 * Triggered by typing `/` at start-of-line OR after whitespace inside
 * a `<textarea>`. Two flavours of action:
 *
 *   - **Block inserts** — pure markdown additions (heading, todo,
 *     code block, divider, quote). The slash + filter text is
 *     replaced with the chosen markdown.
 *
 *   - **Item creators** — Object / Action sub-page creation. Creates
 *     a child `plan_items` row via the store, then inserts a
 *     `[[item:<uid>|<title>]]` (or `[[action:<uid>|<title>]]`) chip
 *     at the cursor. The `PlanBodyEditor` host is responsible for
 *     persisting the next body via its onChange callback.
 *
 * Returns the props the host textarea spreads + the floating picker
 * element to render. Mirrors the API shape of `useMentionPicker`.
 *
 * Optional `parentItemUid` — when provided, sub-pages are created
 * under that item. Otherwise they're created at the plan root.
 */

export interface SlashMenuHook {
  textareaProps: {
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onInput: (e: React.FormEvent<HTMLTextAreaElement>) => void;
  };
  picker: React.ReactNode;
}

interface SlashOption {
  id: string;
  label: string;
  description: string;
  Icon: typeof Hash;
  /**
   * Returns the text to insert at the trigger range (replacing the `/…`
   * fragment). Async to support item creation that hits the network.
   */
  apply: (ctx: { planUid: string; parentItemUid: string | null }) => Promise<string>;
  /** Filter terms — what the user types after `/` to surface this. */
  match: string[];
}

export function useSlashMenu(opts: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (next: string) => void;
  parentItemUid?: string | null;
}): SlashMenuHook {
  const planUid = usePlanStore((s) => s.activePlanUid);
  const createItem = usePlanItemsStore((s) => s.createItem);
  const addToast = useToastStore((s) => s.addToast);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerStartRef = useRef<number | null>(null);
  // Phase 15 §15.D bug-fix — without a busy lock, clicking an
  // item-creator option twice (or once during a slow network) fires
  // createItem twice. Set on insert entry, cleared in finally.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const closePicker = () => {
    setOpen(false);
    setFilter('');
    setHighlight(0);
    triggerStartRef.current = null;
  };

  // The full options list. Item-creation items at the top because
  // they're the highest-leverage moves; block inserts after.
  const options = useMemo<SlashOption[]>(() => {
    return [
      {
        id: 'sub-object',
        label: 'Sub-page (Object)',
        description: 'Context page — markdown body, attachments, can hold actions',
        Icon: FileText,
        match: ['page', 'sub', 'object', 'doc', 'note'],
        apply: async ({ planUid, parentItemUid }) => {
          if (!planUid) return '';
          const item = await createItem({
            planUid,
            kind: 'object',
            parentUid: parentItemUid,
            title: 'Untitled',
          });
          if (!item) return '';
          // Phase 15 §15.D bug-fix: no auto-navigation. Inserting the
          // chip is enough — user clicks the chip when they're ready
          // to enter the new page. Auto-nav was confusing because
          // the canvas re-flowed away from the editor mid-typing.
          addToast({ type: 'success', title: 'Sub-page added', message: item.title || 'Untitled', duration: 2500 });
          return `[[item:${item.uid}|${item.title || 'Untitled'}]]`;
        },
      },
      {
        id: 'sub-action',
        label: 'Action (work item)',
        description: 'Graph-anchored work — status, files, edits, agent claim',
        Icon: Zap,
        match: ['action', 'task', 'work', 'todo'],
        apply: async ({ planUid, parentItemUid }) => {
          if (!planUid) return '';
          const item = await createItem({
            planUid,
            kind: 'action',
            parentUid: parentItemUid,
            title: 'Untitled action',
          });
          if (!item) return '';
          addToast({ type: 'success', title: 'Action added', message: item.title || 'Untitled action', duration: 2500 });
          return `[[action:${item.uid}|${item.title || 'Untitled action'}]]`;
        },
      },
      {
        id: 'h1',
        label: 'Heading 1',
        description: 'Big section heading',
        Icon: Heading1,
        match: ['h1', 'heading', 'title'],
        apply: async () => '# ',
      },
      {
        id: 'h2',
        label: 'Heading 2',
        description: 'Sub-section heading',
        Icon: Heading2,
        match: ['h2', 'heading'],
        apply: async () => '## ',
      },
      {
        id: 'h3',
        label: 'Heading 3',
        description: 'Tertiary heading',
        Icon: Heading3,
        match: ['h3', 'heading'],
        apply: async () => '### ',
      },
      {
        id: 'todo',
        label: 'Todo',
        description: 'Markdown checkbox',
        Icon: ListChecks,
        match: ['todo', 'task', 'check', 'todos'],
        apply: async () => '- [ ] ',
      },
      {
        id: 'code',
        label: 'Code block',
        description: 'Triple-backtick fenced code',
        Icon: Code,
        match: ['code', 'snippet', 'fence'],
        apply: async () => '```\n\n```',
      },
      {
        id: 'quote',
        label: 'Quote',
        description: 'Blockquote (>)',
        Icon: Quote,
        match: ['quote', 'callout'],
        apply: async () => '> ',
      },
      {
        id: 'divider',
        label: 'Divider',
        description: 'Horizontal rule (---)',
        Icon: Minus,
        match: ['divider', 'rule', 'hr'],
        apply: async () => '\n---\n\n',
      },
    ];
  }, [createItem, addToast]);

  // Filter + highlight reset on every keystroke.
  const suggestions = useMemo(() => {
    const q = filter.toLowerCase().trim();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || o.match.some((m) => m.toLowerCase().includes(q)),
    );
  }, [filter, options]);

  const reposition = () => {
    const ta = opts.textareaRef.current;
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split('\n').length;
    const lineHeight = 22;
    setAnchor({ top: rect.top + lines * lineHeight + 8, left: rect.left + 16 });
  };

  const insert = async (option: SlashOption) => {
    // Busy-lock — blocks duplicate fires from rapid clicks or
    // simultaneous Enter + click. Without this, an item-creator
    // option could create N items in flight before any await
    // resolves.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    const ta = opts.textareaRef.current;
    if (!ta || triggerStartRef.current === null) {
      busyRef.current = false;
      setBusy(false);
      closePicker();
      return;
    }
    const start = triggerStartRef.current;
    const end = ta.selectionStart;

    // Snapshot the value before the await so a slow create doesn't
    // race against further keystrokes that move the textarea content.
    const prevValue = ta.value;

    // Close the picker FIRST so further interactions can't re-trigger
    // until apply finishes. Even though we have busyRef, closing here
    // also dismisses the visual menu so the user knows their click
    // landed.
    closePicker();

    try {
      const inserted = await option.apply({ planUid: planUid ?? '', parentItemUid: opts.parentItemUid ?? null });
      if (!inserted) return;
      const next = prevValue.slice(0, start) + inserted + prevValue.slice(end);
      opts.onChange(next);
      requestAnimationFrame(() => {
        const newPos = start + inserted.length;
        const targetPos = inserted === '```\n\n```' ? start + 4 : newPos;
        // Re-fetch the textarea — it may have unmounted while we
        // awaited (e.g. user navigated away). Skip cursor restore
        // when no longer alive.
        const liveTa = opts.textareaRef.current;
        if (liveTa) {
          liveTa.selectionStart = targetPos;
          liveTa.selectionEnd = targetPos;
          liveTa.focus();
        }
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onInput = () => {
    const ta = opts.textareaRef.current;
    if (!ta) return;
    const value = ta.value;
    const caret = ta.selectionStart;

    // Walk backwards to find a `/` preceded by start-of-string or
    // whitespace, with no whitespace between it and the caret.
    let i = caret - 1;
    let triggerStart: number | null = null;
    while (i >= 0) {
      const ch = value[i];
      if (ch === '/') {
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
    if (busyRef.current) {
      // Swallow input while we're mid-apply so a held Enter doesn't
      // fire createItem N times before the first await returns.
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions[highlight]) {
        e.preventDefault();
        insert(suggestions[highlight]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePicker();
    }
  };

  // Click-outside closes.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const ta = opts.textareaRef.current;
      const target = e.target as Node;
      if (ta && (ta === target || ta.contains(target))) return;
      const picker = document.getElementById('slash-menu-floating');
      if (picker && picker.contains(target)) return;
      closePicker();
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open, opts.textareaRef]);

  const picker = open && suggestions.length > 0 ? (
    <div
      id="slash-menu-floating"
      className="fixed z-50 w-[360px] max-h-[400px] overflow-y-auto rounded-lg border border-white/[0.08] bg-[#0c0e1a]/95 backdrop-blur-md shadow-xl py-1.5"
      style={{ top: anchor.top, left: anchor.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {suggestions.map((opt, i) => (
        <button
          key={opt.id}
          onClick={() => insert(opt)}
          onMouseEnter={() => setHighlight(i)}
          disabled={busy}
          className={`w-full flex items-start gap-3 px-3.5 py-2.5 text-left ${
            busy ? 'opacity-50 cursor-wait' :
              i === highlight ? 'bg-accent/15' : 'hover:bg-white/[0.04]'
          }`}
        >
          <opt.Icon size={16} className={`mt-0.5 shrink-0 ${
            opt.id === 'sub-action' ? 'text-accent' : 'text-foreground-subtle'
          }`} />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium text-foreground">{opt.label}</div>
            <div className="text-[12px] text-foreground-subtle truncate">{opt.description}</div>
          </div>
        </button>
      ))}
    </div>
  ) : null;

  return {
    textareaProps: { onKeyDown, onInput },
    picker,
  };
}
