/**
 * Git activity service — Phase 6.1 of the CDev target architecture.
 *
 * Projects the `.codetrellis/` manifest's git history into typed
 * activity entries. This is a "what happened this week" surface drawn
 * entirely from git — complementing the DB-driven plan_events (which
 * tracks in-session structural mutations) with team-level activity
 * that survived into commits.
 *
 * Each entry: { timestamp, author, agentAttribution?, action, entityType,
 *              entityTitle, planSlug, commitHash }
 *
 * Actions: created, updated, resolved, dismissed, verified, deleted.
 * Entity types: plan, item, channel-event, system-doc, config.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';

// --- Types -------------------------------------------------------------------

export type ActivityAction = 'created' | 'updated' | 'resolved' | 'dismissed' | 'verified' | 'deleted';
export type ActivityEntityType = 'plan' | 'item' | 'channel-event' | 'system-doc' | 'config';

export interface ActivityEntry {
  timestamp: string; // ISO
  author: string;
  agentAttribution?: { agentType: string; model?: string } | null;
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityTitle: string;
  planSlug: string | null;
  commitHash: string;
  commitSubject: string;
}

export interface GetActivityOptions {
  projectRoot: string;
  /** ISO date or ms-since-epoch — only include commits after this point. */
  since?: string | number;
  /** Max entries to return (default 50). */
  limit?: number;
}

// --- Public API --------------------------------------------------------------

/**
 * Walk `git log` for the `.codetrellis/` directory and extract typed
 * activity entries from the changed file paths and commit metadata.
 */
export function getTeamActivity(opts: GetActivityOptions): ActivityEntry[] {
  const { projectRoot, since, limit = 50 } = opts;

  const sinceArg = since ? buildSinceArg(since) : '';
  const maxCount = Math.min(limit * 3, 300); // over-fetch since one commit may produce multiple entries

  const format = '--format=COMMIT%x1f%H%x1f%aI%x1f%aN%x1f%s';
  const cmd = [
    'log',
    format,
    '--diff-filter=ACDMR',
    '--name-status',
    `--max-count=${maxCount}`,
    sinceArg,
    '--',
    '.codetrellis/',
  ].filter(Boolean).join(' ');

  let raw: string;
  try {
    raw = runGit(cmd, projectRoot);
  } catch {
    // Not a git repo, or no commits touching .codetrellis/ — return empty.
    return [];
  }

  if (!raw.trim()) return [];

  const entries = parseGitLog(raw);
  return entries.slice(0, limit);
}

/**
 * Get a plan's manifest state at a specific commit. Returns the raw
 * YAML/JSON content of plan files as they existed at that commit.
 * Used by the history rail (6.2).
 */
export function getPlanFilesAtCommit(
  projectRoot: string,
  planSlug: string,
  commitHash: string,
): Map<string, string> {
  const planDir = `.codetrellis/plans/${planSlug}`;
  const files = new Map<string, string>();

  // List files in the plan directory at that commit
  let listing: string;
  try {
    listing = runGit(`ls-tree -r --name-only ${commitHash} -- ${planDir}`, projectRoot);
  } catch {
    return files; // commit or dir doesn't exist
  }

  for (const filePath of listing.trim().split('\n').filter(Boolean)) {
    try {
      const content = runGit(`show ${commitHash}:${filePath}`, projectRoot);
      files.set(filePath, content);
    } catch {
      // File may have been deleted in this commit tree — skip
    }
  }

  return files;
}

/**
 * List commits that touched a specific plan's manifest directory.
 * Returns commit metadata in reverse-chronological order.
 */
