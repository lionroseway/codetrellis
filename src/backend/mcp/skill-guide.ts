/**
 * Agent skill / "how to use CodeTrellis" markdown guides.
 *
 * Surfaced via MCP resources `codetrellis://skill` (project-tailored
 * summary), `codetrellis://skill/quickstart` (first-time flow), and
 * `codetrellis://skill/power-user` (deep usage). Agents fetch these
 * on connect so they don't need out-of-band briefing.
 *
 * Also returned by the `get_app_guide` MCP tool.
 */

import * as planService from '../services/plan-service';
import * as planItemService from '../services/plan-item-service';
import * as sessionService from '../services/session-service';

export type SkillFlavor = 'summary' | 'quickstart' | 'power-user';

export function buildSkillGuide(flavor: SkillFlavor): string {
  if (flavor === 'quickstart') return QUICKSTART;
  if (flavor === 'power-user') return POWER_USER;
  return projectStateSummary() + '\n\n' + PHILOSOPHY + '\n\n' + TOOL_REFERENCE;
}

// ── Dynamic project state ───────────────────────────────────────────

function projectStateSummary(): string {
  const plans = planService.listPlans();
  const sessions = sessionService.getActiveSessions();

  const planLines = plans.length
    ? plans.slice(0, 8).map((p) => {
        const items = planItemService.listItemSummaries(p.uid);
        const actions = items.filter((i: any) => i.kind === 'action');
        const done = actions.filter((i: any) => i.status === 'done').length;
        return `- **${p.title}** (${p.status}, ${done}/${actions.length} actions) — \`${p.uid}\``;
      }).join('\n')
    : '_(no plans yet)_';

  const sessionLines = sessions.length
    ? sessions.map((s) =>
        `- ${s.agentType}${s.model ? ` (${s.model})` : ''} · session \`${s.sessionId}\` · plan \`${s.activePlanUid ?? 'none'}\``
      ).join('\n')
    : '_(you appear to be the first connected agent)_';

  return `# CodeTrellis — current project state

## Plans (${plans.length})

${planLines}

## Connected agents

${sessionLines}`;
}

// ── Philosophy — what CodeTrellis is and how to think about it ──────

