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
  phone: { x: 96, y: 234, w: 1088, h: 612, r: 14 },
  rotate: { x: 0, y: 0, w: 1920, h: 1080, r: 0 },
};
/** Layouts with no window: it fades where it is and comes back from there. */
const HIDDEN = new Set(['terminal', 'strip', 'end']);
const layoutOf = (b) => (b.layout === 'split' ? `split-text-${b.text ?? 'left'}` : b.layout);
function frameFor(b, last) {
  if (HIDDEN.has(b.layout)) return last;
  if (b.layout === 'mosaic') { const t = b.tiles[0]; return { x: t.x, y: t.y, w: t.w, h: t.h, r: 12 }; }
  const f = FRAMES[layoutOf(b)];
  if (!f) throw new Error(`unknown layout ${b.layout}`);
  return f;
}
/** A clip that starts under the move into its beat and runs past its end. */
function clipTimes(b, prev, last) {
  const start = +Math.max(b.at - (prev ? PRE : 0), 0).toFixed(2);
  const dur = +(b.at + b.dur - start + (last ? 0 : PRE + 0.3)).toFixed(2);
  return { start, dur };
}
/** `lead`: how far before its beat the clip starts, so the footage lines up with the beat. */
function mediaTag(id, m, start, dur, lead = 0, cls = 'clip') {
  if (m.img) return `<img id="${id}" class="${cls}" src="assets/${m.img}" alt="" data-start="${start}" data-duration="${dur}" />`;
  const mediaStart = +Math.max((m.start ?? 0) - lead, 0).toFixed(2);
  return `<video id="${id}" class="${cls}" src="assets/${m.src}" muted playsinline data-start="${start}" data-duration="${dur}" data-media-start="${mediaStart}"></video>`;
}
const transcriptFile = path.join(path.dirname(new URL(import.meta.url).pathname), 'assets', 'ci-transcript.json');

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

