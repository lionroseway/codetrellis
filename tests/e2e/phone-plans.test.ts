/**
 * Plans from the phone, over the real peer path (Phase 32 §0.4j).
 *
 * A paired phone (tests/harness/peer.ts) reads and edits plans, items,
 * comments, links, deviations, templates and plan files through the RPC
 * methods the mobile app calls. None of these had a test before 0.4j.
 *
 * Besides what each returns, this checks the companion-app rule: what a
 * person does on the phone shows up on the desktop. The desktop window
 * learns of a change only from a broadcast, so each edit is checked for the
 * same event the desktop's own route sends.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, openEventStream, pairPhone, type Harness, type Phone, type EventStream } from '../harness';

test.describe.serial('Plans from the phone', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let phone: Phone;
  let events: EventStream;
  let root: string;
  let planUid: string;
  let itemUid: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };

  test.beforeAll(async () => {
    h = await setupHarness('phone-plans');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    events = await openEventStream(h.backend);
    phone = await pairPhone(h.client, { alias: 'Plans phone' });
  });

  test.afterAll(async () => {
    await phone?.close();
    await events?.close();
    await h?.teardown();
  });

  test('plan.create makes a plan in the open project, as the person, and the desktop is told', async () => {
    const plan = await phone.rpc('plan.create', { title: 'Phone plan', description: 'Made on the phone' });
    planUid = plan.uid;
    expect(plan).toMatchObject({ title: 'Phone plan', projectPath: root });
    await events.waitFor('plan-created', (p) => p.plan?.uid === planUid);

    const listed = (await phone.rpc('plan.list')).find((p: { uid: string }) => p.uid === planUid);
    expect(listed).toMatchObject({ title: 'Phone plan', itemCount: 0, doneCount: 0, projectPath: root });
    expect((await phone.rpc('plan.list', { projectPath: root })).map((p: { uid: string }) => p.uid)).toContain(planUid);
    // A path that is not an opened project is refused, not used as a filter.
    expect(await phone.rpcError('plan.list', { projectPath: '/etc' })).toMatch(/not|trusted|opened/i);
    expect(await phone.rpcError('plan.create', {})).toMatch(/title/);
  });

  test('plan.update changes what the desktop shows, and refuses a status there is no such thing as', async () => {
    expect(await phone.rpc('plan.update', { uid: planUid, title: 'Phone plan, renamed', description: 'Edited' })).toEqual({ ok: true });
    await events.waitFor('plan-updated', (p) => p.planUid === planUid);
    expect(await req('GET', `/api/plans/${planUid}`)).toMatchObject({ title: 'Phone plan, renamed', description: 'Edited' });

    expect(await phone.rpcError('plan.update', { uid: planUid, status: 'finished-ish' })).toMatch(/status/);
    expect((await req('GET', `/api/plans/${planUid}`)).status).toBe('draft');
    expect(await phone.rpcError('plan.update', { uid: 'no-such-plan', title: 'x' })).toMatch(/Plan not found/);
  });

  test('items: create, read, update; each reaches the desktop, and nonsense is refused', async () => {
    const item = await phone.rpc('plan.item.create', { planUid, title: 'Wire the cache', kind: 'action', body: 'From the phone' });
    itemUid = item.uid;
    expect(item).toMatchObject({ planUid, title: 'Wire the cache', kind: 'action', authorType: 'human' });
    await events.waitFor('plan-item-created', (p) => p.item?.uid === itemUid);

    const got = await phone.rpc('plan.item.get', { uid: itemUid });
    expect(got.item).toMatchObject({ uid: itemUid, body: 'From the phone' });
    expect(got).toMatchObject({ comments: [], externalRefs: [], attachments: [] });

    const updated = await phone.rpc('plan.item.update', { uid: itemUid, status: 'in_progress', progressPercent: 40 });
    expect(updated).toMatchObject({ status: 'in_progress', progressPercent: 40 });
    await events.waitFor('plan-item-updated', (p) => p.itemUid === itemUid);
    expect((await phone.rpc('plan.items', { planUid })).map((i: { uid: string; status: string }) => [i.uid, i.status])).toEqual([[itemUid, 'in_progress']]);

    expect(await phone.rpcError('plan.item.update', { uid: itemUid, status: 'sort-of-done' })).toMatch(/status/);
    expect(await phone.rpcError('plan.item.update', { uid: 'no-such-item', title: 'x' })).toMatch(/Item not found/);
    expect(await phone.rpcError('plan.item.create', { planUid: 'no-such-plan', title: 'x' })).toMatch(/Plan not found/);
    expect(await phone.rpcError('plan.items', { planUid: 'no-such-plan' })).toMatch(/Plan not found/);
    expect(await phone.rpcError('plan.item.get', { uid: 'no-such-item' })).toMatch(/Item not found/);
  });

  test('plan.get carries what the desktop has; plan.nextItem and plan.copyAsPrompt agree with it', async () => {
    const doc = await req('POST', `/api/plans/${planUid}/docs`, { docType: 'spec', title: 'Cache spec', body: '# Cache\n\nKeep it small.' });
    const got = await phone.rpc('plan.get', { uid: planUid });
    expect(got.plan).toMatchObject({ uid: planUid, title: 'Phone plan, renamed' });
    expect(got.items.map((i: { uid: string }) => i.uid)).toEqual([itemUid]);
    expect(got.documents.map((d: { uid: string }) => d.uid)).toEqual([doc.uid]);
    expect(got).toMatchObject({ deviations: [], externalRefs: [], comments: [] });
    expect(await phone.rpcError('plan.get', { uid: 'no-such-plan' })).toMatch(/Plan not found/);

    expect(await phone.rpc('plan.document', { docUid: doc.uid })).toMatchObject({ title: 'Cache spec', body: '# Cache\n\nKeep it small.' });
    expect(await phone.rpcError('plan.document', { docUid: 'no-such-doc' })).toMatch(/Document not found/);

    // Nothing is next while the only item is in progress; a pending one is.
    expect(await phone.rpc('plan.nextItem', { planUid })).toEqual({ none: true });
    const pending = await phone.rpc('plan.item.create', { planUid, title: 'Add eviction' });
    const next = await phone.rpc('plan.nextItem', { planUid });
    expect(next).toEqual(await req('GET', `/api/plans/${planUid}/next-task`));
    expect(JSON.stringify(next)).toContain(pending.uid);

    const { prompt } = await phone.rpc('plan.copyAsPrompt', { uid: planUid });
    expect(prompt).toContain('Phone plan, renamed');
    // A handoff prompt lists the work nobody has started, not what is under way.
    expect(prompt).toContain('### Add eviction');
    expect(prompt).not.toContain('Wire the cache');
    expect(await phone.rpcError('plan.copyAsPrompt', { uid: 'no-such-plan' })).toMatch(/Plan not found/);
  });

  test('comment.add: on an item, the desktop\'s item thread hears it; on a plan, the plan\'s', async () => {
    const onItem = await phone.rpc('comment.add', { targetType: 'item', targetUid: itemUid, body: 'Looks right from here' });
    expect(onItem).toMatchObject({ targetUid: itemUid, authorType: 'human', body: 'Looks right from here' });
    await events.waitFor('plan-item-comment-added', (p) => p.itemUid === itemUid && p.comment?.uid === onItem.uid);
    expect((await req('GET', `/api/items/${itemUid}/comments`)).map((c: { uid: string }) => c.uid)).toContain(onItem.uid);

    const onPlan = await phone.rpc('comment.add', { targetType: 'plan', targetUid: planUid, body: 'Ship it Friday' });
    await events.waitFor('comment-added', (p) => p.comment?.uid === onPlan.uid);
    expect((await phone.rpc('plan.get', { uid: planUid })).comments.map((c: { uid: string }) => c.uid)).toContain(onPlan.uid);

    expect(await phone.rpcError('comment.add', { targetType: 'item', targetUid: 'no-such-item', body: 'x' })).toMatch(/not found/i);
    expect(await phone.rpcError('comment.add', { targetType: 'item', targetUid: itemUid })).toMatch(/body/);
  });

  test('item.ref.add and item.ref.remove: a link on the item, and the desktop sees both', async () => {
    const ref = await phone.rpc('item.ref.add', { itemUid, url: 'https://github.com/o/r/pull/7', title: 'The PR' });
    expect(ref).toMatchObject({ itemUid, url: 'https://github.com/o/r/pull/7', title: 'The PR' });
    await events.waitFor('external-ref-added', (p) => p.ref?.uid === ref.uid);
    expect((await phone.rpc('plan.item.get', { uid: itemUid })).externalRefs.map((r: { uid: string }) => r.uid)).toEqual([ref.uid]);

    expect(await phone.rpc('item.ref.remove', { uid: ref.uid })).toEqual({ ok: true });
    await events.waitFor('external-ref-deleted', (p) => p.uid === ref.uid);
    expect(await req('GET', `/api/items/${itemUid}/refs`)).toEqual([]);

    expect(await phone.rpcError('item.ref.remove', { uid: ref.uid })).toMatch(/not found/i);
    expect(await phone.rpcError('item.ref.add', { itemUid: 'no-such-item', url: 'https://x.test' })).toMatch(/not found/i);
  });

  test('deviations: listed as the desktop lists them, resolved as the person on the phone', async () => {
    await req('POST', `/api/plans/${planUid}/items`, {
      kind: 'action', title: 'Create the cache', status: 'done', fileSpecs: [{ path: 'packages/web/src/cache.ts', action: 'create' }],
    });
    const agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    await agent.callTool('detect_deviations', { plan_uid: planUid });
    const listed = await phone.rpc('deviation.list', { planUid });
    expect(listed).toEqual(await req('GET', `/api/plans/${planUid}/deviations`));
    expect(listed.map((d: { deviationType: string; resolution: string }) => [d.deviationType, d.resolution])).toEqual([['missing_file', 'pending']]);

    expect(await phone.rpcError('deviation.resolve', { id: listed[0].id, resolution: 'whatever' })).toMatch(/not one of accepted, reverted, ignored/);
    expect(await phone.rpcError('deviation.resolve', { id: 999_999, resolution: 'ignored' })).toMatch(/No deviation/);
    expect(await phone.rpc('deviation.resolve', { id: listed[0].id, resolution: 'ignored' })).toEqual({ ok: true });
    const [after] = await phone.rpc('deviation.list', { planUid });
    expect(after).toMatchObject({ resolution: 'ignored', resolvedByType: 'human' });
    expect(await phone.rpcError('deviation.list', { planUid: 'no-such-plan' })).toMatch(/Plan not found/);
  });

  test('templates: listed as the desktop lists them, and a plan made from one', async () => {
    const templates = await phone.rpc('plan.template.list');
    expect(templates.map((t: { id: string }) => t.id)).toEqual((await h.client.listTemplates(root)).map((t: { id: string }) => t.id));
    expect(templates.map((t: { id: string }) => t.id)).toContain('bug-fix');

    const made = await phone.rpc('plan.template.create', { templateId: 'bug-fix', title: 'Fix the login loop' });
    expect(made.plan).toMatchObject({ title: 'Fix the login loop', projectPath: root });
    expect(made.itemCount).toBeGreaterThan(0);
    await events.waitFor('plan-created', (p) => p.uid === made.plan.uid || p.plan?.uid === made.plan.uid);
    expect(await phone.rpcError('plan.template.create', { templateId: 'no-such-template' })).toMatch(/template/i);
  });

  test('plan files: export writes the plan into the project, discover finds it, import reads it back', async () => {
    const exported = await phone.rpc('plan.file.export', { planUid });
    expect(exported.fileCount).toBeGreaterThan(0);
    expect(path.relative(root, exported.planDir).startsWith(path.join('.codetrellis', 'plans'))).toBe(true);
    expect(fs.existsSync(path.join(exported.planDir, 'plan.yaml'))).toBe(true);

    const found = await phone.rpc('plan.file.discover');
    const mine = found.find((d: { dir: string }) => path.resolve(d.dir) === path.resolve(exported.planDir));
    expect(mine).toBeTruthy();
    expect(mine.name).toBe(path.basename(exported.planDir));

    const imported = await phone.rpc('plan.file.import', { planDir: exported.planDir });
    expect(imported.plan?.uid).toBe(planUid);
    expect(await phone.rpcError('plan.file.import', { planDir: '/etc' })).toMatch(/not|trusted|opened|outside/i);
    expect(await phone.rpcError('plan.file.export', { planUid: 'no-such-plan' })).toMatch(/not found/i);
  });

  test('plan.delete: the desktop hears it, the plan\'s files leave the project like a delete on the desktop', async () => {
    const dir = (await phone.rpc('plan.file.discover')).find((d: { dir: string }) => fs.existsSync(path.join(d.dir, 'plan.yaml'))
      && fs.readFileSync(path.join(d.dir, 'plan.yaml'), 'utf-8').includes(planUid)).dir;

    expect(await phone.rpc('plan.delete', { uid: planUid })).toMatchObject({ ok: true });
    await events.waitFor('plan-deleted', (p) => p.planUid === planUid);
    expect((await req('GET', `/api/plans/${planUid}`)).status).toBe('archived');
    await expect.poll(() => fs.existsSync(dir), { timeout: 5000 }).toBe(false);
    // And it stays gone. Archiving schedules the plan's write-through, which
    // fired 200 ms after the folder was removed and wrote it back — with
    // `status: archived` — into the repository (bug 39).
    await new Promise((r) => setTimeout(r, 1500));
    expect(fs.existsSync(dir), 'the deleted plan\'s folder came back').toBe(false);
    expect(await phone.rpcError('plan.delete', { uid: 'no-such-plan' })).toMatch(/Plan not found/);
  });

  test('a phone without write may read plans but change nothing', async () => {
    await phone.grant(['read']);
    try {
      expect((await phone.rpc('plan.list')).length).toBeGreaterThan(0);
      for (const [method, params] of [
        ['plan.create', { title: 'x' }],
        ['plan.update', { uid: planUid, title: 'x' }],
        ['plan.item.create', { planUid, title: 'x' }],
        ['comment.add', { targetUid: itemUid, body: 'x' }],
        ['plan.delete', { uid: planUid }],
      ] as const) {
        expect(await phone.rpcError(method, params), method).toMatch(/does not hold the "write" capability/);
      }
    } finally {
      await phone.grant(['read', 'write', 'project', 'files']);
    }
  });
});
