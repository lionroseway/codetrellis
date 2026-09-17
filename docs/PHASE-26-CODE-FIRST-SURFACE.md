# Phase 26 — The code-first surface

> Drafted: 2026-09-17
> Status: designed
> Depends on: [Phase 25](PHASE-25-REVIEW-AND-PLAYBACK.md) for snapshot
> selection, which this reuses wholesale.

---

## 1. The reframe

Today the graph *is* the product. Everything else hangs off it, and the
four trellis modes are modes of the graph.

That is a problem in two directions at once:

- **The expensive thing is also the optional thing.** Layout on a large
  repo is the heaviest work the renderer does — dagre plus d3-force over
  hundreds of nodes — and some users will never want the picture. They
  are paying for a view they do not use, on exactly the repositories
  where it costs most.
- **Every signal the graph draws is already per-file or per-line.**
  Drift, plan targets, cross-system couplings, git annotations: all of it
  is attached to files and lines first, and only then projected into a
  picture. The graph is a *rendering* of the data, not the data.

So a code-first view is not a lesser fallback for people who cannot
handle the graph. It is **the same information, cheaper to render, and
more legible to people who think in files** — which is most developers,
most of the time.

Naming it properly matters: this is a peer mode, not a panel. When the
user is in code mode the graph does not mount, and its cost is not paid.

## 2. What already exists

More than the framing suggests, which is why this is a projection job
rather than a new subsystem:

- **`CodePreview.tsx`** already renders a file with Prism highlighting
  and a **per-line git gutter** (`added` / `modified` marks).
- **`GET /api/file/content`** already returns content, per-line git
  annotations, and a file-level drift status, and already accepts
  `?plan=` to scope drift to one plan.
- **`FileSpec.edits[]` already carries `lineRange` and `symbol`**
  (Phase 15 §M2). The model has been able to say "this item wants lines
  40–58 of this file changed" for a long time. **Nothing has ever drawn
  it on the code.**
- **`snapshot-compare-service`** (Phase 25) resolves any two points —
  live, baseline, a checkpoint, a commit — so "diff this file between A
  and B" needs no new concept, just a per-file view of an existing one.

The gap is consistently the same shape: the data is computed and stored,
and the code view never shows it.

## 3. Four layers on one surface

Deliberately one surface with four layers rather than four features. They
share a file, a line numbering, and a comparand picker; splitting them
would mean three places to keep in sync.

### 3A. Plan overlay — *the cheapest and the most distinctive*

Render an item's `fileSpecs[].edits[]` against the file it targets:

```
  38 │   func (l *Ledger) Post(amount money.Amount) error {
  39 │       l.entries = append(l.entries, Entry{Amount: amount})
► 40 │       return store.Save(l.entries)          ◀ Rotate signing keys
  41 │   }
```

A margin marker on the covered lines, the item title on hover, click to
open the item. Where an edit pins a `symbol` rather than a `lineRange`,
resolve it through the symbols table to a span — that is what the symbols
table is for.

Why this first: it is the smallest piece, it uses data that has been
sitting unused since Phase 15, and it answers a question a developer
actually has while reading code — *"is anything planned for this?"*

**The restraint that matters:** an edit with neither `lineRange` nor
`symbol` means "anywhere in this file". Highlighting the whole file for
that would be noise on every line; it belongs as a file-level banner
instead.

### 3B. Diff editor

A real before/after, not a gutter mark.

Comparands come from Phase 25, so the picker is the same one the graph
uses: baseline, checkpoint, commit, live. Per-file, the view asks for
the file's content at each side and renders a unified or side-by-side
diff.

Backend work is small: `GET /api/file/content` grows an optional `?at=`
comparand so a file can be read at a point other than the working tree.
For a commit that is `git show <ref>:<path>`; for a checkpoint we have
hashes but not blobs, so **a checkpoint cannot supply file contents** —
it must say so rather than silently returning the live file. See §5.

### 3C. Fast-forward

The transport bar drives the **same** surface:

- over a **file**, scrub its content through time;
- over the **file list**, watch files appear, change and vanish.

No layout engine is involved, so this works on repositories where the
graph would struggle — which is the point. Fast-forward over a diff
editor is also far more *useful* than fast-forward over a graph: you can
read what changed, not just see a node pulse.

Frames come from the same ordered comparands Phase 25 already lists.

### 3D. Code-first mode

