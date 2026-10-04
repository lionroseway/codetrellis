# The hero video

The storyboard for the video at the top of codetrellis.dev, agreed 2026-10-04. It
does the site's heavy lifting: show, don't tell, and show how the features tie
together into one workflow, from one agent to a team. The smaller videos for the
rest of the site come after this one, each zeroing in on one area.

Built with `video/` (see its README): real CodeTrellis UI only, recorded while
the demo script drives the app, composed in HyperFrames. Wording follows
`feature-atlas.md`, including "Say carefully".

## Messaging

**Pain:** *Your agents write code faster than you can read it.*

**Position:** observability. That is where CodeTrellis is unique. Lead with the
benefit (keeping up), not the mechanism (multi-agent).

- Eyebrow: **Observability for AI coding agents**
- Headline: **Keep up with your agents.**
- Tagline: **CodeTrellis is the observability layer for AI coding agents. Check,
  correct and steer them at the speed they write code, however complex your
  workflow.**
- The ladder, so it fits everyone: one agent you want kept on track; several
  sharing one task; a whole team of agents and developers working at once, and
  everyone, people and agents, sees everything.
- Second half of the message: *you watch your agents, and your agents can show
  you.*
- Always said: **free and open source (Apache 2.0)**, on your machine, no
  telemetry.

"Observability" means log tools to many developers, so it is always paired with
the plain verbs: see, check, correct, steer.

## Shape

About 85–90 seconds, in acts that escalate from the basics to governance. Acts 4
and 5 carry many features as one- or two-second flashes and mosaic tiles, so the
main beats keep their pace.

Layouts vary so it never reads as a screen recording: split views (big text one
side, the live window the other, alternating sides), stacked windows, mosaics of
real clips, and full-window camera moves into the detail.

## The acts

Source key: **have**: captured already · **scene**: an existing demo scene, not yet
captured · **new**: needs a new demo scene or capture.

### 0 · Pain
| Beat | Text | On screen | Source |
|---|---|---|---|
| Flood | *Your agents write code faster than you can read it.* | Timeline and files changing faster than anyone could read, the graph lighting up | **new** |

### 1 · Title
| Beat | Text | On screen | Source |
|---|---|---|---|
| Title | Eyebrow, headline, tagline; pill *Free and open source* | Light page, the real window rises and settles | have |

### 2 · See and check (the basics)
| Beat | Text | On screen | Source |
|---|---|---|---|
| Connect | **Connect any agent.** Claude Code, Codex, Cursor, any MCP client | Connect dialog, the agent appears in the top bar | **new** |
| Plan | **Turn a ticket into a plan you approve.** | Plan built from a ticket; its status read from git under the ticket | scene `main` → plan; `teams` → plan-status |
| See | **See every change as it happens.** | Live graph and Timeline | scene `main` → work |
| Map | **However complex the system.** | Cross-system map: HTTP and SQL between services in different languages | scene `main` → graph |
| Check | **Check it did what you asked.** | Per-line Planned / Drifted / Outstanding | scene `main` → verdict, drift |
| Whose line | **See which agent wrote every line.** | Line history: "codex, seen: it landed while CodeTrellis recorded codex's session" | scene `code-history` → whose-line |

### 3 · Correct
| Beat | Text | On screen | Source |
|---|---|---|---|
| Intent | **Flagged before a file changes.** | An agent declares what it will change; the overlap appears first | scene `parallel` → intent |
| Hold | **Serious overlaps wait for you.** | A high-severity overlap holds the agent's next risky step | **new** (feature exists, no scene) |
| Breakpoint | **Ask me before this changes.** | The edit pauses; Continue with steer | have |
| Channel | **Your agent asks when it should.** | The agent hits a decision and asks you in a channel | scene `main` → channel |

### 4 · Together
| Beat | Text | On screen | Source |
|---|---|---|---|
| One | **One agent, kept on track.** | One window | from Act 2 captures |
| Several | **Several on one task, told before they collide.** | Two worktrees, the overlap, the notice to the agent | have |
| Team | **Your teammates and their agents, aware of every change.** | A developer's branch as a line of work beside the agents' | **new** (add a human branch to `parallel`) |
| Mosaic | **A whole team.** | Tiles: team stack · Timeline lanes · play-forward · weekly playbook · stuck detection (opt-in) · replay | scenes `observe`, `teams` → recurring |

