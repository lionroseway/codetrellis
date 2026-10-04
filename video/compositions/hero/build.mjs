// Builds the hero (index.html) from beats.mjs.
//
// One window for the whole film. A beat names a layout (bleed, title,
// split with the text on one side, full) and the footage in it; between
// beats the window glides to the next layout while the new footage
// dissolves in inside it, so nothing cuts and nothing jumps. Text moves
// around the window, never over the product unless it is a caption.
//
// Usage: node build.mjs   (bin/render.sh hero runs it)
import fs from 'node:fs';
import path from 'node:path';
import { ACTS } from './beats.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Text that may carry <b>, <code> and <br>: everything else escaped. */
const rich = (s) => esc(s).replace(/&lt;(\/?)(b|code|br)&gt;/g, '<$1$2>');

const W = 1600, H = 900;          // the app's layout, as captured
const MOVE = 1.0;                 // seconds the window takes between layouts
const PRE = MOVE / 2;             // the next footage starts this early, under the move

/** Where the window sits in each layout (screen pixels). */
const FRAMES = {
  bleed: { x: 0, y: 0, w: 1920, h: 1080, r: 0 },
  title: { x: 400, y: 612, w: 1120, h: 630, r: 14 },
  full: { x: 160, y: 90, w: 1600, h: 900, r: 14 },
  'split-text-left': { x: 832, y: 261, w: 992, h: 558, r: 14 },
  'split-text-right': { x: 96, y: 261, w: 992, h: 558, r: 14 },
  end: { x: 560, y: 760, w: 800, h: 450, r: 14 },
};
const layoutOf = (b) => (b.layout === 'split' ? `split-text-${b.text ?? 'left'}` : b.layout);

/**
 * The camera inside the window: footage point (fx, fy) at the frame's
 * centre, zoomed z times past "the whole window fits", kept on the footage.
 */
function cam(frame, { fx = W / 2, fy = H / 2, z = 1 } = {}) {
  const s = Math.max(frame.w / W, frame.h / H) * z;
  const x = Math.min(0, Math.max(frame.w - W * s, frame.w / 2 - fx * s));
  const y = Math.min(0, Math.max(frame.h - H * s, frame.h / 2 - fy * s));
  return { x: +x.toFixed(1), y: +y.toFixed(1), scale: +s.toFixed(4) };
}
const frameCss = (f) => ({ left: f.x, top: f.y, width: f.w, height: f.h, borderRadius: f.r });

const beats = ACTS.flatMap((a) => a.beats.map((b) => ({ ...b, act: a.id })));
let t = 0;
for (const b of beats) { b.at = +t.toFixed(2); t += b.dur; }
const TOTAL = +t.toFixed(2);

const js = [];
const clips = [];
const layers = [];
let n = 0;
const id = (p) => `${p}${++n}`;

