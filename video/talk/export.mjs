// The talk's deliverables, from the rendered compositions, into out/talk/:
//
//   demo-01-plan.mp4 … demo-07-breakpoint.mp4
//       1920x1080, 30 fps, H.264 (yuv420p), no audio track: narrated live.
//   demo-0N-still.png      a fallback still per demo: its end frame, or the
//                          beat its beats.mjs names as `still` (demo 07's is
//                          the held edit with its three choices).
//
// Usage: node talk/export.mjs      (after `npm run render <each>`; talk/record.sh does both)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const ffprobe = process.env.FFPROBE || 'ffprobe';
const out = path.join(root, 'out', 'talk');
fs.mkdirSync(out, { recursive: true });
const run = (args) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const frame = (src, at, dest) => run(['-ss', String(at), '-i', src, '-frames:v', '1', dest]);

const DEMOS = ['demo-01-plan', 'demo-02-build', 'demo-03-rules', 'demo-04-review', 'demo-05-epic', 'demo-06-overlap', 'demo-07-breakpoint'];
for (const name of DEMOS) {
  const src = path.join(root, 'out', `${name}.mp4`);
  if (!fs.existsSync(src)) { console.error(`out/${name}.mp4 is not rendered: npm run render ${name}`); process.exitCode = 1; continue; }
  const dest = path.join(out, `${name}.mp4`);
  run(['-i', src, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '30', '-movflags', '+faststart', dest]);
  const dur = Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dest], { encoding: 'utf8' }));
  const beats = JSON.parse(fs.readFileSync(path.join(root, 'compositions', name, 'timing.json'), 'utf8'));
  const { default: demo } = await import(path.join(root, 'compositions', name, 'beats.mjs'));
  const b = demo.still === undefined ? null : beats[demo.still];
  const at = b ? b.at + b.dur * 0.75 : Math.max(dur - 0.2, 0);
  frame(dest, at.toFixed(2), path.join(out, `${name.slice(0, 7)}-still.png`));
  console.log(`out/talk/${name}.mp4  ${dur.toFixed(1)} s, ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
}

// One page to watch them through on: each video, its still, and what every
// beat claims, so a caption can be checked against its picture.
const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sections = [];
// "talk.mp4 @ 95.6s (scene 9 + 1)" -> "scene 9 + 1"
const from = (m) => m.slice(m.lastIndexOf('(') + 1, -1);
for (const name of DEMOS) {
  if (!fs.existsSync(path.join(out, `${name}.mp4`))) continue;
  const { default: demo } = await import(path.join(root, 'compositions', name, 'beats.mjs'));
  const beats = JSON.parse(fs.readFileSync(path.join(root, 'compositions', name, 'timing.json'), 'utf8'));
  const still = `${name.slice(0, 7)}-still.png`;
  const total = beats.reduce((n, b) => n + b.dur, 0);
  sections.push(`<section><h2><span>${esc(demo.num)}</span>${esc(demo.title)}</h2>
  <p class="meta">${esc(name)}.mp4 · ${total.toFixed(1)} s · still: ${esc(still)}</p>
  <video controls muted playsinline preload="metadata" src="${name}.mp4" poster="${still}"></video>
  <ol>${beats.map((b) => `<li><time>${b.at.toFixed(1)} s</time><span>${esc(b.words)}</span><em>${esc(from(b.media))}</em></li>`).join('')}</ol></section>`);
}
fs.writeFileSync(path.join(out, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Talk demos: watch-through</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: dark; }
body { margin: 0; padding: 32px 16px 80px; background: #0b0f17; color: #e6ebf5; font: 16px/1.5 -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 30px; margin: 0 0 6px; } h2 { font-size: 22px; margin: 44px 0 4px; }
h2 span { font: 500 14px ui-monospace, monospace; color: #9db8ff; background: #17223d; border-radius: 6px; padding: 3px 8px; margin-right: 10px; vertical-align: middle; }
.meta, .lede { color: #8e9bb5; margin: 0 0 12px; } video { width: 100%; border-radius: 10px; background: #000; display: block; }
ol { list-style: none; padding: 0; margin: 12px 0 0; } li { display: grid; grid-template-columns: 64px 1fr; gap: 2px 12px; padding: 7px 0; border-top: 1px solid #1c2538; }
time { color: #8e9bb5; font: 13px ui-monospace, monospace; padding-top: 3px; } em { grid-column: 2; font-style: normal; font-size: 13px; color: #6f7c96; }
.notes { margin-top: 48px; padding: 16px 20px; border: 1px solid #2a3550; border-radius: 10px; } .notes li { display: list-item; border: 0; padding: 3px 0; } .notes ul { margin: 8px 0 0; padding-left: 20px; }
</style><main>
<h1>Talk demos: watch-through</h1>
<p class="lede">1920×1080, 30 fps, H.264, no audio. Under each video: what every beat's caption claims, and the demo scene it was cut from. Pause on a beat and check the picture shows its words.</p>
${sections.join('\n')}
<div class="notes"><strong>What these are</strong><ul>
<li>The agents are scripted MCP clients that connect as Claude Code does; nothing waits on a model, and nothing is sped up. Every cut says "time trimmed".</li>
<li>The app is the web build from source in a headless browser, so a person's action shows "unverified" where the desktop window's would not.</li>
<li>The phone in demo 07 is the real phone screens shown the same held edit from a fixture: it is not paired live.</li>
<li>No CI system is on screen: demo 03 shows the check in a terminal and the kept run.</li>
</ul></div></main></html>
`);


console.log(fs.readdirSync(out).sort().join('  '));
