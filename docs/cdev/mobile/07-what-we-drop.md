# What the Mobile Drops (and Why)

The mobile is a workspace, not a clone. These desktop features are
deliberately excluded from the mobile version.

## Dropped from mobile

### 1. The WebView dashboard

The current inline-HTML WebView that renders a flat snapshot. This
was the v0 prototype. Replaced entirely by native screens in M1.

### 2. Free-form graph canvas

ReactFlow with drag, multi-select, layout controls. Replaced by the
drill-down hierarchy (06-graph-on-mobile.md). The data is the same;
the interaction model is different.

### 3. Plan authoring

Creating plans, writing spec doc bodies, editing item details. This
is keyboard-intensive work better done at the desk. The mobile can
*read* everything and *respond* to events, but it doesn't offer a
blank-page authoring experience.

Exception: posting channel events (steer, weigh-in) IS authoring and
IS supported. Short-form responses are phone-appropriate.

### 4. Settings management

Changing AST parser config, updating identity, configuring MCP
server URLs. The mobile has a minimal settings screen (connection
management, notification preferences). All other settings are
desktop-only.

### 5. File editing / code review

The inspector panel on desktop shows file contents with syntax
highlighting. The mobile does not render full file contents. The
graph's symbol detail view shows signatures and relationships, not
source code.

### 6. Proposed changes diff view

The desktop's PlanDiffPanel shows git-style diffs of proposed
changes. On mobile, proposed changes appear as a summary (file name,
change type, line count). Full diffs are desktop-only.

### 7. Template management

Creating and publishing plan templates. Desktop-only workflow.

### 8. System documentation authoring

Writing and editing system docs. Reading system docs on mobile could
be added later (it's just markdown rendering), but authoring is
desktop-only.

## What this means

The mobile covers:
- **Browse** — projects, plans, items, graph, terminals, events
- **Respond** — channel events, agent input requests
- **Watch** — terminals, walkthroughs, agent activity
- **Inject** — terminal input, event responses

The mobile does NOT cover:
- **Create** — new plans, specs, templates, docs
- **Configure** — settings, parsers, integrations
- **Edit** — code, diffs, item bodies

This matches the "respond and monitor from the couch" usage pattern.
Creating and editing happen at the keyboard.
