# Plan Workspace UX Flow Audit

> Audit date: 2026-05-04
> Context: User said the V2 workspace feels "obtuse" and "not intuitive" — "feel a little lost trying to build something out, not clear what should do."

---

## 1. Observed Stick Points (end-to-end walkthrough)

### S1. Plan creation still uses the V1 modal
**Where:** `+ New` button → `PlanCreateModal`
**What happens:** A modal pops up asking for Title, Description, and Tasks (with "Affected files" sub-fields). This is the old V1 model. The V2 workspace is built around body-first authoring, @ mentions, and sub-pages — none of which the V1 modal knows about.
**Impact:** The user fills in a title, optionally a description and tasks, then clicks "Create Plan." They've now committed to structure they don't need (Tasks section) and missed structure they do (body, sub-pages). The mental model is wrong from the first interaction.
**Note:** `PlanList.tsx` already has a `handleQuickCreate` that bypasses the modal and creates an "Untitled plan" directly, but only when `planV2Enabled` is true AND a project is open. The bottom panel's `+ New` button is in the PlanPanel header and calls `setShowCreateModal(true)` — it ignores `planV2Enabled` entirely.

### S2. Clicking a plan in the list does nothing visible
**Where:** Plans tab in bottom panel → click plan row
**What happens:** `setActivePlan(plan.uid)` fires → `fetchPlan(uid)` calls `GET /api/plans/:uid`. If the API returns 500 (which it does for plans created without the right project context), `activePlan` gets set to the error JSON, the V2 workspace overlay condition in App.tsx fires, and the workspace either crashes silently or renders an empty state.
**Root cause:** `fetchPlan` doesn't check `res.ok` — it blindly does `set({ activePlan: plan, activePlanUid: uid })` where `plan` is `{error: "Plan not found"}`.
**Impact:** Click → nothing. No error toast, no spinner, no feedback. The user has no idea why it didn't work.

### S3. No visual feedback on async failures
**Where:** Everywhere — plan fetch, item updates, attachment uploads
**What happens:** Most `fetch()` calls don't check `res.ok`. Errors are either silently swallowed or set garbage state.
**Impact:** The user tries an action, it silently fails, and they assume the app is broken or unresponsive.

### S4. Plan home page is bare when empty
**Where:** V2 workspace → `PlanHomePage` component
**What happens:** An empty plan shows: a big title input, a clickable body area ("Write what this plan is about…"), and an empty-state card with two buttons: "Sub-page (Object)" and "Action (work item)".
**What's missing:** No orientation. The user sees two unfamiliar concepts ("Object" vs "Action") with no explanation of the difference or when to use each. The placeholder text says "press '/' for sub-pages, todos, code blocks" but doesn't explain the @ mention system, the TargetsStrip, or the ContextRail that becomes available once items exist.

### S5. Item page is a wall of empty sections
**Where:** V2 workspace → `PlanItemCanvas` → item selected
**What the user sees (on a new empty Action):**
1. Breadcrumb (OK)
2. Property chips row: `Action | Pending` dropdown + Copy context + History
3. Title input (OK)
4. Empty body area: "Click to write. Markdown supported — / for slash menu…"
5. TargetsStrip: "No code targets yet" + optional +Add target button
6. ItemLevelNudge: "This Action is thin. Body is solid, but no file/folder/symbol/edge target…" — shows immediately even though the user hasn't written anything yet
7. ContextRail: "CONTEXT · 0" header + "+Add" button
8. CommentsBlock: "COMMENTS" header + composer with Note/Progress/Blocker/Question tabs

That's **8 distinct UI regions** stacked vertically, most of which are empty. The user scrolls past empty section after empty section. It feels like a form with too many fields.

### S6. Three places show code references — unclear relationship
**Where:** Body (@ chips), TargetsStrip, ContextRail
**What the user experiences:**
- **Body:** @ mentions create `[[file:...]]` and `[[symbol:...]]` chips inline. These are visible in the rendered body.
- **TargetsStrip:** Shows targets from BOTH body chips and API-added specs. De-duplicates.
- **ContextRail:** Shows fileSpecs, symbolSpecs, connections, AND attachments (URLs, images, code snippets, transcripts) in a single list with an +Add popover.

Three separate UI regions all showing overlapping data. If you @ mention a file in the body, it shows up in both the body and the TargetsStrip. If you also add it via the ContextRail's "+Add" button, it shows in all three.
**Impact:** The user doesn't know where to add things. "Should I @ mention it in the body, click +Add target in the strip, or use the +Add button in the context rail?"

