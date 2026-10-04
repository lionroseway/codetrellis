// Frees the disk this folder fills, keeping what a render needs.
//
//   node bin/clean.mjs          frames left in captures/ (by --keep-frames or an
//                               interrupted capture), HyperFrames' temporary
//                               render folders in out/, and footage staged into
//                               compositions/*/assets (render and review stage it
//                               again). Keeps captures/*/raw.mp4 and out/.
//   node bin/clean.mjs --all    also captures/ and out/: everything, back to what
//                               is in git (the next run captures from nothing)
//
// `npm run site` runs the first at the end. A full set of smooth captures was
// 5 GB of frames, and a render then died for want of temporary space.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const all = process.argv.includes('--all');

function size(p) {
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0);
}
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d).map((f) => path.join(d, f)) : []);
// Folders only (macOS leaves .DS_Store files beside them).
const dirs = (d) => ls(d).filter((p) => fs.statSync(p).isDirectory());

const doomed = [];
if (all) doomed.push(path.join(root, 'captures'), path.join(root, 'out'));
else {
  for (const cap of dirs(path.join(root, 'captures'))) doomed.push(path.join(cap, 'frames'));
  // HyperFrames' own temporary names (work-<uuid>-xxxxxx, hf-render-xxxxxx,
  // <output>.assemble-work-xxxxxx): left behind when a render dies.
  for (const f of ls(path.join(root, 'out'))) {
    if (/^(work-[0-9a-f-]{36}-|hf-render-)[A-Za-z0-9]{6}$|\.assemble-work-/.test(path.basename(f))) doomed.push(f);
  }
}
// Footage and stills staged from captures/ (fonts, GSAP and the logo stay:
// `npm run setup` put those there, and nothing re-stages them on a render).
for (const comp of dirs(path.join(root, 'compositions'))) {
  for (const f of ls(path.join(comp, 'assets'))) {
    if (/\.(mp4|png|jpe?g)$|\.scenes\.json$|^ci-transcript\.json$/.test(path.basename(f)) && path.basename(f) !== 'logo.png') doomed.push(f);
  }
}

let freed = 0;
for (const p of doomed) {
  const n = size(p);
  if (!n && !fs.existsSync(p)) continue;
  fs.rmSync(p, { recursive: true, force: true });
  freed += n;
  console.log(`removed ${path.relative(root, p)} (${(n / 1e6).toFixed(0)} MB)`);
}
console.log(`freed ${(freed / 1e9).toFixed(2)} GB${all ? '' : ' (raw captures and out/ kept; --all removes those too)'}`);
