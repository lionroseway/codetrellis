/**
 * Plan templates — pre-shaped plans an agent or human can spin up in
 * one click. Each template seeds: the plan itself, a set of phases
 * (Phase 12 §A), and a set of spec docs (Phase 12 §C with orderHint /
 * parentDocUid). Templates are pure data — adding a new template means
 * appending a new entry to PLAN_TEMPLATES, no schema or service
 * changes required.
 *
 * The first template models the swf "002-oms-integration" shape: a
 * mass refactor with executive overview, six numbered phase docs, plus
 * cross-cutting patterns / testing / security docs.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { PhaseStatus, PlanDocType } from '../../shared/types';

export interface PlanTemplatePhase {
  phaseNumber: number;
  title: string;
  scope?: string;
  prerequisites?: string;
  acceptanceCriteria?: string;
  status?: PhaseStatus;
  /** Optional task scaffolds — created with phase_uid bound. */
  tasks?: Array<{
    description: string;
    affectedFiles?: string[];
  }>;
}

export interface PlanTemplateDoc {
  docType: PlanDocType | string;
  title: string;
  body: string;
  /** Sortable string used by the spec room tree render. */
  orderHint?: string;
  /**
   * Reference to a parent doc by its `key` field within this template.
   * Resolved to a real `parentDocUid` when the template is applied.
   */
  parentKey?: string;
  /** Stable key inside this template, used for parentKey wiring. */
  key?: string;
}

/**
 * A `{{key}}` placeholder a template declares. Substituted in every
 * string field (titles, descriptions, scope, doc bodies) at apply
 * time. `default` is used when the user doesn't fill it in.
 */
export interface PlanTemplatePlaceholder {
  key: string;
  label?: string;
  default?: string;
}

export type PlanTemplateSource = 'builtin' | 'project' | 'user';

export interface PlanTemplate {
  id: string;
  label: string;
  shortDescription: string;
  /**
   * Default plan title — the user can override in the create modal.
   * Use `{name}` placeholder to interpolate something the user types.
   */
  defaultTitle: string;
  /** Free-form description shown in the picker tooltip. */
  longDescription: string;
  defaultPlanDescription: string;
  phases: PlanTemplatePhase[];
  docs: PlanTemplateDoc[];
  /** §C: where this template came from. */
  source?: PlanTemplateSource;
  /** §C: optional user-fillable placeholders. */
  placeholders?: PlanTemplatePlaceholder[];
}

const MASS_REFACTOR_OVERVIEW = `# Mass refactor — executive overview

This plan is a **deep-mode** plan (Phase 12 §A): instead of a flat
list of tasks, it's broken into six phases that run mostly in
sequence. Each phase has its own scope, prerequisites, git
checkpoint, and acceptance criteria — bind tasks to a phase via
\`update_task(..., phase_uid)\` and pull the next available task with
\`get_next_task(plan_uid, phase_uid?)\`.

## Why the swf shape

This template mirrors swf's \`docs/oms/002-oms-integration/\`
structure so multiple agents working in parallel can share rich
context: a numbered overview, one doc per phase, plus cross-cutting
patterns / testing / security guidance. Read the relevant
phase doc + the patterns + testing docs before claiming a task.

## How to operate

1. Read the executive overview (this doc) end-to-end.
2. Read the phase doc for the phase you're about to work in.
3. Skim **Patterns** + **Testing strategy**; they apply across phases.
4. \`get_next_task(plan_uid, phase_uid)\` to pick a task.
5. \`claim_task(plan_uid, task_uid)\` then \`update_task(..., 'in_progress')\`.
6. Implement, then \`get_drift_report(plan_uid)\` before marking done.

## Out of scope

(fill this in — what this refactor explicitly does NOT touch)
`;

const PHASE_DOC_BODY = (n: number, title: string) => `# ${String(n).padStart(2, '0')} — ${title}

## Scope

(what this phase covers — e.g. backend models, routes, frontend types)

## Prerequisites

(what must be done before this phase starts)

## Plan of attack

1.
2.
3.

## Backend changes

### Models

### Routes / handlers

### Services

## Frontend changes

### Types

### API client

### Components

## Testing

### Unit

### Integration

### Manual smoke

## Acceptance criteria

- [ ]
- [ ]
- [ ]

## Git checkpoint

Tag: \`<your-prefix>-${String(n).padStart(2, '0')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`
`;

const PATTERNS_DOC = `# Patterns to follow

