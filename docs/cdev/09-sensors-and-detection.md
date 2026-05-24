# Sensors and Detection

CodeTrellis's intervention surface depends on detecting when an agent or a plan is in a state that warrants attention. This document describes the sensors that produce those detections — what's built today and what extends as channels and team workflows land.

## What the sensors are for

An event is only useful if it fires at the right moment. Fire too early and the agent is interrupted before it has had a chance to succeed; fire too late and the agent has already burned its context attending to its own failed attempts. The sensor layer's job is to fire correctly.

Three sensor classes are in scope:

| Class | What it detects | Status |
|---|---|---|
| **Drift sensors** | Divergence between the plan and the work actually being done | Built today |
| **Stuck sensors** | Patterns of agent activity that indicate failed loops or stalled progress | Target extension |
| **Documentation sensors** | Divergence between system documentation and the current state of the code | Target extension (depends on the repo-wide documentation layer) |

## Drift sensors today

Every Action in a plan declares its intended changes — `fileSpecs` (files to create / modify / delete / move), `symbolSpecs` (functions, classes, types to add / modify / remove / move), and `newConnections` / `removedConnections` (dependency-graph edges to introduce or remove). Drift sensors compare those declared intents against the live codebase and surface mismatches as deviations.

What gets flagged today, by type:

| Deviation type | Condition |
|---|---|
| `missing_file` | An Action with status `done` declares a file via `create` / `modify` / `move`, but the file does not exist on disk |
| `unexpected_file` | A file has changed since the baseline but is not in any Action's `fileSpecs` |
| `missing_import` | An Action with status `done` declares a `newConnections` edge, but the resolved imports don't include it |

Detection is on-demand and idempotent. The `detect_deviations` tool runs the comparison; running it twice doesn't produce duplicate deviations. The `get_deviations` tool returns the pending list. The `get_drift_report` tool combines plan-aware classification (satisfied / in-progress / missing / planned / unexpected) with a filesystem-verified snapshot diff.

### Resolution

When a deviation is detected, a human (or, in the target extension, the agent) decides what it means. The `reconcile` tool accepts resolutions:

- **`accepted`** — the deviation represents necessary work that wasn't planned. For `unexpected_file` deviations specifically, accepting creates or updates a "Reconciled changes" Action in the plan, appending the file to its `fileSpecs` so it stops being flagged as drift. The plan now reflects reality.
- **`reverted`** — the change was a mistake; the human reverts the file (the application doesn't do the revert, but it stops flagging the deviation once the file is restored).
- **`ignored`** — the deviation is acknowledged but no action is taken.

This is the workflow today: detect → review → reconcile. With the channel extension, the drift sensor will additionally emit a `need-decision` event into the plan's channel, routing the deviation to whoever should respond.

### Baselines and checkpoints

The `capture_checkpoint` tool stores a named snapshot of the codebase state at a moment. The graph's `baseline` mode can pin to a checkpoint or a git commit, and the `diff` mode shows the delta. These provide the reference point against which `unexpected_file` deviations are computed.

The 8 drift tools (built today) cover this surface:

- `detect_deviations` — run detection now
- `get_deviations` — list outstanding deviations
- `reconcile` — accept / revert / ignore
- `list_proposed_changes` — granular per-file/symbol/connection feed with drift status
- `get_changes_summary` — aggregate counts ("12 of 18 satisfied")
- `get_change_status` — fresh recompute for one change
- `get_drift_report` — full plan-vs-live report with comment activity
- `capture_checkpoint` — named snapshot

## Stuck sensors (target)

The stuck sensor watches the tool-call stream and the agent's outputs for patterns that indicate the agent is no longer making progress. Heuristics under consideration as the sensor lands:

| Pattern | Indication |
|---|---|
| The same tool is called repeatedly with diminishing variation in arguments | The agent is trying a small set of approaches without learning from failure |
| Tests fail multiple times with no measurable convergence in the failure | The agent is patching symptoms rather than addressing causes |
| Time since the last meaningful commit exceeds a threshold | The agent is producing output but not progress |
| The agent's recent outputs paraphrase one another without introducing new information | A semantic loop is in progress |

Each pattern would have a sensitivity setting, configurable per project so teams can fit the heuristics to the kind of work they do. False positives are not catastrophic — the agent is asked whether it needs help — but false negatives mean an agent grinds without intervention.

When a pattern fires, the sensor will emit a `stuck` event into the plan's channel and pause the agent at its next natural break.

Agents can also self-report stuck (the preferred path); the platform's sensor is the safety net for agents that haven't built in their own loop detection. Both paths produce identical channel events.

## Documentation sensors (target)

Once the repo-wide documentation layer ([07 — System Documentation](07-system-documentation.md)) lands, the documentation sensor closes the loop between docs and code.

Documentation entries can reference specific locations in the code and assert specific properties: "this service is consumed by the following clients," "this function returns the type described above," "this configuration value defaults to X." When the underlying code changes in a way that affects an asserted property, the sensor flags the documentation for review.

This produces a `need-decision` event proposing either a documentation update or a code change. It is the same mechanism the plan-drift sensors use, applied to documentation as the source of truth.

## Sensor data flow (target)

Once channels and stuck / documentation sensors are in place, the data flow is consistent across sensor classes:

```
agent action / file change / commit
        │
        ▼
sensor evaluates against expected state
        │
        ▼
sensor emits channel event
        │
        ▼
event is written to the plan's channel
        │
        ▼
event is routed to subscribed humans (and any helping agents)
   (push notification, in-app indicator, optional external bridge)
        │
        ▼
responder posts a steer, decision, handoff, or dismiss
        │
        ▼
the channel records the full exchange
```

Today, drift detection follows a simpler version of this flow — detection produces a deviation row in the database; the user reviews it in the drift banner on the plan; resolution updates the deviation status. With the channel extension, drift detections fan out into the channel as `need-decision` events with the same payload, routable to teammates.

## Why sensor design matters

The sensor layer is the difference between a tool that records what happened after the fact and a tool that intervenes while there is still time to change the outcome. A plan-and-record tool is valuable; an intervene-while-it-matters tool is structurally different.

This is why drift, stuck, and documentation-divergence detection are first-class concerns, not secondary features. They are the inputs to the entire intervention surface described in [08 — Agent Collaboration](08-agent-collaboration.md).
