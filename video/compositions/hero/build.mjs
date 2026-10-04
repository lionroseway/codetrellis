// Builds the hero's act compositions from beats.mjs: one HyperFrames file per
// act (acts/act-0.html …), each a run of beats. A beat is a layout (split, full,
// statement, mosaic, terminal, phone, strip, rotate, title, end) with its
// text, which capture it shows and where the camera points. The HTML is
// generated; edit beats.mjs and run this (bin/render.sh hero does).
//
// Usage: node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ACTS, FADE } from './beats.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Text that may carry <b>, <code> and <br>: everything else escaped. */
const rich = (s) => esc(s).replace(/&lt;(\/?)(b|code|br)&gt;/g, '<$1$2>');

const W = 1600, H = 900;
/**
 * Keeps a camera on the footage: a view (vw x vh screen pixels) at scale s,
 * centred on (fx, fy), moved in so it shows no space beyond the window's
 * edges when it is smaller than the window.
 */
function clampFocus(fx, fy, s, vw, vh) {
  const hw = vw / 2 / s, hh = vh / 2 / s;
  return {
    fx: hw < W / 2 ? Math.min(Math.max(fx, hw), W - hw) : W / 2,
    fy: hh < H / 2 ? Math.min(Math.max(fy, hh), H - hh) : H / 2,
  };
}
let uid = 0;
const id = (p) => `${p}${++uid}`;

/** A `.win` with the beat's footage (a video from `start` for the beat, or a still). */
function windowHtml(beat, media, at, dur, attrs = '') {
  const m = media ?? beat.media;
  const inner = m.img
    ? `<img id="${id('i')}" class="clip" src="assets/${m.img}" alt="" data-start="${at}" data-duration="${dur}" />`
    : `<video id="${id('v')}" class="clip" src="assets/${m.src}" muted playsinline data-start="${at}" data-duration="${dur}" data-media-start="${m.start}"></video>`;
  return `<div class="win" ${attrs}>${inner}</div>`;
}

/** Where a split puts its window and its text. */
function splitGeometry(side) {
  const s = 0.62, w = W * s;
  const winX = side === 'left' ? 1920 - 96 - w : 96;
  const textX = side === 'left' ? 120 : 96 + w + 80;
  return { s, winX, winY: (1080 - H * s) / 2, textX, textW: 1920 - w - 96 - 120 - 80 };
}

