// Builds one talk demo (index.html) from its beats.mjs.
//
// These are not the site's hero: they play behind a person talking, in a
// room. So the product fills the frame, the camera goes to the thing being
// said and stays there long enough to read from the back, and the only words
// are one caption per beat. Nothing is drawn of the app: the window is the
// recording (captures/talk-hd), the phone is the phone's own screen
// (captures/phone-talk-steer).
//
// A beat: { dur, clip, shots, caption, layout?, trimmed?, phone? }
//   clip     talk(scene, at): the recording, `at` seconds into demo scene
//            `scene` (scripts/demo/groups/talk.ts prints them as "N. Title")
//   shots    camera keyframes: { fx, fy, z } is footage point (fx, fy), in
//            the app's own layout pixels, centred at z times "the whole window
//            fits"; later ones add { at, d }: reached `at` seconds into the
//            beat over `d` seconds. None: the whole window.
//   layout   'full' (default) or 'phone': the window to the left, the phone
//            beside it. `phone: { src, at, taps, for }` plays the phone recording
//            from `at` seconds into the beat, and stays `for` seconds.
//   trimmed  false when this beat carries straight on from the last one. Any
//            other cut skips time (a model thinking, a wait), and says so on
//            screen for a moment: nothing is sped up.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rich = (s) => esc(s).replace(/&lt;(\/?)(b|code)&gt;/g, '<$1$2>');
const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, '');

const MOVE = 0.9;        // seconds the window takes between layouts
const DISSOLVE = 0.35;   // seconds one moment dissolves into the next
const PHONE = { w: 390, h: 844, k: 1.12 };

const FRAMES = {
  full: { x: 0, y: 0, w: 1920, h: 1080, r: 0 },
  phone: { x: 48, y: 150, w: 1312, h: 738, r: 14 },
};

