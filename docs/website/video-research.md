# Motion-graphics video for CodeTrellis: research

Researched 2026-10-03, ahead of the website rebuild. The leaning is **HyperFrames**, for
the reasons below.

**Since built:** the spike ran on 2026-10-04 and is now [`video/`](../../video/README.md).
It records the real app while its demo drives it, records the real phone screen, and
composes both in HyperFrames. Its README has the four results and the workflow. The one
firm lesson was that motion graphics around **real UI** read as the product, and a drawn
mock of the app does not.

## What people mean by "Opus 5.5 makes videos"

It is not text-to-video in the way Veo or Kling are. The model writes the animation as
code (HTML/CSS/JS, or React), and a renderer steps through it frame by frame into an
MP4. That is why the results are crisp, on-brand and re-renderable, and why it suits a
product video: the same source renders again when the product changes.

The widely shared claims ("pro motion graphics in 15 minutes, worth $8–10k") are
marketing. Good output still needs art direction and a few rounds of iteration.

## The three ways it is done

| | How it works | Licence | Fit for CodeTrellis |
|---|---|---|---|
| **HyperFrames** (HeyGen, open-sourced April 2026) | The agent writes ordinary HTML, CSS and GSAP animation. A CLI steps headless Chromium through it frame by frame (deterministic, reproducible across machines), then FFmpeg encodes the MP4. Agent skill: `npx skills add heygen-com/hyperframes`; render: `npx hyperframes render`. Needs Node 22+ and FFmpeg. | Apache 2.0: no fees, no API keys, no cloud | **Best fit.** It is web technology, so one animation can be the website's hero and the video. |
| **Remotion** | The agent writes React components (frame-driven: `useCurrentFrame`, interpolation helpers); Remotion renders them to video. Official agent skills since January 2026 (`npx remotion skills add`), the most installed video skill for Claude Code. Ships its own compositor binaries through npm. | Free for individuals and for-profit companies of up to 3 people; above that a company licence (about $25 per seat per month for low-volume creators, per-render pricing for automation). No difference in features. | Mature and well documented; the licence depends on headcount. |
| **Do it ourselves** | The scene can draw any moment `t`; Playwright captures each frame; FFmpeg encodes. | Nothing new to license | What both tools do inside. Only worth it if we outgrow them. |

## Real product footage

The demo scenes in `scripts/demo/` already drive the app through every Phase 32
feature, so the footage can be genuine and re-recorded by rerunning the script when
the UI changes.

- **Avoid Playwright's built-in `recordVideo`.** It is fixed at about 1 Mbit/s VP8:
  blurry text and colour shift.
- **Use Chrome's own screencast** (CDP) at JPEG quality 100 and transcode to H.264;
  that is what people use for crisp demo footage.
- **Playwright 1.59+** adds `page.screencast`, with chapter markers and starting and
  stopping mid-run. The repo is on 1.63.

The footage clips then sit inside the HyperFrames (or Remotion) composition as video
layers, with titles, callouts and transitions on top. "Editing it in" is writing that
composition; a timeline editor is optional for finishing.

## Website animation, exported

The strongest argument for HyperFrames: if the rebuilt site animates with HTML and
GSAP, the same file runs live on the site and renders to MP4 for social posts, a
launch video or the README. One source, nothing to keep in sync.

## What the cloud container can and can't do

Checked in the Claude Code cloud session that wrote this:

- Available: Node 26, Chromium, the npm registry.
- **No system FFmpeg, and none needed.** The one Playwright bundles
  (`/opt/pw-browsers/ffmpeg-*`) only encodes VP8 and PNG. The npm package
  `@ffmpeg-installer/ffmpeg` ships an FFmpeg with libx264 and installs from the
  registry, so `video/` uses that and nothing is installed system-wide.
- Downloads from GitHub releases are blocked there, so anything that fetches binaries
  from them (`ffmpeg-static`, for one) won't install. npm packages do.

## A pilot, when we go ahead

Twenty to thirty seconds, three beats:

1. **Hook, animated.** "Four agents. One codebase." The graph assembles, agent lanes
   light up.
2. **Real footage** from the demo scenes: two agents change `refreshToken`, the
   collision appears, both are told.
3. **A breakpoint answered on the phone**, then an end card.

HyperFrames as the compositor, footage captured through Chrome's own screencast,
everything kept in the repo so it re-renders when the UI changes. Wording comes from
`docs/website/feature-atlas.md`, including its "Say carefully" list.

Not covered by any of these tools: music and voiceover, which need their own source
and licences. Captions are straightforward.

## Before committing to a tool

The primary pages could not be opened from the session (its network policy blocks
them); the details above come from search results summarising the official docs and
repositories. Read the Remotion and HyperFrames terms on their own sites first.

## Sources

- [Remotion: prompting videos with coding agents](https://www.remotion.dev/docs/ai/coding-agents)
- [Remotion pricing](https://www.remotion.dev/docs/pricing) and [licence FAQ](https://www.remotion.dev/docs/license-pricing-compliance/faq)
- [Remotion agent skills guide 2026](https://aividpipeline.com/blog/remotion-agent-skills-guide-2026)
- [HyperFrames on GitHub](https://github.com/heygen-com/hyperframes)
- [HeyGen HyperFrames: HTML to MP4 for AI agents](https://www.noqta.tn/en/blog/heygen-hyperframes-html-to-mp4-ai-agent-video-2026)
- [AI Engineer talk: HTML is all agents need](https://ai.engineer/talks/html-is-all-agents-need)
- [How to make videos with Claude Opus 5.5: a deterministic render pipeline](https://huggingface.co/blog/karmen-beatapi/how-to-make-videos-with-claude-opus-5-5)
- [How to use Claude Opus 5.5 to make videos with code](https://magiccreator.ai/posts/how-to-use-claude-opus-5-5-to-make-videos)
- [Playwright issue #31424: video quality](https://github.com/microsoft/playwright/issues/31424)
- [Record a product demo with Playwright](https://flaviocopes.com/record-demo-video-playwright/)
- [Record browser video (2026)](https://alexwlchan.net/2026/record-browser-video/)
- [Playwright screencast](https://testdino.com/blog/playwright-screencast)
- [awesome-claude-video-skills](https://github.com/zhuyansen/awesome-claude-video-skills)
