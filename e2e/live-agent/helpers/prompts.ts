/**
 * Inject prompts for live-agent E2E tests.
 *
 * Each prompt tells Claude exactly what to do so the test is
 * deterministic.  The markers (PLAN_READY, ALL_TASKS_COMPLETE,
 * DEVIATION_COMPLETE) let Playwright detect phase boundaries.
 */

/**
 * Prompt A — Execute a pre-seeded plan.
 * Test harness creates the plan via REST before the agent starts.
 */
export function promptExecPreseeded(planTitle: string): string {
  return `You are being used inside a CodeTrellis E2E test harness.
Do NOT improvise, create new plans, or deviate from these instructions.

A plan called "${planTitle}" already exists in CodeTrellis.
Use the \`list_plans\` MCP tool to find it, then use \`set_active_plan\` to activate it.

Then execute every action item in the plan:
1. Use \`get_next_item\` to get the next pending item
2. Call \`claim_item\` for it
3. Read the affected file(s) listed in the item's file_specs using your Read tool
4. Make the exact edit described in the item body
5. Call \`update_item_progress\` with percent=100, message="Complete"
6. Call \`update_item\` with status="done"
7. Repeat from step 1 until \`get_next_item\` returns no more items

When all items are done, say "ALL_TASKS_COMPLETE" on a new line.
`;
}

/**
 * Prompt B — Author a plan from scratch, then execute it.
 * No pre-seeding.  Claude builds everything via MCP tools.
 */
export function promptAuthorAndExec(projectPath: string): string {
  return `You are being used inside a CodeTrellis E2E test harness.
Your job is to build a plan from scratch and then execute it.
Do NOT improvise or add extra steps beyond what is specified.

STEP 1 — BUILD THE PLAN:
Use \`create_plan\` with these exact parameters:
  - title: "E2E Agent-Authored: Error Handling"
  - project_path: "${projectPath}"
  - tasks: []

Then use \`add_item\` to add these exact items:
  Item 1 (kind: "action"):
    - title: "Add try-catch to API fetch calls"
    - body: "Wrap the fetch() calls in api.ts with try-catch blocks and return empty arrays on error"
    - file_specs: [{ path: "packages/web/src/api.ts", action: "modify" }]
  Item 2 (kind: "action"):
    - title: "Add error boundary to UserList"
    - body: "Add a try-catch in the useEffect of UserList.tsx around the listUsers call"
    - file_specs: [{ path: "packages/web/src/UserList.tsx", action: "modify" }]

Then use \`add_plan_doc\` to add an executive summary:
  - doc_type: "executive"
  - title: "Error Handling Improvement"
  - body: "This plan adds error handling to the web frontend."

Then use \`add_plan_phase\`:
  - title: "Phase 1: Core error handling"
  - phase_number: 1

When the plan is fully built, say "PLAN_READY" on a new line.

STEP 2 — EXECUTE THE PLAN:
For each action item you just created:
1. Call \`claim_item\` for the item
2. Read the affected file using your Read tool
3. Make the edit described in the item body
4. Call \`update_item_progress\` with percent=100, message="Complete"
5. Call \`update_item\` with status="done"

When all items are done, say "ALL_TASKS_COMPLETE" on a new line.
`;
}

/**
 * Prompt C — Author a plan, then deliberately deviate during execution.
 */
export function promptAuthorAndDeviate(projectPath: string): string {
  return `You are being used inside a CodeTrellis E2E test harness.
Build a plan, then deliberately deviate during execution as described.
Do NOT improvise beyond these instructions.

STEP 1 — BUILD THE PLAN:
Use \`create_plan\` with these exact parameters:
  - title: "E2E Agent-Deviation: Error Handling"
  - project_path: "${projectPath}"
  - tasks: []

Then use \`add_item\` to add these exact items:
  Item 1 (kind: "action"):
    - title: "Add try-catch to API fetch calls"
    - body: "Wrap the fetch() calls in api.ts with try-catch blocks"
    - file_specs: [{ path: "packages/web/src/api.ts", action: "modify" }]
  Item 2 (kind: "action"):
    - title: "Add error boundary to UserList"
    - body: "Add error handling to UserList.tsx"
    - file_specs: [{ path: "packages/web/src/UserList.tsx", action: "modify" }]

When the plan is fully built, say "PLAN_READY" on a new line.

STEP 2 — EXECUTE WITH DELIBERATE DEVIATIONS:
- Complete Item 1 (api.ts) as specified — claim, edit, progress=100, done
- SKIP Item 2 entirely — do NOT touch UserList.tsx at all
- ALSO edit a file NOT in the plan: add a Python comment to
  services/api/app/db.py saying "# modified outside plan scope"

When done, say "DEVIATION_COMPLETE" on a new line.
`;
}

/**
 * Prompt D — Execute a pre-seeded plan with deliberate deviations.
 */
export function promptExecPreseededWithDeviation(planTitle: string): string {
  return `You are being used inside a CodeTrellis E2E test harness.
A plan called "${planTitle}" already exists in CodeTrellis.
Use \`list_plans\` to find it and \`set_active_plan\` to activate it.

Execute with these deliberate deviations:
- Use \`get_next_item\` to find the first action item
- Complete the first action item as specified (claim, edit, progress=100, done)
- SKIP the second action item — do NOT touch the file it targets
- ALSO edit services/api/app/db.py (not in the plan) — add a Python comment "# modified outside plan scope"

When done, say "DEVIATION_COMPLETE" on a new line.
`;
}
