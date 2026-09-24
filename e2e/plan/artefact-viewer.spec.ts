/**
 * Phase 31.3 — the viewer: evidence opened at the place it cites, and sent
 * back from the exact place.
 *
 * An agent records a spreadsheet and cites a cell. The person opens the
 * evidence from the criterion, sees that cell, picks the one that is wrong
 * and sends it back from there. The agent's worklist then points at that
 * cell — no copying, no conversation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API, PROJECT_PATH } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

test.describe('Artefact viewer', () => {
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Viewer ${RUN}`;
  const dir = path.join(PROJECT_PATH, '.codetrellis', 'e2e-artefacts', RUN);

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('evidence opens at the cited cell, and goes back from the cell that is wrong', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Q3 totals', body: 'Tie totals to the ledger.' }] });
    const item = plan.actionUids[0];

    // The file exists only after the item does, as a real output would.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'totals.csv'), 'region,total\nEMEA,120\nAPAC,80\nAMER,95\n');
    const rel = path.relative(PROJECT_PATH, path.join(dir, 'totals.csv'));

    const agent = await createMcpClient();
    const recorded = JSON.parse((await agent.callTool('record_artefact', {
      item_uid: item, path: rel, role: 'material', note: 'totals.csv',
    })).content[0].text);
    const criterion = await (await request.post(`${API}/items/${item}/criteria`, {
      data: { text: 'Totals tie to the ledger', kind: 'citation' },
    })).json();
    const submitted = await agent.callTool('submit_criterion', {
      criterion_uid: criterion.uid,
      evidence: [{ attachment_uid: recorded.attachment_uid, locator: { range: 'B2' } }],
      note: 'EMEA total in B2',
    });
    expect(submitted.isError, submitted.content?.[0]?.text).toBeFalsy();
    agent.close();

    await gotoWithProject(page);
    await openPlan(page, TITLE);
    await page.getByTestId('plan-item-tree').getByText('Q3 totals').first().click();

    // Open the evidence where it points.
    await page.getByTestId('evidence-link').first().click();
    const viewer = page.getByTestId('artefact-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-cell="B2"]')).toHaveAttribute('data-cited', 'true');
    await expect(viewer.locator('[data-cell="B2"]')).toHaveText('120');

    // The wrong one is B3. Point at it and send back from there.
    await viewer.locator('[data-cell="B3"]').click();
    const bar = viewer.getByTestId('send-back-bar');
    await expect(bar.getByText('Selected B3')).toBeVisible();
    await bar.getByRole('button', { name: /Send back from here/ }).click();
    await bar.getByPlaceholder(/What isn't right at B3/).fill('APAC excludes the Japan restatement');
    await bar.getByRole('button', { name: 'Send back', exact: true }).click();
    await expect(bar.getByText('↩ Sent back from B3')).toBeVisible();

    // The agent reads the place back, not just the words.
    const worklist = await (await request.get(`${API}/plans/${plan.uid}/worklist`)).json();
    const owed = worklist.entries.find((e: { criterionUid: string }) => e.criterionUid === criterion.uid);
    expect(owed.reason).toBe('sent_back');
    expect(owed.note).toBe('APAC excludes the Japan restatement');
    expect(owed.anchors[0]).toMatchObject({ attachmentUid: recorded.attachment_uid, locator: { range: 'B3' } });

    // And the row says where, too.
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(page.getByTestId('criterion-row').getByText(/APAC excludes the Japan restatement — totals\.csv, B3/)).toBeVisible();
  });

  test('the bytes route serves text with the safety headers and a byte range', async ({ request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Q3 notes', body: 'x' }] });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\nline two\n');
    const agent = await createMcpClient();
    const recorded = JSON.parse((await agent.callTool('record_artefact', {
      item_uid: plan.actionUids[0], path: path.relative(PROJECT_PATH, path.join(dir, 'notes.md')), role: 'output',
    })).content[0].text);
    agent.close();

    const full = await request.get(`${API}/artefacts/${recorded.attachment_uid}/content`);
    expect(full.status()).toBe(200);
    expect(full.headers()['x-content-type-options']).toBe('nosniff');
    expect(full.headers()['cache-control']).toBe('no-store');
    expect(await full.text()).toBe('# Notes\nline two\n');

    const part = await request.get(`${API}/artefacts/${recorded.attachment_uid}/content`, { headers: { Range: 'bytes=2-6' } });
    expect(part.status()).toBe(206);
    expect(await part.text()).toBe('Notes');

    const meta = await (await request.get(`${API}/artefacts/${recorded.attachment_uid}`)).json();
    expect(meta.path).toBe(path.relative(PROJECT_PATH, path.join(dir, 'notes.md')).split(path.sep).join('/'));
    expect(JSON.stringify(meta)).not.toContain(PROJECT_PATH);
  });
});

// ── Phase 31.3b — spreadsheets and PDFs ────────────────────────────────

import zlib from 'node:zlib';

/** A real .xlsx: deflated parts, as Office writes them. */
function makeXlsx(): Buffer {
  return makeZip({
    'xl/workbook.xml':
      '<workbook xmlns:r="r"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Regional" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Region</t></si><si><t>Total</t></si><si><t>EMEA</t></si><si><t>APAC</t></si><si><t>AMER</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><dimension ref="A1:A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>See Regional</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml':
      '<worksheet><dimension ref="A1:D4"/><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>120</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3"><v>80</v></c></row>' +
      '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="C4"><v>95</v></c><c r="D4"><f>C4*2</f><v>190</v></c></row>' +
      '</sheetData></worksheet>',
  });
}

