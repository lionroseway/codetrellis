/**
 * This work's changed files (Phase 32 D1.4): since the base's merge base,
 * plus what is not committed yet, leaving out CodeTrellis's own files.
 * `codetrellis check` and the Checks view (Phase 33 G9) both use it, so they
 * check the same files. The base is the one given, else the pull request's
 * base in GitHub Actions (GITHUB_BASE_REF), else origin's default branch.
 */

import { execFileSync } from 'node:child_process';

const git = (root: string, args: string[]): string | null => {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};
const lines = (s: string | null) => (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

/** The ref this work branched from, by the order above, or null. */
export function baseRef(root: string, given: string | undefined, env: NodeJS.ProcessEnv): string | null {
  const exists = (ref: string) => git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;
  if (given) return exists(given) ? given : null;
  if (env.GITHUB_BASE_REF && exists(`origin/${env.GITHUB_BASE_REF}`)) return `origin/${env.GITHUB_BASE_REF}`;
  const head = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])?.trim();
  if (head && exists(head)) return head;
  for (const ref of ['origin/main', 'origin/master']) if (exists(ref)) return ref;
  return null;
}

export interface Changed {
  base: string | null;
  since: string | null;
  files: string[];
  /** The rules changed too (a suite file, or the config that held rules before Phase 33 R1): checked even with no other file. */
  rulebook: boolean;
}

/** Files this work changed: since the base's merge base, and not committed yet. */
export function changedFiles(root: string, given: string | undefined, env: NodeJS.ProcessEnv): Changed {
  if (given && baseRef(root, given, env) === null) throw new Error(`${given} is not a commit in this repository (a shallow clone? use fetch-depth: 0)`);
  const base = baseRef(root, given, env);
  const since = base ? git(root, ['merge-base', base, 'HEAD'])?.trim() || null : null;
  const out = new Set<string>([
    ...(since ? lines(git(root, ['diff', '--name-only', since, 'HEAD'])) : []),
    ...lines(git(root, ['diff', '--name-only', 'HEAD'])),
    ...lines(git(root, ['ls-files', '--others', '--exclude-standard'])),
  ]);
  const files = [...out].filter((f) => !f.startsWith('.codetrellis/')).sort();
  const rulebook = [...out].some((f) => f.startsWith('.codetrellis/rules/') || f === '.codetrellis/config.json');
  return { base, since, files, rulebook };
}
