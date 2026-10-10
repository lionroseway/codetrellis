/**
 * Phase 33 C9 — sign a review on this device, as a git note on the commit it
 * reviewed (the shape and the checking are in review-notes.ts).
 *
 * Signed only when every file the review read is that commit's: a review of
 * uncommitted changes is no review of the commit, so it is kept as a run and
 * not signed, with why. The key is the device's own, introduced once under
 * `.codetrellis/keys/` the way a rule approval introduces it; CI trusts it
 * once that file is on the base branch.
 */
import { execFileSync } from 'node:child_process';
import type { AgentReview } from '../../shared/lib/agent-review';
import { signWithDevice } from './task-records/signing';
import { deviceKey, introduceDeviceKey } from './task-records/trust';
import { attestationYaml, NOTES_REF, signedBytes, statementBytes, type ReviewStatement } from './review-notes';

const COMMIT = /^[0-9a-f]{40}$/;

const git = (root: string, args: string[], input?: string): string | null => {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(input === undefined ? {} : { input }) }); } catch { return null; }
};

export type Attested = { commit: string; signer: string; note: string } | { why: string };

export function attestReview(root: string, input: { head: string | null; base: string | null; files: readonly string[]; agent: string; review: AgentReview; scope: string }, device: { writer: string; name: string }, now = Date.now()): Attested {
  if (process.env.CODETRELLIS_SIGN_REVIEWS === '0') return { why: 'signing reviews is turned off here (CODETRELLIS_SIGN_REVIEWS=0)' };
  if (!input.head || !COMMIT.test(input.head)) return { why: 'it was not of a commit' };
  if (input.review.outcome === 'error') return { why: 'the review did not run' };
  // Every file it read must be the commit's, or it reviewed something the commit is not.
  const changed = input.files.length ? git(root, ['status', '--porcelain', '--untracked-files=all', '--', ...input.files.slice(0, 500)]) : '';
  if (changed === null) return { why: 'git could not say whether the reviewed files are committed' };
  if (changed.trim()) return { why: `it read changes that are not committed (${changed.trim().split('\n').length} file${changed.trim().split('\n').length === 1 ? '' : 's'}), so it is no review of ${input.head.slice(0, 7)}` };
  if (git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])?.trim() !== input.head) return { why: `HEAD is no longer ${input.head.slice(0, 7)}` };

  const key = deviceKey();
  introduceDeviceKey(root, device.writer, device.name, key);
  const statement: ReviewStatement = {
    kind: 'codetrellis-review', version: 1, head: input.head, base: input.base, agent: input.agent,
    outcome: input.review.outcome, reason: input.review.reason, scope: input.scope,
    findings: input.review.findings.map((f) => ({ kind: f.kind, path: f.path, start: f.start, end: f.end, quote: f.quote, says: f.says, rule: f.rule, fix: f.fix })),
    dropped: input.review.dropped.length, signer: key.fingerprint, at: new Date(now).toISOString(),
  };
  const signature = signWithDevice(key, signedBytes(statementBytes(statement)));
  // A note needs a committer; the repository's own when it has one.
  const who = git(root, ['config', 'user.email'])?.trim() ? [] : ['-c', 'user.name=CodeTrellis', '-c', 'user.email=codetrellis@localhost'];
  const wrote = git(root, [...who, 'notes', `--ref=${NOTES_REF}`, 'append', '-F', '-', input.head], attestationYaml(statement, signature));
  if (wrote === null) return { why: 'git could not write the note' };
  return { commit: input.head, signer: key.fingerprint, note: NOTES_REF };
}
