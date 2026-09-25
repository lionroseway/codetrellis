/**
 * Phase 31.1 — criteria and sign-off, through the real MCP server and REST.
 *
 * The loop this phase exists for: an agent reads what its work is judged
 * on, offers evidence, and a PERSON decides — approving it, or sending it
 * back with a note the agent reads next. An agent cannot close its own
 * work unless a person said it could.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { setupHarness } from '../harness';

interface AgentCriterion {
  uid: string;
  text: string;
  kind: string;
  policy: string;
  state: string;
  sent_back_note: string | null;
  decided_by: { actor: string; actor_type: string } | null;
}

test.describe('Phase 31.1 — criteria and sign-off', () => {
  test.setTimeout(180_000);

  test('an agent submits, a person sends back and approves, and the gate follows', async () => {
    const h = await setupHarness('criteria-signoff');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({ title: 'Board pack', projectPath: h.fixture.projectPath });

      const mk = async (title: string, extra: Record<string, unknown> = {}) => {
        const res = await h.client.raw('POST', `/api/plans/${plan.uid}/items`, { kind: 'action', title, ...extra });
        expect(res.ok).toBe(true);
        return (await res.json()).uid as string;
      };
      // The form intake writes — the body section becomes rows.
      const report = await mk('Q3 revenue summary', {
        body: 'Summarise Q3.\n\n## Acceptance criteria\n- [ ] EMEA totals match the ledger\n',
      });
      const next = await mk('Send to the board');
      // The gate: set the way the UI sets it.
      expect((await h.client.raw('PUT', `/api/items/${report}`, { requiresApproval: true })).ok).toBe(true);

      const agent = await h.spawnAgent({ agentType: 'claude-desktop' });
      const list = async () =>
        JSON.parse((await agent.callTool('list_criteria', { item_uid: report })).text) as AgentCriterion[];

      // 1. What the work is judged on: the migrated line, verbatim, and the gate.
      let criteria = await list();
      expect(criteria.map((c) => c.text)).toEqual(['EMEA totals match the ledger', 'Reviewed and approved']);
      expect(criteria.every((c) => c.policy === 'human' && c.state === 'open')).toBe(true);

      // 2. An agent may add a criterion, in the requester's words — at propose.
      const added = JSON.parse((await agent.callTool('add_criterion', {
        item_uid: report, text: 'Chart has a source line', kind: 'artefact',
      })).text) as AgentCriterion;
      expect(added.policy).toBe('propose');

      // 3. The old way to close a gate is gone, and says where to go instead.
      const gateTry = await agent.callTool('approve_gate', { uid: report });
      expect(gateTry.isError).toBe(true);
      expect(gateTry.text).toMatch(/retired/);
      expect(gateTry.text).toMatch(/submit_criterion/);

      // 4. Done, but gated: a person has not signed off.
      await agent.callTool('update_item', { uid: report, status: 'done' });
      const gated = JSON.parse((await agent.callTool('get_next_item', { plan_uid: plan.uid })).text);
      expect(gated.available).toBe(false);
      expect(gated.reason).toMatch(/sign off/);

      // 5. The agent offers evidence. Submitting is not approving.
      const gate = criteria.find((c) => c.text === 'Reviewed and approved')!;
      const submitted = JSON.parse((await agent.callTool('submit_criterion', {
        criterion_uid: gate.uid, note: 'Totals reconciled against the ledger export',
      })).text) as AgentCriterion;
      expect(submitted.state).toBe('submitted');
      expect(JSON.parse((await agent.callTool('get_next_item', { plan_uid: plan.uid })).text).available).toBe(false);

      // 6. A person sends it back — with a note, which the agent then reads.
      const noNote = await h.client.raw('POST', `/api/criteria/${gate.uid}/decide`, { decision: 'sent_back' });
      expect(noNote.status).toBe(400);
      const back = await h.client.raw('POST', `/api/criteria/${gate.uid}/decide`, {
        decision: 'sent_back', note: 'EMEA excludes the Nordics restatement',
      });
      expect(back.ok).toBe(true);
      criteria = await list();
      const sentBack = criteria.find((c) => c.uid === gate.uid)!;
      expect(sentBack.state).toBe('sent_back');
      expect(sentBack.sent_back_note).toBe('EMEA excludes the Nordics restatement');
      expect(sentBack.decided_by?.actor_type).toBe('human');

      // 7. Resubmit; the person approves. The gate lifts.
      await agent.callTool('submit_criterion', { criterion_uid: gate.uid, note: 'Restatement included' });
      expect((await h.client.raw('POST', `/api/criteria/${gate.uid}/decide`, { decision: 'approved' })).ok).toBe(true);
      // The other human criterion still holds the gate.
      expect(JSON.parse((await agent.callTool('get_next_item', { plan_uid: plan.uid })).text).available).toBe(false);
      const emea = criteria.find((c) => c.text === 'EMEA totals match the ledger')!;
      await agent.callTool('submit_criterion', { criterion_uid: emea.uid, note: 'Matches' });
      await h.client.raw('POST', `/api/criteria/${emea.uid}/decide`, { decision: 'approved' });
      const released = JSON.parse((await agent.callTool('get_next_item', { plan_uid: plan.uid })).text);
      expect(released.uid ?? released.item?.uid).toBe(next);

      // 8. The decisions are a record, in the person's name.
      const signoffs = await (await h.client.raw('GET', `/api/criteria/${gate.uid}/signoffs`)).json();
      expect(signoffs.map((s: { decision: string }) => s.decision)).toEqual(['sent_back', 'approved']);
      expect(signoffs.every((s: { actorType: string; channel: string }) => s.actorType === 'human' && s.channel === 'desktop')).toBe(true);

      // 9. The plan file carries the criteria and never the decisions.
      const exported = await (await h.client.raw('POST', `/api/plans/${plan.uid}/export?path=${encodeURIComponent(h.fixture.projectPath)}`)).json();
      const itemFile = (exported.files as string[]).find((f) => fs.readFileSync(f, 'utf-8').includes(report));
      expect(itemFile, 'the item was exported').toBeTruthy();
      const onDisk = parseYaml(fs.readFileSync(itemFile!, 'utf-8'));
      expect(onDisk.criteria.map((c: { text: string }) => c.text)).toEqual([
        'EMEA totals match the ledger', 'Chart has a source line',
      ]);
      const raw = fs.readFileSync(itemFile!, 'utf-8');
      expect(raw).not.toMatch(/signoff|sent_back|decision/i);
      expect(path.isAbsolute(itemFile!)).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('a person\'s edits: add at a chosen policy, reword resets, delete', async () => {
    const h = await setupHarness('criteria-edits');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({ title: 'Edits', projectPath: h.fixture.projectPath });
      const item = (await (await h.client.raw('POST', `/api/plans/${plan.uid}/items`, { kind: 'action', title: 'T' })).json()).uid;

      const created = await h.client.raw('POST', `/api/items/${item}/criteria`, { text: 'Build passes', kind: 'code' });
      expect(created.status).toBe(201);
      const c = await created.json();
      expect(c.policy).toBe('agent');

      const bad = await h.client.raw('POST', `/api/items/${item}/criteria`, { text: 'x', kind: 'vibes' });
      expect(bad.status).toBe(400);

      const agent = await h.spawnAgent();
      const met = JSON.parse((await agent.callTool('submit_criterion', { criterion_uid: c.uid, note: 'CI green' })).text);
      expect(met.state).toBe('met');
      expect(met.decided_by.actor_type).toBe('mcp');

      const reworded = await (await h.client.raw('PUT', `/api/criteria/${c.uid}`, { text: 'Build and lint pass' })).json();
      expect(reworded.state).toBe('open');

      expect((await h.client.raw('DELETE', `/api/criteria/${c.uid}`)).ok).toBe(true);
      expect(await (await h.client.raw('GET', `/api/items/${item}/criteria`)).json()).toEqual([]);
    } finally {
      await h.teardown();
    }
  });
});
