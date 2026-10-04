// Captured frames (each with the time it was taken) -> constant 30 fps H.264.
// Each frame is held until the next, so a capture at 1 fps keeps real time.
//
// Usage: node encode.cjs <capture-dir> [--blend] [--keep-frames]
//   --blend        dissolve over ~0.2 s where the picture changes (for hd
//                  captures, whose frames are far apart); held frames are untouched.
//   --keep-frames  keep frames/ after encoding. By default it goes: a smooth
//                  capture writes 0.2-2 GB of JPEGs that nothing reads once
//                  raw.mp4 exists, and a full set of captures filled a disk.
// Writes <dir>/raw.mp4, and <dir>/scenes.json when <dir>/demo.log exists:
// each demo scene's start in seconds of raw.mp4, for a composition's
// data-media-start.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = path.resolve(process.argv[2]);
const blend = process.argv.includes('--blend');
const keepFrames = process.argv.includes('--keep-frames');
const ts = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf-8'));
const ext = path.extname(fs.readdirSync(path.join(dir, 'frames')).sort()[0]);
const name = (i) => `frames/${String(i).padStart(6, '0')}${ext}`;

const lines = ['ffconcat version 1.0'];
for (let i = 0; i < ts.length - 1; i++) lines.push(`file '${name(i)}'`, `duration ${Math.max(ts[i + 1] - ts[i], 0.001).toFixed(4)}`);
lines.push(`file '${name(ts.length - 2)}'`);
fs.writeFileSync(path.join(dir, 'list.ffconcat'), lines.join('\n'));

const vf = blend ? 'fps=30,tmix=frames=7,format=yuv420p' : 'fps=30,format=yuv420p';
execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.ffconcat'),
  '-vf', vf, '-c:v', 'libx264', '-preset', process.env.VIDEO_PRESET || 'medium', '-crf', '16',
    // A keyframe every second: a composition seeks into the footage at any
    // point, and x264's default (one in 250) makes the renderer freeze frames.
    '-g', '30', '-keyint_min', '30', '-movflags', '+faststart', path.join(dir, 'raw.mp4')], { stdio: 'inherit' });
console.log(`encode: ${(ts[ts.length - 1] - ts[0]).toFixed(1)} s from ${ts.length - 1} frames -> ${path.relative(process.cwd(), path.join(dir, 'raw.mp4'))}`);
// Only after FFmpeg succeeded (execFileSync throws otherwise).
if (!keepFrames) fs.rmSync(path.join(dir, 'frames'), { recursive: true, force: true });

// demo.log lines are "<epoch seconds> <what the demo printed>"; a scene is "N. Title".
const log = path.join(dir, 'demo.log');
if (fs.existsSync(log)) {
  const scenes = [];
  for (const line of fs.readFileSync(log, 'utf-8').split('\n')) {
    const m = /^(\d+\.\d+) (\d+)\. (.+)$/.exec(line);
    if (m) scenes.push({ scene: Number(m[2]), title: m[3], at: +(Number(m[1]) - ts[0]).toFixed(1) });
  }
  fs.writeFileSync(path.join(dir, 'scenes.json'), JSON.stringify(scenes, null, 2));
  for (const s of scenes) console.log(`  ${String(s.at).padStart(6)} s  ${s.scene}. ${s.title}`);
}
