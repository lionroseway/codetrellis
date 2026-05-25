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

import { execFileSync } from 'node:child_process';
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

  const maxCount = Math.min(limit * 3, 300); // over-fetch since one commit may produce multiple entries

  // %b = body (for agent attribution), %x1e = record separator to
  // delimit the header (including multi-line body) from name-status.
  const args = [
    'log',
    '--format=COMMIT%x1f%H%x1f%aI%x1f%aN%x1f%s%x1f%b%x1e',
    '--diff-filter=ACDMR',
    '--name-status',
    `--max-count=${maxCount}`,
    ...(since ? [buildSinceArg(since)] : []),
    '--',
    '.codetrellis/',
  ];

  let raw: string;
  try {
    raw = runGitArgs(args, projectRoot);
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
    listing = runGitArgs(['ls-tree', '-r', '--name-only', commitHash, '--', planDir], projectRoot);
  } catch {
    return files; // commit or dir doesn't exist
  }

  for (const filePath of listing.trim().split('\n').filter(Boolean)) {
    try {
      const content = runGitArgs(['show', `${commitHash}:${filePath}`], projectRoot);
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

  const args = [
    'log',
    '--format=%H%x1f%aI%x1f%aN%x1f%s%x1f%b%x1e',
    `--max-count=${maxCount}`,
    ...(options?.since ? [buildSinceArg(options.since)] : []),
    '--',
    planDir,
  ];

  let raw: string;
  try {
    raw = runGitArgs(args, projectRoot);
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

  // Use git log -G to find commits where the query text was added or removed.
  // execFileSync passes each arg directly — no shell, so query can't inject.
  const args = [
    'log',
    '--format=%H%x1f%aI%x1f%aN%x1f%s%x1e',
    '--name-only',
    `-G${escapeRegex(query)}`,
    '-i', // case-insensitive
    `--max-count=${maxCount}`,
    ...(options?.since ? [buildSinceArg(options.since)] : []),
    ...(options?.until ? [buildUntilArg(options.until)] : []),
    '--',
    planDir,
  ];

  let raw: string;
  try {
    raw = runGitArgs(args, projectRoot);
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

/**
 * Run git with an explicit args array via execFileSync — no shell,
 * so user-supplied strings (query, planSlug, commitHash) cannot
 * inject shell commands.
 */
function runGitArgs(args: string[], cwd: string): string {
  return execFileSync('git', args, {
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
 *
 * Format: COMMIT\x1f<hash>\x1f<ts>\x1f<author>\x1f<subject>\x1f<body>\x1e
 *         <name-status lines>
 *
 * Split on COMMIT\x1f to isolate per-commit blocks, then split on \x1e
 * to separate the header (including multi-line body) from name-status.
 */
function parseGitLog(raw: string): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  // Split by "COMMIT\x1f" marker — each block is one commit.
  const blocks = raw.split('COMMIT\x1f').filter((b) => b.trim());

  for (const block of blocks) {
    // Split on \x1e to separate header fields from name-status
    const rsSplit = block.split('\x1e');
    const headerStr = rsSplit[0] ?? '';
    const nameStatusStr = rsSplit.slice(1).join('\x1e'); // remainder

    const headerParts = headerStr.split('\x1f');
    if (headerParts.length < 4) continue;

    const [commitHash, timestamp, author, subject, ...bodyParts] = headerParts;
    const body = bodyParts.join('\x1f'); // re-join in case body contained \x1f
    const agentAttribution = parseAgentAttribution(body);

    // Name-status lines follow the \x1e marker
    const nameStatusLines = nameStatusStr.split('\n');
    for (const line of nameStatusLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Format: A\tpath or M\tpath or D\tpath or R100\told\tnew
      const tabParts = trimmed.split('\t');
      if (tabParts.length < 2) continue;

      const status = tabParts[0];
      const filePath = tabParts[tabParts.length - 1]; // for renames, take the new path

      const entry = classifyChange(status, filePath, commitHash, timestamp, author, subject, agentAttribution);
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
  agentAttribution?: { agentType: string; model?: string } | null,
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
      agentAttribution: agentAttribution ?? null,
      action,
      entityType: 'plan',
      entityTitle: planSlugToTitle(planMatch[1]),
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
      agentAttribution: agentAttribution ?? null,
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
      agentAttribution: agentAttribution ?? null,
      action,
      entityType: 'channel-event',
      entityTitle: 'Channel event',
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
      agentAttribution: agentAttribution ?? null,
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
      agentAttribution: agentAttribution ?? null,
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
      agentAttribution: agentAttribution ?? null,
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

/**
 * Convert a plan slug (e.g. "release-rollout-plan-de260d59") to a
 * clean title by stripping the trailing uid-prefix before titleizing.
 */
function planSlugToTitle(planSlug: string): string {
  // Plan slug format: <title-slug>-<uid-first-8-chars>
  // Strip the last -<8hex> suffix if it looks like a uid prefix
  const stripped = planSlug.replace(/-[0-9a-f]{8}$/, '');
  return slugToTitle(stripped);
}
