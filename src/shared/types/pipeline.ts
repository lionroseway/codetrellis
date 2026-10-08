/**
 * Phase 33 B6 — a pipeline: what runs, in what order, and what each stage
 * hands the next (BUILDING-BLOCKS.md §B6).
 *
 *     # .codetrellis/pipeline.yaml
 *     stages:
 *       - id: fast
 *         rules: { engine: deterministic }
 *       - id: fuzzy
 *         rules: { engine: fuzzy }
 *         parallel: true
 *       - id: review
 *         needs: [fast, fuzzy]
 *         rules: { engine: agent }
 *         when: { fast: passed }
 *         grounding: [fast, fuzzy]
 */

/** Which rules a stage runs: each given selector applies (AND), each a value or a list (OR). */
export interface StageRules {
  suite?: string[];
  engine?: string[];
  strength?: string[];
  id?: string[];
}

export interface PipelineStage {
  id: string;
  rules: StageRules;
  /** Runs beside the stage before it, not after it. */
  parallel?: boolean;
  /** Stages that must have finished first (they come earlier in the file). */
  needs?: string[];
  /** Run only when these stages ended so: `{ fast: passed }`. */
  when?: Record<string, 'passed' | 'failed'>;
  /** Stages whose findings this stage is given as facts (an agent stage's bundle). */
  grounding?: string[];
  /** Said, never failing: a stage that cannot fail the pipeline. */
  advisory?: boolean;
}

export interface Pipeline { stages: PipelineStage[] }

/** A pipeline as the window, an agent and the CLI read it. */
export interface PipelineView {
  where: string;
  pipeline: Pipeline | null;
  problems: string[];
  /** Each stage in words: "fast: deterministic rules", in order. */
  words: string[];
  /** Loosenings since the last commit, waiting for a person's signed approval. */
  pending: Array<{ stage: string; words: string }>;
}
