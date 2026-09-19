import { useMemo, useState, useCallback } from 'react';
import { FileText, Folder, Hash, ArrowRight, X, Plus } from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { FileSymbolExpander } from './FileSymbolExpander';
import { AnchorPicker, type AnchorSelection } from './AnchorPicker';
import type { PlanItem, SymbolSpec } from '@shared/types';

/**
 * Phase 15 §15.D.2 — Targets Strip.
 *
 * Thin, reactive horizontal strip displayed below the body editor on
 * Action and Object item pages. Shows all code-level targets attached
 * to the item, derived from TWO sources:
 *
 *   1. **Body chips** — `[[file:...]]` and `[[symbol:...]]` inline
 *      references written via the `@` mention picker. These are
 *      parsed from the body text (source-of-truth is the body).
 *
 *   2. **API-added targets** — `fileSpecs`, `symbolSpecs`,
 *      `newConnections`, `removedConnections` on the PlanItem row.
 *      These arrive via AI agent calling `update_item` at runtime,
 *      and via the ContextRail's "+Add" AnchorPicker.
 *
 * The strip de-duplicates across both sources (a file pinned via @
 * AND via API shows once). Each target is a compact pill that can be
 * x'd to remove. For Actions, pills show the verb (add/modify/remove).
 *
 * The "+" opens the AnchorPicker. It used to do that only when a caller
 * passed `onAddClick`, and no caller ever did — so the button, its
 * tooltip and the picker behind it were unreachable from every surface
 * that renders this strip. The capability existed (the ContextRail's
 * "Add context", further down the page), which is why nothing looked
 * broken: the eye-level affordance was simply absent. The strip now owns
 * the picker, and `onAddClick` stays as an override for a caller that
 * wants its own flow rather than as the thing that switches the button
 * on.
 *
 * Design: the strip is NOT the same as the ContextRail. The rail lives
 * lower on the page and shows full-detail rows with descriptions,
 * expand panels, edge declarations. The strip is eye-level with the
 * body — a quick scan of "what code does this touch?"
 */

// Body chip patterns for extraction.
const FILE_CHIP = /\[\[file:([^\]|]+)\|([^\]]*)\]\]/gi;
const SYMBOL_CHIP = /\[\[symbol:([^\]|]+)\|([^\]]*)\]\]/gi;

interface TargetPill {
  id: string;
  kind: 'file' | 'folder' | 'symbol' | 'edge';
  label: string;
  detail?: string;
  verb?: string;
  source: 'body' | 'api';
}

function extractBodyTargets(body: string): TargetPill[] {
  const out: TargetPill[] = [];
  FILE_CHIP.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FILE_CHIP.exec(body)) !== null) {
    const [, path, label] = m;
    const isDir = path.endsWith('/');
    out.push({
      id: `body-file:${path}`,
      kind: isDir ? 'folder' : 'file',
      label: label || path.split('/').pop() || path,
      detail: path,
      source: 'body',
    });
  }
  SYMBOL_CHIP.lastIndex = 0;
  while ((m = SYMBOL_CHIP.exec(body)) !== null) {
    const [, value, label] = m;
    const atIdx = value.indexOf('@');
    const name = atIdx >= 0 ? value.slice(0, atIdx) : value;
    const filePath = atIdx >= 0 ? value.slice(atIdx + 1) : '';
    out.push({
      id: `body-sym:${value}`,
      kind: 'symbol',
      label: label || name,
      detail: filePath ? `${filePath}` : undefined,
      source: 'body',
    });
  }
  return out;
}

