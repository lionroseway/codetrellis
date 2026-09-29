/**
 * What the Awareness tab shows (Phase 32 A1.8). Pure, so the rules are
 * tested without rendering.
 *
 * The tab answers "does any of this parallel work need me?" A signal nobody
 * has answered needs you when it is high or medium; a low one (a stale base)
 * is worth knowing and listed collapsed. Once a person answers — seen,
 * meant, not worth attention — it moves out of the way but stays listed, so
 * the answer can be taken back (awareness spec §4.4, §7.2).
 */

import type { AwarenessSignal, SettableSignalState, SignalReply, Workstream } from '@shared/types';
import { chipLabel, stripWorkstreams } from './workstream-strip';

const RANK = { high: 0, medium: 1, low: 2 } as const;
const bySeverityThenNewest = (a: AwarenessSignal, b: AwarenessSignal) =>
  RANK[a.severity] - RANK[b.severity] || b.lastSeen - a.lastSeen;

export interface SignalGroups {
  /** Open, high or medium: what the tab's number counts. */
  needsYou: AwarenessSignal[];
  /** Open, low. */
  lowPriority: AwarenessSignal[];
  /** Acknowledged: seen, still true. */
  seen: AwarenessSignal[];
  /** Marked intended or dismissed. */
  setAside: AwarenessSignal[];
}

/** The tab's sections. Resolved signals are gone: their cause is. */
export function groupSignals(signals: readonly AwarenessSignal[]): SignalGroups {
  const live = signals.filter((s) => s.state !== 'resolved').sort(bySeverityThenNewest);
  return {
    needsYou: live.filter((s) => s.state === 'open' && s.severity !== 'low'),
    lowPriority: live.filter((s) => s.state === 'open' && s.severity === 'low'),
    seen: live.filter((s) => s.state === 'acknowledged'),
    setAside: live.filter((s) => s.state === 'intended' || s.state === 'dismissed'),
  };
}

/** The number on the tab. */
export function needsYouCount(signals: readonly AwarenessSignal[]): number {
  return groupSignals(signals).needsYou.length;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The digest line at the top (the fuller digest, "since you were away", is
 * A3). Counts the workstreams the strip shows, so the two never disagree.
 */
export function digestLine(workstreams: readonly Workstream[], signals: readonly AwarenessSignal[]): { headline: string; detail: string } {
  const active = stripWorkstreams(workstreams, signals).length;
  const g = groupSignals(signals);
  if (active === 0 && g.needsYou.length + g.lowPriority.length + g.seen.length + g.setAside.length === 0) {
    return {
      headline: 'No parallel work right now',
      detail: 'When agents work in other worktrees, clones or branches of this repository, anything they both change shows here.',
    };
  }
  const parts = [plural(active, 'workstream') + ' active'];
  parts.push(g.needsYou.length === 0 ? 'nothing needs you' : `${g.needsYou.length} need${g.needsYou.length === 1 ? 's' : ''} you`);
  if (g.lowPriority.length > 0) parts.push(plural(g.lowPriority.length, 'low-priority note'));
  return {
    headline: parts.join(' · '),
    detail: g.needsYou.length > 0
      ? 'For each overlap: acknowledge it if you have seen it, mark it intended if both sides are meant to change it, or dismiss it.'
      : 'Nothing overlaps that you have not answered. New overlaps appear here as they happen.',
  };
}

/** What a signal is, in two or three words. */
export function kindWords(s: Pick<AwarenessSignal, 'kind' | 'subject'>): string {
  if (s.kind === 'stale-base') return 'Behind main';
  if (s.kind === 'drift') return 'Outside its scope';
  if (s.kind === 'contract') return s.subject.change === 'removed' ? 'Removed export' : 'Changed signature';
  // Declared, not yet edited, on at least one side (A2.4).
  const declared = s.subject.intended?.length ? ' · declared' : '';
  return (s.subject.symbol ? 'Same function' : 'Same file') + declared;
}

import { sideLabel } from '../../shared/lib/workstream-words';
export { sideLabel };

/**
 * The sides a signal shows. A stale base is one workstream against main. A
 * contract has a direction: the side that changed it first, then the side
 * whose work imports it.
 */
/** The workstreams a signal's sides stand for, in the order `sidesOf` names them (main, for a stale base, not included). */
export function sideRootsOf(s: Pick<AwarenessSignal, 'kind' | 'workstreams' | 'subject'>): string[] {
  return s.kind === 'contract' && s.subject.by
    ? [s.subject.by, ...s.workstreams.filter((r) => r !== s.subject.by)]
    : [...s.workstreams];
}

export function sidesOf(s: Pick<AwarenessSignal, 'kind' | 'workstreams' | 'subject'>, workstreams: readonly Workstream[]): string[] {
  const names = sideRootsOf(s).map((r) => sideLabel(r, workstreams));
  if (s.kind !== 'stale-base') return names;
  const main = workstreams.find((w) => w.main);
  return [...names, main ? chipLabel(main) : 'main'];
}

const STATE_VERB: Record<Exclude<SettableSignalState, 'open'>, string> = {
  acknowledged: 'Acknowledged',
  intended: 'Marked intended',
  dismissed: 'Dismissed',
};

/** "3 min ago", "2 h ago", or the date. */
export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(then).toLocaleDateString();
}

