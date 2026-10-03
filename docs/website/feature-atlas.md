# CodeTrellis feature atlas

What CodeTrellis does and who it is for, as of 0.1.18: every feature for people, agents and pipelines, use cases from simple to advanced, headline lines, and the limits to state honestly. Written as the reference for the website rebuild; it describes what ships, drawn from the source, the docs, the tool registry and `docs/releases/v0.1.18-plan.md`. Counts come from `docs/PHASE-32-VERIFICATION.md`.

CodeTrellis maps your codebase, plans the work, watches every AI coding agent working on it at once, tells them when their work collides before you have to, and keeps a record you can replay and prove. People use it as a full desktop app and a phone app; agents use the same features through MCP; pipelines run it headless.

212 MCP tools · 13 languages + SQL · Any MCP agent · Desktop + iOS + Android · No server of ours in the loop · No telemetry · Apache 2.0

## Three ways in

- **People.** A desktop app to explore code, review work, plan, answer agents and sign off, plus a phone app for when you're away. Useful with no agents at all.
- **Agents.** Any MCP client gets 212 tools: the map, plans, overlaps, tests and history, and it can drive every view a person needs to see.
- **Pipelines.** A headless CLI for cloud sessions and CI, with a gate that returns exit codes.

## The window: built for people

Everything below has a screen a person works in. Agents get the same answers through MCP, but the person stays in charge.

- **Graph and code side by side.** The dependency graph, the code with the lines in question, or both split, with an Inspector for whatever you select.
- **Plan workspace.** A tree of plans and tasks, each task's page and Brief, an activity drawer, a history drawer and a timeline scrubber.
- **Agents panel.** The Timeline with a lane per agent, Awareness, the Stack, Review and Breakpoints, as tabs beside your work.
- **Top bar at a glance.** Connected agents, the strip of lines of work, and what needs you.
- **Source control.** Changes, branches, compare and a file's evolution, with no plan required.
- **Replay and play-forward bars.** Scrub back to any moment, or forward to where today's plans will meet.
- **Presence pane.** Agents post narration cards explaining what they're doing; you acknowledge them or type a reply, and the agent waits for it.
- **Terminals.** Agent terminals inside the app, beside the work they're doing.
- **Approvals that are yours.** Approve plans, decide acceptance criteria, answer breakpoints, accept spec changes, set rules and grants. Agents can ask; only you decide.
- **Settings you can read.** Per-agent capability grants in plain words ("Read file contents", "Run commands and read terminal output"), devices, data and record retention, git, review hosts, plans folder sync (git, OneDrive, SharePoint), rules, recurring playbooks, updates, logs and power.
- **Connect an agent in one click.** Copy the Claude Code command, the JSON config, or instructions for any agent. One more click stops Claude Code asking permission for every CodeTrellis tool.
- **Stays awake while agents work.** Power-aware sleep prevention, and your session restored where you left it.
- **Getting started.** A first-run guide, and an in-app guide to every workflow.

## Map the codebase

A live map of what the code is and how it connects, kept current as files change.

- **Dependency graph.** Packages, files, then classes and functions. Zoom, scope, set depth, and lay it out layered or force-directed.
- **Thirteen languages.** TypeScript, TSX, JavaScript, JSX, Python, Rust, PHP, Java, Go, Ruby, C#, Kotlin and Swift, parsed in the app. SQL is found inside string literals in any of them.
- **Cross-system map.** HTTP calls in one service paired with the route that serves them in another, across languages, plus SQL, subprocess and environment-variable coupling.
- **Service discovery.** Microservices and their endpoints are found automatically, with no config to write.
- **Overlays.** Changes, test grounding, overlaps, planned work and diffs, laid over the graph.
- **Search and dependencies.** Find any symbol, and what any file depends on.
- **System docs that know when they're stale.** Write and version docs about your systems. Each shows current, moved or stale against the code, and you mark it re-verified.
- **Snapshots and export.** Export the graph or capture it as an image.

## Review tools for developers

For the person checking agent work before it merges.

