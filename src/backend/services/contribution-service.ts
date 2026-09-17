/**
 * Contribution service — Phase 7.2 + 7.3 of the CDev target architecture.
 *
 * Manages the `.codetrellis/contributions/<branch>/` staging area for
 * external contributor workflows. Contributors "promote" local items
 * and attachments into the staging area, which travels as part of their
 * PR. The team then "accepts" contributed content into the plan manifest.
 *
 * Also handles preparing filtered branches for contractors (7.3):
 * the team creates a branch with only the plan content they want to
 * share, omitting private items, team-only attachments, and internal
 * comments.
 */

import { execFileSync } from 'node:child_process';
import { removeWithin, resolveWithin, ConfinementError } from './confined-fs';

/**
 * Branch names become directory names under `.codetrellis/contributions/`.
 *
 * Phase 19, finding 12. A branch name is not a safe path component: git
 * permits `/`, and the value reaches a RECURSIVE DELETE. Anything that can
 * influence the checked-out branch could therefore choose what gets removed.
 *
 * Slashes are kept — `dev/saif` is an ordinary branch and nests harmlessly —
 * but `..` segments and absolute forms are refused, and the delete itself is
 * confined below.
 */
function assertSafeBranchSegment(branch: string): string {
  if (typeof branch !== 'string' || branch.length === 0 || branch.length > 255) {
    throw new ConfinementError('Invalid branch name for a contributions directory');
  }
  if (branch.split(/[\\/]/).some((seg) => seg === '..' || seg === '.' || seg === '')) {
    throw new ConfinementError(
      `Branch name "${branch}" contains a path segment that cannot be used as a directory`,
    );
  }
  if (path.isAbsolute(branch)) {
    throw new ConfinementError(`Branch name "${branch}" looks like an absolute path`);
  }
  return branch;
}
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// --- Types -------------------------------------------------------------------

export interface Contribution {
  uid: string;
  branch: string;
  kind: 'item' | 'attachment';
  title: string;
  description?: string;
  filePath: string; // relative to project root
  promotedAt: string; // ISO
}

export interface ContributionSummary {
  branch: string;
  total: number;
  items: Contribution[];
}

export interface AcceptResult {
  accepted: number;
  planSlug: string;
  errors: string[];
}

export interface PrepareContributorBranchResult {
  branch: string;
  planSlug: string;
  itemCount: number;
  commitHash: string;
}

// --- Public API: Promote (7.2) -----------------------------------------------

/**
 * Promote an item to the contributions staging area. Serializes the
 * item YAML into `.codetrellis/contributions/<branch>/items/<slug>.yaml`.
 */
export function promoteItemToContribution(
  projectRoot: string,
  itemData: {
    uid: string;
    title: string;
    kind: string;
    status?: string;
    body?: string;
    description?: string;
    attachments?: Array<{ uid: string; kind: string; value: string; label?: string }>;
  },
): Contribution {
  const branch = getCurrentBranch(projectRoot);
  const contribDir = path.join(projectRoot, '.codetrellis', 'contributions', assertSafeBranchSegment(branch), 'items');
  fs.mkdirSync(contribDir, { recursive: true });

  // If re-promoting with a changed title, remove the old file to prevent orphans.
  removeOldPromotionFile(contribDir, itemData.uid);

  const slug = slugify(itemData.title);
  const fileName = `${slug}.yaml`;
  const filePath = path.join(contribDir, fileName);
  const relPath = path.relative(projectRoot, filePath);

  const yamlContent = stringifyYaml({
    uid: itemData.uid,
    title: itemData.title,
    kind: itemData.kind,
    status: itemData.status ?? 'pending',
    body: itemData.body ?? null,
    promotedAt: new Date().toISOString(),
    ...(itemData.attachments?.length ? { attachments: itemData.attachments } : {}),
  });

  fs.writeFileSync(filePath, yamlContent, 'utf-8');

  // Also write an index.json for quick listing
  updateContributionIndex(projectRoot, branch, {
    uid: itemData.uid,
    branch,
    kind: 'item',
    title: itemData.title,
    description: itemData.description,
    filePath: relPath,
    promotedAt: new Date().toISOString(),
  });

  return {
    uid: itemData.uid,
    branch,
    kind: 'item',
    title: itemData.title,
    description: itemData.description,
    filePath: relPath,
    promotedAt: new Date().toISOString(),
  };
}

/**
 * Promote an attachment file to the contributions staging area.
 * Copies the attachment bytes and writes metadata.
 */
