/**
 * Item-as-context regression tests (formerly Phase 14 §A "task-as-context").
 *
 * An agent should get everything it needs about a piece of work in one
 * round-trip, and that context should survive every path it travels:
 * MCP, REST, and a plan export → import through git.
 *
 * Rewritten onto V2 plan_items for Phase 32 §0.3b. The V1 file drove
 * tools the V2 migration removed (claim_task, add_subtask, update_task,
 * add_task_attachment, …; docs/V2-MCP-MIGRATION.md §6). Its header said
 * plan-items.test.ts covered the V2 equivalents — checked scenario by
 * scenario, three of seven were covered there and four were not:
 *
 *   covered in plan-items.test.ts          covered here
 *   ─────────────────────────────          ─────────────────────────────
 *   progress + blocked + comment kinds     claim_item returns full context
 *   mixed Object/Action trees              child Action context + url
 *   tool registry                            attachment + update file specs
 *                                          export → import round-trip
 *                                          REST endpoints match MCP
 *
 * No real LLM. No API keys. Fully offline.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { setupHarness, type Harness } from '../harness';
import type { ScriptedAgent } from '../harness/scripted-agent';

interface ItemJson {
  uid: string;
  planUid: string;
  kind: string;
  title: string;
  status: string | null;
  body?: string | null;
  scopePath?: string | null;
  fileSpecs?: Array<{ path: string; action: string; description?: string }>;
  parentUid?: string | null;
  progressPercent?: number | null;
  blockedReason?: string | null;
}

interface ContextJson {
  ok?: boolean;
  item: ItemJson;
  parent: ItemJson | null;
  children: ItemJson[];
  attachments: Array<{ kind: string; value: string; label?: string | null }>;
  comments: Array<{ kind: string; body: string; metadata?: { progressPercent?: number } | null }>;
  criteria: unknown[];
}

function json<T>(text: string): T {
  return JSON.parse(text) as T;
}

async function addItem(agent: ScriptedAgent, args: Record<string, unknown>): Promise<ItemJson> {
  const res = await agent.callTool('add_item', args);
  expect(res.isError, res.text).not.toBe(true);
  return json<ItemJson>(res.text);
}

async function newPlan(h: Harness, title: string): Promise<string> {
  const plan = await h.client.createPlan({ title, projectPath: h.fixture.projectPath });
  return plan.uid;
}

test.describe('Item as context (V2)', () => {
  test.setTimeout(120_000);

  test('claim_item returns the full context of a rich Action in one round-trip', async () => {
    const h = await setupHarness('task-context-claim-full');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-claim' });
      const planUid = await newPlan(h, 'Rich plan');

      const action = await addItem(agent, {
        plan_uid: planUid,
        kind: 'action',
        title: 'Build the login form',
        body: '## Why\nUsers need to log in.\n\n## Approach\nStandard email + password.',
        scope_path: 'packages/web/src/',
        file_specs: [
          { path: 'auth/LoginForm.tsx', action: 'create', description: 'New form component' },
          { path: 'api.ts', action: 'modify' },
        ],
      });

      // The stored Action carries every rich field.
      expect(action.body).toContain('## Why');
      expect(action.scopePath).toBe('packages/web/src/');
      expect(action.fileSpecs).toEqual([
        { path: 'auth/LoginForm.tsx', action: 'create', description: 'New form component' },
        { path: 'api.ts', action: 'modify' },
      ]);

      // claim_item hands the agent the whole context, not just an ack.
      const claim = await agent.claimItem(action.uid);
      expect(claim.isError).not.toBe(true);
      const ctx = json<ContextJson>(claim.text);
      expect(ctx.ok).toBe(true);
      expect(ctx.item.uid).toBe(action.uid);
      expect(ctx.item.body).toContain('## Why');
      expect(ctx.item.fileSpecs).toHaveLength(2);
      expect(ctx.parent).toBeNull();
      expect(ctx.children).toEqual([]);
      expect(ctx.attachments).toEqual([]);
      expect(ctx.comments).toEqual([]);
      expect(Array.isArray(ctx.criteria)).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('a child Action sees its parent; url attachments and file-spec updates round-trip', async () => {
    const h = await setupHarness('task-context-child-attach');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-child' });
      const planUid = await newPlan(h, 'Tree plan');

      const parent = await addItem(agent, { plan_uid: planUid, kind: 'object', title: 'Auth' });
      const child = await addItem(agent, {
        plan_uid: planUid,
        kind: 'action',
        parent_uid: parent.uid,
        title: 'Session refresh',
      });
      expect(child.parentUid).toBe(parent.uid);

      // A URL attachment: recorded, no disk write.
      const att = await agent.callTool('add_item_attachment', {
        uid: child.uid,
        kind: 'url',
        value: 'https://example.com/design',
        label: 'Design',
      });
      expect(att.isError, att.text).not.toBe(true);

      // update_item sets file specs after the fact.
      const upd = await agent.callTool('update_item', {
        uid: child.uid,
        file_specs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
      });
      expect(upd.isError, upd.text).not.toBe(true);

      const claim = await agent.claimItem(child.uid);
      const ctx = json<ContextJson>(claim.text);
      expect(ctx.ok).toBe(true);
      expect(ctx.parent?.uid).toBe(parent.uid);
      expect(ctx.item.fileSpecs).toEqual([{ path: 'packages/web/src/api.ts', action: 'modify' }]);
      expect(ctx.attachments).toHaveLength(1);
      expect(ctx.attachments[0]).toMatchObject({ kind: 'url', value: 'https://example.com/design', label: 'Design' });
    } finally {
      await h.teardown();
    }
  });

  test('plan export → import round-trips body, file specs, attachments, comments and progress', async () => {
    const h = await setupHarness('task-context-export-roundtrip');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-export' });
      const planUid = await newPlan(h, 'Export plan');

      const action = await addItem(agent, {
        plan_uid: planUid,
        kind: 'action',
        title: 'Portable work',
        body: 'Body text',
        scope_path: 'src/',
        file_specs: [{ path: 'a.ts', action: 'create' }],
      });
      await agent.callTool('add_item_attachment', { uid: action.uid, kind: 'url', value: 'https://example.com/ref' });
      await agent.callTool('add_item_comment', { uid: action.uid, kind: 'note', body: 'A note' });
      const prog = await agent.callTool('update_item_progress', { uid: action.uid, percent: 33, message: 'A third' });
      expect(prog.isError, prog.text).not.toBe(true);

      // Export writes one YAML per item under items/.
      const exported = await h.client.exportPlan(planUid, h.fixture.projectPath);
      const itemsDir = path.join(exported.planDir, 'items');
      const files = fs.readdirSync(itemsDir).filter((f) => f.endsWith('.yaml'));
      expect(files).toHaveLength(1);
      const parsed = yaml.parse(fs.readFileSync(path.join(itemsDir, files[0]), 'utf-8'));
      expect(parsed.uid).toBe(action.uid);
      expect(parsed.body).toBe('Body text');
      expect(parsed.scopePath).toBe('src/');
      expect(parsed.fileSpecs).toEqual([{ path: 'a.ts', action: 'create' }]);
      expect(parsed.progressPercent).toBe(33);
      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].value).toBe('https://example.com/ref');
      const kinds = parsed.comments.map((c: { kind: string }) => c.kind);
      expect(kinds).toContain('note');
      expect(kinds).toContain('progress');
      const progressComment = parsed.comments.find((c: { kind: string }) => c.kind === 'progress');
      expect(progressComment.metadata?.progressPercent).toBe(33);

      // Re-import, as a teammate pulling the plan would: copy it aside
      // (unlink wipes the dir), drop the plan, put the files back where git
      // would — inside the project's .codetrellis/plans/ — and import them.
      // Imports are confined to plan dirs of opened projects (Phase 19), so
      // importing straight from the temp copy is correctly refused.
      const transitDir = path.join(h.fixture.tmpDir, 'plan-transit-v2');
      fs.cpSync(exported.planDir, transitDir, { recursive: true });
      await h.client.unlinkPlan(planUid, h.fixture.projectPath);
      await h.client.raw('DELETE', `/api/plans/${planUid}`);
      fs.cpSync(transitDir, exported.planDir, { recursive: true });

      const reimported = await h.client.importPlan(exported.planDir);
      expect(reimported.plan.uid).toBe(planUid);
      const fullRes = await h.client.raw('GET', `/api/items/${action.uid}/full`);
      expect(fullRes.ok).toBe(true);
      const full = (await fullRes.json()) as ContextJson;
      expect(full.item.body).toBe('Body text');
      expect(full.item.scopePath).toBe('src/');
      expect(full.item.fileSpecs).toEqual([{ path: 'a.ts', action: 'create' }]);
      expect(full.item.progressPercent).toBe(33);
      expect(full.attachments.map((a) => a.value)).toContain('https://example.com/ref');
      expect(full.comments.map((c) => c.kind)).toEqual(expect.arrayContaining(['note', 'progress']));
    } finally {
      await h.teardown();
    }
  });

  test('REST item endpoints round-trip the same way the MCP tools do', async () => {
    const h = await setupHarness('task-context-rest');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-rest' });
      const planUid = await newPlan(h, 'REST plan');
      const action = await addItem(agent, { plan_uid: planUid, kind: 'action', title: 'Through REST' });

      const comment = await h.client.raw('POST', `/api/items/${action.uid}/comments`, {
        kind: 'question',
        body: 'Redirect to /home or /dashboard?',
      });
      expect(comment.ok).toBe(true);

      const progress = await h.client.raw('POST', `/api/items/${action.uid}/progress`, { percent: 50, message: 'Half' });
      expect(progress.ok).toBe(true);

      const attach = await h.client.raw('POST', `/api/items/${action.uid}/attachments`, {
        kind: 'url',
        value: 'https://example.com/spec',
      });
      expect(attach.ok).toBe(true);

      const blocked = await h.client.raw('POST', `/api/items/${action.uid}/blocked`, { reason: 'Waiting on copy.' });
      expect(blocked.ok).toBe(true);

      // What REST wrote, MCP reads — and the other way round.
      const viaMcp = json<ContextJson>((await agent.callTool('read_item_full', { uid: action.uid })).text);
      expect(viaMcp.item.status).toBe('blocked');
      expect(viaMcp.item.blockedReason).toBe('Waiting on copy.');
      expect(viaMcp.item.progressPercent).toBe(50);
      expect(viaMcp.comments.map((c) => c.kind)).toEqual(expect.arrayContaining(['question', 'progress']));
      expect(viaMcp.attachments.map((a) => a.value)).toContain('https://example.com/spec');

      await agent.callTool('add_item_comment', { uid: action.uid, kind: 'note', body: 'From MCP' });
      const listRes = await h.client.raw('GET', `/api/items/${action.uid}/comments`);
      expect(listRes.ok).toBe(true);
      const listed = (await listRes.json()) as Array<{ body: string }>;
      expect(listed.map((c) => c.body)).toContain('From MCP');

      // Validation is the same shape on both sides: bad input is refused.
      const badProgress = await h.client.raw('POST', `/api/items/${action.uid}/progress`, { percent: 150 });
      expect(badProgress.status).toBe(400);
      const noReason = await h.client.raw('POST', `/api/items/${action.uid}/blocked`, {});
      expect(noReason.status).toBe(400);
    } finally {
      await h.teardown();
    }
  });
});
