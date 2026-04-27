/**
 * Agent skill / "how to use CodeTrellis" markdown guides.
 *
 * Surfaced via MCP resources `codetrellis://skill` (project-tailored
 * summary), `codetrellis://skill/quickstart` (first-time flow), and
 * `codetrellis://skill/power-user` (deep usage). Agents fetch these
 * on connect so they don't need out-of-band briefing.
 *
 * The guides are plain markdown so any agent that can read MCP
 * resources can ingest them — no structured schema dependency.
 */

import * as planService from '../services/plan-service';
import * as planDocsService from '../services/plan-documents-service';
import * as sessionService from '../services/session-service';

export type SkillFlavor = 'summary' | 'quickstart' | 'power-user';

export function buildSkillGuide(flavor: SkillFlavor): string {
  if (flavor === 'quickstart') return QUICKSTART;
  if (flavor === 'power-user') return POWER_USER;
  return projectStateSummary() + '\n\n' + COMMON_FOOTER;
}

function projectStateSummary(): string {
  const plans = planService.listPlans();
  const sessions = sessionService.getActiveSessions();
  const planLines = plans.length
    ? plans.slice(0, 8).map((p) => {
        const docs = planDocsService.listPlanDocumentSummaries(p.uid);
        const docTypes = [...new Set(docs.map((d) => d.docType))].join(', ') || 'no spec docs';
        return `- **${p.title}** (${p.status}, ${p.completedTaskCount ?? 0}/${p.taskCount ?? 0} tasks) — \`${p.uid}\` — docs: ${docTypes}`;
      }).join('\n')
    : '_(no plans yet — `create_plan` to author one)_';

  const sessionLines = sessions.length
    ? sessions.map((s) => `- ${s.agentType}${s.model ? ` (${s.model})` : ''} · session \`${s.sessionId}\` · plan \`${s.activePlanUid ?? 'none'}\``).join('\n')
    : '_(you appear to be the first connected agent)_';

  return `# CodeTrellis — current project state

## Plans (${plans.length})

${planLines}

## Connected agents

${sessionLines}

## What CodeTrellis does

CodeTrellis is the harness between you (the AI agent) and the human
architect. Plans live here as durable spec — you can read them via
MCP without bloating context, then claim tasks, do work, and report
back. Drift between what you said you'd do and what actually landed
is visible to the human in real time.`;
}

