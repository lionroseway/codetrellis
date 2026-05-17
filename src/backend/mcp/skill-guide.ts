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

CodeTrellis uses a unified **Object / Action** model inside plans
(Phase 15 §C). Both nest freely in one tree — depth is the user's
call. **Objects** carry context (markdown body, references,
attachments). **Actions** are graph-anchored work items with status,
progress, and CRUD intent on files / symbols / edges. A "phase" is
just an Action with \`template='phase'\` that groups child Actions.

**Architecture queries**
- \`search_symbols(query)\` — find functions / classes by name
- \`get_dependencies(file_path)\` — imports + importedBy for a file
- \`check_architecture(query?)\` — full dependency graph (filterable)
- \`check_conformity(proposed_imports[])\` — would these imports cause cycles?
- \`list_cross_system_edges()\` — runtime couplings between files: HTTP fetches in TS/JS matched against FastAPI/Flask routes in Python (more protocols coming)

**Plan items (the unified Object/Action surface)**
- \`add_item(plan_uid, kind, parent_uid?, title, body?, template?, ...)\` — \`kind: 'object' | 'action'\`. Action-only fields (status, file_specs, scope_path, …) silently ignored on Objects.
- \`get_item(uid)\` — single row, no children / comments / attachments
- \`read_item_full(uid)\` — **one round-trip context bundle**: item + parent + immediate children + attachments + comments + recent versions. Use when picking up an Action.
- \`update_item(uid, ...)\` — content edits write a \`plan_item_versions\` row; structural edits (\`parent_uid\`, \`sort_order\`) emit \`plan_events\`. Pass empty string to clear nullable fields.
- \`move_item(uid, new_parent_uid?, new_sort_order?)\` — atomic re-parent + reorder; single event.
- \`delete_item(uid, cascade?)\` — soft-deletes the subtree (full snapshot in event's before_state for restore).
- \`claim_item(uid, agent_type, model?)\` — Action-only atomic claim. Returns full context blob in success payload + conflicts list when other in-progress Actions touch overlapping files.
- \`list_items(plan_uid, parent_uid?, kind?)\` — cheap tree query (title + kind + status + childCount, no bodies).
- \`get_plan_timeline(plan_uid, since_ms?, kinds?, limit?)\` — append-only \`plan_events\` log: every move / rename / status change. Drives the activity rail + timeline scrubber.
- \`restore_item_version(uid, version)\` — restore body + meta from a prior version; emits \`item_restored\` event.

**Item chatter (first-class agent ↔ human channel)**
- \`add_item_comment(uid, kind, body, parent_comment_uid?)\` — \`kind: 'note' | 'blocker' | 'progress' | 'question'\`. Threads via \`parent_comment_uid\`.
- \`list_item_comments(uid)\` — flat ordered list. **Always read this before continuing an Action** — humans / other agents may have left context.
- \`update_item_progress(uid, percent, message?)\` — heartbeat. Updates \`progressPercent\` + emits a \`kind=progress\` comment with \`metadata.progressPercent\`. Call frequently during long Actions.
- \`set_item_blocked(uid, reason)\` — flips status → blocked, stores blockedReason, emits a \`kind=blocker\` comment. **Prefer this over silently stopping.**
- \`add_item_attachment(uid, kind, value, label?, content_type?, data_base64?, project_root?)\` — \`kind: 'url' | 'image' | 'file_ref' | 'code_block' | 'transcript'\`. For raw image bytes, pass \`data_base64\` + \`project_root\` and the file lands under \`<project_root>/.codetrellis/attachments/<item_uid>/\`.

**Plans (the durable spec)**
- \`list_plans(project_path?, status?)\` — what plans exist
- \`get_plan(plan_uid)\` — full plan with tasks
- \`create_plan({title, description, project_path, tasks: [{description, affected_files?, affected_symbols?, new_connections?, removed_connections?, dependencies?, file_spec?, symbol_specs?}]})\`
- \`update_plan(plan_uid, {title?, description?, status?})\`

**Tasks (Phase 14 §A — task is "todo + context blob")**
- \`get_next_task(plan_uid, phase_uid?)\` — pick next available task; pass \`phase_uid\` to scope to one phase, empty string for unphased
- \`claim_task(plan_uid, task_uid, agent_type?, model?)\` — atomically mark assigned to you AND get full context (body, prompt, fileSpecs, attachments, comments, subtasks) in one round-trip. **Always start with this when picking up a task** — no follow-up read needed.
- \`read_task_full(task_uid)\` — same payload as the post-claim \`claim_task\` response, without claiming. Use when revisiting a task you already own.
- \`update_task(plan_uid, task_uid, status?, phase_uid?, description?, body?, prompt?, scope_path?, file_specs?, parent_task_uid?)\` — status (pending / assigned / in_progress / done / blocked / skipped) AND any task-as-context field. Phase 14 §A also accepts \`body\` (markdown design notes), \`prompt\` (literally-paste-at-agent), \`scope_path\` (folder root), \`file_specs\` (CRUD intent on file ops; \`affected_files\` is derived), and \`parent_task_uid\` (subtask binding).
- \`update_task_progress(task_uid, percent, message?)\` — mid-task heartbeat. 0–100 + optional message. Stored as a \`kind: 'progress'\` comment with \`metadata.progressPercent\` and the task's \`progressPercent\` column updates so the UI renders an inline progress bar. Call frequently during long tasks so the human sees movement.
- \`set_task_blocked(task_uid, reason)\` — explicit blocker with reason. Sets status → blocked, adds a \`kind: 'blocker'\` comment. **Prefer this over silently stopping** — humans see blockers in the activity rail and can intervene.
- \`add_subtask(parent_task_uid, description, body?, prompt?, scope_path?, file_specs?)\` — break work down. Subtask shares the parent's plan; one level deep for v1.

**Task chatter (first-class agent ↔ human channel)**
- \`add_task_comment(task_uid, kind, body, parent_comment_uid?)\` — \`kind\`: \`'note' | 'blocker' | 'progress' | 'question'\`. Threads via \`parent_comment_uid\`. Also broadcasts \`task-comment-added\` so the UI animates the comment in.
- \`list_task_comments(task_uid)\` — flat ordered list with \`kind\`, \`source\` ('agent' / 'human'), \`metadata\`. **Always read this before continuing a task** — a human or another agent may have left context.

**Task attachments (URL / image / snippet rail)**
- \`add_task_attachment(task_uid, kind, value, label?, content_type?, data_base64?, project_root?)\` — \`kind\`: \`'url' | 'image' | 'file_ref' | 'code_block' | 'transcript'\`. For images with raw bytes pass \`data_base64\` + \`content_type\` + \`project_root\` and CodeTrellis writes the file under \`<project_root>/.codetrellis/attachments/<task_uid>/\`.

**Phases (first-class checkpoints — optional)**
- \`add_plan_phase(plan_uid, title, phase_number?, scope?, prerequisites?, git_checkpoint?, acceptance_criteria?, status?)\` — swf-style "01 Foundation / 02 Migration / …"
- \`list_plan_phases(plan_uid)\` — phases ordered by phase_number
- \`update_plan_phase(phase_uid, ...)\` — any field; status: pending / in_progress / done / blocked
- \`delete_plan_phase(phase_uid)\` — tasks survive (phase_uid cleared)

**Plan templates (one-shot deep plan seeding)**
- \`list_plan_templates(project_root?)\` — built-ins + disk templates from \`<project_root>/.codetrellis/templates/\` and \`~/.codetrellis/templates/\`
- \`create_plan_from_template(template_id, project_path, title?, description?, placeholder_values?)\` — most common: \`"mass-refactor"\` (6 phases + executive overview + per-phase docs + cross-cutting patterns/testing/security). Disk templates may declare \`{{key}}\` placeholders — pass \`placeholder_values: { key: 'value' }\` to fill them.
- \`publish_plan_as_template(plan_uid, project_root, template_id, ...)\` — snapshot a plan to \`<project_root>/.codetrellis/templates/<template_id>/\` so a team can \`git push\` it as a reusable template

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
- \`codetrellis://skill/power-user\` — deep usage

## Legacy tool names (Phase 14 and earlier — still work)

The following tools predate the unified Object/Action surface and
remain registered for back-compat. Both surfaces work in parallel
during the Phase 15 cutover; new code should use the V2 names above.

- \`add_plan_doc\` → write context as an Object (\`add_item kind='object'\`)
- \`update_plan_doc\` → \`update_item\`
- \`add_plan_phase\` → an Action with \`template='phase'\` (\`add_item kind='action' template='phase'\`)
- \`add_subtask\` → \`add_item kind='action' parent_uid=<parent>\`
- \`update_task\` / \`update_task_progress\` / \`set_task_blocked\` / \`add_task_attachment\` / \`add_task_comment\` / \`read_task_full\` / \`list_task_comments\` → use the matching \`*_item*\` tools
- \`claim_task\` → \`claim_item\`

If you're a returning agent reading a plan that was authored under
the legacy surface, the V2 tools transparently read both — uids are
preserved, attachments and comments stay attached. No special
handling needed; just switch to the V2 vocabulary on writes.`;

