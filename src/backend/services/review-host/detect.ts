/**
 * Which review host a project's work goes to (Phase 32 C2.2a, shared-work
 * doc C-2 §5).
 *
 * Read from the project's `origin` remote, as git has it: nothing is asked
 * of the host to find out. GitHub is the first adapter (C2.2b); GitLab and
 * Bitbucket are recognised now so Settings can say what is coming for them
 * (C2.3), and any other host, or a self-hosted one, is named as it is and
 * left to git alone.
 *
 * Pure except `detectProjectHost`, which reads the remote.
 */

import { getOriginUrl, normaliseRepoUrl } from '../git-identity';

export type ReviewHostKind = 'github' | 'gitlab' | 'bitbucket';

export interface DetectedHost {
  /** The host's kind, or null for one CodeTrellis has no adapter planned for. */
  kind: ReviewHostKind | null;
  /** `github.com`, as the remote names it, lowercased. */
  hostname: string;
  owner: string;
  repo: string;
  /** `acme/app` */
  slug: string;
  /** `https://github.com/acme/app` — never with credentials. */
  webUrl: string;
  /** Whether an adapter exists for it in this build. */
  supported: boolean;
  /** What the adapter would read, in words, before anything is turned on. */
  asks: string | null;
}

const NAMES: Record<ReviewHostKind, string> = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' };

export function hostName(kind: ReviewHostKind): string {
  return NAMES[kind];
}

function kindOf(hostname: string): ReviewHostKind | null {
  if (hostname === 'github.com') return 'github';
  if (hostname === 'gitlab.com') return 'gitlab';
  if (hostname === 'bitbucket.org') return 'bitbucket';
  return null;
}

/**
 * The host behind a remote URL, in any of git's spellings (`git@host:o/r`,
 * `ssh://`, `https://`). Null for a local path, a file URL, or anything
 * without an owner and a repository.
 */
export function detectHost(remote: string | null | undefined): DetectedHost | null {
  if (!remote) return null;
  const normal = normaliseRepoUrl(remote);
  let url: URL;
  try { url = new URL(normal); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const hostname = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (!hostname || parts.length < 2) return null;
  const [owner, ...rest] = parts;
  const repo = rest.join('/');
  const safe = /^[A-Za-z0-9_.-]+$/;
  if (!safe.test(owner) || !rest.every((p) => safe.test(p))) return null;
  const kind = kindOf(hostname);
  const supported = kind === 'github';
  const slug = `${owner}/${repo}`;
  return {
    kind, hostname, owner, repo, slug,
    webUrl: `https://${hostname}/${slug}`,
    supported,
    asks: supported
      ? `Reads the pull requests for this project's branches on ${hostname}/${slug}: whether each is open, merged or closed, its checks and its reviews. It changes nothing on ${hostName(kind!)}.`
      : null,
  };
}

/** The project's host, from its `origin` remote. */
export function detectProjectHost(projectRoot: string): DetectedHost | null {
  return detectHost(getOriginUrl(projectRoot));
}
