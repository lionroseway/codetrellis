# Graph UX Refinement

## Purpose

This document translates the cluster-first vision into a practical graph UX direction.

It is intentionally written in plain language.
It should help guide product and implementation decisions before code changes are made.

## Current Pain Points

The current graph feels impressive, but still hard to reason about.

The biggest issues are:

1. The graph can jump around between refreshes, which makes it hard to track meaning.
2. The graph still emphasizes folders/packages too much.
3. Planned changes are not yet the clearest thing on screen.
4. It is hard to compare baseline, local work, and planned work in one mental model.
5. The graph is better at showing connections than it is at showing architectural intent.

## Desired Default Mental Model

The default graph should communicate:

`What this system area is`
-> `what exists there`
-> `what is changing`
-> `what is planned`
-> `whether execution matches the plan`

That means the graph should feel like an architecture workspace, not just an import map.

## Recommended Information Hierarchy

### Level 1: Cluster View

The first thing a user should understand is the major areas of the system.

Examples:

- Auth
- Plans
- Trellis
- Monitoring
- Graph UI
- Persistence

Each cluster card should summarize:

- cluster name
- short description
- key files
- important symbols
- inbound/outbound architectural connections
- planned changes count
- live/local changes count
- drift warnings if any

### Level 2: File View Within A Cluster

When a cluster is opened, show the files that matter inside it.

Each file should reveal:

- checked-in existence
- local change state
- planned change state
- key exports/symbols
- new or removed dependencies

The emphasis should be on changed and planned files first, not every file equally.

### Level 3: Symbol View

When a specific file is focused, show important top-level symbols.

This is where AST awareness becomes useful.

A human should be able to see:

- what functions/classes currently exist
- what symbols are planned to be added
- what symbols are planned to change
- what symbols are planned to be removed

## The Three States The Graph Must Show

The graph should always be grounded in three states:

### Baseline

What is checked in.

Visual meaning:

- stable
- muted
- trusted reference state

### Local / Live

What exists in the working tree right now.

Visual meaning:

- active
- currently changing
- may include staged, unstaged, and untracked work

### Planned

What the agent or human intends the architecture to become.

Visual meaning:

- future-oriented
- explicit
- should make upcoming changes obvious even before code exists

## Important UX Rule

The user should not need to mentally merge multiple toggles to understand the story.

If the product has:

- a trellis mode selector
- a projection toggle
- a depth selector

then those controls must work together in a way that feels obvious.

The user experience should answer:

- am I looking at before, now, or target?
- am I looking at clusters, files, or symbols?
- what is changing in this view?

## What Happens When A User Opens A Cluster

Opening a cluster should immediately show:

1. The checked-in architecture for that cluster
2. Any local changes in that cluster
3. Any planned changes in that cluster
4. How those planned changes connect together
5. Whether current work matches the plan

This should work even if there is no active plan.

In that case the graph should still show:

- baseline
- local diff

And if there is an active plan, it should add:

- planned additions
- planned removals
- planned symbol/file changes

## What Should Be De-Emphasized

The following should still exist, but should not dominate the main experience:

- raw folder hierarchy
- package grouping as the main architecture lens
- equal visual importance for unchanged files
- generic graph beauty over explanatory clarity

## Suggested Visual Priorities

### Most visually prominent

- focused cluster
- files with planned changes
- files with local changes
- drift warnings
- task and progress markers

### Medium prominence

- nearby supporting files
- inbound/outbound relationships
- important symbols

### Low prominence

- unchanged background files
- generic folder/package containers
- decorative graph complexity

## MCP Capabilities To Support This

The graph becomes much more useful if agents can shape the architecture model.

Future MCP tools should support:

- create_cluster(name, description)
- rename_cluster(cluster_id, new_name)
- assign_files_to_cluster(cluster_id, files[])
- remove_files_from_cluster(cluster_id, files[])
- suggest_cluster_changes(plan_uid)
- annotate_cluster(cluster_id, note)

These tools would let agents help maintain a meaningful system map over time.

## Product Rules For Future Graph Changes

Use these as a quick test before shipping graph changes:

1. Does this make the plan easier to understand?
2. Does this make current work easier to compare against baseline?
3. Does this make drift more obvious?
4. Does this help a non-expert understand what the system area means?
5. Is this organized around architecture rather than folders?

If the answer is mostly no, the change is probably improving the graph viewer rather than improving CodeTrellis.

## Recommended Next Implementation Themes

These are the highest-value next steps after this document:

1. Stabilize layout so nodes do not jump unnecessarily.
2. Make planned view a true target-state view rather than a thin overlay.
3. Introduce first-class cluster definitions.
4. Make cluster view the default architecture view.
5. Show baseline, local changes, and planned changes together inside the same system area.
6. Expand from file-level planning into symbol-aware planning where possible.

## Summary

The graph should evolve from:

`dependency explorer`

into:

`architecture mission control for AI coding agents`

The strongest way to get there is:

- cluster-first understanding
- baseline/local/planned comparison
- symbol-aware change visibility
- drift detection that is easy to see
- folders kept as a useful but secondary support system
