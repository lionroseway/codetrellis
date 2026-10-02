/**
 * Phase 32 B8.3b — a grounding line on each task.
 *
 * Sam's "Q3 revenue summary" is judged on three criteria: EMEA revenue cited
 * from the ledger (an agent proposes, Sam decides), the summary written (an
 * output the agent may mark met), and whether it reads well to the board
 * (only Sam can judge). At each turn the window, the agent's brief and Sam's
 * phone say the same line: nothing offered yet; the agent's evidence
 * passing, two waiting on Sam; Sam approving, all grounded; the ledger
 * changing under an approval, "changed since"; the summary found older than
 * the work, "failing".
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type Phone, type ScriptedAgent } from '../harness';

interface Grounding { words: string | null; grounded: boolean; counts: Record<string, number>; criteria: Array<{ uid: string; text: string; grade: string; why: string }> }

test.describe.serial('A grounding line on each task', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let agent: ScriptedAgent;
  let phone: Phone;
  let item: string;
  let cite: string;
  let summary: string;
  let judge: string;
  let ledgerUid: string;
  const at = (rel: string) => path.join(h.fixture.projectPath, rel);

  /** What the window, the agent and the phone say now, checked to be one line. */
  const line = async () => {
    const rest = (await (await h.client.raw('GET', `/api/items/${item}/grounding`)).json()) as Grounding;
    const brief = JSON.parse((await agent.callTool('get_brief', { item_uid: item })).text) as { grounding: { says: string; criteria: Array<{ uid: string; grade: string }> } | null };
    const onPhone = (await phone.rpc('criteria.list', { itemUid: item })) as { grounding: { words: string; grades: Record<string, { grade: string }> } | null };
    expect(brief.grounding?.says).toBe(rest.words);
    expect(onPhone.grounding?.words).toBe(rest.words);
    for (const c of rest.criteria) {
      expect(brief.grounding?.criteria.find((b) => b.uid === c.uid)?.grade).toBe(c.grade);
      expect(onPhone.grounding?.grades[c.uid]?.grade).toBe(c.grade);
    }
    return rest;
  };
  const gradeOf = (g: Grounding, uid: string) => g.criteria.find((c) => c.uid === uid)!;

  test.beforeAll(async () => {
    h = await setupHarness('task-grounding');
    await h.client.scanProject(h.fixture.projectPath);
    const plan = await h.client.createPlan({ title: 'Q3 board pack', projectPath: h.fixture.projectPath });
    item = ((await (await h.client.raw('POST', `/api/plans/${plan.uid}/items`, { kind: 'action', title: 'Q3 revenue summary' })).json()) as { uid: string }).uid;
    fs.mkdirSync(at('data'), { recursive: true });
    fs.writeFileSync(at('data/ledger.csv'), 'region,revenue\nEMEA,120\nAPAC,80\n');
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    ledgerUid = (JSON.parse((await agent.callTool('record_artefact', { item_uid: item, path: 'data/ledger.csv', role: 'material' })).text) as { attachment_uid: string }).attachment_uid;
    const add = async (body: Record<string, unknown>) => ((await (await h.client.raw('POST', `/api/items/${item}/criteria`, body)).json()) as { uid: string }).uid;
    cite = await add({ text: 'EMEA revenue matches the ledger', kind: 'citation' });
    summary = await add({ text: 'A summary exists', kind: 'artefact', policy: 'agent' });
    judge = await add({ text: 'Reads well to the board', kind: 'manual', policy: 'human' });
    phone = await pairPhone(h.client, { alias: 'Sam\'s phone' });
  });
  test.afterAll(async () => { await phone?.close?.(); await h?.teardown(); });

  test('nothing offered yet: the line says what each criterion is missing', async () => {
    const g = await line();
    expect(g.words).toBe('3 criteria · 1 waiting on a person · 2 no evidence yet');
    expect(gradeOf(g, judge)).toMatchObject({ grade: 'waiting', why: 'only a person can judge it' });
    expect(gradeOf(g, cite).grade).toBe('no_evidence');
    expect(gradeOf(g, summary).grade).toBe('no_evidence');
  });

  test('the agent\'s evidence passes: the output is grounded, the citation and the judgement wait on Sam', async () => {
    fs.mkdirSync(at('out'), { recursive: true });
    fs.writeFileSync(at('out/summary.md'), '# Q3\nEMEA 120, APAC 80.\n');
    const out = (JSON.parse((await agent.callTool('record_artefact', { item_uid: item, path: 'out/summary.md', role: 'output' })).text) as { attachment_uid: string }).attachment_uid;
    for (const [uid, evidence] of [[cite, [{ attachment_uid: ledgerUid, locator: { range: 'B2' } }]], [summary, [{ attachment_uid: out }]]] as const) {
      const r = await agent.callTool('submit_criterion', { criterion_uid: uid, evidence });
      expect(r.isError, r.text).toBeFalsy();
    }
    const g = await line();
    expect(g.words).toBe('3 criteria · 1 grounded · 2 waiting on a person');
    expect(gradeOf(g, cite)).toMatchObject({ grade: 'waiting', why: 'its checks pass; a person decides' });
    expect(gradeOf(g, summary).grade).toBe('grounded');
  });

  test('Sam approves: all grounded', async () => {
    for (const uid of [cite, judge]) {
      if (uid === judge) await agent.callTool('submit_criterion', { criterion_uid: judge, note: 'Read it aloud: fine' });
      expect((await h.client.raw('POST', `/api/criteria/${uid}/decide`, { decision: 'approved' })).status).toBe(200);
    }
    const g = await line();
    expect(g.words).toBe('3 criteria · all grounded');
    expect(g.grounded).toBe(true);
  });

  test('the ledger changes under an approval: changed since; the summary found older than the work: failing', async () => {
    fs.writeFileSync(at('data/ledger.csv'), 'region,revenue\nEMEA,125\nAPAC,80\n');
    let g = await line();
    expect(g.words).toBe('3 criteria · 2 grounded · 1 changed since');
    expect(gradeOf(g, cite)).toMatchObject({ grade: 'changed', why: 'a file it was approved on has changed since' });

    const old = new Date(Date.now() - 7 * 86_400_000);
    fs.utimesSync(at('out/summary.md'), old, old);
    g = await line();
    expect(g.words).toBe('3 criteria · 1 grounded · 1 changed since · 1 failing');
    expect(gradeOf(g, summary)).toMatchObject({ grade: 'failing' });
    expect(gradeOf(g, summary).why).toMatch(/before this item started/);
    expect(g.grounded).toBe(false);
  });

  test('a task with no criteria has no line; an unknown task is not found', async () => {
    const bare = ((await (await h.client.raw('POST', `/api/plans/${(await h.client.raw('GET', `/api/items/${item}`).then((r) => r.json()) as { planUid: string }).planUid}/items`, { kind: 'action', title: 'Book the room' })).json()) as { uid: string }).uid;
    const g = (await (await h.client.raw('GET', `/api/items/${bare}/grounding`)).json()) as Grounding;
    expect(g).toMatchObject({ words: null, total: 0 });
    expect(JSON.parse((await agent.callTool('get_brief', { item_uid: bare })).text).grounding).toBeNull();
    expect((await h.client.raw('GET', '/api/items/no-such-item/grounding')).status).toBe(404);
  });
});
