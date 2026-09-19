import path from 'node:path';
import { listAllItems } from './plan-item-service';
import { getFileSymbolsWithMembers } from './database';
import type { PlanItem, FileSpec, FileEdit } from '../../shared/types';

/**
 * Plan overlay — Phase 26, layer A.
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * Projects a plan's declared intent onto the lines of a file, so a
 * developer reading code can see what is planned for it:
 *
 *     40 │     return store.Save(l.entries)      ◀ Rotate signing keys
 *
 * `FileSpec.edits[]` has carried `lineRange` and `symbol` since Phase 15
 * §M2. **Nothing has ever drawn it.** This is projection, not new
 * machinery — which is why it is the cheapest of the phase's four layers
 * and the most distinctive.
 *
 * ## The three shapes an edit can take
 *
 * Each is treated differently on purpose, because conflating them
 * produces noise where the point is signal:
 *
 *   - **`lineRange`** — anchored. Mark exactly those lines.
 *   - **`symbol`** — resolved through the symbols table to the symbol's
 *     span. That is what the symbols table is for.
 *   - **neither** — "anywhere in this file". Rendered as a file-level
 *     banner, NOT as a whole-file highlight: marking every line would be
 *     noise on every line, and a reader would learn to ignore it.
 *
 * And a fourth outcome that matters as much as the three:
 *
 *   - **unanchored** — an edit that names lines the file does not have,
 *     or a symbol that no longer exists. Reported as such, never clamped
 *     to the end of the file. A marker in the wrong place is worse than
 *     no marker, because a reader believes it.
 */

export type OverlayAnchor = 'lines' | 'symbol' | 'file' | 'unanchored';

export interface OverlayMarker {
  itemUid: string;
  itemTitle: string;
  itemStatus: string | null;
  planUid: string;
  /** How the edit was pinned, and whether it resolved. */
  anchor: OverlayAnchor;
  /** 1-indexed inclusive span. Null for `file` and `unanchored`. */
  startLine: number | null;
  endLine: number | null;
  /** The edit's instruction, verbatim. */
  instruction: string;
  /** add / modify / remove / replace, when the author gave one. */
  intent: string | null;
  /** The symbol an edit pinned to, whether or not it resolved. */
  symbol: string | null;
  /** Why an edit is unanchored. Present only for `unanchored`. */
  reason?: string;
}

/**
 * The two lookups this projection needs, injectable so the placement
 * rules can be tested without a database. Defaults are the real ones.
 */
export type ItemLookup = (planUid: string) => PlanItem[];
export type SymbolLookup = (absolutePath: string) => Array<{
  name: string;
  startLine: number;
  endLine: number;
}>;

export interface FileOverlay {
  /** Project-relative path this overlay describes. */
  relativePath: string;
  markers: OverlayMarker[];
  /** Markers that apply to the file as a whole, not to any line. */
  fileLevel: OverlayMarker[];
  /** Edits that could not be placed, with the reason. */
  unanchored: OverlayMarker[];
  /** Items targeting this file at all — for a "3 items want this file" chip. */
  itemCount: number;
}

function normalise(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\\/g, '/').toLowerCase();
}

/** Does a fileSpec target this file? Exact, or a directory containing it. */
function specTargets(spec: FileSpec, relativePath: string): boolean {
  const target = normalise(spec.path);
  const file = normalise(relativePath);
  if (!target) return false;
  if (target === file) return true;
  if (spec.isDir) return file.startsWith(target.endsWith('/') ? target : `${target}/`);
  return false;
}

/**
 * Resolve a symbol name to its span in this file.
 *
 * Ruby writes `Klass#method`, Go writes `(Recv).Method`, and an author
 * may have typed just `method`. So an exact match is tried first, then a
 * suffix match on the qualified forms — but never a bare substring
 * match, which would happily anchor `save` to `saveAll`.
 */
