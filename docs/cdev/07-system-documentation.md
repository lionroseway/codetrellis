# System Documentation

CodeTrellis treats documentation as a manifest entity — markdown that travels through git like any other plan content. Two layers of documentation are distinguished, and they serve different purposes.

## The two layers

| Layer | Scope | Status |
|---|---|---|
| **Plan-scoped specs** | Describe specific upcoming or ongoing work | Built today |
| **Repo-wide system documentation** | Describe the system as it stands, independent of any one plan | Target extension |

The first exists in the product. The second is the extension we are growing toward.

## Plan-scoped specs (today)

Every plan can carry documentation that describes its specific work — design notes, requirements, architecture decisions for that piece of work, executive summaries. These live inside the plan's directory:

- **V1 projects** carry these under `.codetrellis/plans/<slug>/docs/<order>-<slug>.md`, with YAML frontmatter indicating `doc_type` (one of `executive_summary`, `architecture`, `requirements`, `design`, `custom`).
- **V2 projects** model these as Objects in the plan items tree, with a `template` hint (`architecture`, `requirements`, etc.) and the same markdown content in the item body. Objects can parent Actions, so a "design" Object can hold the work items it describes.

These docs are plan-scoped: they describe *the change*, not *the system*. When the plan is completed, the docs remain as historical context, but they're not the place a new engineer goes to understand how the system works today.

## Repo-wide system documentation (target)

The extension is a repo-wide documentation layer at `.codetrellis/docs/` — markdown files that describe the system as it stands. Examples of what would live here:

- An architecture overview of the payments service
- How auth flows through the application
- The convention used for error handling across services
- An operational runbook for incident X
- A description of how a particular cross-cutting concern works

These are not tied to any one plan. They describe the system as it currently is, and they evolve as the system evolves.

### Three audiences

The documentation layer serves three audiences:

- **Engineers**, including new engineers joining the project, who need to understand the system without asking everyone in person.
- **Stakeholders** outside engineering — product, design, leadership — who want to understand the shape of the system without crossing into developer tooling. Because the manifest is plain markdown in a repository, they can read it through the host's web UI without installing CodeTrellis.
- **Agents**, which use system documentation as context when planning new work, reducing the amount of code they need to read into their context window to understand what to do.

The last point is operationally important. The documentation layer is a context-pressure suppression mechanism. Agents that can read a one-page description of an architecture do not need to re-derive the architecture from source files every time they begin a task.

### Two kinds of system documentation

| Kind | Purpose | Maintained by |
|---|---|---|
| Stable docs | Describe how a part of the system works at a stable point in time | Primarily humans; agents propose updates |
| Living docs | Track the evolving state of the system as it changes | Primarily agents; humans review |

Stable docs are the kind a new engineer reads to understand a subsystem. Living docs are the kind a stakeholder reads to understand what the system looks like today.

### How agents maintain documentation

Agents don't write documentation on every action. The discipline is event-driven: documentation updates are proposed when a change is meaningful enough to warrant a record.

Events that may trigger an agent to propose a documentation update:

- A new module or service is added to the system.
- A cross-cutting pattern is changed (an authentication mechanism, a logging convention, a deployment shape).
- A previously documented behaviour no longer matches the code.
- A plan is completed that materially changes the system's structure.

Proposals are not committed automatically. They appear as draft documentation changes in the relevant plan's [channel](08-agent-collaboration.md) for human review, exactly as a teammate's pull request would. Documentation that is committed has been reviewed by a human.

This is the discipline question that determines whether documentation is useful or noise. Agents are good at drafting; humans are good at deciding what is worth keeping. The model preserves both.

## Documenting system change over time

Because the documentation layer is in git, its history is the history of how the system was understood. A reader can answer "what did we think this subsystem looked like a year ago?" by reading the documentation at that commit. The diff between two commits of the same document tells the story of how the system evolved between those points.

This is a more durable record than commit messages or chat history. Commit messages describe what changed; the documentation layer describes what the system became.

## Documentation and planning

The documentation layer feeds the planning layer. When a new plan is being authored, the application can surface relevant documentation alongside the editor — the architecture of the subsystem being changed, the conventions in use, the constraints that have been previously recorded.

Agents drafting plans use the documentation as context, reducing both the time to draft and the amount of code the agent needs to read to understand what to do. A plan is easier to write well when the relevant context is already in front of the author, and the relevant context is exactly what the documentation layer captures.

## Avoiding documentation rot (target)

The risk in any documentation system is that the docs and the code diverge silently. CodeTrellis addresses this in two ways, both part of the same target sensor surface described in [09 — Sensors and Detection](09-sensors-and-detection.md):

- **Documentation drift detection.** The same sensors that detect drift between a plan and the work being done also detect drift between documentation and the current state of the code. When a documented invariant no longer holds, a `need-decision` event surfaces the divergence in the relevant channel.
- **Verified-state assertions.** Documentation entries can reference specific code locations and assert specific properties (a function's signature, a service's clients, a configuration default); the application re-evaluates those assertions when the referenced code changes.

The principle is that documentation is not allowed to silently fall out of date. When it diverges from the code, the divergence is itself an event the team is asked about.

## How adoption grows

A team can adopt the documentation layer gradually. The simplest starting point is one page — an architecture overview of the system, written by hand. From there:

1. Add subsystem descriptions as needed.
2. Let agents propose updates when they notice the docs and code have drifted.
3. Add runbooks and conventions over time.
4. Eventually, documentation sensors run automatically and humans review proposals as part of normal plan review.

The layer never has to be complete. It is valuable from the first page.
