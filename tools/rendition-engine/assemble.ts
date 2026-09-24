/**
 * Phase 31 §7.6 — turn a finished LibreOffice build into the engine the app runs.
 *
 *   npx tsx tools/rendition-engine/assemble.ts <build-out> <engine-dir>
 *
 * Copies the build's output and our driver into <engine-dir>, runs the
 * network proof, and writes `engine.json`: every file's sha256, where it was
 * built from, and `networkFree` — true only if the proof passed. Prints the
 * `engine-lock.json` entry for the archive CI will publish; the archive's own
 * hash is added once it exists (`--lock <archive> <url>`).
 *
 * The version names the recipe, not the run: LibreOffice's commit, and a hash
 * of everything in this directory that decides what gets built. Two builds
 * of one recipe share a version, and the pin tells them apart by hash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { proveNetworkFree } from '../../src/backend/services/rendition/network-proof';

const HERE = __dirname;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** Everything that decides what the build produces or how the engine is driven. */
const RECIPE = ['build.sh', 'autogen.input', 'no-network.js', 'patches/wasm-build-fixes.patch', 'runtime/adapter.cjs'];

export function recipeHash(): string {
  const h = createHash('sha256');
  for (const rel of RECIPE) h.update(`${rel}\0`).update(fs.readFileSync(path.join(HERE, rel))).update('\0');
  return h.digest('hex');
}

interface BuildInfo { libreoffice: { repository: string; commit: string }; emscripten: string; emcc: string }

function readInfo(buildOut: string): BuildInfo {
  return JSON.parse(fs.readFileSync(path.join(buildOut, 'build-info.json'), 'utf8')) as BuildInfo;
}

export function engineVersion(info: BuildInfo): string {
  return `24.8-${info.libreoffice.commit.slice(0, 10)}-${recipeHash().slice(0, 12)}`;
}

function assemble(buildOut: string, engineDir: string): void {
  const info = readInfo(buildOut);
  const version = engineVersion(info);

  fs.rmSync(engineDir, { recursive: true, force: true });
  fs.mkdirSync(engineDir, { recursive: true });
  const glue = ['soffice.mjs', 'soffice.cjs'].find((f) => fs.existsSync(path.join(buildOut, f)));
  if (!glue) throw new Error(`no glue (soffice.mjs / soffice.cjs) in ${buildOut}`);
  const parts = ['soffice.wasm', 'soffice.data', glue, ...fs.readdirSync(buildOut).filter((f) => /^soffice\.worker\./.test(f))];
  for (const f of parts) fs.copyFileSync(path.join(buildOut, f), path.join(engineDir, f));
  fs.copyFileSync(path.join(HERE, 'runtime', 'adapter.cjs'), path.join(engineDir, 'adapter.cjs'));

  const proof = proveNetworkFree(
    fs.readFileSync(path.join(engineDir, 'soffice.wasm')),
    fs.readFileSync(path.join(engineDir, glue), 'utf8'),
    fs.readFileSync(path.join(engineDir, 'adapter.cjs'), 'utf8'),
  );
  const files: Record<string, string> = {};
  for (const f of [...parts, 'adapter.cjs'].sort()) files[f] = sha256(fs.readFileSync(path.join(engineDir, f)));

  const manifest = {
    name: 'libreoffice-wasm',
    version,
    adapter: 'adapter.cjs',
    files,
    networkFree: proof.networkFree,
    source: {
      libreoffice: info.libreoffice,
      emscripten: info.emscripten,
      emcc: info.emcc,
      recipe: recipeHash(),
      patch: 'tools/rendition-engine/patches/wasm-build-fixes.patch (MPL-2.0, from matbeedotcom/libreoffice-document-converter)',
      run: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    },
    proof: { imports: proof.imports, networkImports: proof.networkImports.length, stubs: proof.stubs, failures: proof.failures },
  };
  fs.writeFileSync(path.join(engineDir, 'engine.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ version, networkFree: proof.networkFree, failures: proof.failures, files }, null, 2));
  if (!proof.networkFree) process.exitCode = 1;
}

/** The engine-lock.json entry for a published archive. */
function lock(engineDir: string, archive: string, url: string): void {
  const m = JSON.parse(fs.readFileSync(path.join(engineDir, 'engine.json'), 'utf8'));
  const entry = {
    version: m.version,
    networkFree: m.networkFree === true,
    archive: { url, sha256: sha256(fs.readFileSync(archive)) },
    files: m.files,
  };
  process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--lock' && args.length === 4) lock(args[1], args[2], args[3]);
  else if (args[0] === '--version' && args.length === 2) console.log(engineVersion(readInfo(args[1])));
  else if (args.length === 2) assemble(args[0], args[1]);
  else {
    console.error('usage: assemble.ts <build-out> <engine-dir> | --lock <engine-dir> <archive> <url> | --version <build-out>');
    process.exit(2);
  }
}
