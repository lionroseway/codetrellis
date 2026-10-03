/**
 * What the TopBar workstreams strip shows (Phase 32 A1.3). Pure, so the
 * rules are tested without rendering.
 */

import type { AwarenessSignal, ChangedFile, SignalSeverity, SymbolChange, Workstream, WorkstreamIntent } from '@shared/types';

/** Chips beyond this collapse into "+N", which opens the same list. */
export const MAX_CHIPS = 5;

/** A chip's narrowest (its label truncates down to this), and the gap between chips. */
export const CHIP_MIN_PX = 64;
export const CHIP_GAP_PX = 4;
/** The "+N" button's room, with its gap. */
export const OVERFLOW_PX = 40;

/**
 * How many chips to show in `width` pixels of top bar when there are `total`
 * lines of work; the rest go behind "+N", which takes OVERFLOW_PX. At most
 * MAX_CHIPS whatever the room. `width` null (not measured yet) is MAX_CHIPS.
 *
 * Fitted to the room rather than fixed: a repository with many recent
 * branches filled a 1280px bar with five chips and pushed the project tab,
 * its branch chip and "+" out of it; clipped instead, "+N" went with them
 * and the rest of the lines of work could not be reached.
 */
export function chipsThatFit(width: number | null, total: number): number {
  const fit = (room: number) => Math.max(0, Math.floor((room + CHIP_GAP_PX) / (CHIP_MIN_PX + CHIP_GAP_PX)));
  if (width === null) return total <= MAX_CHIPS ? total : MAX_CHIPS - 1;
  if (total <= Math.min(MAX_CHIPS, fit(width))) return total;
  // Some go behind "+N": as many as fit beside it, and never MAX_CHIPS.
  return Math.min(MAX_CHIPS - 1, fit(width - OVERFLOW_PX));
}

/**
 * The workstreams worth a chip, or none.
 *
 * A worktree with changes but no agent gets one (A1.4): it is a line of work
 * even when nobody is on it right now.
 *
 * The strip is for PARALLEL work. One agent in the main checkout is the
 * everyday case, and `ConnectedAgents` right beside it already says so; a
 * chip for it would repeat that and teach people to ignore the strip. So it
 * appears when work is somewhere other than the main checkout, when there is
 * more than one line of work, or when agents share a folder.
 */
export function stripWorkstreams(all: readonly Workstream[], signals: readonly AwarenessSignal[] = []): Workstream[] {
  // The main checkout with no agent in it is the person's own work, which
  // the canvas's "Working tree" summary already shows. A worktree an agent
  // left with changes in it is not: that is work nobody is looking at.
  // A branch with no checkout (A1.7a) gets a chip only when it overlaps other
  // work: a repository has many recent branches, and a chip for each would
  // bury the ones that matter.
  const active = all.filter((w) => !w.idle
    && (w.shape === 'branch' ? chipSeverity(signalsFor(w.root, signals)) !== null : w.agents.length > 0 || !w.main));
  if (active.length === 0) return [];
  if (active.length === 1 && active[0].main && active[0].shape !== 'shared') return [];
  return active;
}

import { chipLabel } from '../../shared/lib/workstream-words';
export { chipLabel };

/** One line saying what kind of workstream it is. */
export function shapeWords(w: Pick<Workstream, 'main' | 'shape' | 'agents'>): string {
  if (w.shape === 'branch') return 'Branch, no checkout on this machine';
  if (w.shape === 'clone') return w.agents.length >= 2 ? `Clone, shared by ${w.agents.length} agents` : 'Clone of this repository';
  const where = w.main ? 'Main checkout' : 'Worktree';
  if (w.shape === 'shared') return `${where}, shared by ${w.agents.length} agents`;
  return where;
}

/** The warning a shared checkout carries, or null. */
export function sharedNote(w: Pick<Workstream, 'shape'> & Partial<Pick<Workstream, 'agents'>>): string | null {
  return w.shape === 'shared' || (w.shape === 'clone' && (w.agents?.length ?? 0) >= 2)
    ? "Their edits in this folder can't be told apart. Give one of them a worktree of its own."
    : null;
}

/**
 * A folder shortened from the left, so the part that tells worktrees apart
 * (their own name, at the end) is what stays.
 */
export function shortFolder(folder: string, max = 40): string {
  return folder.length <= max ? folder : `…${folder.slice(folder.length - (max - 1))}`;
}

/** "3 files changed", or null when nothing has. */
export function changeWords(w: Pick<Workstream, 'changes'>): string | null {
  const n = w.changes.files.length;
  if (n === 0) return null;
  const count = w.changes.truncated ? `${n}+` : String(n);
  return `${count} file${n === 1 && !w.changes.truncated ? '' : 's'} changed`;
}

