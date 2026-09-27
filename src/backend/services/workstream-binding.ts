/**
 * Which workstream an agent session belongs to (Phase 32 A1.1).
 *
 * An agent reports the folder it works in (the connector's cwd, or an MCP
 * root). That folder is a CLAIM from the caller, so it is used only to choose
 * among roots CodeTrellis already trusts — the opened projects, any clone the
 * user has included, and each one's live git worktrees — and the session is
 * bound to the root as the user opened it, never to the caller's string.
 * Nothing is read from the reported folder (the Phase 19 rule against taking
 * roots from requests). A folder that matches nothing leaves the session
 * unbound: it still works, it just belongs to no workstream.
 */

import fs from 'node:fs';
import path from 'node:path';
import { listTrustedRoots } from './trusted-roots';
import { listWorktrees } from './worktree-service';

/**
 * The root a reported folder falls inside, or null. Pure apart from `realpath`.
 *
 * Both sides are canonicalised, so `..`, a symlink in the reported path, or a
 * link the user opened a project through all compare by where they really
 * are. The folder may be the root itself or anywhere below it (an agent often
 * runs from a package directory); when roots nest, the deepest wins. The
 * candidate is returned exactly as listed, because rows are stored under the
 * path the user opened.
 */
export function matchWorkstreamRoot(
  reported: string | null | undefined,
  candidates: readonly string[],
  realpath: (p: string) => string = fs.realpathSync.native,
): string | null {
  if (typeof reported !== 'string' || !reported || reported.includes('\0') || !path.isAbsolute(reported)) return null;
  let target: string;
  try {
    target = realpath(reported);
  } catch {
    return null;
  }
  let best: { listed: string; canonical: string } | null = null;
  for (const listed of candidates) {
    let canonical: string;
    try {
      canonical = realpath(listed);
    } catch {
      continue;
    }
    const inside = target === canonical || target.startsWith(canonical.endsWith(path.sep) ? canonical : canonical + path.sep);
    if (inside && (!best || canonical.length > best.canonical.length)) best = { listed, canonical };
  }
  return best?.listed ?? null;
}

/** Every root a session may bind to: trusted roots and their live worktrees. */
export function candidateWorkstreamRoots(): string[] {
  const roots = new Set<string>();
  for (const root of listTrustedRoots()) {
    roots.add(root);
    for (const w of listWorktrees(root)) {
      if (!w.bare && !w.prunable) roots.add(w.path);
    }
  }
  return [...roots];
}

/** The first of several reported folders (MCP roots) that binds, or null. */
export function firstWorkstreamRoot(reported: readonly string[], candidates = candidateWorkstreamRoots()): string | null {
  for (const r of reported) {
    const hit = matchWorkstreamRoot(r, candidates);
    if (hit) return hit;
  }
  return null;
}
