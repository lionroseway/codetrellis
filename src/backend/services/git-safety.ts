/**
 * Validation for values that reach a `git` command line.
 *
 * TWO DISTINCT PROBLEMS, OFTEN CONFLATED
 *
 * 1. SHELL INJECTION — only possible when git is invoked through a shell
 *    (`execSync('git ' + line)`). The fix is to stop using a shell:
 *    `execFileSync('git', [...args])` passes each argument straight to the
 *    process, so no quoting is required and none can be got wrong.
 *
 * 2. OPTION INJECTION — possible even WITHOUT a shell, and this is the one
 *    that gets missed. git parses any argument beginning with `-` as a flag,
 *    so a "commit hash" of `--output=/Users/you/.ssh/authorized_keys` is an
 *    instruction, not an operand. `execFileSync` does nothing to prevent it.
 *
 * Phase 19 finding 10 is the second kind. The mitigations are complementary
 * and both are applied:
 *
 *   - `--` separates options from operands wherever git supports it, so
 *     anything after it is treated as a path or ref even if it starts with
 *     a dash;
 *   - and identifiers are validated against this module before they are
 *     passed at all, because `--` does not help for arguments that must come
 *     BEFORE it (a ref in `git show <ref>:<path>`, for instance).
 */

/**
 * A commit-ish this codebase is willing to pass to git.
 *
 * Deliberately narrower than what git itself accepts. We only ever pass
 * things we produced — hashes from `rev-parse`, branch names from our own
 * listing — so a restrictive rule costs nothing and removes a whole class of
 * argument.
 *
 * Allowed: full and abbreviated hex SHAs; ordinary branch and tag names;
 * `HEAD` and its `~`/`^` suffixes; remote-qualified names like
 * `origin/main`.
 *
 * Not allowed, on purpose: anything starting with `-` or `.`, `..` ranges,
 * whitespace, colons (which separate ref from path and must be applied by
 * the caller, not smuggled in), and every shell metacharacter.
 */
const SAFE_REF = /^(?!-)(?!\.)[A-Za-z0-9_][A-Za-z0-9._/~^@-]{0,254}$/;

/** Reject `a..b` / `a...b` ranges — they widen what a command touches. */
const RANGE = /\.\./;

export function isSafeGitRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return false;
  if (RANGE.test(value)) return false;
  return SAFE_REF.test(value);
}

/**
 * Throw unless `value` is a ref this codebase will pass to git.
 *
 * `label` names the caller so the error says which entry point rejected it
 * rather than just "invalid ref".
 */
export function assertSafeGitRef(value: unknown, label: string): string {
  if (!isSafeGitRef(value)) {
    const shown = typeof value === 'string' ? value.slice(0, 80) : typeof value;
    throw new Error(
      `${label}: refusing to pass "${shown}" to git — not a valid commit or ref. ` +
        'Refs must not start with "-" or ".", contain ".." ranges, whitespace, ' +
        'colons or shell metacharacters.',
    );
  }
  return value;
}

/**
 * Throw if a path would be read as a git option.
 *
 * Paths are normally protected by `--`, but not every git subcommand accepts
 * one in every position, so validate rather than assume.
 */
export function assertSafeGitPathArg(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}: expected a non-empty path`);
  }
  if (value.startsWith('-')) {
    throw new Error(
      `${label}: refusing to pass "${value.slice(0, 80)}" to git — a leading "-" ` +
        'would be parsed as an option.',
    );
  }
  return value;
}
