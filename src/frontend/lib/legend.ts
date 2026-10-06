/**
 * Phase 33 G2 — one legend, built from the visual vocabulary (G1).
 *
 * The owner: "would be good on graph and other areas to have a color legend
 * so can understand what is going on". A legend lists only what is on
 * screen: each element says which states it draws (its keys), and the legend
 * is their union, in the vocabulary's order. Hovering an entry lights the
 * elements that carry its key. Pure.
 */

import { EDGE, INTENT, TASK, GIT, ATTENTION, TESTS, MARKS, LANE, nodeChange, TONES, type StateVisual } from './visual-language';

export interface LegendEntry {
  /** What elements carry when they draw it: `edge:import`, `node:modified`. */
  key: string;
  glyph: string;
  word: string;
  /** The tone's colour, for the swatch. */
  hex: string;
  /** Drawn as a line (an edge), with this dash, rather than a swatch. */
  line?: { dash?: string };
}

const ofState = (key: string, s: StateVisual, line = false): LegendEntry => ({
  key, glyph: s.glyph, word: s.word, hex: TONES[s.tone].hex, ...(line ? { line: { dash: s.dash } } : {}),
});

/** Every key the legend knows, in the order it lists them: changes first, then marks, then lines. */
const ORDER: string[] = [];
const ENTRIES = new Map<string, LegendEntry>();
function known(e: LegendEntry): void { ENTRIES.set(e.key, e); ORDER.push(e.key); }

for (const status of ['added', 'modified', 'removed', 'planned_add', 'planned_modify', 'planned_remove', 'in_progress_task', 'active', 'affected', 'unexpected_live']) {
  const c = nodeChange(status)!;
  known({ ...ofState(`node:${status}`, c.state), glyph: c.symbol || c.state.glyph });
}
known(ofState('mark:footprint', MARKS.footprint));
known(ofState('mark:plannedOverlap', MARKS.plannedOverlap));
known(ofState('mark:collision', ATTENTION.collision));
known(ofState('mark:paused', ATTENTION.paused));
for (const [k, s] of Object.entries(TESTS)) known(ofState(`tests:${k}`, s));
for (const [k, s] of Object.entries(EDGE)) known(ofState(`edge:${k}`, s, true));
for (const [k, s] of Object.entries(TASK)) known(ofState(`task:${k}`, s));
for (const [k, s] of Object.entries(INTENT)) known(ofState(`intent:${k}`, s));
for (const [k, s] of Object.entries(GIT)) known(ofState(`git:${k}`, s));
for (const [k, s] of Object.entries(LANE)) known(ofState(`lane:${k}`, s));

/** The legend for the keys drawn: each once, in the vocabulary's order; unknown keys are left out. */
export function legendFor(keys: Iterable<string>): LegendEntry[] {
  const drawn = new Set(keys);
  return ORDER.filter((k) => drawn.has(k)).map((k) => ENTRIES.get(k)!);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The states a graph node draws. */
export function nodeLegendKeys(data: Record<string, unknown> | undefined): string[] {
  const d = data ?? {};
  const keys: string[] = [];
  const change = str(d.changeStatus);
  if (change && nodeChange(change)) keys.push(`node:${change}`);
  if (d.planHighlighted) keys.push('mark:footprint');
  if (d.plannedOverlap) keys.push('mark:plannedOverlap');
  if (d.collisionTitle) keys.push('mark:collision');
  if (d.breakpointTitle) keys.push('mark:paused');
  const g = d.grounding && typeof d.grounding === 'object' ? str((d.grounding as Record<string, unknown>).state) : null;
  if (g && g in TESTS) keys.push(`tests:${g}`);
  return keys;
}

/** The state a graph edge draws: its import state, an import when it has none. */
export function edgeLegendKeys(data: Record<string, unknown> | undefined): string[] {
  const s = str((data ?? {}).importState);
  return [`edge:${s && s in EDGE ? s : 'import'}`];
}

/** The graph's legend: what its nodes and edges draw now. */
export function graphLegend(
  nodes: ReadonlyArray<{ data?: Record<string, unknown> }>,
  edges: ReadonlyArray<{ data?: Record<string, unknown> | null }>,
): LegendEntry[] {
  const keys = new Set<string>();
  for (const n of nodes) for (const k of nodeLegendKeys(n.data)) keys.add(k);
  for (const e of edges) for (const k of edgeLegendKeys(e.data ?? undefined)) keys.add(k);
  return legendFor(keys);
}
