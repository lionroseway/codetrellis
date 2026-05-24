# State Model: Manifest and Pantry

CodeTrellis separates state along the lines of a package manager: a small, mergeable manifest committed alongside the code, and a heavier pantry held locally on each user's machine.

## The split

- **`.codetrellis/` in the user's repository = the manifest.** Lightweight, readable, mergeable structured records describing plans, the work items inside them, comments, attachment references, and (as target extensions) repo-wide system documentation and channel events.
- **Local database = the pantry.** Holds the bulky and the ephemeral: full timelines, agent session metadata, drift detection results, raw tool-call streams, scratch, personal continuity content. Stays on the machine that produced it unless explicitly promoted.

This split is load-bearing. Without it, plans become too heavy to merge cleanly; with it, the manifest stays diff-friendly while heavy artefacts remain available to the humans and agents that need them.

## The manifest today: V2 plan items

The manifest is built around **V2 plan items** — a single unified tree where every node is either an **Object** or an **Action**. Trees mix freely: an Action can have Object children (its references), an Object can have Action children (embedded todos).

Disk layout under `<projectRoot>/.codetrellis/`:

```
.codetrellis/
  plans/
    <slug>/                            # slug derived from plan title + UID prefix
      plan.yaml                        # plan metadata (version: 2, uid, title, status, …)
      items/                           # V2 tree mirroring parent/child via nesting
        000-root-item/
          _self.yaml                   # parent item content
          001-child-leaf.yaml          # leaf item
          002-another-leaf.yaml
      phases/, tasks/, docs/           # V1 legacy (dual-read during migration)
  attachments/
    <item-uid>/                        # binary attachments referenced by items
  cache/                               # runtime snapshots (gitignored)
```

Directory names use **slugs** for human readability; **stable UIDs** drive all internal references. Renaming a plan does not break references from elsewhere.

A V1 layout (`phases/`, `tasks/`, `docs/`) is still readable for projects that haven't migrated. New projects use V2.

## Objects and Actions

An **Object** is durable context: a markdown body plus references, comments, and attachments. Used for spec documents, architecture notes, runbook fragments, and anything where the value is the content itself. Templates (`architecture`, `phase`, `requirements`, custom) seed Objects with a structure hint, but they remain Objects under the hood.

An **Action** is a graph-anchored work item. In addition to a title and body, an Action carries:

- **status** — `pending`, `assigned`, `in_progress`, `done`, `blocked`, `skipped`
- **assignee**, **assigneeType**, **assigneeModel** — who or what is doing this work
- **fileSpecs** — declared file changes (`create` / `modify` / `delete` / `move`), with optional per-file edits pinned to line ranges or symbols
- **symbolSpecs** — declared symbol changes (functions, classes, types — `add` / `modify` / `remove` / `move`)
- **newConnections** / **removedConnections** — declared changes to the dependency graph
- **dependencies** — other Actions that must complete first
- **skills**, **claimPolicy**, **executionConfig**, **constraints** — properties that govern which agents (or humans) can claim and execute this work

Properties like skills, claim policies, execution configs, and constraints support **cascade modes** (`inherit`, `replace`, `none`) that let them flow down the tree from parent items.

## fileSpecs and symbolSpecs

These declared intents are what makes drift detection possible. When an Action is marked `done`, its declared fileSpecs and symbolSpecs are compared against the actual codebase; mismatches surface as deviations (described in [09 — Sensors and Detection](09-sensors-and-detection.md)).

Both spec types capture a path or symbol name, an action verb, and optional context (intent label, line range, signature, move target).

## The pantry today: local database

The pantry is a sql.js database at `~/.codetrellis/data.db` (configurable via `CODETRELLIS_DATA_DIR` or settings). Auto-saved every 30 seconds when dirty; explicit `saveNow()` on critical mutations.

What lives in the pantry **and** is exported to the manifest:

- Plan and plan-item rows (mirrored to YAML under `.codetrellis/plans/`)
- Item versions (per-edit history)
- Comments and attachments (inlined into item YAML on export)

What lives in the pantry as **DB-only today**:

- **plan_events** — the per-plan timeline of structural mutations (item created, status changed, claimed, …). The seed of the future channel event log.
- **agent_sessions** — registered agent connections, with capabilities, model, and host terminal binding.
- **deviations** — drift detection results, with resolution state.
- **external_refs** — links to GitHub issues, Figma frames, Jira tickets, and similar.

The pantry is also where personal-continuity content lives — previously opened projects, user preferences, draft plans not yet promoted — which travels with the machine unless the user opts into personal sync. See [14 — Configuration and Personal Continuity](14-configuration-and-personal-continuity.md).

## File format choices

Formats are chosen for how they merge, not for how they serialise:

- **Plan metadata** lives in `plan.yaml`.
- **Each item is its own YAML file**, with `_self.yaml` + child files for parents and a single `NNN-slug.yaml` for leaves. Sibling order is encoded by the numeric prefix.
- **Bodies are markdown**, stored inline as a YAML string.
- **Comments and attachments are inlined** as YAML arrays on the parent item rather than separate files — they're small, item-scoped, and merge cleanly.
- **Binary attachments** live under `.codetrellis/attachments/<item-uid>/`, referenced by the item.

