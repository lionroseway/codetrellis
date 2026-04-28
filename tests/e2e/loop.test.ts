/**
 * Loop tests — exercises the front-to-back feedback chain:
 *
 *     scan → plan with affectedFiles → file edit on disk →
 *     chokidar fires → file-watcher re-parses → plan-progress-service
 *     auto-advances the matching task → REST reflects in_progress.
 *
 * No MCP / no scripted agent yet — that's Phase 2b. This test
 * proves the *plumbing* between the file watcher and the plan-progress
 * hook works, which is the highest-risk unverified piece in the loop.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, waitFor, sleep } from '../harness';

test.describe('Loop — file edit auto-advances task', () => {
  test.setTimeout(120_000);

  test('editing an affectedFile flips a pending task to in_progress', async () => {
    const h = await setupHarness('loop-auto-advance');

    try {
      // 1. Scan — `/api/project/scan` also kicks off the file
      //    watcher on the project root, which is what the rest of
      //    the test depends on.
      await h.client.scanProject(h.fixture.projectPath);

      // 2. Create a draft plan with a single task pointing at a
      //    known fixture file. The plan-progress-service treats
      //    `draft` plans as live, so we don't need to flip status.
      const targetFile = 'packages/web/src/api.ts';
      const plan = await h.client.createPlan({
        title: 'Loop test plan',
        description: 'Auto-advance smoke test',
        projectPath: h.fixture.projectPath,
        tasks: [
          {
            description: 'Update the API client',
            affectedFiles: [targetFile],
          },
        ],
      });

      // The harness's createPlan returns a summary; fetch the full
      // detail so we can pin the task uid for later assertions.
      const detail = await h.client.getPlan(plan.uid);
      expect(detail.tasks).toHaveLength(1);
      const taskUid = detail.tasks[0].uid;
      expect(detail.tasks[0].status).toBe('pending');

      // 3. Mutate the file on disk. We append a comment — must
      //    actually change the content hash, otherwise the
      //    file-watcher's `oldHash === newHash` short-circuit
      //    skips the broadcast. The fixture file is committed at
      //    a known state so a single appended line is enough.
      const absPath = path.join(h.fixture.projectPath, targetFile);
      const before = fs.readFileSync(absPath, 'utf-8');
      fs.writeFileSync(absPath, before + '\n// edited by loop test\n', 'utf-8');

      // 4. Wait for chokidar → re-parse → plan-progress-service →
      //    REST to reflect the new status. chokidar can take a
      //    few hundred ms on macOS; give it generous slack.
      const advancedTask = await waitFor(
        async () => {
          const fresh = await h.client.getPlan(plan.uid);
          const t = fresh.tasks.find((t) => t.uid === taskUid);
          return t && t.status === 'in_progress' ? t : null;
        },
        {
          timeoutMs: 10_000,
          intervalMs: 200,
          description: `task ${taskUid} to advance to in_progress`,
        },
      );

      expect(advancedTask.status).toBe('in_progress');
    } finally {
      await h.teardown();
    }
  });

  test('editing an unrelated file does NOT advance the task', async () => {
    const h = await setupHarness('loop-no-false-advance');

    try {
      await h.client.scanProject(h.fixture.projectPath);

      // Plan targets api.ts; we'll edit a different file.
      const plan = await h.client.createPlan({
        title: 'Negative-case plan',
        projectPath: h.fixture.projectPath,
        tasks: [
          {
            description: 'Update the API client',
            affectedFiles: ['packages/web/src/api.ts'],
          },
        ],
      });
      const detail = await h.client.getPlan(plan.uid);
      const taskUid = detail.tasks[0].uid;

      // Edit a file that's NOT in affectedFiles.
      const unrelated = path.join(h.fixture.projectPath, 'packages/shared/src/validators.ts');
      const before = fs.readFileSync(unrelated, 'utf-8');
      fs.writeFileSync(unrelated, before + '\n// unrelated edit\n', 'utf-8');

      // Wait long enough for chokidar to definitely have fired and
      // been processed if it were going to advance the wrong task.
      // (We can't `waitFor` a non-event; we wait then assert.)
      await sleep(2000);

      const fresh = await h.client.getPlan(plan.uid);
      const t = fresh.tasks.find((t) => t.uid === taskUid);
      expect(t?.status).toBe('pending');
    } finally {
      await h.teardown();
    }
  });
});
