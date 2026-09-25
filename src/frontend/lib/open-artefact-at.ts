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

/** A locator in words — shared, so the phone's preview names a place the same way (§12). */
export { describeLocator } from '../../shared/lib/locator';
