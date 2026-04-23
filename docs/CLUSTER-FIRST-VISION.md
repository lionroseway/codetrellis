# Cluster-First Vision

## Why This Exists

CodeTrellis should help a human understand what an AI coding agent is doing to a codebase.

The goal is not just to show a dependency graph.
The goal is to make architecture legible while an agent is planning, editing, drifting, and finishing work.

In plain terms, the product should answer:

- What exists in the codebase right now?
- What is the agent planning to change?
- What has already changed locally?
- Is the agent following the plan?
- If not, where is it drifting?

## The Problem With Folder-First Thinking

Folders are useful, but they are not the architecture.

A file may live in one folder and still conceptually belong to a different part of the system.
Real codebases are often messy, historical, or inconsistently organized.

That means a folder tree can help someone find a file, but it does not reliably help someone understand the system.

CodeTrellis should therefore treat:

- Folders as navigation
- Clusters as understanding

## New Core Model

The primary model of the product should be:

`System -> Cluster -> File -> Symbol`

Where:

- `System` means the whole project
- `Cluster` means a named architectural area such as `Auth`, `Plans`, `Trellis`, `Diffing`, `Monitoring`
- `File` means a source file in that area
- `Symbol` means a top-level function, class, interface, type, or other important AST item

## What A Cluster Is

A cluster is a human-readable architectural grouping.

It should describe files that belong together for a meaningful reason, not just because they sit near each other on disk.

Examples:

- `Auth`
- `Plan Execution`
- `Trellis Snapshots`
- `Agent Monitoring`
- `Deviation Detection`
- `UI Graph Rendering`

Clusters can:

- include files from multiple folders
- be renamed over time
- be created manually by a human
- be suggested or maintained by an agent

## Folder Structure Still Matters

Folder structure should remain in the product, but as a secondary support system.

It should help answer:

- Where is this file physically located?
- What is the exact path?
- What is nearby on disk?

It should not be the main lens through which architecture is understood.

## What The Main Screen Should Help A Human See

When a human opens the graph, the main question should not be:

"What imports what?"

The main question should be:

"What area of the system is changing, what is supposed to happen there, and is the agent doing the right thing?"

That means the graph should foreground:

- named architectural clusters
- planned changes
- local changes
- current checked-in baseline
- drift from plan
- execution progress

## The Three States Inside Every Area

Whenever possible, an opened area of the system should show three simultaneous layers of understanding:

### 1. Checked-In Baseline

This is the committed state of the codebase.
It answers:

- What was here before work started?
- What symbols and dependencies already existed?

### 2. Current Local State

This is the working tree state.
It includes:

- staged changes
- unstaged changes
- untracked files

It answers:

- What has already changed locally?
- What is different from the checked-in baseline?

### 3. Planned State

This is the intended future architecture.
It answers:

- What files will be created?
- What files will be removed?
- What files will be modified?
- What functions/classes/symbols will move or change?
- What new dependencies should appear?
- What dependencies should disappear?

## The Core UX Promise

CodeTrellis should let a human do this:

1. Open a cluster like `Auth`
2. Immediately see the baseline architecture
3. See local changes already happening there
4. See planned upcoming changes in the same area
5. Understand how the plan ties together
6. Intervene if the agent is drifting

That is the main product promise.

## What Agents Should Be Able To Do

Through MCP, agents should be able to participate in maintaining the architecture model.

Examples:

- create a cluster
- rename a cluster
- assign files to a cluster
- move files between clusters
- suggest cluster changes
- annotate why a cluster exists
- attach planned changes to a cluster

This helps the graph become a living architectural map rather than a passive import diagram.

## Product Principle

The simplest guiding principle for future decisions is:

`Filesystem is for navigation. Clusters are for understanding.`

And the second principle is:

`The graph should visualize intent and change before it visualizes raw structure.`

## What Should Be Primary vs Secondary

### Primary

- Clusters
- Baseline vs local vs planned state
- Drift from plan
- Progress through planned architectural work
- Symbol-aware changes

### Secondary

- Folder tree
- Raw dependency exploration
- Generic package grouping
- Cosmetic graph layout choices

## Success Criteria

The product is succeeding when a non-expert human can open CodeTrellis and quickly answer:

- What part of the system is this work touching?
- What is supposed to change there?
- What has changed already?
- What still needs to happen?
- Is the agent following the intended architecture?

If the product cannot answer those questions clearly, it is still too close to a graph viewer and not yet close enough to mission control.
