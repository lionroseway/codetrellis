# video/

Product video, made in code. Read `README.md` for the workflow; this file is the
rules for changing it.

## Real UI, always

The spike's one firm lesson: what is shown as CodeTrellis must be CodeTrellis.
Footage comes from `capture/` (the app driven by `scripts/demo.ts`, the phone
through `tools/phone-preview`). Never draw a mock of the app's screens into a
composition; draw only what sits around the footage (type, captions, frames,
camera moves). `collision` and `remotion-hero` are kept for their motion, not as
a pattern.

Wording comes from `docs/website/feature-atlas.md`, and its "Say carefully" list
bounds it. No model identifiers, customer names or anything from `docs/private/`.

## Authoring a HyperFrames composition

- One `index.html` per composition, root `#root[data-composition-id="main"]`
  with `data-duration`. Every timed element has `data-start`, a duration, and
  `class="clip"`; footage also `data-media-start` and `muted`.
- One paused GSAP timeline, registered as `window.__timelines["main"]`. Child
  timelines added to it must not be paused.
- Deterministic only: no `Math.random`, `Date.now` or network. Everything loads
  from `assets/` (`npm run setup` / `npm run stage`).
- Animate transforms (`x`, `y`, `scale`), not `left`/`top`. An element centred
  with `translateX(-50%)` loses it to GSAP's transform: use `xPercent: -50`.
- `fromTo` / `from` tweens later in the timeline need `immediateRender: false`,
  or their start state shows at t=0.
- The camera is a wrapper with `transform-origin: 0 0`; a shot is
  `{ x, y, scale }` worked out from the footage point to frame (see `cam()` in
  `real-ui-hero`). The footage element stays at its CSS size (1600x900) and is
  only ever scaled by the camera.
- `hyperframes.json` keeps `media.autoProxy: false`, or HD footage is proxied
  down. Render with `--video-frame-format=png` (bin/render.sh does): JPEG
  extraction smears UI text.
- Run `npm run check` after every change and look at the contact sheet after
  every render.

## Captures

- A capture runs its own throwaway app; never point one at a real data dir.
- `--mode=hd` is for anything the camera zooms into; `--mode=smooth` only at 1:1.
- Place clips by demo scene plus an offset (the hero's `clip()` in
  `beats.mjs`), never by raw seconds into one recording: a re-recording on
  another machine runs at another speed. Record which capture a composition
  uses in its `media.json`, and how every capture is made in `captures.json`,
  so `npm run capture <composition>` can rebuild them all from nothing.
- After any re-recording or recut, run `npm run review <composition>` and look
  at every frame against `beats.txt`.
- Captures, renders and staged assets stay out of git (`.gitignore`).
