# Code Visual Graph Checklist

Last updated: 2026-04-23

## Purpose

This checklist is the working list for the code visual graph.

Right now, the graph is the main window into the rest of the product.
Until the graph is clear, stable, and easy to read, the rest of the product will feel less trustworthy.

---

## Trellis State Definitions

These are the correct meanings of the four graph modes.

### `Baseline`

The original state with no local changes applied.

This is:

- the starting point
- the committed reference state
- what existed before untracked, staged, or unstaged work

It should answer:

- where are we starting from?
- what files, symbols, and dependencies originally existed?

### `Live`

The source of truth for how the workspace looks right now.

This includes:

- untracked files
- staged changes
- unstaged changes
- deleted local files
- current architecture as it exists on disk

It should answer:

- what is the codebase like right now?
- what has already changed locally?

### `Planned`

The plan for the currently selected branch or worktree.

This is the intended future state for that workspace.

It should answer:

- what changes are expected?
- what files or symbols will be added, removed, or modified?
- what dependencies should appear or disappear?

### `Diff`

The difference between the plan and the live state.

This is the monitoring view.

It should answer:

- is the live state matching the plan?
- what is on track?
- what is missing?
- what is unexpected?
- where is the agent drifting?

---

## Graph Workstream

### 1. State Meaning And Mode Behavior

- [ ] `Baseline` visually reads as frozen reference state
- [x] Baseline can be pinned, auto-tracked, or pinned to a recent commit
- [ ] `Live` visually reads as current truth, including local dirty state
- [ ] `Planned` visually reads as target state for the selected branch/worktree
- [ ] `Diff` visually reads as live-vs-plan comparison, not just generic file diff
- [ ] Switching modes keeps enough context so the user does not feel lost
- [ ] Local Git state remains understandable across all modes

### 2. Node Clarity

- [ ] Added files are visually obvious
- [ ] Modified files are visually obvious
- [ ] Removed files are visually obvious
- [ ] Planned add / planned modify / planned remove are visually distinct from live changes
- [ ] Untracked files are visually obvious
- [ ] Staged files are visually obvious
- [ ] Unstaged files are visually obvious
- [ ] Changed but unconnected files still appear in a sensible way
- [ ] Node cards feel readable at a glance, not muddy or overly subtle

### 3. Edge Clarity

- [ ] New connections are visually obvious
- [ ] Removed connections are visually obvious
- [ ] Changed import/call relationships are visually obvious
- [ ] Planned edge changes are distinct from live edge changes
- [ ] Edge labels are readable without cluttering the graph
- [ ] When a node is selected, its relevant edges stand out strongly

### 4. Selection And Focus

- [x] Clicking a card selects it without collapsing the whole map
- [ ] Selected cards are highlighted strongly and clearly
- [ ] Related cards remain visible while unrelated cards fade appropriately
- [ ] Selected node connections are easy to follow
- [ ] Focus/drill-down keeps enough surrounding context
- [ ] Leaving focus view is simple and obvious

### 5. Layout And Stability

- [ ] The graph no longer twitches during refreshes
- [ ] Polling updates data without re-throwing the whole map around
- [ ] The default layout feels spacious, not congested
- [x] Cards can be dragged manually
- [ ] Drill-down layout feels intentional and clean
- [ ] Cluster -> file -> symbol navigation feels top-down and readable
- [ ] Layout is good both for overview and for focused investigation

### 6. Refresh And Monitoring Controls

- [x] Auto-refresh can be paused
- [x] User can check now manually
- [x] Refresh interval can be adjusted
- [ ] Refresh behavior feels monitoring-grade and non-disruptive
- [ ] Diff refresh and graph refresh feel coordinated rather than confusing

### 7. Cluster-First Graph Structure

- [x] Overview speaks in clusters rather than packages
- [ ] Cluster names are consistently meaningful
- [ ] Cluster descriptions feel helpful and accurate
- [ ] Cluster view clearly shows baseline, live, and planned context
- [ ] Files inside a cluster are organized by importance and change state
- [ ] Saved/manual clusters exist
- [ ] Editable cluster names/descriptions exist
- [ ] MCP cluster actions exist

### 8. Git Working Tree Context

- [x] Diff summary includes staged / unstaged / untracked counts
- [x] Untracked changed files can appear in the graph
- [ ] Node cards show Git state more explicitly
- [ ] Staged vs unstaged vs untracked are distinguishable on the graph itself
- [ ] Git working tree context stays visible across all relevant modes

### 9. Plan Monitoring

- [ ] Planned view clearly shows the intended future architecture
- [ ] Diff mode clearly shows live-vs-plan gaps
- [ ] Missing planned changes are obvious
- [ ] Unexpected live changes are obvious
- [ ] Drift is visible enough that a human can intervene quickly
- [ ] Progress toward the plan is easy to understand visually

### 10. Non-Technical Readability

- [ ] A non-technical person can tell what changed
- [ ] A non-technical person can tell what is planned
- [ ] A non-technical person can tell whether the agent is on track
- [ ] The graph explains architecture intent, not just code structure

---

## Immediate Focus

These are the highest-priority items for the next passes on the graph:

1. [ ] Make the four modes visually unmistakable
2. [ ] Make node and edge state coloring much more obvious
3. [ ] Keep Git working tree context visible across the modes
4. [ ] Make diff truly about live vs planned state
5. [ ] Improve drill-down so context is preserved cleanly
6. [ ] Reduce congestion and make changed-but-unconnected files easier to place

---

## Done Recently

- [x] Introduced cluster-first overview language
- [x] Added inferred architectural cluster cards
- [x] Added custom import edges
- [x] Added draggable graph cards
- [x] Added selection emphasis for node neighborhoods
- [x] Added pause / check now / interval controls for refresh
- [x] Added Git-backed staged / unstaged / untracked summary
- [x] Included standalone changed files in graph eligibility

---

## Notes

Use this checklist as the running source of truth for the graph work.
As items are completed, update the checkboxes rather than creating scattered notes across multiple docs.
