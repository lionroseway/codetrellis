/**
 * Plan conflict resolution service — Phase 6.4 of the CDev target
 * architecture.
 *
 * Detects git merge conflicts in `.codetrellis/plans/` files after a
 * failed merge, parses both sides into typed structures, and provides
 * field-level resolution for structured fields. Free-text fields (spec
 * bodies, descriptions) fall through to the user for manual resolution.
 *
 * The service does NOT auto-resolve — it surfaces conflicts in a
 * structured way so the frontend can present a chooser UI. Resolution
 * is explicit: the caller picks a side (or edits), and this service
 * writes the merged result and stages it for commit.
 */

import { execFileSync } from 'node:child_process';
import { resolveWithin, writeFileWithin } from './confined-fs';
import fs from 'node:fs';
import path from 'node:path';

// --- Types -------------------------------------------------------------------

export type ConflictFieldType = 'structured' | 'freetext';

export interface ConflictField {
  field: string;
  type: ConflictFieldType;
  ours: unknown;
  theirs: unknown;
  /** For structured fields, auto-resolution is possible. */
  autoResolvable: boolean;
}

export interface FileConflict {
  filePath: string; // relative to project root
  planSlug: string | null;
  entityType: 'plan' | 'item' | 'channel-event' | 'config' | 'unknown';
  /** Null when the conflict is too complex for field-level parsing. */
  fields: ConflictField[] | null;
  rawContent: string;
  resolved: boolean;
}

export interface ConflictSummary {
  hasConflicts: boolean;
  files: FileConflict[];
  totalConflicts: number;
  autoResolvable: number;
}

export interface ResolveFieldInput {
  field: string;
  /** 'ours' | 'theirs' | 'custom' */
  pick: 'ours' | 'theirs' | 'custom';
  customValue?: unknown;
}

// --- Public API --------------------------------------------------------------

/**
 * Detect merge conflicts in `.codetrellis/` files. Returns a summary
 * of all conflicted files with parsed field-level details where possible.
 */
export function detectManifestConflicts(projectRoot: string): ConflictSummary {
  // Check if we're in a merge state
  const mergeHeadPath = path.join(projectRoot, '.git', 'MERGE_HEAD');
  if (!fs.existsSync(mergeHeadPath)) {
    return { hasConflicts: false, files: [], totalConflicts: 0, autoResolvable: 0 };
  }

  // Find conflicted files under .codetrellis/
  let conflictedPaths: string[];
  try {
    const raw = runGitArgs(['diff', '--name-only', '--diff-filter=U', '--', '.codetrellis/'], projectRoot);
    conflictedPaths = raw.trim().split('\n').filter(Boolean);
  } catch {
    return { hasConflicts: false, files: [], totalConflicts: 0, autoResolvable: 0 };
  }

  if (conflictedPaths.length === 0) {
    return { hasConflicts: false, files: [], totalConflicts: 0, autoResolvable: 0 };
  }

  const files: FileConflict[] = [];
  let autoResolvable = 0;

  for (const filePath of conflictedPaths) {
    // CONFINE BEFORE TOUCHING THE FILE (Phase 19, finding A1).
  //
  // The reviewer joined projectRoot with ../outside/victim.json, this
  // function MODIFIED the external file, and only then did `git add` fail.
  // The filesystem mutation had already happened — a later git failure does
  // not undo it, which is why "git will reject it anyway" was not a control.
  //
  // Applies to field-level and whole-side resolution alike; both call in
  // here for their path.
  const fullPath = resolveWithin(projectRoot, filePath, 'resolveFileConflict(filePath)');
    if (!fs.existsSync(fullPath)) continue;

    const rawContent = fs.readFileSync(fullPath, 'utf-8');
    const planSlug = extractPlanSlug(filePath);
    const entityType = classifyConflictFile(filePath);

    // Try to parse field-level conflicts for YAML files
    let fields: ConflictField[] | null = null;
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      fields = parseYamlConflictFields(rawContent);
    } else if (filePath.endsWith('.json')) {
      fields = parseJsonConflictFields(rawContent);
    }

    if (fields) {
      autoResolvable += fields.filter((f) => f.autoResolvable).length;
    }

    files.push({
      filePath,
      planSlug,
      entityType,
      fields,
      rawContent,
      resolved: false,
    });
  }

  return {
    hasConflicts: true,
    files,
    totalConflicts: conflictedPaths.length,
    autoResolvable,
  };
}

/**
 * Resolve conflicts in a specific file by providing field-level
 * resolutions. Writes the merged file and stages it for commit.
 */
