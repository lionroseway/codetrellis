/**
 * Two people setting one task two ways at once, as a signal (Phase 32 C3.2;
 * shared-work doc C-3: "a real disagreement is a signal, never a silent
 * pick").
 *
 * When records made without seeing each other leave a task in two states,
 * C3.1 applies neither. This names both, in the one inbox (the Awareness
 * tab, the digest, the phone, a push), the way every other overlap is named:
 * a `state-split` signal on the task's workstream (`task:<uid>`, as A6.1),
 * computed in the same pass as the project's other signals. A later record
 * made having seen both (anyone's next change to the task) ends it, and the
 * signal resolves.
 */

import { getDb } from '../database';
import { draft } from '../awareness-signals';
import { atOnceWords } from '../../../shared/lib/item-status';
import type { SignalDraft } from '../awareness-signals';
import { allSplits } from './heads';

/** One draft per task of this project that people set two ways at once. */
export function stateSplitDrafts(projectRoot: string): SignalDraft[] {
  const out: SignalDraft[] = [];
  for (const [itemUid, claims] of allSplits()) {
    // Read straight from the tables: the plan services would load the server
    // mid-way through the signal engine's own load.
    const row = getDb().exec(
      'SELECT i.title, p.project_path FROM plan_items i JOIN plans p ON p.uid = i.plan_uid WHERE i.uid = ?',
      [itemUid],
    )[0]?.values[0];
    if (!row || row[1] !== projectRoot || claims.length === 0) continue;
    const item = { title: String(row[0]) };
    const ws = `task:${itemUid}`;
    const forged = claims.some((c) => c.forged);
    out.push(draft(
      'state-split',
      forged ? 'high' : 'medium',
      itemUid,
      { items: [itemUid], labels: { [ws]: item.title }, said: claims.map((c) => ({ name: c.name, status: c.status, ...(c.forged ? { forged: true } : {}) })) },
      [ws],
      `“${item.title}”: ${atOnceWords(claims)}.`,
    ));
  }
  return out;
}
