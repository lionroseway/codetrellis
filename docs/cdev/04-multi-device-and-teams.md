# Multi-Device Continuity and Team Collaboration

The state model and deployment shapes together produce two important properties: a single user's work travels with them across machines, and a team's work converges naturally through the same git flows they already use for code.

Both properties described here — personal continuity across devices and team collaboration — are independently useful. A single user need not adopt team collaboration; a team need not give up personal continuity. Each is engaged when the work calls for it. The mechanism underneath both is the same git substrate, so the cost of supporting either or both is one and the same.

## Personal continuity

A developer starts a plan on a desktop, continues on a laptop in the afternoon, and finishes on a tablet that evening. The expectation is that each device shows the same plans, the same decisions, the same history — without any explicit import step.

The mechanism is plain git:

- The manifest lives in the repository. Cloning the repository on a new machine restores all plans, specs, decisions, and channel history.
- The pantry, by default, stays on the machine that produced it. Personal preferences and scratch work that the user wants to bring along can be optionally synced through a separate personal store.

When the application opens a project on a new device, it detects the `.codetrellis/` directory and restores the project state immediately. If the user has used the application before, it can offer to bring across personal scratch from another device. The team's work travels through git; the personal work travels by user choice.

## Team collaboration

Multiple people working on the same project see each other's plans, decisions, and progress through the same mechanism. The application uses git as the synchronisation primitive: fetches happen on user action or at intervals, and changes appear in the UI as they arrive.

Three properties matter: attribution, draft state, and sharing controls.

### Attribution

Every action carries a human identity. Plans, decisions, specs, and channel events all record who made them. The git author on the underlying commit provides the audit-trail anchor; the application surfaces this in the UI without the user having to read git log.

When an agent acts on a person's behalf, the human is the named actor and the agent is recorded as the tool. A canonical attribution string takes the form `[person]'s [agent] ([model])` — for example, `Maria's coding agent (a large reasoning model)`. The human is the responsible party; the agent is an attribute of their action.

Attribution is not optional. There are no anonymous edits, no shared-account artefacts, no "the system did it." Every change in the manifest is traceable to a specific person and, where applicable, the specific tool they used.

### Drafts and published state

Not every plan starts as team material. The application maintains a distinction between *draft* (local-only, in the pantry, exploratory) and *published* (in the manifest, shared with the team). Promoting a draft to published is an explicit action that commits the plan to the working branch.

This matters because exploratory thinking should not show up in the team's plan list. The author decides when a plan is real enough to share.

### Sharing controls

The default sharing posture is opinionated:

| Entity | Default visibility |
|---|---|
| Plans, specs, decisions | Team-shared |
| Phases and their statuses | Team-shared |
| Channel events (stuck, steer, handoff, checkpoint) | Team-shared |
| Screenshots, video walkthroughs | Local; shareable on request |
| Raw agent transcripts | Local; shareable on request |
| Graph snapshots | Local; shareable at milestones |

Defaults can be overridden per item. The principle is that team coordination signal is shared by default; personal working material is local by default. Users do not have to make a sharing decision on every action.

## Activity, history, and decision archaeology

Because every meaningful event is a commit in the manifest, the application can render activity views that draw entirely from git:

- **Team activity feed.** Recent changes to plans, decisions, and channel events across the project, attributed and timestamped.
- **Per-plan history.** Every change to a plan rendered as plan UI rather than raw diff — easier to read than git log.
- **Decision archaeology.** "Why did we choose this approach?" answered by replaying the plan as it stood at the time of any historical commit.

The activity feed and history rail are not separate persistence systems. They are projections of the manifest's git history, computed on demand. There is no additional database to keep in sync.

## Stakeholders who do not run the application

Non-engineers often need to read a plan without installing developer tooling. Because the manifest is markdown and structured JSON in a normal repository, anyone with access to the repository can read the plan through the host's web UI — no application required.

This means product managers, designers, and other stakeholders can review plans, leave comments via the host's existing review tools, and follow progress without crossing into engineer-only tooling. The application is the rich interface; the manifest is the universal one.

## Conflict resolution

Two engineers editing the same plan on different branches can produce a conflict. The application resolves these at the field level wherever possible:

- Status fields (assignee, phase status, plan state) surface a small chooser UI: "X set this to A, you set it to B — pick one."
- Free-text fields (spec bodies, decision rationale) fall through to git's three-way merge, since these are markdown and merge naturally most of the time.

This keeps the user out of raw merge-conflict syntax for the structured parts of the manifest, while letting git do what it does well for prose.
