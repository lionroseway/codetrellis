/**
 * Open this repository once, before any spec runs.
 *
 * Phase 19: project roots come from the projects the app has opened, never
 * from a request body. `POST /api/plans` and every path-taking MCP tool
 * (`mcp.projectScope`) refuse a `projectPath` the backend has not opened —
 * and this suite's backend starts on a fresh data directory with none.
 *
 * Without this step, whether a spec could create a plan depended on
 * whether some OTHER spec had happened to scan the project first on the
 * shared backend. That presented as dozens of unrelated failures (403s,
 * unparseable MCP results) that moved around between runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test as setup } from '@playwright/test';
import { API, PROJECT_PATH, authHeaders, openProject } from './helpers/setup';
import { FIXTURE_PATH } from './live-agent/helpers/fixture-reset';

// Specs that export plans write them into this repository's
// .codetrellis/plans/ (gitignored). They piled up run after run — 91 of
// them — and the app offers each as an import in the Plans panel, burying
// the plan a spec is looking for. Only directories named the way specs name
// them are removed; a person's own plans are never touched.
setup('clear plan directories earlier runs exported', () => {
  const plansDir = path.join(PROJECT_PATH, '.codetrellis', 'plans');
  if (!fs.existsSync(plansDir)) return;
  for (const name of fs.readdirSync(plansDir)) {
    if (/^(e2e-|mcp-e2e-)/.test(name)) fs.rmSync(path.join(plansDir, name), { recursive: true, force: true });
  }
});

// This repository, and the shared sample app that the agent specs drive.
// Per-test temp copies open themselves (`openTempFixture`).
for (const projectPath of [PROJECT_PATH, FIXTURE_PATH]) {
  setup(`open ${projectPath}`, async () => {
    setup.setTimeout(120_000);
    await openProject(projectPath);
    // Pinned, because the trusted-root set is the active project plus the
    // recent-projects list, and that list keeps only the 12 most recent
    // UNPINNED entries. Specs that open temp copies push these two off it,
    // and every later spec that names them is then refused as "not open" —
    // part-way through the run, in whatever spec happened to come next.
    const res = await fetch(`${API}/recent-projects/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ projectPath, pinned: true }),
    });
    if (!res.ok) throw new Error(`pin ${projectPath}: HTTP ${res.status} ${await res.text()}`);
  });
}
