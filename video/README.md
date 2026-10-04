# Video

Product video for codetrellis.dev, made in code: the real app is recorded while
its own demo script drives it, and the recording is cut, framed and captioned in
an HTML composition that renders to MP4. Change the UI, run it again, get the new
video.

This folder is standalone. It has its own `package.json`; nothing in the app
depends on it, and `npm ci` at the repository root does not install it.

## From scratch, on your own machine

Everything below runs on a Mac (or Linux) with nothing but Node and git. No
system FFmpeg, no screen recorder, no account: the captures drive the app in a
browser of their own, and the renders run headless.

```bash
# 1. The repository, on its own Node (.nvmrc says 26)
git clone https://github.com/lionroseway/codetrellis && cd codetrellis
fnm use            # or nvm use; any Node 26
npm ci
npm ci --prefix mobile                 # the phone captures render mobile/ screens
npx playwright install chromium        # the browser captures and renders use

# 2. The video toolkit
cd video
npm install && npm run setup

# 3. Quit CodeTrellis (captures run their own app on :3001, :5173, :19432)

# 4. Capture everything the hero uses, render it, photograph every beat
npm run hero
```

`npm run hero` is three steps you can also run alone:

| Step | Command | Makes | Takes (cloud container; a Mac is faster) |
|---|---|---|---|
| Capture | `npm run capture hero` | `captures/*` for every capture `compositions/hero/media.json` names, from `captures.json` (skips ones you have; `-- --force` redoes them) | ~25 min, one app at a time |
| Render | `npm run render hero` | `out/hero.mp4` (~80 MB master) and `out/hero-contact.png` | ~7 min |
| Review | `npm run review hero` | `out/hero-review/`: a frame of every beat at its moment, contact sheets, and `beats.txt` listing what each beat says | ~3 min |

**Then look at `out/hero-review/`.** Clips are placed by demo scene plus an
offset (`beats.mjs`), so a re-recording on a faster or slower machine keeps
every beat in its scene. Inside a scene, timing can still move a little (a map
that loads faster, say). For each frame, check the picture shows the words in
`beats.txt`; where one does not, nudge that beat's offset in `beats.mjs` and run
`npm run review hero` again. Only you can do this check: the composition lint
passes on a video whose captions lie.

A lighter copy for sharing or review channels that refuse large files
(`env.sh` is bash; from zsh, wrap it in `bash -c '…'`):

```bash
bash -c '. bin/env.sh && "$FFMPEG" -i out/hero.mp4 -c:v libx264 -crf 26 -pix_fmt yuv420p -movflags +faststart out/hero-share.mp4'
```

### The site's short loops

```bash
npm run clips        # captures anything missing, then renders out/clips/ (~2–3 min)
```

Twenty seamless loops (MP4, WebM, poster each), the CI transcript, and
`manifest.json`, from `clips/site.json`: one list saying what each loop shows and
the capture, scene and moment it is cut from (`docs/website/section-videos.md`
has the page they go on). Look at every poster before handing them over.

`npm run site` does the hero and the loops in one go, then `npm run clean`.

### Disk

A smooth capture writes up to ~2 GB of frames before encoding them, so
`encode.cjs` deletes `frames/` once `raw.mp4` exists (`--keep-frames` keeps
them). Captures and renders stop up front when the disk has less than 3 GB
(capture) or 2 GB (render) free, rather than dying halfway. `npm run clean`
removes what is rebuildable (leftover frames, HyperFrames' temporary render
folders, footage staged into `compositions/*/assets`); `npm run clean -- --all`
also removes `captures/` and `out/`.

### What the capture's app is given

- **A demo identity.** The app takes "you" from git config, so `demo.sh` gives
  its throwaway app `Alex Kim <alex@acme.test>`; otherwise a recording shows
  the real name and email of whoever ran it.
- **The capabilities a group needs.** `captures.json` can say
  `"grant": "terminal"`; the demo holds it for the run (`npm run demo --
  --grant=…`, `scripts/demo/grant.ts`), as a person would turn it on in
  Settings → MCP Server. Only a test backend accepts a grant over HTTP.

### On a Mac

- Vite listens on `::1` only, so the scripts poll `localhost`, not
  `127.0.0.1`, and check both address families for a busy port.
- Playwright installs "Chrome for Testing" (`chrome-headless-shell`,
  `Google Chrome for Testing.app`); `env.sh` finds both layouts.

### Handing it to the website

The website session needs only `out/hero.mp4` (or `out/hero-share.mp4`) and
`out/clips/`. Nothing else in this folder ships with the site.

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
  captures.json       how every capture is made (demo group, mode, pace; phone fixture; CI run)
  bin/
    env.sh            tool paths (FFmpeg from npm, Chromium on the machine), telemetry off
    review.mjs        a frame of every beat at its moment, to check the words against the picture
    clips.mjs         renders clips/site.json into out/clips/: seamless loops, posters, manifest
    motion.mjs        how much moves, second by second, in a capture: where to cut
    setup.mjs         copies GSAP and the Geist fonts into each composition
    clean.mjs         frees the disk: leftover frames, render temp, staged footage
    stage.mjs         copies footage and stills from captures/ as media.json says
    check.sh          HyperFrames' check on every HTML composition
    render.sh         stage, check, render one composition, contact sheet
  clips/
    site.json         every short loop on the site: capture, scene, moment, crop
  capture/
    all.mjs           every capture a composition (or `clips`) uses, from captures.json
    ci.cjs            a real `codetrellis check` run, recorded as a transcript
    demo.sh           throwaway app + recorder + a demo group, then encode
    desktop.cjs       records the window: --mode=hd (2x) or --mode=smooth
    phone.sh          phone preview + recorder, then encode
    phone.cjs         records a real phone screen being answered
    phone/*.json      what the phone screen is shown (one file per scene)
    encode.cjs        timed frames -> constant 30 fps H.264, scenes.json
    chromium.cjs      the browser the recorders drive
  compositions/
    hero/             the site hero: beats.mjs (the edit) → build.mjs → index.html
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

The hero places every clip by demo scene and an offset into it, and reads each
capture's `scenes.json` when it builds, so a new recording needs no retiming
by hand; run `npm run review hero` and check the frames. The older spike
compositions (`real-ui-hero`, `real-footage`) still carry raw
`data-media-start` seconds cut against the 2026-10-04 captures: shift each clip
by the difference in its scene's start between the old and new `scenes.json`.

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
