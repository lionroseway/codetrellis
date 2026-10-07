/**
 * Phase 33 B6 — `codetrellis check --pipeline`: the stages of the base's
 * `.codetrellis/pipeline.yaml`, in order (BUILDING-BLOCKS.md §B6).
 *
 * Each wave of stages runs together, after every wave before it: a stage is a
 * check of the rules it selects (`check_changes`, kept as a run saying its
 * stage), and a stage that selects agent rules is also a review of them, when
 * a reviewer is given (`--agent`); otherwise it is skipped, and its rules are
 * guides. `when` decides whether a stage runs at all; `grounding` gives an
 * agent stage's bundle what the stages it names found, as facts. An advisory
 * stage is said and never fails the pipeline. `--stage <id>` runs one.
 *
 * The pipeline is the base's, as the rules are (R2): a branch cannot drop the
 * stage that would fail it. What the branch does to the pipeline is the first
 * stage's finding, and a loosening needs a person's signed approval.
 */

import type { Pipeline, PipelineStage } from '../shared/types/pipeline';
import { stageScope, stageWords, waves } from '../backend/services/pipeline';
import { reachWords } from '../shared/lib/check-words';
import type { Gate, GateScope } from './conformity';

/** What a stage hands a later one: each finding, in words. */
export interface StageFinding { stage: string; path: string; says: string; rule?: string | null; strength?: string }

export interface StageResult {
  id: string;
  words: string;
  advisory: boolean;
  /** Ran, or why it did not. */
  ran: boolean;
  skipped?: string;
  ok: boolean;
  gate?: Gate | { error: string };
  review?: { ok: boolean; out: string; findings: StageFinding[] } | { error: string };
  findings: StageFinding[];
}

export interface PipelineResult { ok: boolean; stages: StageResult[]; notes: string[] }

export interface PipelineRunners {
  /** The check of one stage's rules. `pipeline`: this one also judges the change to the pipeline. */
  gate: (scope: GateScope & { pipeline?: boolean }) => Promise<Gate | { error: string }>;
  /** A review of one stage's agent rules, grounded; null when no reviewer is given. */
  review: ((stage: PipelineStage, scope: GateScope, grounding: StageFinding[]) => Promise<{ ok: boolean; out: string; findings: StageFinding[] } | { error: string }>) | null;
}

const agentOnly = (s: PipelineStage) => !!s.rules.engine && s.rules.engine.every((e) => e === 'agent');
const wantsReview = (s: PipelineStage) => !!s.rules.engine?.includes('agent');

function gateFindings(stage: string, g: Gate): StageFinding[] {
  return (g.rules as Array<{ path: string; imports: string; rule: string; strength?: string; words?: string }>).map((r) => ({
    stage, path: r.path, says: `${r.path} ${reachWords(r.imports)}, which ${r.words ?? r.rule} forbids`, rule: r.rule, ...(r.strength ? { strength: r.strength } : {}),
  }));
}

/** Run the pipeline, or one stage of it. Never throws for a stage: what failed is said. */
export async function runPipeline(p: Pipeline, run: PipelineRunners, only?: string): Promise<PipelineResult> {
  const notes: string[] = [];
  const results = new Map<string, StageResult>();
  let first = true;
  const chosen = only ? p.stages.filter((s) => s.id === only) : null;
  if (only && !chosen!.length) return { ok: false, stages: [], notes: [`The pipeline has no stage ${only}: its stages are ${p.stages.map((s) => s.id).join(', ')}.`] };

  const one = async (s: PipelineStage, judgesPipeline: boolean): Promise<StageResult> => {
    const base = { id: s.id, words: stageWords(s), advisory: !!s.advisory, findings: [] as StageFinding[] };
    if (s.when && !only) {
      const unmet = Object.entries(s.when).filter(([id, want]) => {
        const r = results.get(id);
        return !r || !r.ran || (want === 'passed' ? !r.ok : r.ok);
      });
      if (unmet.length) return { ...base, ran: false, ok: true, skipped: `it runs when ${unmet.map(([id, want]) => `${id} ${want}`).join(' and ')}, and ${unmet.length === 1 ? 'that' : 'those'} did not happen` };
    }
    const scope: GateScope = { ...stageScope(s), stage: s.id };
    let ok = true;
    const out: StageResult = { ...base, ran: true, ok: true };
    if (!agentOnly(s) || judgesPipeline) {
      const g = await run.gate({ ...scope, ...(judgesPipeline ? { pipeline: true } : {}) });
      out.gate = g;
      if ('error' in g) ok = false;
      else { ok = g.ok; out.findings.push(...gateFindings(s.id, g)); }
    }
    if (wantsReview(s)) {
      if (!run.review) {
        if (agentOnly(s) && !judgesPipeline) return { ...base, ran: false, ok: true, skipped: 'no reviewer was given (--agent), so its agent rules are guides' };
        notes.push(`The stage ${s.id}'s agent rules were not reviewed: no reviewer was given (--agent).`);
      } else {
        const grounding = only ? [] : (s.grounding ?? []).flatMap((id) => results.get(id)?.findings ?? []);
        const r = await run.review(s, { ...scope, engine: 'agent' }, grounding);
        out.review = r;
        if ('error' in r) ok = false;
        else { ok = ok && r.ok; out.findings.push(...r.findings); }
      }
    }
    out.ok = ok;
    return out;
  };

  for (const wave of waves(p)) {
    const stages = chosen ? wave.filter((s) => chosen.includes(s)) : wave;
    if (!stages.length) continue;
    // The first stage run also judges what the change does to the pipeline itself.
    const done = await Promise.all(stages.map((s, i) => one(s, first && i === 0)));
    first = false;
    for (const r of done) results.set(r.id, r);
  }
  const stages = [...results.values()];
  return { ok: stages.every((s) => s.ok || s.advisory), stages, notes };
}

/** The pipeline in words: each stage, what it said, and whether it passes. */
export function pipelineWords(r: PipelineResult, render: (g: Gate) => string): string {
  const lines: string[] = [];
  for (const s of r.stages) {
    const mark = !s.ran ? '·' : s.ok ? '✓' : s.advisory ? '⚠' : '✗';
    lines.push(`${mark} stage ${s.words}${s.skipped ? ` — skipped: ${s.skipped}` : ''}`);
    if (s.gate) lines.push('error' in s.gate ? `  ${s.gate.error}` : render(s.gate).split('\n').map((l) => (l ? `  ${l}` : l)).join('\n'));
    if (s.review) lines.push('error' in s.review ? `  review: ${s.review.error}` : s.review.out.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n'));
  }
  for (const n of r.notes) lines.push(`⚠ ${n}`);
  const failing = r.stages.filter((s) => !s.ok && !s.advisory).map((s) => s.id);
  lines.push(r.ok ? `✓ The pipeline passes (${r.stages.filter((s) => s.ran).length} of ${r.stages.length} stages ran).` : `✗ The pipeline fails: ${failing.join(', ')}.`);
  return lines.join('\n');
}
