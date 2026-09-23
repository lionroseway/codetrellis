import { create } from 'zustand';

/**
 * Phase 31 §7 — the artefact viewer: which file is on screen, where in it,
 * and — when it was opened from another artefact's citation — the one
 * place to go back to.
 *
 * One slot, not a stack, for the reason `open-file-at.ts` gives: the trip
 * is one hop (the claim → the cell it came from), and a history UI would be
 * the answer to a question nobody asked.
 */
export interface ArtefactView {
  uid: string;
  /** Where in the file: {lines}, {sheet, range}, {page}, {t}, {text}. */
  locator: unknown;
  /**
   * When opened as a criterion's evidence: the criterion, so the viewer can
   * offer "send back from here" and record where the note points.
   */
  criterionUid?: string | null;
  itemUid?: string | null;
}

export interface ArtefactReturn extends ArtefactView {
  /** What the way back is called — the file's name. */
  label: string;
}

interface ArtefactViewState {
  view: ArtefactView | null;
  back: ArtefactReturn | null;
  open: (view: ArtefactView, from?: ArtefactReturn | null) => void;
  goBack: () => void;
  close: () => void;
}

export const useArtefactViewStore = create<ArtefactViewState>((set, get) => ({
  view: null,
  back: null,
  open: (view, from = null) => set({ view, back: from }),
  goBack: () => {
    const back = get().back;
    if (!back) return;
    const { label: _label, ...view } = back;
    set({ view, back: null });
  },
  close: () => set({ view: null, back: null }),
}));
