/**
 * Phase 31 §7.6 — `npx tsx tools/rendition-engine/prove-network-free.ts <engine-dir>`
 *
 * Runs the proof in src/backend/services/rendition/network-proof.ts on a
 * built engine; prints the report and exits 1 if the engine is not
 * network-free. CI will not publish an engine that fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { proveNetworkFree } from '../../src/backend/services/rendition/network-proof';

const dir = process.argv[2];
if (!dir) { console.error('usage: prove-network-free.ts <engine-dir>'); process.exit(2); }
const gluePath = ['soffice.mjs', 'soffice.cjs'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
if (!gluePath) { console.error(`no glue (soffice.mjs / soffice.cjs) in ${dir}`); process.exit(2); }

const adapterPath = path.join(dir, 'adapter.cjs');
const proof = proveNetworkFree(
  fs.readFileSync(path.join(dir, 'soffice.wasm')),
  fs.readFileSync(gluePath, 'utf8'),
  fs.existsSync(adapterPath) ? fs.readFileSync(adapterPath, 'utf8') : null,
);
console.log(JSON.stringify({ engine: dir, glue: path.basename(gluePath), ...proof }, null, 2));
process.exit(proof.networkFree ? 0 : 1);
