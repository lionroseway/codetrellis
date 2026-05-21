# CodeTrellis — Marketing Asset Spec

> **Purpose**: Brief for the website frontend agent. Describes every
> captured screenshot and video, the story each tells, and how to
> deploy them on codetrellis.dev.
>
> **Image-first approach**: Screenshots are the primary visual assets.
> They are 4K retina PNGs (3840×2160) that look sharp at any size.
> Videos are supplementary — use them as optional "see it in action"
> embeds, not as the main content.
>
> Assets live in:
> - `marketing-assets/screenshots/` — 4K PNGs organised by value prop
> - `marketing-assets/videos/` — 1080p WebM videos (3 files)
>
> Regenerate any time with `npm run capture`.

---

## The Core Narrative

CodeTrellis is the **organising plane for agentic development**. It
doesn't host AI — it sits above every agent runtime (Claude Code,
Cursor, Codex, aider, custom) and gives developers the one thing no
agent can: **architectural awareness before, during, and after the
agent acts**.

Three beats drive the website:

1. **Understand** — Scan any codebase and see its real architecture
   across languages, packages, files, and symbols.
2. **Plan** — Structure work with plans, phases, specs, and
   projections *before* a single line is written.
3. **Keep on track** — Watch agents execute in real time. See
   progress, catch drift, review every tool call.

Every asset below maps to one of these beats.

---

## Screenshots — Organised by Value Prop

All screenshots use CodeTrellis scanning real codebases — either
itself (a large TypeScript project) or the `sample-app` fixture
(a TypeScript + Python + SQL monorepo). Terminal screenshots show
real Claude Code sessions connected via MCP.

### `understand/` — Graph views, inspector, cross-language

| File | What It Shows | Website Placement |
|------|---------------|-------------------|
| `hero-packages.png` | Full dependency graph at cluster/package level. Dense, colourful node clusters with edges showing real architectural coupling. CodeTrellis scanning itself. | **Hero section** — the first thing visitors see. Full-bleed or contained with subtle parallax. Establishes CodeTrellis as a visual, powerful tool. |
| `graph-files.png` | Same project drilled into file-level detail. Individual files visible with import edges. | Feature section: "Drill into any depth" — show the progression from clusters → files → symbols. |
| `graph-symbols.png` | Symbol-level graph — classes, functions, exports with their relationships. | Feature section continuation. The three depths (hero-packages → graph-files → graph-symbols) work as an animated sequence or carousel. |
| `inspector.png` | A file node selected with the inspector panel open — showing file metadata, exports, imports, and cross-references. | Detail callout: "Click anything to understand it." Inspector panel bridges the visual graph and code-level detail. |
| `cross-system-graph.png` | Cross-system dependency graph — TypeScript frontend, Python API, SQL schema all visible in one graph with HTTP/SQL coupling edges. Sample-app fixture. | Feature section: "Every language, one graph." The cross-system story is unique to CodeTrellis. |
| `file-imports.png` | File-level view showing import relationships across the monorepo. Python files importing from shared modules, TypeScript components importing API clients. | Detail for the cross-system story. Pair with cross-system-graph as a drill-down. |
| `symbols-multi-language.png` | Symbol-level graph for the multi-language project — Python classes and TypeScript functions in the same graph with their relationships. | Advanced feature callout. Shows the depth of static analysis. |

### `plan/` — Plans, projection, spec docs, comments

| File | What It Shows | Website Placement |
|------|---------------|-------------------|
| `workspace.png` | Plan workspace with "Add JWT Authentication" — tasks listed with status indicators (done/in-progress/pending), phases on the side, spec doc below. | Feature section: "Plan before you build." Shows the structured planning surface. |
| `projection.png` | Projection overlay — planned files highlighted on the dependency graph. Files that will be created glow differently from files that will be modified. | Feature section: "See the impact before it happens." The projection overlay is a key differentiator. |
| `split-view.png` | Side-by-side split: plan workspace on the left, dependency graph on the right. The plan's file targets are highlighted on the graph. | Feature section: "Plan and graph, together." |
| `comments.png` | Comments thread on the JWT auth plan — multi-author conversation (human + AI). | Social proof / collaboration callout: "Humans and agents collaborate on the same surface." |
| `create-plan.png` | Create Plan modal — clean form with title, description, template selection. | Feature section: "Start with a plan." Low-friction entry to structured planning. |
| `workspace-cross-language.png` | "Refactor Database Layer" plan on the sample app — tasks touching both Python services and TypeScript frontend. Plans span language boundaries. | Feature section: "Plans that cross boundaries." |

### `keep-on-track/` — Terminal, agent monitoring, drift, timeline

| File | What It Shows | Website Placement |
|------|---------------|-------------------|
| `terminal-agent.png` | Built-in terminal panel with a real Claude Code session running. The agent is active, connected via MCP, creating a plan in CodeTrellis. "1 agent" badge visible in the top bar. | Feature section: "Run agents right here." CodeTrellis isn't just a viewer — it's the control surface. |
| `agent-plan-building.png` | Agent connected via MCP, actively building a plan in real time. Plan workspace shows tasks appearing as the agent creates them. Progress bar at 65% on the active task. | Feature section: "Watch agents plan in real time." Plan updates live — no refresh, no window switching. |
| `full-workspace.png` | **The money shot.** Three-panel layout: plan workspace (left), dependency graph (right), terminal with active Claude Code agent (bottom). Everything visible at once. | **Primary feature hero** — this single image tells the whole story. Developer has full visibility. Use at full width. |
| `drift-detection.png` | Drift detection alert — the agent edited a file that wasn't in the plan. Changes/Diff tab highlights the unplanned modification. | Feature section: "Catch agents going off-plan." The safety story — automatic deviation detection. |
| `timeline.png` | Timeline populated with real MCP tool calls — register_session, create_plan, add_item, claim_item, update_item_progress, detect_deviations. Every action attributed and timestamped. | Feature section: "Full audit trail." Pair with drift detection for the complete oversight story. |

