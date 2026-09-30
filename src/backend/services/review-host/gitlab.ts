/**
 * GitLab behind the review host (Phase 32 C2.3; shared-work doc C-2 §5).
 *
 * For one branch: its merge request (opened, merged, closed), and when it is
 * open, its pipeline and approvals. From GitLab's REST API v4:
 *
 *  - `GET /projects/:id/merge_requests?source_branch=…&state=all` lists a
 *    branch's merge requests (`:id` is the URL-encoded path, subgroups
 *    included); each has `iid`, `web_url`, `state` (`opened`, `closed`,
 *    `locked`, `merged`), `merged_at`, `closed_at` and the merge or squash
 *    commit.
 *  - `GET /projects/:id/merge_requests/:iid` adds `head_pipeline.status` and
 *    `detailed_merge_status`, whose `requested_changes` says a reviewer asked
 *    for changes.
 *  - `GET /projects/:id/merge_requests/:iid/approvals` has `approved_by`.
 *
 * The token is a `PRIVATE-TOKEN` header (a personal, project or group access
 * token with `read_api`), in these requests only. Otherwise as GitHub:
 * GET only, a fixed base (`CODETRELLIS_GITLAB_API` for tests), redirects
 * refused. The summariser is pure, for the unit tests on recorded answers.
 */

import type { HostRead, HostReview } from './github';
import { hostGet, PART, unreachable } from './http';

export function gitlabApiBase(): string {
  return (process.env.CODETRELLIS_GITLAB_API || 'https://gitlab.com/api/v4').replace(/\/+$/, '');
}

interface MrAnswer {
  iid: number;
  web_url: string;
  state: 'opened' | 'closed' | 'locked' | 'merged';
  merged_at: string | null;
  closed_at: string | null;
  merge_commit_sha: string | null;
  squash_commit_sha?: string | null;
  source_branch: string;
  head_pipeline?: { status: string } | null;
  detailed_merge_status?: string;
}
interface ApprovalsAnswer { approved_by?: Array<{ user: { username: string } }> }

const secs = (iso: string | null | undefined): number | null => (iso ? Math.floor(Date.parse(iso) / 1000) : null);

/** A pipeline's status summed up: success passes, failed or canceled fails, skipped is none, anything else is running. */
export function summarisePipeline(status: string | null | undefined): HostReview['checks'] {
  if (!status || status === 'skipped') return null;
  if (status === 'success') return 'passing';
  if (status === 'failed' || status === 'canceled') return 'failing';
  return 'pending';
}

/** The merge request for a branch, from GitLab's answers. Pure. */
export function summariseMergeRequest(mr: MrAnswer | null, approvals: ApprovalsAnswer | null): HostReview | null {
  if (!mr) return null;
  const state: HostReview['state'] = mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed';
  const open = state === 'open';
  return {
    number: mr.iid,
    ref: `!${mr.iid}`,
    url: mr.web_url,
    state,
    at: state === 'merged' ? secs(mr.merged_at) : state === 'closed' ? secs(mr.closed_at) : null,
    mergeCommit: state === 'merged' ? (mr.squash_commit_sha || mr.merge_commit_sha || null) : null,
    checks: open ? summarisePipeline(mr.head_pipeline?.status) : null,
    approvals: open ? (approvals?.approved_by ?? []).length : 0,
    changesRequested: open && mr.detailed_merge_status === 'requested_changes',
  };
}

/** Ask GitLab about one branch's merge request. Never throws: an answer or a reason. */
export async function readGitlabBranch(owner: string, repo: string, branch: string, token: string | null): Promise<HostRead> {
  const parts = [owner, ...repo.split('/')];
  if (!parts.every((p) => PART.test(p))) return { ok: false, error: 'Not a GitLab project path.' };
  const project = `${gitlabApiBase()}/projects/${encodeURIComponent(parts.join('/'))}`;
  const get = (path: string) => hostGet('GitLab', `${project}${path}`, token ? { 'PRIVATE-TOKEN': token } : {}, { hasToken: !!token });
  try {
    const list = await get(`/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all&order_by=updated_at&sort=desc&per_page=5`) as MrAnswer[];
    const mr = Array.isArray(list) ? list.find((m) => m.source_branch === branch) ?? null : null;
    if (!mr || mr.state !== 'opened') return { ok: true, review: summariseMergeRequest(mr, null) };
    const [detail, approvals] = await Promise.all([
      get(`/merge_requests/${mr.iid}`) as Promise<MrAnswer>,
      get(`/merge_requests/${mr.iid}/approvals`) as Promise<ApprovalsAnswer>,
    ]);
    return { ok: true, review: summariseMergeRequest({ ...mr, ...detail }, approvals) };
  } catch (err) {
    return { ok: false, error: unreachable('GitLab', err) };
  }
}