function extractApiTargets(item: PlanItem): TargetPill[] {
  const out: TargetPill[] = [];
  for (const fs of item.fileSpecs ?? []) {
    const isDir = fs.isDir || fs.path.endsWith('/');
    out.push({
      id: `api-file:${fs.path}`,
      kind: isDir ? 'folder' : 'file',
      label: fs.path.split('/').pop() || fs.path,
      detail: fs.path,
      verb: fs.action,
      source: 'api',
    });
  }
  for (const ss of item.symbolSpecs ?? []) {
    out.push({
      id: `api-sym:${ss.name}@${ss.filePath ?? ''}`,
      kind: 'symbol',
      label: ss.name,
      detail: ss.filePath,
      verb: ss.action,
      source: 'api',
    });
  }
  for (const e of item.newConnections ?? []) {
    out.push({
      id: `api-edge-new:${e.from}->${e.to}`,
      kind: 'edge',
      label: `${e.from} → ${e.to}`,
      verb: 'add',
      source: 'api',
    });
  }
  for (const e of item.removedConnections ?? []) {
    out.push({
      id: `api-edge-rm:${e.from}->${e.to}`,
      kind: 'edge',
      label: `${e.from} → ${e.to}`,
      verb: 'remove',
      source: 'api',
    });
  }
  return out;
}

