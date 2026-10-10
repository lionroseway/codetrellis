/**
 * Phase 33 V3 — re-review only what changed (AGENT-CHECKS-AND-REVIEW §2.3).
 *
 * Each reviewer, a person or an agent, marks a line of work reviewed at a
 * commit, and the review's findings then are kept with it. After more
 * pushes, the review since that look says which files moved since, and
 * which of the earlier findings the pushes addressed (no longer said) and
 * which are new. Long agent pull requests pushed to many times are where
 * this saves the most.
 */

import { execFileSync } from 'node:child_process';
import { getDb } from './database';
import { markDirty } from './persistence';

export interface ReviewMark {
  target: string;
  reviewer: string;
  reviewerType: string;
  base: string;
  commit: string;
  findings: string[];
  at: number;
}

export interface SinceLastLook {
  mark: ReviewMark;
  /** Files changed between the commit reviewed and the head now. */
  changed: string[];
  /** Findings said then and not now: what the pushes since addressed. */
  addressed: string[];
  /** Findings said now and not then. */
  added: string[];
  /** The commit looked at is no longer in the history (a force-push): review the whole change again. */
  gone: boolean;
  /** "Since you looked at a1b2c3d: 3 files changed, 2 findings addressed, 1 new." */
  words: string;
}

export function markReviewed(projectRoot: string, m: Omit<ReviewMark, 'at'>, now = Date.now()): ReviewMark {
  getDb().run(
    `INSERT OR REPLACE INTO review_marks (project_root, target, reviewer, reviewer_type, base, head_commit, findings, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectRoot, m.target, m.reviewer, m.reviewerType, m.base, m.commit, JSON.stringify(m.findings), now],
  );
  markDirty();
  return { ...m, at: now };
}

export function lastMark(projectRoot: string, target: string, reviewer: string): ReviewMark | null {
  const r = getDb().exec(
    'SELECT target, reviewer, reviewer_type, base, head_commit, findings, at FROM review_marks WHERE project_root = ? AND target = ? AND reviewer = ?',
    [projectRoot, target, reviewer],
  )[0]?.values[0];
  if (!r) return null;
  let findings: string[] = [];
  try { findings = JSON.parse(String(r[5])) as string[]; } catch { findings = []; }
  return { target: String(r[0]), reviewer: String(r[1]), reviewerType: String(r[2]), base: String(r[3]), commit: String(r[4]), findings, at: Number(r[6]) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What moved since a reviewer's last look, against the findings now. Pure but for git's file list. */
export function sinceLastLook(projectRoot: string, mark: ReviewMark, head: string, findingsNow: readonly string[]): SinceLastLook {
  let changed: string[] = [];
  let gone = false;
  try {
    changed = execFileSync('git', ['-C', projectRoot, 'diff', '--name-only', mark.commit, head, '--'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { gone = true; }
  const now = new Set(findingsNow);
  const then = new Set(mark.findings);
  const addressed = mark.findings.filter((f) => !now.has(f));
  const added = findingsNow.filter((f) => !then.has(f));
  const short = mark.commit.slice(0, 7);
  const words = gone
    ? `The commit you looked at, ${short}, is no longer in the history (rewritten since): review the whole change again.`
    : changed.length === 0
    ? `Nothing changed since you looked at ${short}.`
    : `Since you looked at ${short}: ${plural(changed.length, 'file')} changed${addressed.length ? `, ${plural(addressed.length, 'finding')} addressed` : ''}${added.length ? `, ${added.length} new` : ''}.`;
  return { mark, changed, addressed, added, gone, words };
}