export function promoteAttachmentToContribution(
  projectRoot: string,
  attachmentData: {
    uid: string;
    label: string;
    sourcePath: string; // absolute path to the file
    contentType?: string;
    description?: string;
  },
): Contribution {
  const branch = getCurrentBranch(projectRoot);
  const contribDir = path.join(projectRoot, '.codetrellis', 'contributions', assertSafeBranchSegment(branch), 'attachments');
  fs.mkdirSync(contribDir, { recursive: true });

  // Copy the file
  const ext = path.extname(attachmentData.sourcePath) || '.bin';
  const destName = `${attachmentData.uid}${ext}`;
  const destPath = path.join(contribDir, destName);
  const relPath = path.relative(projectRoot, destPath);

  if (fs.existsSync(attachmentData.sourcePath)) {
    fs.copyFileSync(attachmentData.sourcePath, destPath);
  }

  // Write metadata sidecar
  const metaPath = path.join(contribDir, `${attachmentData.uid}.meta.yaml`);
  fs.writeFileSync(metaPath, stringifyYaml({
    uid: attachmentData.uid,
    label: attachmentData.label,
    contentType: attachmentData.contentType ?? 'application/octet-stream',
    fileName: destName,
    promotedAt: new Date().toISOString(),
  }), 'utf-8');

  updateContributionIndex(projectRoot, branch, {
    uid: attachmentData.uid,
    branch,
    kind: 'attachment',
    title: attachmentData.label,
    description: attachmentData.description,
    filePath: relPath,
    promotedAt: new Date().toISOString(),
  });

  return {
    uid: attachmentData.uid,
    branch,
    kind: 'attachment',
    title: attachmentData.label,
    description: attachmentData.description,
    filePath: relPath,
    promotedAt: new Date().toISOString(),
  };
}

/**
 * List all contributions staged on the current branch.
 */
export function listContributions(projectRoot: string): ContributionSummary {
  const branch = getCurrentBranch(projectRoot);
  return listContributionsForBranch(projectRoot, branch);
}

/**
 * List contributions for a specific branch.
 */
export function listContributionsForBranch(projectRoot: string, branch: string): ContributionSummary {
  const indexPath = path.join(projectRoot, '.codetrellis', 'contributions', branch, 'index.json');

  if (!fs.existsSync(indexPath)) {
    return { branch, total: 0, items: [] };
  }

  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const items: Contribution[] = JSON.parse(raw);
    return { branch, total: items.length, items };
  } catch {
    return { branch, total: 0, items: [] };
  }
}

// --- Public API: Accept (7.2) ------------------------------------------------

/**
 * Accept contributed items from a branch's staging area into a plan's
 * manifest. Moves items from contributions/ into plans/<slug>/items/.
 *
 * Called by the receiving team after reviewing a PR.
 */
export function acceptContributions(
  projectRoot: string,
  branch: string,
  planSlug: string,
): AcceptResult {
  // VALIDATE BEFORE BUILDING THE PATH (Phase 19, finding 12).
  //
  // The delete at the end of this function is confined, which was the part
  // the review named — but the READS above it were not. A branch of
  // `../../../elsewhere` made this enumerate that directory's `items/` and
  // `attachments/`, copy what it found into the project, and only then be
  // refused at the delete. Copying a file in is a read of it.
  //
  // The two sibling functions already validated here; this one did not, which
  // is the usual shape of a partial fix.
  const contribDir = path.join(
    projectRoot, '.codetrellis', 'contributions', assertSafeBranchSegment(branch),
  );
  const planItemsDir = path.join(projectRoot, '.codetrellis', 'plans', planSlug, 'items');
  const errors: string[] = [];
  let accepted = 0;

  if (!fs.existsSync(contribDir)) {
    return { accepted: 0, planSlug, errors: ['No contributions found for this branch'] };
  }

  fs.mkdirSync(planItemsDir, { recursive: true });

  // Process item contributions
  const itemsDir = path.join(contribDir, 'items');
  if (fs.existsSync(itemsDir)) {
    const files = fs.readdirSync(itemsDir).filter((f) => f.endsWith('.yaml'));
    const existingCount = fs.readdirSync(planItemsDir).filter((f) => f.endsWith('.yaml')).length;

    for (let i = 0; i < files.length; i++) {
      try {
        const src = path.join(itemsDir, files[i]);
        const content = fs.readFileSync(src, 'utf-8');
        const parsed = parseYaml(content) as Record<string, unknown>;

        // Remove the promotedAt field (contribution metadata)
        delete parsed.promotedAt;

        // Write to the plan items directory with proper numbering
        const sortNum = String(existingCount + i + 1).padStart(3, '0');
        const slug = slugify((parsed.title as string) ?? files[i].replace('.yaml', ''));
        const destName = `${sortNum}-${slug}.yaml`;
        const destPath = path.join(planItemsDir, destName);

        fs.writeFileSync(destPath, stringifyYaml(parsed), 'utf-8');
        accepted++;
      } catch (err) {
        errors.push(`Failed to accept ${files[i]}: ${err}`);
      }
    }
  }

  // Process attachment contributions — copy to plan attachments
  const attDir = path.join(contribDir, 'attachments');
  if (fs.existsSync(attDir)) {
    const planAttDir = path.join(projectRoot, '.codetrellis', 'attachments');
    fs.mkdirSync(planAttDir, { recursive: true });

    const files = fs.readdirSync(attDir).filter((f) => !f.endsWith('.meta.yaml'));
    for (const file of files) {
      try {
        const src = path.join(attDir, file);
        const dest = path.join(planAttDir, file);
        fs.copyFileSync(src, dest);
        accepted++;
      } catch (err) {
        errors.push(`Failed to accept attachment ${file}: ${err}`);
      }
    }
  }

  // RECURSIVE DELETE, CONFINED (Phase 19, finding 12).
  //
  // This is the least forgiving operation in the service, and its path was
  // built from a git branch name. removeWithin re-canonicalises, refuses to
  // follow a link out of the project, and refuses to delete the containment
  // root itself — so the worst case is deleting the wrong directory INSIDE
  // `.codetrellis/contributions`, not outside the project.
  try {
    removeWithin(
      path.join(projectRoot, '.codetrellis', 'contributions'),
      contribDir,
      { recursive: true },
      'contributions cleanup',
    );
  } catch (err) {
    if (!(err instanceof ConfinementError)) {
      // ENOENT is normal — nothing to clean up.
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw err;
    } else {
      throw err;
    }
  }

  return { accepted, planSlug, errors };
}