const QUICKSTART = `# CodeTrellis quickstart for AI coding agents

You are connected to a CodeTrellis instance. CodeTrellis is the
human's view into what you're doing — they see the architecture, your
plans, your changes, and any drift between plan and reality, all in
real time. Operate accordingly.

## Minimum viable flow

1. **Identify yourself** — call \`register_session(agent_type='claude-code'|'codex'|'cursor'|...)\` so you appear in the connected-agents list.
2. **Find the active plan** — call \`list_plans(project_path)\` and pick the one with status \`approved\` or \`in_progress\`. If there isn't one, ask the human or read \`codetrellis://skill/power-user\` for plan authoring.
3. **Read the plan** — \`get_plan(plan_uid)\` gives you tasks. Spec docs are *separate* — fetch them granularly with \`list_plan_docs(plan_uid)\` then \`get_plan_doc(doc_uid)\` so your context stays small.
4. **Pick up a task** — \`get_next_task(plan_uid)\` → \`claim_task(plan_uid, task_uid, agent_type)\`. The claim response is the full task context (body / prompt / fileSpecs / attachments / comments / subtasks) — no follow-up read needed. **First** also call \`list_task_comments(task_uid)\` to see what humans / other agents left while you were away.
5. **Mark in_progress** — \`update_task(plan_uid, task_uid, status='in_progress')\`.
6. **Do the work + heartbeat** — read the task's \`body\`, \`prompt\`, \`fileSpecs\`, \`attachments\` for what's expected. During longer work call \`update_task_progress(task_uid, percent, message)\` so the UI shows movement.
7. **If you hit a blocker** — \`set_task_blocked(task_uid, reason)\`. Don't just stop. The human sees blockers in the activity rail and can unblock you.
8. **Verify** — \`get_drift_report(plan_uid)\` tells you if your changes match the plan or drifted, and surfaces any blockers / questions / progress comments since your last visit.
9. **Mark done** — \`update_task(plan_uid, task_uid, status='done')\`.

## What NOT to do

- Don't author files outside the task's \`file_specs\` list without first noting it via \`add_task_comment(kind='note')\` or extending the task — drift is visible to the human and unexpected changes show in red.
- Don't dump the whole plan into context. \`list_plan_docs\` returns titles + lengths only; \`get_plan_doc\` fetches one body at a time.
- Don't skip \`register_session\` — without it, your tool calls show up as anonymous \`mcp-client\` in the human's Agent Timeline.
- **Don't silently stop on a blocker.** Call \`set_task_blocked(task_uid, reason)\` so the human can intervene. Vanishing without explanation is the worst possible UX.
- **Don't mark a task done without verifying.** Run \`get_drift_report\` first — if there's drift, decide: extend the task, file a \`kind: 'concern'\` comment, or roll back.

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

## Granular task fields (Phase 14 §A — task-as-context)

When you (or the human) creates a task, you can be vague (one-line
description) OR very precise. The full task fields:

**Identity / wiring**
- \`description\` (required) — short imperative line
- \`dependencies\` — other task UIDs that must complete first (DAG)
- \`parent_task_uid\` — bind as subtask of another task in the same plan
- \`scope_path\` — folder the task is rooted at (e.g. \`src/auth/\`); \`file_specs\` paths resolve from here
- \`phase_uid\` — bind to a Phase

**Context blob (what the agent reads)**
- \`body\` — markdown design notes, rationale, "why this exists"
- \`prompt\` — markdown ready to paste at an agent (alternative / complement to \`body\`)
- \`attachments\` — URLs, image refs, file refs, snippets, transcripts (added via \`add_task_attachment\`)

**Architectural intent (what drift verifies against)**
- \`file_specs\` — \`[{path, action: 'create'|'modify'|'delete'|'move', moveTo?, isDir?, description?}]\` — the new shape; \`affected_files\` is derived from this
- \`affected_files\` — legacy / derived: relative paths the task touches
- \`affected_symbols\` — function / class names changed
- \`new_connections\` — \`[{from, to}]\` import edges that should appear
- \`removed_connections\` — edges that should disappear
- \`file_spec\` — single-doc markdown describing what each file should do (legacy; prefer per-fileSpec \`description\`)
- \`symbol_specs\` — \`[{name, kind, action, signature?, moveTo?}]\`

**Collaboration / runtime state**
- \`status\` — pending / assigned / in_progress / done / blocked / skipped
- \`assignee\` — who's working it
- \`progress_percent\` — 0–100, set via \`update_task_progress\`
- \`blocked_reason\` — set via \`set_task_blocked\`

The drift system uses the architectural-intent fields to verify: did
the new connection appear? Did the removed connection actually go
away? Did you only touch the expected files?

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
