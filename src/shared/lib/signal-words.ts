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
  // Tasks' materials (A6.3).
  if (s.kind === 'version-split') return 'Different versions';
  // Teammates' records (C3.2).
  if (s.kind === 'state-split') return s.subject.said?.some((c) => c.forged) ? 'A record in someone else\'s name' : 'Set two ways at once';
  if (s.subject.material) {
    if (s.kind === 'contract') return 'Changed material';
    if (s.kind === 'stale-base') return 'Material changed';
    if (s.kind === 'collision') return 'Same output';
    if (s.kind === 'drift') return 'Outside its brief';
  }
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
  // A material drift has a direction too: the task that read, then those given the file.
  return (s.kind === 'contract' || (s.kind === 'drift' && s.subject.material)) && s.subject.by
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

const STATUS_WORDS: Record<string, string> = { pending: 'not started', assigned: 'assigned', in_progress: 'in progress', blocked: 'blocked', done: 'done', skipped: 'skipped' };
const statusWords = (status: string | null) => STATUS_WORDS[status ?? 'pending'] ?? 'not started';

/** What it is about: the file and, for a function, the function. */
function about(s: Pick<AwarenessSignal, 'subject'>): string {
  if (s.subject.file && s.subject.symbol) return `${s.subject.symbol} in ${s.subject.file}`;
  return s.subject.file ?? (s.subject.files ?? []).join(', ');
}

/** Each side and what it is doing, in plain words, in `sideRootsOf` order. */
export function sideWords(s: Pick<AwarenessSignal, 'kind' | 'workstreams' | 'subject'>, label: (root: string) => string): SideWords[] {
  // A task set two ways at once (C3.2): one side per person, on the one task.
  if (s.kind === 'state-split') {
    const root = s.workstreams[0];
    const task = s.subject.labels?.[root] ?? label(root);
    return (s.subject.said ?? []).map((c) => ({
      root,
      name: c.name,
      words: c.forged
        ? `A record claiming to be ${c.name}'s sets “${task}” to ${statusWords(c.status)}; another record claims to be the same change.`
        : `${c.name} set “${task}” to ${statusWords(c.status)}, without having seen the other change.`,
    }));
  }
  const roots = sideRootsOf(s);
  return roots.map((root, i): SideWords => {
    // A task is named by its title, carried on the signal (A6.3).
    const name = s.subject.labels?.[root] ?? label(root);
    if (s.subject.material) return { root, name, words: materialWords(s, root, name) };
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

/** What one task is doing with a material (A6.3), in one sentence. */
function materialWords(s: Pick<AwarenessSignal, 'kind' | 'subject'>, root: string, name: string): string {
  const m = s.subject.material!;
  switch (s.kind) {
    case 'contract': {
      if (!s.subject.citedBy?.includes(root)) return `${name} uses ${m}.`;
      const parts = s.subject.parts ?? [];
      const what = parts.length ? `${parts.slice(0, 3).join(', ')}${parts.length > 3 ? ' and more' : ''} of ${m}` : m;
      const signed = s.subject.signedOff?.includes(root) ? ', and a person already signed that off' : '';
      return `${name} cites ${what}, as it was before it changed${signed}.`;
    }
    case 'version-split':
      return s.subject.readVersions?.[root] === 'current' ? `${name} read the current version of ${m}.` : `${name} read an earlier version of ${m}.`;
    case 'stale-base':
      return `${name} read ${m} before it changed, and has not read it since.`;
    case 'collision':
      return `${name} records ${m} as its output.`;
    case 'drift': {
      if (root !== s.subject.by) return `${name} was given it.`;
      const files = s.subject.files ?? [m];
      return `${name} read ${files.slice(0, 3).join(', ')}${files.length > 3 ? ' and more' : ''}, which its brief does not include.`;
    }
    default:
      return `${name} uses ${m}.`;
  }
}

const namesOf = (s: Pick<AwarenessSignal, 'subject'>, ids: readonly string[]) => {
  const names = ids.map((id) => `“${s.subject.labels?.[id] ?? id}”`);
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/**
 * A material signal from one task's side (A6.4), as its Brief and its agent's
 * brief say it: "sales.csv changed since this task cited line 2. “Board pack”
 * uses it too." Plain text; `root` is the task's workstream (`task:<uid>`).
 */
export function briefLine(
  s: Pick<AwarenessSignal, 'kind' | 'workstreams' | 'subject'>,
  root: string,
  opts: { file?: (path: string) => string } = {},
): string {
  // A person's Brief names the file; an agent's brief keeps its path.
  const name = opts.file ?? ((p: string) => p);
  const m = name(s.subject.material ?? s.subject.file ?? 'a file');
  const others = s.workstreams.filter((w) => w !== root);
  const verb = (ids: readonly string[], one: string, many: string) => (ids.length === 1 ? one : many);
  switch (s.kind) {
    case 'contract': {
      const citers = s.subject.citedBy ?? [];
      const parts = (s.subject.parts ?? []).join(', ') || 'it';
      const signed = s.subject.signedOff ?? [];
      const mine = citers.includes(root);
      const otherCiters = citers.filter((c) => c !== root);
      const head = mine
        ? `${m} changed since this task cited ${parts}.`
        : `${m} changed since ${namesOf(s, otherCiters)} cited ${parts}.`;
      const signedWords = signed.length === 0 ? ''
        : signed.includes(root) ? ' A person had already signed this task\'s citation off.'
        : ` ${namesOf(s, signed)} had already been signed off.`;
      const also = mine
        ? (others.length ? ` ${namesOf(s, others)} ${verb(others, 'uses', 'use')} it too.` : '')
        : ' This task uses it too.';
      return `${head}${signedWords}${also}`;
    }
    case 'version-split': {
      const versions = s.subject.readVersions ?? {};
      const current = others.filter((o) => versions[o] === 'current');
      const earlier = others.filter((o) => versions[o] !== 'current');
      if (versions[root] === 'current') {
        return `This task read the current ${m}; ${namesOf(s, earlier)} worked from an earlier version.`;
      }
      return current.length
        ? `This task worked from an earlier version of ${m}; ${namesOf(s, current)} ${verb(current, 'has', 'have')} the current one.`
        : `This task and ${namesOf(s, others)} worked from different earlier versions of ${m}; it has changed since.`;
    }
    case 'stale-base':
      return `${m} changed after this task and ${namesOf(s, others)} read it.`;
    case 'state-split':
      return (s.subject.said ?? []).map((c) => `${c.name}${c.forged ? ' (claimed)' : ''} set this task to ${statusWords(c.status)}`).join('; ') + ', at once.';
    case 'collision':
      return `This task and ${namesOf(s, others)} both record ${m} as their output.`;
    case 'drift': {
      const files = (s.subject.files ?? [s.subject.material ?? m]).map(name).join(', ');
      if (s.subject.by === root) return `This task read ${files}, which ${namesOf(s, others)} ${verb(others, 'was', 'were')} given, not this task.`;
      return `${namesOf(s, s.subject.by ? [s.subject.by] : others)} read ${m}, which this task was given.`;
    }
    default:
      return `${m} is used by this task and ${namesOf(s, others)}.`;
  }
}
