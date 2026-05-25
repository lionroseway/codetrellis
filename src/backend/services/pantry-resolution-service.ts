/**
 * Pantry resolution service — Phase 7.1 of the CDev target architecture.
 *
 * When an external contributor works from a fork or scoped branch, they
 * may encounter references to team-private pantry content (screenshots,
 * transcripts, internal docs). This service checks whether referenced
 * files exist locally and returns a resolution status so the frontend
 * can show styled placeholders instead of broken references.
 *
 * Resolution statuses:
 *   - resolved: the file exists locally, content is accessible
 *   - external: the file is missing — show a placeholder with attribution
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Types -------------------------------------------------------------------

export type ResolutionStatus = 'resolved' | 'external';

export interface PantryResolution {
  reference: string;
  status: ResolutionStatus;
  absolutePath?: string;
  /** Human-readable reason when status is 'external'. */
  reason?: string;
}

export interface PantryScanResult {
  total: number;
  resolved: number;
  external: number;
  externals: PantryResolution[];
}

// --- Public API --------------------------------------------------------------

/**
 * Resolve a batch of pantry references. Returns a resolution for each.
 */
export function resolveReferences(
  references: string[],
  projectRoot: string,
): PantryResolution[] {
  return references.map((ref) => resolveReference(ref, projectRoot));
}

/**
 * Resolve a single pantry reference to check if the file exists locally.
 */
export function resolveReference(
  reference: string,
  projectRoot: string,
): PantryResolution {
  if (!reference || typeof reference !== 'string') {
    return { reference, status: 'external', reason: 'Invalid reference' };
  }

  // URL references — always accessible (no local file needed)
  if (reference.startsWith('http://') || reference.startsWith('https://')) {
    return { reference, status: 'resolved' };
  }

  // userdata:// paths — stored in user's home data directory
  if (reference.startsWith('userdata://')) {
    const userDataDir = process.env.CODETRELLIS_DATA_DIR ?? path.join(os.homedir(), '.codetrellis');
    const rel = reference.replace(/^userdata:\/\//, '');
    const absPath = path.resolve(userDataDir, rel);

    // Boundary check — prevent traversal
    if (!absPath.startsWith(path.resolve(userDataDir) + path.sep)) {
      return { reference, status: 'external', reason: 'Invalid path traversal' };
    }

    if (fs.existsSync(absPath)) {
      return { reference, status: 'resolved', absolutePath: absPath };
    }
    return {
      reference,
      status: 'external',
      reason: 'User-local content — not available outside the original workspace',
    };
  }

  // Project-relative paths (e.g., .codetrellis/attachments/...)
  if (!path.isAbsolute(reference)) {
    const absPath = path.resolve(projectRoot, reference);

    // Boundary check
    const normRoot = path.resolve(projectRoot);
    if (!absPath.startsWith(normRoot + path.sep) && absPath !== normRoot) {
      return { reference, status: 'external', reason: 'Invalid path traversal' };
    }

    if (fs.existsSync(absPath)) {
      return { reference, status: 'resolved', absolutePath: absPath };
    }
    return {
      reference,
      status: 'external',
      reason: 'Team-only content — request access from the item author',
    };
  }

  // Absolute paths — check existence under user's home
  const home = os.homedir();
  if (reference.startsWith(home + path.sep)) {
    if (fs.existsSync(reference)) {
      return { reference, status: 'resolved', absolutePath: reference };
    }
    return {
      reference,
      status: 'external',
      reason: 'Referenced file not found on this machine',
    };
  }

  // Outside home — deny
  return {
    reference,
    status: 'external',
    reason: 'Referenced file not accessible from this workspace',
  };
}

/**
 * Scan all items in a plan's manifest directory for attachment references,
 * then resolve each. Used to show resolution badges on plan cards.
 */
export function scanPlanReferences(
  projectRoot: string,
  planSlug: string,
): PantryScanResult {
  const planDir = path.join(projectRoot, '.codetrellis', 'plans', planSlug);

  if (!fs.existsSync(planDir)) {
    return { total: 0, resolved: 0, external: 0, externals: [] };
  }

  const references = extractReferencesFromDir(planDir);
  const resolutions = resolveReferences(references, projectRoot);

  const externals = resolutions.filter((r) => r.status === 'external');
  return {
    total: resolutions.length,
    resolved: resolutions.length - externals.length,
    external: externals.length,
    externals,
  };
}

// --- Internals ---------------------------------------------------------------

/**
 * Recursively walk a directory and extract attachment `value` fields
 * from all YAML files.
 */
function extractReferencesFromDir(dir: string): string[] {
  const refs: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return refs;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      refs.push(...extractReferencesFromDir(fullPath));
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      refs.push(...extractReferencesFromYaml(fullPath));
    }
  }

  return refs;
}

/**
 * Extract attachment value references from a YAML file.
 * Looks for lines matching the `value:` field under `attachments:`.
 * Uses a lightweight regex approach to avoid parsing full YAML just
 * for reference extraction.
 */
function extractReferencesFromYaml(filePath: string): string[] {
  const refs: string[] = [];

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return refs;
  }

  // Match value fields in attachment blocks:
  //   - value: ".codetrellis/attachments/..."
  //   - value: "userdata://attachments/..."
  //   - value: "https://..."
  const valueRegex = /^\s+value:\s*["']?([^"'\n]+)["']?\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = valueRegex.exec(content)) !== null) {
    const val = match[1].trim();
    if (val) refs.push(val);
  }

  return refs;
}
