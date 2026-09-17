/**
 * Git commit composer — Phase 1.2 of the CDev target architecture.
 *
 * The application doesn't auto-commit by default. When a human or
 * agent explicitly asks to commit manifest changes (typically via the
 * `commit_manifest_changes` MCP tool), this service composes the
 * commit message with the right attribution and runs the git commands
 * against the project root.
 *
 * Commit-message convention (see docs/cdev/06-agent-identity-and-attribution.md):
 *
 *   [cdev] <subject>
 *
 *   <optional body lines>
 *
 *   agent: <agent-type> · model: <model>   # if agent-attributed
 *   Co-Authored-By: <person>'s <agent> <agent@cdev.example>
 *
 * The human (per git config) is the commit author; agents are recorded
 * as a `Co-Authored-By` trailer plus a metadata line above. Signed
 * commits work normally — the signature is on the human author.
 */

import { execFileSync } from 'node:child_process';
import { assertSafeGitPathArg } from './git-safety';
import fs from 'node:fs';
import path from 'node:path';

export interface AgentAttribution {
  /** Runtime identifier — e.g., 'claude-code', 'cursor', 'codex'. */
  agentType: string;
  /** Specific model in use, where it matters — e.g., 'opus-4'. */
  model?: string | null;
  /** Email or display name for the human the agent acted on behalf of. */
  humanIdentity?: string | null;
}

export interface ComposeMessageOptions {
  /** Short, imperative subject line — appended after `[cdev] `. */
  subject: string;
  /** Optional body lines (paragraphs). Each entry becomes a paragraph. */
  body?: string[];
  /** When set, the message is attributed to an agent acting on the human's behalf. */
  agent?: AgentAttribution | null;
}

export interface CommitOptions extends ComposeMessageOptions {
  /** Project root containing `.git/`. Must be a real directory with a git repo. */
  projectRoot: string;
  /** Paths to stage and commit, relative to `projectRoot`. When empty, stages no files (commit fails on empty index). */
  paths: string[];
  /** Sign the commit (`git commit -S`). Requires the user's git config to be set up for signing. */
  signed?: boolean;
}

export interface CommitResult {
  sha: string;
  message: string;
}

/**
 * Compose the multi-line commit message according to the CDev
 * convention. Pure function — no git interaction.
 */
export function composeCommitMessage(opts: ComposeMessageOptions): string {
  const subject = `[cdev] ${opts.subject.trim()}`;
  const parts: string[] = [subject];

  if (opts.body && opts.body.length > 0) {
    parts.push('');
    parts.push(opts.body.map((line) => line.trim()).filter(Boolean).join('\n\n'));
  }

  if (opts.agent) {
    const agentType = opts.agent.agentType.trim();
    const model = (opts.agent.model ?? '').trim();
    const human = (opts.agent.humanIdentity ?? '').trim();

    parts.push('');
    const meta = model ? `agent: ${agentType} · model: ${model}` : `agent: ${agentType}`;
    parts.push(meta);

    // Co-Authored-By for git blame / GitHub attribution. Always a
    // valid email-shaped string so git accepts the trailer.
    const display = human ? `${human}'s ${agentType}` : agentType;
    parts.push(`Co-Authored-By: ${display} <agent@cdev.example>`);
  }

  return parts.join('\n') + '\n';
}

/**
 * Stage the given paths and create a commit with the composed message.
 * Throws on failure (no git repo, nothing staged, signing failure, etc.).
 *
 * Caller owns the decision of which paths to commit. We don't
 * implicitly stage everything — that would catch unrelated changes
 * the user hasn't reviewed.
 */
export function commitManifestChanges(opts: CommitOptions): CommitResult {
  if (!fs.existsSync(path.join(opts.projectRoot, '.git'))) {
    throw new Error(`Not a git repository: ${opts.projectRoot}`);
  }

  if (opts.paths.length === 0) {
    throw new Error('No paths supplied — commit would be empty.');
  }

  const message = composeCommitMessage(opts);

  // Stage the requested paths. Use `git add --` so paths starting with
  // `-` aren't treated as flags.
  // Each path validated, then passed as its own argv entry after `--`.
  // Belt and braces: `--` stops git reading a leading dash as a flag, and
  // the check catches the subcommands where `--` is not accepted.
  const safePaths = opts.paths.map((p, i) => assertSafeGitPathArg(p, `commitPaths[${i}]`));
  runGit(['add', '--', ...safePaths], opts.projectRoot);

  // Use --file to avoid shell-escaping the message body. We write the
  // message to a temp file inside the project's .git/ dir, commit
  // from it, then unlink.
  const tmpMsgPath = path.join(opts.projectRoot, '.git', `cdev-commit-msg-${Date.now()}-${process.pid}.txt`);
  try {
    fs.writeFileSync(tmpMsgPath, message, 'utf-8');
    const commitFlags = ['commit', '--file', tmpMsgPath];
    if (opts.signed) commitFlags.push('-S');
    runGit(commitFlags, opts.projectRoot);
  } finally {
    try { fs.unlinkSync(tmpMsgPath); } catch { /* ignore */ }
  }

  const sha = runGit(['rev-parse', 'HEAD'], opts.projectRoot).trim();
  return { sha, message };
}

// --- internals --------------------------------------------------------------

/**
 * Run git with an explicit argv — NO SHELL.
 *
 * This used to be `execSync(`git ${argsLine}`)` with a hand-rolled
 * `quoteArg` helper, justified by "the values we pass come from inside the
 * application". That assumption is exactly the kind that stops being true
 * quietly, and quoting is easy to get subtly wrong.
 *
 * With execFileSync there is no shell to quote FOR: each argument is handed
 * to the process verbatim, so metacharacters are inert. Option injection is
 * a separate concern and is handled by the validators in ./git-safety.
 */
function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    const stderr = (err?.stderr ?? '').toString();
    const message = stderr.trim() || err?.message || 'git failed';
    throw new Error(`git ${args[0]} failed: ${message}`);
  }
}
