# Correctness and dead ends

Portable across repos. Faults that ship green and fail in use.

## Async

- **Missing `await`.** A promise used as a value: truthy always, so an
  `if (await? x)` guard passes, `.length` is undefined, a caught error is not
  caught. In Python, an un-awaited coroutine that never runs at all.
- **Unhandled rejection.** A promise chain with no `.catch`, an async function
  called from sync code, an async callback into an API expecting sync.
- **Swallowed error.** Empty `catch`, `catch` that only logs and continues into
  code assuming success, `except: pass`.
- **Race on shared state.** Two async paths reading-then-writing the same
  state; last write wins and the first update vanishes. Common in stores.
- **Fire-and-forget writes** whose failure nobody observes.
- **`await` in a loop** where the work is independent — correct but serial.

## Lifecycle and leaks

- Event listener, socket handler, interval, timeout, observer or subscription
  added without a matching teardown. Rebinding on every render or reconnect
  multiplies handlers silently.
- Effects that re-run because a dependency is a new object or function each
  render.
- Stale closure: a handler capturing a value from the render it was created in
  and using it much later.
- Unclosed file, cursor or connection on an error path.

## Boundaries and nulls

- Optional field treated as present. New API field, existing stored documents
  without it.
- `length - 1`, `<=` vs `<`, slice bounds, pagination offsets.
- Empty collection: does the code divide by count, take `[0]`, or reduce with
  no initial value?
- `0`, `""` and `false` failing a truthiness check that meant "is set". `??`
  vs `||`.
- Unicode and emoji through anything counting characters or slicing strings.

## Data and queries

- **N+1:** a query inside a loop over query results.
- **Unbounded read:** fetching a whole collection to count or filter in memory.
- **New query field with no index**, on a collection expected to grow.
- **Migration with no rollback**, or one that rewrites in place with no
  intermediate state where old and new code both work.
- **Non-atomic read-modify-write** where an atomic update exists.

## State mutation

- Mutating an array or object held in state instead of replacing it. Renders
  skip, undo history corrupts, and the bug appears somewhere unrelated.
- Sharing a mutable default (`def f(x=[])`, a module-level object reused per
  request).
- Deriving state into another piece of state that can drift, rather than
  computing it.

## Dead ends

Code that cannot do what it looks like it does:

- Branch unreachable given the checks above it.
- Early `return`/`break` before work the function claims to do.
- A condition that is always true or always false as written.
- A caught exception type that cannot be raised in the block.
- A parameter, prop or config flag threaded through but never read.
- A feature flag with no path that sets it.
- Code after `return`, or a `finally` that discards a return value.
- `TODO` or `FIXME` on a path this PR makes reachable.
- A stub returning a placeholder, wired into a caller that treats it as real.
- A handler registered for an event nothing emits, or emitting an event nothing
  handles — check both ends when a diff adds one.

## Error handling

- Retry with no cap, no backoff, or retrying a non-idempotent write.
- A timeout absent on a network call, or longer than the caller's own.
- Failure path leaving state half-written with no cleanup.
- An error message that will not identify the problem in a log at 3am.

## Concurrency across processes

- Assuming single-instance memory (an in-process cache, counter, lock or map)
  in a service that runs more than one replica.
- Scheduled work with no guard against two instances running it at once.
