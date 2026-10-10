/**
 * Phase 33 C5 — `codetrellis review --post`: the review as one comment on
 * the pull request, on GitHub, GitLab or Bitbucket. Optional: SARIF and the
 * job summary need no write access at all.
 *
 * - The host and repository come from the checkout's `origin`
 *   (`detectHost`), the pull request from the CI's own variables (or
 *   `--pr`), never from the change under review.
 * - The token is the CLI's: `--post-token env:VAR`, else the host's usual
 *   one (GITHUB_TOKEN, GITLAB_TOKEN, BITBUCKET_TOKEN). The agent's
 *   environment is scrubbed, so the model never sees it.
 * - One POST to the host's fixed API base (overridable in tests by the same
 *   variables the read adapters use), redirects refused, a timeout, the
 *   token only in that request's header.
 */

import fs from 'node:fs';
import type { DetectedHost } from '../backend/services/review-host/detect';
import { githubApiBase } from '../backend/services/review-host/github';
import { gitlabApiBase } from '../backend/services/review-host/gitlab';
import { bitbucketApiBase } from '../backend/services/review-host/bitbucket';
import { PART } from '../backend/services/review-host/http';

export const DEFAULT_TOKEN: Record<'github' | 'gitlab' | 'bitbucket', string> = { github: 'GITHUB_TOKEN', gitlab: 'GITLAB_TOKEN', bitbucket: 'BITBUCKET_TOKEN' };

/** The pull request this CI job runs for, from the host's own variables. */
export function pullNumber(env: NodeJS.ProcessEnv): number | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);
  if (env.GITHUB_EVENT_PATH) {
    try {
      const e = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as { pull_request?: { number?: unknown }; number?: unknown };
      const got = n(e.pull_request?.number) ?? n(e.number);
      if (got) return got;
    } catch { /* not a pull request event */ }
  }
  const ref = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '');
  return (ref ? Number(ref[1]) : null) ?? n(env.CI_MERGE_REQUEST_IID) ?? n(env.BITBUCKET_PR_ID) ?? n(env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER) ?? n(env.CHANGE_ID);
}

/** The request that posts `body` as a comment: pure, for the tests. */
export function commentRequest(host: DetectedHost, pr: number, token: string, body: string): { url: string; headers: Record<string, string>; body: string } | { error: string } {
  if (!host.kind) return { error: `${host.hostname} is not a host the review can post to (GitHub, GitLab or Bitbucket)` };
  if (!PART.test(host.owner) && host.kind !== 'gitlab') return { error: 'the repository\'s owner is not one the review can name' };
  if (!PART.test(host.repo)) return { error: 'the repository\'s name is not one the review can name' };
  const text = body.slice(0, 60_000);
  const json = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'CodeTrellis' };
  if (host.kind === 'github') {
    return { url: `${githubApiBase()}/repos/${encodeURIComponent(host.owner)}/${encodeURIComponent(host.repo)}/issues/${pr}/comments`, headers: { ...json, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, body: JSON.stringify({ body: text }) };
  }
  if (host.kind === 'gitlab') {
    if (!host.slug.split('/').every((p) => PART.test(p))) return { error: 'the project\'s path is not one the review can name' };
    return { url: `${gitlabApiBase()}/projects/${encodeURIComponent(host.slug)}/merge_requests/${pr}/notes`, headers: { ...json, Authorization: `Bearer ${token}` }, body: JSON.stringify({ body: text }) };
  }
  return { url: `${bitbucketApiBase()}/repositories/${encodeURIComponent(host.owner)}/${encodeURIComponent(host.repo)}/pullrequests/${pr}/comments`, headers: { ...json, Authorization: `Bearer ${token}` }, body: JSON.stringify({ content: { raw: text } }) };
}

/** Post it; the outcome in words, never the token. */
export async function postComment(host: DetectedHost, pr: number, token: string, body: string): Promise<{ ok: true; says: string } | { ok: false; says: string }> {
  const req = commentRequest(host, pr, token, body);
  if ('error' in req) return { ok: false, says: req.error };
  const name = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' }[host.kind!];
  try {
    const res = await fetch(req.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: req.headers, body: req.body });
    if (res.ok) return { ok: true, says: `Posted the review on ${name}, on #${pr}.` };
    if (res.status === 401 || res.status === 403) return { ok: false, says: `${name} refused the token (${res.status}): it needs to write comments on pull requests.` };
    return { ok: false, says: `${name} answered ${res.status}; the review was not posted.` };
  } catch (err) {
    return { ok: false, says: (err as Error)?.name === 'TimeoutError' ? `${name} did not answer in time; the review was not posted.` : `${name} could not be reached; the review was not posted.` };
  }
}
