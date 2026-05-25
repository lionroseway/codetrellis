/**
 * Plan history service — Phase 6.2 of the CDev target architecture.
 *
 * Provides a "time machine" for plans: given a plan slug and a commit
 * hash, reconstructs the plan's state at that point by reading the
 * manifest files from the git tree. Returns typed plan + item
 * structures that the frontend can render read-only.
 *
 * Also supports diffing between two commits to highlight what changed.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

// --- Types -------------------------------------------------------------------

export interface HistoricalPlanState {
  commitHash: string;
  timestamp: string;
  plan: HistoricalPlanMeta | null;
  items: HistoricalItem[];
}

export interface HistoricalPlanMeta {
  uid: string;
  title: string;
  status: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface HistoricalItem {
  uid: string;
  title: string;
  kind: string;
  status?: string;
  parentUid?: string | null;
  body?: string;
  visibility?: string;
  assignee?: string;
  sortOrder?: number;
  [key: string]: unknown;
}

export interface PlanHistoryDiff {
  baseCommit: string;
  headCommit: string;
  added: HistoricalItem[];
  removed: HistoricalItem[];
  modified: Array<{ uid: string; title: string; fields: Array<{ field: string; before: unknown; after: unknown }> }>;
  planMetaChanged: boolean;
}

// --- Public API --------------------------------------------------------------

/**
 * Reconstruct the full plan state at a specific commit hash.
 * Reads plan.yaml and all items from the git tree at that commit.
 */
export function getPlanAtCommit(
  projectRoot: string,
  planSlug: string,
  commitHash: string,
): HistoricalPlanState | null {
  const planDir = `.codetrellis/plans/${planSlug}`;

  // Get commit timestamp
  let timestamp: string;
  try {
    timestamp = runGit(`show -s --format=%aI ${commitHash}`, projectRoot).trim();
  } catch {
    return null;
  }

  // Read plan.yaml
  let planMeta: HistoricalPlanMeta | null = null;
  try {
    const planYaml = runGit(`show ${commitHash}:${planDir}/plan.yaml`, projectRoot);
    const parsed = parseYaml(planYaml) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      planMeta = {
        uid: (parsed.uid as string) ?? '',
        title: (parsed.title as string) ?? planSlug,
        status: (parsed.status as string) ?? 'unknown',
        description: (parsed.description as string) ?? undefined,
        createdAt: (parsed.createdAt as string) ?? undefined,
        updatedAt: (parsed.updatedAt as string) ?? undefined,
      };
    }
  } catch {
    // plan.yaml might not exist at this commit
  }

  // Read all item files
  const items = readItemsAtCommit(projectRoot, planDir, commitHash);

  return { commitHash, timestamp, plan: planMeta, items };
}

/**
 * Compute a diff between two historical states of a plan.
 * Shows what was added, removed, and modified between two commits.
 */
export function diffPlanBetweenCommits(
  projectRoot: string,
  planSlug: string,
  baseCommit: string,
  headCommit: string,
): PlanHistoryDiff {
  const baseState = getPlanAtCommit(projectRoot, planSlug, baseCommit);
  const headState = getPlanAtCommit(projectRoot, planSlug, headCommit);

  const baseItems = new Map((baseState?.items ?? []).map((i) => [i.uid, i]));
  const headItems = new Map((headState?.items ?? []).map((i) => [i.uid, i]));

  const added: HistoricalItem[] = [];
  const removed: HistoricalItem[] = [];
  const modified: PlanHistoryDiff['modified'] = [];

  // Items in head but not base → added
  for (const [uid, item] of headItems) {
    if (!baseItems.has(uid)) {
      added.push(item);
    }
  }

  // Items in base but not head → removed
  for (const [uid, item] of baseItems) {
    if (!headItems.has(uid)) {
      removed.push(item);
    }
  }

  // Items in both → check for modifications
  for (const [uid, headItem] of headItems) {
    const baseItem = baseItems.get(uid);
    if (!baseItem) continue;

    const fields: Array<{ field: string; before: unknown; after: unknown }> = [];
    const checkFields = ['title', 'status', 'kind', 'body', 'visibility', 'assignee', 'parentUid'];
    for (const field of checkFields) {
      const before = (baseItem as Record<string, unknown>)[field];
      const after = (headItem as Record<string, unknown>)[field];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        fields.push({ field, before, after });
      }
    }
    if (fields.length > 0) {
      modified.push({ uid, title: headItem.title, fields });
    }
  }

  // Check plan metadata change
  const planMetaChanged = JSON.stringify(baseState?.plan) !== JSON.stringify(headState?.plan);

  return { baseCommit, headCommit, added, removed, modified, planMetaChanged };
}

// --- Internals ---------------------------------------------------------------

function runGit(argsLine: string, cwd: string): string {
  return execSync(`git ${argsLine}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
}

/**
 * Read all item YAML files from a plan directory at a specific commit.
 * Handles both V2 nested items/ and V1 legacy layouts.
 */
function readItemsAtCommit(
  projectRoot: string,
  planDir: string,
  commitHash: string,
): HistoricalItem[] {
  const items: HistoricalItem[] = [];

  // List all files under the plan dir at this commit
  let listing: string;
  try {
    listing = runGit(`ls-tree -r --name-only ${commitHash} -- ${planDir}`, projectRoot);
  } catch {
    return items;
  }

  for (const filePath of listing.trim().split('\n').filter(Boolean)) {
    // Only process YAML item files
    if (!filePath.endsWith('.yaml') && !filePath.endsWith('.yml')) continue;
    if (filePath.endsWith('/plan.yaml')) continue; // skip plan metadata

    // V2 items: plans/<slug>/items/**/*.yaml
    const isItemFile = filePath.includes('/items/');
    // V1 legacy: plans/<slug>/tasks/*.yaml or plans/<slug>/phases/*.yaml
    const isLegacy = filePath.includes('/tasks/') || filePath.includes('/phases/');
    // Channel events
    const isChannel = filePath.includes('/channels/');

    if (!isItemFile && !isLegacy) continue; // skip channel events for item reconstruction
    if (isChannel) continue;

    try {
      const content = runGit(`show ${commitHash}:${filePath}`, projectRoot);
      const parsed = parseYaml(content) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') continue;

      const item: HistoricalItem = {
        uid: (parsed.uid as string) ?? path.basename(filePath, '.yaml'),
        title: (parsed.title as string) ?? path.basename(filePath, '.yaml'),
        kind: (parsed.kind as string) ?? (isLegacy ? 'action' : 'object'),
        status: (parsed.status as string) ?? undefined,
        parentUid: (parsed.parentUid as string) ?? (parsed.parent_uid as string) ?? null,
        body: (parsed.body as string) ?? undefined,
        visibility: (parsed.visibility as string) ?? 'shared',
        assignee: (parsed.assignee as string) ?? undefined,
        sortOrder: (parsed.sortOrder as number) ?? (parsed.sort_order as number) ?? undefined,
      };

      items.push(item);
    } catch {
      // File can't be read at this commit — skip
    }
  }

  return items;
}