function beatHtml(beat, at, js) {
  const dur = beat.dur;
  const bid = id('b');
  const clip = (inner, cls = '') => `<div class="clip ${cls}" id="${bid}" data-start="${at}" data-duration="${dur}">${inner}</div>`;
  const fade = `HERO_FADE(tl, '#${bid}', ${at}, ${dur});`;
  js.push(fade);

  switch (beat.kind) {
    case 'title': {
      const cam = id('c');
      const win = windowHtml(beat, null, at, dur, `style="left:160px;top:90px"`);
      js.push(`gsap.set('#${cam}', HERO.place(160, 90, 400, 640, 0.7));`);
      js.push(`tl.from('#${cam}', { y: 1200, duration: 1.4, ease: 'expo.out' }, ${at + 0.6});`);
      js.push(`tl.to('#${cam}', { ...HERO.place(160, 90, 400, 600, 0.7), duration: ${Math.max(dur - 2, 0.5)}, ease: 'none' }, ${at + 2});`);
      js.push(`HERO.rise(tl, '#${bid} .t-eyebrow', ${at + 0.1});`);
      js.push(`tl.from('#${bid} .t-h1 span', { yPercent: 110, duration: 0.9, ease: 'expo.out', stagger: 0.18 }, ${at + 0.2});`);
      js.push(`HERO.rise(tl, '#${bid} .t-tag', ${at + 0.8});`);
      js.push(`HERO.rise(tl, '#${bid} .pill', ${at + 1.1}, { stagger: 0.08, y: 14 });`);
      return clip(`<div class="glow"></div>
        <div class="brand"><span class="logo" style="width:44px;height:44px"><img src="assets/logo.png" alt="" /></span>CodeTrellis</div>
        <div class="title">
          <div class="eyebrow t-eyebrow">${esc(beat.eyebrow)}</div>
          <h1 class="t-h1">${beat.headline.map((l, i) => `<span class="line"><span class="${i === beat.headline.length - 1 ? 'b' : ''}">${esc(l)}</span></span>`).join('')}</h1>
          <p class="t-tag">${rich(beat.tagline)}</p>
          <div class="pills">${beat.pills.map((p) => `<span class="pill"><i></i>${esc(p)}</span>`).join('')}</div>
        </div>
        <div class="cam" id="${cam}">${win}</div>`);
    }
    case 'statement': {
      const media = beat.media ? `<div class="cam bgcam" id="${bid}c">${windowHtml(beat, null, at, dur, 'style="left:160px;top:90px"')}</div><div class="veil"></div>` : '';
      if (beat.media) {
        js.push(`gsap.set('#${bid}c', HERO.place(160, 90, -40, -20, 1.25));`);
        js.push(`tl.to('#${bid}c', { ...HERO.place(160, 90, -140, -80, 1.38), duration: ${dur}, ease: 'none' }, ${at});`);
      }
      js.push(`tl.from('#${bid} .big span', { yPercent: 110, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.25 }, ${at + 0.3});`);
      return clip(`<div class="glow"></div>${media}
        <div class="center"><div class="big">${beat.lines.map((l) => `<span class="line"><span>${rich(l)}</span></span>`).join('')}</div></div>`, beat.dark ? 'dark' : '');
    }
    case 'split': {
      const g = splitGeometry(beat.side);
      const cam = id('c');
      const win = windowHtml(beat, null, at, dur, `style="left:0;top:0"`);
      // The window sits at (0,0) in its camera; the camera puts it in the split.
      const base = `{ x: ${g.winX}, y: ${g.winY}, scale: ${g.s} }`;
      js.push(`gsap.set('#${cam}', ${base});`);
      if (beat.zoom) {
        const z0 = beat.zoom; // footage point and scale, framed inside the split's window area
        const z = { ...z0, ...clampFocus(z0.fx, z0.fy, z0.s * 1.06, W * g.s, H * g.s) };
        const cx = g.winX + (W * g.s) / 2, cy = 540;
        js.push(`tl.to('#${cam}', { ...HERO.cam(0, 0, ${z.fx}, ${z.fy}, ${z.s}, ${cx}, ${cy}), duration: 1.1, ease: 'power3.inOut' }, ${at + (z.at ?? 0.6)});`);
        js.push(`tl.to('#${cam}', { ...HERO.cam(0, 0, ${z.fx}, ${z.fy}, ${z.s * 1.06}, ${cx}, ${cy}), duration: ${Math.max(dur - (z.at ?? 0.6) - 1.1, 0.3)}, ease: 'none' }, ${at + (z.at ?? 0.6) + 1.1});`);
      }
      js.push(`tl.from('#${cam}', { opacity: 0, x: '+=${beat.side === 'left' ? 60 : -60}', duration: 0.8, ease: 'expo.out' }, ${at});`);
      js.push(`HERO.rise(tl, '#${bid} .statement > *', ${at + 0.15}, { stagger: 0.1 });`);
      // A split's window is clipped to its frame so a zoom stays inside it.
      return clip(`<div class="glow"></div>
        <div class="frame" style="left:${g.winX}px;top:${g.winY}px;width:${W * g.s}px;height:${H * g.s}px"></div>
        <div class="splitclip" style="clip-path: inset(${g.winY}px ${1920 - g.winX - W * g.s}px ${g.winY}px ${g.winX}px round 12px)"><div class="cam" id="${cam}">${win}</div></div>
        <div class="statement" style="left:${g.textX}px;top:0;height:1080px;width:${g.textW}px">
          ${beat.num ? `<span class="num">${esc(beat.num)}</span>` : ''}
          <h2>${rich(beat.title)}</h2>
          ${beat.body ? `<p>${rich(beat.body)}</p>` : ''}
        </div>`);
    }
    case 'full': {
      const cam = id('c');
      const win = windowHtml(beat, null, at, dur, `style="left:160px;top:90px"`);
      const shots = (beat.shots ?? []).map((sh) => (sh.s > 1 ? { ...sh, ...clampFocus(sh.fx, sh.fy, sh.s, 1920, 1080) } : sh));
      js.push(`gsap.set('#${cam}', ${shots[0] ? `HERO.cam(160, 90, ${shots[0].fx}, ${shots[0].fy}, ${shots[0].s}, ${shots[0].sx ?? 960}, ${shots[0].sy ?? 540})` : '{ x: 0, y: 0, scale: 1 }'});`);
      for (const sh of shots.slice(1)) {
        js.push(`tl.to('#${cam}', { ...HERO.cam(160, 90, ${sh.fx}, ${sh.fy}, ${sh.s}, ${sh.sx ?? 960}, ${sh.sy ?? 540}), duration: ${sh.d ?? 1.2}, ease: '${sh.ease ?? 'power3.inOut'}' }, ${at + sh.at});`);
      }
      const cap = beat.caption ? `<div class="cap" id="${bid}p">${beat.num ? `<span class="n">${esc(beat.num)}</span>` : ''}<span class="t">${rich(beat.caption)}</span></div>` : '';
      if (beat.caption) js.push(`HERO.caption(tl, '#${bid}p', ${at + 0.4}, ${dur - 0.9});`);
      return clip(`<div class="glow"></div><div class="cam" id="${cam}">${win}</div>${cap}`);
    }
    case 'mosaic': {
      const tiles = beat.tiles.map((t, i) => {
        const tid = id('t');
        js.push(`gsap.set('#${tid} .src', HERO.region(${t.region.fx}, ${t.region.fy}, ${t.region.fw}, ${t.w}));`);
        js.push(`tl.from('#${tid}', { opacity: 0, scale: 0.92, duration: 0.6, ease: 'expo.out' }, ${at + 0.3 + i * 0.12});`);
        const inner = t.img
          ? `<img id="${id('i')}" class="clip" src="assets/${t.img}" alt="" data-start="${at}" data-duration="${dur}" />`
          : `<video id="${id('v')}" class="clip" src="assets/${t.src}" muted playsinline data-start="${at}" data-duration="${dur}" data-media-start="${t.start}"></video>`;
        return `<div class="tile" id="${tid}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px"><div class="src">${inner}</div>${t.label ? `<span class="label">${esc(t.label)}</span>` : ''}</div>`;
      }).join('');
      js.push(`HERO.rise(tl, '#${bid} .mtext > *', ${at + 0.1}, { stagger: 0.1 });`);
      return clip(`<div class="glow"></div>${tiles}<div class="mtext" style="${beat.textStyle ?? ''}">${beat.num ? `<span class="num">${esc(beat.num)}</span>` : ''}<h2>${rich(beat.title)}</h2>${beat.body ? `<p>${rich(beat.body)}</p>` : ''}</div>`);
    }
    case 'terminal': {
      const steps = beat.steps;
      let t = at + 0.8;
      const lines = [];
      for (const s of steps) {
        const sid = id('l');
        lines.push(`<span id="${sid}c" class="cmd">${esc(s.command)}</span>`);
        js.push(`tl.from('#${sid}c', { opacity: 0, duration: 0.01 }, ${t});`);
        js.push(`tl.fromTo('#${sid}c', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.6, ease: 'none', immediateRender: false }, ${t});`);
        t += 0.9;
        const out = s.output.split('\n').map((l) => {
          const cls = /^\s*✗|Does not conform/.test(l) ? 'bad' : /^Conforms/.test(l) ? 'good' : '';
          return `<span class="${cls}">${esc(l)}</span>`;
        }).join('\n');
        lines.push(`<span id="${sid}o">${out}\n<span class="${s.exit === 0 ? 'good' : 'bad'}">exit ${s.exit}</span>\n</span>`);
        js.push(`tl.from('#${sid}o', { opacity: 0, duration: 0.2 }, ${t});`);
        t += s.hold ?? 2.4;
      }
      const recipe = beat.recipe ? `<div class="term recipe" style="left:${beat.recipe.x}px;top:${beat.recipe.y}px;width:${beat.recipe.w}px"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>${esc(beat.recipe.name)}</span></div><pre>${beat.recipe.lines.map((l) => `<span class="${l.startsWith('#') || l.includes(' # ') ? 'dim' : ''}">${esc(l)}</span>`).join('\n')}</pre></div>` : '';
      if (beat.recipe) js.push(`HERO.rise(tl, '#${bid} .recipe', ${at + 0.2});`);
      js.push(`HERO.rise(tl, '#${bid} .term.run', ${at});`);
      js.push(`HERO.rise(tl, '#${bid} .statement > *', ${at + 0.15}, { stagger: 0.1 });`);
      return clip(`<div class="glow"></div>${recipe}
        <div class="term run" style="left:${beat.x}px;top:${beat.y}px;width:${beat.w}px"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>${esc(beat.bar ?? 'ci · conformity')}</span></div><pre>${lines.join('\n')}</pre></div>
        <div class="statement" style="left:${beat.textX}px;top:0;height:1080px;width:${beat.textW}px">${beat.num ? `<span class="num">${esc(beat.num)}</span>` : ''}<h2>${rich(beat.title)}</h2>${beat.body ? `<p>${rich(beat.body)}</p>` : ''}</div>`);
    }
    case 'phone': {
      const cam = id('c');
      const win = windowHtml(beat, beat.desktop, at, dur, `style="left:160px;top:90px"`);
      js.push(`gsap.set('#${cam}', HERO.place(160, 90, 110, 214, 0.68));`);
      js.push(`tl.from('#${bid} .phone', { x: 700, rotation: 6, duration: 1.1, ease: 'expo.out' }, ${at + 0.3});`);
      const p = beat.phone;
      const screen = p.img
        ? `<img id="${id('i')}" class="clip" src="assets/${p.img}" alt="" data-start="${at}" data-duration="${dur}" />`
        : `<img id="${id('i')}" class="clip" src="assets/${p.done}" alt="" data-start="${at}" data-duration="${dur}" /><video id="${id('v')}" class="clip" src="assets/${p.src}" muted playsinline data-start="${at}" data-duration="${Math.min(dur, p.length ?? dur)}" data-media-start="0"></video>`;
      const tap = p.tap ? `<div class="tap" id="${bid}t" style="left:${p.tap.x * 0.9}px;top:${44 + p.tap.y * 0.9}px"></div>` : '';
      if (p.tap) {
        js.push(`gsap.set('#${bid}t', { scale: 0.4, opacity: 0 });`);
        js.push(`tl.to('#${bid}t', { opacity: 1, scale: 1, duration: 0.18, ease: 'power2.out' }, ${at + p.tap.at - 0.15});`);
        js.push(`tl.to('#${bid}t', { opacity: 0, scale: 1.6, duration: 0.45, ease: 'power2.out' }, ${at + p.tap.at + 0.05});`);
      }
      if (beat.after) js.push(`tl.from('#${bid} .after', { opacity: 0, duration: 0.5, ease: 'none' }, ${at + beat.after.at});`);
      const after = beat.after ? `<img class="after" src="assets/${beat.after.img}" alt="" style="position:absolute;inset:0;width:1600px;height:900px" />` : '';
      const cap = beat.caption ? `<div class="cap" id="${bid}p">${beat.num ? `<span class="n">${esc(beat.num)}</span>` : ''}<span class="t">${rich(beat.caption)}</span></div>` : '';
      if (beat.caption) js.push(`HERO.caption(tl, '#${bid}p', ${at + 0.6}, ${dur - 1.1});`);
      return clip(`<div class="glow"></div><div class="cam" id="${cam}">${win.replace('</div>', `${after}</div>`)}</div>
        <div class="phone" style="left:1330px;top:118px"><div class="screen"><div class="sb"><span>9:41</span><span>●●● ▮</span></div><div class="island"></div><div class="pv">${screen}</div>${tap}</div></div>${cap}`);
    }
    case 'strip': {
      js.push(`HERO.rise(tl, '#${bid} .strip-h > *', ${at + 0.1}, { stagger: 0.1 });`);
      js.push(`HERO.rise(tl, '#${bid} .facts .pill', ${at + 0.5}, { stagger: 0.07, y: 12 });`);
      return clip(`<div class="glow"></div><div class="center"><div class="strip-h">${beat.lines.map((l) => `<div class="big small">${rich(l)}</div>`).join('')}</div>
        ${beat.groups.map((g) => `<div class="facts">${g.map((f) => `<span class="pill"><i></i>${esc(f)}</span>`).join('')}</div>`).join('')}</div>`);
    }
    case 'rotate': {
      const cam = id('c');
      const win = windowHtml(beat, null, at, dur, `style="left:160px;top:90px"`);
      js.push(`gsap.set('#${cam}', HERO.place(160, 90, 160, 90, 1));`);
      js.push(`tl.to('#${cam}', { ...HERO.place(160, 90, 100, 50, 1.08), duration: ${dur}, ease: 'none' }, ${at});`);
      const each = (dur - 1.2) / beat.lines.length;
      beat.lines.forEach((_, i) => {
        const t0 = at + 0.9 + i * each;
        js.push(`tl.fromTo('#${bid}r${i}', { opacity: 0, yPercent: 60 }, { opacity: 1, yPercent: 0, duration: 0.45, ease: 'expo.out', immediateRender: false }, ${t0});`);
        if (i < beat.lines.length - 1) js.push(`tl.to('#${bid}r${i}', { opacity: 0, yPercent: -60, duration: 0.35, ease: 'power2.in' }, ${t0 + each - 0.35});`);
      });
      js.push(`HERO.rise(tl, '#${bid} .lead', ${at + 0.3});`);
      if (beat.more) js.push(`HERO.rise(tl, '#${bid} .more', ${at + dur - 1.6});`);
      return clip(`<div class="cam" id="${cam}">${win}</div><div class="veil light"></div>
        <div class="center"><div class="lead big small">${rich(beat.lead)}</div><div class="rot">${beat.lines.map((l, i) => `<div class="big rline" id="${bid}r${i}">${rich(l)}</div>`).join('')}</div>${beat.more ? `<div class="more">${rich(beat.more)}</div>` : ''}</div>`);
    }
    case 'end': {
      js.push(`tl.from('#${bid} .endmark', { y: 30, opacity: 0, scale: 0.96, duration: 0.8, ease: 'expo.out' }, ${at + 0.15});`);
      js.push(`HERO.rise(tl, '#${bid} .end-h', ${at + 0.5});`);
      js.push(`HERO.rise(tl, '#${bid} .facts .pill', ${at + 0.8}, { stagger: 0.08, y: 12 });`);
      js.push(`HERO.rise(tl, '#${bid} .url', ${at + 1.2});`);
      return clip(`<div class="glow"></div><div class="center">
        <div class="endmark"><span class="logo" style="width:104px;height:104px"><img src="assets/logo.png" alt="" /></span>CodeTrellis</div>
        <div class="end-h big small">${rich(beat.headline)}</div>
        <div class="facts">${beat.pills.map((p) => `<span class="pill"><i></i>${esc(p)}</span>`).join('')}</div>
        <div class="url">${esc(beat.url)}</div></div>`);
    }
    default:
      throw new Error(`unknown beat kind ${beat.kind}`);
  }
}

