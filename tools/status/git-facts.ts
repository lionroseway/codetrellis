/**
 * What git (and, when it can be asked, GitHub) says about each Phase 32 step
 * (the owner's point, 2026-09-30: a step has a branch, so its state is a
 * fact to read, not a line to keep).
 *
 * - **done**: a first-parent commit on the integration branch titled
 *   `Phase 32 <id>[, …]: … (#N)` (or, before #153, `feat(phase-32): <id> —
 *   … (#N)`) — every step is squash-merged with its PR number, and a commit
 *   that names two ("A5 refined, and A5.1") counts for both. Stage 0's
 *   merges came in through `main` (#137), off that line, so they stay
 *   written.
 * - **in_review**: an open PR from the step's branch (GitHub's public API).
 * - **building**: the step's branch exists with no PR yet. A branch whose PR
 *   merged or closed is left behind, not live: squash merges break
 *   ancestry, so only GitHub can tell those apart (`feat/phase-32-b7-refine`
 *   is merged, yet names B7). Offline, only the branch checked out here
 *   counts as building.
 *
 * A branch is `feat/phase-32-<id with dots as dashes, lowercase>-<slug>`
 * (`feat/phase-32-b6-4b-timeline-follows` is B6.4b); the longest id that
 * fits wins, so B6.4 does not claim B6.4b's branch.
 */

import { execFileSync } from 'node:child_process';
import type { ItemStatus } from './status';

export interface Fact { status: ItemStatus; prs: number[]; sha?: string; branch?: string }

export interface Facts {
  /** The integration branch's tip the facts were read at. */
  base: string;
  baseSha: string;
  /** Whether review state came from GitHub, or only from the branch checked out (offline). */
  source: 'github' | 'offline';
  byId: Map<string, Fact>;
  /** Open PRs into the integration branch that no step's branch accounts for (a fix, a doc). */
  otherOpen: Array<{ number: number; branch: string }>;
}

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The ids a merge subject names, and its PR: `Phase 32 A5 refined, and A5.1: … (#222)` → [A5, A5.1], 222. */
export function parseMergeSubject(subject: string, known: ReadonlySet<string>): { ids: string[]; pr: number } | null {
  // `Phase 32 B7.4: …` since #153; `feat(phase-32): A1.7a — …` and `fix(phase-32): A0 — …` before.
  const m = /^(?:Phase 32 (.+?):|(?:feat|fix)\(phase-32\): (.+?) —) .*\(#(\d+)\)$/.exec(subject);
  if (!m) return null;
  const ids = [...(m[1] ?? m[2]).matchAll(/(?<![\w.])([A-C]\d+(?:\.\d+[a-z]?)?|0\.\d+[a-z]?(?:-\d)?|HD\d+)(?![\w.])/g)]
    .map((x) => x[1])
    .filter((id) => known.has(id));
  return ids.length ? { ids, pr: Number(m[3]) } : null;
}

/** The step a branch belongs to: the longest known id whose slug starts the branch name. */
export function idForBranch(branch: string, known: readonly string[]): string | null {
  const name = branch.replace(/^origin\//, '');
  if (!name.startsWith('feat/phase-32-')) return null;
  const rest = name.slice('feat/phase-32-'.length);
  let best: string | null = null;
  for (const id of known) {
    const slug = id.toLowerCase().replace(/\./g, '-');
    if ((rest === slug || rest.startsWith(`${slug}-`)) && (!best || id.length > best.length)) best = id;
  }
  return best;
}

interface Pr { number: number; head: string; open: boolean }

/** Every PR into the integration branch, open or not, newest first; null when GitHub cannot be asked. */
async function prsFromGithub(repo: string, base: string): Promise<Pr[] | null> {
  const out: Pr[] = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=all&base=${encodeURIComponent(base)}&per_page=100&page=${page}`, {
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Array<{ number: number; state: string; head: { ref: string } }>;
      out.push(...body.map((p) => ({ number: p.number, head: p.head.ref, open: p.state === 'open' })));
      if (body.length < 100) break;
    }
    return out;
  } catch {
    return null;
  }
}

/** Read the facts for these ids from the repository at `cwd`. Needs the integration branch's history. */
export async function readFacts(cwd: string, ids: readonly string[], opts: { base?: string; repo?: string; github?: boolean } = {}): Promise<Facts> {
  const base = opts.base ?? 'origin/feat/phase-32';
  const known = new Set(ids);
  const byId = new Map<string, Fact>();

  const baseSha = git(cwd, ['rev-parse', base]).trim();
  // Oldest first, so a step's PRs read in the order they landed.
  const log = git(cwd, ['log', base, '--first-parent', '--reverse', '--format=%H%x09%s']).split('\n').filter(Boolean);
  for (const line of log) {
    const [sha, subject] = line.split('\t');
    const hit = parseMergeSubject(subject, known);
    if (!hit) continue;
    for (const id of hit.ids) {
      const f = byId.get(id) ?? { status: 'done' as ItemStatus, prs: [] };
      if (!f.prs.includes(hit.pr)) f.prs.push(hit.pr);
      f.sha = sha.slice(0, 7);
      byId.set(id, f);
    }
  }

  const prs = opts.github === false ? null : await prsFromGithub(opts.repo ?? 'lionroseway/codetrellis', base.replace(/^origin\//, ''));
  const branches = prs
    ? [...new Set(git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'])
      .split('\n').filter((r) => r.includes('feat/phase-32-')).map((r) => r.replace(/^origin\//, '')))]
    : [git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()];
  for (const branch of branches) {
    const id = idForBranch(branch, ids);
    if (!id || byId.get(id)?.status === 'done') continue;
    const mine = prs?.filter((p) => p.head === branch) ?? [];
    const open = mine.find((p) => p.open);
    if (mine.length && !open) continue; // merged or closed: left behind, not live
    const status: ItemStatus = open ? 'in_review' : 'building';
    if (byId.get(id)?.status === 'in_review' && status === 'building') continue;
    byId.set(id, { status, prs: open ? [open.number] : [], branch });
  }
  const claimed = new Set([...byId.values()].map((f) => f.branch).filter(Boolean));
  const otherOpen = (prs ?? []).filter((p) => p.open && !claimed.has(p.head)).map((p) => ({ number: p.number, branch: p.head }));
  return { base, baseSha: baseSha.slice(0, 7), source: prs ? 'github' : 'offline', byId, otherOpen };
}