The principle: two engineers on different branches can both modify a plan without producing a merge conflict in the common case. When conflicts do arise (status fields, assignees), the application surfaces them at the field level rather than as raw merge markers.

## Sync between disk and database

A file watcher (chokidar) monitors `.codetrellis/plans/` for external changes — a `git checkout`, a teammate's branch, a manual edit. Changes are re-imported into the DB by UID upsert (idempotent).

In the other direction, mutating tools call a 200ms-debounced write-through that exports affected plans. Self-write detection via timestamp stamps prevents the watcher from re-importing the application's own writes.

## Per-item sharing

Every artefact has a default home and a default visibility. The user can override the defaults per item; the application asks only when an action deviates from the default.

The complete taxonomy (♦ = built today, ○ = target extension):

| Category | Artefact | Default location | Default visibility | Override |
|---|---|---|---|---|
| **Team coordination** | Plan ♦ | Manifest | Team-shared | Local draft until exported |
| | Plan item (Object) ♦ | Manifest | Team-shared | Inherits from parent |
| | Plan item (Action) ♦ | Manifest | Team-shared | Inherits from parent |
| | Comment ♦ | Manifest (inline in item) | Team-shared | None |
| | Channel event ○ | Manifest (target — today DB-only as `plan_events`) | Team-shared | Audit record; not optional |
| | System documentation entry ○ | Manifest (target — `.codetrellis/docs/`) | Team-shared | Always shared when committed |
| | External reference ○ | Manifest (target — today DB-only) | Inherits from item | N/A |
| **References** | File reference ♦ | Manifest (within an item's fileSpecs) | Inherits from item | N/A |
| | Symbol reference ♦ | Manifest (within an item's symbolSpecs) | Inherits from item | N/A |
| | Graph connection ♦ | Manifest (within an item's connections) | Inherits from item | N/A |
| **Working material** | Attachment (URL, image, file_ref, transcript, code_block) ♦ | Manifest (inline ref) + Pantry (binary, if applicable) | Per item, on creation | Binary location configurable |
| | Screenshot ○ | Pantry | Local | Promote per-item |
| | Tool-call stream ♦ | Pantry (in `plan_events` and presence cards) | Local | Usually folded into channel events on promotion |
| | Graph snapshot ♦ | Pantry (`graph_snapshot` MCP tool) | Local | Promote at milestones |
| | Terminal output capture ♦ | Pantry (xterm buffer) | Local | Promote excerpts to comments |
| **Personal continuity** | Recently opened projects ♦ | Pantry | Local to machine | Personal sync (target) |
| | User preference ♦ | Pantry (`settings.json` on disk) | Local to machine | Personal sync (target) |
| | Draft plan ♦ | Pantry until promoted | Local to machine | Personal sync (target) |

When an item references material the viewer does not have locally, the UI shows a graceful placeholder. The reference survives; the content is available on demand.

How users actually make these per-item decisions, and how project-wide and user-wide overrides combine, is described in [14 — Configuration and Personal Continuity](14-configuration-and-personal-continuity.md).

## Target extensions to the manifest

Several manifest entity types are planned extensions to today's foundation. Each becomes necessary as team workflows come into scope:

| Extension | What it adds | Why |
|---|---|---|
| **Channel events as first-class manifest entries** | Today's `plan_events` is DB-only. Channel events (stuck, steer, need-decision, need-context, handing-off, weigh-in) committed to the manifest become durable, shareable team-coordination history. | Without this, channels can't span teammates or machines. |
| **Repo-wide system documentation** at `.codetrellis/docs/` | Markdown documents describing the system as it stands, distinct from plan-scoped specs. Maintained jointly by humans and agents. | Reduces context pressure for both onboarding humans and planning agents. See [07 — System Documentation](07-system-documentation.md). |
| **Per-project configuration** at `.codetrellis/config.json` | Project-level overrides for sharing defaults, sensor sensitivity, channel routing, documentation policy. Committed and reviewable like any other manifest content. | Lets teams agree on conventions for their project rather than relying on per-user defaults. |
| **Stable cross-repo plan identifiers** + `.codetrellis/external/` pointers | Plans hosted in one repo are referenced from sibling repos for cross-repo work. | Required for the home-and-link and central-oversight [deployment shapes](03-deployment-shapes.md). |
| **External refs as exported manifest content** | Today external refs (GitHub issues, Figma, Jira) are DB-only. Exporting them makes the linkage durable across team members. | Without this, links to outside systems don't travel through git. |

## What this gives the system

The manifest-and-pantry split produces a small set of properties that the rest of the architecture depends on:

| Property | Why it matters |
|---|---|
| Manifest is small and structured | Plans, items, and (when extensions land) channel events merge cleanly under git, across branches and forks |
| Pantry is local | Heavy or private working material does not leak into shared state without an explicit decision |
| References use stable UIDs | Renames, moves, and refactors do not break links between entities |
| Defaults are opinionated | Users do not have to make a sharing decision on every action; the common case is sensible without thought |
| Sync is automatic but bounded | Manifest and pantry reconcile through the file watcher and the export pipeline, with self-write detection to prevent loops |