const EXTRA_CSS = `
.brand { position: absolute; left: 64px; top: 40px; display: flex; gap: 14px; align-items: center; font-size: 26px; font-weight: 600; letter-spacing: -.01em; }
.title { position: absolute; left: 0; right: 0; top: 104px; z-index: 2; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 18px; }
.title h1 { font-size: 112px; line-height: 1; font-weight: 700; letter-spacing: -.045em; }
.title h1 .line { display: block; overflow: hidden; padding-bottom: .06em; }
.title h1 .line > span { display: block; }
.title h1 .b { color: var(--blue); }
.title p { font-size: 28px; line-height: 1.42; color: var(--sub); max-width: 1180px; text-wrap: balance; }
.pills, .facts { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 30px; padding: 0 140px; }
.big .line { display: block; overflow: hidden; padding-bottom: .06em; }
.big .line > span { display: block; }
.big.small { font-size: 64px; }
.veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5,8,15,.55), rgba(5,8,15,.82)); }
.veil.light { background: linear-gradient(180deg, rgba(246,248,252,.80), rgba(246,248,252,.93)); }
.frame { position: absolute; border-radius: 12px; box-shadow: 0 40px 90px rgba(16,34,80,.28), 0 12px 30px rgba(16,34,80,.16), 0 0 0 1px rgba(11,18,32,.10); background: #0b0f17; }
.splitclip { position: absolute; inset: 0; }
.splitclip .win { box-shadow: none; }
.mtext { position: absolute; display: flex; flex-direction: column; gap: 18px; }
.mtext h2 { font-size: 64px; line-height: 1.04; font-weight: 700; letter-spacing: -.035em; }
.mtext h2 b { color: var(--blue); }
.mtext p { font-size: 26px; color: var(--sub); line-height: 1.45; }
.mtext .num, .statement .num { font: 500 18px "Geist Mono", monospace; color: var(--blue-ink); background: var(--blue-soft); border-radius: 9px; padding: 7px 11px; align-self: flex-start; }
.rot { position: relative; height: 120px; width: 100%; }
.rline { position: absolute; left: 0; right: 0; top: 0; opacity: 0; color: var(--blue); }
.more { font-size: 30px; color: var(--sub); }
.endmark { display: flex; align-items: center; gap: 26px; font-size: 104px; font-weight: 700; letter-spacing: -.04em; }
.url { font: 500 28px "Geist Mono", monospace; color: var(--blue-ink); }
.strip-h { display: flex; flex-direction: column; gap: 8px; }
`;