const PHILOSOPHY = `## What CodeTrellis is

CodeTrellis is a collaborative workspace that sits between humans and
code. It parses your codebase into a live dependency graph (packages,
files, symbols, cross-system HTTP/SQL couplings), overlays plans and
changes onto that graph, and gives both humans and AI agents a shared
surface to understand, plan, and track what's happening.

**CodeTrellis does not require an AI agent.** A developer can use it
purely as an architecture visualiser and planning tool for their own
coding. But when AI agents are involved, CodeTrellis becomes the
bridge — agents can control the entire UI through MCP, and the human
can see, interact with, and steer everything in real time.

## How to think about using it

**Use as much or as little as you need.** CodeTrellis has deep
capabilities, but you don't need all of them for every task. A quick
architecture query to understand how files connect is just as valid as
a fully-specified multi-phase plan with drift detection. Match the
tool to the task.

**Talk to the user first.** Before deciding how much CodeTrellis to
use, have a conversation. Not every user is a solutions architect —
some want a quick graph lookup, others want a structured plan they
can audit step by step. Agree on the level of verbosity. If the user
is clearly experienced with CodeTrellis and driving confidently, stay
out of their way. If they're new or the task is complex, offer to
walk them through it.

## The core idea: externalise your thinking

The primary purpose of plans in CodeTrellis is to **get your planning
and reasoning out of your head and into a place where a human can see
it, refine it, and verify you stayed on track.** LLMs plan internally
in ways that are invisible to the user — CodeTrellis makes that
visible.

Plans can be as simple as a title and three bullet-point Actions, or
as dense as a multi-phase specification with file-level CRUD intent,
symbol specs, and dependency ordering. The right level depends on the
task.

## When to go deep vs. light

**Light plans** (title + Actions without file_specs): Good for
small features, bug fixes, exploratory work. The human sees what
you intend to do, but there's nothing for drift detection to compare
against — and that's fine.

**Dense plans** (Actions with file_specs, symbol_specs, new/removed
connections): Good for consolidations, large refactors, adding
entirely new subsystems — anywhere the blast radius matters. Drift
detection compares your declared intent against the actual codebase
state, so the human can see "you said you'd create this file but
haven't yet" or "you touched this file but it wasn't in the plan."

**Use judgement.** If you make a plan without specific file/symbol
actions, drift has nothing to compare against. That's a deliberate
trade-off, not a mistake — not every task benefits from that level of
specification.

## Fighting context anxiety

CodeTrellis is built for work that spans multiple context windows,
multiple sessions, and even multiple agent types. You should actively
use it to **persist your state** so that if your context window runs
out, the next session (whether it's you again, a different agent, or
a human) can pick up where you left off.

Concrete habits:
- Update item progress and leave comments as you work — these survive
  across sessions
- When you learn something important, write it into an Object (context
  page) in the plan so it's not lost when your context resets
- Before your context gets too full, capture a checkpoint and leave
  notes on what's done and what's next
- A plan might flow through Claude (architecture), Codex (bulk
  implementation), Cursor (UI polish), and human review — each
  participant reads the same plan, claims tasks, and leaves notes
  for the next

## The collaboration model

**The human can be the trellis for the AI agent** — providing
structure, refining plans, approving gates, and steering direction
when the agent needs guidance.

**The AI agent can be the trellis for the human** — walking them
through the architecture, explaining decisions by controlling the UI
(focusing the graph, selecting nodes, navigating to specific items),
and helping them understand the density and reach of changes they
might not grasp from code alone.

The best workflow is often: **user talks with a primary agent, which
uses MCP to control the app and launch terminals with other agents
for delegation.** The user can physically interact with the UI at
any time — clicking nodes, reading plans, leaving comments — while
agents work in parallel. This isn't an either/or; it's a
conversation.

## You control the whole app

Through MCP you can control every aspect of CodeTrellis:
- Navigate the UI, open plans, focus the graph, toggle panels
- Create and manage plans with any level of detail
- Launch terminal sessions and delegate to other agents
- Take screenshots to see what the user sees
- Read and write the clipboard
- Query the architecture graph — symbols, dependencies, cross-system
  couplings
- Track drift, capture checkpoints, reconcile deviations
- Read application logs for diagnostics

The user sees everything you do in real time. Use this to your
advantage — when explaining something, focus the graph on the
relevant file, select the nodes, switch to diff mode. Show, don't
just tell.`;

// ── Tool reference ──────────────────────────────────────────────────

