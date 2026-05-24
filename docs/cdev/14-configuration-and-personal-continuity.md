# Configuration and Personal Continuity

CodeTrellis is built around a small set of decisions the user makes — what to share, what to keep local, what to bring across machines. Most decisions have sensible defaults; the configurable surface is intentionally narrow. This document gathers what's configurable today and what extends as team workflows land.

## What's configurable today

The current settings surface is small and lives in `~/.codetrellis/settings.json`. There are four groups:

| Group | Settings | Purpose |
|---|---|---|
| `identity` | `displayName`, `email` | The canonical author identity, seeded from `git config user.name` and `user.email` at first run. Used as the `author` on every record. |
| `mcp` | `port`, `autodetectOnCollision` | The MCP server port (default `19432`) and whether to try the next port if it's in use. |
| `plans` | `defaultVisibility`, `attachmentLocation` | Whether new plans default to `shared` (exported to `.codetrellis/plans/`) or `local` (DB-only); whether binary attachments live in the project (`.codetrellis/attachments/`) or in the user's home (`~/.codetrellis/`). |
| `data` | `dataDirOverride` | Override for the location of `~/.codetrellis/`. Also settable via the `CODETRELLIS_DATA_DIR` environment variable. |

Settings are per-user (one user, one `settings.json`). Changes via `update_settings` (an MCP tool) take effect immediately — except port changes, which require a restart.

That's the whole configurable surface today. Per-project config, sharing-default overrides per item, sensor sensitivity, notification routing, personal sync — all of these are target extensions described below.

## How sharing decisions work today

The default visibility decision happens at **plan creation time**, governed by `plans.defaultVisibility`:

- **`shared`** — the plan is exported to `.codetrellis/plans/<slug>/` as YAML + markdown, and tracked by git like any other manifest content. Teammates who pull the repo see the plan.
- **`local`** — the plan stays in the sql.js DB. It doesn't get exported; teammates don't see it. Useful for personal drafts and exploratory plans.

A plan can move between states: `export_plan_to_files` promotes a local plan to shared, `unlink_plan_from_files` demotes a shared plan back to local. Plan-level sharing is a clean toggle today.

What doesn't exist yet, in the per-item sharing UX:

- A per-item "share with team" / "keep local" toggle in the application (the data model supports this via item-level fields, but the UI surface and the explicit decision moment are target work).
- Per-attachment promotion ("share this screenshot with the team") — today attachments go where their containing item goes.
- Per-project sharing-default overrides — today `plans.defaultVisibility` is per-user.

## Target extensions

The following are described as the team-capable configuration surface that grows from today's foundation.

### Three levels of override

| Level | What it controls | Where it is set |
|---|---|---|
| Per-item | Whether this specific artefact is shared with the team | The artefact's detail view |
| Per-project | The default for new artefacts of this type in this project | `.codetrellis/config.json`, committed to the manifest |
| Per-user | The user's preferred defaults across all projects | `~/.codetrellis/settings.json` |

Per-item beats per-project beats per-user. The application would never override a per-item decision the user has made explicitly.

### Per-project configuration (`.codetrellis/config.json`)

A committed-to-git config file the team can edit and review together, with fields like:

- Sharing defaults for new plans, items, attachments
- Sensor sensitivity (drift, stuck, documentation)
- Channel notification routing rules ("page Maria if a plan is stuck for >15 min")
- Documentation policy (whether agents may auto-propose updates, whether updates require a specific reviewer)
- Which levels of adoption the project enables / disables

These settings would be manifest content like everything else — committed, reviewable, mergeable. A team can disagree on defaults; the project file documents what they've agreed on.

### Personal continuity across machines

Today, the pantry (DB + settings file) is per-machine. Each device the user opens CodeTrellis on starts fresh, except for what travels via git in the manifest. The target adds optional personal sync of pantry content the user wants to bring along:

| Option | Behaviour | Suitable for |
|---|---|---|
| **No sync** (default) | Each machine has its own pantry. Drafts, preferences, project history are local. | Single-machine users; users who prefer a clean slate per device. |
| **Selective sync** | The user marks specific drafts or preferences as "follow me." Selected items sync through a personal store the user controls. | Users with privacy preferences who want only some things to travel. |
| **Full personal sync** | The user opts to bring the entire pantry across machines. | Users who want the same working context everywhere. |

The personal store is BYO: a personal git repository, a sync service the user already has, or a built-in option the application provides. The choice is made on first use on a new machine; changeable later.

### What stays machine-local even with full sync

Some content is always machine-local, even with full personal sync enabled:

- **Live tool-call streams** during an active agent session. Sync only after a checkpoint or channel event the user chose to keep.
- **Open terminal sessions.** The application doesn't sync running processes.
- **Cached graph computations.** Rebuilt from source on each machine.
- **Secrets the user has pasted into a scratchpad.** Detected and never auto-synced.

### Setting up on a new machine (target)

When the user opens the application on a machine for the first time, the application asks two questions in sequence:

1. **Sign in or identify yourself.** Used to associate scratch work and preferences with a specific person. Uses the identity sources described in [06 — Agent Identity and Attribution](06-agent-identity-and-attribution.md).
2. **Bring personal context across?** If the user has used the application before, the application offers to restore their preferences and (if they choose) their drafts, project history, and other pantry contents.

After these two questions, the user points the application at a repository. Project state is restored from the repository's manifest.

## Decisions the system asks the user to make

Once the target extensions land, three kinds of moments invite a decision:

| Moment | What is being decided | Today |
|---|---|---|
| Creating a new artefact | Where it lives (manifest or pantry) and who can see it | Plan-level only via `plans.defaultVisibility` |
| Promoting working material | "Share this screenshot, transcript, or snapshot with the team" | Promote-whole-plan only (`export_plan_to_files`) |
| Setting up a new machine | "Bring my personal context along, or start fresh" | Target |

Each of these has a quiet default. The user only sees a chooser when an action would deviate from the default — or when they explicitly ask to change a per-item setting.

## Configuration is itself a decision

The application defaults are opinionated for a reason: most users don't want to configure software before they use it. The configurable surface is real but secondary. Users who want to think about every default can do so; users who want to start working immediately can do so without setting anything.

This is the same posture as the rest of the product: adopt what serves you, ignore the rest, and trust the defaults until you have a reason to change them.