/** A zip with every part deflated. */
function makeZip(parts: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const data = zlib.deflateRawSync(raw);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(zlib.crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(zlib.crc32(raw), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(parts).length, 8); eocd.writeUInt16LE(Object.keys(parts).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** A real two-page PDF with text, and an xref table pdf.js does not have to rebuild. */
function makePdf(): Buffer {
  const content = (s: string) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    content('BT /F1 18 Tf 20 100 Td (Page one: EMEA 120) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    content('BT /F1 18 Tf 20 100 Td (Page two: restated total) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test.describe('Artefact viewer — HTML', () => {
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Viewer HTML ${RUN}`;
  const dir = path.join(PROJECT_PATH, '.codetrellis', 'e2e-artefacts', RUN);

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an HTML report never runs in the app: without the sandboxed view, its source is shown as text', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Test report', body: 'The run.' }] });
    const item = plan.actionUids[0];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.html'),
      '<!doctype html><title>run</title><h1>12 passed</h1>\n<script>window.__reportRan = true; document.title = "ran"</script>\n');
    const agent = await createMcpClient();
    const uid = JSON.parse((await agent.callTool('record_artefact', {
      item_uid: item, path: path.relative(PROJECT_PATH, path.join(dir, 'report.html')), role: 'material', note: 'report.html',
    })).content[0].text).attachment_uid as string;
    const criterion = await (await request.post(`${API}/items/${item}/criteria`, { data: { text: 'The suite passed', kind: 'manual' } })).json();
    const submitted = await agent.callTool('submit_criterion', { criterion_uid: criterion.uid, evidence: [{ attachment_uid: uid }], note: 'the report' });
    expect(submitted.isError, submitted.content?.[0]?.text).toBeFalsy();
    agent.close();

    // The route sends HTML as text, sandboxed, never as a page.
    const res = await request.get(`${API}/artefacts/${uid}/content`);
    expect(res.headers()['content-type']).toMatch(/^text\/plain/);
    expect(res.headers()['content-security-policy']).toMatch(/sandbox/);

    await gotoWithProject(page);
    await openPlan(page, TITLE);
    await page.getByTestId('plan-item-tree').getByText('Test report').first().click();
    await page.getByTestId('evidence-link').filter({ hasText: 'report.html' }).click();
    const source = page.getByTestId('artefact-viewer').getByTestId('artefact-html-source');
    await expect(source.getByText(/runs only in its own sandboxed view in the desktop app/)).toBeVisible({ timeout: 15_000 });
    await expect(source.getByText('<h1>12 passed</h1>')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __reportRan?: boolean }).__reportRan)).toBeUndefined();
  });
});

test.describe('Artefact viewer — spreadsheets and PDFs', () => {
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Viewer Office ${RUN}`;
  const dir = path.join(PROJECT_PATH, '.codetrellis', 'e2e-artefacts', RUN);

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a workbook opens on the cited sheet and cell, a PDF on the cited page, one click apart', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Board pack', body: 'Totals and the deck.' }] });
    const item = plan.actionUids[0];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'q3-sales.xlsx'), makeXlsx());
    fs.writeFileSync(path.join(dir, 'board.pdf'), makePdf());
    const rel = (f: string) => path.relative(PROJECT_PATH, path.join(dir, f));

    const agent = await createMcpClient();
    const record = async (f: string) => JSON.parse((await agent.callTool('record_artefact', {
      item_uid: item, path: rel(f), role: 'material', note: f,
    })).content[0].text).attachment_uid as string;
    const sheetUid = await record('q3-sales.xlsx');
    const pdfUid = await record('board.pdf');
    const criterion = await (await request.post(`${API}/items/${item}/criteria`, {
      data: { text: 'Every figure cites its source', kind: 'citation' },
    })).json();
    const submitted = await agent.callTool('submit_criterion', {
      criterion_uid: criterion.uid,
      evidence: [
        { attachment_uid: sheetUid, locator: { sheet: 'Regional', range: 'C3' } },
        { attachment_uid: pdfUid, locator: { page: 2 } },
      ],
      note: 'APAC in Regional!C3; restated on page 2',
    });
    expect(submitted.isError, submitted.content?.[0]?.text).toBeFalsy();
    agent.close();

    await gotoWithProject(page);
    await openPlan(page, TITLE);
    await page.getByTestId('plan-item-tree').getByText('Board pack').first().click();
    await page.getByTestId('evidence-link').filter({ hasText: 'Regional!C3' }).click();

    const viewer = page.getByTestId('artefact-viewer');
    await expect(viewer.getByRole('tab', { name: 'Regional' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(viewer.locator('[data-cell="C3"]')).toHaveAttribute('data-cited', 'true');
    await expect(viewer.locator('[data-cell="C3"]')).toHaveText('80');
    await expect(viewer.locator('[data-cell="D4"]')).toHaveText('190'); // the value as saved, not a formula run here
    await expect(viewer.getByTestId('macro-badge')).toHaveCount(0);

    // The PDF, from the evidence strip — and the way back names where it goes.
    await viewer.getByRole('button', { name: /board\.pdf · page 2/ }).click();
    await expect(viewer.locator('[data-page="2"]')).toHaveAttribute('data-cited', 'true', { timeout: 15_000 });
    await viewer.getByRole('button', { name: /Back to .*q3-sales\.xlsx/ }).click();
    await expect(viewer.locator('[data-cell="C3"]')).toHaveAttribute('data-cited', 'true', { timeout: 15_000 });

    // Send back from the cell that is wrong, on its sheet.
    await viewer.locator('[data-cell="C4"]').click();
    const bar = viewer.getByTestId('send-back-bar');
    await bar.getByRole('button', { name: /Send back from here/ }).click();
    await bar.getByPlaceholder(/What isn't right at Regional!C4/).fill('AMER misses the Canada restatement');
    await bar.getByRole('button', { name: 'Send back', exact: true }).click();
    await expect(bar.getByText('↩ Sent back from Regional!C4')).toBeVisible();

    const owed = (await (await request.get(`${API}/plans/${plan.uid}/worklist`)).json())
      .entries.find((e: { criterionUid: string }) => e.criterionUid === criterion.uid);
    expect(owed.anchors[0]).toMatchObject({ attachmentUid: sheetUid, locator: { sheet: 'Regional', range: 'C4' } });
  });
});

// ── Phase 31.3c — Word documents ───────────────────────────────────────

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** A real .docx: a heading, paragraphs, a table, an embedded image and an external link. */
function makeDocx(): Buffer {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const para = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const image =
    '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="95250" cy="95250"/><wp:docPr id="1" name="Chart" descr="Regional chart"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="1" name="chart.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p>';
  const link = '<w:p><w:r><w:t xml:space="preserve">Figures from </w:t></w:r><w:hyperlink r:id="rIdLink"><w:r><w:t>the source</w:t></w:r></w:hyperlink></w:p>';
  const table =
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Total</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>APAC</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>80</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  return makeZip({
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.png"/>' +
      '<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/source" TargetMode="External"/>' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml':
      `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    'word/document.xml':
      `<w:document ${W}><w:body>` +
      para('Q3 summary', 'Heading1') +
      para('EMEA revenue rose 12% on the quarter.') +
      para('The restated total is 1,240.') +
      table + image + link +
      '</w:body></w:document>',
    'word/media/chart.png': PNG_1PX,
  });
}

test.describe('Artefact viewer — Word documents', () => {
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Viewer Docx ${RUN}`;
  const dir = path.join(PROJECT_PATH, '.codetrellis', 'e2e-artefacts', RUN);

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a document opens on the cited words, reads as text, and goes back from the words that are wrong', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Write the summary', body: 'Q3 summary for the board.' }] });
    const item = plan.actionUids[0];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'q3-summary.docx'), makeDocx());

    const agent = await createMcpClient();
    const docUid = JSON.parse((await agent.callTool('record_artefact', {
      item_uid: item, path: path.relative(PROJECT_PATH, path.join(dir, 'q3-summary.docx')), role: 'material', note: 'the summary',
    })).content[0].text).attachment_uid as string;
    const criterion = await (await request.post(`${API}/items/${item}/criteria`, {
      data: { text: 'The total is the restated one', kind: 'citation' },
    })).json();
    const submitted = await agent.callTool('submit_criterion', {
      criterion_uid: criterion.uid,
      evidence: [{ attachment_uid: docUid, locator: { text: 'restated total is 1,240' } }],
      note: 'Paragraph 2 gives the restated figure',
    });
    expect(submitted.isError, submitted.content?.[0]?.text).toBeFalsy();
    agent.close();

    await gotoWithProject(page);
    await openPlan(page, TITLE);
    await page.getByTestId('plan-item-tree').getByText('Write the summary').first().click();
    await page.getByTestId('evidence-link').filter({ hasText: 'restated total' }).click();

    // No conversion engine in this build: the text view, saying why (§7.6).
    const fallback = page.getByTestId('artefact-viewer').getByTestId('rendition-fallback');
    await expect(fallback.getByText(/Shown as text, not as its pages — /)).toBeVisible({ timeout: 15_000 });
    const doc = fallback.getByTestId('artefact-docx');
    await expect(doc.getByRole('heading', { name: 'Q3 summary' })).toBeVisible({ timeout: 15_000 });
    await expect(doc.locator('[data-cited="true"]')).toHaveText('The restated total is 1,240.');
    await expect(doc.getByRole('cell', { name: 'APAC' })).toBeVisible();
    // The image, from bytes the worker read — never a data: URI in the document's HTML.
    await expect(doc.locator('img')).toHaveAttribute('src', /^blob:/);
    // A link keeps its words and shows where it goes, but cannot navigate the app.
    const link = doc.locator('a', { hasText: 'the source' });
    await expect(link).toHaveAttribute('title', 'https://example.com/source');
    await expect(link).not.toHaveAttribute('href', /.+/);

    // Select the words that are wrong, and send back from them.
    await doc.getByText('EMEA revenue rose 12% on the quarter.').click({ clickCount: 3 });
    const bar = page.getByTestId('artefact-viewer').getByTestId('send-back-bar');
    await bar.getByRole('button', { name: /Send back from here/ }).click();
    await bar.getByPlaceholder(/What isn't right at “EMEA revenue/).fill('EMEA rose 9% after the restatement');
    await bar.getByRole('button', { name: 'Send back', exact: true }).click();
    await expect(bar.getByText(/↩ Sent back from “EMEA revenue/)).toBeVisible();

    const owed = (await (await request.get(`${API}/plans/${plan.uid}/worklist`)).json())
      .entries.find((e: { criterionUid: string }) => e.criterionUid === criterion.uid);
    expect(owed.anchors[0]).toMatchObject({ attachmentUid: docUid, locator: { text: 'EMEA revenue rose 12% on the quarter.' } });
  });
});

