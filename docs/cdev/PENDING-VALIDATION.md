# Pending Validation

Things that automated tests can't reach, deferred for human eyes after the relevant phase ships. Each entry says **what to check**, **why automation missed it**, and **where the code lives** so anyone can pick it up.

Tick items off as they're validated. Move stale entries to the bottom under "Closed" with the date + reviewer.

---

## Open

### Phase 3 — UI / UX checks

#### Docs surface (CDev 3.4)

- [ ] **BookOpen docs toggle in TopBar** — visual + interaction. Only appears when a project is open; highlights when `workspaceMode === 'docs'`; toggles back to graph cleanly; spacing + icon weight match neighbouring TopBar chips.
  *Source:* `src/frontend/components/layout/TopBar.tsx` (`DocsToggle`).
  *Why automation missed it:* visual / pointer-event surface.

- [ ] **Docs panel layout feel** — two-pane proportions, search input affordance, freshness dot colour contrast (green/yellow/red) at low brightness, editor mode shows a clear save/cancel pair, markdown body renders with the right vertical rhythm.
  *Source:* `src/frontend/components/system-docs/SystemDocsPanel.tsx`.

- [ ] **`[SystemDocs] Skipping … malformed YAML frontmatter` log line surfaces** — drop a `.codetrellis/docs/broken.md` with bad YAML, confirm the warning appears in the dev-server stdout (the e2e test asserts the behaviour but can't read the console).
  *Source:* `src/backend/services/system-docs-service.ts` `importDocFile`.

#### Cross-repo (CDev 3.5)

- [ ] **"Not cloned" clipboard hint** — clicking the amber chip copies `git clone <url>` to clipboard; toast confirms with the command (truncates gracefully when the URL is long); hover reads as clickable.
  *Source:* `src/frontend/components/plan/CrossRepoSection.tsx`.

- [ ] **WS-driven refresh on pulled pointer** — simulate `git pull` adding a new pointer (hand-write a YAML into `<scoped>/.codetrellis/external/`); confirm the section refreshes without a manual reload via the WS → DOM-event bridge.
  *Source:* `src/frontend/hooks/useWebSocket.ts` (`external-pointers-changed` dispatch) → `CrossRepoSection` listener.

- [ ] **Resolved "Open" affordance** — when both home + scoped repos are open, clicking "Open" switches to the home repo's existing tab (or creates one if absent). Confirm no double-tab.
  *Source:* `src/frontend/components/plan/CrossRepoSection.tsx` (`handleOpenResolved`).

#### Central oversight (CDev 3.6)

- [ ] **`repoRole: "code"` empty-state copy** — a code repo with zero local plans should show the soft "plans live in another repo" copy instead of the default "create your first plan" CTA. Confirm the copy reads naturally and doesn't push the CTA.
  *Source:* `src/frontend/components/plan/PlanList.tsx` (empty-state branch).

#### Repo identity (CDev 3.1)

- [ ] **TopBar alias rendering at 200 chars** — set a maximum-length alias via `set_repo_alias`; confirm the TopBar tab truncates with ellipsis rather than overflowing or breaking layout. Same check at common sizes (10 / 50 / 100 chars).
  *Source:* `src/frontend/components/layout/TopBar.tsx` (`TabItem` rendering).

---

## Conventions

- Use checkboxes (`- [ ]` → `- [x]`) so progress is visible at a glance.
- Close items by ticking, then **move to the Closed section** with reviewer initials + date once you've validated. Stops the list from growing indefinitely.
- If a check fails, file a follow-up — link the new bug back here in `Source`.
- Don't add items here that automation could cover. If you find yourself writing "regression for X", write the test instead.

---

## Closed

_None yet — Phase 3 just shipped._