/**
 * Who answered and when, or null while nobody has. An answer that came over
 * plain HTTP is recorded as given but not claimed as the person's: anything
 * holding the token can send one (tag, don't block — §0.4d).
 */
export function stateWords(s: Pick<AwarenessSignal, 'state' | 'stateBy' | 'stateAt'>, now: number): string | null {
  if (s.state === 'open' || s.state === 'resolved' || !s.stateAt) return null;
  // Unverified: the name as given, tagged beside it (carried item 2b).
  const who = s.stateBy?.actorType === 'human' ? 'by you' : `by ${s.stateBy?.actor ?? 'someone'}`;
  return `${STATE_VERB[s.state]} ${who} · ${ago(s.stateAt, now)}`;
}

/**
 * Which agents were told about a signal (A2.6): "Told codex 2 min ago", or
 * "Told codex and claude-code", or null when none was. Their notes are shown
 * separately, as their own words.
 */
export function toldWords(s: Pick<AwarenessSignal, 'told'>, now: number): string | null {
  const told = (s.told ?? []).filter((t) => t.toldAt !== null);
  if (told.length === 0) return null;
  const names = [...new Set(told.map((t) => t.agentType))];
  const who = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  const last = Math.max(...told.map((t) => t.toldAt as number));
  return `Told ${who} · ${ago(last, now)}`;
}

/**
 * Why an answered signal needs the person again (A3.2): what it is about
 * changed since they acknowledged it or marked it intended. Null otherwise.
 */
export function reopenedWords(s: Pick<AwarenessSignal, 'reopened' | 'state'>, now: number): string | null {
  if (!s.reopened || s.state !== 'open') return null;
  const was = s.reopened.from === 'intended' ? 'marked it intended' : 'acknowledged it';
  return `Back: it changed since you ${was} · ${ago(s.reopened.at, now)}`;
}

/**
 * Where a message to the agents stands (A4.1): who has read it, or that no
 * agent has yet. Each agent in the work reads it on its next step.
 */
export function replyReadWords(r: Pick<SignalReply, 'readBy'>, now: number): string {
  if (r.readBy.length === 0) return 'Not read yet: each agent in this work reads it on its next step';
  const names = [...new Set(r.readBy.map((x) => x.agentType))];
  const who = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return `Read by ${who} · ${ago(Math.max(...r.readBy.map((x) => x.readAt)), now)}`;
}

/** Who sent a message, as it arrived. */
export function replyFromWords(r: Pick<SignalReply, 'by'>): string {
  return r.by.channel === 'phone' ? 'You, from your phone' : 'You';
}

export interface SignalAction { state: SettableSignalState; label: string; hint: string }

const ACK: SignalAction = { state: 'acknowledged', label: 'Acknowledge', hint: 'You have seen it. It stops marking the strip but stays listed while it is true.' };
const INTENDED: SignalAction = { state: 'intended', label: 'Intended', hint: 'Both sides are meant to change this. Set aside while the overlap lasts.' };
const INTENDED_DRIFT: SignalAction = { state: 'intended', label: 'Intended', hint: 'The extra files are meant to be part of this work. Set aside while it lasts.' };
const INTENDED_CONTRACT: SignalAction = { state: 'intended', label: 'Intended', hint: 'The change is meant, and the side that imports it will follow. Set aside while it lasts.' };
const DISMISS: SignalAction = { state: 'dismissed', label: 'Dismiss', hint: 'Not worth your attention. Set aside while the overlap lasts.' };
const REOPEN: SignalAction = { state: 'open', label: 'Reopen', hint: 'Take your answer back: it needs you again.' };

/**
 * The answers a signal offers in its state. "Intended" needs two sides: for
 * a collision both are meant to change the same thing; for a contract the
 * change is meant and the importing side will follow; for drift the extra
 * files are meant to be part of the work. A stale base is one workstream
 * behind main: nothing in it was chosen, so there is nothing to intend.
 */
export function actionsFor(state: AwarenessSignal['state'], kind: AwarenessSignal['kind'] = 'collision'): SignalAction[] {
  const intended = kind === 'collision' ? [INTENDED] : kind === 'contract' ? [INTENDED_CONTRACT] : kind === 'drift' ? [INTENDED_DRIFT] : [];
  switch (state) {
    case 'open': return [ACK, ...intended, DISMISS];
    case 'acknowledged': return [...intended, DISMISS, REOPEN];
    case 'intended':
    case 'dismissed': return [REOPEN];
    default: return [];
  }
}
