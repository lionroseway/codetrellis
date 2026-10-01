/**
 * Phase 32 B9 — play-forward: every active plan's planned changes at once,
 * and where they will meet (observability spec §6.3 and §7, JOURNEYS G3).
 * Nothing here exists yet: it is what the plans say they will do.
 */
import type { ProjectionData } from './graph';

/** A plan, by what the stack calls it, and the task that plans the change. */
export interface ForwardBy {
  planUid: string;
  /** The plan's ticket key when it has one, else its title (the stack's label). */
  planLabel: string;
  taskUid: string;
  taskTitle: string;
}

/** One file every plan that plans to touch it, with what each plans. */
export interface ForwardFile {
  path: string;
  /** `create` covers a move's destination; `delete` covers a move's source. */
  change: 'create' | 'modify' | 'delete';
  by: Array<ForwardBy & { change: 'create' | 'modify' | 'delete' | 'move' }>;
}

/**
 * Where two or more plans will meet if they go ahead: a file both plan to
 * change, a function both name, or a material both rely on. Drawn dashed on
 * the graph as "◇ planned overlap" (files); a material's is in words only.
 */
export interface PlannedOverlap {
  /** Stable for the same subject and the same plans. */
  id: string;
  kind: 'file' | 'symbol' | 'material';
  /** The file, `file#function` (or the function alone), or the material, project-relative. */
  subject: string;
  /** The file it is in, when there is one (a file overlap's own path, a function's file). */
  file: string | null;
  plans: Array<{ uid: string; label: string; tasks: Array<{ uid: string; title: string; change: string | null }> }>;
  /**
   * The same function, or one plan deleting or moving what another changes,
   * is serious; the same file or the same material is mild (§7's rules).
   */
  serious: boolean;
  /** One plan's task already waits on the other's (B6.1): sequenced, so they will not meet at once. */
  sequenced: boolean;
  /** "◇ planned overlap: JIRA-142 and JIRA-150 both plan to change src/billing/invoice.ts" */
  words: string;
}

export interface PlayForward {
  project: string;
  /** The active plans projected, with how many of their tasks are still ahead. */
  plans: Array<{ uid: string; label: string; ahead: number }>;
  files: ForwardFile[];
  /** The planned changes in the graph's own shape (the planned view draws these). */
  projection: ProjectionData;
  overlaps: PlannedOverlap[];
  /** "Planned by 3 active plans · 4 files to change, 2 to create · 1 planned overlap", or why there is nothing. */
  words: string;
}
