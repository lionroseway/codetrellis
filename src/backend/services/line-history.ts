/**
 * Line history (Phase 32 E4): who wrote each line of a file, and why, as
 * GitLens shows it, with what CodeTrellis knows added on top.
 *
 * `git blame` gives each line's commit and its git author, always shown.
 * Each commit is then attributed (`commit-attribution`): the agent from the
 * commit message, seen when it landed, or by timing in this checkout, with
 * the session and the task and plan it worked on where those are known.
 * Lines not yet committed are said to be so.
 *
 * Lines are grouped into hunks (a run of lines from one commit), which is
 * what the gutter draws and what `line_history` answers about.
 */

import { execFileSync } from 'node:child_process';
import type { Workstream } from '../../shared/types';
import { isSafeGitRef } from './git-safety';
import { findWorkstream, mergeBase, parseMergeBase, shortRefName } from './git-refs';
import { projectPrefix } from './source-control';
import { attributeCommits, NO_KNOWLEDGE, type Attribution, type Knowledge } from './commit-attribution';

const SHA = /^[0-9a-f]{40,64}$/;
const UNCOMMITTED = /^0+$/;
const MAX_LINES = 20_000;

export interface LineCommit {
  sha: string;
  short: string;
  /** The git author, always. */
  author: string;
  email: string;
  /** The author time, ms. */
  at: number;
  subject: string;
  attribution: Attribution | null;
}

export interface LineHunk {
  /** 1-based, inclusive. */
  start: number;
  end: number;
  /** Null for lines not yet committed. */
  sha: string | null;
}

export interface LineHistory {
  at: string;
  path: string;
  lineCount: number;
  hunks: LineHunk[];
  commits: Record<string, LineCommit>;
  /** Lines changed in the working copy and not yet committed. */
  uncommitted: number;
  command: string;
}

export class LineHistoryError extends Error {}

/** Parse `git blame --porcelain`: each line's commit, and each commit's author, time and summary. */
export function parseBlame(out: string): { lines: string[]; info: Map<string, { author: string; email: string; at: number; summary: string }> } {
  const lines: string[] = [];
  const info = new Map<string, { author: string; email: string; at: number; summary: string }>();
  let current: string | null = null;
  for (const raw of out.split('\n')) {
    if (raw.startsWith('\t')) {
      if (current) lines.push(current);
      continue;
    }
    const head = raw.match(/^([0-9a-f]{40,64}) \d+ (\d+)/);
    if (head) {
      current = head[1];
      if (!info.has(current)) info.set(current, { author: '', email: '', at: 0, summary: '' });
      continue;
    }
    if (!current) continue;
    const entry = info.get(current)!;
    const sp = raw.indexOf(' ');
    const key = sp < 0 ? raw : raw.slice(0, sp);
    const value = sp < 0 ? '' : raw.slice(sp + 1);
    if (key === 'author') entry.author = value;
    else if (key === 'author-mail') entry.email = value.replace(/^<|>$/g, '');
    else if (key === 'author-time') entry.at = Number(value) * 1000;
    else if (key === 'summary') entry.summary = value;
  }
  return { lines, info };
}

/** Runs of lines from one commit. */
export function hunksOf(lines: readonly string[]): LineHunk[] {
  const hunks: LineHunk[] = [];
  lines.forEach((sha, i) => {
    const s = UNCOMMITTED.test(sha) ? null : sha;
    const last = hunks[hunks.length - 1];
    if (last && last.sha === s) last.end = i + 1;
    else hunks.push({ start: i + 1, end: i + 1, sha: s });
  });
  return hunks;
}

/** Where to run blame for a side: the folder, the commit (none for a working copy) and the path there. */
function blameTarget(projectRoot: string, spec: string, relativePath: string, workstreams: readonly Workstream[]): { cwd: string; rev: string | null; file: string; checkout: string | null; name: string } {
  if (spec === 'live') return { cwd: projectRoot, rev: null, file: relativePath, checkout: projectRoot, name: '' };
  if (spec.startsWith('commit:')) {
    const ref = spec.slice('commit:'.length);
    if (!isSafeGitRef(ref)) throw new LineHistoryError(`“${ref}” is not a ref this app passes to git.`);
    return { cwd: projectRoot, rev: ref, file: relativePath, checkout: null, name: shortRefName(ref) };
  }
  const mb = parseMergeBase(spec);
  if (mb) {
    const sha = mergeBase(projectRoot, mb.a, mb.b);
    if (!sha) throw new LineHistoryError(`${shortRefName(mb.a)} and ${shortRefName(mb.b)} share no history here.`);
    return { cwd: projectRoot, rev: sha, file: relativePath, checkout: null, name: sha.slice(0, 7) };
  }
  if (spec.startsWith('workstream:')) {
    const w = findWorkstream(workstreams, spec.slice('workstream:'.length));
    if (!w) throw new LineHistoryError('No such worktree in this project.');
    if (w.root.startsWith('branch:')) {
      if (!w.head || !SHA.test(w.head)) throw new LineHistoryError('That branch has no commit here.');
      return { cwd: projectRoot, rev: w.head, file: relativePath, checkout: null, name: w.branch ?? w.head.slice(0, 7) };
    }
    // Its paths are from its repository's top: a project in a subfolder adds where it sits.
    return { cwd: w.root, rev: null, file: `${projectPrefix(projectRoot)}${relativePath}`, checkout: w.root, name: '' };
  }
  throw new LineHistoryError('Line history reads a commit, a branch, a tag or a working copy.');
}