export function resolveFileConflict(
  projectRoot: string,
  filePath: string,
  resolutions: ResolveFieldInput[],
): { resolved: boolean; error?: string } {
  // CONFINE BEFORE TOUCHING THE FILE (Phase 19, finding A1).
  //
  // The reviewer joined projectRoot with ../outside/victim.json, this
  // function MODIFIED the external file, and only then did `git add` fail.
  // The filesystem mutation had already happened — a later git failure does
  // not undo it, which is why "git will reject it anyway" was not a control.
  //
  // Field-level and whole-side resolution each confine their own path —
  // `resolveFileConflictBySide` does NOT route through this function, so
  // it carries its own `resolveWithin` call rather than inheriting this
  // one. An earlier version of this comment asserted that both came
  // through here, which was never true.
  const fullPath = resolveWithin(projectRoot, filePath, 'resolveFileConflict(filePath)');
  if (!fs.existsSync(fullPath)) {
    return { resolved: false, error: `File not found: ${filePath}` };
  }

  const rawContent = fs.readFileSync(fullPath, 'utf-8');

  // Extract both sides
  const ours = extractConflictSide(rawContent, 'ours');
  const theirs = extractConflictSide(rawContent, 'theirs');

  if (!ours || !theirs) {
    return { resolved: false, error: 'Could not parse conflict markers in file' };
  }

  // Start with "ours" as the base and apply resolutions
  let merged: Record<string, unknown>;
  try {
    const isJson = filePath.endsWith('.json');
    if (isJson) {
      merged = JSON.parse(ours);
    } else {
      const { parse } = require('yaml');
      merged = parse(ours) ?? {};
    }
  } catch {
    return { resolved: false, error: 'Could not parse our side of the conflict' };
  }

  let theirsParsed: Record<string, unknown>;
  try {
    const isJson = filePath.endsWith('.json');
    if (isJson) {
      theirsParsed = JSON.parse(theirs);
    } else {
      const { parse } = require('yaml');
      theirsParsed = parse(theirs) ?? {};
    }
  } catch {
    return { resolved: false, error: 'Could not parse their side of the conflict' };
  }

  for (const res of resolutions) {
    if (res.pick === 'theirs') {
      merged[res.field] = theirsParsed[res.field];
    } else if (res.pick === 'custom' && res.customValue !== undefined) {
      merged[res.field] = res.customValue;
    }
    // 'ours' keeps the default (already in merged)
  }

  // Write the resolved file
  try {
    const isJson = filePath.endsWith('.json');
    if (isJson) {
      // Re-checked immediately before the mutation rather than trusting the
      // resolve above — that gap is the link-swap race.
      writeFileWithin(projectRoot, fullPath, JSON.stringify(merged, null, 2), 'conflict resolve (json)');
    } else {
      const { stringify } = require('yaml');
      writeFileWithin(projectRoot, fullPath, stringify(merged), 'conflict resolve (yaml)');
    }
  } catch (err) {
    return { resolved: false, error: `Failed to write resolved file: ${err}` };
  }

  // Stage the resolved file
  try {
    runGitArgs(['add', '--', filePath], projectRoot);
  } catch (err) {
    return { resolved: false, error: `Failed to stage resolved file: ${err}` };
  }

  return { resolved: true };
}

/**
 * Accept the full "ours" or "theirs" side for a conflicted file.
 * Simpler than field-level resolution — useful when the user just
 * wants to pick one side entirely.
 */
export function resolveFileConflictBySide(
  projectRoot: string,
  filePath: string,
  side: 'ours' | 'theirs',
): { resolved: boolean; error?: string } {
  // CONFINE BEFORE HANDING THE PATH TO GIT (Phase 19).
  //
  // Measured, not assumed: `git checkout -- ../outside/x` fails with
  // "is outside repository", so this was never exploitable. But the
  // control was git's rather than ours, and it produced the wrong
  // shape of answer — a rejection came back as `resolved: false`,
  // indistinguishable from a real failure. This is the same `filePath`
  // the field-level path confines, reached by a different route, so
  // confine it here and let both refuse identically.
  resolveWithin(projectRoot, filePath, 'resolveFileConflictBySide(filePath)');
  if (side !== 'ours' && side !== 'theirs') {
    return { resolved: false, error: `Invalid side: ${String(side)}` };
  }
  try {
    const flag = side === 'ours' ? '--ours' : '--theirs';
    runGitArgs(['checkout', flag, '--', filePath], projectRoot);
    runGitArgs(['add', '--', filePath], projectRoot);
    return { resolved: true };
  } catch (err) {
    return { resolved: false, error: `Failed to resolve by side: ${err}` };
  }
}

// --- Internals ---------------------------------------------------------------

function runGitArgs(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
}

