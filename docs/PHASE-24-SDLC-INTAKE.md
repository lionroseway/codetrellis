# Phase 24 — SDLC intake (Jira, Linear, issues)

> Drafted: 2026-09-17
> Status: designed, not built

---

## 1. The principle: we do not build integrations

A BA writes an epic in Jira. A developer's Claude Code has both the
Jira MCP server and the CodeTrellis MCP server connected. The agent can
already read the epic and already call our 100+ tools.

So the correct move is **not** to write a Jira client. It is to expose
the contract an agent needs in order to do the integration itself.

Three reasons, and they compound:

1. **Credentials.** A Jira client means CodeTrellis stores a Jira token,
   which makes us a credential store on a developer workstation. Phase
   19 exists precisely to avoid being that.
2. **Agent-agnosticism.** A contract works identically for Jira, Linear,
   Azure DevOps, GitHub Projects, Shortcut and a wiki page. A client
   works for one, and then we owe five more.
3. **The promise.** "No data leaves your machine, no extra account" is
   on the README. An outbound Jira sync breaks it.

What we owe the agent: a well-shaped intake, a hierarchy it can build in
one call, and a clean answer to "what changed since you last synced".

## 2. What already exists

More than you'd expect:

- `external-refs-service.ts` infers `jira`, `github_issue`, `github_pr`,
  `linear`, `figma`, `notion`, `slack` from a pasted URL and titles them
  sensibly (`PROJ-412`, `org/repo#88`).
- `import_external` turns issue-body text into a plan with items.
- `plan_items` is already a nested tree, so epic → story → task has a
  home.
- `bulk_add_items` can seed many items at once.
- Plan templates seed phases and spec docs.
- `external-pointer-service.ts` handles the *cross-repo* case — a plan
  in one repo being in scope for another.

The intake path half-works today. The gaps are hierarchy, lineage and
write-back state.

## 3. What to add

### A. External refs on plans, not just items

Today a ref hangs off an item. An epic maps to a *plan*. Add plan-level
refs with the same service and inference, so a plan knows its ticket.
Small change, unlocks everything below.

### B. `create_plan_from_external` — hierarchy in one call

Current `import_external` takes free text and produces a flat plan.
Extend to accept a structured tree the agent has already fetched:

```
{
  external: { kind: 'jira', key: 'PROJ-412', url: '…', title: '…' },
  body: '…epic description…',
  acceptance: ['…'],
  children: [
    { external: {…PROJ-413…}, title: '…', body: '…', acceptance: [...],
      children: [ … ] }
  ],
  template: 'new-feature'   // optional, seeds phases + spec docs
}
```

Produces plan → items → sub-items, each carrying its ticket key as an
external ref. The agent does the fetching; we do the structuring. Depth
should be capped (3 is plenty: epic → story → task) with anything
deeper flattened, because ticket hierarchies can be pathological.

### C. Acceptance criteria become checkable

A ticket's acceptance criteria arrive as prose and currently die as
prose. Land them in the item's acceptance field so
`plan-changes-service` can report against them, and so the verification
panel is answering *the BA's* question rather than a restatement of the
developer's.

Where criteria name files or symbols, run them through the same
extraction `import_external` already does, so `@`-chips and targets
appear automatically.

### D. `get_external_sync_state` — the write-back contract

The one tool that makes round-tripping work without us holding a
credential:

> Given a plan, return every item whose status changed since the last
> sync, with its ticket key, old status, new status, and a suggested
> transition.

The agent reads it, calls its own Jira MCP to transition the tickets,
then calls `mark_external_synced` with what it actually did. We store
the watermark; the agent does the writing; the credential never comes
near us.

This also gives a **human** something useful: a "3 tickets need
updating" chip with a copyable summary, for the developer whose agent
isn't connected to Jira.

### E. A `from-ticket` plan template

The existing five templates are shaped around the developer's intent
(mass refactor, bug fix, perf pass). Add one shaped around an intake:
epic summary page, a phase per story, acceptance criteria pre-slotted,
a spec doc stub for anything the ticket references but doesn't explain.

Then the BA handoff is one agent turn: *"pull PROJ-412 into
CodeTrellis"*.

## 4. What this makes possible

Jira knows **intent**. Git knows **outcome**. Nothing in a normal
toolchain knows the **architecture in between** — which files a story
will touch, whether two stories collide in the same module, whether the
epic as scoped crosses a service boundary nobody mentioned.

That is the gap this fills, and it is why intake is worth doing
properly rather than as a URL field:

- *"This epic's five stories touch 3 services; story 3 and story 5 both
  rewrite `auth/session.go`."* — a scheduling conflict visible before
  either is started.
- *"The epic says 'no API changes' and story 2's targets include a route
  file."* — a scope contradiction, caught at planning time.

Neither is possible without the hierarchy and the targets together.

## 5. Boundaries

- **No polling.** We never reach out to Jira. If nothing asks, nothing
  syncs. Stale is the expected state and the UI should say when it last
  synced rather than implying live.
- **No inbound webhooks.** Same reasoning as Phase 19's "remote surfaces
  are off by default" — an inbound endpoint is new attack surface for a
  convenience nobody asked for.
- **Ticket text is untrusted input.** It reaches us via an agent, from a
  system many people can write to. It is data, never instruction: no
  executing what a ticket body says, and the same sanitisation as any
  other imported markdown.

## 6. Tests

1. A nested intake produces the right tree with keys preserved at every
   level.
2. Depth beyond the cap flattens rather than nesting infinitely.
3. Acceptance criteria land as checkable fields and appear in the
   changes projection.
4. `get_external_sync_state` reports exactly the items that changed
   since the watermark, and nothing after `mark_external_synced`.
5. Re-importing the same epic updates rather than duplicating (match on
   ticket key).
6. A ticket body containing markup or instruction-shaped text is stored
   inert.

## 7. Done when

- An agent with a Jira MCP can turn an epic into a nested plan in one
  turn, and transition the tickets back from `get_external_sync_state`.
- The plan shows ticket keys at every level and links out.
- Re-import is idempotent.