### S7. The +Add menu has 10 options — overwhelming
**Where:** ContextRail → `+Add` button → `AddMenu`
**The menu (for Actions):**
- **Targets section** (4 items): File, Folder, Symbol, Edge
- **References section** (6 items): URL, Image/video, File reference, Folder reference, Code snippet, Transcript

10 options with two conceptual categories (target vs reference) that most users won't understand. "File" (target) vs "File reference" (reference) is a distinction that requires understanding the system's internal model.

### S8. The quality nudge fires too early
**Where:** `ItemLevelNudge` component
**What happens:** On a brand new Action with no body, the nudge says "This Action is thin." The user hasn't had a chance to write anything yet.
**Impact:** Feels like a scolding. The nudge should only appear after the user has written a body but hasn't added targets — not on a fresh page.

### S9. Object vs Action distinction is unclear
**Where:** Plan creation, slash menu, tree items
**What the user sees:** "Sub-page (Object)" and "Action (work item)" as the two create options. These are technical terms from the internal data model. A new user doesn't know what an "Object" is or when they'd want one vs an "Action."

### S10. Body editing requires click-to-enter / blur-to-save
**Where:** `PlanBodyArea` and `BodyEditor`
**What happens:** The body shows in "read mode" (rendered markdown with chips). User must click to enter edit mode (textarea). Clicking outside (blur) saves and exits edit mode. Esc cancels.
**Impact:** For a tool that's trying to be like Notion, this is jarring. Notion uses block-based inline editing — you just type. Here, you click → a big empty textarea appears → you type → you click away → it saves.

### S11. Bottom panel doesn't surface the V2 workspace
**Where:** `PlanPanel.tsx` → Plans tab
**What happens:** Clicking a plan calls `setActivePlan` which toggles between `<PlanList>` and `<PlanDetail>` within the bottom panel. In theory, the App.tsx effect should detect the UID change and flip `workspaceMode` to `'plan'`, causing the full-screen V2 overlay to mount. But the user doesn't know any of this — they click a plan name in a tiny bottom panel and expect something to happen in-place. The full-screen takeover (when it works) is an unexpected mode switch.

---

## 2. Proposed Flow (what the experience SHOULD be)

### 2A. Plan Creation → Instant Workspace

**Current:** Click +New → V1 modal (Title + Description + Tasks) → Create Plan → back to list → click plan → V2 workspace (maybe)

**Proposed:**
1. Click **"+ New plan"** → no modal. Instantly creates an "Untitled plan" and opens the V2 workspace full-screen.
2. The cursor is already in the title field. User types a name and presses Enter or Tab to move to the body.
3. The body placeholder says: **"Describe what you want to build. @ to reference files or symbols. / for sub-pages and formatting."**

That's it. One click → you're writing. No modal, no field hierarchy, no "Tasks" section.

**Kill:** The V1 PlanCreateModal. Remove it entirely (user said "don't need to keep v1, that was useless"). The "From template" option can live as a secondary button or dropdown: "New plan ▾ → From template…"

### 2B. Progressive Disclosure — Empty Pages Should Feel Inviting, Not Empty

**Current:** New Action shows 8 stacked sections, most empty.

**Proposed:** A new Action page shows just:
1. **Title input** (focus here)
2. **Body editor** (always in edit mode — no click-to-enter — just a textarea that renders inline markdown as you type, or at minimum, starts in edit mode)
3. **A gentle onboarding line** below the body: "Tip: type @ to reference code, / to add sub-pages or formatting. Files and symbols you mention will appear as targets below."

Everything else is **hidden until relevant:**
- **TargetsStrip** — only appears once at least one target exists (from @ mention or API)
- **ContextRail** — only appears once the user explicitly clicks "+ Add context" or drags a file onto the page. No empty "CONTEXT · 0" section.
- **CommentsBlock** — only appears once there's at least one comment, or via a "💬 Add comment" button at the bottom.
- **Quality nudge** — only appears once the body has >50 characters AND the item has zero targets. Not on empty items.
- **Property chips** (status, assignee, progress) — show as a collapsible row. Default collapsed for new items; opens when the user clicks "⚙ Properties" or when any property is set.

**Result:** A new Action page shows ~3 things: title, body, and a hint. As the user adds content, more UI appears naturally.

### 2C. Simplify Code Context — One Place, One Model

**Current:** Three overlapping systems (body chips, TargetsStrip, ContextRail +Add menu with 10 options).

**Proposed:** Collapse to TWO distinct concepts:
1. **@ mentions in body** — inline references that also auto-create structured targets (this already works)
2. **Context panel** — one unified panel below the body (replaces both TargetsStrip and ContextRail)