/** Bodies of these commits, for what their messages say about who made them. */
function bodiesOf(cwd: string, shas: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < shas.length; i += 200) {
    const batch = shas.slice(i, i + 200);
    try {
      const raw = execFileSync('git', ['show', '-s', '--format=%x1e%H%x1f%B', ...batch], { cwd, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
      for (const chunk of raw.split('\x1e')) {
        const [sha, body = ''] = chunk.split('\x1f');
        if (sha && SHA.test(sha.trim())) out.set(sha.trim(), body);
      }
    } catch { /* unreadable: no message knowledge */ }
  }
  return out;
}

/** Who wrote each line of a file on one side, and what CodeTrellis knows of why. */
export function lineHistory(
  projectRoot: string,
  spec: string,
  relativePath: string,
  workstreams: readonly Workstream[],
  know: Knowledge = NO_KNOWLEDGE,
): LineHistory {
  const t = blameTarget(projectRoot, spec, relativePath, workstreams);
  let out: string;
  try {
    out = execFileSync('git', ['blame', '--porcelain', ...(t.rev ? [t.rev] : []), '--', t.file], {
      cwd: t.cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new LineHistoryError(`git has no history for ${relativePath} here: it is new, or not in this repository.`);
  }
  const { lines, info } = parseBlame(out);
  if (lines.length > MAX_LINES) throw new LineHistoryError(`${relativePath} has ${lines.length} lines; line history reads up to ${MAX_LINES}.`);
  const shas = [...info.keys()].filter((s) => !UNCOMMITTED.test(s));
  const bodies = bodiesOf(t.cwd, shas);
  const attributed = attributeCommits(shas.map((sha) => ({ sha, at: info.get(sha)!.at, body: bodies.get(sha) ?? '' })), t.checkout, know);
  const commits: Record<string, LineCommit> = {};
  for (const sha of shas) {
    const i = info.get(sha)!;
    commits[sha] = { sha, short: sha.slice(0, 7), author: i.author, email: i.email, at: i.at, subject: i.summary, attribution: attributed.get(sha) ?? null };
  }
  return {
    at: spec,
    path: relativePath,
    lineCount: lines.length,
    hunks: hunksOf(lines),
    commits,
    uncommitted: lines.filter((s) => UNCOMMITTED.test(s)).length,
    command: t.cwd === projectRoot
      ? `git blame ${t.rev ? `${t.name} ` : ''}-- ${relativePath}`
      : `git -C ${t.cwd} blame -- ${t.file}`,
  };
}

const ago = (ms: number, now: number) => {
  const days = Math.round((now - ms) / 86_400_000);
  if (days < 1) {
    const hours = Math.round((now - ms) / 3_600_000);
    return hours < 1 ? 'just now' : `${hours} h ago`;
  }
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

/** One line, said for a person or an agent: who, when, which commit, and what CodeTrellis knows. */
export function lineWords(h: LineHistory, line: number, now = Date.now()): string {
  const hunk = h.hunks.find((x) => line >= x.start && line <= x.end);
  if (!hunk) return `Line ${line} is not in ${h.path} (it has ${h.lineCount} lines).`;
  if (!hunk.sha) return `Line ${line} is changed in the working copy and not yet committed.`;
  const c = h.commits[hunk.sha];
  const parts = [`Line ${line}: ${c.author} · ${ago(c.at, now)} · “${c.subject}” (${c.short})`];
  if (c.attribution) {
    parts.push(c.attribution.words);
    if (c.attribution.sessionId) parts.push(`session ${c.attribution.sessionId}`);
    if (c.attribution.task) parts.push(`task “${c.attribution.task.title}”${c.attribution.plan ? ` in the plan “${c.attribution.plan.title}”` : ''}`);
  }
  return `${parts.join('; ')}.`;
}

