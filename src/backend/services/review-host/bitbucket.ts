/**
 * Bitbucket behind the review host (Phase 32 C2.3; shared-work doc C-2 §5).
 *
 * For one branch: its pull request (open, merged, declined), and when it is
 * open, its build statuses and approvals. From Bitbucket Cloud's REST API 2.0:
 *
 *  - `GET /repositories/{workspace}/{repo}/pullrequests?q=source.branch.name="…"`
 *    with every `state` (`OPEN`, `MERGED`, `DECLINED`, `SUPERSEDED`) lists a
 *    branch's pull requests; each has `id`, `links.html.href`, `state`,
 *    `updated_on`, `merge_commit.hash` and `source.commit.hash`.
 *  - `GET /repositories/{workspace}/{repo}/pullrequests/{id}` adds
 *    `participants`, each with `approved` and a `state` of `approved` or
 *    `changes_requested`.
 *  - `GET /repositories/{workspace}/{repo}/commit/{hash}/statuses` has the
 *    build statuses (`SUCCESSFUL`, `FAILED`, `INPROGRESS`, `STOPPED`).
 *
 * The token is an access token sent as `Authorization: Bearer`, in these
 * requests only. Declined or superseded reads as closed; Bitbucket has no
 * separate closed time, so `updated_on` is when. Otherwise as GitHub: GET
 * only, a fixed base (`CODETRELLIS_BITBUCKET_API` for tests), redirects
 * refused. The summariser is pure, for the unit tests on recorded answers.
 */

import type { HostRead, HostReview } from './github';
import { hostGet, PART, unreachable } from './http';

export function bitbucketApiBase(): string {
  return (process.env.CODETRELLIS_BITBUCKET_API || 'https://api.bitbucket.org/2.0').replace(/\/+$/, '');
}

interface PrAnswer {
  id: number;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  updated_on: string;
  links: { html: { href: string } };
  merge_commit: { hash: string } | null;
  source: { branch: { name: string }; commit: { hash: string } | null };
  participants?: Array<{ approved: boolean; state?: string | null; user?: { account_id?: string } }>;
}
interface StatusesAnswer { values: Array<{ state: string }> }

/** Build statuses summed up: any failed or stopped fails, any in progress runs, all successful passes. */
export function summariseStatuses(statuses: StatusesAnswer | null): HostReview['checks'] {
  const states = (statuses?.values ?? []).map((v) => v.state);
  if (states.length === 0) return null;
  if (states.some((s) => s === 'FAILED' || s === 'STOPPED')) return 'failing';
  if (states.some((s) => s === 'INPROGRESS')) return 'pending';
  return 'passing';
}

/** The pull request for a branch, from Bitbucket's answers. Pure. */
export function summariseBitbucketPull(pr: PrAnswer | null, statuses: StatusesAnswer | null): HostReview | null {
  if (!pr) return null;
  const state: HostReview['state'] = pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'open' : 'closed';
  const open = state === 'open';
  const people = pr.participants ?? [];
  return {
    number: pr.id,
    ref: `#${pr.id}`,
    url: pr.links.html.href,
    state,
    at: open ? null : Math.floor(Date.parse(pr.updated_on) / 1000),
    mergeCommit: state === 'merged' ? pr.merge_commit?.hash ?? null : null,
    checks: open ? summariseStatuses(statuses) : null,
    approvals: open ? people.filter((p) => p.approved).length : 0,
    changesRequested: open && people.some((p) => p.state === 'changes_requested'),
  };
}

/** Ask Bitbucket about one branch's pull request. Never throws: an answer or a reason. */
export async function readBitbucketBranch(owner: string, repo: string, branch: string, token: string | null): Promise<HostRead> {
  if (!PART.test(owner) || !PART.test(repo)) return { ok: false, error: 'Not a Bitbucket repository name.' };
  const base = `${bitbucketApiBase()}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const get = (path: string) => hostGet('Bitbucket', `${base}${path}`, token ? { Authorization: `Bearer ${token}` } : {}, { hasToken: !!token });
  try {
    const q = encodeURIComponent(`source.branch.name="${branch.replace(/["\\]/g, '')}"`);
    const list = await get(`/pullrequests?q=${q}&state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED&sort=-updated_on&pagelen=5`) as { values?: PrAnswer[] };
    const pr = (list.values ?? []).find((p) => p.source?.branch?.name === branch) ?? null;
    if (!pr || pr.state !== 'OPEN') return { ok: true, review: summariseBitbucketPull(pr, null) };
    const hash = pr.source.commit?.hash;
    const [detail, statuses] = await Promise.all([
      get(`/pullrequests/${pr.id}`) as Promise<PrAnswer>,
      hash ? get(`/commit/${encodeURIComponent(hash)}/statuses?pagelen=100`) as Promise<StatusesAnswer> : Promise.resolve(null),
    ]);
    return { ok: true, review: summariseBitbucketPull({ ...pr, ...detail }, statuses) };
  } catch (err) {
    return { ok: false, error: unreachable('Bitbucket', err) };
  }
}