function resolveSymbolSpan(
  lookupSymbols: SymbolLookup,
  absolutePath: string,
  symbolName: string,
): { startLine: number; endLine: number } | null {
  let symbols: Array<{ name: string; startLine: number; endLine: number }>;
  try {
    symbols = lookupSymbols(absolutePath);
  } catch {
    return null;
  }
  if (symbols.length === 0) return null;

  const exact = symbols.find((s) => s.name === symbolName);
  if (exact) return { startLine: exact.startLine, endLine: exact.endLine };

  // `post` should find `Invoice#post` / `(Ledger).Post` / `Klass.post`,
  // but must not find `postAll`.
  const qualified = symbols.find((s) => /[#.)]/.test(s.name) && s.name.split(/[#.]/).pop() === symbolName);
  if (qualified) return { startLine: qualified.startLine, endLine: qualified.endLine };

  const caseInsensitive = symbols.find((s) => s.name.toLowerCase() === symbolName.toLowerCase());
  if (caseInsensitive) {
    return { startLine: caseInsensitive.startLine, endLine: caseInsensitive.endLine };
  }

  return null;
}

function markerBase(item: PlanItem, edit: FileEdit | null): Omit<OverlayMarker, 'anchor' | 'startLine' | 'endLine'> {
  return {
    itemUid: item.uid,
    itemTitle: item.title,
    itemStatus: item.status ?? null,
    planUid: item.planUid,
    instruction: edit?.instruction ?? '',
    intent: edit?.intent ?? null,
    symbol: edit?.symbol ?? null,
  };
}

/**
 * Build the overlay for one file.
 *
 * `lineCount` is required so an edit naming lines past the end of the
 * file can be reported as unanchored rather than drawn somewhere wrong.
 */
export function buildFileOverlay(params: {
  absolutePath: string;
  relativePath: string;
  lineCount: number;
  /** Restrict to one plan. Omitted = every plan that targets the file. */
  planUid?: string | null;
  plans: string[];
  /** Overridable for tests; defaults to the real services. */
  lookupItems?: ItemLookup;
  lookupSymbols?: SymbolLookup;
}): FileOverlay {
  const lookupItems = params.lookupItems ?? listAllItems;
  // Members included: an edit anchored to a method is the common case, and the
  // top-level-only lookup made that impossible in TS, Python and PHP.
  const lookupSymbols = params.lookupSymbols ?? getFileSymbolsWithMembers;
  const markers: OverlayMarker[] = [];
  const fileLevel: OverlayMarker[] = [];
  const unanchored: OverlayMarker[] = [];
  const touchingItems = new Set<string>();

  const planUids = params.planUid ? [params.planUid] : params.plans;

  for (const planUid of planUids) {
    let items: PlanItem[];
    try {
      items = lookupItems(planUid);
    } catch {
      continue;
    }

    for (const item of items) {
      for (const spec of item.fileSpecs ?? []) {
        if (!specTargets(spec, params.relativePath)) continue;
        touchingItems.add(item.uid);

        const edits = spec.edits ?? [];

        // No granular edits: the item wants this file, unspecified.
        if (edits.length === 0) {
          fileLevel.push({
            ...markerBase(item, null),
            anchor: 'file',
            startLine: null,
            endLine: null,
            instruction: spec.description ?? '',
            intent: spec.action ?? null,
          });
          continue;
        }

        for (const edit of edits) {
          if (edit.lineRange) {
            const { start, end } = edit.lineRange;
            if (start < 1 || start > params.lineCount || end < start) {
              unanchored.push({
                ...markerBase(item, edit),
                anchor: 'unanchored',
                startLine: null,
                endLine: null,
                // Never clamp. A marker in the wrong place is worse than
                // no marker, because a reader believes it.
                reason:
                  `Pinned to lines ${start}–${end}, but the file has ${params.lineCount}. ` +
                  'The file has probably changed since the plan was written.',
              });
              continue;
            }
            markers.push({
              ...markerBase(item, edit),
              anchor: 'lines',
              startLine: start,
              endLine: Math.min(end, params.lineCount),
            });
            continue;
          }

          if (edit.symbol) {
            const span = resolveSymbolSpan(lookupSymbols, params.absolutePath, edit.symbol);
            if (!span) {
              unanchored.push({
                ...markerBase(item, edit),
                anchor: 'unanchored',
                startLine: null,
                endLine: null,
                reason: `No symbol named "${edit.symbol}" in this file.`,
              });
              continue;
            }
            markers.push({ ...markerBase(item, edit), anchor: 'symbol', ...span });
            continue;
          }

          // An edit with an instruction but no anchor is still intent —
          // it just belongs to the file rather than to a line.
          fileLevel.push({
            ...markerBase(item, edit),
            anchor: 'file',
            startLine: null,
            endLine: null,
          });
        }
      }
    }
  }

  markers.sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));

  return {
    relativePath: params.relativePath,
    markers,
    fileLevel,
    unanchored,
    itemCount: touchingItems.size,
  };
}

/** Convenience for callers holding only absolute paths. */
export function relativeTo(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
}
