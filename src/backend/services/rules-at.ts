/**
 * Phase 33 R2 — the rulebook as a commit has it (design §4.1).
 *
 * The gate judges a change with its base's rules, so a pull request cannot
 * remove or loosen the rule it breaks in the same change. This reads the
 * suite files and the config's rules at that commit, through git, from the
 * project's folder (which may sit inside a larger repository).
 */

import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { gitAsync } from './git-env';
import { parseArchitectureRule } from './architecture-rule';
import { combineRules } from './architecture-rules';
import { RULES_DIR, isSuiteName, rulebookFrom } from './rulebook';

export interface RulesAt { rules: ArchitectureRule[]; problems: string[] }

/** The rules at `commit` (a full id), or null when git cannot say (not a commit here, a shallow clone). */
export async function rulesAt(projectRoot: string, commit: string): Promise<RulesAt | null> {
  if (!/^[0-9a-f]{40}$/.test(commit)) return null;
  let listing: string;
  try {
    listing = await gitAsync(projectRoot, ['ls-tree', '--name-only', commit, '--', `${RULES_DIR}/`]);
  } catch {
    return null;
  }
  const files: Array<{ name: string; text: string }> = [];
  for (const rel of listing.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^\.codetrellis\/rules\/([^/]+)\.yaml$/.exec(rel);
    if (!m || !isSuiteName(m[1])) continue;
    try { files.push({ name: m[1], text: await gitAsync(projectRoot, ['show', `${commit}:./${rel}`]) }); } catch { /* removed meanwhile: not there */ }
  }
  const book = rulebookFrom(files);

  // Rules Phase 32 kept in config.json count at the base too, until moved.
  let fromConfig: ArchitectureRule[] = [];
  try {
    const raw = JSON.parse(await gitAsync(projectRoot, ['show', `${commit}:./.codetrellis/config.json`])) as { rules?: unknown };
    if (Array.isArray(raw.rules)) fromConfig = raw.rules.map((r) => parseArchitectureRule(r).rule).filter((r): r is ArchitectureRule => !!r);
  } catch { /* no config at the base, or not JSON: no rules there */ }

  return { rules: combineRules(book.suites.flatMap((s) => s.rules), fromConfig), problems: book.problems };
}
