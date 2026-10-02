/**
 * Line history in the code view (Phase 32 E4): the shapes `/api/git/line-history`
 * returns, and how a run of lines is labelled in the gutter.
 */

export interface LineAttribution {
  agent: string;
  how: 'commit message' | 'seen' | 'timing';
  words: string;
  sessionId?: string | null;
  task?: { uid: string; title: string } | null;
  plan?: { uid: string; title: string } | null;
}

export interface LineCommit {
  sha: string;
  short: string;
  author: string;
  email: string;
  at: number;
  subject: string;
  attribution: LineAttribution | null;
}

export interface LineHunk { start: number; end: number; sha: string | null }

export interface LineHistoryData {
  at: string;
  path: string;
  lineCount: number;
  hunks: LineHunk[];
  commits: Record<string, LineCommit>;
  uncommitted: number;
  command: string;
}

/** A short age, as a gutter has room for: 5m, 3h, 4d, 2mo, 1y. */
export function shortAge(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days}d`;
  const months = Math.round(days / 30);
  return months < 18 ? `${months}mo` : `${Math.round(days / 365)}y`;
}

/**
 * A run's label: the agent where CodeTrellis knows (with "?" when only by
 * timing), else the git author; its age and subject. Lines not committed
 * say so.
 */
export function hunkLabel(h: LineHistoryData, hunk: LineHunk, now = Date.now()): string {
  if (!hunk.sha) return 'Not committed yet';
  const c = h.commits[hunk.sha];
  if (!c) return '';
  const who = c.attribution ? `${c.attribution.agent}${c.attribution.how === 'timing' ? '?' : ''}` : c.author;
  return `${who} · ${shortAge(c.at, now)} · ${c.subject}`;
}

/** The run a line is in. */
export function hunkAt(h: LineHistoryData, line: number): LineHunk | null {
  return h.hunks.find((x) => line >= x.start && line <= x.end) ?? null;
}

/** How CodeTrellis knows, said for the card. */
export const HOW_WORDS: Record<LineAttribution['how'], string> = {
  'commit message': 'the commit message names it',
  seen: 'CodeTrellis recorded the session when the commit landed',
  timing: 'the session was open in this checkout when it was committed; a person there could have committed too',
};
