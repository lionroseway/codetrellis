/**
 * Open the projects the specs work in, once, before any spec runs.
 *
 * Paths the API and MCP tools act on are confined to projects this app
 * has OPENED (Phase 19). The suite used to share the developer's real
 * ~/.codetrellis, where this repo was already in the recent projects, so
 * that held by accident. Each run now gets a fresh data dir (see
 * playwright.config.ts), and nothing is open until something scans it.
 * Specs that talk only to the API or MCP (plan seeding, archive/delete,
 * the live-agent flows) never scan, so their project was refused: a 403
 * from POST /api/plans, or an MCP refusal that the spec then tried to
 * JSON.parse ("Unexpected non-whitespace character ... at position 14").
 *
 * Opening a project is a scan, the same call the app makes.
 */

import path from 'node:path';

const PROJECTS = [
  process.cwd(),
  path.resolve(process.cwd(), 'tests', 'fixtures', 'sample-app'),
];

export default async function globalSetup(): Promise<void> {
  const token = process.env.CODETRELLIS_CAPABILITY_TOKEN;
  if (!token) throw new Error('global setup: no capability token (playwright.config.ts pins one)');
  for (const projectPath of PROJECTS) {
    const res = await fetch('http://localhost:3001/api/project/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-codetrellis-token': token },
      body: JSON.stringify({ projectPath }),
    });
    if (!res.ok) {
      throw new Error(`global setup: could not open ${projectPath} (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
  }
}
