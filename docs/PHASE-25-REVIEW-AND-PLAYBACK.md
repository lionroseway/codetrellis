# Phase 25 — Review, snapshot selection, and play-forward

> Drafted: 2026-09-17
> Status: designed, not built
> Consumes: Phases 20–24. Best done last.

---

## 1. Three features, one substrate

All three of these are views over data the backend already computes:

| Feature | Existing substrate |
|---|---|
| **Plan → PR** | `git-commit-service` (attributed commits), `plan-file-service` (plan as YAML/markdown), `plan-changes-service` (satisfied/drifted), `external_refs` (ticket links) |
| **PR → plan review** | `plan-history-service` (`get_plan_at_commit`, `diff_plan_between_commits`), `diff-engine` (`captureSnapshot`, `ArchDiff`, `blastRadius`), `plan-changes-service` |
| **Play-forward** | `trellis_snapshots` (full `filesJson` + `edgesJson` per snapshot), `capture_checkpoint`, git history |

Almost nothing here is new computation. It is assembly, and that is why
it lands last and cheap.

## 2. Plan → PR

The loop currently ends at "VerificationPanel says Ready to ship" and
drops the user into a terminal. Close it.

One action produces: a branch, a commit composed by `git-commit-service`
with its existing agent-attribution trailers, and a PR body generated
from the plan:

- the plan's description
- the satisfied / drifted table from `plan-changes-service`
- spec docs as collapsed sections
- ticket links from `external_refs` (Phase 24)
- an architecture delta: edges added, edges removed, boundaries crossed

A reviewer gets a PR that explains its own intent, which is the thing
agent-authored PRs are worst at today.

**Constraint:** we do not hold a GitHub credential, for the same reason
we do not hold a Jira one (Phase 24 §1). So the shipped behaviour is:
prepare the branch and commit locally, then either hand the agent a
`get_pr_draft` payload to open the PR with its own GitHub MCP, or open
the compare URL in the browser with the body pre-filled. Both work;
neither makes us a credential store.

## 3. PR → plan review

The underrated half, and the one with no competition.

Given a branch, a PR, or any two commits, answer **"does this diff do
what the plan said?"**:

- items fully landed
- items partially landed, with which targets are missing
- **files changed that no item claimed** ← the finding human reviewers
  systematically miss on a 40-file agent PR
- **edges added or removed that no item planned** ← invisible in a
  textual diff, where a new cross-module dependency is one import line

That last one is the reason to build this. A reviewer cannot see "this
added a dependency from `payments` to `auth`" in a GitHub diff. Our
graph sees it as a new edge crossing a boundary, and can say so in one
line.

Mechanically: reconstruct the plan at the base commit
(`get_plan_at_commit`), snapshot architecture at base and head
(`captureSnapshot` on each), diff (`ArchDiff`), and score against the
plan's proposed changes. Every piece exists; this is a service that
calls them in order and a panel that renders the result.

Output it in two forms: a panel in the app, and a markdown block the
agent can post as a PR comment via `copy_plan_as_prompt`'s sibling.
The markdown form is what gets this in front of people who don't have
the app.

## 4. Snapshot selection

Make the comparison endpoints general. Let the user pick **any two
points** and diff architecture between them:

- the pinned baseline
- any named checkpoint (`capture_checkpoint` already stores these)
- any git commit or tag
- the plan's *planned* state (projection)
- live working tree

A two-slot picker in the graph chrome, `A ⇄ B`, feeding the same
`ArchDiff`. This is a picker plus plumbing — the snapshots already carry
complete file and edge sets, which is precisely why they were stored
that way.

It also fixes a long-standing gap: Diff mode today means one specific
comparison. Making the comparands explicit is what finally makes the
four trellis modes legible (TRACKER §7, graph blocker #1), because the
chrome can state what it is showing instead of implying it.

## 5. Play-forward

Same data, time axis.

Order the snapshots (plus git commits as implicit snapshots), interpolate
between consecutive states, and animate: nodes appearing, edges forming,
drift flaring amber and resolving. A transport bar — play, speed, scrub,
step — and an export to GIF/video.

Two audiences, and the second is the one that matters:

- **Marketing.** It is the most shareable thing the product can produce.
- **Review.** Playing a plan's execution forward shows the *order* the
  agent did things. A final diff hides sequence, and sequence is where
  bad decisions are visible — the refactor that happened before the test
  was written, the file rewritten three times, the dependency added then
  removed then added again.

Performance note: a long history is a lot of layout. Precompute node
positions once across the whole sequence so nodes don't jump between
frames — a stable layout is the difference between "time-lapse" and
"seizure". Cap the frame count and sample when the range is large.

## 6. Order within the phase

1. **Snapshot selection** — smallest, and the other two use it.
2. **PR → plan review** — the differentiated one; ship it before the
   authoring half.
3. **Plan → PR** — pleasant, but it is table stakes rather than a reason
   to choose us.
4. **Play-forward** — last; it is the reward, not the foundation.

## 7. Tests

1. Diffing a snapshot against itself yields an empty `ArchDiff`.
2. A plan reconstructed at a base commit matches what was committed.
3. A file changed with no claiming item appears in "unclaimed changes".
4. An edge added with no planned connection appears in "unplanned
   edges"; a planned one does not.
5. The markdown review block renders every section with no plan data
   missing.
6. Play-forward over N snapshots produces N frames with stable node
   identity across all of them.

## 8. Done when

- A real agent-authored PR can be reviewed against its plan, and the
  review names at least one thing the diff alone would not have shown.
- Any two points in the project's history can be compared from the UI.
- A plan's execution plays back as an animation worth showing someone.
