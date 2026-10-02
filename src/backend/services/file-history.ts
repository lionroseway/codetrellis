/**
 * A file's history on any side (Phase 32 E3).
 *
 * The evolution view puts a file at two points side by side and lets each
 * side scrub back through the commits that touched it there. This lists
 * those positions for one side: the working copy on top when the side has
 * one (this checkout, another worktree), then each commit that changed the
 * file, newest first, following renames, each with the path the file had
 * then.
 *
 * Every commit keeps its git author, as GitLens shows it. What CodeTrellis
 * knows is added on top, with how it knows:
 *
 *  - **commit message**: an `agent: <name>` line, which CodeTrellis's own
 *    commits carry (`git-commit-service`);
 *  - **seen**: the commit landed in a checkout while CodeTrellis was
 *    recording an agent's session there (a replay frame names both).
 *
 * Reads are `git` through `execFileSync` in the project's folder; the side
 * is resolved as E2's comparands are, so a ref is checked and a worktree is
 * found by the id git lists.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Workstream } from '../../shared/types';
import { isSafeGitRef } from './git-safety';
import { findWorkstream, mergeBase, parseMergeBase, shortRefName, sideLabel } from './git-refs';
import { agentFromMessage, attributeCommits, NO_KNOWLEDGE, type Attribution, type Knowledge } from './commit-attribution';

export type { Attribution } from './commit-attribution';

/** At most this many commits per side; older ones are said to exist. */
export const MAX_POSITIONS = 200;
const SHA = /^[0-9a-f]{7,64}$/;

export interface FilePosition {
  /** What `/api/file/at` reads for this position. */
  spec: string;
  kind: 'working' | 'commit';
  /** The file's path at this position, relative to the project (it may have been renamed since). */
  path: string;
  /** For a commit. */
  sha: string | null;
  short: string | null;
  /** The commit's time, ms; null for a working copy. */
  at: number | null;
  /** The git author, always. */
  author: string | null;
  email: string | null;
  subject: string | null;
  /** How the commit changed the file. */
  status: 'added' | 'modified' | 'renamed' | 'deleted' | 'copied' | null;
  /** The path before a rename. */
  from?: string;
  /** What CodeTrellis knows about who made it, when it knows. */
  attribution: Attribution | null;
}

export interface FileHistory {
  /** The side, as asked. */
  at: string;
  label: string;
  path: string;
  /** Newest first: the working copy when there is one, then commits. */
  positions: FilePosition[];
  truncated: boolean;
  /** The git command that lists the same. */
  command: string;
}

export class FileHistoryError extends Error {}

/** Where a side's history starts: a commit, and the working copy above it when it has one. */
function startOf(projectRoot: string, spec: string, workstreams: readonly Workstream[]): { commit: string; working: string | null; name: string; checkout: string | null } {
  if (spec === 'live' || spec === 'index') return { commit: 'HEAD', working: spec, name: 'HEAD', checkout: projectRoot };
  if (spec.startsWith('commit:')) {
    const ref = spec.slice('commit:'.length);
    if (!isSafeGitRef(ref)) throw new FileHistoryError(`“${ref}” is not a ref this app passes to git.`);
    return { commit: ref, working: null, name: shortRefName(ref), checkout: null };
  }
  const mb = parseMergeBase(spec);
  if (mb) {
    const sha = mergeBase(projectRoot, mb.a, mb.b);
    if (!sha) throw new FileHistoryError(`${shortRefName(mb.a)} and ${shortRefName(mb.b)} share no history here.`);
    return { commit: sha, working: null, name: sha.slice(0, 7), checkout: null };
  }
  if (spec.startsWith('workstream:')) {
    const w = findWorkstream(workstreams, spec.slice('workstream:'.length));
    if (!w) throw new FileHistoryError('No such worktree in this project.');
    const head = w.head && SHA.test(w.head) ? w.head : null;
    if (!head) throw new FileHistoryError(`${w.branch ?? path.basename(w.root)} has no commit yet.`);
    return { commit: head, working: w.root.startsWith('branch:') ? null : spec, name: w.branch ?? head.slice(0, 7), checkout: w.root.startsWith('branch:') ? null : w.root };
  }
  throw new FileHistoryError(`Unknown side “${spec}”.`);
}

const STATUS: Record<string, FilePosition['status']> = { A: 'added', M: 'modified', R: 'renamed', D: 'deleted', C: 'copied', T: 'modified' };

/** Parse `git log --format=%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%B%x1d --name-status`. */
export function parseFileLog(out: string): Array<Omit<FilePosition, 'attribution' | 'spec' | 'kind'> & { body: string }> {
  const rows: Array<Omit<FilePosition, 'attribution' | 'spec' | 'kind'> & { body: string }> = [];
  for (const chunk of out.split('\x1e')) {
    const end = chunk.indexOf('\x1d');
    if (end < 0) continue;
    const [sha, author, email, unix, body = ''] = chunk.slice(0, end).split('\x1f');
    if (!SHA.test(sha ?? '')) continue;
    const change = chunk.slice(end + 1).split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    const parts = change.split('\t');
    const letter = (parts[0] ?? '').charAt(0);
    const renamed = letter === 'R' || letter === 'C';
    rows.push({
      sha, short: sha.slice(0, 7), at: Number(unix) * 1000, author: author || null, email: email || null,
      subject: body.split('\n')[0]?.trim() || null, body,
      status: STATUS[letter] ?? null,
      path: (renamed ? parts[2] : parts[1]) ?? '',
      ...(renamed && parts[1] ? { from: parts[1] } : {}),
    });
  }
  return rows;
}

/** The agent a commit message names, if any (see `commit-attribution`). */
export function agentOfBody(body: string): string | null {
  return agentFromMessage(body)?.agent ?? null;
}

/**
 * A file's positions on one side, newest first, each commit attributed
 * from what CodeTrellis recorded (`know`).
 */
export function fileHistory(
  projectRoot: string,
  spec: string,
  relativePath: string,
  workstreams: readonly Workstream[],
  know: Knowledge = NO_KNOWLEDGE,
): FileHistory {
  const start = startOf(projectRoot, spec, workstreams);
  let out: string;
  try {
    out = execFileSync('git', [
      'log', '--follow', '-M', '--relative', `-n${MAX_POSITIONS + 1}`,
      '--format=%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%B%x1d', '--name-status', start.commit, '--', relativePath,
    ], { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new FileHistoryError('git could not read this file\'s history here.');
  }
  const rows = parseFileLog(out);
  const truncated = rows.length > MAX_POSITIONS;
  const kept = rows.slice(0, MAX_POSITIONS);
  const attributed = attributeCommits(kept.map((r) => ({ sha: r.sha as string, at: r.at as number, body: r.body })), start.checkout, know);

  const positions: FilePosition[] = [];
  if (start.working) {
    positions.push({
      spec: start.working, kind: 'working', path: relativePath, sha: null, short: null, at: null,
      author: null, email: null, subject: null, status: null, attribution: null,
    });
  }
  for (const r of kept) {
    const { body: _body, ...row } = r;
    const attribution = attributed.get(r.sha as string) ?? null;
    positions.push({ ...row, spec: `commit:${r.sha}`, kind: 'commit', attribution });
  }

  return {
    at: spec,
    label: sideLabel(projectRoot, spec, workstreams),
    path: relativePath,
    positions,
    truncated,
    command: `git log --follow ${start.name === 'HEAD' ? '' : `${start.name} `}-- ${relativePath}`.replace('  ', ' '),
  };
}
