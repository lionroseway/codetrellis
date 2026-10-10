/**
 * The graph's overlays (Phase 32 B3.3): what is drawn over the dependency
 * graph, as a list a person turns on and off, rather than hard-wired plan
 * intent. Each overlay decorates nodes by path; the canvas applies the ones
 * that are on. Pure.
 *
 * Workstream paths are relative to the repository; graph paths are relative
 * to the opened project, which may be a folder inside it. `projectPrefix`
 * turns one into the other.
 */

import type { AwarenessSignal, Workstream } from '@shared/types';
import { lineCounts } from '../../shared/lib/line-changes';

export type OverlayId = 'plan' | 'workstreams' | 'collisions' | 'breakpoints' | 'tests' | 'rules';

export const OVERLAYS: ReadonlyArray<{ id: OverlayId; label: string; hint: string }> = [
  { id: 'plan', label: 'Plan intent', hint: 'Files and edges the active plan means to change' },
  { id: 'workstreams', label: 'Workstreams', hint: 'Lines each other workstream changes in a file' },
  { id: 'collisions', label: 'Collision zones', hint: 'Files two workstreams both change, while the overlap is open' },
  { id: 'breakpoints', label: 'Breakpoints', hint: 'Files and folders a person asked to be asked about first' },
  { id: 'tests', label: 'Test grounding', hint: '✓ passing · ✗ failing · ⚠ tests older than the code · ○ no tests, from the reports agents handed over' },
  { id: 'rules', label: 'Rules', hint: '⊘ imports that break an architecture rule, and the files they start from' },
];

export const ALL_OVERLAYS: readonly OverlayId[] = OVERLAYS.map((o) => o.id);

/** The overlays that are on, from what was saved; unknown ids are dropped, nothing saved means all. */
export function parseOverlays(saved: unknown): OverlayId[] {
  if (!Array.isArray(saved)) return [...ALL_OVERLAYS];
  return ALL_OVERLAYS.filter((id) => saved.includes(id));
}

const norm = (p: string) => p.replace(/[\\/]+$/, '');

/**
 * The opened project's place in its repository, as a prefix of repository
 * paths ("tests/fixtures/app/"), or "" when it is the repository itself.
 * Null when the project is not inside the main checkout.
 */
export function projectPrefix(projectRoot: string | null, workstreams: readonly Workstream[]): string | null {
  if (!projectRoot) return null;
  const root = norm(projectRoot);
  const trees = workstreams.filter((w) => !w.root.startsWith('branch:')).map((w) => norm(w.root));
  // The checkout that holds the project: the longest folder it is in.
  const holder = trees.filter((t) => root === t || root.startsWith(`${t}/`)).sort((a, b) => b.length - a.length)[0];
  if (holder === undefined) return null;
  return root === holder ? '' : `${root.slice(holder.length + 1)}/`;
}

/** A repository path as a project path, or null when it lies outside the project. */
export function toProjectPath(repoPath: string, prefix: string): string | null {
  if (!prefix) return repoPath;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
}

export interface FileWorkCount {
  who: string;
  added: number;
  removed: number;
}

/**
 * Each other workstream's line counts per file (project paths). The copy
 * that is open is left out: its own changes are already the graph's live
 * state. A file without counts (binary, not tracked yet) is left out too.
 */
export function workCountsByFile(
  workstreams: readonly Workstream[],
  projectRoot: string | null,
): Map<string, FileWorkCount[]> {
  const out = new Map<string, FileWorkCount[]>();
  const prefix = projectPrefix(projectRoot, workstreams);
  if (prefix === null) return out;
  const own = projectRoot ? norm(projectRoot) : null;
  for (const w of workstreams) {
    if (own && (norm(w.root) === own || own.startsWith(`${norm(w.root)}/`))) continue;
    const who = w.branch ?? w.root.split(/[\\/]/).pop() ?? w.root;
    for (const f of w.changes.files) {
      if (f.added === undefined || f.removed === undefined) continue;
      const p = toProjectPath(f.path, prefix);
      if (p === null) continue;
      out.set(p, [...(out.get(p) ?? []), { who, added: f.added, removed: f.removed }]);
    }
  }
  return out;
}

