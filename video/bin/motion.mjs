// How much moves on screen, second by second, in a capture: so a beat is cut
// where something happens, not on a still state the camera pans across.
//
// Prints one row per bucket (default 0.5 s): the time, a bar, and the scene
// that was running then (from scenes.json beside the capture).
//
// Usage: node bin/motion.mjs captures/<name> [--from=S] [--to=S] [--step=0.5]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('usage: node bin/motion.mjs captures/<name> [--from=S] [--to=S] [--step=0.5]'); process.exit(1); }
const flag = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const from = flag('from', 0), to = flag('to', Infinity), step = flag('step', 0.5);
const ffmpeg = process.env.FFMPEG || 'ffmpeg';

// The mean absolute difference between consecutive frames, per frame.
const out = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'raw.mp4'),
  '-vf', 'scale=80:45:flags=area,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
  '-f', 'null', '-'], { maxBuffer: 256 * 1024 * 1024 }).toString();
const samples = [];
let tNow = 0;
for (const line of out.split('\n')) {
  const t = line.match(/pts_time:([\d.]+)/);
  if (t) tNow = Number(t[1]);
  const y = line.match(/YAVG=([\d.]+)/);
  if (y) samples.push([tNow, Number(y[1])]);
}
const scenesFile = path.join(dir, 'scenes.json');
const scenes = fs.existsSync(scenesFile) ? JSON.parse(fs.readFileSync(scenesFile, 'utf8')) : [];
const sceneAt = (t) => [...scenes].reverse().find((s) => s.at <= t);

const buckets = new Map();
for (const [t, y] of samples) {
  if (t < from || t > to) continue;
  const k = Math.floor(t / step) * step;
  buckets.set(k, Math.max(buckets.get(k) ?? 0, y));
}
// A fixed scale, not the busiest moment's; and measured on an 80x45 average,
// so a spinner or a blinking caret does not read as something happening.
const FULL = 1.5;
let lastScene = null;
for (const [k, y] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
  const s = sceneAt(k);
  const label = s && s !== lastScene ? `  ← ${s.scene}. ${s.title}` : '';
  lastScene = s ?? lastScene;
  console.log(`${k.toFixed(1).padStart(7)} ${'█'.repeat(Math.round(Math.min(y / FULL, 1) * 40)).padEnd(40)} ${y.toFixed(2).padStart(5)}${label}`);
}
