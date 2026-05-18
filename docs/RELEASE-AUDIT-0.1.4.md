# v0.1.4 Release Audit — Tests, UX & The Untested Core Flow

> Date: 2026-05-18
> Context: v0.1.4 shipped with Phases 13-17 (plan authoring, integrated
> terminal, UX overhaul, plan export/import). The desktop build terminal
> was broken and hotfixed. We've been focused on building the UX but
> haven't actually tested the end-to-end workflow: **writing a plan in
> CodeTrellis and having a coding agent execute it via MCP**.

---

## The Big Gap

The core value proposition of CodeTrellis is:

1. User writes a plan
2. Agent connects via MCP, reads the plan
3. Agent executes tasks, reporting progress
4. User monitors drift, approves gates, steers the agent

**We have never tested this flow end-to-end in the current V2
workspace.** Every piece exists in isolation (MCP tools tested, plan
CRUD tested, terminal tested, drift detection built) but the full
loop has not been validated against real agent behaviour.

This is the single highest-priority gap. Everything else is secondary.

### What "testing the core flow" means concretely

1. Open CodeTrellis, scan a real project
2. Create a plan using the V2 workspace (not MCP, not API — the UI)
3. Add Objects (scope pages) and Actions (work items) with file targets
4. Write spec docs with acceptance criteria
5. Connect Claude Code (or another agent) via MCP
6. Hand the plan to the agent
7. Watch the agent pick up tasks, report progress, modify files
8. See drift detection fire when the agent goes off-plan
9. Use approval gates to steer the agent
10. See readiness score update as tasks complete
11. Review the completion retrospective

**Steps 2-4 are where UX issues will surface.** Steps 5-11 exercise
the MCP + monitoring pipeline.

---

## E2E Test Coverage

### Current State: 86 tests, 39% API coverage

| Suite | Files | Tests | Quality |
|-------|-------|-------|---------|
| Legacy `e2e/` | 6 | 44 | Targets running dev server; fragile |
| Harness `tests/e2e/` | 9 | 42 | Hermetic (isolated backend per test); solid |

### Well-Covered (keep, don't rewrite)

| Area | Tests | Coverage |
|------|-------|----------|
| Plan Items (V2 model) | 8 tests, 496 lines | 100% of endpoints |
| Legacy Tasks | 11 of 13 endpoints | 85% |
| Plan Export/Import | 4 tests, 211 lines | Round-trip verified |
| Cross-System Edges | 3 tests, 190 lines | HTTP TS-Python matcher |
| Multi-Agent Contention | 4 tests, 107 lines | Concurrent + sequential claim |
| Templates | 4 tests, 140 lines | List + apply with placeholders |
| Agent Loop (file watcher) | 2 tests, 125 lines | Auto-advance on file change |

### Zero Coverage (must write)

| Area | Endpoints | Why It Matters |
|------|-----------|----------------|
| **Plan Docs** | 8 CRUD | Spec docs are how users define what agents should build. Core authoring flow. |
| **Plan Phases** | 4 CRUD | Structural containers that group work. Agents use phases for sequencing. |
| **Git Integration** | 6 endpoints | Diffing engine. Branch detection, commit log, working tree status. Baseline for drift. |
| **Terminals** | 7 endpoints | Just built and hotfixed. PTY create/kill/inject, session list. |
| **Deviations/Drift** | 2 endpoints | The monitoring loop. Agent goes off-plan, user sees it. |
| **References** | 5 endpoints | File/symbol linking. How plans point at code. |
| **Baselines/Trellis** | 7 endpoints | Architecture snapshots. Before/after comparison. |
| **Settings** | 2 endpoints | User config. Identity for plan authorship. |
| **Sessions** | 3 endpoints | Agent session management. Plan assignment. |

### Recommended New Test Files

```
tests/e2e/plan-docs.test.ts        — CRUD on PlanDocument (create, read, update, delete, versions, by-type)
tests/e2e/plan-phases.test.ts      — CRUD on PlanPhase (create, reorder, delete, task grouping)
tests/e2e/git-integration.test.ts  — Branch, commits, status, baseline capture, diff
tests/e2e/terminals.test.ts        — Create, list, inject, kill, resize
tests/e2e/deviations.test.ts       — Detect drift, reconcile (accept/ignore)
tests/e2e/references.test.ts       — Add/list/update/delete item refs
tests/e2e/settings.test.ts         — Get/put settings, identity defaults
tests/e2e/full-loop.test.ts        — THE BIG ONE: plan creation -> agent pickup -> execution -> drift -> completion
```

**Estimated effort: ~35-45 new test cases across 8 files.**

---

## UX Issues

### Critical — Blocks the Core Flow

