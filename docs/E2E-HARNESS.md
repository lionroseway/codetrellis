# E2E Test Harness — Sample Repo + Scripted Agent

Status: Design (not yet implemented)
Last updated: 2026-04-27
Owner: open

## 1. Goal

Run the full CodeTrellis loop end-to-end, deterministically, in CI:

> open project → scan → author plan → agent claims tasks → agent edits files
> → file watcher detects → progress auto-advances → drift detected
> → verification panel reads "Ready to ship" → finish.

…against a known fixture repo, with a scripted agent that mimics what
Claude Code / Codex / Cursor would do via MCP. No human in the loop.
No flakiness from real LLM calls. Repeatable on every push.

## 2. Why

| Driver | Today | After this lands |
|---|---|---|
| Catching regressions in the loop | Manual smoke test on the developer's home directory. Half the bugs we've shipped (auto-track HEAD, /api/diff regression, modal clipping, EMFILE) escaped into production because there's no automation hitting the full loop. | Every push runs the loop against a fixture; regressions caught at PR time. |
| Adding new languages | Drop a parser plugin, hope the existing tests still pass. No way to verify the new language's edges actually appear in the graph. | Fixture repo has a multi-language slice; new language → add a few files → assertion catches it. |
| Cross-system / cross-protocol matchers | The HTTP MVP shipped in Push 2 was hand-tested. Adding SQL / subprocess / env matchers needs a test target. | Fixture has known-coupled files across protocols; matcher tests assert exact edge counts. |
| Multi-agent contention | `claim_task` returns conflicts but we've never proven it under real concurrent load. | Harness can spin up two scripted agents claiming the same task; assert one wins, the other gets `conflicts`. |
| Plan export / Phase 13 | Auto-sync via file watcher is a high-risk feature; round-trip needs assertions. | Harness writes a YAML, expects DB to match; mutates DB, expects YAML to match. |

The goal isn't 100% coverage — it's making **the front-to-back loop**
testable so we stop shipping regressions in it.

## 3. Today's state (what's flaky)

Existing Playwright suite under `tests/` runs against the real running
app:

- **Folder picker** is non-deterministic — depends on macOS file
  dialogs that don't always render in headless mode.
- **Plan persistence across runs** — `~/.codetrellis/data.db` accumulates
  test plans from previous runs; tests start with non-clean state.
- **Port collisions** — backend `:3001` + frontend `:5173` + MCP
  `:19432` are all hardcoded; concurrent test runs collide.
- **Clock** — `created_at` / `updated_at` are `Date.now()`; no way to
  assert "this was created before that."
- **No agent simulation** — every test that needs the agent loop
  effectively requires a real Claude Code session.

We're not going to throw the existing Playwright suite away — the
pieces that test pure UI (component rendering, click-flows that don't
hit the backend) are still useful. The harness sits *under* that
suite for full-loop tests.

## 4. Test pyramid — what lives where

```
                 ┌─────────────────────────┐
                 │  E2E loop tests         │  the new harness
                 │  fixture repo + agent   │  ← THIS DOC
                 │  + Playwright + MCP     │
                 └───────────┬─────────────┘
                             │
                ┌────────────┴────────────┐
                │ Integration tests       │
                │ REST + MCP + DB         │  fast, deterministic, no UI
                │ (vitest, in-process)    │
                └───────────┬─────────────┘
                            │
              ┌─────────────┴─────────────┐
              │ Unit tests                │
              │ services in isolation     │  fastest, most coverage
              │ (vitest, no DB / no HTTP) │
              └───────────────────────────┘
```

This doc designs the top tier. Integration + unit tiers are separate
concerns (worth their own design pass once the harness exists).

## 5. The fixture repo

### Shape

A small but real mixed-language repo committed to
`tests/fixtures/sample-app/`. About **25 files** total, designed so
every assertion the harness needs has a direct target.

