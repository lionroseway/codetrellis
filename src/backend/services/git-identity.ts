/**
 * Git-based repo identity helpers — Phase 3.1 of the CDev target architecture.
 *
 * The "identity" of a repository (for cross-repo plan scoping, central-
 * oversight pointers, and cross-machine syncing) is its git origin URL,
 * normalised so that all the variant forms of the same URL collapse:
 *
 *   git@github.com:org/repo.git
 *   https://github.com/org/repo.git
 *   ssh://git@github.com/org/repo.git
 *   https://GitHub.com/org/repo
 *
 * all map to `https://github.com/org/repo`. The path portion is left
 * case-sensitive because git providers treat it that way; the host is
 * lowercased because DNS is case-insensitive.
 *
 * Local-only aliases (per-device labels for the same repo) live in
 * the recent_projects DB and never travel in the manifest — different
 * machines can store the repo at different paths and pick different
 * names for it without affecting how the team identifies it.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Read the configured origin URL of a git repo at `projectPath`.
 * Returns null when:
 *   - The path is not a git repository.
 *   - The repo has no `origin` remote configured.
 *   - The `git` binary is not available.
 *
 * No shell — uses execFileSync to avoid injection on unusual paths.
 */
export function getOriginUrl(projectPath: string): string | null {
  try {
    if (!fs.existsSync(path.join(projectPath, '.git'))) return null;
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Collapse the variant forms of a git URL into a single canonical
 * identifier. See module docstring for the contract. Pure function —
 * never throws; returns the trimmed input when nothing recognisable
 * is found.
 */
export function normaliseRepoUrl(raw: string): string {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // SSH short form: git@host:path
  const shortSsh = s.match(/^git@([^:]+):(.+)$/);
  if (shortSsh) {
    s = `https://${shortSsh[1]}/${shortSsh[2]}`;
  }

  // SSH long form: ssh://[user@]host/path
  const longSsh = s.match(/^ssh:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);
  if (longSsh) {
    s = `https://${longSsh[1]}/${longSsh[2]}`;
  }

  // Strip trailing `.git` (with or without trailing slash).
  s = s.replace(/\.git\/?$/, '');

  // Strip trailing slashes.
  s = s.replace(/\/+$/, '');

  // Lowercase host portion only; preserve path case (git providers
  // are case-sensitive on path).
  try {
    const u = new URL(s);
    u.host = u.host.toLowerCase();
    // `URL.toString()` re-encodes; reconstruct the way we want.
    const path = u.pathname.replace(/\/+$/, '');
    s = `${u.protocol}//${u.host}${path}`;
  } catch {
    // Not a parseable URL; leave the trimmed value as-is.
  }

  return s;
}

/**
 * Convenience: read the origin URL and return it normalised. Returns
 * null when there's no origin to read.
 */
export function getNormalisedOriginUrl(projectPath: string): string | null {
  const raw = getOriginUrl(projectPath);
  if (!raw) return null;
  return normaliseRepoUrl(raw);
}