let lastFrame = FRAMES.full;
beats.forEach((b, i) => {
  const frame = frameFor(b, lastFrame);
  lastFrame = frame;
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
  // The window fades out for a beat with no product on screen, and back.
  const shown = !HIDDEN.has(b.layout);
  if (prev && HIDDEN.has(prev.layout) !== !shown) js.push(`tl.to('#frame', { opacity: ${shown ? 1 : 0}, scale: ${shown ? 1 : 0.96}, duration: ${MOVE * 0.8}, ease: 'power2.inOut' }, ${Math.max(b.at - PRE, 0)});`);
  // The "real UI" tag goes with the window: no product on screen, no tag.
  if (prev && HIDDEN.has(prev.layout) !== !shown) js.push(`tl.to('#realtag', { opacity: ${shown ? 1 : 0}, duration: ${MOVE * 0.6} }, ${Math.max(b.at - PRE, 0)});`);
  // A light veil dims the product behind the close.
  const dim = b.layout === 'rotate';
  if (prev && (prev.layout === 'rotate') !== dim) js.push(`tl.to('#lveil', { opacity: ${dim ? 1 : 0}, duration: ${MOVE}, ease: 'power2.inOut' }, ${b.at - PRE});`);
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
    case 'mosaic': {
      // The window is the first tile; the others are clips of their own.
      const tiles = b.tiles.slice(1).map((t) => {
        const tid2 = id('m');
        const { start, dur } = clipTimes(b, prev, last);
        const s2 = t.w / (t.region?.fw ?? W);
        const tx = -(t.region?.fx ?? 0) * s2, ty = -(t.region?.fy ?? 0) * s2;
        js.push(`tl.fromTo('#${tid2}', { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out', immediateRender: true }, ${inAt + 0.1 + b.tiles.indexOf(t) * 0.12});`);
        if (!last) js.push(`tl.to('#${tid2}', { opacity: 0, duration: 0.35, ease: 'power2.in' }, ${outAt});`);
        return `<div class="tile" id="${tid2}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px"><div class="src" style="transform:translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${s2.toFixed(4)})">${mediaTag(id('v'), t, start, dur, b.at - start)}</div>${t.label ? `<span class="label">${esc(t.label)}</span>` : ''}</div>`;
      }).join('');
      const t0 = b.tiles[0];
      layers.push(`<div class="layer" id="${tid}">${tiles}${t0.label ? `<span class="label tile-label" style="left:${t0.x + 14}px;top:${t0.y + t0.h - 44}px">${esc(t0.label)}</span>` : ''}
        <div class="mtext" style="left:${b.textBox.x}px;top:${b.textBox.y}px;width:${b.textBox.w}px">${b.num ? `<span class="num">${esc(b.num)}</span>` : ''}<h2>${rich(b.title)}</h2>${b.body ? `<p>${rich(b.body)}</p>` : ''}</div></div>`);
      js.push(`HERO.rise(tl, '#${tid} .mtext > *', ${inAt}, { stagger: 0.1 });`);
      if (t0.label) js.push(`HERO.rise(tl, '#${tid} .tile-label', ${inAt + 0.2}, { y: 8 });`);
      break;
    }
    case 'terminal': {
      // Every line is what `codetrellis check` printed in a recorded run.
      const tr = JSON.parse(fs.readFileSync(transcriptFile, 'utf8'));
      let tt = inAt + 0.5;
      const lines = [];
      tr.steps.forEach((st, k) => {
        const cid = id('c'), oid = id('o');
        lines.push(`<span id="${cid}" class="cmd">${esc(st.command)}</span>`);
        js.push(`tl.fromTo('#${cid}', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.6, ease: 'none', immediateRender: true }, ${tt.toFixed(2)});`);
        tt += 0.8;
        const out = st.output.split('\n').map((l) => `<span class="${/✗|Does not conform|not conform/i.test(l) ? 'bad' : /^Conforms/i.test(l) ? 'good' : ''}">${esc(l)}</span>`).join('\n');
        lines.push(`<span id="${oid}">${out}\n<span class="${st.exit === 0 ? 'good' : 'bad'}">exit ${st.exit}</span>\n</span>`);
        js.push(`tl.fromTo('#${oid}', { opacity: 0 }, { opacity: 1, duration: 0.25, immediateRender: true }, ${tt.toFixed(2)});`);
        tt += k === 0 ? (b.holdFail ?? 2.6) : 1;
      });
      const recipe = b.recipe ? `<div class="term recipe" style="left:${b.recipe.x}px;top:${b.recipe.y}px;width:${b.recipe.w}px"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>${esc(b.recipe.name)}</span></div><pre>${b.recipe.lines.map((l) => `<span class="${/^\s*#/.test(l) ? 'dim' : ''}">${esc(l)}</span>`).join('\n')}</pre></div>` : '';
      layers.push(`<div class="layer" id="${tid}" style="inset:0">${recipe}
        <div class="term run" style="left:${b.box.x}px;top:${b.box.y}px;width:${b.box.w}px"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>${esc(b.bar ?? 'ci')}</span></div><pre>${lines.join('\n')}</pre></div>
        <div class="statement" style="left:${b.textBox.x}px;width:${b.textBox.w}px"><h2>${rich(b.title)}</h2>${b.body ? `<p>${rich(b.body)}</p>` : ''}</div></div>`);
      js.push(`HERO.rise(tl, '#${tid} .term.run', ${inAt});`);
      if (b.recipe) js.push(`HERO.rise(tl, '#${tid} .recipe', ${inAt + (b.recipe.at ?? 0.2)});`);
      js.push(`HERO.rise(tl, '#${tid} .statement > *', ${inAt + 0.1}, { stagger: 0.1 });`);
      break;
    }
    case 'phone': {
      const p = b.phone;
      const { start, dur } = clipTimes(b, prev, last);
      const pid = id('p');
      const screen = p.img
        ? `<img id="${id('i')}" class="clip" src="assets/${p.img}" alt="" data-start="${start}" data-duration="${dur}" />`
        : `${p.done ? `<img id="${id('i')}" class="clip" src="assets/${p.done}" alt="" data-start="${start}" data-duration="${dur}" />` : ''}<video id="${id('v')}" class="clip" src="assets/${p.src}" muted playsinline data-start="${(start + (p.delay ?? 0.4)).toFixed(2)}" data-duration="${Math.min(dur, p.length ?? dur).toFixed(2)}" data-media-start="${p.start ?? 0}"></video>`;
      const tap = p.tap ? `<div class="tap" id="${pid}t" style="left:${p.tap.x}px;top:${44 + p.tap.y}px"></div>` : '';
      if (p.tap) {
        js.push(`gsap.set('#${pid}t', { scale: 0.4, opacity: 0 });`);
        js.push(`tl.to('#${pid}t', { opacity: 1, scale: 1, duration: 0.18, ease: 'power2.out' }, ${(start + (p.delay ?? 0.4) + p.tap.at - 0.15).toFixed(2)});`);
        js.push(`tl.to('#${pid}t', { opacity: 0, scale: 1.6, duration: 0.45, ease: 'power2.out' }, ${(start + (p.delay ?? 0.4) + p.tap.at + 0.05).toFixed(2)});`);
      }
      layers.push(`<div class="layer" id="${tid}" style="inset:0">
        <div class="phone" id="${pid}" style="left:1300px;top:124px"><div class="screen"><div class="sb"><span>9:41</span><span>●●● ▮</span></div><div class="island"></div><div class="pv">${screen}</div>${tap}</div></div>
        ${b.caption ? `<div class="cap" id="${tid}c"><span class="t">${rich(b.caption)}</span></div>` : ''}</div>`);
      js.push(`tl.fromTo('#${pid}', { x: 680, rotation: 6 }, { x: 0, rotation: 0, duration: 1.1, ease: 'expo.out', immediateRender: true }, ${inAt - 0.1});`);
      if (b.caption) js.push(`tl.fromTo('#${tid}c', { opacity: 0, y: 24, xPercent: -50 }, { opacity: 1, y: 0, xPercent: -50, duration: 0.5, ease: 'expo.out' }, ${inAt + 0.4});`);
      break;
    }
    case 'strip':
      layers.push(`<div class="layer center" id="${tid}"><div class="strip-h">${b.lines.map((l) => `<div class="big small">${rich(l)}</div>`).join('')}</div>
        ${b.groups.map((g) => `<div class="pills">${g.map((f) => `<span class="pill"><i></i>${esc(f)}</span>`).join('')}</div>`).join('')}</div>`);
      js.push(`HERO.rise(tl, '#${tid} .strip-h > *', ${inAt}, { stagger: 0.12 });`);
      js.push(`HERO.rise(tl, '#${tid} .pill', ${inAt + 0.5}, { stagger: 0.06, y: 12 });`);
      break;
    case 'rotate': {
      const each = (b.dur - 1.6 - (b.more ? 1.6 : 0)) / b.lines.length;
      layers.push(`<div class="layer center" id="${tid}"><div class="big small lead">${rich(b.lead)}</div>
        <div class="rot">${b.lines.map((l, k) => `<div class="big rline" id="${tid}r${k}">${rich(l)}</div>`).join('')}</div>
        ${b.more ? `<div class="more">${rich(b.more)}</div>` : ''}</div>`);
      js.push(`HERO.rise(tl, '#${tid} .lead', ${inAt});`);
      b.lines.forEach((_, k) => {
        const t0 = inAt + 0.6 + k * each;
        js.push(`tl.fromTo('#${tid}r${k}', { opacity: 0, yPercent: 60 }, { opacity: 1, yPercent: 0, duration: 0.45, ease: 'expo.out', immediateRender: true }, ${t0.toFixed(2)});`);
        if (k < b.lines.length - 1 || b.more) js.push(`tl.to('#${tid}r${k}', { opacity: 0, yPercent: -60, duration: 0.35, ease: 'power2.in' }, ${(t0 + each - 0.35).toFixed(2)});`);
      });
      if (b.more) js.push(`HERO.rise(tl, '#${tid} .more', ${(inAt + 0.6 + b.lines.length * each).toFixed(2)});`);
      break;
    }
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
#frame { position: absolute; overflow: hidden; background: #0b0f17; transform-origin: 50% 50%;
  box-shadow: 0 40px 90px rgba(16,34,80,.28), 0 12px 30px rgba(16,34,80,.16), 0 0 0 1px rgba(11,18,32,.10); }
#frame .clip { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; display: block; }
#lveil { position: absolute; inset: 0; opacity: 0; background: linear-gradient(180deg, rgba(246,248,252,.86), rgba(246,248,252,.95)); }
.mtext { position: absolute; display: flex; flex-direction: column; gap: 18px; }
.mtext h2 { font-size: 60px; line-height: 1.04; font-weight: 700; letter-spacing: -.035em; text-wrap: balance; }
.mtext h2 b { color: var(--blue); }
.mtext p { font-size: 26px; color: var(--sub); line-height: 1.45; }
.mtext .num { font: 500 18px "Geist Mono", monospace; color: var(--blue-ink); background: var(--blue-soft); border-radius: 9px; padding: 7px 11px; align-self: flex-start; }
.tile-label { position: absolute; white-space: nowrap; font: 600 17px "Geist", sans-serif; color: #fff; background: rgba(8,12,22,.78); border-radius: 9px; padding: 6px 11px; }
.rot { position: relative; height: 120px; width: 100%; }
.rline { position: absolute; left: 0; right: 0; top: 0; opacity: 0; color: var(--blue); font-size: 68px; white-space: nowrap; }
.lead { color: var(--ink); }
.more { font-size: 30px; color: var(--sub); }
.strip-h { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.term pre span { white-space: pre-wrap; }
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
      <div id="lveil"></div>
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
