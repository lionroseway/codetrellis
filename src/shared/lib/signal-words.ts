/**
 * A signal in words (Phase 32 A1.8, moved here for the phone in A4.2): what
 * kind of overlap it is, its sides in order, and what each side is doing, in
 * the same words on the desktop tab and the phone's detail screen.
 *
 * Pure. Describes the change from git and the parser; never quotes an agent
 * (awareness principle 5). `label` says how a workstream root reads (its
 * branch, as the strip names it).
 */

import type { AwarenessSignal } from '../types';

/** The kind, as a short heading. */
export function kindWords(s: Pick<AwarenessSignal, 'kind' | 'subject'>): string {
  if (s.kind === 'stale-base') return 'Behind main';
  if (s.kind === 'drift') return 'Outside its scope';
  if (s.kind === 'contract') return s.subject.change === 'removed' ? 'Removed export' : 'Changed signature';
  // Declared, not yet edited, on at least one side (A2.4).
  const declared = s.subject.intended?.length ? ' · declared' : '';
  return (s.subject.symbol ? 'Same function' : 'Same file') + declared;
}

/**
 * The sides a signal shows, by root. A contract has a direction: the side
 * that changed it first, then the side that imports it.
 */
export function sideRootsOf(s: Pick<AwarenessSignal, 'kind' | 'workstreams' | 'subject'>): string[] {
  return s.kind === 'contract' && s.subject.by
    ? [s.subject.by, ...s.workstreams.filter((r) => r !== s.subject.by)]
    : [...s.workstreams];
}

export interface SideWords {
  root: string;
  name: string;
  /** What this side is doing, in one sentence. */
  words: string;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What it is about: the file and, for a function, the function. */
function about(s: Pick<AwarenessSignal, 'subject'>): string {
  if (s.subject.file && s.subject.symbol) return `${s.subject.symbol} in ${s.subject.file}`;
  return s.subject.file ?? (s.subject.files ?? []).join(', ');
}

/** Each side and what it is doing, in plain words, in `sideRootsOf` order. */
export function sideWords(s: Pick<AwarenessSignal, 'kind' | 'workstreams' | 'subject'>, label: (root: string) => string): SideWords[] {
  const roots = sideRootsOf(s);
  return roots.map((root, i): SideWords => {
    const name = label(root);
    const declared = s.subject.intended?.includes(root);
    if (s.kind === 'contract') {
      if (i === 0) {
        if (s.subject.change === 'removed') return { root, name, words: `${name} removed ${s.subject.symbol ?? 'an export'} from ${s.subject.file ?? 'a shared file'}.` };
        const sig = s.subject.signature;
        const change = sig ? `: ${s.subject.symbol}${sig.before} is now ${s.subject.symbol}${sig.after}` : '';
        return { root, name, words: `${name} changed ${s.subject.symbol ?? 'an export'}'s signature in ${s.subject.file ?? 'a shared file'}${change}.` };
      }
      const importers = s.subject.importers ?? [];
      const where = importers.length ? `, in ${count(importers.length, 'file')}: ${importers.slice(0, 3).join(', ')}${importers.length > 3 ? ' and more' : ''}` : '';
      return { root, name, words: `${name} ${s.subject.possibly ? 'possibly imports' : 'imports'} it${where}.` };
    }
    if (s.kind === 'drift') {
      const files = s.subject.files ?? [];
      return { root, name, words: `${name} changes ${count(files.length, 'file')} outside the task it claimed: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ' and more' : ''}.` };
    }
    if (s.kind === 'stale-base') {
      return { root, name, words: `main changed ${about(s)} since ${name} branched, and ${name} changes it too.` };
    }
    return { root, name, words: `${name} ${declared ? 'has said it will change' : 'changes'} ${about(s)}.` };
  });
}
