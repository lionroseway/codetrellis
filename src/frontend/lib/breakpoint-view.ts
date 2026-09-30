/**
 * How breakpoints read to a person (Phase 32 B4.3). Pure, so the words are
 * tested once and the waiting list, the set list and the task panel agree.
 *
 * A breach is never worded as a pause: it happened, and could not be
 * stopped (observability doc §10.3).
 */

import type { Breakpoint } from '@shared/types';

import { agentName, subjectOf, hitHeadline, hitWhy, decisionLabels, changedLines } from '../../shared/lib/breakpoint-words';
export { agentName, subjectOf, hitHeadline, hitWhy, decisionLabels, changedLines };

/** A set breakpoint, as the list of breakpoints shows it. */
export function breakpointLabel(b: Breakpoint): { what: string; when: string } {
  const title = b.targetTitle ? `“${b.targetTitle}”` : 'an item';
  switch (b.kind) {
    case 'task': return { what: `Task ${title}`, when: 'before an agent claims or finishes it, or anything under it' };
    case 'spec': return { what: `Description of ${title}`, when: 'before an agent changes it, or anything under it' };
    case 'code': {
      const [file, fn] = b.target.split('#');
      if (fn) return { what: `${fn} in ${file}`, when: 'before an edit touches it' };
      return { what: file.endsWith('/') ? `Everything in ${file}` : file, when: 'before it changes' };
    }
    case 'signal': return { what: `Any serious ${b.target} signal`, when: 'while one names a workstream' };
    default: return { what: b.target, when: '' };
  }
}

/** A symbol node's file and name, from its id (`<file>::<kind>:<name>`), or null. */
export function symbolNodeTarget(nodeId: string): { file: string; kind: string; name: string } | null {
  const m = /^(.+)::([a-z_]+):(.+)$/.exec(nodeId);
  return m ? { file: m[1], kind: m[2], name: m[3] } : null;
}

/** Symbol kinds a breakpoint can be set on: the parser places their lines. */
export const BREAKABLE_SYMBOLS: ReadonlySet<string> = new Set(['function', 'method', 'class']);

/**
 * The code breakpoints that hold changes to a graph node (B4.3b): for a file,
 * one on it, on a folder above it, or on a function in it; for a folder,
 * one on it or above it; for a symbol, one on that function or its whole file.
 */
export function nodeBreakpoints(
  breakpoints: readonly Breakpoint[],
  node: { nodeType?: string; path: string },
): Breakpoint[] {
  const code = breakpoints.filter((b) => b.kind === 'code');
  const covers = (target: string, file: string) => {
    const scope = target.split('#')[0];
    return scope.endsWith('/') ? file.startsWith(scope) : file === scope;
  };
  if (node.nodeType === 'symbol') {
    const s = symbolNodeTarget(node.path);
    if (!s) return [];
    return code.filter((b) => b.target === `${s.file}#${s.name}` || (!b.target.includes('#') && covers(b.target, s.file)));
  }
  if (node.nodeType === 'directory') {
    const dir = `${node.path.replace(/\/+$/, '')}/`;
    return code.filter((b) => b.target === dir || (b.target.endsWith('/') && dir.startsWith(b.target)));
  }
  return code.filter((b) => covers(b.target, node.path) || b.target.startsWith(`${node.path}#`));
}

/** The hover of a node's ⏸: which breakpoints hold it, in words. */
export function nodeBreakpointTitle(bps: readonly Breakpoint[]): string {
  const lines = bps.map((b) => {
    const { what, when } = breakpointLabel(b);
    return `${what}, ${when}`;
  });
  return `Ask me first: ${lines.join('; ')}`;
}