export function TargetsStrip({
  item,
  onAddClick,
}: {
  item: PlanItem;
  /** Opens the AnchorPicker when the user clicks "+Add target". */
  onAddClick?: () => void;
}) {
  const updateItem = usePlanItemsStore((s) => s.updateItem);
  const [picking, setPicking] = useState(false);
  const body = item.body ?? '';

  /**
   * Write a picked anchor onto the item.
   *
   * Paths are stored exactly as the picker reports them — project
   * relative — because that is the shape review and the drift feed match
   * on. Storing an absolute path here looks identical on screen and makes
   * every later "did it land?" answer no.
   */
  const addTarget = useCallback((sel: AnchorSelection) => {
    setPicking(false);
    if (sel.kind === 'symbol') {
      const existing = item.symbolSpecs ?? [];
      if (existing.some((ss) => ss.name === sel.value && ss.filePath === sel.filePath)) return;
      updateItem(item.uid, {
        symbolSpecs: [
          ...existing,
          {
            name: sel.value,
            kind: (sel.symbolKind as SymbolSpec['kind']) ?? 'function',
            action: 'modify',
            filePath: sel.filePath,
          },
        ],
      });
      return;
    }
    const existing = item.fileSpecs ?? [];
    if (existing.some((fs) => fs.path === sel.value)) return;
    updateItem(item.uid, {
      fileSpecs: [
        ...existing,
        { path: sel.value, action: 'modify', ...(sel.kind === 'folder' ? { isDir: true } : {}) },
      ],
    });
  }, [item.uid, item.fileSpecs, item.symbolSpecs, updateItem]);

  const targets = useMemo(() => {
    const bodyTargets = extractBodyTargets(body);
    const apiTargets = extractApiTargets(item);

    // De-duplicate: prefer API targets (they have verb info). Key by
    // normalized path or name so a file pinned via @ AND via API shows once.
    const seen = new Set<string>();
    const merged: TargetPill[] = [];

    for (const t of apiTargets) {
      const key = t.detail ?? t.label;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    for (const t of bodyTargets) {
      const key = t.detail ?? t.label;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    return merged;
  }, [body, item.fileSpecs, item.symbolSpecs, item.newConnections, item.removedConnections]);

  const removeTarget = (target: TargetPill) => {
    if (target.source !== 'api') return; // body-only targets removed by editing the body

    if (target.kind === 'file' || target.kind === 'folder') {
      const next = (item.fileSpecs ?? []).filter((fs) => fs.path !== target.detail);
      updateItem(item.uid, { fileSpecs: next });
    } else if (target.kind === 'symbol') {
      const next = (item.symbolSpecs ?? []).filter((ss) => {
        const key = `${ss.name}@${ss.filePath ?? ''}`;
        return key !== target.id.replace('api-sym:', '');
      });
      updateItem(item.uid, { symbolSpecs: next });
    } else if (target.kind === 'edge') {
      if (target.verb === 'add') {
        const next = (item.newConnections ?? []).filter(
          (e) => `${e.from}->${e.to}` !== target.id.replace('api-edge-new:', ''),
        );
        updateItem(item.uid, { newConnections: next });
      } else {
        const next = (item.removedConnections ?? []).filter(
          (e) => `${e.from}->${e.to}` !== target.id.replace('api-edge-rm:', ''),
        );
        updateItem(item.uid, { removedConnections: next });
      }
    }
  };

  // Progressive disclosure, but not invisibility. This used to return
  // null with no targets, which is exactly the state every newly created
  // item is in — so the one place a person looks for "what code does this
  // touch?" showed nothing, and offered no way to say. The docstring
  // above has always described a placeholder and an add button here; now
  // there is one. It stays a single dashed button, not a section, so the
  // page is no busier than before for an item that has targets.
  if (targets.length === 0) {
    return (
      <div className="px-1 py-2">
        <button
          onClick={onAddClick ?? (() => setPicking(true))}
          className="flex items-center gap-1.5 px-2 py-1 text-[11.5px] rounded-md border border-dashed border-white/[0.1] text-foreground-subtle hover:text-foreground hover:border-accent/30 hover:bg-accent/5 transition-colors"
          title="Add a file, symbol, or edge target"
        >
          <Plus size={11} /> Add a target
        </button>
        {picking && (
          <AnchorPicker
            planUid={item.planUid}
            title="Add a target"
            onPick={addTarget}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    );
  }

  // Phase 17.D — File targets that can be expanded to show symbols
  const fileTargetsWithIndex = (item.fileSpecs ?? []).map((fs, idx) => ({
    fs,
    idx,
    pill: targets.find((t) => t.detail === fs.path && t.kind === 'file'),
  }));

  return (
    <div className="px-1 py-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider text-foreground-subtle font-medium mr-1">
          Targets
        </span>
        {targets.map((t) => (
          <TargetPillChip key={t.id} target={t} onRemove={t.source === 'api' ? () => removeTarget(t) : undefined} />
        ))}
        {(
          <button
            onClick={onAddClick ?? (() => setPicking(true))}
            className="flex items-center gap-1 px-2 py-1 text-[11.5px] rounded-md border border-dashed border-white/[0.1] text-foreground-subtle hover:text-foreground hover:border-accent/30 hover:bg-accent/5 transition-colors"
            title="Add a file, symbol, or edge target"
          >
            <Plus size={11} />
          </button>
        )}
        {picking && (
          <AnchorPicker
            planUid={item.planUid}
            title="Add a target"
            onPick={addTarget}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
      {/* Phase 17.D — Symbol expanders for file targets */}
      {item.kind === 'action' && fileTargetsWithIndex.map(({ fs, idx }) => (
        <FileSymbolExpander
          key={`sym-${fs.path}`}
          item={item}
          fileSpec={fs}
          fileSpecIndex={idx}
        />
      ))}
    </div>
  );
}

function TargetPillChip({ target, onRemove }: { target: TargetPill; onRemove?: () => void }) {
  const Icon = target.kind === 'file' ? FileText
    : target.kind === 'folder' ? Folder
    : target.kind === 'symbol' ? Hash
    : ArrowRight;

  const tint = target.kind === 'file' || target.kind === 'folder'
    ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300'
    : target.kind === 'symbol'
    ? 'border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-300'
    : 'border-amber-500/25 bg-amber-500/[0.06] text-amber-300';

  const verbTint = target.verb === 'add' ? 'text-emerald-400'
    : target.verb === 'remove' ? 'text-red-400'
    : target.verb === 'modify' ? 'text-accent'
    : target.verb === 'move' ? 'text-amber-400'
    : '';

  return (
    <span
      className={`group inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[12.5px] font-mono ${tint}`}
      title={target.detail ?? target.label}
    >
      <Icon size={12} className="opacity-70 shrink-0" />
      {target.verb && (
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${verbTint}`}>
          {target.verb}
        </span>
      )}
      <span className="truncate max-w-[180px]">{target.label}</span>
      {target.source === 'body' && (
        <span className="text-[9px] opacity-50 ml-0.5">@</span>
      )}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/[0.1]"
          title="Remove target"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}