#### 1. Template Picker Button Is a Stub
**File:** `src/frontend/components/plan/PlanList.tsx` line 110-115
**What:** The template button shows a "coming soon" toast. `PlanTemplateChooser.tsx` exists in the V2 folder but isn't wired to the button. Users can only create blank plans from the UI. Templates work via MCP (`create_plan_from_template`) but not the UI.
**Impact:** Users must hand-author everything from scratch or use the CLI. The 5 built-in templates (mass-refactor, new-feature, bug-fix, library-migration, perf-pass) are invisible to non-agent users.
**Fix:** Wire PlanTemplateChooser to the "From template" button. Show template cards with descriptions and placeholder prompts.

#### 2. No Save Feedback
**File:** V2 workspace components (PlanItemCanvas, body editor)
**What:** Edits auto-save via 500ms debounce but there's no visual indicator. No "Saving..." spinner, no "Saved" checkmark, no dirty-state dot on the title.
**Impact:** User edits a plan, switches away, and has no idea whether changes persisted. If the save fails silently (network hiccup, IPC error), edits are lost.
**Fix:** Add a save status indicator in the workspace header: idle -> "Saving..." -> "Saved" with timestamp. Show error state if save fails.

#### 3. Silent Failure Handlers (59 instances)
**Pattern:** `.catch(() => {})` or `try { ... } catch { /* */ }` across stores and components.
**High-risk instances:**
- Plan import warnings shown as count only, no details
- Drift reconcile failure — no toast
- Agent handoff assignment failure — shows info toast instead of error
- Attachment upload failure — silent
- Item move/reorder failure — silent
**Fix:** Audit all catch blocks. Add toast notifications for user-initiated actions that fail. Keep silent catches only for background/polling operations.

### High — Confusing or Incomplete

#### 4. Handoff Has No Approval Gate
**File:** `src/frontend/components/plan/v2/HandoffButton.tsx`
**What:** "Push to Agent" broadcasts immediately. No check against readiness score. An incomplete plan (missing file targets, no tests mentioned, no guardrails) can be sent to an agent without warning.
**Fix:** Show readiness score in the handoff confirmation. Warn if required checks fail. Allow override but make the user acknowledge.

#### 5. Split View Has No Toggle Button
**File:** `src/frontend/stores/ui-store.ts` — `splitView: boolean` exists
**What:** The split view (graph + plan side-by-side) is implemented but there's no button in the TopBar to activate it. The keyboard shortcut mentioned in comments isn't wired.
**Fix:** Add a split-view toggle to the TopBar or plan workspace header. Wire Cmd+\ shortcut.

#### 6. Dead Terminal Tabs Persist
**File:** `src/frontend/components/terminal/TerminalPanel.tsx`
**What:** When a terminal process exits, the tab stays with a red "exited" label. No auto-close, no prompt to remove.
**Fix:** Auto-close after 30s, or show a "Close" button prominently on exited tabs. Or fade the tab and auto-remove on next terminal creation.

#### 7. Drift Banner Can't Reopen After Dismiss
**File:** `src/frontend/components/plan/v2/DriftIndicator.tsx`
**What:** Once dismissed, the only way to see drift again is a manual page refresh.
**Fix:** Add a "drift" indicator icon in the workspace header that shows count. Click reopens the panel.

#### 8. Readiness Ring Has No Guidance
**File:** `src/frontend/components/plan/v2/PlanReadinessRing.tsx`
**What:** Failed checks show what's wrong but not how to fix it. "3 tasks missing file targets" — the user doesn't know how to add file targets.
**Fix:** Make each failed check clickable. Navigate to the relevant item or open a help tooltip explaining the action needed.

### Medium — Polish

#### 9. No Undo/Redo
History drawer shows versions but no action buttons to restore. `plan-items-store` has restore-version endpoint but no keyboard shortcut or UI button.

#### 10. Constraint Builder Is JSON-Only
Users must hand-edit constraints as raw text. No visual builder for rules like "don't modify files in /src/legacy/" or "keep bundle size under 500KB".

#### 11. No Background Drift Polling
Drift detection is on-demand only. User must manually refresh. Should poll every 30s when a plan is active and an agent is connected.

#### 12. No "Recently Viewed" Navigation
`plan-items-store` tracks view history but no back/forward buttons in the workspace header.

---

## V1 vs V2 Cleanup Status

**V1 workspace: fully deleted** (Phase 16.A, commit d7abf33).

**Still alive from V1 era:**
- `plan-store.ts` — used by side-panel utilities (PlanList, CommentThread, ProposedChanges, AddToTaskPopover). Not the workspace.
- V1 task API endpoints (`/api/plans/:uid/tasks/*`) — used by AddToTaskPopover and MCP tools. Backend still serves them.
- Stale code comment in `plan-items-store.ts` line 6 says "until 15.F prunes V1" — this already happened in 16.A.

