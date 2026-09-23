/**
 * Phase 31.2 — artefacts, and a decision that notices its file changed.
 *
 * The loop this exists for: an analyst's agent writes a spreadsheet,
 * records it as the item's output, and cites it as evidence. A person
 * approves. Someone then edits the spreadsheet. The approval was of a file
 * that no longer exists in that form, so the criterion must read "changed
 * since approved" — to the agent and to the person — rather than silently
 * still "met".
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, waitFor } from '../harness';

interface AgentCriterion { uid: string; state: string }

test.describe('Phase 31.2 — artefacts and stale approvals', () => {
  test.setTimeout(180_000);

  test('an approved output that is edited reads as changed since approved, and says so once', async () => {
    const h = await setupHarness('artefacts-stale');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({ title: 'Q3 board pack', projectPath: h.fixture.projectPath });
      const item = (await (await h.client.raw('POST', `/api/plans/${plan.uid}/items`, {
        kind: 'action', title: 'Q3 revenue summary',
      })).json()).uid as string;

      const output = path.join(h.fixture.projectPath, 'reports', 'q3-summary.csv');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'region,revenue\nEMEA,120\n');

      const agent = await h.spawnAgent({ agentType: 'claude-desktop' });

      // 1. The agent records what it produced. An absolute path inside the
      //    project is stored relative; one outside, or a script, is refused.
      const recorded = JSON.parse((await agent.callTool('record_artefact', {
        item_uid: item, path: output, role: 'output', note: 'Q3 summary',
      })).text);
      expect(recorded.path).toBe('reports/q3-summary.csv');
      expect(recorded.sha256).toMatch(/^[a-f0-9]{64}$/);
      const refused = await agent.callTool('record_artefact', { item_uid: item, path: '/etc/hosts', role: 'material' });
      expect(refused.isError).toBe(true);

      // 2. It cites the file; a person approves.
      const c = await (await h.client.raw('POST', `/api/items/${item}/criteria`, {
        text: 'EMEA revenue matches the ledger', kind: 'artefact',
      })).json();
      await agent.callTool('submit_criterion', {
        criterion_uid: c.uid, evidence: [{ attachment_uid: recorded.attachment_uid, locator: { range: 'B2' } }],
        note: 'EMEA in B2',
      });
      const approved = await (await h.client.raw('POST', `/api/criteria/${c.uid}/decide`, { decision: 'approved' })).json();
      expect(approved.state).toBe('met');

      // 3. Someone edits the spreadsheet afterwards.
      fs.writeFileSync(output, 'region,revenue\nEMEA,126\n');

      // The watcher says so, once, where the person will see it.
      await waitFor(async () => {
        const events = await (await h.client.raw('GET', `/api/plans/${plan.uid}/channels`)).json() as Array<{ eventType: string; payload: { message: string } }>;
        return events.some((e) => e.eventType === 'need-decision' && e.payload.message.includes('reports/q3-summary.csv'));
      }, { timeoutMs: 15_000, description: 'a need-decision event for the edited output' });

      // And every read says so, agent and person alike.
      const forAgent = JSON.parse((await agent.callTool('list_criteria', { item_uid: item })).text) as AgentCriterion[];
      expect(forAgent.find((x) => x.uid === c.uid)?.state).toBe('stale');
      const forPerson = await (await h.client.raw('GET', `/api/items/${item}/criteria`)).json() as AgentCriterion[];
      expect(forPerson.find((x) => x.uid === c.uid)?.state).toBe('stale');

      // 4. A second edit to an already-stale file says nothing new.
      fs.writeFileSync(output, 'region,revenue\nEMEA,127\n');
      await new Promise((r) => setTimeout(r, 1500));
      const events = await (await h.client.raw('GET', `/api/plans/${plan.uid}/channels`)).json() as Array<{ eventType: string }>;
      expect(events.filter((e) => e.eventType === 'need-decision')).toHaveLength(1);

      // 5. The person looks again and approves what is there now.
      const reapproved = await (await h.client.raw('POST', `/api/criteria/${c.uid}/decide`, { decision: 'approved' })).json();
      expect(reapproved.state).toBe('met');
    } finally {
      await h.teardown();
    }
  });
});
