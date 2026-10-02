/**
 * How a proposed spec change reads to a person (Phase 32 B7.6). Pure, and
 * shared by the desktop's inbox card and the phone, so a proposal says the
 * same thing on both, as `breakpoint-words.ts` does for a held call.
 */

import { agentName } from './breakpoint-words';

interface Where { pageTitle: string; section: string; sectionTitle: string | null }

/** `§ Fields of “Invoice format”`, or `“Invoice format”` for the whole page. */
export function proposalWhere(p: Where): string {
  return `${p.section ? `§ ${p.sectionTitle ?? p.section} of ` : ''}“${p.pageTitle}”`;
}

/** `✎ codex proposes a change to § Fields of “Invoice format”`. */
export function proposalHeadline(p: Where & { author: string }): string {
  return `✎ ${agentName(p.author)} proposes a change to ${proposalWhere(p)}`;
}

/** `tests invoice_eu.spec; files src/invoice.ts`, or '' when none was given. */
export function evidenceWords(e: { tests?: string[]; files?: string[]; commits?: string[]; note?: string }): string {
  return [
    e.tests?.length ? `tests ${e.tests.join(', ')}` : null,
    e.files?.length ? `files ${e.files.join(', ')}` : null,
    e.commits?.length ? `commits ${e.commits.join(', ')}` : null,
    e.note ?? null,
  ].filter(Boolean).join('; ');
}

/** `1 task in 1 plan relies on this. 1 of 1 replied.` */
export function repliesLine(p: { affectedWords: string | null; affected: unknown[]; impacts: unknown[] }): string {
  return p.affected.length ? `${p.affectedWords}. ${p.impacts.length} of ${p.affected.length} replied.` : 'Nothing relies on this page yet.';
}

/** `Changes 2 tasks`, `Changes`, or `No impact`. */
export function impactLabel(i: { impact: 'none' | 'changes'; tasks: number | null }): string {
  if (i.impact !== 'changes') return 'No impact';
  return `Changes${i.tasks !== null ? ` ${i.tasks} ${i.tasks === 1 ? 'task' : 'tasks'}` : ''}`;
}

/** Who replied: the task and its plan, or the author when the reply names no task. */
export function impactWho(i: { itemTitle: string | null; planTitle: string | null; author: string }): string {
  return i.itemTitle ? `${i.itemTitle}${i.planTitle ? ` (${i.planTitle})` : ''}` : i.author;
}