- **Did the plan land?.** Review a plan between any two points: what it promised, what changed, and what's missing, as markdown ready to post.
- **Plan versus reality.** Deviations between what the plan expected and what's in the code, including files changed outside any task. Accept, revert or ignore each one.
- **Proposed-change feed.** Every change a plan proposes, each with its drift status worked out against the live code.
- **Compare anything.** Commits, branches, tags, checkpoints, other worktrees or the live tree, file by file and on the graph, or played back as a sequence.
- **Checkpoints.** Name the state of the code mid-plan and compare against it later.
- **Acceptance criteria and sign-off.** Agents offer evidence; mechanical checks run first; you approve or send back with a note, which tops the agent's worklist. A sign-off pack collects it all.
- **Re-check everything.** Re-hash every recorded file and re-run every criterion's checks on a plan, and see what moved.
- **Review queue.** Each plan and branch with where it stands and a suggested merge order, with the reason for each place.
- **Other work in flight.** Every review lists the overlaps naming that line of work and what became of each.
- **PR drafts.** A pull-request body that tells the story, for the agent to post with its own credentials.
- **Line history with the agent.** Who wrote a line and why: commit, author, and the agent, session, task and plan where known.

## How the code got here

Useful with no plan and no agents at all.

- **Changes sidebar.** What changed where, across the project.
- **A file's evolution.** How a file changed over time, played back.
- **Branches and pull requests.** Local and remote branches with upstream, ahead and behind; pull requests as your own `gh` last read them.
- **Plan history.** Every change to a plan's structure, its versions, a plan as it was at any commit, and the difference between two.
- **Replay.** The graph, the stack and what waited on you at any past moment, or catch up at 4×.
- **Team activity.** A feed of what the team has done in the project.

## Tests

CodeTrellis never runs your tests. It reads the reports your agents hand over and ties them to the code.

- **JUnit reports.** Totals, failing tests by name and the first line of why, credited to whoever ran them.
- **Tests tied to code.** For any source file: passing, failing, untested, or "tests older than the code".
- **Test grounding overlay.** The same answer across the graph, file by file.
- **No "done" on stale tests.** An agent can't mark a task done while its tests ran before the code last changed.

## Watch every agent

Agent-agnostic by design: anything that speaks MCP shows up, attributed, in one place.

- **Any MCP agent.** Claude Code, Codex, Cursor, aider, Claude Desktop, Gemini CLI and your own clients, side by side. Claude Code also gets a session-log watcher for richer detail.
- **The Timeline.** Every tool call by every agent, grouped into turns, with a lane per agent showing its commits and checks. It survives a restart.
- **Connected agents.** Who is connected right now, and which line of work each is in.
- **Connects once, stays connected.** One connector setup per agent keeps working across restarts.
- **Budgets.** Time and cost per plan across every agent: spent, forecast to completion, and a split per agent. Crossing 80% raises a decision; past 100% agents are told to stop claiming work.
- **A guide for every agent.** Agents fetch a guide to CodeTrellis's workflows, in flavours for solo, parallel and other ways of working.

## Many agents at once

Every line of work is watched, and agents are told about each other before their work collides.

- **Lines of work.** Every worktree, recent branch and clone is a line of work in the top-bar strip, and each agent is placed in the one it works in.
- **Footprints.** What each line of work has changed since it branched: files, the functions in them, and their signatures.
- **Collision.** Two lines of work changing the same function (serious) or the same file.
- **Contract.** One side changes an exported function's signature that the other side's code imports.
- **Drift.** An agent changing files outside the task it claimed.
- **Stale base.** Main has moved under a line of work since it branched.
- **Documents and spreadsheets too.** A document changed after a task cited it, two tasks on different versions of one spreadsheet, outputs that clash.
- **Agents told, unasked.** An agent learns of a serious overlap on its very next step, in plain words, even with no window open.
- **Declare intent.** An agent claims what it is about to change, so an overlap shows before anyone edits.
- **The digest.** A few lines a person reads in under a minute: who overlaps, what changed, whether the agents were told, and what you're asked.
- **Answer in one tap.** Acknowledge, mark Intended so it stays quiet, set aside, or reply to the agents in words.
- **Line-level detail.** Which lines another line of work changed in a file, the functions they fall in, and whether they're committed.

## Steer and protect

The person sets the boundaries; agents keep them.

