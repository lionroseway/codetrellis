/**
 * Other work affected (Phase 32 A6.4): the material signals (A6.3) naming a
 * task, from that task's side, for its Brief page and its agent's brief. A
 * Claude Desktop agent reads its brief first, so what touches its task has
 * to be there, not only in `get_awareness`.
 *
 * A signal the person dismissed is left out: they said it is not worth
 * attention. An acknowledged or intended one stays, with its state.
 */

import { listSignals, refreshSignals } from './awareness-service';
import { taskWorkstreamId } from './task-workstreams';
import { briefLine, kindWords } from '../../shared/lib/signal-words';
import type { AwarenessSignal } from '../../shared/types';

export interface OtherWork {
  signal_id: string;
  /** "Changed material", "Different versions". */
  kind: string;
  severity: AwarenessSignal['severity'];
  state: AwarenessSignal['state'];
  /** From this task's side, in words. */
  says: string;
  /** The other tasks it names, by title. */
  other_tasks: string[];
}

/** The material signals naming this task. `refresh` recomputes the project's signals first. */
export async function affectedByOtherWork(itemUid: string, projectRoot: string | null, opts: { refresh?: boolean } = {}): Promise<OtherWork[]> {
  if (!projectRoot) return [];
  if (opts.refresh) {
    await refreshSignals(projectRoot).catch(() => { /* not a repository, or git is missing: the stored signals stand */ });
  }
  const id = taskWorkstreamId(itemUid);
  return listSignals(projectRoot)
    .filter((s) => s.subject.material && s.workstreams.includes(id) && s.state !== 'dismissed')
    .map((s) => ({
      signal_id: s.id,
      kind: kindWords(s),
      severity: s.severity,
      state: s.state,
      says: briefLine(s, id),
      other_tasks: s.workstreams.filter((w) => w !== id).map((w) => s.subject.labels?.[w] ?? w),
    }));
}
