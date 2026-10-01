/**
 * The one way a review host is asked (Phase 32 C2.2b, C2.3): GET only,
 * against the host's API base, redirects refused so a token never reaches
 * another host, the token only in this request's header, a timeout, and
 * refusals said in words the person can act on. Each adapter builds its
 * paths from checked, encoded parts.
 */

export class HostReadError extends Error {}

const TIMEOUT_MS = 8000;

/** A host's answer, or a `HostReadError` in words. */
export async function hostGet(
  name: string,
  url: string,
  auth: Record<string, string>,
  opts: { hasToken: boolean; extraHeaders?: Record<string, string> },
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json', 'User-Agent': 'CodeTrellis', ...(opts.extraHeaders ?? {}), ...auth },
  });
  if (res.ok) return res.json();
  if (res.status === 401) throw new HostReadError(`${name} refused the token (401). Save a new one in Settings → Review hosts.`);
  const limited = res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');
  if (limited) {
    const reset = Number(res.headers.get('x-ratelimit-reset') ?? res.headers.get('ratelimit-reset'));
    const when = reset ? `until ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : 'for now';
    throw new HostReadError(`${name}'s rate limit is used up ${when}${opts.hasToken ? '' : '; a token raises it'}.`);
  }
  if (res.status === 404) throw new HostReadError(`${name} has no such repository${opts.hasToken ? ' that this token can see' : ' (a private one needs a token)'} (404).`);
  throw new HostReadError(`${name} answered ${res.status}.`);
}

/** A failure that is not an answer, in words. */
export function unreachable(name: string, err: unknown): string {
  if (err instanceof HostReadError) return err.message;
  return (err as Error)?.name === 'TimeoutError' ? `${name} did not answer in time.` : `${name} could not be reached.`;
}

/** A path segment an adapter may use: letters, digits, `_ . -`. */
export const PART = /^[A-Za-z0-9_.-]+$/;