```
tests/fixtures/sample-app/
  package.json                         # npm workspace root
  pnpm-workspace.yaml                  # systems discovery target
  tsconfig.json                        # alias map target
  packages/
    shared/
      package.json                     # @sample/shared
      src/
        types.ts                       # exports User, Order
    web/
      package.json                     # @sample/web
      src/
        api.ts                         # fetch('/api/users')  ← TS HTTP call
        UserList.tsx                   # imports api + shared types
        OrderList.tsx                  # imports api + shared types
  services/
    api/
      pyproject.toml                   # systems discovery target
      app/
        __init__.py
        main.py                        # FastAPI app
        routes/
          users.py                     # @router.get('/api/users')  ← matches!
          orders.py                    # @router.post('/api/orders')
        models.py                      # imports something from db.py
        db.py
  schema.sql                           # CREATE TABLE users ... (future SQL matcher)
  .gitignore
  README.md
```

Why this shape:

- **Two systems** (npm workspace + Python project) so system discovery
  produces a known count.
- **Workspace alias** (`@sample/shared`) so alias resolution has work.
- **Cross-system HTTP coupling** between `web/api.ts` ↔ `api/routes/users.py`
  (and `OrderList` ↔ `orders.py`). Known matchable pairs.
- **Multi-language imports** so the import graph has TS + Python edges.
- **A SQL schema file** unused by current matchers but ready for the SQL
  ref-tracker.

### Properties the fixture must have

- **Deterministic file order** (no `Date.now()` in seed scripts).
- **Stable line numbers** (so `affectedSymbols` line-based assertions hold).
- **No npm install needed** to run tests — the harness doesn't execute the
  fixture; it just scans the file tree.
- **Small enough to scan in < 500ms** on a developer machine.

### Resetting the fixture between tests

Tests may modify fixture files (the agent harness writes to them). To
reset:

```ts
import { execSync } from 'node:child_process';
execSync('git checkout HEAD -- tests/fixtures/sample-app', { cwd: REPO_ROOT });
```

Cheap, idempotent, no fragile "save original content" logic. Runs in
`beforeEach` of the harness suite.

## 6. The scripted agent

A Node/TS class that:

1. Connects to the running CodeTrellis MCP server over SSE (same
   protocol Claude Code uses).
2. Calls `register_session('test-agent', model='harness/1.0')`.
3. Runs a *script* — a sequence of MCP tool calls, with assertions
   between them.

### Why scripted, not real-LLM

- **Determinism** — the same script runs the same way every time.
  Real LLMs are non-deterministic.
- **Speed** — no model latency.
- **No API keys in CI** — the harness is fully offline.

The trade-off: we don't test the LLM's *reasoning* (whether it picks
the right task, writes correct code). We test the *plumbing* between
agent and CodeTrellis. That's the bug surface that has been
regressing.

### Shape

```ts
// tests/harness/agent.ts

export interface ScriptedAgent {
  /** Register and remember the resulting sessionId. */
  connect(opts: { agentType: string; model?: string }): Promise<void>;

  /** Disconnect cleanly so session_end fires. */
  disconnect(): Promise<void>;

  /** Convenience: walk a plan and execute every task in order. */
  workPlan(planUid: string, opts?: WorkPlanOptions): Promise<WorkPlanResult>;

  /** Lower-level: any MCP tool by name. */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;

  /** Helper: write content to a file relative to the fixture root. */
  writeFile(relativePath: string, content: string): Promise<void>;
}

export interface WorkPlanOptions {
  /** How long to wait between tool calls (ms). */
  pacing?: number;
  /** Auto-edit `affectedFiles` to mark task as "done". */
  simulateEdits?: boolean;
  /** Per-task hook for custom edits. */
  onTask?: (task: Task) => Promise<void>;
}
```

### Example script

```ts
test('agent walks a phased plan end-to-end', async () => {
  await harness.scan(SAMPLE_APP);
  const planUid = await harness.createPlanFromTemplate('mass-refactor');
  const agent = await harness.spawnAgent({ agentType: 'test-agent' });

  await agent.workPlan(planUid, {
    simulateEdits: true,
    onTask: async (task) => {
      // For tasks whose affectedFiles are known, write deterministic edits
      for (const f of task.affectedFiles) {
        await agent.writeFile(f, generateContentForTask(task, f));
      }
    },
  });

  // Assertions on the final state
  const summary = await harness.fetchChangesSummary(planUid);
  expect(summary.byStatus.satisfied).toBe(summary.total);
  expect(summary.byStatus.missing).toBe(0);
});
```