## Code style

-

## Naming

-

## File organisation

-

# Anti-patterns to avoid

-
`;

const TESTING_DOC = `# Testing strategy

## Coverage targets

| Area | Target | Notes |
|---|---|---|
| Models | 90% line | Core data layer |
| Routes | 80% endpoint | Each endpoint must have ≥1 happy path + ≥1 error path |
| UI components | Smoke render | Snapshot is fine |

## Per-phase strategy

- **01 Foundation** — types compile, lints clean, no functional tests required yet
- **02 Data layer** — model unit tests + a migration round-trip test
- **03 API** — route integration tests covering happy + auth + error paths
- **04 Frontend** — component smoke tests + e2e for critical flows
- **05 Integration** — e2e covering the full cross-system flow
- **06 Cutover** — pre/post-deploy smoke; rollback rehearsal

## Fixtures / mocks

-
`;

const SECURITY_DOC = `# Security threat model

## Surface area changes

(what new attack surface this refactor introduces)

## Sensitive data paths

(which paths handle credentials / PII / financial data)

## Do-not-touch

(files, endpoints, secrets that must not be modified by this plan)

## Per-phase checks

- **01 Foundation** —
- **02 Data layer** —
- **03 API** — auth on every new endpoint; rate limits where applicable
- **04 Frontend** — XSS-safe rendering; avoid leaking IDs in URLs
- **05 Integration** —
- **06 Cutover** — rotate any new secrets before turning on traffic
`;

const ARCHITECTURE_DOC = `# Architecture overview

## Components touched by this refactor

| Component | Role | Phase that changes it |
|---|---|---|
|  |  |  |

## Data flow

(diagram or prose — how data moves between the components above)

## New connections this introduces

-

## Connections this removes

-

## Boundaries