### 5 · Hold the line
| Beat | Text | On screen | Source |
|---|---|---|---|
| Rule | **Write your architecture down once.** | "web/ may not import db/, except db/types.ts", with the reason | scene `teams` → rules |
| Told | **Agents check before they break it.** | The agent told, only the work that breaks it | scene `teams` → rules |
| Review | **Review against the plan and your rules.** | Did it do what the plan said; review queue knows what else is in flight | scene `main` → review; `observe` → review-queue |
| Flashes | *"Done" means tested* · *Docs flagged when code moves* · *Budgets tell agents to stop* · *Freeze for release week* | One to two seconds each | scenes `teams` → grounding; `main` → docs, budget; **new** freeze |
| CI | **CI fails when work drifts from your architecture.** | A real `codetrellis check` exits 3 on the breach, passes after the fix | **new** |
| Cloud | **In cloud sessions and pipelines too.** | SessionStart hook, headless CLI | **new** (terminal) |

### 6 · Anywhere
| Beat | Text | On screen | Source |
|---|---|---|---|
| Digest | **Catch up in under a minute.** | The digest: who overlaps, what changed, whether the agents were told, what you're asked | **new** (feature exists) |
| Ask | **Ask your agent to show you.** | The window moves on its own: the overlap, the lines, a moment in replay | **new** |
| Phone | **Take it with you.** | The phone answers a breakpoint; the agent's terminal on the phone | have (breakpoint); **new** (terminal) |

### 7 · Proof and trust
| Beat | Text | On screen | Source |
|---|---|---|---|
| Replay | **Replay exactly what happened.** | Scrub back through time | scene `observe` → replay |
| Record | **Prove it later.** | Approved, exported, verified | scene `record` → evidence |
| Strip | *On your machine · No telemetry · Open source* · *13 languages + SQL · Any MCP agent · 212 tools · Desktop, iOS, Android* | Text strip | — |

### Close
Dimmed product shot; **Use CodeTrellis to…** with the line rotating:

- keep agents to the work you agreed
- see every change as it happens, and correct it
- catch two agents on the same code before it collides
- work alongside your teammates and their agents, aware of every change
- enforce your architecture, in the editor and in CI
- review agent work against the plan and your rules
- let your agent walk you through what it did
- answer your agents from your phone
- replay exactly what happened

Then: **And many more features and use cases.** (on the site, it leads down into
the feature sections).

### End
The real logo (`resources/icon.png`, in its dark tile; there is no SVG) ·
**Keep up with your agents.** · *Free and open source · Apache 2.0* · Download.
No other mark.

## As built (2026-10-04)

`video/compositions/hero/beats.mjs` is the edit; it runs about 2 min 37 s.
Every beat opens where its footage shows what its words say (see the
comments there for the moment each one is cut on). Where the storyboard and
the cut differ:

- **Intent** and **Channel** are left out for now: the captures say them in
  the narration panel, not in the product, so the picture would not show
  the claim.
- **See every change** uses the `scale` scene, recorded after open plans
  started following agents' claims and progress live (they did not before;
  found while cutting this beat).
- **Cloud** is folded into the CI beat's line; there is no terminal capture
  of a cloud session yet.
- **Flashes** are a mosaic: refused "done", the release freeze, a vague
  plan flagged.
- **Phone** shows the breakpoint answered on the phone beside the desktop
  card clearing; the phone terminal is not captured yet.

## Formats

- **On the site:** the hero section uses the split layout live. Headline,
  tagline and the rotating lines are page text, and the video plays in the window
  beside them, timed to the same beats. The text stays sharp, accessible and
  searchable, and copy changes need no re-render.
- **Everywhere else** (YouTube, social, the README): the same edit with the text
  burned in.

## Say carefully

- Agents **show** and **suggest**; approvals and decisions stay the person's.
- **Steer** and **pause**, never "control". CodeTrellis does not launch agents.
- Budgets **tell agents to stop**; they do not enforce.
- Stuck detection is **opt-in**.
- Review is framed as **conformance** (plan, rules, tests), not a full code
  review tool.

## Build order

1. The new scenes and captures (flood, connect, hold, teammate branch, CI gate,
   cloud session, freeze, digest, ask-to-show, phone terminal).
2. Captures of the existing scenes listed above, in `--mode=hd`.
3. The edit, act by act, each one reviewed before the next.

Then the smaller videos for the rest of the site.
