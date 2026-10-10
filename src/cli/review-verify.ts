/**
 * Phase 33 C9 — the signed review on a pull request, in CI and anywhere else
 * (`src/backend/services/review-notes.ts`).
 *
 *     codetrellis review publish                       # push this clone's signed reviews
 *     codetrellis review verify --base origin/main     # the head's review, verified
 *
 * `verify` needs git and nothing else: no app, no secret, no agent. It fetches
 * the notes, reads the one on the head commit, and checks it against the
 * device keys the base lists. It says the review (verified), that it is of an
 * earlier commit (stale), that it does not hold (refused), or that there is
 * none; `--require` makes anything but verified exit 3. The findings come out
 * as words, markdown, SARIF or JSON, as `codetrellis review`'s do.
 */
import { execFileSync } from 'node:child_process';
import { flag, type Parsed } from './args';
import { NOTES_REF, verifyReview, type VerifiedReview } from '../backend/services/review-notes';
import { reviewMarkdown, reviewSarif, type PassResult } from './review-output';

export class VerifyUsageError extends Error {}

const git = (cwd: string, args: string[]): string | null => {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; }
};

/** The signed review as a pass, for the renderers `codetrellis review` uses. */
function asPass(v: VerifiedReview): PassResult[] {
  if (v.state !== 'verified' || !v.review) return [];
  return [{
    pass: 'signed review', outcome: v.review.outcome, reason: v.review.reason, says: v.words, run: '', failing: false,
    kept: v.review.findings.map((f) => ({ kind: f.kind, path: f.path, start: f.start, end: f.end, says: f.says, rule: f.rule, fix: f.fix })),
    dropped: v.review.dropped, strengths: {}, verify: null,
  }];
}

export function verifyCmd(p: Parsed, cwd: string, env: NodeJS.ProcessEnv, version: string): { out: string; code: number } {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!root) throw new VerifyUsageError('codetrellis review verify runs in a git checkout');
  const remote = flag(p, 'remote') ?? 'origin';
  // The notes travel apart from the branch: fetch them, and say nothing if there are none.
  if (p.flags['no-fetch'] !== true && git(root, ['remote', 'get-url', remote]) !== null) {
    git(root, ['fetch', '--quiet', remote, `+${NOTES_REF}:${NOTES_REF}`]);
  }
  const baseRef = flag(p, 'base') ?? (env.GITHUB_BASE_REF ? `${remote}/${env.GITHUB_BASE_REF}` : null);
  if (!baseRef) throw new VerifyUsageError('--base names the branch the change goes into, like origin/main');
  const base = git(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
  if (!base) throw new VerifyUsageError(`${baseRef} is not a commit here (fetch it first)`);
  const head = git(root, ['rev-parse', '--verify', '--quiet', `${flag(p, 'head') ?? 'HEAD'}^{commit}`]);
  if (!head) throw new VerifyUsageError(`${flag(p, 'head') ?? 'HEAD'} is not a commit here`);

  const v = verifyReview(root, head, base);
  const code = p.flags.require === true && v.state !== 'verified' ? 3 : 0;
  const format = flag(p, 'format') ?? (p.flags.json === true ? 'json' : 'text');
  const agent = v.review?.agent ?? 'agent';
  if (format === 'json') return { out: JSON.stringify(v, null, 2), code };
  if (format === 'sarif') return { out: JSON.stringify(reviewSarif(asPass(v), { version, root, agent }), null, 2), code };
  if (format === 'markdown') {
    const body = asPass(v).length ? reviewMarkdown(asPass(v), agent) : '### CodeTrellis review\n';
    return { out: `${body}\n${v.words}\n${v.refused.map((r) => `- refused: ${r.agent}'s, because ${r.why}`).join('\n')}`.trimEnd() + '\n', code };
  }
  if (format !== 'text') throw new VerifyUsageError(`--format is text, json, markdown or sarif, not ${format}`);
  const lines = [v.words];
  if (v.state === 'verified' && v.review) {
    for (const f of v.review.findings) lines.push(`  ${f.kind === 'rule' || f.kind === 'bug' ? '✗' : f.kind === 'question' ? '?' : '⚠'} ${f.path ? `${f.path}${f.start ? `:${f.start}` : ''} ` : ''}${f.says}${f.rule ? ` (${f.rule})` : ''}`);
  }
  for (const r of v.refused) if (v.state !== 'refused') lines.push(`  refused: ${r.agent}'s, because ${r.why}`);
  return { out: lines.join('\n'), code };
}

/** Push this clone's signed reviews, so CI can read them. */
export function publishCmd(p: Parsed, cwd: string): { out: string; code: number } {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!root) throw new VerifyUsageError('codetrellis review publish runs in a git checkout');
  if (git(root, ['rev-parse', '--verify', '--quiet', NOTES_REF]) === null) return { out: 'No signed reviews here yet: review a commit first (codetrellis review, or your agent through get_review_bundle).', code: 0 };
  const remote = flag(p, 'remote') ?? 'origin';
  try {
    execFileSync('git', ['-C', root, 'push', '--quiet', remote, `${NOTES_REF}:${NOTES_REF}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const why = ((err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message).trim().split('\n')[0];
    return { out: `The signed reviews were not pushed to ${remote}: ${why}. Fetch theirs and try again (git fetch ${remote} ${NOTES_REF}:${NOTES_REF}, then git notes --ref=${NOTES_REF} merge).`, code: 1 };
  }
  return { out: `Pushed the signed reviews to ${remote} (${NOTES_REF}). CI verifies them with codetrellis review verify.`, code: 0 };
}
