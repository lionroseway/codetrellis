/**
 * GitHub behind the review host (Phase 32 C2.2b; shared-work doc C-2 §5).
 *
 * For one branch: its pull request (open, merged, closed), and when it is
 * open, its checks and reviews. Asked only through `readHostStates`, which
 * asks `activeReviewHost` first, so nothing here runs for a project the
 * person has not turned on.
 *
 * - The API base is fixed for github.com (`CODETRELLIS_GITHUB_API` points
 *   it at a stand-in in tests, as the update check does). Paths are built
 *   from checked parts, each encoded.
 * - The token goes in this request's Authorization header only, and a
 *   redirect is refused rather than followed, so it never reaches another
 *   host. It is never logged or returned.
 * - Read only: GET, and nothing on GitHub changes.
 *
 * `summarisePull` is pure, for the unit tests on recorded answers.
 */

import { hostGet, PART, unreachable } from './http';

export interface HostReview {
  number: number;
  /** How the host writes it: `#118` on GitHub and Bitbucket, `!42` on GitLab. */
  ref: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  /** When it merged or closed, epoch seconds. */
  at: number | null;
  /** Its merge commit, when merged. */
  mergeCommit: string | null;
  /** Open only: its checks, summed up; null when there are none. */
  checks: 'passing' | 'failing' | 'pending' | null;
  approvals: number;
  changesRequested: boolean;
}

export type HostRead =
  | { ok: true; review: HostReview | null }
  | { ok: false; error: string };

export function githubApiBase(): string {
  return (process.env.CODETRELLIS_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
}

function getJson(path: string, token: string | null): Promise<unknown> {
  return hostGet('GitHub', `${githubApiBase()}${path}`, token ? { Authorization: `Bearer ${token}` } : {}, {
    hasToken: !!token,
    extraHeaders: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
}

interface PullAnswer {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  closed_at: string | null;
  merge_commit_sha: string | null;
  head: { sha: string; ref: string };
}
interface CheckRunsAnswer { total_count: number; check_runs: Array<{ status: string; conclusion: string | null }> }
interface StatusAnswer { state: string; total_count: number }
interface ReviewAnswer { user: { login: string } | null; state: string; submitted_at?: string }

const secs = (iso: string | null): number | null => (iso ? Math.floor(Date.parse(iso) / 1000) : null);

/** Checks summed up: any failure fails, anything unfinished is pending, all green passes. */
export function summariseChecks(runs: CheckRunsAnswer | null, status: StatusAnswer | null): HostReview['checks'] {
  const conclusions = (runs?.check_runs ?? []).map((r) => (r.status !== 'completed' ? 'pending' : r.conclusion ?? 'pending'));
  if (status && status.total_count > 0) conclusions.push(status.state === 'success' ? 'success' : status.state === 'pending' ? 'pending' : 'failure');
  if (conclusions.length === 0) return null;
  if (conclusions.some((c) => ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'error'].includes(c))) return 'failing';
  if (conclusions.some((c) => c === 'pending' || c === 'queued' || c === 'in_progress')) return 'pending';
  return 'passing';
}

/** Each reviewer's latest word counts once: approvals, and whether changes are requested. */
export function summariseReviews(reviews: ReviewAnswer[]): { approvals: number; changesRequested: boolean } {
  const latest = new Map<string, string>();
  for (const r of reviews) {
    if (!r.user || r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    latest.set(r.user.login, r.state);
  }
  const states = [...latest.values()];
  return { approvals: states.filter((s) => s === 'APPROVED').length, changesRequested: states.includes('CHANGES_REQUESTED') };
}

/** The pull request for a branch, from GitHub's answers. Pure. */
export function summarisePull(pull: PullAnswer | null, runs: CheckRunsAnswer | null, status: StatusAnswer | null, reviews: ReviewAnswer[]): HostReview | null {
  if (!pull) return null;
  const state: HostReview['state'] = pull.merged_at ? 'merged' : pull.state === 'open' ? 'open' : 'closed';
  const open = state === 'open';
  const r = open ? summariseReviews(reviews) : { approvals: 0, changesRequested: false };
  return {
    number: pull.number,
    ref: `#${pull.number}`,
    url: pull.html_url,
    state,
    at: state === 'merged' ? secs(pull.merged_at) : state === 'closed' ? secs(pull.closed_at) : null,
    mergeCommit: state === 'merged' ? pull.merge_commit_sha : null,
    checks: open ? summariseChecks(runs, status) : null,
    approvals: r.approvals,
    changesRequested: r.changesRequested,
  };
}

/** Ask GitHub about one branch's pull request. Never throws: an answer or a reason. */
export async function readGithubBranch(owner: string, repo: string, branch: string, token: string | null): Promise<HostRead> {
  if (!PART.test(owner) || !repo.split('/').every((p) => PART.test(p))) return { ok: false, error: 'Not a GitHub repository name.' };
  const base = `/repos/${encodeURIComponent(owner)}/${repo.split('/').map(encodeURIComponent).join('/')}`;
  try {
    const pulls = await getJson(`${base}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&sort=updated&direction=desc&per_page=5`, token) as PullAnswer[];
    const pull = Array.isArray(pulls) ? pulls.find((p) => p.head?.ref === branch) ?? null : null;
    if (!pull || pull.merged_at || pull.state !== 'open') return { ok: true, review: summarisePull(pull, null, null, []) };
    const sha = encodeURIComponent(pull.head.sha);
    const [runs, status, reviews] = await Promise.all([
      getJson(`${base}/commits/${sha}/check-runs?per_page=100`, token) as Promise<CheckRunsAnswer>,
      getJson(`${base}/commits/${sha}/status`, token) as Promise<StatusAnswer>,
      getJson(`${base}/pulls/${pull.number}/reviews?per_page=100`, token) as Promise<ReviewAnswer[]>,
    ]);
    return { ok: true, review: summarisePull(pull, runs, status, Array.isArray(reviews) ? reviews : []) };
  } catch (err) {
    return { ok: false, error: unreachable('GitHub', err) };
  }
}
