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