A real mode, alongside the graph, with its own layout: file tree, code
pane, overlay rail, transport bar. When it is active the graph does not
mount.

The mode is remembered per project, because a user who prefers code will
prefer it every time, and re-choosing it on every open is the kind of
friction that makes people stop using a thing.

## 4. The editor dependency

A real diff editor means a real editor component. The choice is
**CodeMirror 6**, and it was made deliberately given how the
`better-sqlite3` packaging history went.

| | CodeMirror 6 | Monaco |
|---|---|---|
| Size | modular, per-feature packages | large, worker-based |
| Electron packaging | plain ESM modules | needs worker + asset plumbing |
| Diff view | `@codemirror/merge` | built in |
| Fit with what exists | composes with the current line-based rendering | replaces it |

Versions verified on 2026-09-17, all on the actively maintained 6.x
line: `@codemirror/state` 6.7.5, `@codemirror/view` 6.43.12 (published
two days prior), `@codemirror/language` 6.12.4, `@codemirror/merge`
6.12.2. Language packages exist for every language CodeTrellis parses —
`lang-javascript`, `lang-python`, `lang-rust`, `lang-go`, `lang-java`,
`lang-php`, `lang-sql`.

**Pin the minors and check the packaged build.** The lesson from
`better-sqlite3` is not "avoid dependencies", it is that a dependency
which works in dev and fails when packaged costs a release. CodeMirror is
pure JS with no native binding, so the risk is far lower — but the
packaged build is still the only thing that proves it.

**Measured cost, and what it forced.** Installing the packages added
~6 MB to `node_modules` and, once wired in, took the main bundle from
1,707 kB to 2,417 kB — about **710 kB** for an editor most users open
rarely. Paying that on every launch would contradict this phase's own
argument, so the diff view is **lazily imported**: it builds as its own
746 kB chunk, the main bundle returns to its previous size, and a user
who never opens a diff never downloads it. Applying the phase's thesis to
our own dependency was the consistent move, not a clever one.

**A language with no CodeMirror package is not an error.** Ruby is the
live example — we parse it, `@codemirror/lang-ruby` does not exist on the
6.x line — and the honest result is an unhighlighted diff, which is still
a perfectly readable diff. Falling back to a *wrong* grammar would colour
Ruby as JavaScript, which is worse than plain text.

Prism stays for the read-only inspector preview. Replacing a working
component to have one fewer library is not worth a regression; CodeMirror
earns its place where the diff and the overlay need it.

## 5. What this must refuse to do

Each of these is a place where the honest answer is "cannot", and saying
so beats a plausible wrong answer:

- **A checkpoint cannot supply file contents.** Trellis snapshots store
  paths, content *hashes* and edge lists — not blobs. Diffing against a
  checkpoint can say *which* files changed, never *how*. The picker must
  disable content-diff for checkpoint comparands rather than quietly
  falling back to the live file, which would render a diff of a file
  against itself and look like "no changes".
- **An unresolvable line range is not drawn.** If an item pins lines
  40–58 and the file now has 30 lines, the overlay reports the item as
  *unanchored* rather than clamping it to line 30. A marker in the wrong
  place is worse than no marker.
- **Fast-forward does not interpolate content.** Between two frames a
  file either has a recorded state or it does not. Showing a tween of
  source code would be fiction.

## 6. Order

1. **Plan overlay** — smallest, most distinctive, uses data already
   stored.
2. **Diff editor** — needs the CodeMirror dependency and `?at=`.
3. **Fast-forward** — sits on top of both.
4. **Code-first mode** — the shell that makes the graph optional.

## 7. Tests

- An edit with a `lineRange` produces markers on exactly those lines.
- An edit pinned to a `symbol` resolves through the symbols table to the
  symbol's span.
- An edit with neither is a file-level banner, not a whole-file
  highlight.
- A `lineRange` past the end of the file is reported unanchored, never
  clamped.
- `?at=commit:<ref>` returns the file as of that commit; `?at=` a
  checkpoint returns a clear "contents unavailable" rather than the live
  file.
- A file that did not exist at the earlier comparand diffs as wholly
  added.
- Fast-forward over N frames yields N states with stable file identity.

## 8. Done when

- A developer can read a file, see what the plan wants changed in it, and
  click through to the item.
- Any two points can be diffed for a single file, with the unavailable
  combinations disabled rather than wrong.
- A large repository is usable with the graph never mounted.
