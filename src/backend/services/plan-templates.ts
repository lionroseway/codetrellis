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
];

export function listTemplates(): Array<Pick<PlanTemplate, 'id' | 'label' | 'shortDescription' | 'longDescription' | 'defaultTitle'> & { phaseCount: number; docCount: number }> {
  return PLAN_TEMPLATES.map((t) => ({
    id: t.id,
    label: t.label,
    shortDescription: t.shortDescription,
    longDescription: t.longDescription,
    defaultTitle: t.defaultTitle,
    phaseCount: t.phases.length,
    docCount: t.docs.length,
  }));
}

export function getTemplate(id: string): PlanTemplate | null {
  return PLAN_TEMPLATES.find((t) => t.id === id) ?? null;
}
