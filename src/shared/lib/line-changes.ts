/**
 * Line changes in words (Phase 32 B3.1): "billing-v2 changed 40–52, in
 * validateCreateOrder, not committed". Shared by the MCP tool, which hands
 * agents the same sentence, and the code view's gutter (B3.2), so the two
 * never describe one hunk differently.
 */

import type { LineHunk } from '../types/agent';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "40–52", or "line 40" for one line. */
function span(start: number, lines: number): string {
  return lines <= 1 ? `line ${start}` : `${start}–${start + lines - 1}`;
}

/** "validateCreateOrder", "a and b", "a, b and 2 more". */
export function functionList(names: readonly string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** What one hunk did, without who: "changed 40–52, in validateCreateOrder, not committed". */
export function hunkWords(h: LineHunk): string {
  const what = h.kind === 'added'
    ? `added ${span(h.new.start, h.new.lines)}`
    : h.kind === 'changed'
      ? `changed ${span(h.new.start, h.new.lines)}`
      : `removed ${plural(h.old.lines, 'line')} ${h.new.start === 0 ? 'at the top' : `after line ${h.new.start}`}`;
  const where = h.functions.length ? `, in ${functionList(h.functions)}` : '';
  return `${what}${where}${h.committed ? '' : ', not committed'}`;
}

/** Who and what: "billing-v2 changed 40–52, in validateCreateOrder, not committed". */
export function hunkSentence(who: string, h: LineHunk): string {
  return `${who} ${hunkWords(h)}`;
}

/** "＋12 −3" for a badge; "12 lines added, 3 removed" for its title. */
export function lineCounts(added: number, removed: number): { short: string; words: string } {
  const short = [added ? `＋${added}` : '', removed ? `−${removed}` : ''].filter(Boolean).join(' ') || '±0';
  const words = added && removed
    ? `${plural(added, 'line')} added, ${removed} removed`
    : added ? `${plural(added, 'line')} added` : removed ? `${plural(removed, 'line')} removed` : 'no lines changed';
  return { short, words };
}
