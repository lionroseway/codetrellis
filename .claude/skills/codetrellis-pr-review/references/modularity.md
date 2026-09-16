# Modularity and design

Portable across repos. The aim is a codebase that stays cheap to change — not
architectural preference, which is not a finding.

Only report where a concrete cost follows: a change that will now need making
in two places, a boundary whose breach will break something, code that is
already dead.

## Duplication that matters

- **Logic added where a helper already does it.** Search before judging: if
  `formatDuration` exists and the PR inlines the same arithmetic, that is a
  finding — name the existing function and its path.
- **A third copy.** Two is tolerable, three is a pattern that will drift. Say
  where the others are.
- **Parallel implementations of one concept** — two ways to resolve a
  permission, two shapes for the same entity, two clients for one service.
- **Copied block with one value changed.** Usually wants a parameter.

Not a finding: similar-looking code doing genuinely different things. Premature
abstraction over a coincidence is worse than the duplication.

## Boundaries

- A layer reaching past its neighbour — a component running a raw query, a route
  handler containing business logic that belongs in a service, a store calling
  another store's internals.
- Domain logic in a transport concern (route, socket handler, CLI arg parsing)
  where it cannot be reused or tested.
- A module importing from deep inside another module rather than its public
  entry point.
- Circular imports, or a cycle created by a new import.
- A shared or "core" package importing from an app package. Dependencies point
  one way.

## Dead code

- Function, export, component, route or config key the diff adds and nothing
  calls. Check whether it is genuinely new-and-unwired or genuinely unused.
- Code the diff makes unreachable but leaves behind — the old branch of a
  replaced implementation, a superseded helper.
- Commented-out blocks. Git has them.
- An export removed from use but left public, so it looks supported.

## Growth

- A file or function the PR pushes well past its neighbours in size. Not a
  line count rule — the question is whether it now does several unrelated
  things that change for different reasons.
- A function whose parameter list keeps growing, especially with booleans that
  select behaviour. Two callers passing different flags usually want two
  functions.
- A `switch`/`if` chain on a type tag, extended by this PR, where each new case
  means editing the same function. Fine once; a finding when the diff adds the
  third or fourth.
- Configuration threaded through several layers that do not use it.

## Consistency

New code should look like the code around it. Where the repo has an established
shape — how API modules are structured, how stores expose actions, how errors
surface — a new module inventing its own is a finding, because the next person
has to learn both.

Name the existing pattern and a file that shows it. Without that, this is
preference and does not belong in a review.

## Interfaces

- A type widened to `any`/`unknown`/`dict` to make a call site compile.
- Optional fields added to a shared type to serve one caller, so every consumer
  now handles a case that cannot happen for them.
- A returned union the caller cannot discriminate.
- A breaking change to a shared signature where callers were not all updated —
  check every call site, not just the ones in the diff.