(what's the contract between the touched components and everything else)
`;

// --- Lighter-weight templates ---
//
// `mass-refactor` (below) is the deep-mode template. The four below
// are right-sized for everyday work — fewer phases, lighter docs,
// no need for executive-summary scaffolding. They use placeholders
// so the create-plan modal can ask for the salient input up front.

const NEW_FEATURE_REQUIREMENTS = `# Requirements — {{feature}}

## What this feature does

(one-paragraph description in plain language)

## User stories

- As a [user type], I want to [goal] so that [benefit]
- ...

## Success criteria

- [ ]
- [ ]

## Out of scope

(what this feature explicitly does NOT do — anti-scope)

## Open questions

-
`;

const NEW_FEATURE_DESIGN = `# Design — {{feature}}

## High-level approach

(2-3 sentences on the chosen approach + why)

## New files / modules

| Path | Role |
|---|---|
| | |

## Modified files

| Path | Change |
|---|---|
| | |

## Data model changes

(new tables / columns / types — link to migration if applicable)

## API surface

| Method | Path | Purpose |
|---|---|---|
| | | |

## UI surface

(screens / components affected)
`;

const NEW_FEATURE_UX = `# UX journey — {{feature}}

## Entry point

(how the user discovers / triggers this feature)

## Happy path

1.
2.
3.

## Empty / loading / error states

| State | What user sees |
|---|---|
| First-time / empty | |
| Loading | |
| Error | |

## Cross-references

(other features / screens that link to this one or are linked from it)
`;

const NEW_FEATURE_TESTING = `# Testing — {{feature}}

## Unit

-

## Integration

-

## Manual / e2e

| Scenario | Steps | Expected |
|---|---|---|
| | | |
`;

const BUG_FIX_REPORT = `# Bug — {{bug}}

## Symptom

(what the user sees that's wrong)

## Reproduction

1.
2.
3.

**Expected**:
**Actual**:

## Affected area

{{area}}

## First reported

(date / version / customer)

## Severity

- [ ] Blocker — production down or data loss
- [ ] High — common path broken
- [ ] Medium — workaround exists
- [ ] Low — cosmetic
`;

const BUG_FIX_ROOT_CAUSE = `# Root cause hypothesis

## Suspected files / functions

- {{area}}

## Why it happens

(one-paragraph hypothesis — disprove if possible)

## Why we didn't catch it

(missing test? missing type guard? missing review checklist?)

## Related code

(grep / xref hits — places that look similar and might also be broken)
`;

const BUG_FIX_REGRESSION = `# Regression test

## Test that would have caught this

(unit / integration / e2e — and where in the suite it should live)

## Test fixture

\`\`\`
(input)
\`\`\`

\`\`\`
(expected output)
\`\`\`

## Other tests to add or strengthen

(if the bug class suggests a missing pattern of coverage)
`;

const LIB_MIG_OVERVIEW = `# Library migration — {{from_library}} → {{to_library}}

## Why migrate

(perf / maintenance / sunset / API improvements / bundle size — be specific)

## Risk profile

| Dimension | Old | New | Risk |
|---|---|---|---|
| Maintenance status | | | |
| Bundle size | | | |
| Breaking changes | | | |
| Type safety | | | |

## Migration strategy

- [ ] **Big bang** — replace everywhere at once. Choose only if blast radius is small.
- [ ] **Adapter** — wrap old behind a thin adapter, swap implementations one callsite at a time. Default for non-trivial migrations.
- [ ] **Strangler** — both old and new live side-by-side; flag-flip per code path. For very large or risky migrations.

## Rollback plan

(what triggers rollback, how to roll back, what's lost)
`;

const LIB_MIG_COMPAT = `# Compatibility matrix — {{from_library}} vs {{to_library}}

| {{from_library}} API | {{to_library}} equivalent | Notes |
|---|---|---|
| | | |
| | | |

## Behaviours that change

(silent semantic differences — places where calling code "looks the same" but does something subtly different)

## Behaviours that disappear

(deprecated APIs with no replacement — list each callsite that needs custom handling)
`;

const LIB_MIG_ROLLOUT = `# Rollout plan

## Order of callsites

(why this order — usually: smallest / lowest-risk first, hottest path last)

| Order | Callsite | Owner | Notes |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

## Verification per step

(what test confirms the migrated callsite still works — and that the rest of the app didn't regress)

## Coexistence

(can old and new run in the same process? if not, what's the cut?)
`;

const PERF_BUDGET = `# Performance budget — {{target_metric}}

## Goal

Target **{{target_metric}} ≤ {{target_value}}** on the {{benchmark}} workload.

## Why this metric

(p95 latency? cold-start time? bundle size? memory under load? — pick the one that matters to users and explain)

## Out of scope

(metrics that this pass explicitly does NOT optimise; tradeoffs we'll accept)
`;

const PERF_BASELINE = `# Baseline measurements

## Reproducer

\`\`\`bash
(exact command / steps to measure — must be repeatable on a clean machine)
\`\`\`

## Current numbers

| Run | {{target_metric}} | Notes |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| **Median** | | |

## Hardware / env

(machine, OS, node version, etc.)

## Sub-metrics

(CPU? memory? syscalls? — anything that helps narrow the hotspot before profiling)
`;

const PERF_HOTSPOTS = `# Hotspot inventory

## Profiler output

(paste flame graph / sampled stack — at minimum, top-10 by self-time)

## Suspect functions / files

| Function / file | Why suspected | Estimated win |
|---|---|---|
| | | |

## Anti-suspects

(places that look hot but are likely not — saves wasted optimisation effort)

## Picked first

(which hotspot we're tackling first + why — usually highest estimated win × lowest risk)
`;

const PERF_VERIFY = `# Verification

## Re-measurement script

(same command as baseline — copy-paste-able)

## Acceptance

| Run | {{target_metric}} | Δ vs baseline | Notes |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| **Median** | | | |

## Regression guard

(microbenchmark / CI assertion that fails if the metric backslides above the new ceiling — without this, the win decays in 2 sprints)

## What we didn't do

(optimisations considered but skipped — and why; future-you will want this list)
`;

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'mass-refactor',
    label: 'Mass refactor (swf-style)',
    shortDescription: '6-phase modernization with executive overview, per-phase docs, patterns/testing/security guidance.',
    longDescription: `Models swf's \`docs/oms/002-oms-integration/\` shape: 1 executive overview + 6 numbered phase docs + 1 architecture overview + cross-cutting patterns / testing / security. Each phase is a first-class checkpoint with scope, prereqs, git checkpoint, and acceptance criteria — built for multiple agents working in parallel on a long migration.`,
    defaultTitle: 'Mass refactor: {name}',
    defaultPlanDescription: 'Deep-mode plan with phases. Read the executive overview first, then the phase doc you\'re about to work in.',
    phases: [
      { phaseNumber: 1, title: 'Foundation', scope: 'Set up shared types, packages, lint config, CI gates. No behavior changes yet.', acceptanceCriteria: '- [ ] Types compile across all packages\n- [ ] Lint and CI pass on the new structure\n' },
      { phaseNumber: 2, title: 'Data layer', scope: 'New / migrated models, schema migrations, seed data.', prerequisites: 'Phase 01 complete.', acceptanceCriteria: '- [ ] Migrations run forward and reverse cleanly\n- [ ] Model unit tests cover happy + edge cases\n' },
      { phaseNumber: 3, title: 'API', scope: 'New / refactored endpoints, auth wiring, error handling.', prerequisites: 'Phase 02 data layer in place.', acceptanceCriteria: '- [ ] Every new endpoint has auth\n- [ ] Integration tests cover happy + auth + error paths\n' },
      { phaseNumber: 4, title: 'Frontend', scope: 'Types, API client, components, screens.', prerequisites: 'Phase 03 endpoints stable.', acceptanceCriteria: '- [ ] Components compile and lint\n- [ ] Critical-flow e2e passes\n' },
      { phaseNumber: 5, title: 'Integration', scope: 'End-to-end cross-system flows, sync / orchestration jobs.', prerequisites: 'Phases 02–04 deployable to staging.', acceptanceCriteria: '- [ ] Full cross-system flow passes in staging\n- [ ] Drift report clean against the plan\n' },
      { phaseNumber: 6, title: 'Cutover', scope: 'Feature flags off → on, traffic migration, decommission of the old path.', prerequisites: 'Phase 05 integration green for at least 24h.', acceptanceCriteria: '- [ ] Old path code-paths removed\n- [ ] Rollback rehearsed and documented\n' },
    ],
    docs: [
      { key: 'overview', orderHint: '00', docType: 'executive_summary', title: '00 — Executive overview', body: MASS_REFACTOR_OVERVIEW },
      { key: 'arch', orderHint: '00.5', docType: 'architecture', title: 'Architecture overview', body: ARCHITECTURE_DOC },
      { key: 'phase1', orderHint: '01', docType: 'architecture', title: '01 — Foundation', body: PHASE_DOC_BODY(1, 'Foundation') },
      { key: 'phase2', orderHint: '02', docType: 'architecture', title: '02 — Data layer', body: PHASE_DOC_BODY(2, 'Data layer') },
      { key: 'phase3', orderHint: '03', docType: 'architecture', title: '03 — API', body: PHASE_DOC_BODY(3, 'API') },
      { key: 'phase4', orderHint: '04', docType: 'architecture', title: '04 — Frontend', body: PHASE_DOC_BODY(4, 'Frontend') },
      { key: 'phase5', orderHint: '05', docType: 'architecture', title: '05 — Integration', body: PHASE_DOC_BODY(5, 'Integration') },
      { key: 'phase6', orderHint: '06', docType: 'architecture', title: '06 — Cutover', body: PHASE_DOC_BODY(6, 'Cutover') },
      { key: 'patterns', orderHint: '90', docType: 'patterns', title: 'Patterns', body: PATTERNS_DOC },
      { key: 'testing', orderHint: '91', docType: 'testing', title: 'Testing strategy', body: TESTING_DOC },
      { key: 'security', orderHint: '92', docType: 'security', title: 'Security threat model', body: SECURITY_DOC },
    ],
  },
  {
    id: 'new-feature',
    label: 'New feature',
    shortDescription: 'Three-phase scaffold for adding a feature: design → implementation → testing.',
    longDescription: 'Lighter than mass-refactor — for net-new features. Seeds a requirements doc, design doc, UX journey, and testing plan, plus three phases that map cleanly to "decide → build → ship". Use the `{{feature}}` placeholder to give the plan a name in one place.',
    defaultTitle: 'Feature: {{feature}}',
    defaultPlanDescription: 'Add a new feature. Read the requirements + design docs first, then pick up tasks from the Implementation phase.',
    placeholders: [
      { key: 'feature', label: 'Feature name', default: '<the feature>' },
    ],
    phases: [
      {
        phaseNumber: 1,
        title: 'Design',
        scope: 'Lock down requirements, design, and UX journey. No code yet.',
        acceptanceCriteria: '- [ ] Requirements doc complete (success criteria + out-of-scope filled in)\n- [ ] Design doc lists every new / modified file\n- [ ] UX journey covers happy path + empty / loading / error states\n',
      },
      {
        phaseNumber: 2,
        title: 'Implementation',
        scope: 'Build the feature against the design doc. Backend first if there\'s a data layer, then API, then UI.',
        prerequisites: 'Phase 1 design signed off.',
        acceptanceCriteria: '- [ ] Every file listed in the design doc exists\n- [ ] Lints + typechecks clean\n- [ ] Drift report against the plan: clean\n',
      },
      {
        phaseNumber: 3,
        title: 'Testing & polish',
        scope: 'Tests for every path in the testing doc, accessibility pass, copy review, telemetry hooks if applicable.',
        prerequisites: 'Phase 2 implementation complete and self-tested.',
        acceptanceCriteria: '- [ ] Unit + integration tests for every callout in the testing doc\n- [ ] Manual happy path passes on a clean install\n- [ ] No new "(TODO)" or "(fix me)" comments left in the diff\n',
      },
    ],
    docs: [
      { key: 'requirements', orderHint: '00', docType: 'acceptance_criteria', title: 'Requirements', body: NEW_FEATURE_REQUIREMENTS },
      { key: 'design', orderHint: '01', docType: 'architecture', title: 'Design', body: NEW_FEATURE_DESIGN },
      { key: 'ux', orderHint: '02', docType: 'ux_ui', title: 'UX journey', body: NEW_FEATURE_UX },
      { key: 'testing', orderHint: '03', docType: 'testing', title: 'Testing', body: NEW_FEATURE_TESTING },
    ],
  },
  {
    id: 'bug-fix',
    label: 'Bug fix',
    shortDescription: 'Lean two-phase template: investigate → fix-with-regression-test.',
    longDescription: 'Built for "something is wrong, find it, fix it, prove it stays fixed". Three docs (bug report, root-cause hypothesis, regression test) and two phases. Use `{{bug}}` for the short description and `{{area}}` to point investigators at the suspected module.',
    defaultTitle: 'Bug: {{bug}}',
    defaultPlanDescription: 'Reproduce, root-cause, fix, and add a regression test. Don\'t mark done without the regression test.',
    placeholders: [
      { key: 'bug', label: 'Bug summary', default: '<one-line description>' },
      { key: 'area', label: 'Suspected area', default: '<file or module to start in>' },
    ],
    phases: [
      {
        phaseNumber: 1,
        title: 'Investigate',
        scope: 'Reproduce reliably, identify the root cause, decide the fix shape.',
        acceptanceCriteria: '- [ ] Reliable reproduction documented\n- [ ] Root cause confirmed (not just hypothesised)\n- [ ] Fix approach agreed (with one alternative considered + rejected)\n',
      },
      {
        phaseNumber: 2,
        title: 'Fix + regression',
        scope: 'Apply the fix, write a regression test that fails on the bug and passes on the fix, ship.',
        prerequisites: 'Phase 1 root cause confirmed.',
        acceptanceCriteria: '- [ ] Fix applied, scoped to the root cause\n- [ ] Regression test fails on `git stash` of the fix and passes with it\n- [ ] No nearby suspects left untouched (check the "related code" section)\n',
      },
    ],
    docs: [
      { key: 'report', orderHint: '00', docType: 'executive_summary', title: 'Bug report', body: BUG_FIX_REPORT },
      { key: 'rootcause', orderHint: '01', docType: 'research', title: 'Root cause', body: BUG_FIX_ROOT_CAUSE },
      { key: 'regression', orderHint: '02', docType: 'testing', title: 'Regression test', body: BUG_FIX_REGRESSION },
    ],
  },
  {
    id: 'library-migration',
    label: 'Library migration',
    shortDescription: 'Four-phase scaffold for swapping a dependency: audit → adapter → per-callsite → decommission.',
    longDescription: 'For replacing or upgrading a dependency that touches many callsites. Strategy is configurable (big-bang vs adapter vs strangler — picked in the overview doc). Use `{{from_library}}` and `{{to_library}}` placeholders. The compatibility matrix doc forces you to think through silent-semantic-change traps before code touches any callsite.',
    defaultTitle: 'Migrate {{from_library}} → {{to_library}}',
    defaultPlanDescription: 'Replace a dependency without breaking anything. The compatibility matrix is the most important doc — fill it in honestly before touching any callsite.',
    placeholders: [
      { key: 'from_library', label: 'From (current library)', default: '<old-lib>' },
      { key: 'to_library', label: 'To (new library)', default: '<new-lib>' },
    ],
    phases: [
      {
        phaseNumber: 1,
        title: 'Audit',
        scope: 'Inventory every callsite of {{from_library}}, document API differences, pick a migration strategy.',
        acceptanceCriteria: '- [ ] Compatibility matrix complete\n- [ ] Migration strategy chosen + documented\n- [ ] Rollback plan written\n',
      },
      {
        phaseNumber: 2,
        title: 'Adapter / scaffolding',
        scope: 'If the strategy is "adapter," build the adapter layer + tests. If "strangler," set up the flag plumbing. If "big bang," skip — but reconsider the strategy.',
        prerequisites: 'Phase 1 audit complete.',
        acceptanceCriteria: '- [ ] Adapter / flag plumbing in place\n- [ ] One pilot callsite migrated through the adapter and proven equivalent\n',
      },
      {
        phaseNumber: 3,
        title: 'Per-callsite migration',
        scope: 'Walk the rollout-plan order. One callsite per task; tests for each before moving on.',
        prerequisites: 'Phase 2 pilot green.',
        acceptanceCriteria: '- [ ] Every callsite migrated\n- [ ] Per-callsite verification passing\n- [ ] No regressions in the rest of the suite\n',
      },
      {
        phaseNumber: 4,
        title: 'Decommission',
        scope: 'Remove the adapter, drop {{from_library}} from package.json, prove no leftover imports.',
        prerequisites: 'Phase 3 complete + at least 24h of staging soak.',
        acceptanceCriteria: '- [ ] `{{from_library}}` removed from dependencies\n- [ ] `grep` for `{{from_library}}` in src/ returns nothing meaningful\n- [ ] Bundle size measured before / after\n',
      },
    ],
    docs: [
      { key: 'overview', orderHint: '00', docType: 'executive_summary', title: 'Migration overview', body: LIB_MIG_OVERVIEW },
      { key: 'compat', orderHint: '01', docType: 'architecture', title: 'Compatibility matrix', body: LIB_MIG_COMPAT },
      { key: 'rollout', orderHint: '02', docType: 'rollout', title: 'Rollout plan', body: LIB_MIG_ROLLOUT },
    ],
  },
  {
    id: 'perf-pass',
    label: 'Performance pass',
    shortDescription: 'Measure → identify → fix → verify, with a regression guard at the end.',
    longDescription: 'Forces you to measure first and verify last. Four phases that match the only good way to do perf work: baseline measurement, hotspot identification, fix, then re-measurement + a regression guard so the win doesn\'t silently decay. Use `{{target_metric}}` (e.g. "p95 cold-start time") and `{{target_value}}` (e.g. "<400 ms") to set the budget up front.',
    defaultTitle: 'Perf pass: {{target_metric}}',
    defaultPlanDescription: 'Don\'t optimise without measuring. The baseline is the contract; the regression guard is the win.',
    placeholders: [
      { key: 'target_metric', label: 'Target metric', default: 'p95 latency' },
      { key: 'target_value', label: 'Target value', default: '<400 ms' },
      { key: 'benchmark', label: 'Benchmark workload', default: 'production-replay' },
    ],
    phases: [
      {
        phaseNumber: 1,
        title: 'Baseline',
        scope: 'Lock the metric, lock the workload, capture current numbers reproducibly.',
        acceptanceCriteria: '- [ ] Reproducer command documented\n- [ ] Median of ≥3 runs recorded\n- [ ] Sub-metrics captured (CPU / memory / syscalls etc.)\n',
      },
      {
        phaseNumber: 2,
        title: 'Identify hotspots',
        scope: 'Profile, surface the suspects, pick the highest-leverage hotspot first.',
        prerequisites: 'Phase 1 baseline locked.',
        acceptanceCriteria: '- [ ] Profile output captured + reviewed\n- [ ] Top suspects ranked by estimated win\n- [ ] First hotspot picked with a written estimate\n',
      },
      {
        phaseNumber: 3,
        title: 'Fix',
        scope: 'Apply the optimisation. One hotspot per task. Don\'t rewrite anything that wasn\'t in the suspect list.',
        prerequisites: 'Phase 2 hotspot picked.',
        acceptanceCriteria: '- [ ] Fix is scoped to the picked hotspot\n- [ ] Local micro-benchmark shows the expected win\n- [ ] No new abstraction layers added "while we\'re in here"\n',
      },
      {
        phaseNumber: 4,
        title: 'Verify + guard',
        scope: 'Re-measure on the same reproducer, write a regression guard so future commits can\'t silently undo the win.',
        prerequisites: 'Phase 3 fix landed.',
        acceptanceCriteria: '- [ ] Re-measured median meets {{target_value}}\n- [ ] Regression guard wired (microbenchmark in CI / perf assertion)\n- [ ] "What we didn\'t do" list filled in for future-us\n',
      },
    ],
    docs: [
      { key: 'budget', orderHint: '00', docType: 'constraints', title: 'Performance budget', body: PERF_BUDGET },
      { key: 'baseline', orderHint: '01', docType: 'research', title: 'Baseline measurements', body: PERF_BASELINE },
      { key: 'hotspots', orderHint: '02', docType: 'research', title: 'Hotspot inventory', body: PERF_HOTSPOTS },
      { key: 'verify', orderHint: '03', docType: 'testing', title: 'Verification', body: PERF_VERIFY },
    ],
  },
];