The **Context panel** shows:
- **Targets** section: files, folders, symbols, edges — each with a verb badge (add/modify/delete/move). Sources: both body @ mentions and explicit adds.
- **Attachments** section: URLs, images, code snippets, transcripts.
- **One "+ Add" button** with a simplified menu:
  - Browse files / symbols (opens AnchorPicker)
  - Add URL
  - Upload image / video
  - Paste code snippet

**Kill:** The distinction between "target file" and "reference file" in the add menu. If a user adds a file, it's a target by default. If they just want to link to it as reading material, they can change it to a reference — but we don't front-load that distinction.

**Kill:** TargetsStrip as a separate component. Its data merges into the Context panel's Targets section.

### 2D. Rename Object/Action → Page/Task (or hide the distinction)

**Current:** "Sub-page (Object)" and "Action (work item)" — internal jargon.

**Proposed:** Two options:
- **Option A (rename):** "Page" and "Task." Everyone understands these words. Pages hold context. Tasks describe work.
- **Option B (hide):** Just "New page." Every page is a page. When the user assigns a status (pending/in-progress/done) or adds file targets, the page becomes a "Task" automatically. No manual choice needed.

Recommendation: **Option B.** It eliminates a decision the user doesn't need to make upfront. The slash menu becomes: "/ → New page, Heading, Todo, Code, Quote, Divider." Clean and minimal.

### 2E. Fix the Plan-Open Flow

**Current:** Click plan in bottom panel → maybe full-screen workspace, maybe nothing.

**Proposed:**
1. **Single click** on a plan row → The bottom panel expands into a "plan preview" showing the plan title, status, and first ~3 sub-pages. A prominent **"Open workspace →"** button.
2. **Double click** OR clicking **"Open workspace →"** → Full-screen V2 workspace takeover (current behavior, but reliable).
3. **Error handling:** If fetchPlan fails, show an error toast: "Couldn't load plan — the server returned an error." Don't set `activePlan` to garbage data.

### 2F. Always-Edit Body

**Current:** Click-to-enter → textarea → blur-to-save.

**Proposed:** The body is always in edit mode. Use a rich textarea (or contentEditable div) that:
- Renders markdown formatting inline (bold, headers, code) as you type
- Shows chips inline (@ mentions appear as styled pills within the editor)
- Autosaves on every keystroke (debounced 500ms — already implemented)
- No separate "read mode" and "edit mode"

If full inline markdown rendering is too complex now, at minimum:
- **Start in edit mode** when the body is empty (don't make the user click to start typing)
- Keep the read/edit toggle for non-empty bodies, but make the click target obvious (add a pencil icon or "Edit" button, not the whole body area)

### 2G. Reduce Visual Noise on First Load

**Current:** Opening the project shows: WORKING TREE CHANGES overlay (320 changes detected), Getting Started wizard, dependency graph, bottom panel, INSPECTOR panel, minimap.

**Proposed:**
- **Dismiss WORKING TREE CHANGES** automatically after 3 seconds (or move it to a status bar indicator)
- **Move Getting Started** to a first-run onboarding modal, not a persistent sidebar widget
- **Reduce minimap size** or auto-hide when the graph view is in the background

---

## 3. Priority Order

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 | Fix fetchPlan error handling (S2, S3) — add `res.ok` check + error toast | 30 min | Unblocks everything |
| P0 | Kill V1 create modal, wire +New to quick-create only (S1) | 1 hr | First impression |
| P1 | Progressive disclosure — hide empty sections (S5) | 2 hr | Reduces overwhelm |
| P1 | Merge TargetsStrip + ContextRail into one Context panel (S6, S7) | 3 hr | Conceptual clarity |
| P1 | Simplify +Add menu to 4 options (S7) | 1 hr | Less choice paralysis |
| P2 | Rename Object/Action → auto-classify pages (S9, S4) | 2 hr | Removes jargon |
| P2 | Start body in edit mode when empty (S10) | 1 hr | Faster first interaction |
| P2 | Delay quality nudge until body has content (S8) | 30 min | Feels less scoldy |
| P3 | Plan-open preview in bottom panel (S11, S2) | 2 hr | Smoother transition |
| P3 | Visual noise reduction on first load (Working Tree Changes, etc.) | 1 hr | Cleaner first impression |

---

## 4. Summary

The V2 workspace has strong technical infrastructure — body authoring, @ mentions, chip rendering, targets, context rail, drift detection, activity feed. But the UX front-loads too much of this infrastructure at the user.

The core principle should be: **start simple, reveal complexity as the user adds content.** A new plan should feel like opening a blank doc. A new action should feel like typing a thought. The system should get out of the way until the user needs structure — and then offer it naturally, not as 10 menu items or 8 empty sections.
