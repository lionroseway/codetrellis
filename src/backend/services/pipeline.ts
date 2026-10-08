/**
 * Phase 33 B6 — pipelines: what runs, in what order, and what each stage hands
 * the next (BUILDING-BLOCKS.md §B6; the shape is in shared/types/pipeline.ts).
 *
 * An optional `.codetrellis/pipeline.yaml`. Without it every rule runs in one
 * stage, as before. With it, `codetrellis check --pipeline` runs its stages in
 * order, a `parallel` stage beside the one before it, each stage a check run
 * of the rules it selects (`src/cli/pipeline.ts`). An agent stage's review is
 * given the findings of the stages it names in `grounding`.
 *
 * The file is a rule file: committed, judged by the base's copy, and under
 * change control. Each stage is held as a rule is (`stageRule`), so the gate
 * says what a change does to it and a loosening needs a person's signed
 * approval, the same signature a rule's takes (R3): removing a stage, making it
 * advisory, or changing what it runs, after what, when, or with what grounding.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { RULE_ENGINES, RULE_STRENGTHS } from '../../shared/types/architecture-rules';
import type { Pipeline, PipelineStage, StageRules } from '../../shared/types/pipeline';
import { readTextWithin } from './confined-fs';
import { gitAsync } from './git-env';
import { diffRules, NEEDS, type RuleChange } from './rule-changes';

export const PIPELINE_FILE = '.codetrellis/pipeline.yaml';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_STAGES = 20;
const MAX_BYTES = 64 * 1024;
const SELECTORS = ['suite', 'engine', 'strength', 'id', 'tag'] as const;

const list = (v: unknown): string[] | null => (v === undefined ? [] : typeof v === 'string' ? [v] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]).map((x) => x.trim()).filter(Boolean) : null);

/** A pipeline file's stages, and why any part was not read. Pure. */
export function parsePipeline(text: string): { pipeline: Pipeline | null; problems: string[] } {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { pipeline: null, problems: [`${PIPELINE_FILE} is larger than a pipeline can be`] };
  const doc = parseDocument(text);
  if (doc.errors.length) return { pipeline: null, problems: [`${PIPELINE_FILE} is not YAML: ${doc.errors[0].message.split('\n')[0]}`] };
  let raw: unknown;
  try { raw = doc.toJS({ maxAliasCount: 0 }); } catch { return { pipeline: null, problems: [`${PIPELINE_FILE} may not use YAML aliases`] }; }
  const items = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).stages : null;
  if (!Array.isArray(items) || items.length === 0) return { pipeline: null, problems: [`${PIPELINE_FILE} holds stages: a list of at least one`] };
  if (items.length > MAX_STAGES) return { pipeline: null, problems: [`a pipeline has at most ${MAX_STAGES} stages`] };
  const problems: string[] = [];
  const stages: PipelineStage[] = [];
  // Stages finished before each one starts: everything before the wave it runs in.
  const before: string[] = [];
  let wave: string[] = [];
  for (const [i, item] of items.entries()) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const why: string[] = [];
    const id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : null;
    if (!id) why.push('id must be a short slug, like fast');
    else if (stages.some((s) => s.id === id)) why.push(`${id} is already a stage`);
    const rules: StageRules = {};
    if (r.rules !== undefined && r.rules !== 'all') {
      if (!r.rules || typeof r.rules !== 'object' || Array.isArray(r.rules)) why.push('rules selects by suite, engine, strength, id or tag, like { engine: deterministic }, or is all');
      else {
        for (const [k, v] of Object.entries(r.rules as Record<string, unknown>)) {
          const values = list(v);
          if (!(SELECTORS as readonly string[]).includes(k)) { why.push(`rules selects by suite, engine, strength, id or tag, not ${k}`); continue; }
          if (!values || values.length === 0) { why.push(`rules.${k} is a name or a list of them`); continue; }
          if (k === 'engine' && values.some((x) => !(RULE_ENGINES as readonly string[]).includes(x))) why.push('rules.engine is deterministic, fuzzy or agent');
          if (k === 'strength' && values.some((x) => !(RULE_STRENGTHS as readonly string[]).includes(x))) why.push('rules.strength is block, warn or guide');
          rules[k as keyof StageRules] = values;
        }
      }
    }
    const parallel = r.parallel === true;
    if (r.parallel !== undefined && typeof r.parallel !== 'boolean') why.push('parallel is true or false');
    if (parallel && i === 0) why.push('the first stage has no stage to run beside');
    const earlier = parallel ? before : [...before, ...wave];
    const refs = (name: string, v: unknown): string[] | null => {
      const xs = list(v);
      if (xs === null) { why.push(`${name} is a list of stages`); return null; }
      for (const x of xs) if (!earlier.includes(x)) why.push(`${name} names ${x}, which is not a stage that finishes before this one`);
      return xs;
    };
    const needs = refs('needs', r.needs);
    const grounding = refs('grounding', r.grounding);
    let when: Record<string, 'passed' | 'failed'> | undefined;
    if (r.when !== undefined) {
      if (!r.when || typeof r.when !== 'object' || Array.isArray(r.when)) why.push('when says which stages must have passed or failed, like { fast: passed }');
      else {
        when = {};
        for (const [k, v] of Object.entries(r.when as Record<string, unknown>)) {
          if (v !== 'passed' && v !== 'failed') { why.push(`when.${k} is passed or failed`); continue; }
          if (!earlier.includes(k)) { why.push(`when names ${k}, which is not a stage that finishes before this one`); continue; }
          when[k] = v;
        }
      }
    }
    if (r.advisory !== undefined && typeof r.advisory !== 'boolean') why.push('advisory is true or false');
    if (why.length) { problems.push(`stage ${id ?? i + 1}: ${why.join('; ')}`); continue; }
    if (!parallel) { before.push(...wave); wave = []; }
    wave.push(id!);
    stages.push({
      id: id!, rules,
      ...(parallel ? { parallel: true } : {}),
      ...(needs && needs.length ? { needs } : {}),
      ...(when && Object.keys(when).length ? { when } : {}),
      ...(grounding && grounding.length ? { grounding } : {}),
      ...(r.advisory === true ? { advisory: true } : {}),
    });
  }
  // A pipeline with a stage that could not be read is not run: it would run less than it says.
  return problems.length ? { pipeline: null, problems } : { pipeline: { stages }, problems: [] };
}