/**
 * Templates discovered on disk (project-local + user-global) merged
 * with built-ins. Same `source` field tells the UI which bucket they
 * came from. Project-local wins when an id collides — lets a team
 * override a built-in or a global template per-project.
 */
export function listTemplates(projectRoot?: string): Array<Pick<PlanTemplate, 'id' | 'label' | 'shortDescription' | 'longDescription' | 'defaultTitle' | 'source' | 'placeholders'> & { phaseCount: number; docCount: number }> {
  const all = collectTemplates(projectRoot);
  return all.map((t) => ({
    id: t.id,
    label: t.label,
    shortDescription: t.shortDescription,
    longDescription: t.longDescription,
    defaultTitle: t.defaultTitle,
    source: t.source ?? 'builtin',
    placeholders: t.placeholders,
    phaseCount: t.phases.length,
    docCount: t.docs.length,
  }));
}

export function getTemplate(id: string, projectRoot?: string): PlanTemplate | null {
  return collectTemplates(projectRoot).find((t) => t.id === id) ?? null;
}

// --- Disk template loading (Phase 13 §C) ---

/**
 * Walk built-ins + project + user template dirs, returning a
 * deduplicated list. Project templates win ID collisions, then
 * user-global, then built-in.
 */
function collectTemplates(projectRoot?: string): PlanTemplate[] {
  const byId = new Map<string, PlanTemplate>();

  // Built-ins first; lower priority — overridable.
  for (const t of PLAN_TEMPLATES) {
    byId.set(t.id, { ...t, source: 'builtin' });
  }

  // User-global next: ~/.codetrellis/templates/<id>/
  for (const t of loadTemplatesFromDir(path.join(os.homedir(), '.codetrellis', 'templates'), 'user')) {
    byId.set(t.id, t);
  }

  // Project-local last (highest priority): <projectRoot>/.codetrellis/templates/<id>/
  if (projectRoot) {
    for (const t of loadTemplatesFromDir(path.join(projectRoot, '.codetrellis', 'templates'), 'project')) {
      byId.set(t.id, t);
    }
  }

  return [...byId.values()];
}