## 7. Determinism techniques

### Test data directory

Backend's `~/.codetrellis/data.db` becomes a per-test tmp dir:

- Add an env var `CODETRELLIS_DATA_DIR` to `persistence.ts` that
  overrides the default. Defaults to `~/.codetrellis/`.
- Harness sets it to `tests/.tmp/<test-id>/` before bootstrapping the
  backend.
- `afterEach` deletes the dir.

This is the single most important fix. Right now every test pollutes
the developer's actual data dir.

### Port allocation

- Add env vars `CODETRELLIS_BACKEND_PORT`, `CODETRELLIS_FRONTEND_PORT`,
  `CODETRELLIS_MCP_PORT`. Default to today's hardcoded values.
- Harness picks free ports via `get-port` npm package, sets them in
  env, spawns backend.
- Tests that need to talk to backend read the port from harness state,
  not a hardcoded URL.

### Clock

- `services/clock.ts` (new) exports `now(): number` that delegates to
  `Date.now()` by default. All `created_at` / `updated_at` /
  `connected_at` consumers go through this.
- Harness can substitute a controlled clock that ticks 1000ms per call,
  so timestamps are predictable.
- Worth resisting: too many production sites want real wall time. Only
  swap the clock in tests; don't engineer for general "frozen time."

### Filesystem watcher debouncing

- chokidar's awaitWriteFinish is OS-dependent. In tests, set the
  debounce to 0 and wait explicitly via `waitFor` patterns:

```ts
await harness.waitForEvent('task-updated', { taskUid, status: 'in_progress' }, { timeout: 2000 });
```

### MCP transport

- The MCP SSE server is the same one production uses. The harness's
  scripted agent connects via the official MCP SDK in client mode,
  pointing at the harness-allocated port.
- This tests the real wire format — when Claude Code's SDK changes,
  we catch breakage.

### Random IDs

- UUIDs are inherently random. Tests should never assert exact UID
  values; they should look up by structural identity (title, slug,
  file path). The harness exposes helpers like
  `findTaskByDescription(planUid, "Add JwtPayload")`.

## 8. CI shape

### Stages

```
1. Lint + typecheck         (~30s)    npm run lint && npm run typecheck
2. Unit tests               (~30s)    vitest run --project unit
3. Integration tests        (~60s)    vitest run --project integration
4. E2E loop tests           (~3min)   playwright test --project e2e
5. (optional) Visual diff   (~1min)   playwright test --project visual
```

The E2E project is the new one this doc designs. Stages 1–3 should
already be CI-runnable today; if not, they're prerequisites.

### Failure modes

- **CI machine is slow** — the harness's `waitForEvent` timeout is
  generous (default 5s) and configurable via env.
- **Flaky port collisions in CI** — the dynamic port allocator
  retries up to 5 times before failing.
- **Intermittent file-watcher misses** — if a `task-updated` doesn't
  arrive within timeout, the test poll-falls-back to a REST query
  before failing. (chokidar can drop events under load; we don't
  want that to be a test failure if the underlying state is correct.)

## 9. Phased delivery

### Phase 1 — Fixture repo + harness scaffolding (one push)

- Create `tests/fixtures/sample-app/` with the structure above.
- Commit a `tests/harness/` directory with:
  - `setup.ts` — boot backend with a tmp data dir + dynamic ports.
  - `teardown.ts` — kill backend, delete tmp dir.
  - `scripted-agent.ts` — MCP client wrapper.
  - `assertions.ts` — common assertions (waitForEvent, fetchPlan,
    fetchChangesSummary, etc.).
- Add `CODETRELLIS_DATA_DIR` and port env-var support to backend.
- Add `services/clock.ts` and route every `Date.now()` site through it
  (codemod-style refactor).
