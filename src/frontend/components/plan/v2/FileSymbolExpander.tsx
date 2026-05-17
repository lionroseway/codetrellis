/**
 * Phase 17.D — Symbol-Aware File Expansion.
 *
 * When a file target is added to a plan Action, this component
 * fetches the file's symbols from `/api/symbols/file` and displays
 * them as checkable rows. Checked symbols get a per-symbol
 * instruction field, and the results flow into the item's
 * `fileSpecs[].edits[]` array.
 *
 * Design: renders below a fileSpec pill in the TargetsStrip when
 * the pill is expanded (click chevron or auto-expand on add).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Box,
  Braces,
  Hash,
  AlertTriangle,
} from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import type { PlanItem, FileSpec, FileEdit } from '@shared/types';

interface FileSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  modifiers: string[];
}

interface SymbolCheckState {
  name: string;
  checked: boolean;
  instruction: string;
}

function kindIcon(kind: string) {
  switch (kind) {
    case 'function': return Code2;
    case 'class': return Box;
    case 'interface':
    case 'type': return Braces;
    default: return Hash;
  }
}

function kindColor(kind: string): string {
  switch (kind) {
    case 'function': return 'text-blue-400';
    case 'class': return 'text-amber-400';
    case 'interface':
    case 'type': return 'text-cyan-400';
    case 'enum': return 'text-purple-400';
    default: return 'text-zinc-400';
  }
}

export function FileSymbolExpander({
  item,
  fileSpec,
  fileSpecIndex,
  defaultExpanded = false,
}: {
  item: PlanItem;
  fileSpec: FileSpec;
  fileSpecIndex: number;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [symbols, setSymbols] = useState<FileSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateItem = usePlanItemsStore((s) => s.updateItem);

  // Derive checked state from item's fileSpecs[].edits[]
  const existingEdits = fileSpec.edits ?? [];
  const [checkStates, setCheckStates] = useState<SymbolCheckState[]>([]);

  // Fetch symbols on expand
  useEffect(() => {
    if (!expanded || symbols.length > 0) return;
    setLoading(true);
    setError(null);
    fetch(`/api/symbols/file?path=${encodeURIComponent(fileSpec.path)}`)
      .then((res) => res.json())
      .then((data: FileSymbol[]) => {
        setSymbols(data);
        // Initialize check states from existing edits
        const states: SymbolCheckState[] = data.map((sym) => {
          const existingEdit = existingEdits.find((e) => e.symbol === sym.name);
          return {
            name: sym.name,
            checked: !!existingEdit,
            instruction: existingEdit?.instruction ?? '',
          };
        });
        setCheckStates(states);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load symbols');
        setLoading(false);
      });
  }, [expanded, fileSpec.path]);

  // Update check states when symbols are loaded and edits change externally
  useEffect(() => {
    if (symbols.length === 0) return;
    setCheckStates(symbols.map((sym) => {
      const existingEdit = existingEdits.find((e) => e.symbol === sym.name);
      return {
        name: sym.name,
        checked: !!existingEdit,
        instruction: existingEdit?.instruction ?? '',
      };
    }));
  }, [existingEdits.length]);

  // Persist changes to the item's fileSpecs[].edits
  const persistEdits = useCallback(
    (newStates: SymbolCheckState[]) => {
      const edits: FileEdit[] = newStates
        .filter((s) => s.checked)
        .map((s) => {
          const sym = symbols.find((sy) => sy.name === s.name);
          return {
            symbol: s.name,
            instruction: s.instruction || `Modify ${s.name}`,
            intent: 'modify' as const,
            lineRange: sym ? { start: sym.startLine, end: sym.endLine } : undefined,
          };
        });

      const newFileSpecs = [...(item.fileSpecs ?? [])];
      newFileSpecs[fileSpecIndex] = { ...newFileSpecs[fileSpecIndex], edits };
      updateItem(item.uid, { fileSpecs: newFileSpecs });
    },
    [item, fileSpecIndex, symbols, updateItem],
  );

  const toggleSymbol = (name: string) => {
    setCheckStates((prev) => {
      const next = prev.map((s) =>
        s.name === name ? { ...s, checked: !s.checked } : s,
      );
      persistEdits(next);
      return next;
    });
  };

  const setInstruction = (name: string, instruction: string) => {
    setCheckStates((prev) => {
      const next = prev.map((s) =>
        s.name === name ? { ...s, instruction } : s,
      );
      // Debounce: we'll persist on blur instead
      return next;
    });
  };

  const persistOnBlur = () => {
    persistEdits(checkStates);
  };

  const checkedCount = checkStates.filter((s) => s.checked).length;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="mt-1 ml-6">
      {/* Toggle row */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-1.5 text-[11px] text-foreground-subtle hover:text-foreground transition-colors group"
      >
        <Chevron size={12} className="text-zinc-500 group-hover:text-zinc-300" />
        <span>
          {symbols.length > 0
            ? `${symbols.length} symbols`
            : 'Expand symbols'
          }
        </span>
        {checkedCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-medium">
            {checkedCount} selected
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-1.5 ml-1 border-l border-white/[0.06] pl-3 space-y-0.5">
          {loading && (
            <div className="text-[11px] text-foreground-subtle animate-pulse py-1">
              Loading symbols...
            </div>
          )}
          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-400 py-1">
              <AlertTriangle size={11} />
              {error}
            </div>
          )}
          {!loading && !error && symbols.length === 0 && (
            <div className="text-[11px] text-foreground-subtle py-1">
              No symbols found (file may not be scanned yet)
            </div>
          )}
          {symbols.map((sym, idx) => {
            const state = checkStates[idx];
            if (!state) return null;
            const Icon = kindIcon(sym.kind);
            const color = kindColor(sym.kind);
            return (
              <div key={`${sym.name}-${sym.startLine}`} className="group/sym">
                <div className="flex items-center gap-2 py-1">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={state.checked}
                    onChange={() => toggleSymbol(sym.name)}
                    className="w-3.5 h-3.5 rounded border-white/20 bg-white/[0.03] text-accent focus:ring-accent/30 cursor-pointer"
                  />
                  {/* Icon + name */}
                  <Icon size={12} className={`${color} shrink-0`} />
                  <span className="text-[12px] font-mono text-foreground-muted group-hover/sym:text-foreground transition-colors">
                    {sym.name}
                  </span>
                  {/* Kind badge */}
                  <span className="text-[9.5px] uppercase tracking-wider text-foreground-subtle opacity-60">
                    {sym.kind}
                  </span>
                  {/* Line range */}
                  <span className="text-[10px] text-foreground-subtle opacity-40 ml-auto">
                    L{sym.startLine}-{sym.endLine}
                  </span>
                  {/* Modifiers */}
                  {sym.modifiers.includes('exported') && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      export
                    </span>
                  )}
                </div>
                {/* Per-symbol instruction (shown when checked) */}
                {state.checked && (
                  <div className="ml-5.5 mb-1">
                    <input
                      type="text"
                      value={state.instruction}
                      onChange={(e) => setInstruction(sym.name, e.target.value)}
                      onBlur={persistOnBlur}
                      placeholder={`What to do with ${sym.name}...`}
                      className="w-full text-[11.5px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground-muted placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