// --- Public API: Prepare contributor branch (7.3) ----------------------------

/**
 * Create a filtered branch containing only the plan content the team
 * wants to share with an external contributor. Omits:
 *   - Items with visibility='local'
 *   - Team-only attachments (userdata:// references)
 *   - Private comments
 *
 * The resulting branch can be pushed to a remote for the contributor
 * to fork from.
 */
export function prepareContributorBranch(
  projectRoot: string,
  planSlug: string,
  branchName: string,
  options?: { includeItems?: string[] },
): PrepareContributorBranchResult {
  const planDir = path.join(projectRoot, '.codetrellis', 'plans', planSlug);

  if (!fs.existsSync(planDir)) {
    throw new Error(`Plan directory not found: ${planDir}`);
  }

  // Read the plan.yaml
  const planYamlPath = path.join(planDir, 'plan.yaml');
  if (!fs.existsSync(planYamlPath)) {
    throw new Error(`plan.yaml not found for ${planSlug}`);
  }

  const planYaml = fs.readFileSync(planYamlPath, 'utf-8');
  const planMeta = parseYaml(planYaml) as Record<string, unknown>;

  // Read all items
  const itemsDir = path.join(planDir, 'items');
  const items = readItemsRecursive(itemsDir);

  // Filter: only shared items (or explicitly included items)
  const filteredItems = items.filter((item) => {
    if (options?.includeItems?.length) {
      return options.includeItems.includes(item.uid as string);
    }
    return (item.visibility ?? 'shared') === 'shared';
  });

  // Strip private content from items
  const cleanedItems = filteredItems.map((item) => stripPrivateContent(item));

  // Create the branch
  runGitArgs(['checkout', '-b', branchName], projectRoot);

  try {
    // Write the filtered manifest
    const branchPlanDir = path.join(projectRoot, '.codetrellis', 'plans', planSlug);
    const branchItemsDir = path.join(branchPlanDir, 'items');

    // Clear existing items (we'll write only the filtered set)
    if (fs.existsSync(branchItemsDir)) {
      fs.rmSync(branchItemsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(branchItemsDir, { recursive: true });

    // Write plan.yaml (stripped of internal fields)
    const cleanPlan = { ...planMeta };
    delete cleanPlan.internalNotes;
    fs.writeFileSync(planYamlPath, stringifyYaml(cleanPlan), 'utf-8');

    // Write filtered items
    for (let i = 0; i < cleanedItems.length; i++) {
      const item = cleanedItems[i];
      const sortNum = String(i + 1).padStart(3, '0');
      const slug = slugify((item.title as string) ?? 'item');
      const fileName = `${sortNum}-${slug}.yaml`;
      fs.writeFileSync(
        path.join(branchItemsDir, fileName),
        stringifyYaml(item),
        'utf-8',
      );
    }

    // Remove contributions directory if it exists (team-only)
    const contribDir = path.join(projectRoot, '.codetrellis', 'contributions');
    if (fs.existsSync(contribDir)) {
      fs.rmSync(contribDir, { recursive: true, force: true });
    }

    // Stage and commit
    runGitArgs(['add', '.codetrellis/'], projectRoot);
    const message = `[cdev] prepare contributor branch: ${planSlug}\n\nFiltered to ${cleanedItems.length} shared items for external collaboration.`;
    runGitArgs(['commit', '-m', message, '--allow-empty'], projectRoot);

    // Get the commit hash
    const sha = runGitArgs(['rev-parse', 'HEAD'], projectRoot).trim();

    // Switch back to previous branch
    runGitArgs(['checkout', '-'], projectRoot);

    return {
      branch: branchName,
      planSlug,
      itemCount: cleanedItems.length,
      commitHash: sha,
    };
  } catch (err) {
    // On failure, try to switch back and delete the branch
    try {
      runGitArgs(['checkout', '-'], projectRoot);
      runGitArgs(['branch', '-D', branchName], projectRoot);
    } catch { /* best effort */ }
    throw err;
  }
}

// --- Internals ---------------------------------------------------------------

function getCurrentBranch(projectRoot: string): string {
  try {
    return runGitArgs(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot).trim();
  } catch {
    return 'detached';
  }
}

function runGitArgs(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
}

/**
 * Remove the old YAML file for a re-promoted item (different title → different slug).
 * Scans existing files for the matching uid and removes it.
 */
function removeOldPromotionFile(contribDir: string, uid: string): void {
  if (!fs.existsSync(contribDir)) return;

  const files = fs.readdirSync(contribDir).filter((f) => f.endsWith('.yaml'));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(contribDir, file), 'utf-8');
      // Quick check — look for the uid in the file
      if (content.includes(`uid: ${uid}`) || content.includes(`uid: "${uid}"`)) {
        fs.unlinkSync(path.join(contribDir, file));
        return;
      }
    } catch { /* skip */ }
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Maintain a contributions index.json for quick listing.
 */
function updateContributionIndex(
  projectRoot: string,
  branch: string,
  contribution: Contribution,
): void {
  const indexPath = path.join(projectRoot, '.codetrellis', 'contributions', branch, 'index.json');
  let items: Contribution[] = [];

  if (fs.existsSync(indexPath)) {
    try {
      items = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch { /* start fresh */ }
  }

  // Upsert by uid
  const idx = items.findIndex((i) => i.uid === contribution.uid);
  if (idx >= 0) {
    items[idx] = contribution;
  } else {
    items.push(contribution);
  }

  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(items, null, 2), 'utf-8');
}

/**
 * Read item YAML files recursively from a directory.
 */
function readItemsRecursive(dir: string): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];

  if (!fs.existsSync(dir)) return items;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Check for _self.yaml (parent item)
      const selfPath = path.join(fullPath, '_self.yaml');
      if (fs.existsSync(selfPath)) {
        try {
          const parsed = parseYaml(fs.readFileSync(selfPath, 'utf-8')) as Record<string, unknown>;
          if (parsed) items.push(parsed);
        } catch { /* skip */ }
      }
      // Recurse for children
      items.push(...readItemsRecursive(fullPath));
    } else if (entry.name.endsWith('.yaml') && entry.name !== '_self.yaml') {
      try {
        const parsed = parseYaml(fs.readFileSync(fullPath, 'utf-8')) as Record<string, unknown>;
        if (parsed) items.push(parsed);
      } catch { /* skip */ }
    }
  }

  return items;
}

/**
 * Strip private/team-only content from an item before sharing with
 * external contributors:
 *   - Remove attachments with userdata:// references
 *   - Remove internal comments (marked as visibility: local)
 *   - Remove internal metadata fields
 */
function stripPrivateContent(item: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...item };

  // Remove visibility field (external contributors don't need to see it)
  delete cleaned.visibility;
  delete cleaned.visibility_override;
  delete cleaned.overrideParentVisibility;

  // Filter attachments — remove userdata:// references
  if (Array.isArray(cleaned.attachments)) {
    cleaned.attachments = (cleaned.attachments as Array<Record<string, unknown>>).filter(
      (att) => {
        const value = att.value as string;
        return !value?.startsWith('userdata://');
      },
    );
    if ((cleaned.attachments as unknown[]).length === 0) {
      delete cleaned.attachments;
    }
  }

  // Filter comments — remove those marked as local/private
  if (Array.isArray(cleaned.comments)) {
    cleaned.comments = (cleaned.comments as Array<Record<string, unknown>>).filter(
      (c) => (c.visibility ?? 'shared') === 'shared',
    );
    if ((cleaned.comments as unknown[]).length === 0) {
      delete cleaned.comments;
    }
  }

  return cleaned;
}