- One smoke test: `tests/e2e/smoke.test.ts` opens the fixture, scans,
  asserts file/symbol/edge counts. No agent, no plan — just proves
  the harness boots cleanly.

### Phase 2 — Loop tests (one push)

- `tests/e2e/loop.test.ts`:
  - Open project → scan → assert system count = 2, edge count > 0.
  - Create plan from template `mass-refactor` → assert phases + docs
    seeded.
  - Spawn agent → walk plan → assert auto-progress events fire →
    assert verification panel reads "Ready to ship".
- `tests/e2e/cross-system.test.ts`:
  - Scan → assert exactly N HTTP cross-system edges between known
    files (web/api.ts ↔ api/routes/users.py etc.).
  - Edit `web/api.ts` to add a new fetch → assert a new edge appears.
  - Delete a fastapi route → assert the corresponding edge
    disappears.
- `tests/e2e/multi-agent.test.ts`:
  - Spawn two agents → both `claim_task` on the same task → assert
    one wins, the other gets `conflicts`.

### Phase 3 — Plan export round-trip (one push, depends on Phase 13 §A)

- `tests/e2e/plan-export.test.ts`:
  - Create plan in DB → export to file → assert YAML contents match
    expectations.
  - Mutate the YAML file directly (edit a task) → assert DB
    reconciles.
  - Round-trip: export → re-import → assert plan equality.

### Phase 4 — Visual snapshot tests (optional)

- `tests/e2e/visual.test.ts` runs Playwright with screenshot diffing
  on a few canonical surfaces (graph at clusters depth, plan detail
  with phases, proposed-changes tab full).
- Stored under `tests/__snapshots__/`. PR builds upload diffs as
  artifacts.

## 10. Out of scope (for now)

- **Real LLM agents.** Adding "run a real Claude Code session against
  the fixture and assert on outcomes" is meaningful but separate —
  needs API keys, costs money, has flakiness. Defer to a "nightly
  smoke" job, not the per-PR suite.
- **Performance benchmarks.** Worth doing eventually (parse time vs
  repo size) but not part of the loop-correctness story.
- **Browser-cross matrix.** We target Chromium via Electron + Vite;
  Firefox / Safari in browser mode are nice-to-have not core.
- **Parallel test execution.** The single-process harness is fine for
  CI of this size. Parallelisation introduces port-allocation +
  shared-fixture-state complexity not worth it yet.

## 11. Open questions

- **Should the fixture repo be a git submodule** (so we can update it
  in isolation, version it independently)? My vote: no, in-tree under
  `tests/fixtures/`. Submodules add friction; the fixture is small.
- **Where does the harness live in the import graph?** It pulls in
  backend services (to spawn the server) but tests run from outside.
  My vote: harness imports from `src/backend/server.ts`'s exported
  `startServer()`; tests never import from `src/`.
- **Do we need a way for the harness to introspect MCP tool schemas?**
  Helpful for "the harness's agent is using a tool that no longer
  exists" failures. Probably yes — defer until we hit it.
- **Do we surface harness coverage metrics?** Initially no — coverage
  is a unit-test concern; the loop tests are about
  presence-of-correct-behaviour, not line counts.

## 12. Acceptance criteria for the design as a whole

When this is fully shipped:

1. `npm run test:e2e` from a clean checkout boots the backend, runs
   the loop tests against the fixture repo, and exits 0 in under 5
   minutes — with no developer's `~/.codetrellis/` touched.
2. A regression in the front-to-back loop (e.g. tasks no longer
   auto-advance) is caught by the harness on PR.
3. Adding a new language plugin requires only: dropping the parser /
   resolver / callsite files + adding ~10 fixture files + extending
   one assertion. No harness rewrite.
4. Plan-export round-trip (Phase 13) has byte-level assertions on the
   YAML output so format regressions are loud.
5. The harness can spin up multiple scripted agents to test
   contention (`claim_task` conflicts, `set_active_plan` race).

That's the bar.
