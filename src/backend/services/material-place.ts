/**
 * Where a stored material path is on this device (Phase 32 C3.4c).
 *
 * A material is stored by its place, never a full path, so every machine
 * reads one stored value as one material and its sha256 says which version:
 *
 *  - inside the project, relative to the project's root (`data/sales.xlsx`),
 *    as it always was;
 *  - inside the project's linked plans folder (C3.4a), as
 *    `plans://<path in the folder>`, resolved against this device's copy.
 *    A team's spreadsheet in its OneDrive folder is one material for Dana and
 *    Sam even though their copies sit at different paths.
 *
 * Nothing here reads a file: callers read through the confined helpers,
 * rooted at the folder this returns.
 */

import path from 'node:path';
import { plansHome } from './plans-home';

export const PLANS_PREFIX = 'plans://';

export function isPlacePath(value: string): boolean {
  return value.startsWith(PLANS_PREFIX);
}

/** A place in the folder that names nothing outside it. */
function safeRel(rel: string): boolean {
  return rel.length > 0 && !path.isAbsolute(rel) && !/^[a-z]:/i.test(rel)
    && !rel.split(/[\\/]/).some((seg) => seg === '..' || seg === '');
}

/**
 * The folder and the path in it for a stored material path, on this device;
 * null for one this device cannot place (a plans folder not linked here, an
 * absolute path or a URL, a path that climbs).
 */
export function locateStored(value: string, projectRoot: string): { root: string; rel: string } | null {
  if (typeof value !== 'string' || !value) return null;
  if (isPlacePath(value)) {
    const rel = value.slice(PLANS_PREFIX.length);
    const home = plansHome(projectRoot);
    if (!home || !safeRel(rel)) return null;
    return { root: home, rel };
  }
  if (path.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return { root: projectRoot, rel: value };
}

/**
 * The stored form of a file on this device: project-relative when it is in
 * the project, `plans://…` when it is in the linked plans folder, else null.
 */
export function placeOf(absPath: string, projectRoot: string): string | null {
  const inside = (root: string) => {
    const rel = path.relative(root, absPath);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : null;
  };
  const inProject = inside(projectRoot);
  if (inProject) return inProject;
  const home = plansHome(projectRoot);
  if (!home || home === projectRoot) return null;
  const inFolder = inside(home);
  return inFolder ? `${PLANS_PREFIX}${inFolder}` : null;
}