/**
 * What a declared intent claims, one line per file (A2.4):
 * `src/x.ts → total, render`, or just the file when it names no symbol.
 * Bare names apply to every path; `path#name` to its own file.
 */
export function intentLines(i: Pick<WorkstreamIntent, 'paths' | 'symbols'>): string[] {
  const bare = i.symbols.filter((s) => !s.includes('#'));
  const files = new Map<string, Set<string>>(i.paths.map((p) => [p, new Set(bare)]));
  for (const s of i.symbols) {
    const at = s.lastIndexOf('#');
    if (at < 0) continue;
    const p = s.slice(0, at);
    files.set(p, (files.get(p) ?? new Set<string>()).add(s.slice(at + 1)));
  }
  return [...files].sort(([a], [b]) => a.localeCompare(b))
    .map(([p, names]) => (names.size ? `${p} → ${[...names].sort().join(', ')}` : p));
}

/** The one-letter mark a changed file carries, as git prints it. */
export function statusLetter(status: ChangedFile['status']): 'A' | 'M' | 'D' | 'R' {
  return status === 'added' ? 'A' : status === 'deleted' ? 'D' : status === 'renamed' ? 'R' : 'M';
}

/** How many changed files the details list before "and N more". */
export const MAX_LISTED_FILES = 8;

const MARK: Record<SymbolChange['change'], string> = { modified: '~', added: '+', removed: '−' };

/**
 * One line saying which symbols a file's change touched (A1.5): modified
 * first, since that is where two workstreams collide, then added, then
 * removed. Null when the file was not parsed, or touched no symbol.
 */
export function symbolSummary(symbols: SymbolChange[] | undefined, max = 3): string | null {
  if (!symbols || symbols.length === 0) return null;
  const order = { modified: 0, added: 1, removed: 2 } as const;
  const sorted = [...symbols].sort((a, b) => order[a.change] - order[b.change] || a.line - b.line);
  // A changed signature (A2.1) is what callers feel, so it says so: `~name()`.
  const shown = sorted.slice(0, max).map((s) => `${MARK[s.change]}${s.name}${s.signature ? '()' : ''}`);
  const more = sorted.length - shown.length;
  return more > 0 ? `${shown.join('  ')}  +${more} more` : shown.join('  ');
}

/**
 * A file's signature changes in words, for a line of their own under its
 * symbols: "createInvoice's signature changed", or "3 signatures changed".
 * Null when there are none (A2.1).
 */
export function signatureWords(symbols: SymbolChange[] | undefined): string | null {
  const changed = (symbols ?? []).filter((s) => s.signature);
  if (changed.length === 0) return null;
  return changed.length === 1 ? `${changed[0].name}'s signature changed` : `${changed.length} signatures changed`;
}

/**
 * The signature changes in a file's symbols, one line each ("name: before →
 * after"), for the file row's tooltip; null when there are none (A2.1).
 */
export function signatureLines(symbols: SymbolChange[] | undefined): string | null {
  const changed = (symbols ?? []).filter((s) => s.signature);
  if (changed.length === 0) return null;
  return changed.map((s) => `${s.name}: ${s.signature!.before} → ${s.signature!.after}`).join('\n');
}

/**
 * The live signals naming a workstream (A1.6), most severe first. Compared
 * by folder exactly as both come from git's worktree list.
 */
export function signalsFor(root: string, signals: readonly AwarenessSignal[]): AwarenessSignal[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return signals
    .filter((s) => s.state !== 'resolved' && s.workstreams.includes(root))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * The severity a chip shows, or null. Low signals (a stale base) are listed
 * in the details but do not mark the chip: worth knowing, not worth a look.
 * Nor does a signal a person has answered (A1.8): once seen, meant or
 * dismissed it stays quiet (awareness spec §4.4).
 */
export function chipSeverity(signals: readonly AwarenessSignal[]): Exclude<SignalSeverity, 'low'> | null {
  const open = signals.filter((s) => s.state === 'open');
  if (open.some((s) => s.severity === 'high')) return 'high';
  if (open.some((s) => s.severity === 'medium')) return 'medium';
  return null;
}

/** The chip's words for its signals, for its title. */
export function signalWords(signals: readonly AwarenessSignal[]): string | null {
  const live = signals.filter((s) => s.state === 'open' && s.severity !== 'low').length;
  if (live === 0) return null;
  return `overlaps other work (${live} signal${live === 1 ? '' : 's'})`;
}
