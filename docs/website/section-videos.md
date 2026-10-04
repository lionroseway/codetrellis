# Section videos

The sections of codetrellis.dev below the hero, and the short video in each.
Proposed 2026-10-04, for agreement before any is cut. The hero
([`hero-video.md`](hero-video.md)) does the heavy lifting: it tells the whole story
once. These are simple. Each one shows one thing the section's heading says, and
nothing else.

Wording comes from [`feature-atlas.md`](feature-atlas.md), including "Say carefully".

## What a section video is

- **One idea, one moment.** 6–12 seconds, cut on the burst where the thing happens
  (the same rule as the hero: the picture shows what the heading claims).
- **A silent loop.** Autoplays muted, loops cleanly (the last frame dissolves back
  to the first), with a poster frame for reduced motion and slow connections.
- **No words burned in.** The heading and copy are page text beside the video, so
  they stay sharp, searchable and editable. The video is only the product.
- **The same window.** The hero's rounded window on the light page, so every
  section reads as the same product. A slow camera push into the one region that
  matters; no mosaics, no moving text.
- **Small.** 1280×720 WebM and MP4, under ~2 MB each, so a page of them loads.
- **Real UI, from the captures we already have.** Every row below says which
  capture and second it is cut from. A section with no honest footage gets a still,
  or waits for a capture, rather than a clip that does not show its claim.

Layout on the page: alternating split rows (copy left, video right, then the
reverse), as the hero's split beats do, so the site and the hero feel like one
thing.

## The sections

In page order. **Have** means the footage exists and shows the claim; **new**
means a capture is needed first.

| # | Section | Heading (from the atlas) | The video shows | Footage |
|---|---|---|---|---|
| 1 | Hero | Keep up with your agents. | The hero | Done |
| 2 | Three ways in | People, agents, pipelines | No video: three short cards | — |
| 3 | Map the codebase | However large the codebase | The map building, then the camera moving into HTTP and SQL edges between services in different languages | Have: `scale` big map; `main` "explore the graph" |
| 4 | Watch every agent | Any MCP agent, side by side | Agents connecting one by one in the top bar, then the Timeline filling lane by lane | Have: `hero` connect and flood |
| 5 | Plans | Turn a ticket into a plan the whole team runs | Three agents claiming tasks: Assigned, a bar, percentages in the tree, statuses landing in Activity | Have: `scale` in-flight (recorded with live updates) |
| 6 | Many agents at once | Told before they collide | Two lines of work change the same function; Awareness names it and the chips turn red | Have: `parallel` 10–15 s |
| 7 | Steer and protect | Ask me before this changes | A breakpoint holds an edit, then Continue | Have: `parallel` 33–36 s |
| 8 | Review | Check it did what you asked | Changed lines tinted against the plan, then line history naming the agent | Have: `main` verdict; `code-history` whose-line |
| 9 | Agents drive the interface | Ask your agent to show you | The window moving on its own: the overlap on the graph, then the lines | Have: `hero` catch-up 52–60 s |
| 10 | Phone | Take it with you | The phone answering a breakpoint, beside the desktop card clearing | Have: phone breakpoint; **new** for the phone terminal |
| 11 | Pipelines | CI fails when work drifts | The recorded `codetrellis check` failing, then passing | Have: `ci-gate` transcript |
| 12 | Teams and what's coming | See where plans will meet | The Stack, then play-forward showing two plans that will collide | Have: `observe` 23–37 s |
| 13 | The record | Prove it later | An approval, then Settings checking the chain intact | Have: `record` 12–20 s |
| 14 | Security and privacy | On your machine, no telemetry | No video: the facts as a list | — |
| 15 | Use cases | Simple, everyday, advanced | No new video: cards that reuse the clips above | — |
| 16 | Download | Free and open source | No video: the platform table | — |

Eleven clips, every one from footage already recorded. The phone terminal is the
only gap inside these sections.

## Not shown yet, and what each would need

Features the atlas lists that have no section clip, because no capture shows them
in the product yet. Worth a capture each if the section copy leans on them:

- **Channels and stuck detection**: a `stuck` event appearing on a plan and being
  steered (a new demo scene).
- **Budgets**: spend and forecast per agent, the 80% decision (the `main` budget
  scene shows the ceiling being set, not the decision).
- **Tests tied to code**: the test-grounding overlay across the graph.
- **System docs going stale**: a doc flipping to stale as its code moves (`main`
  has the scene; the moment needs checking).
- **Cloud sessions**: the SessionStart hook starting CodeTrellis headless.
- **Intent and channels in the product**, which the hero also left out for this
  reason.

## How they get made

The hero's pipeline, with a simpler composition: one beat per clip, the window
full-frame on the light page, no text, a single camera move, and a loop dissolve.
The clip list can live in one data file (section, source, start, length, camera)
and render to one WebM and MP4 per row plus a poster PNG. Re-recording a capture
re-cuts every clip that uses it after its starts are recalibrated, as for the hero.

## Decisions for the owner

- The section list and order above.
- Whether sections 2, 14, 15 and 16 really go without video.
- Which of the "not shown yet" features the copy needs, so their captures can be
  scheduled.