const COMMON_FOOTER = `## Most-used MCP tools (cheat sheet)

**Architecture queries**
- \`search_symbols(query)\` — find functions / classes by name
- \`get_dependencies(file_path)\` — imports + importedBy for a file
- \`check_architecture(query?)\` — full dependency graph (filterable)
- \`check_conformity(proposed_imports[])\` — would these imports cause cycles?
- \`list_cross_system_edges()\` — runtime couplings between files: HTTP fetches in TS/JS matched against FastAPI/Flask routes in Python (more protocols coming)

**Plans (the durable spec)**
- \`list_plans(project_path?, status?)\` — what plans exist
- \`get_plan(plan_uid)\` — full plan with tasks
- \`create_plan({title, description, project_path, tasks: [{description, affected_files?, affected_symbols?, new_connections?, removed_connections?, dependencies?, file_spec?, symbol_specs?}]})\`
- \`update_plan(plan_uid, {title?, description?, status?})\`

**Tasks**
- \`get_next_task(plan_uid, phase_uid?)\` — pick next available task; pass \`phase_uid\` to scope to one phase, empty string for unphased
- \`claim_task(plan_uid, task_uid, agent_type?, model?)\` — mark assigned to you
- \`update_task(plan_uid, task_uid, status?, phase_uid?)\` — pending / assigned / in_progress / done / blocked / skipped; \`phase_uid\` binds to phase (empty = clear)

**Phases (first-class checkpoints — optional)**
- \`add_plan_phase(plan_uid, title, phase_number?, scope?, prerequisites?, git_checkpoint?, acceptance_criteria?, status?)\` — swf-style "01 Foundation / 02 Migration / …"
- \`list_plan_phases(plan_uid)\` — phases ordered by phase_number
- \`update_plan_phase(phase_uid, ...)\` — any field; status: pending / in_progress / done / blocked
- \`delete_plan_phase(phase_uid)\` — tasks survive (phase_uid cleared)

**Plan templates (one-shot deep plan seeding)**
- \`list_plan_templates()\` — what's available
- \`create_plan_from_template(template_id, project_path, title?, description?)\` — most common: \`"mass-refactor"\` (6 phases + executive overview + per-phase docs + cross-cutting patterns/testing/security)

**Plan file sync (multi-device via git)**
- \`export_plan_to_files(plan_uid, project_root)\` — writes plan + phases + tasks + spec docs to \`<project>/.codetrellis/plans/<slug>/\`. Idempotent. Commit + push to share with the team.
- \`import_plan_from_files(plan_dir)\` — upserts a plan from disk into the DB. Use after \`git pull\` to sync external changes.
- \`discover_plan_files(project_root)\` — list every plan directory checked into the project's \`.codetrellis/plans/\`.

**Spec docs (rich shared context)**
- \`list_plan_docs(plan_uid)\` — cheap index of titles + types + lengths (no bodies)
- \`get_plan_doc(doc_uid? | plan_uid + doc_type?)\` — fetch one doc body
- \`search_plan_docs(plan_uid, query)\` — substring search with excerpts
- \`add_plan_doc(plan_uid, doc_type, title, body, order_hint?, parent_doc_uid?)\` — create new doc; \`order_hint\` "00", "01", "01.5" controls sort, \`parent_doc_uid\` nests
- \`update_plan_doc(doc_uid, body?, title?, change_summary?, order_hint?, parent_doc_uid?)\` — auto-versioned

Doc types: \`executive_summary\`, \`architecture\`, \`patterns\`,
\`examples\`, \`research\`, \`testing\`, \`security\`, \`ux_ui\`,
\`constraints\`, \`acceptance_criteria\`, \`rollout\`, \`custom\`.

**Drift / verification**
- \`get_drift_report(plan_uid)\` — what changed vs baseline; on-track / missing / unexpected
- \`detect_deviations(plan_uid)\` — run deviation detection now
- \`get_deviations(plan_uid)\` — list outstanding deviations

**Proposed changes (per-plan CRUD feed)**
- \`list_proposed_changes(plan_uid)\` — every affected file / symbol_spec / new_connection / removed_connection across all tasks, with operation, kind, target, and drift status (planned / in_progress / satisfied / missing / unexpected)
- \`get_changes_summary(plan_uid)\` — one-call counts ("12/18 satisfied")
- \`get_change_status(plan_uid, change_id)\` — fresh drift recompute for a single change

**Sessions / multi-agent**
- \`register_session(agent_type, model?)\` — identify yourself (so the human and other agents can see you)
- \`set_active_plan(plan_uid)\` — say which plan you're working on
- \`add_comment(target_uid, body, comment_type?)\` — leave a note on a plan or task

## Where to find the MCP server

The user may have moved it off the default port. Read the bound port
from \`GET http://127.0.0.1:3001/api/mcp/status\` (returns
\`{ running, port, connectedAgents }\`) or fetch the current config
snippet from \`GET /api/mcp/config\`. Hardcoding port \`19432\` will
break for users running CodeTrellis alongside another tool that grabs
that port (autodetect walks forward to 19433+).

## MCP resources you can fetch

- \`codetrellis://plans\` — all plans
- \`codetrellis://sessions\` — active agents
- \`project://graph\` — current dependency graph
- \`project://stats\` — file / symbol / import counts
- \`codetrellis://skill\` — this summary
- \`codetrellis://skill/quickstart\` — first-time flow
- \`codetrellis://skill/power-user\` — deep usage`;

const QUICKSTART = `# CodeTrellis quickstart for AI coding agents

You are connected to a CodeTrellis instance. CodeTrellis is the
human's view into what you're doing — they see the architecture, your
plans, your changes, and any drift between plan and reality, all in
real time. Operate accordingly.

## Minimum viable flow

1. **Identify yourself** — call \`register_session(agent_type='claude-code'|'codex'|'cursor'|...)\` so you appear in the connected-agents list.
2. **Find the active plan** — call \`list_plans(project_path)\` and pick the one with status \`approved\` or \`in_progress\`. If there isn't one, ask the human or read \`codetrellis://skill/power-user\` for plan authoring.
3. **Read the plan** — \`get_plan(plan_uid)\` gives you tasks. Spec docs are *separate* — fetch them granularly with \`list_plan_docs(plan_uid)\` then \`get_plan_doc(doc_uid)\` so your context stays small.
4. **Claim a task** — \`get_next_task(plan_uid)\` → \`claim_task(plan_uid, task_uid, agent_type)\`. Mark \`update_task(..., 'in_progress')\` once you start.
5. **Do the work** — read the task's \`affected_files\`, \`file_spec\`, \`symbol_specs\` for what's expected.
6. **Verify** — \`get_drift_report(plan_uid)\` tells you if your changes match the plan or drifted.
7. **Mark done** — \`update_task(plan_uid, task_uid, 'done')\`.

## What NOT to do

- Don't author files outside the task's \`affected_files\` list without first noting it via \`add_comment\` or extending the task — drift is visible to the human and unexpected changes show in red.
- Don't dump the whole plan into context. \`list_plan_docs\` returns titles + lengths only; \`get_plan_doc\` fetches one body at a time.
- Don't skip \`register_session\` — without it, your tool calls show up as anonymous \`mcp-client\` in the human's Agent Timeline.

` + COMMON_FOOTER;

