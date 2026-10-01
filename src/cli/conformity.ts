/**
 * The conformity gate for a job or a hook (Phase 32 D1.4): which files this
 * work changed, and whether the change conforms to what the plan and the
 * docs say (`check_changes`). `codetrellis check` with no path, and
 * `codetrellis status`, exit 3 when it does not, so a pipeline can fail on it.
 *
 * "This work" is the branch since it left its base, plus whatever is not
 * committed yet. The base is `--base`, else the pull request's base in
 * GitHub Actions (`GITHUB_BASE_REF`), else the remote's default branch, else
 * none (only what is not committed). CodeTrellis's own files are left out:
 * the plan changing is not a change to conform.
 */

import { execFileSync } from 'node:child_process';
import type { Agent } from './agent';

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

export interface Changed { base: string | null; since: string | null; files: string[] }

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
  return { base, since, files };
}

export interface Gate {
  ok: boolean;
  says: string[];
  files: number;
  base: string | null;
  breakpoints: unknown[];
  tests: unknown[];
  criteria: unknown[];
  docs: unknown[];
}

/** `check_changes` over this work's files, as the agent. */
export async function gate(agent: Agent, root: string, changed: Changed): Promise<Gate | { error: string }> {
  if (changed.files.length === 0) return { ok: true, says: [], files: 0, base: changed.base, breakpoints: [], tests: [], criteria: [], docs: [] };
  const a = await agent.call('check_changes', { paths: changed.files.slice(0, 500), project_path: root });
  if (a.isError) return { error: a.text };
  const j = (a.json ?? {}) as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(j[k]) ? j[k] as unknown[] : []);
  return {
    ok: j.ok === true, says: list('says') as string[], files: changed.files.length, base: changed.base,
    breakpoints: list('breakpoints'), tests: list('tests'), criteria: list('criteria'), docs: list('docs'),
  };
}

/** The gate in words: one line saying what was checked, then one per finding. */
export function gateWords(g: Gate): string {
  const what = `${g.files} changed file${g.files === 1 ? '' : 's'}${g.base ? ` since ${g.base}` : ''}`;
  if (g.ok) return `Conforms: ${what}. No breakpoint holds them, none of their tests fail or are older than the code, no done task fails its checks, and no doc that describes them is stale.`;
  return [`Does not conform (${what}):`, ...g.says.map((s) => `  ${s}`)].join('\n');
}
