/**
 * The Brief and the files behind it, over REST and MCP (Phase 32 §0.4e).
 *
 * Five artefact routes had no test, and the Brief tools had none against
 * the real server: recording a file on an item (and every way that is
 * refused), listing an item's files with fresh hashes, what the viewer
 * reads about a file, its bytes (whole and by range), the Office
 * rendition's fallback when this build carries no engine, and the agent's
 * side: get_brief, list_materials and read_material.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

interface Artefact { uid: string; path: string; role: string; sha256: string; size: number }

// A 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test.describe.serial('Brief surface', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  let planUid: string;
  let page: string;
  let item: string;
  let sales: Artefact;
  let guide: Artefact;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(name, args);
    expect(res.isError, `${name}: ${res.text}`).not.toBe(true);
    return res;
  };
  const record = (uid: string, body: Record<string, unknown>) => h.client.raw('POST', `/api/items/${uid}/artefacts`, body);
  /** GET with extra headers (a byte range), which the JSON client does not send. */
  const get = (url: string, headers: Record<string, string> = {}) =>
    fetch(h.backend.baseUrl + url, { headers: { 'x-codetrellis-token': h.backend.capabilityToken, ...headers } });
  const write = (rel: string, content: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };

  test.beforeAll(async () => {
    // No conversion engine, whatever this checkout holds: the release build
    // fetches one into resources/rendition/engine (gitignored), and then the
    // "no engine" case below converted the .docx instead of falling back.
    h = await setupHarness('brief-surface', { env: { CODETRELLIS_RENDITION_ENGINE: path.join(os.tmpdir(), 'ct-no-rendition-engine') } });
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    write('data/sales.csv', 'region,revenue\nEMEA,120\nAPAC,80\nAMER,95\n');
    write('docs/house-style.md', '# House style\n\nCite every figure.\nRound to the nearest thousand.\n');
    write('out/summary.md', '# Q3\n\nEMEA led.\n');
    write('out/chart.png', PNG);
    write('docs/q3-memo.docx', 'not really a document; the rendition fails before reading it');
    write('tools/run.sh', 'echo hi\n');

    planUid = (await h.client.createPlan({ title: 'Q3 board pack', projectPath: root })).uid;
    page = (await req('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'How we report', body: 'Cite every figure. Use the house style.' })).uid;
    item = (await req('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Q3 summary', body: 'Summarise Q3 by region.' })).uid;
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  // ── Recording ─────────────────────────────────────────────────────────

  test('a person records a file on an item: hashed, project-relative, recorded again in place', async () => {
    const res = await record(item, { path: 'data/sales.csv', role: 'material', note: 'Q3 sales export' });
    expect(res.status).toBe(201);
    sales = await res.json();
    expect(sales).toMatchObject({ path: 'data/sales.csv', role: 'material', size: fs.statSync(path.join(root, 'data/sales.csv')).size });
    expect(sales.sha256).toMatch(/^[a-f0-9]{64}$/);

    // An absolute path inside the project is stored relative; the same file again is the same row.
    const again = await (await record(item, { path: path.join(root, 'data/sales.csv'), role: 'material' })).json();
    expect(again.uid).toBe(sales.uid);
    expect(again.path).toBe('data/sales.csv');

    guide = await (await record(page, { path: 'docs/house-style.md', role: 'material' })).json();
    expect((await record(page, { path: 'out/chart.png', role: 'output' })).status).toBe(201);
  });

  test('recording is refused for a bad role, a type the viewer cannot show, a missing file, a path outside, a link, an unknown item', async () => {
    const refusals: Array<[string, string, Record<string, unknown>, number, RegExp]> = [
      ['a bad role', item, { path: 'data/sales.csv', role: 'input' }, 400, /role must be one of/],
      ['a type the viewer cannot show', item, { path: 'tools/run.sh', role: 'material' }, 400, /\.sh files cannot be recorded/],
      ['a missing file', item, { path: 'data/nope.csv', role: 'material' }, 404, /No file at data\/nope\.csv/],
      ['a path outside the project', item, { path: '../outside.csv', role: 'material' }, 400, /./],
    ];
    fs.writeFileSync(path.join(h.fixture.tmpDir, 'outside.csv'), 'secret,1\n');
    fs.symlinkSync(path.join(h.fixture.tmpDir, 'outside.csv'), path.join(root, 'data', 'link.csv'));
    refusals.push(['a link', item, { path: 'data/link.csv', role: 'material' }, 400, /without a symbolic link/]);

    for (const [why, uid, body, status, message] of refusals) {
      const res = await record(uid, body);
      expect(res.status, why).toBe(status);
      expect((await res.json()).error, why).toMatch(message);
    }
    expect((await record('no-such-item', { path: 'data/sales.csv', role: 'material' })).status).toBe(404);
    // Nothing refused was recorded.
    const listed = (await req('GET', `/api/items/${item}/artefacts`)) as Artefact[];
    expect(listed.map((a) => a.path)).toEqual(['data/sales.csv']);
  });

  test('an agent records an output; the item lists both, re-hashed after an edit', async () => {
    const res = await tool('record_artefact', { item_uid: item, path: 'out/summary.md', role: 'output', note: 'the summary' });
    const out = JSON.parse(res.text);
    expect(out).toMatchObject({ path: 'out/summary.md', role: 'output' });

    const before = (await req('GET', `/api/items/${item}/artefacts`)) as Artefact[];
    expect(before.map((a) => [a.path, a.role])).toEqual([['data/sales.csv', 'material'], ['out/summary.md', 'output']]);

    write('out/summary.md', '# Q3\n\nEMEA led; APAC missed.\n');
    const after = (await req('GET', `/api/items/${item}/artefacts`)) as Artefact[];
    const summary = after.find((a) => a.path === 'out/summary.md')!;
    expect(summary.sha256).not.toBe(before.find((a) => a.path === 'out/summary.md')!.sha256);

    expect((await h.client.raw('GET', '/api/items/no-such-item/artefacts')).status).toBe(404);
  });

  // ── The viewer's reads ───────────────────────────────────────────────

  test('what the viewer reads about a file: relative path, role, hash, who recorded it — never the absolute path', async () => {
    const res = await h.client.raw('GET', `/api/artefacts/${sales.uid}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(root);
    const meta = JSON.parse(text);
    expect(meta).toMatchObject({
      uid: sales.uid, itemUid: item, path: 'data/sales.csv', name: 'sales.csv', role: 'material',
      // Recorded over plain HTTP, so the person is `unverified` (§0.4d);
      // the app window records `human`. Carried item 2 changed this.
      sha256: sales.sha256, viewable: true, recordedByType: 'unverified',
    });
    expect(meta.contentType).toMatch(/^text\/csv/);
    expect((await h.client.raw('GET', '/api/artefacts/5a0c0000-0000-4000-8000-00000000dead')).status).toBe(404);
  });

  test('the bytes: whole with the safety headers, by range, and gone when the file is', async () => {
    const whole = await get(`/api/artefacts/${sales.uid}/content`);
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe('region,revenue\nEMEA,120\nAPAC,80\nAMER,95\n');
    expect(whole.headers.get('x-content-type-options')).toBe('nosniff');
    expect(whole.headers.get('cache-control')).toBe('no-store');
    expect(whole.headers.get('content-security-policy')).toMatch(/sandbox/);

    const part = await get(`/api/artefacts/${sales.uid}/content`, { range: 'bytes=0-5' });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('region');
    expect(part.headers.get('content-range')).toBe(`bytes 0-5/${sales.size}`);
    expect((await get(`/api/artefacts/${sales.uid}/content`, { range: 'bytes=9999-' })).status).toBe(416);

    const png = (await req('GET', `/api/items/${page}/artefacts`) as Artefact[]).find((a) => a.path === 'out/chart.png')!;
    const image = await get(`/api/artefacts/${png.uid}/content`);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);

    expect((await get('/api/artefacts/5a0c0000-0000-4000-8000-00000000dead/content')).status).toBe(404);
  });

  test('the rendition: refused for a type it does not convert; a sentence and a fallback when there is no engine', async () => {
    const csv = await get(`/api/artefacts/${sales.uid}/rendition`);
    expect(csv.status).toBe(415);
    expect(await csv.json()).toEqual({ error: '.csv files are not converted', fallback: true });

    const memo = await (await record(item, { path: 'docs/q3-memo.docx', role: 'material' })).json();
    const docx = await get(`/api/artefacts/${memo.uid}/rendition`);
    expect(docx.status).toBe(503);
    const body = await docx.json();
    expect(body.fallback).toBe(true);
    expect(body.error).toMatch(/engine/);

    expect((await get('/api/artefacts/not-a-uid/rendition')).status).toBe(404);
  });

  // ── The agent's side ─────────────────────────────────────────────────

  test('get_brief: the item, the guide, its materials and the page\'s, and what each criterion still needs', async () => {
    const c = await req('POST', `/api/items/${item}/criteria`, { text: 'Every figure is cited', kind: 'citation' });
    const res = await tool('get_brief', { item_uid: item });
    const brief = JSON.parse(res.text);
    expect(brief.item).toMatchObject({ uid: item, title: 'Q3 summary', kind: 'action', body: 'Summarise Q3 by region.' });
    expect(brief.plan).toEqual({ uid: planUid, title: 'Q3 board pack' });
    expect(brief.guide.map((g: { title: string; body: string }) => [g.title, g.body])).toEqual([['How we report', 'Cite every figure. Use the house style.']]);

    // The item's own files, then the page's MATERIALS — not the page's output.
    const materials = brief.materials.map((m: { name: string; role: string; read_as: string }) => [m.name, m.role]);
    expect(materials).toEqual([
      ['sales.csv', 'material'], ['summary.md', 'output'], ['q3-memo.docx', 'material'], ['house-style.md', 'material'],
    ]);
    expect(brief.criteria).toEqual([expect.objectContaining({ uid: c.uid, state: 'open', still_needs: expect.stringMatching(/read_material/) })]);
    expect(brief.sent_back).toBe(0);

    const missing = await agent.callTool('get_brief', { item_uid: 'no-such-item' });
    expect(missing.isError).toBe(true);
  });

  test('list_materials: every file on the plan, item by item, outputs included', async () => {
    const res = await tool('list_materials', { plan_uid: planUid });
    const { materials } = JSON.parse(res.text);
    expect(materials.map((m: { path: string; item_title: string }) => [m.item_title, m.path])).toEqual([
      ['How we report', 'docs/house-style.md'],
      ['How we report', 'out/chart.png'],
      ['Q3 summary', 'data/sales.csv'],
      ['Q3 summary', 'out/summary.md'],
      ['Q3 summary', 'docs/q3-memo.docx'],
    ]);
    expect((await agent.callTool('list_materials', { plan_uid: 'no-such-plan' })).isError).toBe(true);
  });

  test('read_material: a range of a sheet, lines of a text file, an image as itself; the read is logged on the item', async () => {
    const range = await tool('read_material', { attachment_uid: sales.uid, locator: { range: 'A2:B3' } });
    const [header, quoted] = [JSON.parse(range.content[0].text as string), range.content[1].text as string];
    expect(header).toMatchObject({ attachment_uid: sales.uid, name: 'sales.csv' });
    expect(quoted).toContain('EMEA');
    expect(quoted).toContain('APAC');
    expect(quoted).not.toContain('AMER');
    expect(header.read).toBe('cells A2:B3');
    // The cell a citation can cite is a cell read_material can read (0.4e).
    const outside = await agent.callTool('read_material', { attachment_uid: sales.uid, locator: { range: 'C2' } });
    expect(outside.isError).toBe(true);
    expect(outside.text).toMatch(/C2 is outside sales\.csv, which has 4 rows and 2 columns/);

    const lines = await tool('read_material', { attachment_uid: guide.uid, locator: { lines: '3-3' } });
    expect(lines.content[1].text).toContain('Cite every figure.');
    expect(lines.content[1].text).not.toContain('Round to the nearest thousand.');

    const png = (await req('GET', `/api/items/${page}/artefacts`) as Artefact[]).find((a) => a.path === 'out/chart.png')!;
    const image = await tool('read_material', { attachment_uid: png.uid });
    expect(image.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png', data: PNG.toString('base64') });

    const events = (await req('GET', `/api/items/${item}/events`)) as Array<{ eventType: string; afterState: { attachmentUid: string } }>;
    expect(events.filter((e) => e.eventType === 'material_read').map((e) => e.afterState.attachmentUid)).toContain(sales.uid);

    expect((await agent.callTool('read_material', { attachment_uid: '5a0c0000-0000-4000-8000-00000000dead' })).isError).toBe(true);
  });
});
