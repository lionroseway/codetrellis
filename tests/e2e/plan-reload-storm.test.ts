/**
 * Phase 33 0.2 — the plan reload storm, measured (design §1.1).
 *
 * The owner's report: plans changing on disk fired "Plan reloaded from
 * disk" so many times the Mac froze (0.1.17). The plan watcher re-imports
 * the whole plan, and broadcasts `plan-imported`, once per changed file, so
 * a pull or branch switch that touches N task files costs N whole-plan
 * imports, and the window refetches and toasts N times.
 *
 * This test changes N task files of one plan at once (as `git pull` does),
 * waits until the broadcasts stop, and records:
 *  - how many `plan-imported` broadcasts came (one per import);
 *  - the slowest answer to a request made while the burst was handled.
 *
 * It asserts today's behaviour, so it is green: at least one broadcast per
 * changed file. **S1 tightens it** to one import and one broadcast per plan
 * per burst, and the slowest answer within twice the idle one.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { setupHarness, openEventStream, sleep, waitFor } from '../harness';

/** Quiet long enough that a burst is over: the watcher waits for writes to settle first. */
const QUIET_MS = 2500;

for (const n of [1, 10, 50]) {
  test(`changing ${n} task file${n === 1 ? '' : 's'} of one plan at once: imports and broadcasts per file (today)`, async () => {
    test.setTimeout(180_000);
    const h = await setupHarness(`plan-reload-storm-${n}`);
    const events = await openEventStream(h.backend);
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: `Storm ${n}`,
        projectPath: h.fixture.projectPath,
        tasks: Array.from({ length: n }, (_, i) => ({ description: `Task ${i + 1}`, affectedFiles: ['packages/web/src/api.ts'] })),
      });
      const exported = await h.client.exportPlan(plan.uid, h.fixture.projectPath);
      const tasksDir = path.join(exported.planDir, 'tasks');
      const taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.yaml')).map((f) => path.join(tasksDir, f));
      expect(taskFiles).toHaveLength(n);

      // Past the self-write window, so the edits read as someone else's.
      await sleep(1500);

      // The idle answer, before anything changes.
      const idleStart = Date.now();
      await h.client.listPlans();
      const idleMs = Date.now() - idleStart;

      const before = events.ofType('plan-imported').length;
      // Every file at once, as a pull does.
      for (const f of taskFiles) {
        const doc = yaml.parse(fs.readFileSync(f, 'utf-8'));
        doc.description = `${doc.description ?? ''} (changed on disk)`;
        fs.writeFileSync(f, yaml.stringify(doc), 'utf-8');
      }

      // Ask while the burst is handled, until the broadcasts have stopped.
      let slowestMs = 0;
      let lastCount = before;
      let lastChange = Date.now();
      await waitFor(
        async () => {
          const t = Date.now();
          await h.client.listPlans();
          slowestMs = Math.max(slowestMs, Date.now() - t);
          const count = events.ofType('plan-imported').length;
          if (count !== lastCount) { lastCount = count; lastChange = Date.now(); }
          return count > before && Date.now() - lastChange >= QUIET_MS ? true : null;
        },
        { timeoutMs: 120_000, intervalMs: 100, description: 'the plan-imported broadcasts to stop' },
      );

      const broadcasts = events.ofType('plan-imported').length - before;
      // The numbers the log records for 0.2.
      console.log(`[0.2] files=${n} plan-imported=${broadcasts} idle=${idleMs}ms slowest-during-burst=${slowestMs}ms`);

      // Today: at least one whole-plan import and broadcast per changed file.
      // S1 changes this to exactly one per plan.
      expect(broadcasts).toBeGreaterThanOrEqual(n);
      // The plan took every change.
      const fresh = await h.client.getPlan(plan.uid);
      expect(fresh.tasks.filter((t) => t.description.endsWith('(changed on disk)'))).toHaveLength(n);
    } finally {
      await events.close();
      await h.teardown();
    }
  });
}