const TOOL_REFERENCE = `## MCP tool reference

CodeTrellis uses a unified **Object / Action** model inside plans.
Both nest freely in one tree. **Objects** carry context (markdown
body, references, attachments). **Actions** are graph-anchored work
items with status, progress, and CRUD intent on files / symbols /
edges.

### Architecture queries

| Tool | What it does |
|------|-------------|
| \`search_symbols(query)\` | Find functions / classes by name |
| \`get_dependencies(file_path)\` | Imports + importedBy for a file |
| \`check_architecture(query?)\` | Full dependency graph (filterable) |
| \`check_conformity(proposed_imports[])\` | Would these imports cause cycles? |
| \`list_cross_system_edges()\` | Runtime couplings: HTTP fetches ↔ API routes across languages |

### Plan management

| Tool | What it does |
|------|-------------|
| \`create_plan(title, description, project_path)\` | Create a new plan |
| \`get_plan(plan_uid)\` | Read plan metadata + item summary |
| \`update_plan(plan_uid, ...)\` | Update title / description / status |
| \`list_plans(project_path?, status?)\` | Browse plans with pagination |
| \`delete_plan(plan_uid)\` | Remove a plan |
| \`bulk_delete_plans(plan_uids)\` | Clean up multiple plans |
| \`get_plan_summary(plan_uid)\` | One-call health dashboard: completion %, blockers, deviations |
| \`copy_plan_as_prompt(plan_uid, item_uid?)\` | Serialise a plan/item as a handoff prompt |

### Plan items (Objects & Actions)

| Tool | What it does |
|------|-------------|
| \`add_item(plan_uid, kind, ...)\` | Create an Object or Action |
| \`bulk_add_items(plan_uid, items[])\` | Create many items with \_temp\_uid parent refs |
| \`get_item(uid)\` | Lightweight single-row fetch |
| \`read_item_full(uid)\` | Full context bundle: item + parent + children + attachments + comments + versions |
| \`update_item(uid, ...)\` | Update any field; auto-versioned |
| \`move_item(uid, ...)\` | Re-parent and/or reorder |
| \`delete_item(uid, cascade?)\` | Soft-delete with subtree snapshot for restore |
| \`claim_item(uid, ...)\` | Atomically claim an Action; returns full context + file conflicts |
| \`get_next_item(plan_uid, parent_uid?)\` | Next claimable Action respecting deps + approval gates |
| \`approve_gate(uid)\` | Clear an approval gate on a completed item |
| \`list_items(plan_uid, ...)\` | Query items by parent / kind / status / title |
| \`search_items(plan_uid, query)\` | Full-text search across titles and bodies |
| \`restore_item_version(uid, version)\` | Roll back to a prior version |
| \`get_plan_timeline(plan_uid, ...)\` | Event log of every structural mutation |
| \`suggest_specs(scope_path, ...)\` | Query the graph for candidate fileSpecs / symbolSpecs |

### Item comments, progress & attachments

| Tool | What it does |
|------|-------------|
| \`add_item_comment(uid, kind, body)\` | Leave a note / blocker / progress / question |
| \`list_item_comments(uid)\` | Read all comments chronologically |
| \`delete_item_comment(comment_uid)\` | Remove a comment |
| \`update_item_progress(uid, percent, message?)\` | Progress heartbeat (updates item + emits comment) |
| \`set_item_blocked(uid, reason)\` | Mark blocked with reason (status + comment) |
| \`add_item_attachment(uid, kind, value, ...)\` | Pin a URL / image / code block / transcript |
| \`delete_item_attachment(attachment_uid)\` | Remove an attachment |

### External references

| Tool | What it does |
|------|-------------|
| \`add_external_ref(item_uid, url, ...)\` | Link a GitHub issue / PR / Jira / Figma / any URL |
| \`list_external_refs(item_uid)\` | List linked references |
| \`remove_external_ref(uid)\` | Unlink a reference |

### Drift & verification

| Tool | What it does |
|------|-------------|
| \`get_drift_report(plan_uid, since_ms?)\` | Baseline vs live comparison + recent comment activity |
| \`detect_deviations(plan_uid)\` | Run deviation detection now |
| \`get_deviations(plan_uid)\` | List outstanding deviations |
| \`reconcile(plan_uid, deviations[])\` | Accept / revert / ignore deviations |
| \`capture_checkpoint(plan_uid, name, project_path)\` | Named snapshot of current codebase state |
| \`list_proposed_changes(plan_uid)\` | Per-file/symbol CRUD feed with drift status |
| \`get_changes_summary(plan_uid)\` | Aggregate counts ("12/18 satisfied") |
| \`get_change_status(plan_uid, change_id)\` | Fresh drift recompute for one change |

### Session & multi-agent

| Tool | What it does |
|------|-------------|
| \`register_session(agent_type, model?, capabilities?)\` | Identify yourself; declare skills for task routing |
| \`set_active_plan(plan_uid)\` | Declare which plan you're working on |

### UI control

| Tool | What it does |
|------|-------------|
| \`navigate_to(target, plan_uid?)\` | Switch to plan / graph / split / timeline view |
| \`open_plan(plan_uid, split_view?)\` | Open a specific plan |
| \`select_item(item_uid, plan_uid?)\` | Navigate to a specific item in the plan tree |
| \`toggle_panel(panel)\` | Show/hide sidebar / inspector / terminal / split |
| \`refresh_ui()\` | Force UI refresh |
| \`open_project(path)\` | Open and scan a project directory |
| \`rescan_project(project_path?)\` | Re-parse the codebase AST |
| \`set_baseline(commit_hash)\` | Set the git baseline for diff mode |
| \`list_recent_projects()\` | Discover recently opened projects |

### Graph visual control

| Tool | What it does |
|------|-------------|
| \`graph_focus(path, highlight?)\` | Pan + zoom to a specific node |
| \`graph_select(paths[])\` | Select nodes (like shift-click) |
| \`graph_set_mode(mode)\` | live / baseline / planned / diff overlay |
| \`graph_set_scope(scope_path)\` | Filter to a directory |
| \`graph_set_layout(layout)\` | map (force-directed) or tree (dagre) |
| \`graph_set_depth(depth)\` | package / file / symbol detail level |
| \`graph_export()\` | Export graph as PNG image |
| \`graph_snapshot(include_metadata?)\` | Structured JSON of all nodes + edges |

### Terminal control

| Tool | What it does |
|------|-------------|
| \`terminal_create(preset?, cwd?, title?)\` | Create a terminal (shell / claude / codex / aider) |
| \`terminal_write(session_id, input)\` | Send keystrokes / commands |
| \`terminal_read(session_id, lines?)\` | Read recent output (ANSI-stripped) |
| \`terminal_list(alive_only?)\` | List all terminal sessions |
| \`terminal_kill(session_id)\` | Kill a terminal |
| \`terminal_resize(session_id, cols, rows)\` | Resize a terminal |

### Screenshot & clipboard

| Tool | What it does |
|------|-------------|
| \`screenshot(panel?)\` | Capture the UI as a PNG (full / graph / plan / terminal) |
| \`clipboard_write(text)\` | Copy text to the user's clipboard |
| \`clipboard_read()\` | Read the user's clipboard contents |

### Settings & diagnostics

| Tool | What it does |
|------|-------------|
| \`get_settings()\` | Read current CodeTrellis settings |
| \`update_settings(identity?, mcp?, plans?)\` | Update settings (deep-merged) |
| \`get_logs(lines?, filter?)\` | Tail the application log |
| \`get_log_path()\` | Get log file and directory paths |
| \`get_app_guide(flavor?)\` | This guide (summary / quickstart / power-user) |

### Plan file sync & templates

| Tool | What it does |
|------|-------------|
| \`export_plan_to_files(plan_uid, project_root)\` | Write plan to .codetrellis/plans/ for git |
| \`import_plan_from_files(plan_dir)\` | Upsert plan from disk into DB |
| \`discover_plan_files(project_root)\` | Find plan directories on disk |
| \`unlink_plan_from_files(plan_uid, project_root)\` | Stop syncing to disk (Shared → Local) |
| \`list_plan_templates(project_root?)\` | Browse available templates |
| \`create_plan_from_template(template_id, ...)\` | Seed a plan from a template |
| \`publish_plan_as_template(plan_uid, ...)\` | Snapshot a plan as a reusable template |
| \`import_external(text, title?)\` | Import a plan from conversation / markdown / issue text |

### MCP resources (read on connect)

| Resource URI | What it provides |
|-------------|-----------------|
| \`codetrellis://skill\` | This project-tailored summary |
| \`codetrellis://skill/quickstart\` | First-time agent workflow |
| \`codetrellis://skill/power-user\` | Deep features guide |
| \`codetrellis://plans\` | All plans as JSON |
| \`codetrellis://sessions\` | Active agent sessions |
| \`project://graph\` | Full dependency graph as JSON |
| \`project://stats\` | File / symbol / import counts |

### Where to find the MCP server

The user may have changed the default port. Check
\`GET http://127.0.0.1:3001/api/mcp/status\` (returns
\`{ running, port, connectedAgents }\`) or fetch the config from
\`GET /api/mcp/config\`. The default port is 19432 but autodetect
walks forward on collision.`;

