// Puts each composition's footage and stills in place from captures/, as its
// media.json says. A composition's index.html only ever loads assets/…, so
// this file is where a video records which capture it was cut from.
//
//   { "assets/desktop.mp4": { "from": "captures/parallel-hd/raw.mp4" },
//     "assets/held.jpg":    { "still": "captures/parallel-hd/raw.mp4", "at": 67.5 },
//     "assets/done.png":    { "still": "captures/phone-breakpoint/raw.mp4", "at": "end" } }
//
// Usage: node bin/stage.mjs [composition …]   (all of them when none is named)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const all = fs.readdirSync(path.join(root, 'compositions')).filter((c) => fs.existsSync(path.join(root, 'compositions', c, 'media.json')));
const names = process.argv.slice(2).length ? process.argv.slice(2) : all;

let missing = 0;
for (const name of names) {
  const file = path.join(root, 'compositions', name, 'media.json');
  if (!fs.existsSync(file)) { console.log(`${name}: no media.json, nothing to stage`); continue; }
  const media = JSON.parse(fs.readFileSync(file, 'utf-8'));
  for (const [dest, spec] of Object.entries(media)) {
    if (dest.startsWith('_')) continue; // notes
    const out = path.join(root, 'compositions', name, dest);
    const src = path.join(root, spec.from ?? spec.still);
    if (!fs.existsSync(src)) {
      console.error(`${name}: ${dest} needs ${path.relative(root, src)}, which is not there. Capture it first (README.md, "The workflow").`);
      missing += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (spec.from) {
      fs.copyFileSync(src, out);
    } else {
      const at = spec.at === 'end' ? ['-sseof', '-0.1'] : ['-ss', String(spec.at)];
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...at, '-i', src, '-frames:v', '1', '-q:v', '2', out]);
    }
    console.log(`${name}: ${dest} <- ${path.relative(root, src)}${spec.still ? ` @ ${spec.at}` : ''}`);
  }
}
process.exit(missing ? 1 : 0);