export function getPlanCommitHistory(
  projectRoot: string,
  planSlug: string,
  options?: { limit?: number; since?: string | number },
): Array<{ hash: string; timestamp: string; author: string; subject: string; agentAttribution?: { agentType: string; model?: string } | null }> {
  const planDir = `.codetrellis/plans/${planSlug}`;
  const maxCount = options?.limit ?? 30;
  const sinceArg = options?.since ? buildSinceArg(options.since) : '';

  const format = '--format=%H%x1f%aI%x1f%aN%x1f%s%x1f%b%x1e';
  const cmd = [
    'log',
    format,
    `--max-count=${maxCount}`,
    sinceArg,
    '--',
    planDir,
  ].filter(Boolean).join(' ');

  let raw: string;
  try {
    raw = runGit(cmd, projectRoot);
  } catch {
    return [];
  }

  if (!raw.trim()) return [];

  const results: Array<{ hash: string; timestamp: string; author: string; subject: string; agentAttribution?: { agentType: string; model?: string } | null }> = [];

  for (const block of raw.split('\x1e').filter(Boolean)) {
    const parts = block.trim().split('\x1f');
    if (parts.length < 4) continue;
    const [hash, timestamp, author, subject, body] = parts;
    const agentAttribution = parseAgentAttribution(body ?? '');
    results.push({ hash, timestamp, author, subject, agentAttribution });
  }

  return results;
}

/**
 * Search plan history for commits where items matching a query were
 * created or substantively edited. Used by decision archaeology (6.3).
 */
export function searchPlanHistory(
  projectRoot: string,
  planSlug: string,
  query: string,
  options?: { since?: string | number; until?: string | number; limit?: number },
): Array<{ hash: string; timestamp: string; author: string; subject: string; matchedFiles: string[] }> {
  const planDir = `.codetrellis/plans/${planSlug}`;
  const maxCount = options?.limit ?? 20;
  const sinceArg = options?.since ? buildSinceArg(options.since) : '';
  const untilArg = options?.until ? buildUntilArg(options.until) : '';

  // Use git log -G to find commits where the query text was added or removed
  const cmd = [
    'log',
    '--format=%H%x1f%aI%x1f%aN%x1f%s%x1e',
    '--name-only',
    `-G${escapeRegex(query)}`,
    `-i`, // case-insensitive
    `--max-count=${maxCount}`,
    sinceArg,
    untilArg,
    '--',
    planDir,
  ].filter(Boolean).join(' ');

  let raw: string;
  try {
    raw = runGit(cmd, projectRoot);
  } catch {
    return [];
  }

  if (!raw.trim()) return [];

  const results: Array<{ hash: string; timestamp: string; author: string; subject: string; matchedFiles: string[] }> = [];

  for (const block of raw.split('\x1e').filter(Boolean)) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    const headerParts = lines[0].split('\x1f');
    if (headerParts.length < 4) continue;
    const [hash, timestamp, author, subject] = headerParts;

    const matchedFiles = lines.slice(1).filter((l) => l.trim() && l.includes('.codetrellis/'));
    results.push({ hash, timestamp, author, subject, matchedFiles });
  }

  return results;
}

// --- Internals ---------------------------------------------------------------

