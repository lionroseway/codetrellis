// Renders every short loop the site needs (clips/site.json) into out/clips/:
// <id>.mp4 (H.264), <id>.webm (VP9), <id>.jpg (poster), and manifest.json
// saying what each shows and where it was cut from, for the website session.
//
// A clip is cropped to the region that matters (no camera move: a loop that
// zooms cannot loop) and loops seamlessly: its last LOOP seconds dissolve over
// its first, so the end flows into the start.
//
// Usage: node bin/clips.mjs [id …]   (all of them when none is named)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const spec = JSON.parse(fs.readFileSync(path.join(root, 'clips', 'site.json'), 'utf8'));
const only = process.argv.slice(2);
const out = path.join(root, 'out', 'clips');
fs.mkdirSync(out, { recursive: true });

const LOOP = 0.6;
const SHAPES = { wide: [1280, 720], card: [960, 600], phone: [540, 1170] };

function sceneStart(src, scene) {
  if (!scene) return 0;
  const f = path.join(root, 'captures', src, 'scenes.json');
  if (!fs.existsSync(f)) throw new Error(`${src} has no scenes.json: capture it with npm run capture clips`);
  const hit = JSON.parse(fs.readFileSync(f, 'utf8')).find((s) => s.scene === scene);
  if (!hit) throw new Error(`${src} has no scene ${scene}: was it recorded from the same demo group?`);
  return hit.at;
}

const manifest = [];
for (const c of spec.clips) {
  if (only.length && !only.includes(c.id)) continue;
  const raw = path.join(root, 'captures', c.src, 'raw.mp4');
  if (!fs.existsSync(raw)) throw new Error(`${c.id}: captures/${c.src}/raw.mp4 is missing; run npm run capture clips`);
  const [W, H] = SHAPES[c.shape];
  const [x, y, w, h] = c.crop;
  if (Math.abs(w / h - W / H) > 0.02 && c.shape !== 'phone') throw new Error(`${c.id}: crop ${w}x${h} is not ${c.shape}'s ${W}:${H}`);
  const start = +(sceneStart(c.src, c.scene) + c.at).toFixed(2);
  // Desktop captures are laid out at 1600x900; a phone is cropped in its own pixels.
  const pre = c.src.startsWith('phone-') ? '' : 'scale=1600:900,';
  const graph = `[0:v]${pre}crop=${w}:${h}:${x}:${y},scale=${W}:${c.shape === 'phone' ? -2 : H}:flags=lanczos,setsar=1,fps=30,split[a][b];`
    + `[a]trim=0:${c.dur},setpts=PTS-STARTPTS[m];`
    + `[b]trim=${c.dur},setpts=PTS-STARTPTS,format=yuva420p,fade=t=out:st=0:d=${LOOP}:alpha=1[t];`
    + `[m][t]overlay=eof_action=pass,format=yuv420p[v]`;
  const input = ['-y', '-loglevel', 'error', '-ss', String(start), '-t', String(c.dur + LOOP), '-i', raw, '-filter_complex', graph, '-map', '[v]', '-an'];
  const mp4 = path.join(out, `${c.id}.mp4`), webm = path.join(out, `${c.id}.webm`), jpg = path.join(out, `${c.id}.jpg`);
  execFileSync(ffmpeg, [...input, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  execFileSync(ffmpeg, [...input, '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-row-mt', '1', webm]);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(+(c.dur * 0.6).toFixed(2)), '-i', mp4, '-frames:v', '1', '-q:v', '3', jpg]);
  const kb = (f) => Math.round(fs.statSync(f).size / 1024);
  manifest.push({ id: c.id, section: c.section, shows: c.shows, width: W, height: c.shape === 'phone' ? null : H, duration: c.dur,
    files: { mp4: `${c.id}.mp4`, webm: `${c.id}.webm`, poster: `${c.id}.jpg` },
    from: { capture: c.src, scene: c.scene, at: c.at, start } });
  console.log(`${c.id.padEnd(20)} ${String(c.dur).padStart(4)} s  ${W}x${c.shape === 'phone' ? '…' : H}  mp4 ${kb(mp4)} KB · webm ${kb(webm)} KB   ${c.shows}`);
}
for (const t of spec.transcripts ?? []) {
  if (only.length && !only.includes(t.id)) continue;
  const src = path.join(root, 'captures', t.src, 'transcript.json');
  if (!fs.existsSync(src)) throw new Error(`${t.id}: captures/${t.src}/transcript.json is missing; run npm run capture clips`);
  fs.copyFileSync(src, path.join(out, `${t.id}.json`));
  manifest.push({ id: t.id, section: t.section, shows: t.shows, files: { transcript: `${t.id}.json` }, from: { capture: t.src } });
  console.log(`${t.id.padEnd(20)} transcript  ${t.shows}`);
}
if (!only.length) {
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ note: 'Loops for codetrellis.dev: autoplay muted, loop, playsinline, poster first. Each says what it shows and which capture it was cut from.', clips: manifest }, null, 2) + '\n');
  console.log(`\nout/clips/: ${manifest.length} items and manifest.json. Look at every poster (and play a few) before handing it over.`);
}