/** "2 workstreams: ＋12 −3, ＋4" on the node; who changed how much, in words, on hover. */
export function workCountLabel(counts: readonly FileWorkCount[]): { short: string; title: string } {
  const each = counts.map((c) => lineCounts(c.added, c.removed));
  const short = counts.length === 1
    ? `${counts[0].who} ${each[0].short}`
    : `${counts.length} workstreams: ${each.map((e) => e.short).join(', ')}`;
  const title = counts.map((c, i) => `${c.who}: ${each[i].words}`).join('\n');
  return { short, title };
}

/**
 * The files in open overlaps between workstreams (project paths), each with
 * the summaries that name it. An overlap marked intended, dismissed or
 * resolved is not a zone to avoid.
 */
export function collisionFiles(
  signals: readonly AwarenessSignal[],
  prefix: string | null,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (prefix === null) return out;
  for (const s of signals) {
    if (s.kind !== 'collision' || (s.state !== 'open' && s.state !== 'acknowledged')) continue;
    const files = [s.subject.file, ...(s.subject.files ?? [])].filter((f): f is string => !!f);
    for (const f of files) {
      const p = toProjectPath(f, prefix);
      if (p !== null) out.set(p, [...(out.get(p) ?? []), s.summary]);
    }
  }
  return out;
}

// ── Test grounding (Phase 32 B8.3a) ───────────────────────────────────

export type GroundingState = 'failing' | 'stale' | 'passing' | 'untested';

/** What GET /api/tests/grounding/map answers: each file some test reaches; any other has none. */
export interface GroundingMapView {
  files: Record<string, { state: GroundingState; words: string }>;
  hasResults: boolean;
}

export const GROUNDING_MARK: Record<GroundingState, string> = { failing: '✗', stale: '⚠', passing: '✓', untested: '○' };

/**
 * A file node's mark: its state and words, or "○ no tests" when the project
 * has results and none reach it. Nothing at all before any results: "no
 * tests" on every node would say nothing.
 */
export function fileGrounding(map: GroundingMapView | null, filePath: string): { state: GroundingState; mark: string; title: string } | undefined {
  if (!map?.hasResults) return undefined;
  const g = map.files[filePath];
  const state = g?.state ?? 'untested';
  return { state, mark: GROUNDING_MARK[state], title: g?.words ?? '○ no tests: no test with a reported result imports it' };
}

/**
 * A cluster's marks, summed over its files, worst first: "✗ 2 · ⚠ 1 · ✓ 9",
 * with how many have no tests on hover. Undefined before any results.
 */
export function clusterGrounding(map: GroundingMapView | null, files: readonly string[]): { state: GroundingState; short: string; title: string } | undefined {
  if (!map?.hasResults || files.length === 0) return undefined;
  const n: Record<GroundingState, number> = { failing: 0, stale: 0, passing: 0, untested: 0 };
  for (const f of files) n[map.files[f]?.state ?? 'untested']++;
  const order: GroundingState[] = ['failing', 'stale', 'passing'];
  const parts = order.filter((s) => n[s] > 0).map((s) => `${GROUNDING_MARK[s]} ${n[s]}`);
  const state = order.find((s) => n[s] > 0) ?? 'untested';
  const words: Record<GroundingState, string> = { failing: 'failing', stale: 'with tests older than the code', passing: 'passing', untested: 'with no tests' };
  const title = (['failing', 'stale', 'passing', 'untested'] as GroundingState[])
    .filter((s) => n[s] > 0)
    .map((s) => `${n[s]} file${n[s] === 1 ? '' : 's'} ${words[s]}`)
    .join('\n');
  return { state, short: parts.length ? parts.join(' · ') : `○ ${n.untested}`, title };
}
