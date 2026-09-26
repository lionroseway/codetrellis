/**
 * Attaching a code reference to an Action (Phase 32 §0.4c, bug 21).
 *
 * The inspector's "Add to plan" (select lines in the code view) was built
 * on V1 tasks. On a V2 plan it listed no tasks at all, and what it created
 * was a V1 task the workspace never shows — the reference went nowhere.
 * `POST /api/items/:uid/code-reference` is its V2 target. The proof it
 * landed somewhere a person will see is the plan overlay on that file.
 */

import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { setupHarness, openEventStream, type Harness, type EventStream } from '../harness';

const FILE = 'packages/shared/src/validators.ts';

interface Item {
  uid: string;
  fileSpecs: Array<{ path: string; action: string; edits?: Array<{ lineRange?: { start: number; end: number }; instruction: string }> }>;
}

test.describe.serial('Code references on Actions', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let events: EventStream;
  let planUid: string;
  let actionUid: string;

  const attach = (uid: string, body: Record<string, unknown>) =>
    h.client.raw('POST', `/api/items/${uid}/code-reference`, body);

  test.beforeAll(async () => {
    h = await setupHarness('code-reference');
    await h.client.scanProject(h.fixture.projectPath);
    events = await openEventStream(h.backend);
    const plan = await h.client.createPlan({ title: 'Refs', projectPath: h.fixture.projectPath });
    planUid = plan.uid;
    const res = await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Tighten validation' });
    actionUid = ((await res.json()) as Item).uid;
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  test('the first reference to a file adds a file spec with that line range', async () => {
    const res = await attach(actionUid, { filePath: FILE, startLine: 5, endLine: 7, note: 'Reject empty emails', codeSnippet: 'export function isValidEmail' });
    expect(res.ok, await res.clone().text()).toBe(true);
    const item = (await res.json()) as Item;
    const spec = item.fileSpecs.find((s) => s.path === FILE)!;
    expect(spec.action).toBe('modify');
    expect(spec.edits).toHaveLength(1);
    expect(spec.edits![0].lineRange).toEqual({ start: 5, end: 7 });
    expect(spec.edits![0].instruction).toContain('Reject empty emails');
    expect(spec.edits![0].instruction).toContain('export function isValidEmail');
    await events.waitFor('plan-item-updated', (p) => p.itemUid === actionUid);
  });

  test('a second reference to the same file appends to that spec', async () => {
    const res = await attach(actionUid, { filePath: FILE, startLine: 9, endLine: 9 });
    const item = (await res.json()) as Item;
    expect(item.fileSpecs.filter((s) => s.path === FILE)).toHaveLength(1);
    const edits = item.fileSpecs.find((s) => s.path === FILE)!.edits!;
    expect(edits.map((e) => e.lineRange)).toEqual([{ start: 5, end: 7 }, { start: 9, end: 9 }]);
    expect(edits[1].instruction).toBe(`See ${FILE}:9`);
  });

  test('the reference shows in the code overlay of that file', async () => {
    const abs = path.join(h.fixture.projectPath, FILE);
    const res = await h.client.raw('GET', `/api/file/overlay?path=${encodeURIComponent(abs)}&project=${encodeURIComponent(h.fixture.projectPath)}`);
    const overlay = (await res.json()) as { markers: Array<{ itemUid: string; startLine: number | null; endLine: number | null }> };
    const mine = overlay.markers.filter((m) => m.itemUid === actionUid);
    expect(mine.map((m) => [m.startLine, m.endLine])).toEqual(expect.arrayContaining([[5, 7], [9, 9]]));
  });

  test('refuses what it cannot attach', async () => {
    for (const [body, why] of [
      [{ startLine: 1 }, 'no path'],
      [{ filePath: '/etc/passwd', startLine: 1 }, 'absolute path'],
      [{ filePath: FILE, startLine: 0 }, 'line 0'],
      [{ filePath: FILE, startLine: 9, endLine: 3 }, 'end before start'],
      [{ filePath: FILE, startLine: 'x' }, 'not a number'],
    ] as const) {
      expect((await attach(actionUid, body)).status, why).toBe(400);
    }
    expect((await attach('no-such-item', { filePath: FILE, startLine: 1 })).status).toBe(404);

    const obj = await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'A goal' });
    const objectUid = ((await obj.json()) as Item).uid;
    expect((await attach(objectUid, { filePath: FILE, startLine: 1 })).status).toBe(400);
  });
});