const POWER_USER = `# CodeTrellis power-user guide for AI coding agents

You've already used the basics (see \`codetrellis://skill/quickstart\`).
This guide covers the deep features — phased plans, multi-agent
coordination, spec doc curation, drift verification, and the granular
task fields most plans don't bother with.

## Authoring a deep plan

Real refactors aren't a flat task list. Mass-modernisation plans look
like swf's \`docs/oms/002-oms-integration/\` shape:

\`\`\`
00-EXECUTIVE-OVERVIEW.md
01-PHASE-1-FOUNDATION.md
02-PHASE-2-...
DATA-MODEL.md
FRONTEND-AUDIT.md
TRACKER.md
testing/
\`\`\`

In CodeTrellis, you build the same shape from spec docs:

1. \`create_plan({title, description, tasks: [...]})\` — light skeleton.
2. \`add_plan_doc(plan_uid, 'executive_summary', '00 Executive Overview', '...')\` — high-level vision.
3. \`add_plan_doc(plan_uid, 'architecture', '01 Phase 1 — Foundation', '...')\` — phase 1 spec, structured with backend models / routes / frontend types / acceptance criteria.
4. Repeat per phase.
5. \`add_plan_doc(plan_uid, 'testing', 'Test strategy', '...')\` — cross-cutting.
6. \`add_plan_doc(plan_uid, 'security', 'Threat model', '...')\` — cross-cutting.

Doc bodies are markdown — use headings, tables, code blocks, task
lists. The renderer handles GFM.

## Granular task fields

When you (or the human) creates a task, you can be vague (one-line
description) OR very precise. The full task fields:

- \`description\` (required) — what the task does
- \`affected_files\` — relative paths the task touches
- \`affected_symbols\` — function / class names changed
- \`new_connections\` — \`[{from, to}]\` import edges that should appear
- \`removed_connections\` — edges that should disappear
- \`dependencies\` — other task UIDs that must complete first (DAG)
- \`file_spec\` — markdown describing what each file should do
- \`symbol_specs\` — \`[{name, kind, action: 'add'|'modify'|'remove'|'move', signature?, moveTo?}]\`

The drift system uses these to verify: did the new connection appear?
Did the removed connection actually go away? Did you only touch the
expected files?

## Drift verification (continuous)

After each batch of edits, before reporting \`done\`:

1. \`get_drift_report(plan_uid)\` — summarises on-track / missing /
   unexpected. Includes file-level + edge-level + spec-doc consultation
   counts.
2. If \`unexpected\` is non-zero — explain why in
   \`add_comment(plan_uid, body, comment_type='concern')\` so the human
   sees your reasoning. The graph will show your unexpected edges in
   red until reconciled.
3. \`detect_deviations(plan_uid)\` — re-runs deviation detection
   against the latest live state.
4. \`reconcile(plan_uid, deviations)\` — accept / revert / ignore.

## Multi-agent coordination

Multiple agents (multiple Claude Code instances, or Claude Code +
Codex side by side) can connect at once.

- \`codetrellis://sessions\` lists every connected agent right now.
- \`claim_task\` is atomic — only one agent gets a task. If another
  agent already claimed it, you get \`{ok: false}\` and should pick a
  different one.
- \`add_comment(task_uid, body, 'status_update')\` — broadcast progress
  to other agents working the same plan.
- \`set_active_plan(plan_uid)\` — declare which plan you're focused on
  so other agents know not to step on you.

If you and another agent want to touch the same file, \`claim_task\`
returns a \`conflicts\` field — surface that to the human.

## Spec docs as shared context

The spec room is the multi-agent brain. Patterns:

- Every plan should have \`executive_summary\` + \`architecture\` +
  \`acceptance_criteria\` at minimum.
- For mass refactors: add \`patterns\` (what to follow / avoid),
  \`examples\` (concrete templates), \`testing\` (coverage targets).
- For security-sensitive work: \`security\` (threat model, do-not-touch
  list) is mandatory.
- Update docs as you discover things — \`update_plan_doc(doc_uid, body,
  change_summary='discovered X')\` auto-versions.

Before starting a task, fetch the docs that match: e.g. for an auth
change, pull \`security\` and \`patterns\` first.

## Trellis snapshots

\`capture_checkpoint(plan_uid, name, project_path)\` — saves the
current architecture state as a named snapshot. Useful at phase
boundaries: "After Phase 1 — Foundation". The human can later diff
against any checkpoint.

` + COMMON_FOOTER;
