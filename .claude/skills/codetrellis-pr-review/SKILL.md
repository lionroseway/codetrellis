---
name: codetrellis-pr-review
description: Review a pull request or diff for correctness, security, repository conventions and modularity, then report findings as GitHub review comments. Use when reviewing a PR, when invoked from CI on a pull request, when asked to check changes before merge, or when asked to fix findings from an earlier review.
---

# PR review

Review a diff and report what would actually break. This runs advisory — it
never blocks a merge — so its worth is entirely in whether people read the
findings. One wrong finding costs more attention than five right ones earn.

## Scope

**Review only lines the diff touches.** Not the surrounding file, not code the
diff merely calls. If a pre-existing problem is genuinely serious, mention it
once in the summary; never as a line comment on an untouched line.

**Every finding needs a concrete failure.** Specific inputs or state, and the
wrong output, crash or exposure that follows. If you cannot write that sentence,
you do not have a finding — you have a feeling. Discard it.

**Not findings:** naming, formatting, import order, comment style, "consider
extracting", "might be cleaner as", test coverage of code that already has
tests, anything a linter owns, anything true of the file before this PR.

**Cap at 10 line comments.** Over that, post the 10 that matter and say in the
summary how many were dropped. A wall of comments gets collapsed and ignored.

## Dimensions

Read the reference for each dimension before judging against it. Do not review
from memory — the rules are specific and the point is catching what a generic
reviewer misses.

| Read | For |
|---|---|
| `references/conventions.md` | Repository-specific rules. Written per repo — the highest-value dimension, because violations are unambiguous and CI cannot see them. |
| `references/security.md` | Auth, injection, secrets, exposure. Portable. |
| `references/correctness.md` | Common faults and dead ends. Portable. |
| `references/modularity.md` | Duplication, boundaries, dead code, coupling. Portable. |

Skip a dimension the diff cannot touch — a docs-only change needs no security
pass. Say which dimensions you ran in the summary.

## Verify before posting

For each candidate finding, argue the opposite case before you commit to it.
Read the surrounding code, the callers, and any guard that might already handle
it. Most candidates die here: the check exists three lines up, the type makes
the state unreachable, the framework already escapes it.

Drop anything you cannot confirm by reading actual code. "Possibly", "may not",
and "could potentially" in a finding mean it did not survive this step.

## Reporting

Post one review, in one call, at the end. **Build the payload with `Write`, not
with a shell heredoc.** Escaping review prose — backticks, quotes, newlines,
code fences — into a heredoc by trial and error once consumed an entire turn
budget and a finished review was lost without ever being posted.

Write `/tmp/review.json`:

```json
{
  "event": "COMMENT",
  "body": "<summary>",
  "comments": [
    {"path": "src/foo.ts", "line": 42, "side": "RIGHT", "body": "<finding>"}
  ]
}
```

Then post it:

```bash
gh api "repos/$REPO/pulls/$PR/reviews" --input /tmp/review.json
```

`line` must be a line the diff touches on `side: RIGHT`, or the API rejects the
whole review with a 422. For a multi-line range add `start_line`.

**Do not rehearse.** No test posts, no per-comment escaping checks, no dry runs.
Write the file once and make the call once. If it 422s, read which comment it
names, drop that one comment, and post again — at most one retry.

Each finding: one sentence naming the defect, then the failure scenario, then a
fix. Where the fix is contiguous lines in that one file, make it applicable:

    ```suggestion
    const timeout = Number(process.env.TIMEOUT ?? 30_000)
    ```

A suggestion the author applies is a push authored by them, so CI re-runs
normally. Prefer it over prose wherever the fix fits the form.

The summary body opens with a one-line verdict, then dimensions run, then any
finding too structural to anchor to a line. If nothing survived verification,
say that plainly and post no line comments.

## Budget

You have limited turns. Spend them on reading the diff and the code around it,
not on the mechanics of posting.

- Read each dimension reference once. Do not re-read it.
- Skip dimensions the diff cannot touch, and say which you skipped.
- Verify findings by reading code, not by running experiments.
- Reserve the last few turns for writing the payload and posting.

If you are running low and have findings, post what you have with a note that
the review was cut short. A partial review that posts beats a complete one that
does not.

## Fixing on request

When asked to fix findings (`@claude fix #2`), change only what that finding
described. No adjacent tidying, no reformatting, no drive-by improvements — a
fix commit that touches more than its finding is one the author has to review
line by line, which defeats the point. Commit with a message naming the finding.
If a fix turns out to need a design decision, say so and change nothing.

## Graduating findings

A finding class caught three times is a rule that should stop existing. Say so
in the summary when you notice it:

> This is the third PR flagged for a hardcoded service list. That belongs in
> a derived value, not in a reviewer's attention.

The aim is that this review discovers rules and deterministic checks enforce
them. Anything an LLM re-derives every PR that a grep could catch is waste. When
someone accepts a convention finding, offer to add it to
`references/conventions.md` so the next review has it.