function loadTemplatesFromDir(dir: string, source: PlanTemplateSource): PlanTemplate[] {
  if (!fs.existsSync(dir)) return [];
  const out: PlanTemplate[] = [];
  for (const entry of safeReaddir(dir)) {
    const tplDir = path.join(dir, entry);
    let stat;
    try { stat = fs.statSync(tplDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const yamlPath = path.join(tplDir, 'template.yaml');
    if (!fs.existsSync(yamlPath)) continue;
    try {
      const tpl = readTemplate(tplDir, source);
      if (tpl) out.push(tpl);
    } catch (err) {
      console.warn(`[Templates] Failed to load ${tplDir}:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

/**
 * Read one `<dir>/template.yaml` (+ referenced markdown files) into
 * a PlanTemplate. The format is intentionally close to PLAN-EXPORT's
 * plan format — anything we'd export from a real plan can also be a
 * template, just with placeholders sprinkled through string fields.
 */
function readTemplate(tplDir: string, source: PlanTemplateSource): PlanTemplate | null {
  const yamlPath = path.join(tplDir, 'template.yaml');
  const raw = parseYaml(fs.readFileSync(yamlPath, 'utf-8'));
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.id || !raw.label) return null;

  const docs: PlanTemplateDoc[] = [];
  for (const d of (raw.docs as any[]) ?? []) {
    if (!d) continue;
    let body = typeof d.body === 'string' ? d.body : '';
    if (!body && typeof d.bodyPath === 'string') {
      const bodyFile = path.join(tplDir, d.bodyPath);
      if (fs.existsSync(bodyFile)) {
        body = fs.readFileSync(bodyFile, 'utf-8');
      }
    }
    docs.push({
      docType: String(d.docType ?? 'custom'),
      title: String(d.title ?? ''),
      body,
      orderHint: typeof d.orderHint === 'string' ? d.orderHint : undefined,
      parentKey: typeof d.parentKey === 'string' ? d.parentKey : undefined,
      key: typeof d.key === 'string' ? d.key : undefined,
    });
  }

  const phases: PlanTemplatePhase[] = ((raw.phases as any[]) ?? []).map((p) => ({
    phaseNumber: Number(p.phaseNumber ?? 1),
    title: String(p.title ?? ''),
    scope: typeof p.scope === 'string' ? p.scope : undefined,
    prerequisites: typeof p.prerequisites === 'string' ? p.prerequisites : undefined,
    acceptanceCriteria: typeof p.acceptanceCriteria === 'string' ? p.acceptanceCriteria : undefined,
    status: p.status,
    tasks: Array.isArray(p.tasks) ? p.tasks : undefined,
  }));

  const placeholders: PlanTemplatePlaceholder[] = ((raw.placeholders as any[]) ?? [])
    .filter((p) => p && typeof p.key === 'string')
    .map((p) => ({
      key: String(p.key),
      label: typeof p.label === 'string' ? p.label : undefined,
      default: typeof p.default === 'string' ? p.default : undefined,
    }));

  return {
    id: String(raw.id),
    label: String(raw.label),
    shortDescription: String(raw.shortDescription ?? ''),
    longDescription: String(raw.longDescription ?? ''),
    defaultTitle: String(raw.defaultTitle ?? raw.label),
    defaultPlanDescription: String(raw.defaultPlanDescription ?? ''),
    phases,
    docs,
    placeholders: placeholders.length ? placeholders : undefined,
    source,
  };
}

function safeReaddir(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}

/**
 * Substitute `{{key}}` placeholders in every string field of a
 * template. Used by `applyTemplate` once the user has filled in
 * values. Pure — returns a new template, doesn't mutate.
 */
export function substitutePlaceholders(
  template: PlanTemplate,
  values: Record<string, string>,
): PlanTemplate {
  const sub = (s: string | undefined): string | undefined => {
    if (typeof s !== 'string') return s;
    return s.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? `{{${k}}}`);
  };
  return {
    ...template,
    label: sub(template.label) ?? template.label,
    defaultTitle: sub(template.defaultTitle) ?? template.defaultTitle,
    defaultPlanDescription: sub(template.defaultPlanDescription) ?? template.defaultPlanDescription,
    phases: template.phases.map((p) => ({
      ...p,
      title: sub(p.title) ?? p.title,
      scope: sub(p.scope),
      prerequisites: sub(p.prerequisites),
      acceptanceCriteria: sub(p.acceptanceCriteria),
      tasks: p.tasks?.map((t) => ({
        ...t,
        description: sub(t.description) ?? t.description,
        affectedFiles: t.affectedFiles?.map((f) => sub(f) ?? f),
      })),
    })),
    docs: template.docs.map((d) => ({
      ...d,
      title: sub(d.title) ?? d.title,
      body: sub(d.body) ?? d.body,
    })),
  };
}
