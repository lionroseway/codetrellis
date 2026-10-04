# Section videos

The home page below the hero, and the short loop in each place. Agreed
2026-10-04 against the mockup on the design canvas. The hero
([`hero-video.md`](hero-video.md)) does the heavy lifting; these are simple.

**Who does what.** This side (the video pipeline in `video/`) makes every loop
and the CI transcript, from real captures, with one command. The words on the
page belong to the website session, which writes the copy and builds the page;
the headings below are working titles from [`feature-atlas.md`](feature-atlas.md)
for it to replace.

## The page

Kept short on purpose: it ends. Anything else the atlas covers gets its own
page from the website session, not another row here.

| # | Section | Loops |
|---|---|---|
| 1 | Hero | The hero film |
| 2 | Stats strip | — |
| 3 | Scales with you: one agent → several → a team | `ladder-one-agent`, `ladder-several`, `ladder-team` |
| 4 | Map the codebase | `row-map` |
| 5 | Plans | `row-plans` |
| 6 | Many agents at once | `row-collide` |
| 7 | Steer and protect | `row-steer` + `row-steer-phone` beside it |
| 8 | Review | `row-review` |
| 9 | Hold the line | `row-rules` + the CI run typed from `ci-gate.json` |
| 10 | More to explore (scrolling cards) | `card-digest`, `card-lines`, `card-replay`, `card-freeze`, `card-playbook`, `card-tested`, `card-merge-order`, `card-approve`, `card-prove`, `card-phone` |
| 11 | Security and privacy | — |
| 12 | Download | — |

Twenty loops and one transcript. What each shows, and the capture and moment
it is cut from, is in [`video/clips/site.json`](../../video/clips/site.json),
the single list the renderer reads.

## What a loop is

- **One moment, a few seconds** (2–8 s), cut where the thing happens: the
  picture shows what the heading claims. Checked frame by frame when the list
  was made; three candidates were dropped or re-cut for not showing it.
- **Seamless.** The last 0.6 s dissolves over the first, so it loops with no
  jump. No camera move (a zoom cannot loop); the crop is the framing.
- **No words burned in.** The page's text sits beside it.
- **Small.** Wide 1280×720 (rows, ladder), card 960×600 (16:10), phone 540 wide.
  H.264 MP4 and VP9 WebM, 30–330 KB each, plus a poster JPEG.
- **On the page:** `autoplay muted loop playsinline`, poster first, paused for
  `prefers-reduced-motion`; cards may play on hover and on tap.

## Making them

On the machine that will hand them over (see `video/README.md`, "From scratch"):

```
cd video
npm run clips        # captures anything missing, then renders out/clips/
```

`out/clips/` holds every loop, its poster, `ci-gate.json`, and `manifest.json`
saying what each shows and where it was cut from. That folder, plus
`out/hero.mp4`, is the whole hand-over to the website session.

Look at the posters before handing over, and play a few. A re-recording keeps
each loop in its demo scene, but timing inside a scene can move: where a poster
no longer shows its claim, nudge that clip's `at` in `clips/site.json`.

## Not shown yet

Features the atlas lists that no capture shows in the product yet. Each needs a
demo scene before a loop can be made: channels and stuck detection, the budget
decision, the test-grounding overlay, a system doc going stale, cloud sessions,
and an agent declaring intent.