function actHtml(act) {
  uid = 0;
  const js = [];
  let at = 0;
  const parts = act.beats.map((b) => { const h = beatHtml(b, +at.toFixed(2), js); at += b.dur - FADE; return h; });
  const total = +(at + FADE).toFixed(2);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <!-- Generated by build.mjs from beats.mjs (${esc(act.id)}): edit those, not this. -->
    <title>${esc(act.title)}</title>
    <script src="assets/gsap.min.js"></script>
    <script src="hero.js"></script>
    <link rel="stylesheet" href="hero.css" />
    <style>${EXTRA_CSS}</style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
      ${parts.join('\n      ')}
      <div class="real" id="realtag"><i></i>REAL CODETRELLIS UI</div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      // Each beat fades in over the one before and out at its end.
      function HERO_FADE(tl, sel, at, dur) {
        if (at > 0) tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: ${FADE}, ease: 'none', immediateRender: false }, at);
      }
      ${act.realTag === false ? "gsap.set('#realtag', { opacity: 0 });" : ''}
      ${js.join('\n      ')}
      window.__timelines = window.__timelines || {};
      window.__timelines['main'] = tl;
    </script>
  </body>
</html>
`;
}

for (const act of ACTS) {
  fs.mkdirSync(path.join(here, 'acts'), { recursive: true });
  fs.writeFileSync(path.join(here, 'acts', `${act.id}.html`), actHtml(act));
  const total = act.beats.reduce((s, b) => s + b.dur, 0) - FADE * (act.beats.length - 1);
  console.log(`${act.id}.html: ${act.beats.length} beats, ${total.toFixed(1)} s`);
}