### `onboarding/` — Welcome, MCP guide, settings

| File | What It Shows | Website Placement |
|------|---------------|-------------------|
| `welcome.png` | Welcome screen — clean, inviting entry point with project scan CTA. | Secondary hero or "Getting Started" section. |
| `mcp-guide.png` | MCP setup guide modal — step-by-step instructions for connecting Claude Code (or any MCP agent). | Getting Started / Docs page. Shows that setup is a single config snippet. |
| `settings.png` | Settings modal showing configurable options. | Docs page or a "Customise your setup" callout. Low priority for hero pages. |

---

## Videos (Supplementary)

Three videos at native 1080p WebM. Use as optional "see it in action"
embeds — the screenshots carry the primary visual story.

| File | Duration | Story |
|------|----------|-------|
| `full-experience.webm` | ~2.8 min | One continuous take: open project → Claude Code creates a plan via MCP → executes a task → agent goes off-plan → drift detected → timeline review. |
| `understand-codebase.webm` | ~22s | Browse a multi-language project at every depth level: clusters → files → symbols → back to clusters. Perfect as a short loop. |
| `plan-before-build.webm` | ~1.6 min | Seed a JWT auth plan → show projection overlay → Claude Code refines the plan via MCP (adds tasks for refresh tokens, rate limiting, tests) → split view. |

### Post-processing (ffmpeg)

```bash
# Convert WebM → MP4 (H.264, web-optimised)
ffmpeg -i video.webm -c:v libx264 -crf 20 -preset slow \
  -movflags +faststart -an output.mp4

# Trim to specific range
ffmpeg -i video.webm -ss 00:00:02 -to 00:01:05 \
  -c:v libx264 -crf 20 -preset slow -movflags +faststart -an trimmed.mp4

# Create GIF from video (for social/docs)
ffmpeg -i video.webm -vf "fps=12,scale=960:-1" -loop 0 output.gif
```

---

## Visual Hierarchy for the Website (Image-First)

Recommended ordering on the homepage, top to bottom. **Lead with
screenshots** — they are sharper, load instantly, and tell the story
without requiring the visitor to press play.

1. **Hero** — `understand/hero-packages.png` (full graph) as the
   dominant visual. Alternatively `keep-on-track/full-workspace.png`
   (three-panel layout) for maximum impact.

2. **"Understand any codebase"** — Lead with `understand/cross-system-graph.png`.
   Supporting images: `understand/graph-files.png` → `understand/graph-symbols.png`
   (depth progression carousel), `understand/inspector.png` (detail callout).
   Optional: `understand-codebase.webm` as inline autoplay.

3. **"Plan before you build"** — Lead with `plan/split-view.png`.
   Supporting images: `plan/workspace.png`, `plan/projection.png`,
   `plan/create-plan.png`, `plan/comments.png`,
   `plan/workspace-cross-language.png`.
   Optional: `plan-before-build.webm` as inline embed.

4. **"Keep agents on track"** — Lead with `keep-on-track/full-workspace.png`.
   Supporting images: `keep-on-track/terminal-agent.png`,
   `keep-on-track/agent-plan-building.png`,
   `keep-on-track/drift-detection.png`,
   `keep-on-track/timeline.png`.
   Optional: `full-experience.webm` as "Watch it in action" CTA.

5. **"Works with every agent"** — `onboarding/mcp-guide.png` + logo grid
   (Claude Code, Cursor, Codex, aider). Text-driven section, minimal images.

6. **Getting Started** — `onboarding/welcome.png`, `onboarding/mcp-guide.png`.
   CTA to download v0.1.5.

---

## Asset Inventory Summary

| Category | Count | Format | Location |
|----------|-------|--------|----------|
| Screenshots — Understand | 7 | 4K PNG (3840×2160) | `screenshots/understand/` |
| Screenshots — Plan | 6 | 4K PNG (3840×2160) | `screenshots/plan/` |
| Screenshots — Keep on Track | 5 | 4K PNG (3840×2160) | `screenshots/keep-on-track/` |
| Screenshots — Onboarding | 3 | 4K PNG (3840×2160) | `screenshots/onboarding/` |
| Videos | 3 | 1080p WebM | `videos/` |
| **Total** | **24** | | |

---

## Key Differentiators to Stress

These are the stories the assets tell that no competitor can:

- **Cross-language architecture** — One graph for TypeScript, Python,
  Rust, PHP, Java, SQL. Not just imports — HTTP calls, SQL queries,
  subprocess invocations extracted and paired across language boundaries.

- **Plan-first development** — Structured plans with phases, specs,
  and templates. Agents build against plans, not blank canvases.

- **Live agent monitoring** — Watch progress bars fill, tasks
  complete, comments appear — all streaming via MCP. No polling, no
  refreshing.

- **Drift detection** — Automatic alerting when an agent edits files
  outside the plan scope. The safety net for autonomous coding.

- **Agent-agnostic** — Any MCP client works. Not locked to one vendor.
  The organising plane sits above all agent runtimes.

- **Full audit trail** — Every tool call, file edit, and plan mutation
  timestamped and attributed in the timeline. Complete visibility into
  what any agent did and why.

---

## Regeneration

```bash
# Regenerate all assets
npm run capture

# Screenshots only
npm run capture:screenshots

# Videos only
npm run capture:videos

# Single test
npx playwright test --config=playwright.marketing.config.ts -g "hero"
```
