/**
 * Phase 33 B6 — the pipeline in the app: its stages in words, what an edit to
 * it would loosen, and a person's signed approval of that.
 *
 * The pipeline is edited as a file. Before it is committed, the app compares
 * it with the last commit's: each loosening (a stage removed, made advisory,
 * or changed in what it runs) is pending until a person approves it, signed
 * the way a rule's loosening is (R3), so the gate on the pull request accepts
 * it once the key is on the base branch.
 */
import { execFileSync } from 'node:child_process';
import type { PipelineView } from '../../shared/types/pipeline';
import { approvalFor, approvalsHere, keysAt, signRuleChange } from './rule-approvals';
import { diffPipeline, PIPELINE_FILE, pipelineAt, readPipeline, stageWords } from './pipeline';
import type { RuleChange } from './rule-changes';

function headOf(projectRoot: string): string | null {
  try { return execFileSync('git', ['-C', projectRoot, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

/** The loosenings an edit to the pipeline makes since the last commit, not yet approved. */
async function pendingChanges(projectRoot: string): Promise<RuleChange[]> {
  const head = headOf(projectRoot);
  if (!head) return [];
  const was = await pipelineAt(projectRoot, head);
  const now = readPipeline(projectRoot);
  const loosens = diffPipeline(was?.pipeline ?? null, now?.pipeline ?? null).filter((c) => c.effect === 'loosens');
  if (!loosens.length) return [];
  const approvals = approvalsHere(projectRoot);
  const keys = keysAt(projectRoot, head);
  try {
    // Pending until a person has signed one. Whether its key is on the base is the gate's to say.
    return loosens.filter((c) => approvalFor(projectRoot, c, approvals, keys, head) === null);
  } finally { keys.done(); }
}

/** The pipeline as the window reads it. */
export async function pipelineView(projectRoot: string): Promise<PipelineView> {
  const got = readPipeline(projectRoot);
  const pending = await pendingChanges(projectRoot);
  return {
    where: PIPELINE_FILE,
    pipeline: got?.pipeline ?? null,
    problems: got?.problems ?? [],
    words: got?.pipeline?.stages.map(stageWords) ?? [],
    pending: pending.map((c) => ({ stage: c.rule.slice('pipeline.'.length), words: c.words })),
  };
}

/** Sign each pending loosening as this person. The caller made sure a person asked, in the app. */
export async function approvePipeline(projectRoot: string, me: { writer: string; name: string }): Promise<{ signed: Array<{ stage: string; file: string; how: string }>; view: PipelineView }> {
  const signed: Array<{ stage: string; file: string; how: string }> = [];
  for (const c of await pendingChanges(projectRoot)) {
    const s = signRuleChange(projectRoot, { rule: c.rule, before: c.before, after: c.after }, me);
    signed.push({ stage: c.rule.slice('pipeline.'.length), file: s.file, how: s.how });
  }
  return { signed, view: await pipelineView(projectRoot) };
}