**No sync risk between stores.** `plan-store` handles plan-level metadata and the side panel. `plan-items-store` handles the V2 item tree. They serve different roles and don't compete.

---

## Desktop Build Status

### Terminal Hotfix (v0.1.4 re-release, 2026-05-18)

Three issues found and fixed after initial release:

1. **Electron IPC shim was broadcast-only** — `WebSocket.send()` was a no-op. Terminal requires bidirectional communication (keyboard input to PTY, PTY output to renderer). Fixed by splitting into `IpcBroadcastWebSocket` (one-way, /ws) and `IpcTerminalWebSocket` (bidirectional, /terminal-ws) with full preload + main process IPC handlers.

2. **WebSocket URL parsing failed in file:// mode** — In production Electron builds, `window.location.host` is empty, producing `ws:///terminal-ws?id=...`. The `URL` constructor throws on this. Fixed by switching to regex matching.

3. **Terminal defaulted to app directory** — `process.cwd()` instead of the project root. Fixed by passing `projectRoot` from the project store when creating terminals.

### Build Artifacts (all platforms)

| Platform | File | Status |
|----------|------|--------|
| macOS ARM64 | `CodeTrellis-0.1.4-arm64.dmg` | Built, tested, uploaded |
| macOS Intel | `CodeTrellis-0.1.4-x64.dmg` | Built, uploaded |
| Windows installer | `CodeTrellis-Setup-0.1.4.exe` | Built, uploaded |
| Windows portable | `CodeTrellis-Portable-0.1.4.exe` | Built, uploaded |
| Linux x64 | `CodeTrellis-0.1.4.AppImage` | Built, uploaded |
| Linux ARM | N/A | Can't cross-compile node-pty from macOS |

### Known Electron Issues
- macOS 26 Sequoia SIGKILL bug — Electron apps may be killed by the OS under certain conditions. Workaround: run from `/Applications/` after `xattr -cr`.
- Linux AppArmor — Ubuntu 24.04+ needs `--no-sandbox` for AppImage (auto-applied since v0.1.4).

---

## Recommended Priority Order

### Phase 18: The Core Loop (highest priority)

**Goal:** Validate the full plan-to-agent-to-completion workflow.

**18.A — Manual Smoke Test**
Do this by hand before writing any code:
1. Open CodeTrellis (web or desktop)
2. Scan a real project
3. Create a plan from scratch in the V2 workspace
4. Add 2-3 Actions with file targets and acceptance criteria
5. Connect Claude Code via MCP
6. Hand the plan to the agent
7. Watch execution, drift, completion
8. Document every friction point

**18.B — Fix Critical UX Blockers**
Based on 18.A findings, fix the issues that prevent the flow:
- Wire template picker (so users can start from a template)
- Add save indicator (so users trust their edits persist)
- Fix silent failures (so users know when things break)
- Add handoff readiness check (so agents get complete plans)

**18.C — Write the Full-Loop E2E Test**
`tests/e2e/full-loop.test.ts` — hermetic test that:
1. Creates a plan via API
2. Adds items with file targets
3. Connects a scripted MCP agent
4. Agent picks up tasks, modifies fixture files
5. Verifies drift detection fires
6. Reconciles deviations
7. Verifies completion state

**18.D — Fill Test Gaps**
Write the 8 missing test files (plan-docs, phases, git, terminals, deviations, references, settings, sessions). ~35-45 new test cases.

### Phase 19: Polish & Stability

- Split view toggle button
- Background drift polling
- Dead terminal auto-cleanup
- Undo/redo buttons
- Readiness ring click-to-fix
- Constraint builder UI
- Back/forward navigation
- Keyboard shortcuts (Cmd+\, Cmd+Z)

---

## Appendix: API Endpoint Coverage Matrix

106 total endpoints. 41 tested (39%). 65 untested (61%).

### Fully Tested (100%)
- Plan Items V2 (16/16)
- Cross-System (1/1)

### Well Tested (>70%)
- Legacy Tasks (11/13 = 85%)
- Plans Core (10/18 = 56%)

### Zero Coverage
- Plan Docs (0/8)
- Plan Phases (0/4)
- Git (0/6)
- Terminals (0/7)
- References (0/5)
- Baselines/Trellis (0/7)
- Deviations (0/2)
- Settings (0/2)
- Sessions (0/3)
- Recent Projects (0/3)
- Logs/Updates (0/4)
- Onboarding (0/1)
- Architecture Summary (0/1)
- File Content (0/1)
