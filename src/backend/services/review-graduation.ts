/**
 * Phase 33 C6 — graduation (RULES-AND-CLARITY §5.5): what agent reviews keep
 * finding becomes a proposed rule.
 *
 * A reviewer names each bug or risk with a `topic`, the same slug each time it
 * sees that kind of problem. When a review keeps a finding whose topic another
 * review already kept, CodeTrellis proposes a rule at `guide` strength: about
 * the folder those findings share, saying what the reviews said, with the
 * reviews as its reason. It goes through the proposals inbox like any other
 * (R3): nothing changes until a person accepts it, and a guide checks nothing.
 *
 * Once per topic: a topic with a rule of that id, or any proposal for it
 * (open, accepted or rejected), is not proposed again. A rejected one stays
 * rejected.
 */

import path from 'node:path';
import type { AgentFinding, AgentReview } from '../../shared/lib/agent-review';
import { listCheckRuns } from './check-runs';
import { findRule, proposedRule } from './architecture-rules';
import { previewChange } from './rule-preview';
import { addRuleProposal, listRuleProposals, type RuleProposal } from './rule-proposals';

/** Kinds a guide can answer. A rule finding has its rule; a question or a suspicious line is not a pattern. */
const GRADUATES = new Set(['bug', 'risk']);

/** The folder findings share: `src/payments/`, or `./` when they share none. */
export function sharedFolder(paths: readonly string[]): string {
  const dirs = paths.map((p) => path.posix.dirname(p).split('/').filter((x) => x && x !== '.'));
  if (!dirs.length) return './';
  const common: string[] = [];
  for (let i = 0; dirs.every((d) => i < d.length && d[i] === dirs[0][i]); i++) common.push(dirs[0][i]);
  return common.length ? `${common.join('/')}/` : './';
}

/** Propose a guide for each topic this review shares with an earlier one; the proposals made. */
export function graduate(root: string, run: string, review: AgentReview, by: { author: string; authorType: string }): RuleProposal[] {
  const mine = review.findings.filter((f) => f.topic && GRADUATES.has(f.kind) && f.path);
  if (!mine.length) return [];
  const earlier = listCheckRuns(root, 200).filter((r) => r.id !== run && r.review);
  const proposals = listRuleProposals(root);
  const made: RuleProposal[] = [];
  for (const topic of [...new Set(mine.map((f) => f.topic!))]) {
    if (findRule(root, topic) || proposals.some((p) => p.ruleId === topic) || made.some((p) => p.ruleId === topic)) continue;
    const before = earlier.flatMap((r) => r.review!.findings.filter((f) => f.topic === topic && GRADUATES.has(f.kind) && f.path).map((f) => ({ f, r })));
    if (!before.length) continue;
    const now = mine.filter((f) => f.topic === topic);
    const all: AgentFinding[] = [...now, ...before.map((b) => b.f)];
    const latest = now[0];
    const reviews = new Set([run, ...before.map((b) => b.r.id)]).size;
    const body = {
      kind: 'folder', folder: sharedFolder(all.map((f) => f.path!)), strength: 'guide', suite: 'agent-reviews',
      guide: `${latest.says}${latest.fix ? ` Instead: ${latest.fix}` : ''}`.slice(0, 1000),
      because: `Agent reviews found this ${all.length} times in ${reviews} reviews (${topic}).`.slice(0, 200),
    };
    try {
      const next = proposedRule(root, { ...body, id: topic }, by.author).rule;
      const preview = previewChange(root, topic, next, null);
      if (!preview.change) continue;
      made.push(addRuleProposal({
        projectRoot: root, ruleId: topic, body, why: `Graduated from agent reviews: ${all.map((f) => `${f.path}${f.start ? `:${f.start}` : ''}`).slice(0, 5).join(', ')}.`,
        effect: preview.change.effect, words: preview.words, author: by.author, authorType: by.authorType, sessionId: null,
      }));
    } catch { /* a topic that cannot be a rule stays a finding */ }
  }
  return made;
}
