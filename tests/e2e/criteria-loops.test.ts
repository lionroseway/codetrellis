/**
 * Phase 31.2a — the loops, over MCP, against the real server.
 *
 * The agent checks before it claims and is refused when a citation points
 * nowhere; a person sends the work back with a note; the agent's worklist
 * hands that note back with where it points; the source changes and a
 * check run says which criterion went stale and why. Nothing on the way
 * approves anything but the person.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness } from '../harness';

test.describe('Phase 31.2a — checks, the worklist and check runs', () => {
  test.setTimeout(180_000);

  test('check before claiming, send back, resume from the worklist, re-check when the source moves', async () => {
    const h = await setupHarness('criteria-loops');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({ title: 'Q3 board pack', projectPath: h.fixture.projectPath });
      const item = (await (await h.client.raw('POST', `/api/plans/${plan.uid}/items`, {
        kind: 'action', title: 'Q3 revenue summary',
      })).json()).uid as string;

      const ledger = path.join(h.fixture.projectPath, 'data', 'ledger.csv');
      fs.mkdirSync(path.dirname(ledger), { recursive: true });
      fs.writeFileSync(ledger, 'region,revenue\nEMEA,120\nAPAC,80\n');

      const agent = await h.spawnAgent({ agentType: 'claude-desktop' });
      const material = JSON.parse((await agent.callTool('record_artefact', {
        item_uid: item, path: 'data/ledger.csv', role: 'material', note: 'The ledger export',
      })).text);
      const c = await (await h.client.raw('POST', `/api/items/${item}/criteria`, {
        text: 'EMEA revenue matches the ledger', kind: 'citation',
      })).json();

      // 1. Check before claiming: a cell the ledger does not have.
      const wrong = [{ attachment_uid: material.attachment_uid, locator: { range: 'B9' } }];
      const dry = JSON.parse((await agent.callTool('check_criterion', { criterion_uid: c.uid, evidence: wrong })).text);
      expect(dry.ok).toBe(false);
      expect(dry.findings.map((f: { message: string }) => f.message).join('\n')).toMatch(/B9 is outside data\/ledger\.csv, which has 3 rows/);

      // A submission that fails a check is refused, and records nothing.
      const refused = await agent.callTool('submit_criterion', { criterion_uid: c.uid, evidence: wrong, note: 'EMEA in B9' });
      expect(refused.isError).toBe(true);
      expect(refused.text).toMatch(/Not submitted/);

      // 2. Fixed, checked, submitted.
      const right = [{ attachment_uid: material.attachment_uid, locator: { range: 'B2' } }];
      expect(JSON.parse((await agent.callTool('check_criterion', { criterion_uid: c.uid, evidence: right })).text).ok).toBe(true);
      const submitted = JSON.parse((await agent.callTool('submit_criterion', {
        criterion_uid: c.uid, evidence: right, note: 'EMEA in B2',
      })).text);
      expect(submitted.state).toBe('submitted');

      // 3. A person sends it back; the worklist hands the note back with where it points.
      await h.client.raw('POST', `/api/criteria/${c.uid}/decide`, { decision: 'sent_back', note: 'Use the restated figure' });
      const worklist = JSON.parse((await agent.callTool('get_worklist', { plan_uid: plan.uid })).text);
      expect(worklist.owed[0]).toMatchObject({
        reason: 'sent_back',
        criterion_uid: c.uid,
        note: 'Use the restated figure',
        item: `task ${item.slice(0, 8)}`,
        points_at: [{ attachment_uid: material.attachment_uid, path: 'data/ledger.csv', locator: { range: 'B2' } }],
      });

      // 4. Resubmitted and approved; the first run records it.
      await agent.callTool('submit_criterion', { criterion_uid: c.uid, evidence: right, note: 'Restated' });
      await h.client.raw('POST', `/api/criteria/${c.uid}/decide`, { decision: 'approved' });
      const first = await (await h.client.raw('POST', `/api/plans/${plan.uid}/check-runs`)).json();
      expect(first.outcomes.find((o: { criterionUid: string }) => o.criterionUid === c.uid).state).toBe('met');

      // 5. The source moves. A run says which criterion went stale, and why.
      fs.writeFileSync(ledger, 'region,revenue\nEMEA,126\nAPAC,80\n');
      const run = JSON.parse((await agent.callTool('run_checks', { plan_uid: plan.uid })).text);
      expect(run.stale).toEqual([{ criterion_uid: c.uid, criterion: 'EMEA revenue matches the ledger', changed: ['data/ledger.csv'] }]);
      expect(run.since_last.join(' ')).toMatch(/went stale .* data\/ledger\.csv changed/);

      // Nothing was approved by being checked: the only approval is the person's.
      const signoffs = await (await h.client.raw('GET', `/api/criteria/${c.uid}/signoffs`)).json() as Array<{ decision: string; actorType: string }>;
      expect(signoffs.filter((s) => s.decision === 'approved').every((s) => s.actorType === 'human')).toBe(true);

      const runs = await (await h.client.raw('GET', `/api/plans/${plan.uid}/check-runs`)).json() as Array<{ trigger: string }>;
      expect(runs.length).toBeGreaterThanOrEqual(2);
    } finally {
      await h.teardown();
    }
  });
});
