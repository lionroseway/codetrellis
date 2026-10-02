# The record: evidence you can prove (Phase 32 B10)

Months after a change was built, someone asks: *when this was built, what
else was going on, and who approved what?* CodeTrellis answers from what
it kept, and can show that it has not been edited since. This page
describes how. The B10 plan rows are in `docs/PHASE-32-EXECUTION.md`, and
the decisions are in `docs/PHASE-32-LOG.md`.

## The journey (G2)

1. **The team keeps a year.** In Settings → Data, "Keep the record for" is
   set to a year. The default is 14 days. Only a person in the app can
   change it, because shortening it removes evidence. The change is itself
   kept in the record, as "from 14 days to a year", with who made it.
2. **Months later, the reviewer replays that week.** On the Timeline tab,
   "or a week from [day]" replays those seven days. The bar names the days
   ("Replaying 2 Mar 09:14 → 6 Mar 17:40"). At each moment you can see:
   - the graph, as the code was;
   - the stack: every plan under way, each task as it was then;
   - the inbox: what was waiting on a person;
   - the lanes: who did what.
3. **The record says it is intact.** Settings → Data shows "Intact: 4,812
   entries since 2026-03-02 match the chain". If anything was changed, the
   line names it by entry number, kind, agent and day.
4. **They export the week's evidence.** "Export evidence" on the replay
   bar, or on a plan's Brief for that plan's time, saves one signed page.
5. **The auditor verifies it.** "Verify evidence…" on any CodeTrellis says:
   - who signed it;
   - whether its entries recompute into one unbroken chain;
   - on the computer that made it, whether that computer's record still
     holds every entry. Any entry changed since is named.

`tests/e2e/record-g2.test.ts` walks this end to end, with the backend's
clock moved 120 days forward.

## The chain (B10.1, `services/record-chain.ts`)

Every event in `agent_events` gets one link in `record_chain` as it is
written. That covers tool calls, watcher events, and the app's own record
of what people decided:

- spec edits;
- criterion decisions and check runs;
- breakpoint hits and answers;
- signal answers and spec decisions;
- rule changes and retention changes.

Each link stores two values:

```
digest = sha256(JSON.stringify([id, at, source, type, session_id, agent_type, payload]))
hash   = sha256(prev + "\n" + seq + "\n" + event_id + "\n" + digest)
```

`verifyRecord()` walks the chain from the anchor and reports four kinds of
problem:

| Kind | Meaning |
|---|---|
| `changed` | The event's content no longer matches its digest. |
| `removed` | A link or its event is gone. |
| `relinked` | A link no longer follows from the one before it. |
| `unlinked` | An event was added to the log outside the record. |

You can run the same walk three ways: `GET /api/record`, the MCP tool
`verify_record`, and Settings → Data → Record.

Three rules hold for the chain:

- **Links are numbered as they are written.** Each link carries a time
  that never goes backwards. Retention trims the oldest links as one block
  and moves the anchor (`record_anchor`) to the last link it trimmed.
  What is kept still verifies from the anchor.
- **The workstream is not in the digest.** It is stamped later, when a
  session binds, so it is derived rather than part of what was done.
- **Who comes from how the call arrived.** The author always comes from the
  transport helpers (`personFrom`, `phonePerson`, `authorFromExtra`). Over
  plain HTTP the author is "unverified" and the Timeline says so.

## Retention (B10.2, `services/retention.ts`)

`data.retentionDays` accepts 14, 30, 90 or 365 days, or `null` to keep
everything. One window applies to everything kept:

- agent activity, and the record with it;
- replay frames;
- test runs;
- log files;
- the device log, which is also capped at 10,000 rows.

Shortening the window applies at once. A change to it is a person-only
setting (`grant-guard`) and is itself kept in the record.

## Signed packs and evidence (B10.3, B10.4)

The sign-off pack (`pack-seal.ts`) and the evidence export (`evidence.ts`)
are both signed with this computer's device key. That is the key task
records already use (C3.1). Each kind of document has its own namespace,
so a signature for one never passes for another:

- `codetrellis-signoff-pack` for packs;
- `codetrellis-evidence` for evidence exports;
- task records have a namespace of their own.

Each signature also covers the record's head at the moment of signing, so
the document pins the record.

An evidence export carries the following:

- **Every record entry in its window.** Each entry includes its event as
  written and its link, plus the link before the window, so the chain
  recomputes from the file alone. The record belongs to the computer, not
  to one project, so the window carries other projects' entries too.
  Without them the chain would have gaps nobody outside could check.
- **The replay frames** taken in the window.
- **The stack, the signals and what was waiting**, at the window's start
  and at its end.
- **The breakpoints and decisions**, in words, each with its entry number.
- **For a plan, its sign-off pack.**

Verifying an export answers three questions:

| Question | Possible answers |
|---|---|
| Who signed it? | This computer; a teammate's key that is trusted here; or a key not known here, which shows the file is intact but proves nothing about who signed it. |
| Has it changed since signing? | Unchanged, or "Changed after it was signed". |
| On the computer that made it, does the record still hold every entry as exported? | Any entry changed, removed or relinked since is named. Entries that retention removed since are listed, and do not fail the check. |

The surfaces are:

- `GET /api/evidence?plan=` or `?project=&from=&to=`, as JSON, or as the
  page with `&format=html`;
- `POST /api/evidence/verify`;
- the MCP tool `export_evidence` (`read`);
- the Brief, and the replay bar.

## What this does not prove

Someone who can rewrite the database can recompute the whole chain. What
stops that from going unnoticed is a signed copy kept elsewhere: a pack or
an evidence export, made before the edit, still carries the old head and
the old hashes. Verifying it on this computer then names every entry that
differs. Keep the exports that matter somewhere the database's owner
cannot reach.

## Testing it months later

The harness cannot wait months. A backend started with
`CODETRELLIS_CLOCK_OFFSET_MS` runs that far ahead: both `Date.now()` and
`new Date()` read the moved clock (`services/test-clock.ts`, imported
first in `server.ts`). Only the harness sets it.
