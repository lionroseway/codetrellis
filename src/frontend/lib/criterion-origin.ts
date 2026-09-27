/**
 * Who added a criterion, in words (Phase 32 §0.4d, owner's decision).
 *
 * Agents add criteria as they work through a task, and that is reasonable:
 * they are co-workers who notice what the work should be judged on. So a
 * criterion an agent added is not refused, it is tagged, the same way a
 * decision is: a person reading the list sees at once which lines the
 * requester wrote and which an agent proposed.
 *
 * Null for a line a person added in the app or on a phone, and for the
 * system's own (migrated from a task body, the approval gate), which are
 * the requester's words already.
 */

export function criterionOrigin(c: { author: string; authorType: string; source?: string | null }): string | null {
  switch (c.authorType) {
    case 'human':
    case 'system':
      return null;
    case 'unverified':
      return 'added through the local API';
    case 'template':
      return 'from a template';
    case 'file-import':
      return 'from the plan file';
    default:
      return `added by ${c.author} (agent)`;
  }
}