beats.forEach((b, i) => {
  const frame = FRAMES[layoutOf(b)];
  const shots = b.shots?.length ? b.shots : [{}];
  const first = cam(frame, shots[0]);
  const prev = beats[i - 1];
  const last = i === beats.length - 1;

  // The window and camera: set for the first beat, glided to for the rest.
  if (!prev) {
    js.push(`gsap.set('#frame', ${JSON.stringify(frameCss(frame))});`);
    js.push(`gsap.set('#cam', ${JSON.stringify(first)});`);
  } else {
    const at = Math.max(b.at - PRE, 0);
    js.push(`tl.to('#frame', { ...${JSON.stringify(frameCss(frame))}, duration: ${MOVE}, ease: 'power3.inOut' }, ${at});`);
    js.push(`tl.to('#cam', { ...${JSON.stringify(first)}, duration: ${MOVE}, ease: 'power3.inOut' }, ${at});`);
  }
  // Camera moves within the beat; with none, a slow push so it never sits still.
  if (shots.length > 1) {
    for (const sh of shots.slice(1)) {
      js.push(`tl.to('#cam', { ...${JSON.stringify(cam(frame, sh))}, duration: ${sh.d ?? 1.4}, ease: '${sh.ease ?? 'power2.inOut'}' }, ${b.at + sh.at});`);
    }
  } else if (b.drift !== false) {
    const sh = shots[0];
    js.push(`tl.to('#cam', { ...${JSON.stringify(cam(frame, { ...sh, z: (sh.z ?? 1) * 1.045 }))}, duration: ${Math.max(b.dur - PRE - 0.2, 0.5)}, ease: 'none' }, ${b.at + PRE});`);
  }

  // The footage: it starts under the move and dissolves in inside the window.
  if (b.media) {
    const vid = id('v');
    const start = +Math.max(b.at - (prev ? PRE : 0), 0).toFixed(2);
    const dur = +(b.at + b.dur - start + (last ? 0 : PRE + 0.3)).toFixed(2);
    const mediaStart = +Math.max((b.media.start ?? 0) - (b.at - start), 0).toFixed(2);
    clips.push(b.media.img
      ? `<img id="${vid}" class="clip" src="assets/${b.media.img}" alt="" data-start="${start}" data-duration="${dur}" />`
      : `<video id="${vid}" class="clip" src="assets/${b.media.src}" muted playsinline data-start="${start}" data-duration="${dur}" data-media-start="${mediaStart}"></video>`);
    if (prev) js.push(`tl.fromTo('#${vid}', { opacity: 0 }, { opacity: 1, duration: ${MOVE * 0.7}, ease: 'none', immediateRender: false }, ${start});`);
  }

  // The dark veil over a bleed, lifted as the window settles elsewhere.
  const dark = b.layout === 'bleed';
  // The veil starts clear and darkens over the opening, never on at frame 0.
  if (!prev && dark) js.push(`tl.fromTo('#veil', { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power2.out', immediateRender: false }, 0);`);
  else if ((prev.layout === 'bleed') !== dark) js.push(`tl.to('#veil', { opacity: ${dark ? 1 : 0}, duration: ${MOVE}, ease: 'power2.inOut' }, ${b.at - PRE});`);

  // The text for this beat: in once the window has moved, out before the next.
  const tid = id('t');
  const inAt = +(b.at + (prev ? PRE * 0.6 : 0.25)).toFixed(2);
  const outAt = +(b.at + b.dur - PRE - 0.15).toFixed(2);
  switch (b.layout) {
    case 'bleed':
      layers.push(`<div class="layer center" id="${tid}"><div class="big light">${b.lines.map((l) => `<span class="line"><span>${rich(l)}</span></span>`).join('')}</div></div>`);
      js.push(`tl.from('#${tid} .line > span', { yPercent: 110, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.25 }, ${inAt});`);
      break;
    case 'title':
      layers.push(`<div class="layer title" id="${tid}">
        <div class="eyebrow">${esc(b.eyebrow)}</div>
        <h1>${b.headline.map((l, k) => `<span class="line"><span class="${k === b.headline.length - 1 ? 'b' : ''}">${esc(l)}</span></span>`).join('')}</h1>
        <p>${rich(b.tagline)}</p>
        <div class="pills">${b.pills.map((p) => `<span class="pill"><i></i>${esc(p)}</span>`).join('')}</div></div>`);
      js.push(`HERO.rise(tl, '#${tid} .eyebrow', ${inAt});`);
      js.push(`tl.from('#${tid} h1 .line > span', { yPercent: 110, duration: 0.9, ease: 'expo.out', stagger: 0.18 }, ${inAt + 0.1});`);
      js.push(`HERO.rise(tl, '#${tid} p', ${inAt + 0.6});`);
      js.push(`HERO.rise(tl, '#${tid} .pill', ${inAt + 0.9}, { stagger: 0.08, y: 14 });`);
      break;
    case 'split': {
      const x = (b.text ?? 'left') === 'left' ? 120 : 96 + 992 + 80;
      layers.push(`<div class="layer statement" id="${tid}" style="left:${x}px;width:620px">
        ${b.num ? `<span class="num">${esc(b.num)}</span>` : ''}<h2>${rich(b.title)}</h2>${b.body ? `<p>${rich(b.body)}</p>` : ''}</div>`);
      js.push(`HERO.rise(tl, '#${tid} > *', ${inAt}, { stagger: 0.1 });`);
      break;
    }
    case 'full':
      if (b.caption) {
        layers.push(`<div class="layer cap" id="${tid}">${b.num ? `<span class="n">${esc(b.num)}</span>` : ''}<span class="t">${rich(b.caption)}</span></div>`);
        js.push(`tl.fromTo('#${tid}', { opacity: 0, y: 24, xPercent: -50 }, { opacity: 1, y: 0, xPercent: -50, duration: 0.5, ease: 'expo.out' }, ${inAt});`);
      }
      break;
    case 'end':
      layers.push(`<div class="layer center endcard" id="${tid}">
        <div class="endmark"><span class="logo" style="width:96px;height:96px"><img src="assets/logo.png" alt="" /></span>CodeTrellis</div>
        <div class="big small">${rich(b.headline)}</div>
        <div class="pills">${b.pills.map((p) => `<span class="pill"><i></i>${esc(p)}</span>`).join('')}</div>
        <div class="url">${esc(b.url)}</div></div>`);
      js.push(`HERO.rise(tl, '#${tid} > *', ${inAt}, { stagger: 0.12 });`);
      break;
    default:
      throw new Error(`unknown layout ${b.layout}`);
  }
  const hasText = layers.some((l) => l.includes(`id="${tid}"`));
  if (!last && hasText) js.push(`tl.to('#${tid}', { opacity: 0, y: -12, duration: 0.35, ease: 'power2.in' }, ${outAt});`);
});

