/**
 * The demo's Phase 32 groups, run with no window (`check` mode) against a
 * real backend, so a scene whose tools change under it fails here rather
 * than on the release machine (docs/releases/RUNBOOK.md, step 5).
 *
 * The same scene code a person watches with `npm run demo -- --group=…`:
 * narration and screenshots do nothing, there is no pause, and a person's
 * step (setting a breakpoint, marking an overlap intended) is taken through
 * the desktop's HTTP route, as `--decide` does. A flag is a failure.
 * The main loop is not run here: it needs the sample app's own copy and a
 * window, and is checked by eye.
 */
import { test, expect } from '@playwright/test';
import { setupHarness, createMcpClient, REPO_ROOT, type Harness, type ScriptedMcp } from '../harness';
import { parseOptions } from '../../scripts/demo/options';
import { createContext } from '../../scripts/demo/context';
import { pickScenes, runScenes } from '../../scripts/demo/runner';
import { GROUPS, DEFAULT_GROUP } from '../../scripts/demo/registry';

const CHECKED = GROUPS.filter((g) => g.id !== DEFAULT_GROUP);

test.describe('The demo, checked with no window', () => {
  test.setTimeout(300_000);

  let h: Harness;
  let client: ScriptedMcp;

  test.beforeAll(async () => {
    h = await setupHarness('demo-check', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    client = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codetrellis-demo' });
    await client.connect();
  });

  test.afterAll(async () => {
    await client?.disconnect().catch(() => {});
    await h?.teardown();
  });

  for (const group of CHECKED) {
    test(`${group.id}: every scene runs and nothing looks wrong`, async () => {
      const opts = parseOptions([`--group=${group.id}`, '--decide'], REPO_ROOT);
      opts.project = h.fixture.projectPath;
      opts.dataDir = h.fixture.dataDir;
      opts.mcpPort = h.backend.mcpPort;
      const chosen = pickScenes(opts);
      if ('error' in chosen) throw new Error(chosen.error);
      const run = createContext(opts, { client, token: h.backend.capabilityToken, mode: 'check', apiBase: h.backend.baseUrl });
      try {
        await runScenes(run.ctx, chosen.picked);
      } finally {
        await run.tidy();
      }
      expect(run.flags).toEqual([]);
    });
  }
});
