// Sounds and music made by other people, and the licence each came with.
//
// library/library.json lists every track: where it came from, who made it,
// its licence, and the sha256 of the exact file. The files themselves are
// fetched into library/files/ (not in git) and checked against that hash, so
// what is mixed is what was licensed.
//
// A mix clip from the library says so (`"source": "library:<id>"`), and
// check.mjs refuses one whose id is not here or whose licence is not allowed.
// Credits for licences that need attribution are written beside the video.
//
//   npm run library              list the library and what is fetched
//   npm run library -- fetch     download what is missing, checking each hash
//   npm run library -- credits <audio.json>   the credits a mix needs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const here = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(here, 'library');
const FILES = path.join(DIR, 'files');

/**
 * Licences a published video may use, and whether they need a credit. Not on
 * the list (NC, ND, "personal use", a site's own terms) means not usable.
 */
export const LICENCES = {
  'CC0-1.0': { credit: false },
  'CC-BY-3.0': { credit: true },
  'CC-BY-4.0': { credit: true },
  'Apache-2.0': { credit: false },
};

export function library() {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'library.json'), 'utf8'));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
}

/** The local file for a library id (relative paths are what mix specs carry). */
export function filePath(id) {
  const e = library()[id];
  if (!e) throw new Error(`the library has no "${id}" (audio/library/library.json)`);
  return path.join(FILES, e.file);
}

/** Problems with using this id in a published mix: unknown, not allowed, or not fetched. */
export function usable(id) {
  const e = library()[id];
  if (!e) return `"${id}" is not in audio/library/library.json`;
  if (!LICENCES[e.licence]) return `"${id}" is ${e.licence}, which is not an allowed licence (${Object.keys(LICENCES).join(', ')})`;
  if (!fs.existsSync(filePath(id))) return `"${id}" is not fetched: npm run library -- fetch`;
  return null;
}

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** Downloads every entry that is missing, refusing a file whose hash differs. */
export async function fetchAll({ log = console.log } = {}) {
  fs.mkdirSync(FILES, { recursive: true });
  for (const [id, e] of Object.entries(library())) {
    const dest = path.join(FILES, e.file);
    if (fs.existsSync(dest) && sha(dest) === e.sha256) { log(`  ${id}: have it`); continue; }
    const res = await fetch(e.url);
    if (!res.ok) throw new Error(`${id}: ${e.url} answered ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (got !== e.sha256) throw new Error(`${id}: the file at ${e.url} is not the one licensed (sha256 ${got}, expected ${e.sha256}). Check the source before changing the hash.`);
    fs.writeFileSync(dest, buf);
    log(`  ${id}: fetched ${(buf.length / 1e6).toFixed(1)} MB (${e.licence}, ${e.author})`);
  }
}

/** The credits a mix spec needs: one line per library track whose licence asks for one. */
export function credits(spec) {
  const lib = library();
  const ids = new Set((spec.tracks ?? []).flatMap((t) => t.clips ?? []).map((c) => c.source).filter((s) => s?.startsWith('library:')).map((s) => s.slice(8)));
  return [...ids].filter((id) => lib[id] && LICENCES[lib[id].licence]?.credit)
    .map((id) => `"${lib[id].title}" by ${lib[id].author} (${lib[id].page}), ${lib[id].licence}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'fetch') await fetchAll();
  else if (cmd === 'credits') { for (const c of credits(JSON.parse(fs.readFileSync(arg, 'utf8')))) console.log(c); }
  else {
    for (const [id, e] of Object.entries(library())) {
      console.log(`${id.padEnd(16)} ${e.kind.padEnd(6)} ${e.licence.padEnd(10)} ${fs.existsSync(path.join(FILES, e.file)) ? 'fetched ' : 'missing '} "${e.title}" by ${e.author}`);
    }
  }
}