// The brand mark rides with the title and leaves with it; the "real UI" tag
// shows whenever the product is in the window and not under the veil.
const titleBeat = beats.find((b) => b.layout === 'title');
js.push(`gsap.set('#brand', { opacity: 0 });`);
if (titleBeat) {
  js.push(`tl.to('#brand', { opacity: 1, duration: 0.5 }, ${titleBeat.at});`);
  js.push(`tl.to('#brand', { opacity: 0, duration: 0.35 }, ${+(titleBeat.at + titleBeat.dur - PRE - 0.15).toFixed(2)});`);
}
const firstLight = beats.find((b) => b.layout !== 'bleed');
js.push(`gsap.set('#realtag', { opacity: 0 });`);
if (firstLight) js.push(`tl.to('#realtag', { opacity: 1, duration: 0.5 }, ${firstLight.at});`);

const CSS = `
#frame { position: absolute; overflow: hidden; background: #0b0f17;
  box-shadow: 0 40px 90px rgba(16,34,80,.28), 0 12px 30px rgba(16,34,80,.16), 0 0 0 1px rgba(11,18,32,.10); }
#frame .clip { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; display: block; }
#veil { position: absolute; inset: 0; opacity: 0; background: linear-gradient(180deg, rgba(5,8,15,.62), rgba(5,8,15,.86)); }
.layer { position: absolute; }
.center { inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 30px; padding: 0 140px; }
.big .line { display: block; overflow: hidden; padding-bottom: .06em; }
.big .line > span { display: block; }
.big.light { color: #f3f6fc; }
.big.small { font-size: 64px; }
.statement { top: 0; height: 1080px; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
.title { left: 0; right: 0; top: 104px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 18px; }
.title h1 { font-size: 112px; line-height: 1; font-weight: 700; letter-spacing: -.045em; }
.title h1 .line { display: block; overflow: hidden; padding-bottom: .06em; }
.title h1 .line > span { display: block; }
.title h1 .b { color: var(--blue); }
.title p { font-size: 28px; line-height: 1.42; color: var(--sub); max-width: 1180px; text-wrap: balance; }
.pills { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.brand { position: absolute; left: 64px; top: 40px; display: flex; gap: 14px; align-items: center; font-size: 26px; font-weight: 600; letter-spacing: -.01em; }
.endcard { bottom: 300px; }
.endmark { display: flex; align-items: center; gap: 24px; font-size: 96px; font-weight: 700; letter-spacing: -.04em; }
.url { font: 500 28px "Geist Mono", monospace; color: var(--blue-ink); }
`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <!-- Generated by build.mjs from beats.mjs: edit those, not this. -->
    <title>CodeTrellis hero</title>
    <script src="assets/gsap.min.js"></script>
    <script src="hero.js"></script>
    <link rel="stylesheet" href="hero.css" />
    <style>${CSS}</style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080">
      <div class="glow"></div>
      <div id="frame"><div class="cam" id="cam">
        ${clips.join('\n        ')}
      </div></div>
      <div id="veil"></div>
      <div class="brand" id="brand"><span class="logo" style="width:44px;height:44px"><img src="assets/logo.png" alt="" /></span>CodeTrellis</div>
      ${layers.join('\n      ')}
      <div class="real" id="realtag"><i></i>REAL CODETRELLIS UI</div>
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
for (const a of ACTS) {
  const bs = beats.filter((b) => b.act === a.id);
  const end = bs[bs.length - 1].at + bs[bs.length - 1].dur;
  console.log(`${a.id}: ${bs.length} beats, ${bs[0].at.toFixed(1)}–${end.toFixed(1)} s`);
}
console.log(`index.html: ${beats.length} beats, ${TOTAL} s`);
