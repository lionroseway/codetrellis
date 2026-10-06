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
 * 0.2 asserted the behaviour it measured: at least one import and broadcast
 * per changed file. **S1** gathers a plan's changes and imports it once they
 * go quiet (250 ms, at most a second apart while a burst keeps going), so
 * now the imports are bounded by the plans touched, not the files: one,
 * or two when a burst straddles the one-second cap. Each broadcast says how
 * many files it covers, and together they cover every changed file. The
 * slowest answer meanwhile stays within twice the idle one, with a 250 ms
 * floor so a 3 ms idle answer does not make the bound a coin toss.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { setupHarness, openEventStream, sleep, waitFor } from '../harness';

/** Quiet long enough that a burst is over: the watcher waits for writes to settle first. */
const QUIET_MS = 2500;

for (const n of [1, 10, 50]) {
  test(`changing ${n} task file${n === 1 ? '' : 's'} of one plan at once is one import, not ${n}`, async () => {
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

      const imported = events.ofType('plan-imported').slice(before).map((e) => e.payload);
      const broadcasts = imported.length;
      // The numbers the log records.
      console.log(`[S1] files=${n} plan-imported=${broadcasts} idle=${idleMs}ms slowest-during-burst=${slowestMs}ms`);

      // Bounded by the plans touched, not the files.
      expect(broadcasts).toBeGreaterThanOrEqual(1);
      expect(broadcasts).toBeLessThanOrEqual(2);
      expect(imported.every((p) => p.planUid === plan.uid && p.source === 'file-watcher')).toBe(true);
      expect(imported.reduce((sum, p) => sum + (p.files ?? 0), 0)).toBeGreaterThanOrEqual(n);
      // The backend kept answering while it handled the burst.
      expect(slowestMs).toBeLessThanOrEqual(Math.max(2 * idleMs, 250));
      // The plan took every change.
      const fresh = await h.client.getPlan(plan.uid);
      expect(fresh.tasks.filter((t) => t.description.endsWith('(changed on disk)'))).toHaveLength(n);
    } finally {
      await events.close();
      await h.teardown();
    }
  });
}