// ── Quickstart ──────────────────────────────────────────────────────

const QUICKSTART = `# CodeTrellis quickstart

You're connected to CodeTrellis — a collaborative workspace where
humans and AI agents share a live view of the codebase architecture,
plans, and changes. The human can see everything you do through MCP
in real time.

## First: talk to the user

Before diving in, understand what the user needs. CodeTrellis can do
a lot — from a quick architecture lookup to a fully-specified
multi-phase plan with drift detection. **Ask the user what level of
structure they want.** Not everyone is a solutions architect; many
users just want help understanding their codebase or getting a task
done cleanly.

## Minimum flow

1. **Register yourself** — \`register_session(agent_type, model?)\`
   so you appear in the connected-agents list and your work is
   attributed correctly.

2. **Understand the landscape** — \`list_plans(project_path)\` to see
   existing plans. If there's an active one, \`get_plan(plan_uid)\`
   to understand what's happening. If starting fresh, discuss with
   the user what they need.

3. **Pick up work** — \`get_next_item(plan_uid)\` finds the next
   available Action respecting dependencies. \`claim_item(uid)\`
   atomically claims it and returns full context (item + parent +
   children + attachments + comments) in one call.

4. **Do the work + stay visible** — call
   \`update_item_progress(uid, percent, message)\` periodically so
   the human sees movement. If you hit a blocker, call
   \`set_item_blocked(uid, reason)\` — don't silently stop.

5. **Leave notes for the next session** — comments and Objects
   survive across context windows. If you're running low on context,
   write what you've learned and what's next into the plan before
   your window closes.

6. **Verify before marking done** — if the plan has file_specs,
   \`get_drift_report(plan_uid)\` shows whether your changes match
   the declared intent.

7. **Mark complete** — \`update_item(uid, status='done')\`.

## What NOT to do

- **Don't silently stop on a blocker.** Call \`set_item_blocked\` so
  the human can intervene. Vanishing without explanation is the worst
  UX.
- **Don't dump entire plans into context.** Use \`list_items\` for
  the tree structure (no bodies), then \`read_item_full\` only for
  items you're actively working on.
- **Don't skip \`register_session\`.** Without it, your tool calls
  show as anonymous \`mcp-client\` in the Agent Timeline.
- **Don't forget to read comments.** Before continuing any Action,
  check \`list_item_comments(uid)\` — a human or another agent may
  have left critical context while you were away.

## You can also just explore

CodeTrellis is equally useful for understanding code without making
plans at all:

- \`search_symbols('AuthService')\` — find where something is defined
- \`get_dependencies('/path/to/file.ts')\` — what does it import and
  what imports it?
- \`check_architecture('services')\` — how do the service files
  connect?
- \`graph_focus('src/backend/server.ts')\` — show the user a specific
  part of the architecture visually
- \`list_cross_system_edges()\` — how does the frontend talk to the
  backend?

Use as much or as little as the task requires.`;

