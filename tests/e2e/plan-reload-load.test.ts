/**
 * Phase 33 S3 — quiet under load, end to end (EXECUTION Track S).
 *
 * A pull that changes 200 task files across 5 plans, through the real
 * watcher. S1 made a burst one import per plan; this checks it holds at
 * scale and with several plans at once:
 *  - each plan is imported once (twice when its burst straddles the
 *    one-second cap), so 5 to 10 imports, not 200;
 *  - together the imports cover every changed file;
 *  - every plan took every change;
 *  - the backend keeps answering meanwhile;
 *  - and nothing else storms: no other broadcast comes once per file.
 * The owner repeats it on a Mac with a real `git pull` (the log records it).
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { setupHarness, openEventStream, sleep, waitFor } from '../harness';

const PLANS = 5;
const FILES_PER_PLAN = 40;
const QUIET_MS = 2500;

test(`changing ${PLANS * FILES_PER_PLAN} task files across ${PLANS} plans at once: one import per plan, and nothing else storms`, async () => {
  test.setTimeout(300_000);
  const h = await setupHarness('plan-reload-load');
  const events = await openEventStream(h.backend);
  try {
    await h.client.scanProject(h.fixture.projectPath);
    const plans: Array<{ uid: string; files: string[] }> = [];
    for (let p = 0; p < PLANS; p++) {
      const plan = await h.client.createPlan({
        title: `Load ${p + 1}`,
        projectPath: h.fixture.projectPath,
        tasks: Array.from({ length: FILES_PER_PLAN }, (_, i) => ({ description: `Task ${i + 1}`, affectedFiles: ['packages/web/src/api.ts'] })),
      });
      const exported = await h.client.exportPlan(plan.uid, h.fixture.projectPath);
      const dir = path.join(exported.planDir, 'tasks');
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => path.join(dir, f));
      expect(files).toHaveLength(FILES_PER_PLAN);
      plans.push({ uid: plan.uid, files });
    }

    // Past the self-write window, so the edits read as someone else's.
    await sleep(1500);
    const idleStart = Date.now();
    await h.client.listPlans();
    const idleMs = Date.now() - idleStart;

    const before = events.events.length;
    // Every file of every plan at once, as a pull does.
    for (const { files } of plans) {
      for (const f of files) {
        const doc = yaml.parse(fs.readFileSync(f, 'utf-8'));
        doc.description = `${doc.description ?? ''} (pulled)`;
        fs.writeFileSync(f, yaml.stringify(doc), 'utf-8');
      }
    }

    let slowestMs = 0;
    let lastCount = before;
    let lastChange = Date.now();
    await waitFor(
      async () => {
        const t = Date.now();
        await h.client.listPlans();
        slowestMs = Math.max(slowestMs, Date.now() - t);
        const count = events.events.length;
        if (count !== lastCount) { lastCount = count; lastChange = Date.now(); }
        const imported = events.events.slice(before).filter((e) => e.type === 'plan-imported').length;
        return imported >= PLANS && Date.now() - lastChange >= QUIET_MS ? true : null;
      },
      { timeoutMs: 180_000, intervalMs: 100, description: 'the broadcasts to stop' },
    );

    const burst = events.events.slice(before);
    const byType = new Map<string, number>();
    for (const e of burst) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    const imported = burst.filter((e) => e.type === 'plan-imported').map((e) => e.payload as { planUid: string; files?: number });
    console.log(`[S3] files=${PLANS * FILES_PER_PLAN} plans=${PLANS} idle=${idleMs}ms slowest-during-burst=${slowestMs}ms broadcasts=${JSON.stringify(Object.fromEntries(byType))}`);

    // One import per plan, two at most when a burst straddles the cap.
    for (const { uid } of plans) {
      const mine = imported.filter((p) => p.planUid === uid);
      expect(mine.length, `imports of ${uid}`).toBeGreaterThanOrEqual(1);
      expect(mine.length, `imports of ${uid}`).toBeLessThanOrEqual(2);
      expect(mine.reduce((sum, p) => sum + (p.files ?? 0), 0)).toBeGreaterThanOrEqual(FILES_PER_PLAN);
    }
    // Nothing else storms: no broadcast comes anywhere near once per file.
    for (const [type, n] of byType) expect(n, `${type} broadcasts`).toBeLessThanOrEqual(PLANS * 4);
    // The backend kept answering.
    expect(slowestMs).toBeLessThanOrEqual(Math.max(2 * idleMs, 500));
    // Every plan took every change.
    for (const { uid } of plans) {
      const fresh = await h.client.getPlan(uid);
      expect(fresh.tasks.filter((t) => t.description.endsWith('(pulled)'))).toHaveLength(FILES_PER_PLAN);
    }
  } finally {
    await events.close();
    await h.teardown();
  }
});
