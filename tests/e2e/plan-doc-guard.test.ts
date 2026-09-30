/**
 * Phase 32 B7.5b — legacy plan documents are guarded like pages (JOURNEYS I1).
 *
 * A legacy plan keeps its spec as documents, written to
 * `.codetrellis/plans/<slug>/docs/*.md`. An agent changes one by editing that
 * file, which nothing can pause, so the guard holds the import instead. Sam
 * guards "Invoice format" with a spec breakpoint over REST (`docUid`). The
 * file is edited: the app keeps its version and the inbox shows "changed on
 * disk" with both versions. Continue applies the file's version, as Sam.
 * Edited again and stopped: the app's version stays, and the file is written
 * back. An unguarded document is imported as it always was.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n';
const NOTE = 'Invoices go to the tax office; ask me first.';

interface Doc { uid: string; title: string; body: string; version: number }
interface Hit {
  ref: string; kind: string; action: string; itemUid: string; itemTitle: string | null; agent: string | null; breakpointNote: string | null;
  diskChange?: { beforeTitle: string; afterTitle: string; before: string; after: string } | null; answeredAt: number | null;
}

test.describe.serial('A guarded plan document edited on disk', () => {
  let h: Harness;
  let plan: string;
  let guarded: Doc;
  let open: Doc;
  let files: string[];

  const get = async <T>(url: string) => (await (await h.client.raw('GET', url)).json()) as T;
  const doc = (uid: string) => get<Doc>(`/api/plan-docs/${uid}`);
  const fileOf = (d: Doc) => files.find((f) => f.includes(`${path.sep}docs${path.sep}`) && fs.readFileSync(f, 'utf-8').includes(`uid: ${d.uid}`))!;
  const editFile = (d: Doc, from: string, to: string) => {
    const f = fileOf(d);
    const text = fs.readFileSync(f, 'utf-8');
    expect(text).toContain(from);
    fs.writeFileSync(f, text.replace(from, to));
  };
  const waitingDisk = async (uid: string) => {
    let found: Hit | undefined;
    await expect.poll(async () => {
      found = (await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits.find((x) => x.action === 'disk' && x.itemUid === uid);
      return !!found;
    }, { timeout: 15_000 }).toBe(true);
    return found!;
  };

  test.beforeAll(async () => {
    h = await setupHarness('plan-doc-guard');
    await h.client.scanProject(h.fixture.projectPath);
    plan = (await h.client.createPlan({ title: 'Invoicing (legacy)', projectPath: h.fixture.projectPath })).uid;
    const mk = async (title: string, body: string) =>
      (await (await h.client.raw('POST', `/api/plans/${plan}/docs`, { docType: 'custom', title, body })).json()) as Doc;
    guarded = await mk('Invoice format', BODY);
    open = await mk('Glossary', '# Glossary\n\n- invoice\n');
    const exported = await (await h.client.raw('POST', `/api/plans/${plan}/export?path=${encodeURIComponent(h.fixture.projectPath)}`)).json();
    files = exported.files as string[];
    expect(fileOf(guarded)).toBeTruthy();
    // Linking the plan schedules one more write-through export of it; an
    // edit made before that lands would be overwritten, as any would be.
    // Wait until the plan's files have been still for a moment.
    let last = '';
    await expect.poll(() => {
      const now = files.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join('|');
      const still = now === last;
      last = now;
      return still;
    }, { timeout: 10_000, intervals: [700] }).toBe(true);
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('a spec breakpoint is set on a document over REST, its plan from the document', async () => {
    const res = await h.client.raw('POST', '/api/breakpoints', { kind: 'spec', docUid: guarded.uid, note: NOTE, planUid: 'not-this-one' });
    expect(res.status).toBe(201);
    const { breakpoint } = (await res.json()) as { breakpoint: { target: string; targetTitle: string; planUid: string } };
    expect(breakpoint).toMatchObject({ target: guarded.uid, targetTitle: 'Invoice format', planUid: plan });
    expect((await h.client.raw('POST', '/api/breakpoints', { kind: 'task', docUid: guarded.uid })).status).toBe(400);
    expect((await h.client.raw('POST', '/api/breakpoints', { kind: 'spec', docUid: 'no-such-doc' })).status).toBe(404);
  });

  test('the file edited: the app keeps its version, and the inbox shows both', async () => {
    editFile(guarded, '- amount\n', '- amount\n- currency\n');
    const hit = await waitingDisk(guarded.uid);
    expect(hit).toMatchObject({ kind: 'spec', itemTitle: 'Invoice format', agent: null, breakpointNote: NOTE, answeredAt: null });
    expect(hit.diskChange).toEqual({ beforeTitle: 'Invoice format', afterTitle: 'Invoice format', before: BODY, after: `${BODY}- currency\n` });
    expect((await doc(guarded.uid)).body).toBe(BODY);

    // Edited again while it waits: one entry, showing the file as it is now.
    editFile(guarded, '- currency\n', '- currency (ISO 4217)\n');
    await expect.poll(async () => (await waitingDisk(guarded.uid)).diskChange?.after, { timeout: 15_000 }).toBe(`${BODY}- currency (ISO 4217)\n`);
    const waiting = (await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits.filter((x) => x.action === 'disk');
    expect(waiting).toHaveLength(1);
    expect((await doc(guarded.uid)).body).toBe(BODY);
  });

  test('continue applies the file\'s version, as the person', async () => {
    const hit = await waitingDisk(guarded.uid);
    const before = (await doc(guarded.uid)).version;
    const res = await h.client.raw('POST', `/api/breakpoint-hits/${hit.ref}/answer`, { decision: 'continue' });
    expect(res.ok).toBe(true);
    const now = await doc(guarded.uid);
    expect(now.body).toBe(`${BODY}- currency (ISO 4217)\n`);
    expect(now.version).toBe(before + 1);
    const versions = await get<Array<{ version: number; author: string; authorType: string | null; changeSummary: string | null }>>(`/api/plan-docs/${guarded.uid}/versions`);
    const latest = versions.find((v) => v.version === now.version)!;
    expect(latest.authorType).toBe('unverified');
    expect(latest.changeSummary).toContain('applied from disk');
  });

  test('stop keeps the app\'s version and writes it back over the file', async () => {
    const kept = (await doc(guarded.uid)).body;
    editFile(guarded, '- currency (ISO 4217)\n', '- currency (ISO 4217)\n- tax id\n');
    const hit = await waitingDisk(guarded.uid);
    expect(hit.diskChange?.after).toContain('- tax id');
    expect((await h.client.raw('POST', `/api/breakpoint-hits/${hit.ref}/answer`, { decision: 'stop' })).ok).toBe(true);
    expect((await doc(guarded.uid)).body).toBe(kept);
    await expect.poll(() => fs.readFileSync(fileOf(guarded), 'utf-8').includes('- tax id'), { timeout: 15_000 }).toBe(false);
    expect(fs.readFileSync(fileOf(guarded), 'utf-8')).toContain(kept.trim());
    // Written back by us, it is not held again.
    await new Promise((r) => setTimeout(r, 1500));
    expect((await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits.filter((x) => x.action === 'disk')).toHaveLength(0);
  });

  test('an unguarded document is imported as it always was', async () => {
    editFile(open, '- invoice\n', '- invoice\n- ledger\n');
    await expect.poll(async () => (await doc(open.uid)).body, { timeout: 15_000 }).toBe('# Glossary\n\n- invoice\n- ledger\n');
    expect((await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits.filter((x) => x.action === 'disk')).toHaveLength(0);
  });
});
