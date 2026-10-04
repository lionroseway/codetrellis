# Video

Product video for codetrellis.dev, made in code: the real app is recorded while
its own demo script drives it, and the recording is cut, framed and captioned in
an HTML composition that renders to MP4. Change the UI, run it again, get the new
video.

This folder is standalone. It has its own `package.json`; nothing in the app
depends on it, and `npm ci` at the repository root does not install it.

## What the spike found (October 2026)

Four approaches were tried, all at 1920x1080, 30 fps:

| Composition | What it is | UI on screen |
|---|---|---|
| `real-ui-hero` | Light, mockup-style hero: headline, then the real window, four zoomed moments, the real phone answering a breakpoint, end card. 33 s. **The one that stuck.** | Real |
| `real-footage` | The same demo cut darker and plainer, from a smooth capture at 1:1. 28 s. | Real |
| `collision` | A drawn graph and two agents colliding. 12 s. | Mock |
| `remotion-hero` | The light hero in React with Remotion. 12 s. | Mock |

The lesson: motion graphics around **real UI** read as the product; a drawn
mock of the app, however slick, does not. The two mock versions are kept for
their motion and type, not their screens.

HyperFrames (HTML + GSAP, Apache 2.0) is the default. Remotion did as well on
looks, but it is licensed per company headcount (free up to three people), so it
lives in its own folder with its own dependencies and nothing else uses it.

## Layout

```
video/
  bin/
    env.sh            tool paths (FFmpeg from npm, Chromium on the machine), telemetry off
    setup.mjs         copies GSAP and the Geist fonts into each composition
    stage.mjs         copies footage and stills from captures/ as media.json says
    check.sh          HyperFrames' check on every HTML composition
    render.sh         stage, check, render one composition, contact sheet
  capture/
    demo.sh           throwaway app + recorder + a demo group, then encode
    desktop.cjs       records the window: --mode=hd (2x) or --mode=smooth
    phone.sh          phone preview + recorder, then encode
    phone.cjs         records a real phone screen being answered
    phone/*.json      what the phone screen is shown (one file per scene)
    encode.cjs        timed frames -> constant 30 fps H.264, scenes.json
    chromium.cjs      the browser the recorders drive
  compositions/
    real-ui-hero/     index.html + media.json (which captures it was cut from)
    real-footage/
    collision/
    remotion-hero/    its own package.json, src/, render.sh
  captures/           recordings          (not in git)
  out/                rendered videos     (not in git)
```

## Setup

```
cd video
npm install
npm run setup
```

Node 26 (the repository's `.nvmrc`), and the repository's own `npm ci` done, since
the captures run the app and the demo from the root. FFmpeg comes from npm, so
nothing needs a system install. Chromium is whatever the machine has: a cloud
session's `/opt/pw-browsers`, or the browsers the repository's Playwright
installed; set `VIDEO_CHROMIUM` (recording) or `HYPERFRAMES_BROWSER_PATH`
(rendering) to use another.

## The workflow

**1. Capture.** Quit CodeTrellis first: the capture runs its own app on :3001,
:5173 and :19432, with a throwaway data directory, so it never sees your data.

```
npm run capture:desktop          # captures/parallel-hd      (2x, for zooming in)
npm run capture:desktop:smooth   # captures/parallel-smooth  (every frame, 1:1)
npm run capture:phone            # captures/phone-breakpoint
```

`capture:desktop` runs `scripts/demo.ts --group=parallel --decide` against the
app while recording, so what is on screen is the app doing the real thing: two
agents in their worktrees, the overlap, the notice, the breakpoint. Any demo
group works (`npm run demo -- --list` at the root):

```
bash capture/demo.sh <name> --group=<group> [--mode=hd|smooth] [--pace=slow|normal|fast]
```

Each capture writes `raw.mp4` and, for the desktop, `scenes.json`: when each demo
scene starts, in seconds of `raw.mp4`.

**2. Stage.** `npm run stage` copies each composition's footage and stills into
its `assets/`, as its `media.json` says. `render` does this for you.

**3. Edit.** A composition is one `index.html`: clips placed with `data-start`,
`data-duration` and `data-media-start`, and one paused GSAP timeline for the
camera, captions and transitions. To scrub through it, run
`npx hyperframes preview compositions/<name>` (HyperFrames' studio).

**4. Check.** `npm run check` runs HyperFrames' lint, layout, motion and
contrast checks. Fix errors; read the warnings.

**5. Render.**

```
npm run render real-ui-hero      # out/real-ui-hero.mp4 + out/real-ui-hero-contact.png
npm run render:all
```

Look at the contact sheet first; it shows six frames across the video.

### After re-recording

The `data-media-start` times in each `index.html` were cut against the captures
recorded on 2026-10-04. A new recording moves them. Compare the new
`scenes.json` with the old one and shift each clip by the difference in its
scene's start; the scenes themselves take the same time at the same pace.

### Recording on a Mac

The cloud container renders in software, so `--mode=hd` manages about one frame
a second there (the UI changes in steps, and `encode.cjs` dissolves between
them). On a Mac the same capture should be much faster, and a real Retina screen
may make `--mode=smooth` sharp enough on its own. Nothing here is platform
specific.

## What is in git, and what is not

In git: every script, composition, phone fixture and `media.json`. Everything
else is made by them.

Not in git: `node_modules/`, `captures/`, `out/`, and each composition's
`assets/` (GSAP and fonts from `npm run setup`, footage from `npm run stage`).
To get it all back: `npm install`, `npm run setup`, the three captures, then
`npm run render:all`. Keep a copy of `captures/` if a particular take matters:
re-recording gives the same scenes, not the same frames.

## Limits, said plainly

- **The phone is not paired.** Its screen is the real app code
  (`mobile/app/breakpoints.tsx` through `tools/phone-preview`), shown data from
  `capture/phone/breakpoint.json` that matches the desktop scene, not data sent
  live from the desktop.
- **HD capture is about 1 fps** in a cloud container; the motion is the camera.
- **No sound.** Music and voiceover need their own sources and licences.
- **Wording** comes from `docs/website/feature-atlas.md`, including what the
  site must not promise ("Say carefully").

## Next

Deciding which videos the site needs (a hero loop, one per feature, a launch
piece, social cuts) and what each should show. The pipeline makes any of them;
the choice is the next step. Background reading: `docs/website/video-research.md`.
