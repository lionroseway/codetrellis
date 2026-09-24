/**
 * Small real files for the reader's tests: a zip builder, and a workbook,
 * a Word document, a deck and a PDF built from it — each the least a real
 * reader (mammoth, pdf.js, our own parsers) accepts.
 */
import zlib from 'node:zlib';

/** A zip with the given entries — the first stored, the rest deflated, as Office mixes them. */
export function makeZip(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  Object.entries(entries).forEach(([name, content], i) => {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const method = i === 0 ? 0 : 8;
    const data = method === 0 ? raw : zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(zlib.crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(zlib.crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Sheets of rows; strings go to shared strings, numbers stay numbers. */
export function makeWorkbook(sheets: Record<string, Array<Array<string | number>>>, opts: { macros?: boolean } = {}): Buffer {
  const shared: string[] = [];
  const names = Object.keys(sheets);
  const col = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
  const parts: Record<string, string | Buffer> = {
    'xl/workbook.xml': `<workbook xmlns:r="r"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  names.forEach((name, i) => {
    const rows = sheets[name];
    const width = Math.max(1, ...rows.map((r) => r.length));
    const cells = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${col(ci + 1)}${ri + 1}`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      shared.push(v);
      return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
    }).join('')}</row>`).join('');
    parts[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><dimension ref="A1:${col(width)}${Math.max(1, rows.length)}"/><sheetData>${cells}</sheetData></worksheet>`;
  });
  parts['xl/sharedStrings.xml'] = `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`;
  if (opts.macros) parts['xl/vbaProject.bin'] = Buffer.from('not really a macro');
  return makeZip(parts);
}

/** Paragraphs (a leading "# " makes a heading) and one table. */
export function makeDocx(paragraphs: string[], table?: string[][]): Buffer {
  const p = (t: string) => t.startsWith('# ')
    ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(t.slice(2))}</w:t></w:r></w:p>`
    : `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  const tbl = table
    ? `<w:tbl>${table.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:p><w:r><w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
    : '';
  return makeZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p).join('')}${tbl}</w:body></w:document>`,
  });
}

/** Slides of [title, ...lines], in the order given. */
export function makeDeck(slides: string[][]): Buffer {
  const parts: Record<string, string> = {
    'ppt/presentation.xml': `<p:presentation><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships>${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  slides.forEach(([title, ...lines], i) => {
    parts[`ppt/slides/slide${i + 1}.xml`] = '<p:sld><p:cSld><p:spTree>' +
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${esc(title)}</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:sp><p:txBody>${lines.map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>` +
      '</p:spTree></p:cSld></p:sld>';
  });
  return makeZip(parts);
}

/** One line of Helvetica text per page. */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((text, i) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
