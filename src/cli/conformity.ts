/**
 * The conformity gate for a job or a hook (Phase 32 D1.4): which files this
 * work changed, and whether the change conforms to what the plan and the
 * docs say (`check_changes`), and whether it adds an import across one of
 * the team's architecture rules (A7.3). `codetrellis check` with no path, and
 * `codetrellis status`, exit 3 when it does not, so a pipeline can fail on it.
 *
 * "This work" is the branch since it left its base, plus whatever is not
 * committed yet. The base is `--base`, else the pull request's base in
 * GitHub Actions (`GITHUB_BASE_REF`), else the remote's default branch, else
 * none (only what is not committed). CodeTrellis's own files are left out:
 * the plan changing is not a change to conform.
 */

import type { Agent } from './agent';
import { renderMarkdown, renderText, type CheckResult, type CheckedRule, type RuleFinding, type RulebookFinding } from '../shared/lib/check-words';
import { importLine } from './sarif';

// The work's changed files, since its base: one implementation, the backend's,
// so the Checks view (G9) and the pipeline check the same files.
export { baseRef, changedFiles, type Changed } from '../backend/services/work-changes';
import type { Changed } from '../backend/services/work-changes';

export interface Gate {
  ok: boolean;
  says: string[];
  files: number;
  base: string | null;
  breakpoints: unknown[];
  tests: unknown[];
  criteria: unknown[];
  docs: unknown[];
  rules: unknown[];
  /** What the change does to the rulebook (Phase 33 R2). */
  rulebook: unknown[];
  /** Said, but not a reason to fail: a rule added or tightened, a reason reworded. */
  notes: string[];
  /** Set when the rules could not be checked, and why. */
  rulesNote?: string;
  /** C1: what part of the rulebook was checked, when not all of it. */
  scope?: string;
  /** C8: the rules judged by, so a suite can say how many hold. */
  checked?: CheckedRule[];
}

/**
 * Where this check runs, in words, for its run record (Phase 33 C7): the CI
 * host a job's environment names, else "CI", else "a terminal".
 */
export function ranIn(env: NodeJS.ProcessEnv): string {
  const on = (k: string) => env[k] !== undefined && env[k] !== '' && env[k] !== 'false' && env[k] !== '0';
  if (on('GITHUB_ACTIONS')) return 'GitHub Actions';
  if (on('GITLAB_CI')) return 'GitLab CI';
  if (on('BITBUCKET_BUILD_NUMBER')) return 'Bitbucket Pipelines';
  if (on('TF_BUILD')) return 'Azure Pipelines';
  if (on('JENKINS_URL')) return 'Jenkins';
  if (on('CIRCLECI')) return 'CircleCI';
  if (on('BUILDKITE')) return 'Buildkite';
  if (on('CI')) return 'CI';
  return 'a terminal';
}

/** `check_changes` over this work's files, as the agent. */
/** C1: part of the rulebook to check, as the flags give it (comma-separated). */
/** `engine` and `strength` select a pipeline stage's rules (B6); `stage` names the run after it. */
export interface GateScope { suite?: string; rule?: string; path?: string; engine?: string; strength?: string; stage?: string; pipeline?: boolean }

export async function gate(agent: Agent, root: string, changed: Changed, strict = false, scope: GateScope = {}): Promise<Gate | { error: string }> {
  // Nothing changed, not even the rules: nothing to check. A change to the
  // rules alone is still checked (Phase 33 R2): it could loosen one.
  if (changed.files.length === 0 && !changed.rulebook) return { ok: true, says: [], files: 0, base: changed.base, breakpoints: [], tests: [], criteria: [], docs: [], rules: [], rulebook: [], notes: [] };
  // The merge base, so an import that was already there is not this work's (A7.3).
  const { stage, ...selects } = scope;
  const a = await agent.call('check_changes', {
    paths: changed.files.slice(0, 500), project_path: root, ...(changed.since ? { base: changed.since } : {}), ...(strict ? { strict: true } : {}), ...selects,
    // C7: the run is kept saying where it ran; B6: and which stage of the pipeline it was.
    ran_in: stage ? `${ranIn(process.env)}, stage ${stage}` : ranIn(process.env),
  });
  if (a.isError) return { error: a.text };
  const j = (a.json ?? {}) as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(j[k]) ? j[k] as unknown[] : []);
  return {
    ok: j.ok === true, says: list('says') as string[], files: changed.files.length, base: changed.base,
    breakpoints: list('breakpoints'), tests: list('tests'), criteria: list('criteria'), docs: list('docs'), rules: list('rules'),
    rulebook: list('rulebook'), notes: list('notes').filter((n): n is string => typeof n === 'string'),
    ...(typeof j.rules_note === 'string' ? { rulesNote: j.rules_note } : {}),
    ...(typeof j.scope === 'string' ? { scope: j.scope } : {}),
    ...(Array.isArray(j.checked) ? { checked: j.checked as CheckedRule[] } : {}),
  };
}

/**
 * The gate in words (C8, `check-words.ts`): grouped by suite, the summary
 * first, the fix after →, the exit code last. `read` finds each import's
 * line and text; `color` is for a terminal that wants it.
 */
export function gateWords(g: Gate, opts: { color?: boolean; read?: (rel: string) => string | null } = {}): string {
  return renderText(withPlaces(g, opts.read), { color: opts.color });
}

/** The gate as a pull request comment or a job summary (`--format markdown`). */
export function gateMarkdown(g: Gate, read?: (rel: string) => string | null): string {
  return renderMarkdown(withPlaces(g, read));
}

/** Each rule finding with where in its file it is, when the file can be read. */
export function withPlaces(g: Gate, read?: (rel: string) => string | null): CheckResult {
  const rules = (g.rules as RuleFinding[]).map((r) => {
    const text = read ? read(r.path) : null;
    // B4: where the text names it, else where the extractor found it (a pattern's entry is not in the text).
    const found = (r as { line_found?: number }).line_found ?? null;
    const line = (text === null ? null : importLine(text, r.imports)) ?? (text !== null && found ? found : null);
    return { ...r, line, text: line ? text!.split('\n')[line - 1] : null };
  });
  return { ...g, rules, rulebook: g.rulebook as RulebookFinding[] };
}

/**
 * Whether to colour: a terminal, and nobody said not to (`NO_COLOR`,
 * https://no-color.org, or `--no-color`). A pipe or a CI log gets plain text.
 */
export function wantsColor(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv, noColorFlag = false): boolean {
  if (noColorFlag || (env.NO_COLOR !== undefined && env.NO_COLOR !== '')) return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true;
  return stream.isTTY === true && env.TERM !== 'dumb';
}