- **Breakpoints.** "Ask me before touching payments." An agent's write to a file, function or spec waits for your answer (continue, stop, or steer with a note) from the desktop or the phone.
- **Breach notices.** A change made around a breakpoint, by an editor nothing could pause, is recorded and the agent is told.
- **Hold on serious overlaps.** A high-severity overlap can hold an agent's next risky step until you've seen it.
- **Architecture rules.** "web/ may not import db/, except db/types.ts", with the reason. Agents check proposed imports, overlaps flag new breaches, and CI enforces them.
- **Freeze.** Release week or an incident: freeze a project, exempt the plans that matter, and agents check before claiming work.
- **Baselines.** Measure drift against a baseline you set.
- **Deleting is the person's.** An agent can ask to delete a plan; you confirm by typing its name.
- **Optional hooks.** A Claude Code skill and hook, and a Gemini CLI hook, so the agent checks its footprint and your breakpoints before every edit. Written only when you click.

## Channels, stuck agents and asking for help

A shared vocabulary for agents and people to coordinate, so an agent that's stuck says so instead of spinning.

- **Six kinds of event.** `stuck`, `need-decision`, `need-context`, `handing-off`, `steer` and `weigh-in`, posted on a plan or a task.
- **Threads.** Each event can carry a back-and-forth; resolve or dismiss it when it's done.
- **Stuck detection.** Notices an agent calling the same tool over and over, hitting the same error repeatedly, or busy with nothing changing on disk, and posts a `stuck` event. Off by default, per project.
- **Blockers stand out.** An agent marks a task blocked with a reason instead of quietly stopping, and the blocker shows prominently.
- **Sensors feed the channel.** Plan deviations and stale docs post events too, batched so the channel stays readable.
- **Routing rules.** Send matching events to a webhook or an elevated in-app toast, including escalation when an event has sat open too long.
- **Ask a person and wait.** An agent puts a question in the Presence pane and waits for your typed reply or acknowledgement.
- **Answer from another device.** A question from an agent on one machine can be answered from another; the first answer wins.
- **Shared with the plan.** Channel events travel with the plan's files, so teammates see them too.

## Chaining work across agents

A plan is a work queue agents can pull from, one after another or many at once, with the person approving where it matters.

`get_next_item → claim_item → get_brief → declare_intent → work → report_tests → submit_criterion → next`

- **A queue agents pull from.** The next task respects dependencies, freezes, budgets and which worktree it belongs to, so many agents can work one plan without stepping on each other.
- **Fan out by worktree.** Give a section its own branch and only agents in that worktree take its tasks. One plan, many agents, in parallel.
- **Hand-offs.** An agent finishing its part posts `handing-off`; the next picks up with the full brief and what was read so far.
- **Build big plans in one call.** Create whole nested trees of tasks at once.
- **From your tracker.** Turn a Jira epic, a Linear project or a set of GitHub issues into a plan with ticket keys, using the agent's own tracker access (CodeTrellis never calls out), then write status back.
- **From a conversation.** Turn a transcript, notes or an issue body into a plan with tasks and file references.
- **Hand a plan to any agent.** Copy a plan or a task as a ready-made prompt with targets, constraints and git context.
- **Templates and playbooks.** Save a plan as a template; make a playbook recur, each run a fresh plan, and on a device of your choice have each run start an agent.
- **Wait for a person.** An agent can wait on a breakpoint answer or a reply, then carry on with the decision.
- **Know where work stands.** The worklist tells an agent exactly what it owes, sent-back items first.

## Agents drive the interface

Through MCP an agent can show a person what it means, not just tell them, on the desktop and on the phone. Changing what the app is allowed to reach stays with the person.

- **Go anywhere.** Open the plan workspace, a task's Brief, a file at the line it's citing, the graph, split view, a panel or drawer, or a Settings section, and go back and forward.
- **Drive the graph.** Focus a file, select nodes, set depth, layout, scope and overlay mode, toggle the plan projection, and snapshot or export.
- **Show a moment.** Open replay at a time and speed, play-forward, or a specific overlap or breakpoint.
- **See what you see.** Take a screenshot of the window, and check whether it's ready to use before acting.
- **Narrate.** Post narration cards in the Presence pane as it works, and wait for you to acknowledge.
- **Guide someone on their phone.** Navigate a teammate's phone to a screen, show a card there, and take a screenshot of it.
- **Clipboard, when granted.** Read or write your clipboard, only with the capture grant you give it.
- **Read the app's own log.** For diagnosing a problem with you.

## Plans

Plans that agents work from and people sign off.

