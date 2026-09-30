/**
 * A review host, turned on per project, on this device (Phase 32 C2.2a;
 * shared-work doc C-2 §5).
 *
 * CLAUDE.md: remote surfaces are off by default and need the person to turn
 * them on, and the update check is the only request the app makes on its
 * own. A review host is a remote surface, so:
 *
 *  - **Off until turned on**, per project, on this device only. The switch
 *    is a row in this device's database, never `.codetrellis/config.json`,
 *    which is committed: a cloned repository cannot turn itself on.
 *  - **For the repository it was turned on for.** The switch records the
 *    host and repository its remote named then. If the remote later names
 *    another, the switch no longer applies and says why.
 *  - **Only the person** turns it on or saves a token (the grant rule in
 *    grant-guard.ts: the app window, never plain HTTP or an agent).
 *  - **The token** is per host, in the secret store (the OS keychain in
 *    the desktop app), never in the database, a file or a response.
 *
 * Nothing here makes a request: C2.2b reads the host, and only when
 * `activeReviewHost` says it may.
 */

import { getDb } from '../database';
import { markDirty } from '../persistence';
import { secretStore } from '../secret-store';
import { detectProjectHost, hostName, type DetectedHost } from './detect';

export class ReviewHostError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface ReviewHostStatus {
  project: string;
  detected: DetectedHost | null;
  /** On, for this project's current remote, with an adapter for it. */
  enabled: boolean;
  /** The repository it was turned on for, when that is not the current one. */
  turnedOnFor: string | null;
  changedAt: number | null;
  changedBy: string | null;
  token: { saved: boolean; kind: 'os-keychain' | 'memory'; where: string };
  /** One line for Settings and for agents. */
  says: string;
}

interface Row { hostname: string; slug: string; enabled: number; changed_at: number; changed_by: string }

function rowOf(projectRoot: string): Row | null {
  const res = getDb().exec('SELECT hostname, slug, enabled, changed_at, changed_by FROM review_hosts WHERE project_root = ?', [projectRoot]);
  const v = res[0]?.values[0];
  return v ? { hostname: String(v[0]), slug: String(v[1]), enabled: Number(v[2]), changed_at: Number(v[3]), changed_by: String(v[4]) } : null;
}

export const tokenKey = (hostname: string): string => `review-host:${hostname}`;

function says(d: DetectedHost | null, enabled: boolean, turnedOnFor: string | null, tokenSaved: boolean): string {
  if (!d) return 'No review host: this project has no remote with an owner and a repository. Its state comes from git.';
  if (!d.kind) return `${d.hostname} has no adapter. State comes from git alone.`;
  const name = hostName(d.kind);
  if (!d.supported) return `${name} is recognised; its adapter comes later. State comes from git alone.`;
  if (turnedOnFor) return `Turned on for ${turnedOnFor}, but the remote now names ${d.hostname}/${d.slug}. Off until you turn it on for this one.`;
  if (!enabled) return `Off. Nothing is sent to ${name}; state comes from git.`;
  return tokenSaved
    ? `On: reads ${d.hostname}/${d.slug} with your token.`
    : `On: reads ${d.hostname}/${d.slug} without a token, which works for a public repository only.`;
}

export function getReviewHost(projectRoot: string, detected: DetectedHost | null = detectProjectHost(projectRoot)): ReviewHostStatus {
  const row = rowOf(projectRoot);
  const store = secretStore();
  const sameRepo = !!row && !!detected && row.hostname === detected.hostname && row.slug === detected.slug;
  const enabled = !!row?.enabled && sameRepo && !!detected?.supported;
  const turnedOnFor = row?.enabled && !sameRepo ? `${row.hostname}/${row.slug}` : null;
  const tokenSaved = !!detected && store.has(tokenKey(detected.hostname));
  return {
    project: projectRoot,
    detected,
    enabled,
    turnedOnFor,
    changedAt: row?.changed_at ?? null,
    changedBy: row?.changed_by ?? null,
    token: { saved: tokenSaved, kind: store.kind, where: store.where },
    says: says(detected, enabled, turnedOnFor, tokenSaved),
  };
}

/** Turn the host on or off for this project. Turning on needs a host with an adapter. */
export function setReviewHost(projectRoot: string, enabled: boolean, by: string, detected: DetectedHost | null = detectProjectHost(projectRoot)): ReviewHostStatus {
  if (enabled) {
    if (!detected) throw new ReviewHostError(400, 'This project has no remote naming a host, so there is nothing to turn on.');
    if (!detected.supported) throw new ReviewHostError(400, `${detected.kind ? hostName(detected.kind) : detected.hostname} has no adapter yet; its state comes from git.`);
  }
  const hostname = detected?.hostname ?? rowOf(projectRoot)?.hostname ?? '';
  const slug = detected?.slug ?? rowOf(projectRoot)?.slug ?? '';
  getDb().run(
    `INSERT INTO review_hosts (project_root, hostname, slug, enabled, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_root) DO UPDATE SET hostname = excluded.hostname, slug = excluded.slug, enabled = excluded.enabled,
       changed_at = excluded.changed_at, changed_by = excluded.changed_by`,
    [projectRoot, hostname, slug, enabled ? 1 : 0, Date.now(), by],
  );
  markDirty();
  return getReviewHost(projectRoot, detected);
}

/** A token as a host issues one: printable, no spaces, a sane length. Never echoed back. */
export function checkToken(token: unknown): string {
  if (typeof token !== 'string') throw new ReviewHostError(400, 'token must be a string');
  const t = token.trim();
  if (t.length < 8 || t.length > 255 || !/^[\x21-\x7e]+$/.test(t)) throw new ReviewHostError(400, 'That does not look like a token: expected 8–255 printable characters with no spaces.');
  return t;
}

export function saveReviewHostToken(projectRoot: string, token: unknown, detected: DetectedHost | null = detectProjectHost(projectRoot)): ReviewHostStatus {
  if (!detected?.supported) throw new ReviewHostError(400, 'This project\'s host has no adapter, so a token would not be used.');
  secretStore().set(tokenKey(detected.hostname), checkToken(token));
  return getReviewHost(projectRoot, detected);
}

export function forgetReviewHostToken(projectRoot: string, detected: DetectedHost | null = detectProjectHost(projectRoot)): ReviewHostStatus {
  if (detected) secretStore().delete(tokenKey(detected.hostname));
  return getReviewHost(projectRoot, detected);
}

/**
 * What C2.2b may use, or null: the host is on for this project's current
 * remote. The token, when there is one, comes with it and goes nowhere else.
 */
export function activeReviewHost(projectRoot: string): { host: DetectedHost; token: string | null } | null {
  const detected = detectProjectHost(projectRoot);
  if (!getReviewHost(projectRoot, detected).enabled || !detected) return null;
  return { host: detected, token: secretStore().get(tokenKey(detected.hostname)) };
}
