/**
 * Phase 32 C3.6 — the C3 done-when: a shared plans folder, end to end.
 *
 * Dana and Sam's team keeps "Q4 board pack" in its OneDrive folder, not in a
 * repository. Their copies of it sit at different paths, and the sync client
 * (here, a copy of what each device wrote) moves files between them; the app
 * sends nothing.
 *
 *  1. Dana names the folder by its place in OneDrive and links her copy;
 *     Sam's app finds his and he links it. The plan arrives with the folder.
 *  2. Neither shares task state yet: Sam's progress stays on his laptop.
 *  3. Both turn it on. Sam marks the report in progress, 40%: one small file
 *     appears in the folder, and his device's key introduction.
 *  4. On Dana's machine it says "in progress, 40%", recorded by Sam Lee in
 *     his record, unverified. She checks his key's fingerprint with him and
 *     trusts it: the same record now reads as his signed record.
 *  5. Sam's next change arrives still in the cloud: it is not read, and the
 *     report stays at 40% until the file comes down, then reads 60%.
 *  6. Dana marks it done; Sam sees it as hers.
 *  7. They change "Check the figures" at once, each differently: neither
 *     machine picks, both name both, until Dana keeps hers.
 *  8. The sales export in the folder is one material for both, by its place.
 *     Dana's agent drafts the report from last week's; Sam replaces it and
 *     his agent checks the figures from the new one. Dana's machine says the
 *     two tasks read different versions, naming Sam, and that his has the
 *     current one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

const PLACE = 'Acme/Board pack';

interface Shared { enabled: boolean; writer: string; signing: { how: string; as: string }; keys: Array<{ writer: string; state: string }> }
interface Check { verified: boolean; who?: string; why?: string }
interface Status { items: Array<{ itemUid: string; words: string; recorded: { by: string; byType: string; check?: Check } | null; atOnce?: { words: string } }> }
interface Item { status: string; progressPercent: number | null; blockedReason: string | null }
interface Signal { kind: string; severity: string; workstreams: string[]; summary: string; subject: Record<string, unknown> }
interface Person { h: Harness; code: string; root: string; place: string }

test.describe.serial('A shared plans folder, end to end', () => {
  test.setTimeout(240_000);
  const people = {} as Record<'dana' | 'sam', Person>;
  let plan: string;
  let report: string;
  let figures: string;
  const q = (p: Person) => `?project=${encodeURIComponent(p.code)}`;

  const setUp = async (who: 'dana' | 'sam', name: string) => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `OneDrive - Acme ${who} `));
    const h = await setupHarness(`shared-folder-${who}`, {
      env: { CODETRELLIS_CLOUD_ROOTS: JSON.stringify([{ provider: 'onedrive', path: root, account: 'Acme' }]) },
      settings: { identity: { displayName: name, email: `${who}@acme.test` } },
    });
    const code = h.fixture.projectPath;
    await h.client.scanProject(code);
    const place = path.join(root, ...PLACE.split('/'));
    fs.mkdirSync(place, { recursive: true });
    people[who] = { h, code, root, place };
  };

  /**
   * What the sync client does: every file one copy has that the other lacks
   * or holds differently is brought over. Each device writes only its own
   * records, reads and key, so nothing here is ever two people's change.
   */
  const sync = (from: Person, to: Person, only: string[] = ['.codetrellis/records', '.codetrellis/reads', '.codetrellis/keys', 'Materials']) => {
    for (const sub of only) {
      const src = path.join(from.place, sub);
      if (!fs.existsSync(src)) continue;
      for (const rel of fs.readdirSync(src, { recursive: true }) as string[]) {
        const a = path.join(src, rel);
        if (!fs.statSync(a).isFile()) continue;
        const b = path.join(to.place, sub, rel);
        const bytes = fs.readFileSync(a);
        if (fs.existsSync(b) && fs.readFileSync(b).equals(bytes)) continue;
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.writeFileSync(b, bytes);
      }
    }
  };
  const recordsIn = (p: Person, item: string) => {
    const dir = path.join(p.place, '.codetrellis', 'records', plan, item);
    return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  };
  const shared = async (p: Person) => (await (await p.h.client.raw('GET', `/api/shared-task-state${q(p)}`)).json()) as Shared;
  const item = async (p: Person, uid: string) => (await (await p.h.client.raw('GET', `/api/items/${uid}`)).json()) as Item;
  const set = async (p: Person, uid: string, body: Record<string, unknown>) => {
    const res = await p.h.client.raw('PUT', `/api/items/${uid}`, body);
    expect(res.ok, await res.clone().text()).toBe(true);
  };
  const statusOf = async (p: Person, uid: string) => ((await (await p.h.client.raw('GET', `/api/plans/${plan}/status`)).json()) as Status).items.find((i) => i.itemUid === uid)!;
  const signals = async (p: Person) => ((await (await p.h.client.raw('GET', `/api/awareness${q(p)}`)).json()) as { signals: Signal[] }).signals;

  test.beforeAll(async () => {
    await setUp('dana', 'Dana Ortiz');
    await setUp('sam', 'Sam Lee');
  });
  test.afterAll(async () => {
    for (const p of Object.values(people)) {
      await p.h.teardown();
      fs.rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('1. Dana names the folder by its place and links her copy; Sam\'s app finds his, and the plan arrives with it', async () => {
    const { dana, sam } = people;
    const named = await dana.h.client.raw('PUT', `/api/plans-folder${q(dana)}`, { folder: { kind: 'synced', provider: 'onedrive', place: PLACE } });
    expect(named.status, await named.clone().text()).toBe(200);
    expect(((await named.json()) as { found: string | null }).found).toBe(dana.place);
    expect((await dana.h.client.raw('POST', `/api/plans-folder/link${q(dana)}`, { path: dana.place })).status).toBe(200);

    fs.mkdirSync(path.join(dana.place, 'Materials'), { recursive: true });
    fs.writeFileSync(path.join(dana.place, 'Materials', 'sales.csv'), 'region,q3\nEMEA,120\n');
    plan = (await dana.h.client.createPlan({ title: 'Q4 board pack', projectPath: dana.code })).uid;
    const post = async (title: string) => ((await (await dana.h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title })).json()) as { uid: string }).uid;
    report = await post('Write the board report');
    figures = await post('Check the figures');
    for (const uid of [report, figures]) {
      const res = await dana.h.client.raw('POST', `/api/items/${uid}/artefacts`, { path: path.join(dana.place, 'Materials', 'sales.csv'), role: 'material' });
      expect(res.status, await res.clone().text()).toBe(201);
    }
    const planDir = (await dana.h.client.exportPlan(plan, dana.code)).planDir;
    expect(planDir.startsWith(dana.place)).toBe(true);

    // The sync client brings the whole folder to Sam's machine, at his path.
    fs.cpSync(dana.place, sam.place, { recursive: true });
    const found = (await (await sam.h.client.raw('PUT', `/api/plans-folder${q(sam)}`, { folder: { kind: 'synced', provider: 'onedrive', place: PLACE } })).json()) as { found: string | null };
    expect(found.found).toBe(sam.place);
    const linked = await sam.h.client.raw('POST', `/api/plans-folder/link${q(sam)}`, { path: sam.place });
    expect(((await linked.json()) as { imported?: number }).imported).toBe(1);
    expect((await item(sam, report)).status).toBe('pending');
  });

  test('2. sharing is off: Sam\'s progress stays on his laptop', async () => {
    const { sam } = people;
    await set(sam, report, { status: 'in_progress', progressPercent: 20 });
    expect(recordsIn(sam, report)).toEqual([]);
    expect(fs.existsSync(path.join(sam.place, '.codetrellis', 'reads'))).toBe(false);
  });

  test('3. both share task state; Sam\'s 40% is one small file in the folder, and his key\'s introduction', async () => {
    const { dana, sam } = people;
    for (const p of [dana, sam]) {
      const on = await p.h.client.raw('PUT', `/api/shared-task-state${q(p)}`, { enabled: true });
      expect(on.status, await on.clone().text()).toBe(200);
    }
    await set(sam, report, { progressPercent: 40 });
    const s = await shared(sam);
    expect(recordsIn(sam, report)).toEqual([`${s.writer}-1.yaml`]);
    expect(fs.existsSync(path.join(sam.place, '.codetrellis', 'keys', `${s.writer}.yaml`))).toBe(true);
    // Nothing went to the project: the folder is where the records live.
    expect(fs.existsSync(path.join(sam.code, '.codetrellis', 'records'))).toBe(false);
  });

  test('4. on Dana\'s machine it is Sam\'s, unverified; she trusts his key and it reads as his signed record', async () => {
    const { dana, sam } = people;
    sync(sam, dana);
    await expect.poll(async () => (await item(dana, report)).progressPercent, { timeout: 15_000 }).toBe(40);
    let line = await statusOf(dana, report);
    expect(line.words).toBe('in progress, 40%');
    expect(line.recorded).toMatchObject({ by: 'Sam Lee', byType: 'record', check: { verified: false } });

    const s = await shared(sam);
    expect((await shared(dana)).keys).toEqual([expect.objectContaining({ writer: s.writer, state: 'new' })]);
    const trusted = await dana.h.client.raw('POST', '/api/shared-task-state/keys', { writer: s.writer, fingerprint: s.signing.as, trust: true });
    expect(trusted.status, await trusted.clone().text()).toBe(200);
    line = await statusOf(dana, report);
    expect(line.recorded?.check).toMatchObject({ verified: true, who: 'Sam Lee' });
  });

  test('5. Sam\'s next change arrives still in the cloud: not read until it comes down', async () => {
    const { dana, sam } = people;
    await set(sam, report, { progressPercent: 60 });
    const s = await shared(sam);
    const name = `${s.writer}-2.yaml`;
    const theirs = path.join(sam.place, '.codetrellis', 'records', plan, report, name);
    const mine = path.join(dana.place, '.codetrellis', 'records', plan, report, name);
    // What the sync client leaves first: the file's size, no blocks on disk.
    const fd = fs.openSync(mine, 'w');
    fs.ftruncateSync(fd, fs.statSync(theirs).size);
    fs.closeSync(fd);
    expect(fs.statSync(mine).blocks).toBe(0);
    await new Promise((r) => setTimeout(r, 1_000)); // the watcher has seen it
    expect((await item(dana, report)).progressPercent).toBe(40);

    fs.writeFileSync(mine, fs.readFileSync(theirs));
    await expect.poll(async () => (await item(dana, report)).progressPercent, { timeout: 15_000 }).toBe(60);
  });

  test('6. Dana marks it done; Sam sees it as hers', async () => {
    const { dana, sam } = people;
    await set(dana, report, { status: 'done' });
    sync(dana, sam);
    await expect.poll(async () => (await item(sam, report)).status, { timeout: 15_000 }).toBe('done');
    expect((await statusOf(sam, report)).recorded).toMatchObject({ by: 'Dana Ortiz', byType: 'record' });
  });

  test('7. both change "Check the figures" at once: nothing is picked, both are named, until Dana keeps hers', async () => {
    const { dana, sam } = people;
    await set(dana, figures, { status: 'blocked', blockedReason: 'waits on the ledger' });
    await set(sam, figures, { status: 'in_progress' });
    sync(sam, dana);
    sync(dana, sam);
    const words = 'set two ways at once: Sam Lee says in progress, Dana Ortiz says blocked';
    for (const p of [dana, sam]) {
      await expect.poll(async () => (await statusOf(p, figures)).atOnce?.words, { timeout: 15_000 }).toBe(words);
      await expect.poll(async () => (await signals(p)).filter((x) => x.kind === 'state-split').length, { timeout: 15_000 }).toBe(1);
    }
    expect((await item(dana, figures)).status).toBe('blocked');
    expect((await item(sam, figures)).status).toBe('in_progress');

    expect((await dana.h.client.raw('POST', `/api/items/${figures}/keep-state`)).status).toBe(200);
    sync(dana, sam);
    await expect.poll(async () => (await item(sam, figures)).status, { timeout: 15_000 }).toBe('blocked');
    for (const p of [dana, sam]) {
      expect((await statusOf(p, figures)).atOnce).toBeUndefined();
      await expect.poll(async () => (await signals(p)).filter((x) => x.kind === 'state-split').length, { timeout: 15_000 }).toBe(0);
    }
  });

  test('8. one material by its place: Dana\'s report used last week\'s export, Sam\'s figures the one he put there', async () => {
    const { dana, sam } = people;
    const attachment = async (p: Person, uid: string) => ((await (await p.h.client.raw('GET', `/api/items/${uid}/artefacts`)).json()) as Array<{ uid: string; path: string }>)[0];
    expect((await attachment(dana, report)).path).toBe('plans://Materials/sales.csv');
    expect((await attachment(sam, report)).path).toBe('plans://Materials/sales.csv');

    const danasAgent = await dana.h.spawnAgent({ agentType: 'claude-desktop' });
    expect((await danasAgent.callTool('get_brief', { item_uid: report })).isError).toBeFalsy();
    const r1 = await danasAgent.callTool('read_material', { attachment_uid: (await attachment(dana, report)).uid });
    expect(r1.text).toContain('EMEA,120');

    fs.writeFileSync(path.join(sam.place, 'Materials', 'sales.csv'), 'region,q3\nEMEA,131\n');
    const samsAgent = await sam.h.spawnAgent({ agentType: 'claude-code' });
    expect((await samsAgent.callTool('get_brief', { item_uid: figures })).isError).toBeFalsy();
    const r2 = await samsAgent.callTool('read_material', { attachment_uid: (await attachment(sam, figures)).uid });
    expect(r2.text).toContain('EMEA,131');

    sync(sam, dana);
    // Settled, not just raised: until Dana's app has hashed the export the
    // sync just brought, "current" is still last week's, and the same split
    // is first reported the other way round (CI caught that state).
    let found: Signal[] = [];
    await expect.poll(async () => {
      found = (await signals(dana)).filter((s) => s.subject.material);
      return found.map((s) => [s.kind, s.subject.readVersions]);
    }, { timeout: 30_000 }).toEqual([['version-split', { [`task:${figures}`]: 'current', [`task:${report}`]: 'earlier' }]]);
    expect(found[0].subject).toMatchObject({ material: 'plans://Materials/sales.csv' });
    // Sam's key is trusted here, so his read is named as his.
    expect(found[0].summary).toContain('“Check the figures” (Sam Lee)');
    expect(found[0].summary).toContain('“Check the figures” has the current one');
    expect(found[0].subject.readBy).toEqual({ [`task:${figures}`]: 'Sam Lee' });

    // Dana's agent, on its next brief, hears it from its own task's side, naming Sam.
    const brief = JSON.parse((await danasAgent.callTool('get_brief', { item_uid: report })).answer) as { affected_by_other_work: Array<{ kind: string; says: string }> };
    expect(brief.affected_by_other_work).toEqual([expect.objectContaining({
      kind: 'Different versions',
      says: 'This task worked from an earlier version of plans://Materials/sales.csv; “Check the figures” (Sam Lee) has the current one.',
    })]);
  });
});
