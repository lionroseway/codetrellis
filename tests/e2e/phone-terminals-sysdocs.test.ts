/**
 * Terminals and system docs from the phone, over the real peer path
 * (Phase 32 §0.4j).
 *
 * Terminals are the one surface a new pairing does not get: `terminal` is
 * granted per device, it needs a pairing confirmed on the desktop, and every
 * call is written to the device audit trail (without the output). This checks
 * all three, and that the terminal methods do what the phone's terminal
 * screen relies on.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, openEventStream, pairPhone, type Harness, type Phone, type EventStream } from '../harness';

interface AuditEntry { kind: string; method: string; alias: string; detail: string }

test.describe.serial('Terminals and system docs from the phone', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let phone: Phone;
  let events: EventStream;
  let root: string;
  let term: { id: string };
  let docUid: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const audit = async () => (await req('GET', `/api/peers/audit?fingerprint=${encodeURIComponent(phone.fingerprint)}`)) as AuditEntry[] | { entries: AuditEntry[] };
  const auditEntries = async () => { const a = await audit(); return Array.isArray(a) ? a : a.entries; };

  test.beforeAll(async () => {
    h = await setupHarness('phone-terminals-sysdocs');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    events = await openEventStream(h.backend);
    phone = await pairPhone(h.client, { alias: 'Terminal phone' });
  });

  test.afterAll(async () => {
    await phone?.close();
    await events?.close();
    await h?.teardown();
  });

  // ── Terminals ────────────────────────────────────────────────────────

  test('without the terminal grant every terminal method is refused, and the refusal is audited', async () => {
    for (const method of ['terminal.list', 'terminal.create', 'terminal.write', 'terminal.read', 'terminal.stream', 'terminal.resize', 'terminal.kill', 'terminal.history']) {
      expect(await phone.rpcError(method, { id: 'x', data: 'x' }), method).toMatch(/does not hold the "terminal" capability/);
    }
    const refused = (await auditEntries()).filter((e) => e.kind === 'refused');
    expect(refused.map((e) => e.method)).toEqual(expect.arrayContaining(['terminal.list', 'terminal.write']));
    expect(refused[0].alias).toBe('Terminal phone');
  });

  test('granted: create opens a shell in the project and shows it on the desktop; list has it', async () => {
    await phone.grant(['read', 'write', 'project', 'files', 'terminal']);
    term = await phone.rpc('terminal.create', { preset: 'shell', title: 'From the phone' });
    expect(term).toMatchObject({ title: 'From the phone', alive: true, cwd: root });
    await events.waitFor('terminal-created', (p) => p.session?.id === term.id && p.focus === true);
    expect((await phone.rpc('terminal.list')).map((t: { id: string }) => t.id)).toContain(term.id);
  });

  test('write, then read, stream and history show the command ran', async () => {
    expect(await phone.rpc('terminal.write', { id: term.id, data: 'echo phone-$((6*7))\n' })).toEqual({ ok: true });
    await expect.poll(async () => (await phone.rpc('terminal.read', { id: term.id, lines: 50 })).output, { timeout: 15_000 }).toContain('phone-42');

    const all = await phone.rpc('terminal.stream', { id: term.id });
    expect(all).toMatchObject({ reset: true });
    expect(all.data).toContain('phone-42');
    // Nothing new since the end: an empty delta, not the whole buffer again.
    expect(await phone.rpc('terminal.stream', { id: term.id, since: all.total })).toEqual({ data: '', total: all.total, reset: false });
    await phone.rpc('terminal.write', { id: term.id, data: 'echo again-$((2+3))\n' });
    await expect.poll(async () => (await phone.rpc('terminal.stream', { id: term.id, since: all.total })).data, { timeout: 15_000 }).toContain('again-5');

    await expect.poll(async () => (await phone.rpc('terminal.history', { id: term.id })).data, { timeout: 5000 }).toContain('phone-42');
    const tail = await phone.rpc('terminal.history', { id: term.id, limit: 8 });
    expect(tail.data.length).toBeLessThanOrEqual(8);
    expect(tail.hasMore).toBe(true);
  });

  test('resize reaches the shell; a size that is not one, and a terminal that is not there, are refused', async () => {
    expect(await phone.rpc('terminal.resize', { id: term.id, cols: 44, rows: 30 })).toEqual({ ok: true });
    await phone.rpc('terminal.write', { id: term.id, data: 'echo cols-$(tput cols)\n' });
    await expect.poll(async () => (await phone.rpc('terminal.read', { id: term.id })).output, { timeout: 15_000 }).toContain('cols-44');
    for (const size of [{ cols: 0, rows: 30 }, { cols: 44.5, rows: 30 }, { cols: 44, rows: -1 }, { cols: '44', rows: 30 }, { cols: 100_000, rows: 30 }]) {
      expect(await phone.rpcError('terminal.resize', { id: term.id, ...size }), JSON.stringify(size)).toMatch(/cols must be a whole number/);
    }
    for (const method of ['terminal.write', 'terminal.read', 'terminal.resize', 'terminal.kill', 'terminal.stream']) {
      expect(await phone.rpcError(method, { id: 'no-such-terminal', data: 'x' }), method).toMatch(/Terminal not found/);
    }
  });

  test('every terminal call is in the audit trail, and the output is not', async () => {
    const access = (await auditEntries()).filter((e) => e.kind === 'terminal-access');
    expect(new Set(access.map((e) => e.method))).toEqual(new Set([
      'terminal.create', 'terminal.list', 'terminal.write', 'terminal.read', 'terminal.stream', 'terminal.history', 'terminal.resize', 'terminal.kill',
    ]));
    expect(JSON.stringify(access)).not.toContain('phone-42');
  });

  test('kill ends it for the phone and the desktop', async () => {
    expect(await phone.rpc('terminal.kill', { id: term.id })).toEqual({ ok: true });
    await events.waitFor('terminal-killed', (p) => p.id === term.id);
    const listed = (await phone.rpc('terminal.list')).find((t: { id: string }) => t.id === term.id);
    expect(!listed || listed.alive === false).toBe(true);
    expect(await phone.rpcError('terminal.write', { id: term.id, data: 'x\n' })).toMatch(/Terminal not found/);
    // What it printed is still readable from its history.
    expect((await phone.rpc('terminal.history', { id: term.id })).data).toContain('phone-42');
  });

  // ── System docs ──────────────────────────────────────────────────────

  test('sysdoc.create writes a doc into the open project, as the person, and the desktop is told', async () => {
    const doc = await phone.rpc('sysdoc.create', { title: 'Payments flow', body: 'See `packages/web/src/api.ts`.', tags: ['payments'] });
    docUid = doc.uid;
    expect(doc).toMatchObject({ title: 'Payments flow', projectPath: root, tags: ['payments'] });
    await events.waitFor('system-doc-created', (p) => p.uid === docUid);
    const onDisk = fs.readdirSync(path.join(root, '.codetrellis'), { recursive: true }).map(String).filter((f) => f.endsWith('.md'));
    expect(onDisk.some((f) => fs.readFileSync(path.join(root, '.codetrellis', f), 'utf-8').includes('Payments flow'))).toBe(true);
    expect(await phone.rpcError('sysdoc.create', {})).toMatch(/title/);
  });

  test('sysdoc.list and sysdoc.read agree with the desktop, freshness included', async () => {
    const q = encodeURIComponent(root);
    expect(await phone.rpc('sysdoc.list')).toEqual(await req('GET', `/api/system-docs?project=${q}`));
    expect((await phone.rpc('sysdoc.list', { search: 'payments' })).map((d: { uid: string }) => d.uid)).toEqual([docUid]);
    expect(await phone.rpc('sysdoc.list', { search: 'no-such-words' })).toEqual([]);
    expect(await phone.rpcError('sysdoc.list', { projectPath: '/etc' })).toMatch(/not|trusted|opened/i);

    const read = await phone.rpc('sysdoc.read', { uid: docUid });
    expect(read.doc).toEqual(await req('GET', `/api/system-docs/${docUid}`));
    expect(read.freshness).toEqual(await req('GET', `/api/system-docs/${docUid}/freshness`));
    expect(await phone.rpcError('sysdoc.read', { uid: 'no-such-doc' })).toMatch(/Doc not found/);
    expect((await h.client.raw('GET', '/api/system-docs/no-such-doc')).status).toBe(404);
    expect((await h.client.raw('GET', '/api/system-docs/no-such-doc/freshness')).status).toBe(404);
  });

  test('sysdoc.update and sysdoc.verify change the doc and tell the desktop', async () => {
    const updated = await phone.rpc('sysdoc.update', { uid: docUid, body: 'Now through `packages/web/src/OrderList.tsx`.' });
    expect(updated.body).toContain('OrderList');
    await events.waitFor('system-doc-updated', (p) => p.uid === docUid);
    expect((await req('GET', `/api/system-docs/${docUid}`)).body).toContain('OrderList');

    const verified = await phone.rpc('sysdoc.verify', { uid: docUid });
    expect(verified.uid).toBe(docUid);
    await events.waitFor('system-doc-verified', (p) => p.uid === docUid);

    expect(await phone.rpcError('sysdoc.update', { uid: 'no-such-doc', body: 'x' })).toMatch(/Doc not found/);
    expect(await phone.rpcError('sysdoc.verify', { uid: 'no-such-doc' })).toMatch(/Doc not found/);
  });

  test('sysdoc.delete removes it and tells the desktop; deleting one that is not there is refused', async () => {
    expect(await phone.rpc('sysdoc.delete', { uid: docUid })).toEqual({ ok: true });
    await events.waitFor('system-doc-removed', (p) => p.uid === docUid);
    expect((await h.client.raw('GET', `/api/system-docs/${docUid}`)).status).toBe(404);
    expect(await phone.rpcError('sysdoc.delete', { uid: docUid })).toMatch(/Doc not found/);
  });
});