function extractPlanSlug(filePath: string): string | null {
  const match = filePath.match(/\.codetrellis\/plans\/([^/]+)\//);
  return match ? match[1] : null;
}

function classifyConflictFile(filePath: string): FileConflict['entityType'] {
  if (filePath.includes('/plans/') && filePath.endsWith('/plan.yaml')) return 'plan';
  if (filePath.includes('/items/')) return 'item';
  if (filePath.includes('/channels/')) return 'channel-event';
  if (filePath.endsWith('config.json')) return 'config';
  return 'unknown';
}

/**
 * Extract the content from one side of a conflict-marked file.
 *
 *   <<<<<<< HEAD (or ours)
 *   ... our content ...
 *   ||||||| merged common ancestors     <- diff3 / zdiff3 only
 *   ... the base, which belongs to NEITHER side ...
 *   =======
 *   ... their content ...
 *   >>>>>>> branch
 *
 * The base section is the part this used to get wrong. `merge.conflictStyle
 * = diff3` (or `zdiff3`) is a common global git setting, and under it every
 * conflict carries a third block. Without a case for `|||||||`, the marker
 * line AND the whole base block were kept as part of "ours", so our side
 * never parsed as YAML — which made `parseYamlConflictFields` return null
 * for every conflicted manifest, so the field-level resolution UI told the
 * user their file "could not be broken into fields" and the whole feature
 * was unreachable for anyone with that setting.
 *
 * The base is deliberately DISCARDED rather than offered: it is the common
 * ancestor, which is what neither person chose.
 */
export function extractConflictSide(content: string, side: 'ours' | 'theirs'): string | null {
  const lines = content.split('\n');
  const result: string[] = [];
  let inConflict = false;
  let inOurSide = false;
  let inTheirSide = false;

  for (const line of lines) {
    if (line.startsWith('<<<<<<<')) {
      inConflict = true;
      inOurSide = true;
      inTheirSide = false;
      continue;
    }
    if (line.startsWith('|||||||') && inConflict) {
      // Base section begins: from here to `=======` belongs to nobody.
      inOurSide = false;
      inTheirSide = false;
      continue;
    }
    if (line.startsWith('=======') && inConflict) {
      inOurSide = false;
      inTheirSide = true;
      continue;
    }
    if (line.startsWith('>>>>>>>') && inConflict) {
      inConflict = false;
      inOurSide = false;
      inTheirSide = false;
      continue;
    }

    if (!inConflict) {
      result.push(line);
    } else if (side === 'ours' && inOurSide) {
      result.push(line);
    } else if (side === 'theirs' && inTheirSide) {
      result.push(line);
    }
  }

  return result.join('\n') || null;
}

/**
 * Parse conflict markers in a YAML file and extract field-level
 * conflicts. Returns null if the conflict is too complex for
 * field-level parsing (e.g., structural conflicts).
 */
function parseYamlConflictFields(rawContent: string): ConflictField[] | null {
  const ours = extractConflictSide(rawContent, 'ours');
  const theirs = extractConflictSide(rawContent, 'theirs');

  if (!ours || !theirs) return null;

  try {
    const { parse } = require('yaml');
    const oursParsed = parse(ours) as Record<string, unknown>;
    const theirsParsed = parse(theirs) as Record<string, unknown>;

    if (!oursParsed || !theirsParsed) return null;

    return diffFields(oursParsed, theirsParsed);
  } catch {
    return null; // Too complex — fallback to raw view
  }
}

function parseJsonConflictFields(rawContent: string): ConflictField[] | null {
  const ours = extractConflictSide(rawContent, 'ours');
  const theirs = extractConflictSide(rawContent, 'theirs');

  if (!ours || !theirs) return null;

  try {
    const oursParsed = JSON.parse(ours);
    const theirsParsed = JSON.parse(theirs);
    return diffFields(oursParsed, theirsParsed);
  } catch {
    return null;
  }
}

const STRUCTURED_FIELDS = new Set([
  'status', 'assignee', 'assigneeType', 'assigneeModel',
  'visibility', 'visibility_override', 'kind', 'sort_order',
  'sortOrder', 'parentUid', 'parent_uid', 'requires_approval',
  'defaultVisibility', 'attachmentLocation', 'repoRole',
]);

function diffFields(ours: Record<string, unknown>, theirs: Record<string, unknown>): ConflictField[] {
  const allKeys = new Set([...Object.keys(ours), ...Object.keys(theirs)]);
  const fields: ConflictField[] = [];

  for (const key of allKeys) {
    const oVal = ours[key];
    const tVal = theirs[key];

    if (JSON.stringify(oVal) === JSON.stringify(tVal)) continue;

    const isStructured = STRUCTURED_FIELDS.has(key);
    fields.push({
      field: key,
      type: isStructured ? 'structured' : 'freetext',
      ours: oVal,
      theirs: tVal,
      autoResolvable: isStructured,
    });
  }

  return fields;
}
