# The talk's demo videos

Seven short pieces that play behind a person talking ("Who's shaping your
codebase?", the Control section): no sound, one caption per beat, the camera
on the thing being said. The talk teaches a lifecycle, not a product, so each
is a "here is how I do this step". Made the way the hero is (`../README.md`):
the real app recorded while a demo drives it, cut in code, rendered headless.

| File | Part | Shows | Ends on |
|---|---|---|---|
| `demo-01-plan.mp4` | 1 · Plan | the epic and its three stories, the spec, a task's acceptance criteria, the plan as files | the plan, every story in view |
| `demo-02-build.mp4` | 1 · Build | one session claims a task; the Timeline as it builds; which agent wrote a line, and its commit; criteria approved | the task done, with its criteria |
| `demo-03-rules.mp4` | 1 · Check | the rule file, promoted warn → block; a proposal waiting; a breach told to the agent; `codetrellis check` exit 3; the kept run; the fix; exit 0; the same pull request failing then passing on GitHub Actions | the passing check, in CI |
| `demo-04-review.mp4` | 1 · Review | landed, partly landed, untouched, the file nobody claimed; the drafted PR description | the review summary |
| `demo-05-epic.mp4` | 2 · Scale | three sessions claim the save, read and audit stories; lines of work; The Stack | The Stack, every story claimed |
| `demo-06-overlap.mp4` | 2 · Coordinate | two sessions in one function, flagged high; a person messages the agents; one answers | the overlap card |
| `demo-07-breakpoint.mp4` | 2 · Oversee | a breakpoint; the held edit; Continue with steer on the phone; what the agent then wrote | the new field in the reader (the still is the held edit) |

Each `demo-0N-still.png` is that demo's fallback still.

## Make them

```bash
cd video
npm install && npm run setup           # once
bash talk/record.sh --record           # record both parts, render, review, export: about fifteen minutes
bash talk/record.sh demo-03-rules      # one again, from the footage there is
bash talk/ci.sh                        # demo 03's CI beat again: pushes to GitHub, runs Actions, records both runs
```

Everything lands in `out/talk/`. Then look at `out/<name>-review/`: a frame of
every beat beside its words in `beats.txt`. Nothing else checks that a caption
is true of its picture.

It records beside a running CodeTrellis (its own app on :3411, :5273 and
:19532, its own data directory), so nothing needs quitting.

## What is what

- **The story** is two demo groups in `scripts/demo/groups/talk.ts`: `talk`
  (part 1, one agent: demos 01-04) and `talk-team` (part 2, three agents:
  demos 05-07), each a recording of its own. Every scene is a moment a video
  cuts on. `npm run demo -- --list` shows them;
  `docs/DEMO-JOURNEYS.md` says what to watch for in each.
- **The sample repository** is `scripts/demo/fixtures/prefs-api.ts`: a small
  TypeScript API, `src/endpoints/` → `src/services/` → `src/db/`, with its
  rule in `.codetrellis/rules/architecture.yaml`. The epic is customer
  preferences, in three stories: save, read, audit. A recording builds it fresh
  in a temp folder, with a worktree per line of work, and removes it. There
  is nothing to reset.
- **The cut** of each video is its `compositions/<name>/beats.mjs`: which
  scene, how far in, where the camera goes, the caption. `talk/build.mjs`
  turns that into the page that renders.
- **The phone** in demo 07 is `capture/phone/talk-steer.json`.

## What these are, said plainly

- **The agents are scripted.** MCP clients connect the way Claude Code
  does (same name, placed by the worktree each runs in) and make the calls an
  agent would: claim, edit, acknowledge. Nothing waits on a model, so nothing
  is sped up; the edits are written by the demo, not generated. The held edit
  goes through Claude Code's real PreToolUse hook.
- **The app is the web build from source**, in a headless browser, at the
  commit the capture ran on. It is the same interface as the desktop app, with
  one visible difference: a person's action over plain HTTP is marked
  "unverified" (the approvals in demo 02, the rule's `by:` in demo 03, the message in demo 06), where
  the desktop window's would not be.
- **The phone is not paired.** Its screens are the real phone app's, shown the
  same held edit from a fixture, and cut so its Send lands as the desktop
  takes the answer. The desktop's answer arrives over HTTP, as the phone's
  would.
- **Clicks and typing in the window are real** (`capture/desktop.cjs` takes
  them in the page), with a pointer drawn so a change has a visible cause.
- **Every cut skips time** and says so ("TIME TRIMMED", top right, for a
  moment). Nothing is faster than it happened.
- **CI is GitHub's own pages, signed out.** Demo 03 ends on the sample
  repository's pull request on real GitHub Actions
  (`lionroseway/acme-customer-api`, pushed by `talk/ci.sh`): failing with exit
  3 at the breaking commit, passing after the fix. Signed out, GitHub shows the
  commit's ✗ or ✓ and the run with its exit code, not the log, so the
  "Does not conform" text is in the terminal shots, not the CI ones.

## Say carefully

- Rule checks are deterministic. Agent checks are a separate thing and are not
  in these videos.
- A breakpoint holds an edit that asks first. A write that gets past it is
  reported, not undone.
- An overlap is flagged to people and agents. It does not stop a conflict by
  itself.
- Agents claim tasks from the plan. They do not divide the work themselves.
- The check runs on the pull request's commit in the main checkout; the app
  does not check a worktree it has not opened.
