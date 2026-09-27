/**
 * System docs and external intake, checked for what they do (Phase 32 §0.4l).
 *
 * System docs are markdown files under `.codetrellis/docs/`, indexed in the
 * database and stamped with the commit they were last checked against, so a
 * reader can tell when the code under them has moved. Intake turns a ticket
 * tree an agent fetched into a plan, and sync state tells the agent what to
 * write back. Until 0.4l most of this was called by tests that checked a
 * count; `read_system_doc` and the verify route were never called at all.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, openEventStream, type Harness, type ScriptedAgent, type EventStream } from '../harness';

interface Doc { uid: string; slug: string; title: string; body: string; author: string; authorType: string; capturedAgainstCommit: string | null; projectPath: string }

test.describe.serial('System docs and intake', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let events: EventStream;
  let root: string;
  let doc: Doc;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const json = async (name: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(name, args);
    expect(res.isError, `${name}: ${res.text}`).not.toBe(true);
    return JSON.parse(res.text);
  };
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
  }).trim();
  const docFile = (slug: string) => path.join(root, '.codetrellis', 'docs', `${slug}.md`);

  test.beforeAll(async () => {
    h = await setupHarness('sysdocs-intake');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    events = await openEventStream(h.backend);
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  // ── System docs ──────────────────────────────────────────────────────

  test('write_system_doc creates the file and the row, in the agent\'s name', async () => {
    doc = await json('write_system_doc', {
      project_path: root, title: 'Validation rules', body: 'Emails are checked in `validators.ts`.',
      tags: ['validation'], references: { files: ['packages/shared/src/validators.ts'] },
    });
    // An agent's doc says so — it was recorded as a person's.
    expect(doc).toMatchObject({ title: 'Validation rules', slug: 'validation-rules', author: 'claude-desktop', authorType: 'mcp' });
    await events.waitFor('system-doc-created', (p) => p.uid === doc.uid);
    const onDisk = fs.readFileSync(docFile('validation-rules'), 'utf-8');
    expect(onDisk).toContain(`uid: ${doc.uid}`);
    expect(onDisk).toContain('Emails are checked in `validators.ts`.');
  });

  test('list, search and read agree across MCP and REST; read by uid or slug; unknown refused', async () => {
    const listed = await json('list_system_docs', { project_path: root });
    expect(listed.docs.map((d: Doc) => d.uid)).toEqual([doc.uid]);
    expect((await req('GET', `/api/system-docs?project=${encodeURIComponent(root)}`)).map((d: Doc) => d.uid)).toEqual([doc.uid]);
    expect((await json('list_system_docs', { project_path: root, search: 'EMAILS' })).count).toBe(1);
    expect((await json('list_system_docs', { project_path: root, search: 'nothing like this' })).count).toBe(0);

    expect(await json('read_system_doc', { uid: doc.uid })).toMatchObject({ uid: doc.uid, body: doc.body });
    expect(await json('read_system_doc', { project_path: root, slug: 'validation-rules' })).toMatchObject({ uid: doc.uid });
    for (const args of [{ uid: 'no-such-doc' }, { project_path: root, slug: 'no-such-slug' }, {}]) {
      const res = await agent.callTool('read_system_doc', args);
      expect(res.isError, JSON.stringify(args)).toBe(true);
      expect(res.text).toMatch(/not found/);
    }
  });

  test('verify stamps HEAD; a commit to a referenced file makes it stale, naming the file; verify again freshens it', async () => {
    const verified = await json('verify_system_doc', { uid: doc.uid });
    expect(verified.capturedAgainstCommit).toBe(git('rev-parse', 'HEAD'));
    const fresh = await json('check_doc_freshness', { uid: doc.uid });
    expect(fresh).toMatchObject({ uid: doc.uid });
    expect(JSON.stringify(fresh)).not.toContain('validators.ts');

    fs.appendFileSync(path.join(root, 'packages/shared/src/validators.ts'), '\nexport const LAX = false;\n');
    git('add', '-A'); git('commit', '-qm', 'Loosen validation');
    const stale = await json('check_doc_freshness', { uid: doc.uid });
    expect(JSON.stringify(stale)).toContain('packages/shared/src/validators.ts');
    expect(stale).toEqual(await req('GET', `/api/system-docs/${doc.uid}/freshness`));

    // The desktop's verify button: re-stamped at the new HEAD, and told.
    const again = await req('POST', `/api/system-docs/${doc.uid}/verify`);
    expect(again.capturedAgainstCommit).toBe(git('rev-parse', 'HEAD'));
    await events.waitFor('system-doc-verified', (p) => p.uid === doc.uid);
    expect(JSON.stringify(await json('check_doc_freshness', { uid: doc.uid }))).not.toContain('validators.ts');
    expect((await h.client.raw('POST', '/api/system-docs/no-such-doc/verify')).status).toBe(404);
  });

  test('an update renames the file with the title, and records who changed it', async () => {
    const updated = await json('write_system_doc', { uid: doc.uid, project_path: root, title: 'Input validation rules' });
    expect(updated).toMatchObject({ slug: 'input-validation-rules', author: 'claude-desktop', authorType: 'mcp' });
    expect(fs.existsSync(docFile('validation-rules'))).toBe(false);
    expect(fs.existsSync(docFile('input-validation-rules'))).toBe(true);
    const res = await agent.callTool('write_system_doc', { uid: 'no-such-doc', project_path: root, body: 'x' });
    expect(res.isError).toBe(true);
  });

  test('over plain HTTP a write is recorded as unverified, whatever the body claims', async () => {
    const made = await req('POST', '/api/system-docs', { projectPath: root, title: 'Deploy notes', body: 'Tag, then push.', author: 'the-ceo', authorType: 'human' });
    expect(made).toMatchObject({ authorType: 'unverified' });
    const edited = await req('PUT', `/api/system-docs/${made.uid}`, { body: 'Tag, push, wait for CI.', author: 'the-ceo', authorType: 'human' });
    expect(edited.body).toBe('Tag, push, wait for CI.');
    expect(edited).toMatchObject({ authorType: 'unverified' });
    expect(edited.author).not.toBe('the-ceo');
    await req('DELETE', `/api/system-docs/${made.uid}`);
  });

  test('a doc file added on disk (a teammate\'s, pulled) is indexed', async () => {
    fs.writeFileSync(docFile('runbook'), '# Runbook\n\nRestart the worker.\n');
    await expect.poll(async () => (await json('list_system_docs', { project_path: root })).docs.map((d: Doc) => d.slug), { timeout: 10_000 })
      .toContain('runbook');
    // Given a uid, stamped back into its file.
    await expect.poll(() => fs.readFileSync(docFile('runbook'), 'utf-8'), { timeout: 5000 }).toMatch(/^---\nuid: /);
  });

  test('delete_system_doc removes row and file; an unknown doc is refused', async () => {
    expect(await json('delete_system_doc', { uid: doc.uid })).toMatchObject({ ok: true });
    expect(fs.existsSync(docFile('input-validation-rules'))).toBe(false);
    const again = await agent.callTool('delete_system_doc', { uid: doc.uid });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/not found/);
  });

  // ── Intake ───────────────────────────────────────────────────────────

  let planUid: string;

  test('create_plan_from_external: the tree with its tickets; a fourth level levelled into the third; criteria as a checklist', async () => {
    const made = await json('create_plan_from_external', {
      title: 'Checkout revamp', project_path: root,
      external: { url: 'https://acme.atlassian.net/browse/SHOP-1', key: 'SHOP-1', title: 'Checkout revamp' },
      items: [{
        title: 'Payments', external: { url: 'https://acme.atlassian.net/browse/SHOP-2' },
        children: [{
          title: 'Card form', acceptance: ['Rejects expired cards', 'Shows the brand logo'],
          external: { url: 'https://acme.atlassian.net/browse/SHOP-3', key: 'SHOP-3' },
          children: [{ title: 'Luhn check', external: { url: 'https://acme.atlassian.net/browse/SHOP-4', key: 'SHOP-4' },
            children: [{ title: 'Too deep', external: { url: 'https://acme.atlassian.net/browse/SHOP-5', key: 'SHOP-5' } }] }],
        }],
      }],
    });
    planUid = made.plan_uid;
    expect(made).toMatchObject({ ok: true, items_created: 4, items_with_tickets: 4 });

    const items = (await req('GET', `/api/plans/${planUid}/items`)) as Array<{ uid: string; title: string; parentUid: string | null; body: string; kind: string }>;
    const by = (t: string) => items.find((i) => i.title === t)!;
    expect(by('Payments').parentUid).toBeNull();
    expect(by('Payments').kind).toBe('object');
    expect(by('Card form').parentUid).toBe(by('Payments').uid);
    expect(by('Luhn check').parentUid).toBe(by('Card form').uid);
    // The fourth level sits beside the third, not below it, and is not dropped.
    expect(by('Too deep').parentUid).toBe(by('Card form').uid);
    const cardForm = await req('GET', `/api/items/${by('Card form').uid}`);
    expect(cardForm.body).toContain('Rejects expired cards');
    expect(cardForm.body).toContain('Shows the brand logo');

    expect((await json('list_plan_external_refs', { plan_uid: planUid })).map((r: { externalKey: string }) => r.externalKey)).toEqual(['SHOP-1']);
    // The second ticket key was derived from its URL.
    expect((await req('GET', `/api/items/${by('Payments').uid}/refs`))[0]).toMatchObject({ externalKey: 'SHOP-2' });
  });

  test('importing the same epic again is refused, naming the plan that has it', async () => {
    const res = await agent.callTool('create_plan_from_external', {
      title: 'Checkout revamp (again)', project_path: root,
      external: { url: 'https://acme.atlassian.net/browse/SHOP-1', key: 'SHOP-1' }, items: [],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(planUid);
  });

  test('sync state: everything before the first sync, then only what moved, with a suggested transition', async () => {
    const first = await json('get_external_sync_state', { plan_uid: planUid });
    expect(first).toMatchObject({ never_synced: true, plan_tickets: [expect.objectContaining({ key: 'SHOP-1' })] });
    expect(first.changed).toHaveLength(4);
    // Reading does not advance the watermark.
    expect((await json('get_external_sync_state', { plan_uid: planUid })).changed).toHaveLength(4);

    await json('mark_external_synced', { plan_uid: planUid, note: 'Wrote 4 transitions' });
    expect((await json('get_external_sync_state', { plan_uid: planUid })).changed).toEqual([]);

    const items = (await req('GET', `/api/plans/${planUid}/items`)) as Array<{ uid: string; title: string }>;
    const luhn = items.find((i) => i.title === 'Luhn check')!;
    await new Promise((r) => setTimeout(r, 5));
    await req('PUT', `/api/items/${luhn.uid}`, { status: 'in_progress' });
    const moved = await json('get_external_sync_state', { plan_uid: planUid });
    expect(moved.never_synced).toBe(false);
    expect(moved.changed).toEqual([expect.objectContaining({ item_uid: luhn.uid, external_key: 'SHOP-4', status: 'in_progress', suggested_transition: 'In Progress' })]);
  });

  test('set_plan_external_ref is idempotent on the key; every intake tool refuses a plan that does not exist', async () => {
    await json('set_plan_external_ref', { plan_uid: planUid, url: 'https://acme.atlassian.net/browse/SHOP-1', key: 'SHOP-1', title: 'Checkout revamp v2' });
    const refs = await json('list_plan_external_refs', { plan_uid: planUid });
    expect(refs).toHaveLength(1);
    expect(refs[0].title).toBe('Checkout revamp v2');

    for (const [name, args] of [
      ['set_plan_external_ref', { plan_uid: 'no-such-plan', url: 'https://x.test/1' }],
      ['get_external_sync_state', { plan_uid: 'no-such-plan' }],
      ['mark_external_synced', { plan_uid: 'no-such-plan' }],
      ['list_plan_external_refs', { plan_uid: 'no-such-plan' }],
    ] as const) {
      const res = await agent.callTool(name, args);
      expect(res.isError, name).toBe(true);
      expect(res.text, name).toMatch(/Plan not found/);
    }
  });
});