/** The pipeline in the working tree, read through the confined-file helper; null when there is none. */
export function readPipeline(projectRoot: string): { pipeline: Pipeline | null; problems: string[] } | null {
  if (!fs.existsSync(path.join(projectRoot, PIPELINE_FILE))) return null;
  try {
    return parsePipeline(readTextWithin(projectRoot, PIPELINE_FILE, 'pipeline'));
  } catch (err) {
    return { pipeline: null, problems: [`${PIPELINE_FILE} could not be read: ${(err as Error).message}`] };
  }
}

/** The pipeline at a commit (R2: a branch is judged by its base's); null when the commit has none. */
export async function pipelineAt(projectRoot: string, commit: string): Promise<{ pipeline: Pipeline | null; problems: string[] } | null> {
  if (!/^[0-9a-f]{40}$/.test(commit)) return null;
  try {
    const text = await gitAsync(projectRoot, ['show', `${commit}:./${PIPELINE_FILE}`]);
    return parsePipeline(String(text));
  } catch {
    return null;
  }
}

/** A stage's rules as a check's scope takes them (rule-scope.ts). */
export function stageScope(s: Pick<PipelineStage, 'rules'>): { suite?: string; rule?: string; engine?: string; strength?: string; tag?: string } {
  return {
    ...(s.rules.suite ? { suite: s.rules.suite.join(',') } : {}),
    ...(s.rules.id ? { rule: s.rules.id.join(',') } : {}),
    ...(s.rules.engine ? { engine: s.rules.engine.join(',') } : {}),
    ...(s.rules.strength ? { strength: s.rules.strength.join(',') } : {}),
    ...(s.rules.tag ? { tag: s.rules.tag.join(',') } : {}),
  };
}

