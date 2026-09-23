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

import { test as setup, expect } from '@playwright/test';
import { API, PROJECT_PATH, authHeaders } from './helpers/setup';

setup('open the project under test', async ({ request }) => {
  setup.setTimeout(120_000);
  const res = await request.post(`${API}/project/scan`, {
    headers: authHeaders(),
    data: { projectPath: PROJECT_PATH },
    timeout: 110_000,
  });
  expect(res.ok(), `scan of ${PROJECT_PATH} failed: HTTP ${res.status()}`).toBeTruthy();
});