test.describe('Artefact viewer — Office files without the engine', () => {
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Viewer Deck ${RUN}`;
  const dir = path.join(PROJECT_PATH, '.codetrellis', 'e2e-artefacts', RUN);

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a deck asks for its rendition, is told why there is none, and says so', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Board deck', body: 'The deck.' }] });
    const item = plan.actionUids[0];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'board.pptx'), makeZip({ 'ppt/presentation.xml': '<p:presentation/>' }));
    const agent = await createMcpClient();
    const uid = JSON.parse((await agent.callTool('record_artefact', {
      item_uid: item, path: path.relative(PROJECT_PATH, path.join(dir, 'board.pptx')), role: 'material', note: 'board.pptx',
    })).content[0].text).attachment_uid as string;
    const criterion = await (await request.post(`${API}/items/${item}/criteria`, {
      data: { text: 'The deck is the one the board saw', kind: 'manual' },
    })).json();
    const submitted = await agent.callTool('submit_criterion', {
      criterion_uid: criterion.uid, evidence: [{ attachment_uid: uid }], note: 'the deck',
    });
    expect(submitted.isError, submitted.content?.[0]?.text).toBeFalsy();
    agent.close();

    // The route: a 503 with a sentence and the fallback flag, never a path.
    const res = await request.get(`${API}/artefacts/${uid}/rendition`);
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.fallback).toBe(true);
    expect(body.error).toMatch(/engine/);
    expect(JSON.stringify(body)).not.toContain(PROJECT_PATH);
    // A file the engine does not convert is not sent to it.
    expect((await request.get(`${API}/artefacts/not-a-real-uid/rendition`)).status()).toBe(404);

    await gotoWithProject(page);
    await openPlan(page, TITLE);
    await page.getByTestId('plan-item-tree').getByText('Board deck').first().click();
    await page.getByTestId('evidence-link').filter({ hasText: 'board.pptx' }).click();
    const viewer = page.getByTestId('artefact-viewer');
    await expect(viewer.getByTestId('rendition-fallback').getByText(/This deck cannot be shown as slides here — /)).toBeVisible({ timeout: 15_000 });
  });
});