/** The stages in waves: each wave runs together, after every wave before it. */
export function waves(p: Pipeline): PipelineStage[][] {
  const out: PipelineStage[][] = [];
  for (const s of p.stages) {
    if (s.parallel && out.length) out[out.length - 1].push(s);
    else out.push([s]);
  }
  return out;
}

/** "review: agent rules, after fast and fuzzy, when fast passed, grounded by fast and fuzzy (advisory)". */
export function stageWords(s: PipelineStage): string {
  const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const sel: string[] = [];
  if (s.rules.engine) sel.push(`${and(s.rules.engine)}`);
  if (s.rules.strength) sel.push(`${and(s.rules.strength)}-strength`);
  const what = `${sel.length ? `${sel.join(' ')} ` : ''}rules${s.rules.tag ? ` tagged ${s.rules.tag.join(' or ')}` : ''}${s.rules.suite ? ` in ${and(s.rules.suite)}` : ''}${s.rules.id ? ` ${and(s.rules.id)}` : ''}`;
  const parts = [s.rules.engine || s.rules.strength || s.rules.suite || s.rules.id || s.rules.tag ? what : 'every rule'];
  if (s.parallel) parts.push('beside the stage before');
  if (s.needs) parts.push(`after ${and(s.needs)}`);
  if (s.when) parts.push(`when ${and(Object.entries(s.when).map(([k, v]) => `${k} ${v}`))}`);
  if (s.grounding) parts.push(`grounded by ${and(s.grounding)}`);
  return `${s.id}: ${parts.join(', ')}${s.advisory ? ' (advisory)' : ''}`;
}

const sorted = <T>(xs: readonly T[] | undefined) => [...(xs ?? [])].sort();

/**
 * A stage held as a rule is, for change control: its terms (what it runs,
 * after what, when, with what grounding) are what a signature covers, and an
 * advisory stage is a lowered one. Where it runs beside is not a term.
 */
export function stageRule(s: PipelineStage): ArchitectureRule {
  const terms = {
    rules: Object.fromEntries(Object.entries(s.rules).sort().map(([k, v]) => [k, sorted(v as string[])])),
    needs: sorted(s.needs), grounding: sorted(s.grounding),
    when: Object.fromEntries(Object.entries(s.when ?? {}).sort()),
  };
  return { id: `pipeline.${s.id}`, from: 'pipeline', mayNotImport: JSON.stringify(terms), except: [], because: '', since: '', by: '', strength: s.advisory ? 'warn' : 'block' };
}

/** What a change does to the pipeline, as the gate says it, with the same effects and approvals as a rule's. */
export function diffPipeline(base: Pipeline | null, head: Pipeline | null): RuleChange[] {
  const b = new Map((base?.stages ?? []).map((s) => [s.id, s]));
  const h = new Map((head?.stages ?? []).map((s) => [s.id, s]));
  return diffRules([...b.values()].map(stageRule), [...h.values()].map(stageRule), []).map((c) => {
    const id = c.rule.slice('pipeline.'.length);
    const was = b.get(id);
    const now = h.get(id);
    const said = (s: PipelineStage | undefined) => (s ? `“${stageWords(s)}”` : '');
    const words = c.change === 'removed'
      ? `✗ This change removes the stage ${id} from the pipeline (${said(was)}).${NEEDS}`
      : c.change === 'added'
        ? `⚠ This change adds the stage ${id} to the pipeline (${said(now)}). It runs once it is on the base branch.`
        : c.effect === 'loosens'
          ? `✗ This change loosens the pipeline's stage ${id}, from ${said(was)} to ${said(now)}.${NEEDS}`
          : `⚠ This change tightens the pipeline's stage ${id}, from ${said(was)} to ${said(now)}.`;
    return { ...c, words };
  });
}
