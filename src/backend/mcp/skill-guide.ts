/**
 * Agent skill / "how to use CodeTrellis" markdown guides.
 *
 * Surfaced via MCP resources `codetrellis://skill` (project-tailored
 * summary), `codetrellis://skill/quickstart` (first-time flow),
 * `codetrellis://skill/power-user` (deep usage), and
 * `codetrellis://skill/ui-nav` (UI navigator for sub-agents).
 * Agents fetch these on connect so they don't need out-of-band briefing.
 *
 * Also returned by the `get_app_guide` MCP tool.
 */

import * as planService from '../services/plan-service';
import * as planItemService from '../services/plan-item-service';
import * as sessionService from '../services/session-service';

export type SkillFlavor = 'summary' | 'quickstart' | 'power-user' | 'ui-nav' | 'diagnostics' | 'multi-agent';

export function buildSkillGuide(flavor: SkillFlavor): string {
  if (flavor === 'quickstart') return QUICKSTART;
  if (flavor === 'power-user') return POWER_USER;
  if (flavor === 'ui-nav') return UI_NAV;
  if (flavor === 'diagnostics') return DIAGNOSTICS;
  if (flavor === 'multi-agent') return MULTI_AGENT;
  return projectStateSummary() + '\n\n' + PHILOSOPHY + '\n\n' + JOURNEYS + '\n\n' + CAPABILITIES + '\n\n' + TOOL_REFERENCE;
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


// ── Journeys — what to OFFER the user ───────────────────────────────

/**
 * The ten things this product takes a person through, each with its
 * entry point.
 *
 * This exists because an agent that only has a tool list will use the
 * tools it was asked about and never mention the rest. Five whole feature
 * areas — budgets, ticket intake, compare/playback, plan review, and
 * everything Phase 30 gates — were absent from these guides, so no agent
 * could offer them and no user found them.
 */
const JOURNEYS = `## What you can offer the user

Eleven journeys. Say them in the user's terms, not in tool names, and offer
the one that fits what they are actually doing.

### 1. Understand a codebase
"Show me how this hangs together." Scan the project, then read the graph:
\`check_architecture\`, \`search_symbols\`, \`get_dependencies\`. For services
that talk to each other over HTTP or SQL rather than imports, use
\`list_cross_system_edges\` — that map is the thing people are most
surprised exists.

### 2. Plan before touching code
"Let's agree what we're doing first." \`create_plan\`, then \`add_item\` or
\`bulk_add_items\` to break it down. Anchor Actions to real files and
symbols so the plan is checkable later — \`suggest_specs\` proposes the
anchors from the item's text.

### 3. Work a plan
\`get_next_item\` → \`claim_item\` → \`update_item_progress\` → mark done.
\`approve_gate\` where a human has to sign off. \`set_item_blocked\` when
something stops you, because a blocked item the user can see beats a
silent stall.

### 4. Start from a ticket
"We already have this in Jira / Linear / GitHub."
\`create_plan_from_external\` imports an epic and its children as a plan,
keeping the ticket keys. \`get_external_sync_state\` then tells you which
statuses have moved so you can write them back with your own tracker
tools, and \`mark_external_synced\` advances the watermark.

### 5. See what actually changed
\`capture_checkpoint\` pins a moment. \`list_comparands\` shows every point
you can compare — checkpoints, commits, the baseline, the working tree —
and \`compare_snapshots\` diffs any two of them. Useful before a risky
change and again afterwards.

### 6. Trace a change back to why
"Why is this file being touched?" Open it in Code and the reader marks
every line git sees as changed — green for added, amber for modified, the
whole file green when it is new. Above the source, any plan item that
declared this file says so and what it means to do to it: **new file**,
**modify**, **rewrite**, **delete**. Click that row and the item opens.

Going the other way, from an item to the code: \`read_item_full\` gives you
its declared targets, and \`get_dependencies\` tells you what else leans on
them before you touch anything.

### 7. Review before the PR
"Did we do what we said?" \`review_plan\` compares the plan's declared
targets against what actually changed, per item, and flags changed files
no item claimed. \`get_pr_draft\` turns that into a PR description with the
tickets and the review included.

### 8. Keep time and cost in check
\`set_budget\` puts a ceiling on a plan; \`check_budget\` before starting
more work tells you whether to continue, and \`get_budget\` shows spend,
forecast and per-agent split. Advisory by design — nothing halts you, so
a well-behaved agent asks.

### 9. Coordinate several agents
Register with \`register_session\` so you appear in the timeline. Claim
work rather than assuming it. \`post_channel_event\` raises a question,
decision or blocker the human (or another agent) can answer, and
\`get_channel_thread\` reads the replies.

### 10. Steer from a phone
The desktop pairs with a mobile app over a peer mesh.
\`list_paired_devices\`, \`get_peer_status\`, and \`mobile_present\` to put
something in front of the user wherever they are.

### 11. Keep the architecture honest
\`check_conformity\` before adding imports, \`get_drift_report\` for where
reality has moved away from the plan, \`get_freeze_status\` when a release
is locked down, and the system docs tools for the written architecture
that should stay true.

**Offer, do not assume.** Several of these change the user's repository or
their screen. Say what you are about to do.`;

// ── Capabilities — what you may be refused, and what to say ─────────

const CAPABILITIES = `## When a tool is refused

Tools are authorised individually by capability, and three groups are OFF
until the user turns them on:

| Capability | Covers | Default |
|---|---|---|
| \`terminal\` | creating and driving terminals, and terminals on paired devices | **off** |
| \`capture\` | screenshots, clipboard contents, microphone audio | **off** |
| \`settings\` | changing desktop settings, unpairing devices, writing agent permission files | **off** |

Reading plans, editing them, opening projects and reading plan files are
granted by default, so the ordinary loop needs no setup.

A refusal names the capability and where to grant it. **Pass that on to
the user rather than retrying** — retrying will fail identically, and the
user is one checkbox in Settings → MCP Server from unblocking you.

Tools that take a \`project_path\` are also confined to projects the app
has opened. If you get "is not open", ask the user to open it, or use
\`open_project\` — which is visible to them, as it should be.`;

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
| \`bulk_add_items(plan_uid, items[])\` | Create many items with \`_temp_uid\` parent refs |
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
| \`list_item_versions(uid)\` | See how an item evolved over time |
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

### Channels (peer-to-peer team coordination)

Six event types form the channel vocabulary. Both humans and agents can post; both can respond. When the plan is shared (linked to disk), events auto-export to \`.codetrellis/plans/<slug>/channels/<uid>.yaml\` and travel via git.

| Tool | What it does |
|------|-------------|
| \`post_channel_event(plan_uid, event_type, message, ...)\` | Post stuck / need-decision / need-context / handing-off / steer / weigh-in |
| \`list_channel_events(plan_uid, ...)\` | Query events by type, status, item, since-timestamp |
| \`get_channel_thread(root_event_uid)\` | Read a full back-and-forth (root + all responses, chronological) |
| \`resolve_channel_event(event_uid)\` | Mark an event resolved (e.g., after the stuck has been steered through) |
| \`dismiss_channel_event(event_uid)\` | Mark dismissed when the event no longer needs a response |

Use \`weigh-in\` for "here's my thinking — what do others see?" architectural decisions. Use \`stuck\` when failing repeatedly. Pass \`responds_to: <event_uid>\` to post a steer or weigh-in inside an existing thread.

### Project config & commits

| Tool | What it does |
|------|-------------|
| \`get_project_config(project_root)\` | Read \`.codetrellis/config.json\` + effective settings (project > user precedence) |
| \`update_project_config(project_root, ...)\` | Persist project-level overrides — \`plans\` (sharing defaults, attachment location), \`channels.routing\`, and (CDev 3.6) \`repoRole: "planning" | "code" | "mixed"\` for multi-repo central-oversight setups |
| \`commit_manifest_changes(project_root, subject, paths, ...)\` | Stage paths and create a \`[cdev]\` commit. Optionally agent-attributed via Co-Authored-By trailer. |

### Repo identity (CDev 3.1)

Cross-machine repo identity uses the normalised git origin URL — ssh / https / \`.git\`-suffixed variants all collapse to one stable id. Per-device aliases (the label you see in the UI) are local-only and never travel in the manifest.

| Tool | What it does |
|------|-------------|
| \`get_repo_identity(project_path)\` | Return origin URL + normalised form + per-device alias |
| \`set_repo_alias(project_path, alias)\` | Rename the project on this machine without touching the manifest |
| \`refresh_repo_origin(project_path)\` | Re-read \`git remote get-url origin\` after the user changes it |

### Per-item sharing (CDev 3.2)

Every plan item carries a \`visibility\` flag (\`shared\` default, \`local\` keeps it off git) and an \`overrideParentVisibility\` escape hatch. \`add_item\` and \`update_item\` both accept \`visibility\` and \`override_parent_visibility\`. Effective visibility walks ancestors — \`local\` wins; setting the override breaks the inheritance chain. On export, local items are filtered out; children whose effective visibility differs from their parent are re-anchored to the nearest shared ancestor (or top-level when none).

### Cross-repo plans (CDev 3.3 + 3.5)

A plan's \`homeRepo\` is captured automatically from the project's git origin at \`create_plan\`. \`scope[]\` lists other repos that participate; each scoped repo gets a thin pointer file at \`.codetrellis/external/<plan-uid>.yaml\` advertising the plan.

| Tool | What it does |
|------|-------------|
| \`set_plan_home_repo(plan_uid, home_repo_url)\` | Override the auto-captured home repo (rare — moving a plan between repos) |
| \`add_plan_scope(plan_uid, repo_url, pointer_project_root?, contribution?, summary?)\` | Add a repo to scope. With \`pointer_project_root\`, write a pointer file into the local clone. |
| \`remove_plan_scope(plan_uid, repo_url, pointer_project_root?)\` | Remove from scope; delete the pointer file when supplied |
| \`list_plan_pointers(project_path)\` | List \`.codetrellis/external/\` entries — plans whose home is elsewhere |
| \`list_plans_by_repo(repo_url)\` | Every active plan whose homeRepo OR scope contains this URL (normaliser-safe) |

The frontend stitched view at \`/api/plans/stitched\` is the UI side of these tools — resolved pointers (home repo is locally cloned) get an "Open" affordance; unresolved ones get a clone hint.

### System documentation (CDev 3.4)

Repo-wide knowledge layer at \`<project>/.codetrellis/docs/<slug>.md\` with YAML frontmatter. The on-disk file is the source of truth; the DB is an index. Docs describe **how the system currently works** (architecture overviews, conventions, runbooks) — distinct from plan-scoped specs which describe **upcoming work**.

| Tool | What it does |
|------|-------------|
| \`list_system_docs(project_path, search?)\` | Browse / search docs by title + body |
| \`read_system_doc(uid)\` | Read one doc — full body + metadata |
| \`write_system_doc(project_path, title, body, references?, owner?, tags?, uid?)\` | Create or update by uid. Editing a body does NOT touch the freshness stamp — call \`verify_system_doc\` after meaningful edits. |
| \`delete_system_doc(uid)\` | Remove a doc and its on-disk file |
| \`verify_system_doc(uid)\` | Re-stamp \`capturedAgainstCommit\` to current HEAD (the freshness sensor compares this to live HEAD) |
| \`check_doc_freshness(uid)\` | Pure read: \`current\` / \`moved\` (HEAD past stamp, no referenced file changed) / \`stale\` (HEAD past stamp AND referenced file changed) |

Drop \`references.files: [...]\` to tie a doc to specific code paths — that's what drives the \`stale\` verdict when one of those files actually diffs since the last verification.

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

### Sensors (CDev 4)

Three sensors auto-detect when plans, docs, or agents need attention and post channel events (\`need-decision\` or \`stuck\`) into the plan's channel timeline. Configure per-project via \`update_project_config({ sensors: { ... } })\`.

**Drift sensor** (default: on) — fires when the file watcher detects changes outside the plan. Debounces rapid-fire deviations into a single channel event. Also fires after explicit \`detect_deviations\` calls.

**Doc sensor** (default: on) — fires when a file referenced by a system doc changes and the doc's freshness transitions to \`stale\`. Requires the doc to have \`references.files\` and \`references.plans\` populated. An optional post-merge git hook at \`resources/hooks/post-merge\` triggers a bulk freshness check after \`git pull\`.

**Stuck sensor** (default: off) — watches the MCP tool-call stream for agent loops: same tool called repeatedly with similar args, clustered errors on one tool, or tools active but no file output. Posts a \`stuck\` channel event as a soft hint — never interrupts. Enable with \`sensors.stuck.enabled: true\` after calibrating thresholds for your workflow.

All sensor-emitted events have \`authorType: 'sensor'\` and a \`payload.source\` field (\`drift-sensor\`, \`doc-sensor\`, \`stuck-sensor\`) so they're distinguishable from human/agent posts in the timeline.

### Session & multi-agent

| Tool | What it does |
|------|-------------|
| \`register_session(agent_type, model?, capabilities?, host_terminal_id?)\` | Identify yourself; declare skills for task routing. Pass host_terminal_id from \`$CODETRELLIS_HOST_TERMINAL\` env var if running inside a CodeTrellis terminal |
| \`set_active_plan(plan_uid)\` | Declare which plan you're working on |
| \`setup_agent_permissions(project_path)\` | Auto-approve all CodeTrellis MCP tools for this project (writes .claude/settings.local.json) |

### UI control

| Tool | What it does |
|------|-------------|
| \`ui_ready()\` | **Call this first.** Is the window usable — shell mounted, nothing blocking it? Every other tool answers from the backend and will succeed happily while the user is looking at something else |
| \`navigate_to(target, plan_uid?, file_path?, line?)\` | Switch to plan / graph / split / timeline / code view. For \`code\`, pass \`file_path\` (and optionally \`line\`) to open the reader on it |
| \`open_plan(plan_uid, split_view?)\` | Open a specific plan |
| \`select_item(item_uid, plan_uid?)\` | Navigate to a specific item in the plan tree |
| \`navigate_item_back()\` | Go back in item selection history (Cmd+[) |
| \`navigate_item_forward()\` | Go forward in item selection history (Cmd+]) |
| \`toggle_panel(panel)\` | Show/hide sidebar / inspector / terminal / plans / split / channel / activity / history |
| \`toggle_activity_drawer()\` | Toggle the activity/comment feed drawer |
| \`open_history_drawer(item_uid)\` | Open version history for a specific item |
| \`open_settings()\` | Open the settings modal |
| \`open_mcp_guide()\` | Open the MCP connection guide |
| \`refresh_ui()\` | Force UI refresh |
| \`open_project(path)\` | Open and scan a project directory |
| \`rescan_project(project_path?)\` | Re-parse the codebase AST |
| \`set_baseline(commit_hash)\` | Set the git baseline for diff mode |
| \`list_recent_projects()\` | Discover recently opened projects |
| \`pin_project(project_path)\` | Pin a project to the top of recents |
| \`unpin_project(project_path)\` | Unpin a project |
| \`remove_recent_project(project_path)\` | Remove a project from recents |
| \`close_project(project_path)\` | Close a project tab in the UI |

### Graph visual control

| Tool | What it does |
|------|-------------|
| \`graph_focus(path, highlight?)\` | Pan + zoom to a specific node |
| \`graph_select(paths[])\` | Select nodes (like shift-click) |
| \`graph_set_mode(mode)\` | live / baseline / planned / diff overlay |
| \`graph_set_scope(scope_path)\` | Filter to a directory |
| \`graph_set_layout(layout)\` | map (force-directed) or tree (dagre) |
| \`graph_set_depth(depth)\` | package / file / symbol detail level |
| \`graph_toggle_projection(enabled?)\` | Toggle plan projection overlay on the graph |
| \`graph_export()\` | Export graph as PNG image |
| \`graph_snapshot(include_metadata?)\` | Structured JSON of all nodes + edges |

### Terminal control

| Tool | What it does |
|------|-------------|
| \`terminal_create(preset?, cwd?, title?, focus?)\` | Create a terminal (shell / claude / codex / aider). Auto-focuses unless focus=false |
| \`terminal_write(session_id, input, focus?)\` | Send keystrokes / commands. Set focus=true to switch the UI to this tab |
| \`terminal_focus(session_id)\` | Switch the terminal panel to show a specific tab |
| \`terminal_read(session_id, lines?)\` | Read recent output (ANSI-stripped) |
| \`terminal_list(alive_only?)\` | List all terminal sessions |
| \`terminal_kill(session_id)\` | Kill a terminal |
| \`terminal_resize(session_id, cols, rows)\` | Resize a terminal |

### Agent Presence Pane

| Tool | What it does |
|------|-------------|
| \`present(text, speak?, require_ack?, tone?, link_to?)\` | Post a narration card to the floating Presence Pane. Supports **bold**, \`code\`, [links]. Set speak=true for TTS, require_ack=true for pacing |
| \`await_ack(card_id, timeout_ms?)\` | Block until the user acks a card ("Got it" click or speech end). Returns { acked, via } |
| \`await_user_input(prompt?, timeout_ms?)\` | Block until the user types a reply in the pane. Returns { text, at } |
| \`dismiss_presence()\` | Clear all cards and close the pane |

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
| \`get_app_guide(flavor?)\` | This guide (summary / quickstart / power-user / ui-nav / diagnostics / multi-agent) |

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

### Budgets — time and cost (Phase 23)

| Tool | What it does |
|------|-------------|
| \`get_budget(plan_uid)\` | Spend, forecast, per-agent split, overruns, and which price table the cost figures came from |
| \`set_budget(plan_uid, minutes?, cost_usd?, exempt?)\` | Put a ceiling on a plan, or exempt it |
| \`check_budget(plan_uid)\` | Should more work start? Advisory — nothing halts you, so ask |

Cost is null, never zero, when no agent reported a model we have prices
for. Unknown is not free.

### Tickets — external intake (Phase 24)

| Tool | What it does |
|------|-------------|
| \`create_plan_from_external(external?, children[])\` | Import an epic and its children as a plan, keeping ticket keys. Idempotent on the epic's key |
| \`set_plan_external_ref(plan_uid, url, key?, title?)\` | Attach the ticket a plan represents |
| \`list_plan_external_refs(plan_uid)\` | The tickets this plan came from |
| \`get_external_sync_state(plan_uid)\` | Which item statuses moved since the last write-back, with suggested transitions |
| \`mark_external_synced(plan_uid)\` | Advance the watermark — call it AFTER writing statuses back |

Reading the sync state does not advance the watermark, deliberately: an
agent that read the list and then failed to write would otherwise lose
those transitions silently.

### Compare and history (Phase 25)

| Tool | What it does |
|------|-------------|
| \`list_comparands(project_path)\` | Every point you can compare from: live, baseline, checkpoints, recent commits |
| \`compare_snapshots(project_path, before, after)\` | Diff any two of them — files added / removed / modified, and edges where both sides know them |
| \`get_plan_history(plan_uid, project_path)\` | How a plan changed across commits |
| \`get_plan_at_commit(plan_uid, project_path, commit)\` | A plan as it stood at one commit |
| \`diff_plan_between_commits(plan_uid, project_path, base, head)\` | What changed in the plan between two commits |
| \`search_plan_history(project_path, query)\` | Find a plan change by text |
| \`get_team_activity(project_path)\` | Who changed which plans, from the manifest's git history |

A commit contributes its file list only; reconstructing its edges would
mean checking the tree out and re-parsing it. Compare against a checkpoint
when you need edges.

### Review and PR draft (Phase 29)

| Tool | What it does |
|------|-------------|
| \`review_plan(plan_uid, project_path, before?, after?)\` | Per item: what landed, what is missing, and which changed files no item claimed |
| \`get_pr_draft(plan_uid, project_path, before?, after?)\` | A PR title and body with the tickets and the review folded in |

Read-only. Neither touches the repository — you do the git and open the
PR with your own credentials.

### Conflicts and governance

| Tool | What it does |
|------|-------------|
| \`detect_conflicts(project_path)\` | Manifest files with conflict markers after a merge |
| \`resolve_conflict(project_path, file_path, resolutions[])\` | Resolve field by field and stage the result |
| \`get_freeze_status(project_path)\` / \`check_freeze(project_path)\` | Is the repo locked down for a release? |
| \`set_freeze(project_path, active, reason?)\` | Lock or unlock it |
| \`exempt_plan_from_freeze(plan_uid, project_path)\` | Let one plan through the freeze |

### Peers and mobile

| Tool | What it does |
|------|-------------|
| \`get_peer_status()\` | Discovery state, paired device count, live connections |
| \`list_discovered_peers()\` / \`list_paired_devices()\` / \`list_peer_connections()\` | Who is nearby, paired, and connected |
| \`unpair_device(fingerprint)\` | Remove a pairing — needs \`settings\` |
| \`get_remote_state()\` | What a connected phone is showing |
| \`mobile_navigate(route)\` / \`mobile_present(...)\` | Drive the phone's screen |
| \`mobile_screenshot()\` | Picture of the phone's screen — needs \`capture\` |
| \`list_remote_terminals()\` / \`write_remote_terminal(...)\` | Terminals on a paired device — needs \`terminal\` |
| \`get_remote_audio()\` | Audio from a paired device — needs \`capture\` |
| \`list_remote_input_requests()\` / \`respond_remote_input(...)\` | Questions the phone is waiting on |

### Audio capture

| Tool | What it does |
|------|-------------|
| \`start_audio_capture(max_buffer_seconds?)\` / \`stop_audio_capture()\` | Start and stop capturing the user's microphone |
| \`push_audio_chunk(...)\` | Feed a chunk into the rolling buffer |
| \`get_audio_context()\` / \`get_audio_status()\` | Read the buffer, or just its state |

All four need \`capture\`, which is off by default. This is the user's
microphone — say what you are doing before you start it.

### Contributions (pantry)

| Tool | What it does |
|------|-------------|
| \`list_contributions(project_path)\` | What is staged to contribute upstream |
| \`promote_to_contribution(...)\` | Move local work into the contribution set |
| \`accept_contributions(project_path, ...)\` | Take contributions into the project |
| \`prepare_contributor_branch(project_path, ...)\` | Set up a branch to contribute from |
| \`resolve_pantry_references(project_path)\` | Resolve references held in the local pantry |

### MCP resources (read on connect)

| Resource URI | What it provides |
|-------------|-----------------|
| \`codetrellis://skill\` | This project-tailored summary |
| \`codetrellis://skill/quickstart\` | First-time agent workflow |
| \`codetrellis://skill/power-user\` | Deep features guide |
| \`codetrellis://skill/ui-nav\` | UI navigator skill (for sub-agents) |
| \`codetrellis://plans\` | All plans as JSON |
| \`codetrellis://sessions\` | Active agent sessions |
| \`project://graph\` | Full dependency graph as JSON |
| \`project://stats\` | File / symbol / import counts |

### Where to find the MCP server

The user may have changed the default port. Check
\`GET http://127.0.0.1:3001/api/mcp/status\` (returns
\`{ running, port, connectedAgents }\`) or fetch the config from
\`GET /api/mcp/config\`. The default port is 19432 but autodetect
walks forward on collision.

### Authentication

Every MCP request needs this launch's capability token, as the
\`x-codetrellis-token\` header (or \`Authorization: Bearer\`, or
\`?ct_token=\` for clients that cannot send headers). Any process
running as the user can read it from \`<dataDir>/capability-token\`;
\`GET /api/mcp/setup\` returns the exact path. It changes every time
CodeTrellis starts, so a 401 "Missing or invalid capability token"
after a restart means: re-read the file and update your config.`;

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
   attributed correctly. **If you are running inside a CodeTrellis
   terminal**, the env var \`CODETRELLIS_HOST_TERMINAL\` will be set —
   pass it as \`host_terminal_id\` to enable self-write protection
   (prevents you from accidentally writing to your own terminal).

2. **Enable smooth tool flow** —
   \`setup_agent_permissions(project_path)\` writes a
   \`.claude/settings.local.json\` that auto-approves all CodeTrellis
   MCP tools. Without this, Claude Code prompts for permission on
   every call, which breaks the experience. Call this once per
   project — the user needs to restart their session for it to take
   effect.

3. **Understand the landscape** — \`list_plans(project_path)\` to see
   existing plans. If there's an active one, \`get_plan(plan_uid)\`
   to understand what's happening. If starting fresh, discuss with
   the user what they need.

4. **Pick up work** — \`get_next_item(plan_uid)\` finds the next
   available Action respecting dependencies. \`claim_item(uid)\`
   atomically claims it and returns full context (item + parent +
   children + attachments + comments) in one call.

5. **Do the work + stay visible** — call
   \`update_item_progress(uid, percent, message)\` periodically so
   the human sees movement. If you hit a blocker, call
   \`set_item_blocked(uid, reason)\` — don't silently stop.

6. **Leave notes for the next session** — comments and Objects
   survive across context windows. If you're running low on context,
   write what you've learned and what's next into the plan before
   your window closes.

7. **Verify before marking done** — if the plan has file_specs,
   \`get_drift_report(plan_uid)\` shows whether your changes match
   the declared intent.

8. **Mark complete** — \`update_item(uid, status='done')\`.

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
- \`present("Here's what I found...", { speak: true })\` — narrate
  your findings in the app (the user sees a floating pane with your
  message, optionally read aloud)
- \`await_user_input("What do you think?")\` — ask the user a
  question and wait for their reply, right inside the app

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

## Agent Presence Pane — narration + dialogue

The Presence Pane is a floating overlay in the app where you can
narrate your work, ask questions, and receive real-time human input.
It uses the browser's built-in Web Speech API for TTS — fully offline,
no API keys, no audio leaves the machine.

### Key patterns

**Phase narration** — post a card at each milestone so the human
follows along without reading your chain-of-thought:
\`\`\`
present("Phase 1: scanning auth modules", speak: true)
… work + update_item_progress …
present("Found 4 files to migrate. Proceeding.", tone: 'success')
… more work …
present("Phase 1 complete. Ready for Phase 2?", tone: 'question', require_ack: true)
await_ack(card_id)  // human clicks "Got it" to green-light next phase
\`\`\`

**Decision gate** — when you need human input before continuing:
\`\`\`
present("Two options for the schema — normalised (slower migration) or denormalised (faster, more debt). Which?", tone: 'question')
await_user_input("normalised or denormalised?")
// read the reply text and branch accordingly
\`\`\`

**Discipline**: one card per major milestone, not per function edit.
Use \`require_ack: true\` only for genuine decision points. Use
\`tone: 'warning'\` for things needing action, \`'success'\` for
confirmations, \`'question'\` when you need a response. Call
\`dismiss_presence()\` when you're done narrating.

## Diagnostics

When something isn't working as expected:
- \`get_logs(lines?, filter?)\` — tail the application log, optionally
  filtered by keyword
- \`get_log_path()\` — find the log file on disk
- \`get_settings()\` / \`update_settings(...)\` — check and modify
  configuration (identity, MCP port, plan defaults)`;

// ── UI Navigation skill — loadable by sub-agents ───────────────────

const UI_NAV = `# CodeTrellis UI Navigator

You are a sub-agent responsible for driving the CodeTrellis UI while
the primary agent works. The human is watching the screen — your job
is to make the right things visible at the right time so they can
follow along.

## Your tools

### Views & panels

| Tool | Effect on screen |
|------|-----------------|
| \`navigate_to(target, plan_uid?)\` | Switch main view: "plan" / "graph" / "split" / "timeline" |
| \`open_plan(plan_uid, split_view?)\` | Open a plan; human sees the plan tree |
| \`toggle_panel(panel)\` | Show/hide "sidebar" / "inspector" / "terminal" / "plans" / "split" / "channel" / "activity" / "history" |
| \`toggle_activity_drawer()\` | Slide the activity/comment feed open or closed |
| \`refresh_ui()\` | Force the UI to re-fetch everything |

To show the human the **peer-to-peer Channel** (pending decisions, stuck,
hand-offs), call \`toggle_panel('channel')\`. \`toggle_panel('history')\` opens the
plan time-travel rail; \`navigate_to('timeline')\` opens the plan activity feed.

### Item navigation

| Tool | Effect on screen |
|------|-----------------|
| \`select_item(item_uid, plan_uid?)\` | Highlight a specific Object or Action in the plan tree |
| \`navigate_item_back()\` | Go back in selection history (like Cmd+[) |
| \`navigate_item_forward()\` | Go forward (like Cmd+]) |
| \`open_history_drawer(item_uid)\` | Open the version history panel for an item |

### Graph control

| Tool | Effect on screen |
|------|-----------------|
| \`graph_focus(path, highlight?)\` | Pan + zoom + highlight a file or symbol node |
| \`graph_select(paths[])\` | Select multiple nodes (like shift-click) |
| \`graph_set_mode(mode)\` | "live" / "baseline" / "planned" / "diff" overlay |
| \`graph_set_scope(scope_path)\` | Filter the graph to a directory |
| \`graph_set_layout(layout)\` | "map" (force-directed) or "tree" (dagre) |
| \`graph_set_depth(depth)\` | "package" / "file" / "symbol" detail level |
| \`graph_toggle_projection(enabled?)\` | Toggle the plan projection overlay |
| \`graph_export()\` | Capture the graph as a PNG |
| \`graph_snapshot(include_metadata?)\` | Get structured JSON of all visible nodes + edges |

### Project management

| Tool | Effect on screen |
|------|-----------------|
| \`open_project(path)\` | Open a project — new tab appears |
| \`close_project(project_path)\` | Close a project tab |
| \`rescan_project(project_path?)\` | Re-parse the codebase |
| \`set_baseline(commit_hash)\` | Set the diff baseline commit |
| \`list_recent_projects()\` | List available projects |
| \`pin_project(path)\` / \`unpin_project(path)\` | Pin/unpin in recents |

### Modals

| Tool | Effect on screen |
|------|-----------------|
| \`open_settings()\` | Settings modal pops up |
| \`open_mcp_guide()\` | MCP connection guide pops up |

### Narration (Agent Presence Pane)

| Tool | Effect on screen |
|------|-----------------|
| \`present(text, speak?, require_ack?, tone?)\` | A floating card appears in the pane — optionally read aloud via TTS |
| \`await_ack(card_id, timeout_ms?)\` | Waits for the user to click "Got it" or speech to finish |
| \`await_user_input(prompt?, timeout_ms?)\` | Waits for the user to type a reply in the pane |
| \`dismiss_presence()\` | Closes the pane and clears cards |

### Capture

| Tool | Effect on screen |
|------|-----------------|
| \`screenshot(panel?)\` | Capture as PNG: "full" / "graph" / "plan" / "terminal" |
| \`clipboard_write(text)\` | Copy text to the user's clipboard |

## Common sequences

### "Show me how these files connect"
1. \`navigate_to('graph')\` — switch to graph view
2. \`graph_set_scope('src/backend/services')\` — filter to the area
3. \`graph_set_depth('file')\` — file-level view
4. \`graph_focus('src/backend/services/auth-service.ts')\` — zoom to the node
5. \`graph_select(['auth-service.ts', 'session-service.ts', 'user-service.ts'])\` — highlight related files

### "Walk me through the plan"
1. \`open_plan(plan_uid)\` — open the plan
2. \`select_item(first_object_uid)\` — start with the first Object
3. Pause, let the human read
4. \`select_item(first_action_uid)\` — move to the first Action
5. Continue stepping through items

### "Show the plan alongside the graph"
1. \`navigate_to('split', plan_uid)\` — plan + graph side by side
2. \`graph_set_mode('planned')\` — show what the plan targets
3. \`graph_toggle_projection(true)\` — ensure projection is on
4. \`select_item(action_uid)\` — clicking an item highlights its files in the graph

### "What changed since the baseline?"
1. \`set_baseline(commit_hash)\` — set the reference point
2. \`navigate_to('graph')\` — switch to graph
3. \`graph_set_mode('diff')\` — show the diff overlay
4. \`screenshot('graph')\` — capture for discussion

### "Compare before and after"
1. \`graph_set_mode('baseline')\` — show the original state
2. \`screenshot('graph')\` — capture "before"
3. \`graph_set_mode('live')\` — switch to current state
4. \`screenshot('graph')\` — capture "after"

### "Narrated walkthrough" (using the Presence Pane)
1. \`present("Let me walk you through the auth module.", { speak: true, require_ack: true })\` — introduce
2. \`graph_focus('src/backend/services/auth-service.ts')\` — show the file
3. \`await_ack(card_id)\` — wait for the human to read / hear
4. \`present("Notice it depends on session-service and user-service.", { speak: true, require_ack: true, link_to: 'auth-service.ts' })\` — explain
5. \`graph_select(['auth-service.ts', 'session-service.ts', 'user-service.ts'])\` — highlight the cluster
6. \`await_ack(card_id)\` — wait
7. \`present("Any questions before I continue?", { tone: 'question' })\` — invite dialogue
8. \`await_user_input()\` — listen for a reply, then respond or continue
9. \`dismiss_presence()\` — clean up when done

### "Ask the user a question mid-work"
1. \`present("I found two approaches for this refactor. Which do you prefer?\\n\\n**A)** Extract a shared base class\\n**B)** Use composition with a mixin", { require_ack: false, tone: 'question' })\`
2. \`await_user_input("Type A or B...")\` — wait for their choice
3. Proceed based on the reply

## Guidelines

- **Pace yourself.** The human needs time to look. Don't fire 10
  commands in a burst — step through, pause, then continue.
- **Narrate via the Presence Pane.** Use \`present()\` to explain
  what you're showing. Pair \`present(require_ack: true)\` with
  \`await_ack()\` so you wait for the human before advancing.
  Use \`speak: true\` for hands-free walkthroughs.
- **Don't over-narrate.** Not every action needs a card. Use
  presence for key insights, decisions, and questions — not
  "now I'm clicking this button" play-by-play.
- **Combine graph + plan.** Split view is powerful — highlight a
  file in the graph, then select the Action that modifies it.
- **Use screenshots** when the primary agent needs to see what's
  on screen. You're the eyes.
- **Stay in your lane.** You drive the UI. You don't create plans,
  claim Actions, or write code. If the primary agent asks you to
  do something outside UI control, say so.
`;

// ── Diagnostics skill — logs, settings, baseline, drift ───────────

const DIAGNOSTICS = `# CodeTrellis Diagnostics Guide

Focused reference for investigating issues, checking system state,
and using the drift / baseline tools.

## Logs and debugging

| Tool | What it does |
|------|-------------|
| \`get_logs(lines?, filter?)\` | Tail the application log, optionally filtered by keyword. Default 100 lines. |
| \`get_log_path()\` | Returns the current log file path + directory on disk. |
| \`screenshot(panel?)\` | Capture what the user sees: "full" / "graph" / "plan" / "terminal". |

### Common diagnostic patterns

- **"Something looks wrong in the UI"** — \`screenshot('full')\` +
  \`get_logs(50, 'error')\` to see what happened.
- **"MCP tool isn't working"** — \`get_logs(30, 'tool_error')\` to
  see if the tool errored server-side.
- **"Graph looks stale"** — \`rescan_project(path)\` to re-parse,
  then \`refresh_ui()\` to force the frontend to re-fetch.

## Settings

| Tool | What it does |
|------|-------------|
| \`get_settings()\` | Returns the full settings JSON (identity, MCP port, plan defaults). |
| \`update_settings(path, value)\` | Change a setting. Path is dot-notation: \`identity.displayName\`, \`mcp.port\`, \`plans.defaultVisibility\`, \`plans.attachmentLocation\`. |
| \`setup_agent_permissions(project_path?)\` | Auto-approve all CodeTrellis MCP tools in Claude Code settings. |

## Baseline and drift

These tools compare the codebase's current state against a reference
point to detect unplanned changes.

| Tool | What it does |
|------|-------------|
| \`set_baseline(commit_hash)\` | Pin a git commit as the "before" snapshot for diff overlays. |
| \`capture_checkpoint(plan_uid, label, project_path?)\` | Named snapshot — freeze the current codebase state for later comparison. |
| \`get_drift_report(plan_uid)\` | Compare declared file_specs / symbol_specs against what actually changed. Shows on-track, missing, and unexpected changes. |
| \`detect_deviations(plan_uid)\` | Run the deviation detector — finds files that changed outside of any plan item's declared scope. |
| \`get_deviations(plan_uid)\` | Fetch the list of detected deviations. |
| \`reconcile(deviation_uid, action)\` | Resolve a deviation: "accept" (add to plan), "revert" (undo), "ignore" (mark as noise). |

### Drift workflow

1. Create a plan with explicit file_specs and symbol_specs
2. Do the work (or let an agent do it)
3. \`get_drift_report(plan_uid)\` — see what matched and what didn't
4. \`detect_deviations(plan_uid)\` — find files touched outside the plan
5. \`reconcile(...)\` — handle each deviation

## Architecture conformity

| Tool | What it does |
|------|-------------|
| \`check_conformity(project_path?)\` | Check for circular dependencies and other architectural issues. |
| \`check_architecture(from_path?, to_path?)\` | Query dependency edges between files. |
| \`list_cross_system_edges()\` | Find HTTP, SQL, subprocess, and env coupling between modules. |
`;

// ── Multi-agent skill — terminals, claim, handoff ─────────────────

const MULTI_AGENT = `# CodeTrellis Multi-Agent Guide

Focused reference for orchestrating multiple AI agents through
CodeTrellis — launching terminals, claiming work, handing off
context, and coordinating.

## Terminal management

Each agent gets its own terminal session. Use presets to launch
the right tool for the job.

| Tool | What it does |
|------|-------------|
| \`terminal_create(preset, cwd?, plan_uid?)\` | Create a new terminal. Presets: "claude" (Claude Code), "codex" (OpenAI Codex CLI), "aider" (Aider), "shell" (plain bash). |
| \`terminal_write(session_id, input, focus?)\` | Send keystrokes to a terminal. Supports \\\\n for newlines. Set focus=true (default) to also switch the UI to that tab. |
| \`terminal_read(session_id, lines?)\` | Read the last N lines of output (ANSI-stripped). Default 50 lines. |
| \`terminal_focus(session_id)\` | Switch the terminal panel to show a specific tab. |
| \`terminal_list()\` | List all active terminal sessions with PID, preset, and status. |
| \`terminal_kill(session_id)\` | Kill a terminal session. |
| \`terminal_resize(session_id, cols, rows)\` | Resize a terminal. |

### Launching a sub-agent

\`\`\`
# 1. Create a Claude Code terminal for the auth refactor
terminal_create(preset='claude', cwd='/path/to/project',
  plan_uid='<plan-uid>')

# 2. Send the initial prompt
terminal_write(session_id, 'Please claim and work on the auth
  extraction task in the CodeTrellis plan.\\n')

# 3. Monitor progress
terminal_read(session_id, 20)
\`\`\`

## Claiming and delegating work

The claim system prevents two agents from grabbing the same Action.

| Tool | What it does |
|------|-------------|
| \`claim_item(item_uid)\` | Atomically claim an Action. Fails if already claimed by another agent. Returns the item with your name as assignee. |
| \`get_next_item(plan_uid, filter?)\` | Get the next available Action. Respects dependencies (DAG ordering) and approval gates. Optional filter: \`kind\`, \`status\`, \`parent_uid\`. |
| \`update_item_progress(item_uid, percent, note?)\` | Report progress (0-100) with an optional note. Other agents and the user can see this. |
| \`set_item_blocked(item_uid, reason)\` | Mark an item as blocked with a reason. Surfaces in the plan tree as a red indicator. |
| \`add_item_comment(item_uid, body, kind?)\` | Leave a comment. Kind: "note" (default), "blocker", "progress", "question". |

### Typical multi-agent flow

1. **Primary agent** creates the plan, structures Objects and Actions
2. **Primary agent** launches sub-agents via \`terminal_create\`
3. Each sub-agent calls \`get_next_item\` to find available work
4. Sub-agent calls \`claim_item\` to lock the Action
5. Sub-agent works, reports \`update_item_progress\`
6. Sub-agent marks the Action as \`done\` via \`update_item(uid, status='done')\`
7. If there's a gate: human calls \`approve_gate(uid)\`
8. Next sub-agent picks up the next available Action

## Handoff between agents

When handing off to a different agent (context window filling up,
different specialization needed):

1. **Leave breadcrumbs** — \`add_item_comment(uid, 'Completed X, Y
   is pending. Watch out for Z.', kind='progress')\`
2. **Set progress** — \`update_item_progress(uid, 60)\`
3. **Create an Object** as a handoff note if needed — durable context
   that survives the agent's session
4. **Use \`copy_plan_as_prompt(plan_uid)\`** — generates a markdown
   summary another agent can ingest quickly

## Session registration

| Tool | What it does |
|------|-------------|
| \`register_session(agent_type, model?, capabilities?, host_terminal_id?)\` | Register your agent identity. Shows in the Connected Agents widget. Pass \`host_terminal_id\` if running inside a CodeTrellis terminal (see below). |
| \`set_active_plan(plan_uid)\` | Link your session to a plan. The UI navigates to show it. |

## Self-write protection

When CodeTrellis creates a terminal, it sets the env var
\`CODETRELLIS_HOST_TERMINAL=<session_id>\` in the PTY environment.
If you are an agent running inside a CodeTrellis terminal:

1. Read \`$CODETRELLIS_HOST_TERMINAL\` from your environment
2. Pass it to \`register_session(host_terminal_id=...)\`
3. Any \`terminal_write\` call targeting your own host terminal will
   be **blocked** with an error — preventing a feedback loop where
   you'd type into your own stdin

This is automatic once registered. You can still write to any OTHER
terminal — only your own host terminal is protected.

## Approval gates and dependencies

- **Dependencies**: Actions can list other Action UIDs they depend on.
  \`get_next_item\` only returns Actions whose dependencies are all done.
- **Approval gates**: \`requiresApproval: true\` on an Action means
  a human must call \`approve_gate(uid)\` before the next sibling
  can be claimed. Use this for critical checkpoints.

## Tips

- **Don't hoard work.** Claim one Action at a time. If you claim 5
  and stall, the other agents sit idle.
- **Be a good citizen.** Leave progress comments and update status.
  The user is watching the plan tree — silent agents are scary agents.
- **Use focused terminals.** \`terminal_create(preset='shell')\` for
  quick commands, \`preset='claude'\` for complex sub-tasks.
- **Monitor your sub-agents.** \`terminal_read(session_id, 20)\`
  periodically to check if they're stuck.
`;