- **Plans, sections, tasks.** Dependencies, comments, attachments, versions, restore, moves, external links (issues, PRs, Jira, Figma, any URL) and suggestions of which files and functions a task covers.
- **The Brief.** Each task's one page for its agent: skills to use, materials read so far, other work that affects it, and where it's worked.
- **Materials and outputs.** Files that matter to a task, read by part with each read recorded; outputs and evidence kept with the task.
- **Approve.** On the plan header or the phone. An agent asks by setting the plan to review.
- **What git proves.** Each task on a branch shows building, pushed, or merged (squash and rebase included), with the commit that proves it.
- **Review hosts, opt-in.** GitHub, GitLab or Bitbucket add pull requests, checks and approvals, only when you turn a host on.
- **Skills on tasks.** Attach the skills a task needs; the agent is told, and you see whether it used them.
- **When the spec is wrong.** An agent proposes a change to a spec page with evidence. You accept, amend or reject it, and every task relying on that page is flagged.
- **Plans as files.** Plans round-trip to YAML in the repo, so they're reviewed and versioned with the code.

## See what's coming

- **The Stack.** Every active plan at once, by ticket: who is on each task, its branch, what it waits on across plans, and where plans meet.
- **Play-forward.** Where today's plans will collide if they go ahead, worked out before anyone starts. Re-sequence, tell the agents, or leave it.
- **Recurring due.** Which playbook runs are due, in progress or missed.

## Teams and contributors

Working together with no new service to run.

- **Team status through git.** Share plans through a git repo, or a OneDrive or SharePoint folder. Any host or none.
- **Signed approvals.** Approvals signed with your git SSH key, so a teammate can check who approved.
- **Plan conflicts handled.** When two people change a plan's files, structured fields merge automatically and the rest are shown to resolve.
- **External contributors.** Prepare a branch with only what you want to share (no private comments or team-only files), then accept their contributions back.
- **Devices as peers.** See a paired device's plans, agents, channel events and status.
- **Where a plan came from.** Who added a plan that arrived through its files, and in which commit.

## The record

Evidence you can prove, months later, to someone who wasn't there.

- **Tamper-evident.** What was asked, done, checked and decided, kept in a hash chain. Settings says whether it's intact, and names anything changed, removed or added.
- **Who did it, from where.** Every record says whether a person in the window, the phone, an agent, or the local API did it.
- **Signed evidence.** Export a plan or any period as one signed page: entries, frames, the stack and overlaps at both ends, decisions and sign-offs.
- **Verify anywhere.** Anyone can verify an export on their own copy of CodeTrellis.
- **Retention you choose.** How long the record is kept is a setting.
- **State at any moment.** What the project looked like at 14:05 last Tuesday, the same answer replay shows.

## CLI and pipelines

- **Headless.** `codetrellis start` and `stop` in a session or a job, with no window.
- **Recipes.** A SessionStart hook and GitHub Actions recipes ready to copy.
- **The conformity gate.** For a change: breakpoints, architecture rules, failing or stale tests, criteria and docs, with exit codes a pipeline acts on.
- **Test runs that travel.** A test run reported in CI reaches the team's view of the plan.

## Phone

A native iOS and Android companion that pairs with your desktop directly.

- **Pair by QR.** Scan once. Devices find each other on your network, or over your own VPN when you're away.
- **Needs you.** What needs you, in the same few lines as the desktop digest.
- **Answer overlaps.** Acknowledge, mark Intended, or reply to the agents.
- **Answer breakpoints and questions.** Continue, stop or steer a waiting agent; answer an agent's question.
- **Approve plans and decide proposals.** The same rules as the desktop.
- **Pushed when it's serious.** A high overlap reaches your phone, worded to name nothing sensitive.
- **The whole picture.** Lines of work, the stack, play-forward, the review queue, recurring playbooks, plans and their status.
- **Terminal and voice.** A remote terminal and audio, when you allow them per device.

## Security and privacy