function runGit(argsLine: string, cwd: string): string {
  return execSync(`git ${argsLine}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
}

function buildSinceArg(since: string | number): string {
  const val = typeof since === 'number' ? new Date(since).toISOString() : since;
  return `--since=${val}`;
}

function buildUntilArg(until: string | number): string {
  const val = typeof until === 'number' ? new Date(until).toISOString() : until;
  return `--until=${val}`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse the Co-Authored-By / agent metadata from a commit body.
 * Convention: `agent: <type> · model: <model>` line in the body.
 */
function parseAgentAttribution(body: string): { agentType: string; model?: string } | null {
  const match = body.match(/^agent:\s*(\S+)(?:\s*·\s*model:\s*(.+))?$/m);
  if (!match) return null;
  return {
    agentType: match[1],
    model: match[2]?.trim() || undefined,
  };
}

/**
 * Parse the raw git log output into typed ActivityEntry records.
 * Format: each commit starts with "COMMIT\x1f" followed by fields
 * separated by \x1f, then name-status lines on subsequent lines.
 */
function parseGitLog(raw: string): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  // Split by "COMMIT\x1f" marker — each block is one commit.
  const blocks = raw.split('COMMIT\x1f').filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    // First line has the formatted fields: hash\x1ftimestamp\x1fauthor\x1fsubject
    const headerParts = lines[0].split('\x1f');
    if (headerParts.length < 4) continue;

    const [commitHash, timestamp, author, subject] = headerParts;

    // Remaining lines are name-status entries
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Format: A\tpath or M\tpath or D\tpath or R100\told\tnew
      const tabParts = line.split('\t');
      if (tabParts.length < 2) continue;

      const status = tabParts[0];
      const filePath = tabParts[tabParts.length - 1]; // for renames, take the new path

      const entry = classifyChange(status, filePath, commitHash, timestamp, author, subject);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

/**
 * Given a git diff status and file path within .codetrellis/, classify
 * it into a typed ActivityEntry.
 */
function classifyChange(
  status: string,
  filePath: string,
  commitHash: string,
  timestamp: string,
  author: string,
  subject: string,
): ActivityEntry | null {
  // Strip leading .codetrellis/ for analysis
  const rel = filePath.startsWith('.codetrellis/')
    ? filePath.slice('.codetrellis/'.length)
    : filePath;

  const action = statusToAction(status);

  // plans/<slug>/plan.yaml → plan entity
  const planMatch = rel.match(/^plans\/([^/]+)\/plan\.yaml$/);
  if (planMatch) {
    return {
      timestamp,
      author,
      action,
      entityType: 'plan',
      entityTitle: slugToTitle(planMatch[1]),
      planSlug: planMatch[1],
      commitHash,
      commitSubject: subject,
    };
  }

  // plans/<slug>/items/**/*.yaml → item entity
  const itemMatch = rel.match(/^plans\/([^/]+)\/items\/(.+)\.yaml$/);
  if (itemMatch) {
    const fileName = path.basename(itemMatch[2]);
    const title = fileName === '_self' ? '(parent item)' : slugToTitle(fileName.replace(/^\d+-/, ''));
    return {
      timestamp,
      author,
      action,
      entityType: 'item',
      entityTitle: title,
      planSlug: itemMatch[1],
      commitHash,
      commitSubject: subject,
    };
  }

  // plans/<slug>/channels/*.yaml → channel-event entity
  const channelMatch = rel.match(/^plans\/([^/]+)\/channels\/(.+)\.yaml$/);
  if (channelMatch) {
    return {
      timestamp,
      author,
      action,
      entityType: 'channel-event',
      entityTitle: path.basename(channelMatch[2], '.yaml'),
      planSlug: channelMatch[1],
      commitHash,
      commitSubject: subject,
    };
  }

  // docs/*.md → system-doc entity
  const docMatch = rel.match(/^docs\/(.+)\.md$/);
  if (docMatch) {
    return {
      timestamp,
      author,
      action,
      entityType: 'system-doc',
      entityTitle: slugToTitle(docMatch[1]),
      planSlug: null,
      commitHash,
      commitSubject: subject,
    };
  }

  // config.json → config entity
  if (rel === 'config.json') {
    return {
      timestamp,
      author,
      action,
      entityType: 'config',
      entityTitle: 'Project configuration',
      planSlug: null,
      commitHash,
      commitSubject: subject,
    };
  }

  // Legacy patterns: plans/<slug>/phases/, plans/<slug>/tasks/, plans/<slug>/docs/
  const legacyMatch = rel.match(/^plans\/([^/]+)\/(phases|tasks|docs)\/(.+)$/);
  if (legacyMatch) {
    const title = slugToTitle(path.basename(legacyMatch[3], path.extname(legacyMatch[3])));
    return {
      timestamp,
      author,
      action,
      entityType: 'item',
      entityTitle: title,
      planSlug: legacyMatch[1],
      commitHash,
      commitSubject: subject,
    };
  }

  return null; // Unrecognised file — skip
}

function statusToAction(gitStatus: string): ActivityAction {
  const code = gitStatus.charAt(0);
  switch (code) {
    case 'A': return 'created';
    case 'D': return 'deleted';
    case 'M': return 'updated';
    case 'C': return 'created';
    case 'R': return 'updated'; // rename treated as update
    default: return 'updated';
  }
}

function slugToTitle(slug: string): string {
  // Convert kebab-case or snake_case slug to title case
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
