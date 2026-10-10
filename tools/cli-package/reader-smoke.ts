/**
 * The installed package reads a Word document and a PDF.
 *
 *   tsx tools/cli-package/reader-smoke.ts <installed package folder>
 *
 * The package leaves mammoth and pdf.js out of its dependencies: the material
 * reader runs from its own bundle, which carries both (manifest.ts,
 * IN_READER_BUNDLE_ONLY). This proves that bundle is what the installed CLI
 * starts, confined as it is in the app, and that it reads both kinds of file.
 * Run by smoke.sh.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { makeDocx, makePdf } from '../../src/backend/services/material-reader/fixtures.test-helper';

async function main(): Promise<void> {
  const pkg = path.resolve(process.argv[2] ?? '');
  const host = createRequire(path.join(pkg, 'package.json'))('./src/backend/services/material-reader/reader-host.js') as typeof import('../../src/backend/services/material-reader/reader-host');
  const script = host.readerScript();
  if (script !== path.join(pkg, 'reader', 'material-reader.mjs')) throw new Error(`the CLI would start ${script}, not the package's reader bundle`);

  const files = [
    { name: 'brief.docx', ext: 'docx', bytes: makeDocx(['The EMEA brief', 'Revenue rose 12 percent']), says: 'Revenue rose 12 percent' },
    { name: 'pack.pdf', ext: 'pdf', bytes: makePdf(['Cover', 'EMEA rose 12 percent']), says: 'EMEA rose 12 percent' },
  ];
  for (const f of files) {
    const reply = await host.runReader({ name: f.name, ext: f.ext, bytes: new Uint8Array(f.bytes) });
    if (!reply.ok) throw new Error(`${f.name}: ${reply.reason}`);
    const text = reply.sections.map((s) => `${s.heading}\n${s.body}`).join('\n');
    if (!text.includes(f.says)) throw new Error(`${f.name} read as: ${text.slice(0, 200)}`);
    console.log(`${f.name}: ok`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