- **Local-first.** Your code and record stay on your machine. No server of ours is in the loop.
- **No telemetry.** Usage telemetry isn't a setting; it isn't built in. The only request the app makes on its own is the update check, which Settings turns off. Spell-check dictionaries are bundled.
- **Authenticated locally.** Every local connection, from the app, an agent or the API, carries a per-launch token. Being on the same machine isn't enough.
- **Tools granted per capability.** Agents are authorised tool by tool; new tools are refused by default. Terminal, settings and capture (screen, clipboard, microphone) are off by default.
- **Confined to your projects.** Tools that take a path work only inside projects you've opened.
- **Remote surfaces off by default.** Being discoverable and exposing an API are separate switches, both off until you turn them on.
- **Signed releases.** A signed checksum manifest the app verifies; macOS builds signed and notarised.
- **Open source.** Apache 2.0, with the source public.

## Platforms

- **macOS.** Apple Silicon and Intel.
- **Windows.** Installer and portable build.
- **Linux.** AppImage on x64 and arm64; .deb and .rpm on x64.
- **Phone.** iOS and Android.

## Use cases

Proposed scenarios for the site, from first day to full fleet, each built from features that ship today.

### Simple

Day one, one person, maybe one agent.

#### See your codebase, no agents needed

*Anyone with a repo.* Open a folder and get the map: packages, files, functions, and which service calls which.

Uses: Dependency graph · Cross-system map · Search

#### Watch what your agent actually did

*First agent.* Connect Claude Code with one copied command. Every tool call lands on the Timeline, grouped into turns, with its commits.

Uses: Connect in one click · Timeline · Lanes

#### Compare two branches properly

*Before a merge.* Pick any two points and see the files, the graph difference and each file's story.

Uses: Compare · Evolution · Changes

#### "Ask me before touching payments"

*Payments or auth owner.* Set a breakpoint on `billing/`. An agent's write there waits until you answer, from the desk or the phone.

Uses: Breakpoints · Phone answers

#### "Show me where you changed it"

*Agent explaining itself.* The agent opens the file at the line, focuses the graph on what it touched and posts a card explaining why.

Uses: navigate_to · graph_focus · Presence cards

#### No "done" on stale tests

*Quality owner.* An agent tries to close a task, but its tests ran before the last code change. It's refused, and the task says why.

Uses: Test reports · Test grounding

### Everyday

A developer or small team running a few agents.

#### Three agents, three worktrees, no surprise merge

*Solo developer.* Two of your agents start changing `refreshToken`. Both are told on their next step, and you see one line: mark it Intended or let one wait.

Uses: Lines of work · Collision · Inline notices · Digest

#### The morning view, read in a minute

*Tech lead.* Overnight, four agents worked across two plans. Open the digest and the review queue: what overlapped, what was answered, and what to merge first and why.

Uses: Digest · Review queue · Replay at 4×

#### Review agent work with the context

*Reviewer.* Did the plan land? See what it promised against what changed, the deviations to accept or revert, the other work in flight, and a PR body that tells the story.

Uses: review_plan · Deviations · PR drafts

#### Know when an agent is spinning

*Stuck agent.* An agent hits the same error five times. A `stuck` event appears on its plan, a routing rule posts it to your webhook, and you steer it with a note.

Uses: Stuck detection · Channels · Routing rules · Steer

#### Claude Code, Codex and Cursor on one repo

*Mixed-agent team.* Every agent is placed in its line of work and told about the others in the same words, whichever client it is.

Uses: Any MCP agent · Awareness

#### Stay in charge from your phone

*Away from the desk.* A contract change pushes to your phone. Reply to the agents, answer a breakpoint or a question, approve the next plan.

Uses: Push · Needs you · Approve · Breakpoints

#### From Jira epic to working agents, and back

*Ticket-driven team.* The agent fetches the epic with its own access and turns it into a plan with ticket keys. Agents pull tasks; status writes back when they finish.

Uses: Tracker intake · get_next_item · Write-back

#### Know what a plan costs across agents

*Cost-conscious lead.* Set a time and cost ceiling. See spend and forecast per agent; at 80% you're asked, and past 100% agents are told to stop claiming work.

Uses: Budgets · need-decision events

#### Docs that say when they're out of date

*Docs owner.* Each system doc shows current, moved or stale against the code, and a stale one posts to the channel.

Uses: System docs · Freshness · Sensors

### Advanced

Fleets of agents, regulated teams and pipelines.

#### Many agents chained through one plan

*Agent fleet.* Split a plan into sections, one worktree each. Agents pull the next task in order, hand off with `handing-off`, wait on your decisions, and are told the moment their work meets another's.

Uses: Sections per worktree · Work queue · Hand-offs · Awareness

