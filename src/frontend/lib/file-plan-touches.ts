/**
 * Phase 33 G5 — which plans and tasks touch a file, for the inspector.
 *
 * The owner: clicking a card should say whether a plan touches it, beside
 * "View source". The inspector already fetched every plan's overlay for the
 * selected file, but showed only a count, and only after "View source". This
 * groups the overlay's tasks by plan, once each, in the plan's order of
 * appearance, with a glyph and a word for each task's state. Pure.
 */

import type { FileOverlay, OverlayMarker } from './plan-overlay';

export interface TouchingTask {
  itemUid: string;
  title: string;
  /** Glyph and word, never colour alone. */
  glyph: string;
  state: string;
  holder: string | null;
}

export interface TouchingPlan {
  planUid: string;
  title: string;
  tasks: TouchingTask[];
}

const STATE: Record<string, { glyph: string; word: string }> = {
  pending: { glyph: '○', word: 'not started' },
  assigned: { glyph: '◔', word: 'assigned' },
  in_progress: { glyph: '◐', word: 'in progress' },
  blocked: { glyph: '■', word: 'blocked' },
  done: { glyph: '✓', word: 'done' },
  skipped: { glyph: '–', word: 'skipped' },
};

export function fileTouches(overlay: FileOverlay | null, planTitles: ReadonlyMap<string, string>): TouchingPlan[] {
  if (!overlay) return [];
  const byPlan = new Map<string, TouchingPlan>();
  const seen = new Set<string>();
  const all: OverlayMarker[] = [...overlay.markers, ...overlay.fileLevel, ...overlay.unanchored];
  for (const m of all) {
    if (seen.has(m.itemUid)) continue; // one task, many edits: listed once
    seen.add(m.itemUid);
    let plan = byPlan.get(m.planUid);
    if (!plan) byPlan.set(m.planUid, (plan = { planUid: m.planUid, title: planTitles.get(m.planUid) ?? 'A plan', tasks: [] }));
    const s = STATE[m.itemStatus ?? 'pending'] ?? { glyph: '○', word: m.itemStatus ?? 'not started' };
    plan.tasks.push({ itemUid: m.itemUid, title: m.itemTitle, glyph: s.glyph, state: s.word, holder: m.itemAssignee ?? null });
  }
  return [...byPlan.values()];
}
