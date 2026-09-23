/**
 * Phase 31 §7.5 — open an artefact at a place in it.
 *
 * The sibling of `open-file-at.ts`: code has a file and a line, an artefact
 * has a file and a locator — `{page}`, `{sheet, range}`, `{t}`, `{lines}`,
 * `{text}` — the same shape `submit_criterion` stores on evidence. One
 * function, so a criterion's evidence, a citation inside an output, the
 * phone (§12) and `navigate_to` all open the same way.
 */
import { useArtefactViewStore, type ArtefactReturn } from '../stores/artefact-view-store';

export function openArtefactAt(
  uid: string,
  locator: unknown = null,
  opts: { criterionUid?: string | null; itemUid?: string | null; from?: ArtefactReturn | null } = {},
): void {
  useArtefactViewStore.getState().open(
    { uid, locator, criterionUid: opts.criterionUid ?? null, itemUid: opts.itemUid ?? null },
    opts.from ?? null,
  );
}

/** A locator in words, for a link or the way back: "lines 4–6", "Regional!C14", "page 3". */
export function describeLocator(locator: unknown): string {
  if (!locator || typeof locator !== 'object') return '';
  const l = locator as Record<string, unknown>;
  if (typeof l.range === 'string') return typeof l.sheet === 'string' ? `${l.sheet}!${l.range}` : String(l.range);
  if (typeof l.sheet === 'string') return l.sheet;
  if (typeof l.page === 'number') return `page ${l.page}`;
  if (l.lines !== undefined) {
    const v = Array.isArray(l.lines) ? `${l.lines[0]}–${l.lines[1]}` : String(l.lines).replace('-', '–');
    return /[–]/.test(v) ? `lines ${v}` : `line ${v}`;
  }
  if (l.t !== undefined) return `at ${l.t}`;
  if (typeof l.text === 'string') return `“${l.text.slice(0, 40)}${l.text.length > 40 ? '…' : ''}”`;
  return '';
}