#### Catch tomorrow's collision today

*Sprint planning.* Two tickets both plan to change `invoice.ts`. Play-forward says so before either starts, so you sequence them or tell both agents.

Uses: Play-forward · The Stack

#### Boundaries that hold, in the editor and in CI

*Platform team.* Write "web may not import db" once, with the reason. Agents check before they import, breaches show as overlaps, and the CI gate fails with a clear exit code.

Uses: Architecture rules · Conformity gate

#### Agents with no desktop at all

*Cloud and CI agents.* Run CodeTrellis headless in a cloud session or a GitHub Actions job. The agent gets the same overlaps, rules and test grounding as one on your laptop.

Uses: Headless CLI · SessionStart hook · Actions recipes

#### Evidence for the auditor, signed

*Regulated team.* Export the quarter's work as one signed page: who asked, which agent did what, what was checked and who decided. The auditor verifies it on their own copy.

Uses: Record chain · Signed evidence · Retention

#### What happened at 14:05?

*Incident review.* Replay the project at that moment: the graph, the open overlaps, what waited on whom. Then ask which agent, task and session wrote the line in question.

Uses: Replay · State at a moment · Line history

#### Freeze everything but the fix

*Release week.* Freeze the project and exempt the hotfix plan. Agents check before claiming work; only the fix moves.

Uses: Freeze · Exemptions · Breakpoints

#### When the agent finds the spec is wrong

*Spec-driven teams.* It proposes the change with evidence instead of quietly working around it. You decide, and every task relying on that page is flagged.

Uses: Spec proposals · Breakpoints on specs · Briefs

#### Agents on documents and spreadsheets

*Docs and analysis work.* Two tasks cite different versions of one spreadsheet, or a source document changes after a task used it. Both tasks are told, by title.

Uses: The Brief · Material signals

#### Bring in an outside contributor safely

*Open-source maintainers.* Prepare a branch with only what they should see, no private comments or team files, and accept their contributions back into the plan.

Uses: Contributor branch · Accept contributions

#### Shared status with no new service

*Teams without a SaaS.* Plans travel through your git repo, or a OneDrive or SharePoint folder, with approvals signed by your git SSH key.

Uses: Team status through git · Signed approvals

#### The weekly security review, run by an agent

*Recurring work.* A playbook runs every Monday as a fresh plan with its skill attached, and starts an agent on your chosen machine. Missed runs show as missed.

Uses: Recurring playbooks · Run starts an agent · Skills

#### Walk someone through it on their phone

*Remote teammate.* An agent navigates a teammate's phone to the screen in question, shows a card explaining it, and takes a screenshot to confirm.

Uses: mobile_navigate · mobile_present · mobile_screenshot

#### Agent oversight that stays on the laptop

*Security-conscious orgs.* No cloud account, no telemetry, nothing reachable remotely until you turn it on, and every agent's tools granted one by one.

Uses: Local-first · Per-tool grants · Remote off by default

## Ways to say it

Starting points for headlines, all true of 0.1.18.

> See every agent working on your code at once, and tell them when their work collides, before you have to.

> Mission control for AI coding agents. On your machine, with your phone in your pocket.

> Know what your agents are doing before, during and after they act, and prove it later.

> Any agent. Any number. One map.

> Your agents can drive it. You stay in charge of it.

## Say carefully

True limits today, so the site doesn't promise more than the app does.

- **Agents aren't launched for you.** You start your agents; CodeTrellis coordinates them. The exception is a recurring playbook run set to start one on a device you chose.
- **Budgets advise.** A budget ceiling tells agents to stop; it can't force them. Cost is shown only where the agent reports a model with known prices.
- **Stuck detection is opt-in.** It's off by default, per project.
- **CLI install.** From a checkout for now (`npm ci && npm link`); a published package is planned.
- **Cross-system coverage.** Rust, PHP and Java contribute symbols and imports but no HTTP call matching yet.
- **Windows signing.** Windows builds aren't code-signed, so SmartScreen may warn once. Downloads are covered by the signed manifest.
- **AppImage sandbox.** The AppImage runs without Chromium's sandbox; .deb and .rpm keep it.
- **Tests.** CodeTrellis reads test reports; it doesn't run your tests.
- **The record.** It proves what was recorded and that it wasn't altered, not what happened outside CodeTrellis.