export function build(here, { id, num, title, beats: input, W = 1440, H = 810 }) {
  const scenes = new Map();
  const sceneStart = (src, scene) => {
    if (scene === 0) return 0;
    if (!scenes.has(src)) {
      const f = path.join(here, 'assets', src.replace(/\.mp4$/, '.scenes.json'));
      if (!fs.existsSync(f)) throw new Error(`${src} has no scenes.json beside it: run npm run stage ${id}`);
      scenes.set(src, JSON.parse(fs.readFileSync(f, 'utf8')));
    }
    const hit = scenes.get(src).find((s) => s.scene === scene);
    if (!hit) throw new Error(`${src} has no scene ${scene}: was it recorded from the talk group?`);
    return hit.at;
  };

  let t = 0;
  const beats = input.map((b, i) => {
    const at = +t.toFixed(2);
    t += b.dur;
    return { ...b, i, at, layout: b.layout ?? 'full', start: +(sceneStart(b.clip.src, b.clip.scene) + b.clip.at).toFixed(2) };
  });
  const TOTAL = +t.toFixed(2);

  const cam = (frame, { fx = W / 2, fy = H / 2, z = 1 } = {}) => {
    const s = Math.max(frame.w / W, frame.h / H) * z;
    const x = Math.min(0, Math.max(frame.w - W * s, frame.w / 2 - fx * s));
    const y = Math.min(0, Math.max(frame.h - H * s, frame.h / 2 - fy * s));
    return { x: +x.toFixed(1), y: +y.toFixed(1), scale: +s.toFixed(4) };
  };
  const css = (f) => ({ left: f.x, top: f.y, width: f.w, height: f.h, borderRadius: f.r });

  const js = [];
  const clips = [];
  const layers = [];
  let lastShot = null;

  beats.forEach((b, i) => {
    const prev = beats[i - 1];
    const last = i === beats.length - 1;
    const frame = FRAMES[b.layout];
    const shots = b.shots?.length ? b.shots : [{}];
    const first = cam(frame, shots[0]);

    if (!prev) {
      js.push(`gsap.set('#frame', ${JSON.stringify(css(frame))});`);
      js.push(`gsap.set('#cam', ${JSON.stringify(first)});`);
    } else {
      const moved = prev.layout !== b.layout;
      const d = moved ? MOVE : 0.7;
      if (moved) js.push(`tl.to('#frame', { ...${JSON.stringify(css(frame))}, duration: ${MOVE}, ease: 'power3.inOut' }, ${b.at - MOVE / 2});`);
      if (JSON.stringify(first) !== JSON.stringify(lastShot)) js.push(`tl.to('#cam', { ...${JSON.stringify(first)}, duration: ${d}, ease: 'power3.inOut' }, ${+(b.at - d / 2).toFixed(2)});`);
    }
    lastShot = first;
    for (const sh of shots.slice(1)) {
      const to = cam(frame, sh);
      js.push(`tl.to('#cam', { ...${JSON.stringify(to)}, duration: ${sh.d ?? 1.2}, ease: 'power2.inOut' }, ${+(b.at + sh.at).toFixed(2)});`);
      lastShot = to;
    }

    // The footage: a beat that carries on from the last one shares its clip.
    const carries = prev && b.trimmed === false && Math.abs((prev.start + prev.dur) - b.start) < 0.05;
    if (!carries) {
      let run = b.dur;
      for (let k = i + 1; k < beats.length && beats[k].trimmed === false && Math.abs((beats[k - 1].start + beats[k - 1].dur) - beats[k].start) < 0.05; k += 1) run += beats[k].dur;
      const lead = prev ? DISSOLVE : 0;
      const start = +(b.at - lead).toFixed(2);
      const ends = beats.find((x) => x.at >= b.at + run - 0.01);
      const dur = +(run + lead + (ends ? DISSOLVE + 0.1 : 0)).toFixed(2);
      const vid = `v${i}`;
      clips.push(`<video id="${vid}" class="clip" src="assets/${b.clip.src}" muted playsinline data-start="${start}" data-duration="${dur}" data-media-start="${Math.max(b.start - lead, 0).toFixed(2)}"></video>`);
      if (prev) {
        js.push(`tl.fromTo('#${vid}', { opacity: 0 }, { opacity: 1, duration: ${DISSOLVE}, ease: 'none', immediateRender: false }, ${start});`);
        js.push(`tl.fromTo('#trim', { opacity: 0 }, { opacity: 1, duration: 0.25, immediateRender: false }, ${start});`);
        js.push(`tl.to('#trim', { opacity: 0, duration: 0.4 }, ${+(b.at + 1.5).toFixed(2)});`);
      }
    }

    // The caption: in as the beat opens, out before the next.
    if (b.caption) {
      const cid = `c${i}`;
      const inAt = +(b.at + (prev ? 0.2 : 0.4)).toFixed(2);
      layers.push(`<div class="cap${b.layout === 'phone' ? ' beside' : ''}" id="${cid}"><span class="n">${esc(num)}</span><span class="t">${rich(b.caption)}</span></div>`);
      js.push(`tl.fromTo('#${cid}', { opacity: 0, y: 22, xPercent: -50 }, { opacity: 1, y: 0, xPercent: -50, duration: 0.45, ease: 'expo.out' }, ${inAt});`);
      if (!last) js.push(`tl.to('#${cid}', { opacity: 0, y: -8, duration: 0.25, ease: 'power2.in' }, ${+(b.at + b.dur - 0.3).toFixed(2)});`);
    }

    // The phone, beside the window.
    if (b.phone) {
      const p = b.phone;
      const pid = `p${i}`;
      const pStart = +(b.at + p.at).toFixed(2);
      // `for`: seconds the phone stays, when that is longer than its beat (the beats that carry on from it).
      const shown = p.for ?? b.dur;
      const len = Math.min(p.length, b.at + shown - pStart);
      const taps = (p.taps ?? []).map((tap, k) => {
        const when = pStart + tap.at;
        js.push(`gsap.set('#${pid}t${k}', { scale: 0.4, opacity: 0 });`);
        js.push(`tl.to('#${pid}t${k}', { opacity: 1, scale: 1, duration: 0.16, ease: 'power2.out' }, ${(when - 0.14).toFixed(2)});`);
        js.push(`tl.to('#${pid}t${k}', { opacity: 0, scale: 1.7, duration: 0.45, ease: 'power2.out' }, ${(when + 0.06).toFixed(2)});`);
        return `<div class="tap" id="${pid}t${k}" style="left:${tap.x}px;top:${tap.y}px"></div>`;
      }).join('');
      layers.push(`<div class="phone" id="${pid}"><div class="screen">
        <img id="${pid}f" class="clip" src="assets/${p.first}" alt="" data-start="${b.at}" data-duration="${shown}" />
        <img id="${pid}e" class="clip" src="assets/${p.end}" alt="" data-start="${b.at}" data-duration="${shown}" />
        <video id="${pid}v" class="clip" src="assets/${p.src}" muted playsinline data-start="${pStart}" data-duration="${len.toFixed(2)}" data-media-start="0"></video>${taps}</div><div class="island"></div></div>`);
      js.push(`gsap.set('#${pid}e', { opacity: 0 });`);
      js.push(`tl.set('#${pid}e', { opacity: 1 }, ${(pStart + 0.5).toFixed(2)});`);
      js.push(`tl.fromTo('#${pid}', { x: 620, rotation: 5 }, { x: 0, rotation: 0, duration: 1, ease: 'expo.out', immediateRender: true }, ${Math.max(b.at - 0.2, 0)});`);
      if (b.at + shown < TOTAL - 0.05) js.push(`tl.to('#${pid}', { x: 620, duration: 0.6, ease: 'power2.in' }, ${+(b.at + shown - 0.4).toFixed(2)});`);
    }
  });

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <!-- Generated by talk/build.mjs from beats.mjs: edit those, not this. -->
    <title>${esc(title)}</title>
    <script src="assets/gsap.min.js"></script>
    <style>
@font-face { font-family: "Geist"; src: url(assets/geist-sans-latin-500-normal.woff2) format("woff2"); font-weight: 500; }
@font-face { font-family: "Geist"; src: url(assets/geist-sans-latin-600-normal.woff2) format("woff2"); font-weight: 600; }
@font-face { font-family: "Geist Mono"; src: url(assets/geist-mono-latin-500-normal.woff2) format("woff2"); font-weight: 500; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1920px; height: 1080px; overflow: hidden; background: #05080f; }
body { font-family: "Geist", "Liberation Sans", sans-serif; color: #0b1220; -webkit-font-smoothing: antialiased; }
#root { position: absolute; inset: 0; overflow: hidden; background: radial-gradient(1200px 800px at 80% 30%, #10203f, #05080f 70%); }
#frame { position: absolute; overflow: hidden; background: #0b0f17; box-shadow: 0 30px 80px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }
#cam { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0; }
#cam .clip { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; display: block; }
.cap { position: absolute; left: 50%; bottom: 40px; white-space: nowrap; display: flex; align-items: center; gap: 20px;
  padding: 18px 32px 18px 20px; border-radius: 18px; background: #fff; box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(11,18,32,.08); }
.cap.beside { left: 704px; }
.cap .n { font: 500 20px "Geist Mono", monospace; color: #1a46c4; background: #eaf0ff; border-radius: 9px; padding: 7px 11px; }
.cap .t { font-size: 38px; font-weight: 500; letter-spacing: -.015em; }
.cap .t b { font-weight: 600; color: #2f6bff; }
.cap .t code { font: 500 34px "Geist Mono", monospace; color: #b5530b; }
#trim { position: absolute; right: 36px; top: 30px; opacity: 0; font: 500 17px "Geist Mono", monospace; letter-spacing: .12em;
  color: #0b1220; background: rgba(255,255,255,.92); border-radius: 30px; padding: 9px 16px; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
.phone { position: absolute; left: 1408px; top: 22px; width: ${PHONE.w * PHONE.k + 28}px; height: ${PHONE.h * PHONE.k + 28}px; border-radius: 58px; background: #0d1017;
  box-shadow: 0 0 0 2px #2a3140, 0 40px 90px rgba(0,0,0,.6); }
.phone .screen { position: absolute; left: 14px; top: 14px; width: ${PHONE.w}px; height: ${PHONE.h}px; border-radius: 42px; overflow: hidden; background: #0a0a0c; transform: scale(${PHONE.k}); transform-origin: 0 0; }
.phone .screen .clip { position: absolute; left: 0; top: 0; width: ${PHONE.w}px; height: ${PHONE.h}px; display: block; }
.phone .island { position: absolute; left: 50%; top: 24px; width: 104px; height: 28px; margin-left: -52px; border-radius: 16px; background: #000; }
.phone .screen .clip { top: 34px; }
.tap { position: absolute; width: 56px; height: 56px; margin: 6px 0 0 -28px; border-radius: 50%; background: rgba(255,255,255,.35); border: 2px solid rgba(255,255,255,.9); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080">
      <div id="frame"><div id="cam">
        ${clips.join('\n        ')}
      </div></div>
      ${layers.join('\n      ')}
      <div id="trim">TIME TRIMMED</div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${js.join('\n      ')}
      window.__timelines = window.__timelines || {};
      window.__timelines['main'] = tl;
    </script>
  </body>
</html>
`;
  fs.writeFileSync(path.join(here, 'index.html'), html);
  // Each beat's time and words, for bin/review.mjs to photograph.
  fs.writeFileSync(path.join(here, 'timing.json'), JSON.stringify(beats.map((b) => ({
    act: id, at: b.at, dur: b.dur, layout: b.layout, words: plain(b.caption ?? ''),
    media: `${b.clip.src} @ ${b.start}s (scene ${b.clip.scene} + ${b.clip.at})`, vo: null,
  })), null, 2) + '\n');
  console.log(`${id}: ${beats.length} beats, ${TOTAL} s`);
}