// ── Power user guide ────────────────────────────────────────────────

const POWER_USER = `# CodeTrellis power-user guide

This covers the deep features. Read \`codetrellis://skill/quickstart\`
first if you haven't.

## Dense plans and drift detection

The power of CodeTrellis plans comes from **declaring architectural
intent** — not just "what to do" but "what files to touch, what
symbols to change, what connections to add or remove." When you
specify this, drift detection can verify your work against your
declarations.

### When to go dense

Dense plans with file_specs and symbol_specs shine for:
- **Large refactors** — moving code between modules, consolidating
  services
- **New subsystems** — adding an entirely new feature area with
  multiple files
- **Dependency restructuring** — intentionally changing how files
  import each other

For these, declare your intent explicitly:
\`\`\`
add_item(plan_uid, kind='action', title='Extract auth middleware',
  file_specs=[
    {path: 'src/middleware/auth.ts', action: 'create'},
    {path: 'src/server.ts', action: 'modify'},
    {path: 'src/routes/protected.ts', action: 'modify'}
  ],
  new_connections=[{from: 'src/routes/protected.ts', to: 'src/middleware/auth.ts'}],
  removed_connections=[{from: 'src/routes/protected.ts', to: 'src/server.ts'}]
)
\`\`\`

Then after working: \`get_drift_report(plan_uid)\` shows exactly
what's on track, what's missing, and what's unexpected.

### When to stay light

Light plans are fine for:
- Bug fixes, small features, exploratory work
- Anything where the overhead of specifying files outweighs the
  benefit of tracking them
- Early-stage planning where you haven't decided on file structure

**If you make a plan without specific file/symbol actions, drift
detection has nothing to compare against.** That's a deliberate
choice, not a gap.

## Multi-agent orchestration

The most powerful CodeTrellis workflow:

1. **User talks to a primary agent** (e.g. Claude Code)
2. **Primary agent uses MCP** to create plans, control the UI,
   explain the architecture to the user
3. **Primary agent launches terminals** via
   \`terminal_create(preset='codex')\` or \`preset='aider'\` to
   delegate specific tasks
4. **Each agent claims its own Actions** — \`claim_item\` is atomic,
   no two agents get the same task
5. **The user watches and steers** — they see all agents in the
   Connected Agents widget, can leave comments, approve gates, and
   interact with the UI directly

### Persisting across context windows

Agents should actively fight context anxiety:

- **Leave breadcrumbs.** Before your context fills up, write an
  Object summarising what you've done and what's next.
- **Use progress comments.** \`update_item_progress(uid, 60,
  'Completed auth extraction, starting route migration')\` — this
  survives your context window.
- **Capture checkpoints.** \`capture_checkpoint(plan_uid,
  'After auth extraction', project_path)\` saves the full codebase
  state for later comparison.
- **Hand off explicitly.** When a different agent type will continue,
  leave a comment with context: what decisions were made, what's
  blocked, what to watch out for.

A typical multi-agent flow:
- Claude starts: creates the plan, structures the architecture
  decisions, claims the design-heavy Actions
- Codex continues: claims the implementation Actions, bulk-writes
  code, leaves progress notes
- Cursor finishes: claims the UI polish Actions, iterates on
  component styling
- Human reviews: reads the plan timeline, checks drift, approves
  gates, marks the plan complete

## Walking the user through the architecture

You control the entire CodeTrellis UI through MCP. Use this to
**show, not just tell:**

- \`graph_focus('src/backend/services/auth-service.ts')\` — pan +
  zoom + highlight a specific file
- \`graph_set_mode('diff')\` — show what changed vs baseline
- \`graph_set_scope('src/backend')\` — filter to just the backend
- \`graph_set_depth('symbol')\` — drill into functions and classes
- \`graph_select(['file1.ts', 'file2.ts'])\` — select related nodes
- \`screenshot('graph')\` — capture what's on screen

Combine these to narrate: "Let me show you how these services
connect..." → focus, select, explain, then navigate to the plan item
that proposes the change.

## Approval gates and dependencies

For critical work, Actions can have:
- **Dependencies** — other Actions that must complete first (DAG
  ordering via \`get_next_item\`)
- **Approval gates** — \`requiresApproval: true\` means a human must
  call \`approve_gate(uid)\` before the next sibling can be claimed.
  Perfect for checkpoints where human review is essential.

## Plan templates

For recurring patterns (mass refactors, new service setup, etc.):
- \`list_plan_templates(project_root?)\` — see available templates
- \`create_plan_from_template('mass-refactor', ...)\` — seed a full
  plan structure in one call, with placeholder substitution
- \`publish_plan_as_template(plan_uid, ...)\` — turn a good plan into
  a reusable template that the team can share via git

## Plan file sync (git-backed plans)

Plans can live on disk under \`.codetrellis/plans/\` for version
control:
- \`export_plan_to_files(plan_uid, project_root)\` — write to disk
- \`import_plan_from_files(plan_dir)\` — read from disk after
  \`git pull\`
- \`discover_plan_files(project_root)\` — find plans checked into
  the repo
- \`unlink_plan_from_files(plan_uid, project_root)\` — stop syncing
  to disk (Shared → Local toggle)

## Diagnostics

When something isn't working as expected:
- \`get_logs(lines?, filter?)\` — tail the application log, optionally
  filtered by keyword
- \`get_log_path()\` — find the log file on disk
- \`get_settings()\` / \`update_settings(...)\` — check and modify
  configuration (identity, MCP port, plan defaults)`;
