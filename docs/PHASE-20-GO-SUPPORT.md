# Phase 20 — Go support

> Drafted: 2026-09-17
> Status: designed, not built
> Depends on: nothing. Blocks: [Phase 21](PHASE-21-SQL-REF-TRACKER.md)'s Go
> ref-tracker half.

---

## 1. Why this first

CodeTrellis is pitched at multi-system architectures — "see how your
frontend talks to your services, and your services to each other." A
large share of those services are Go, and today Go is our worst
supported ecosystem in a specific and damaging way:

`project-scanner.ts` **already** maps `.go` → `go` in `LANG_MAP`, and
`system-discovery.ts` **already** recognises `go.mod` as a manifest
(`ManifestKind` includes it, `SystemLanguage` includes `'go'`, and
`SupportedLanguage` in `src/shared/types/ast.ts` already has `'go'` in
the union). So a Go repo scans, discovers its systems, and draws every
Go file as a node — **with zero symbols and zero edges**.

That is worse than refusing the language. A user opening a Go service
sees a confident, empty constellation and concludes the tool doesn't
work. There is no error to read.

Everything below is filling in the three plugin slots that already
exist for every other language.

## 2. Scope

| In | Out (for now) |
|---|---|
| `parsers/go.ts` — symbols + imports | Generics instantiation detail |
| `resolvers/go.ts` — module-path resolution via `go.mod` / `go.work` | Resolving to files inside the module cache (external deps stay external) |
| `callsites/go.ts` — inbound routes + outbound HTTP | gRPC (own follow-on), message queues |
| `tests/fixtures/sample-app/` Go service + harness tests | Build-tag-aware conditional compilation |
| Vendor and `testdata` exclusion | `cgo` |

`vendor/` is already in the scanner's ignore set. `testdata/` is not and
should be added — it is the Go convention for deliberately broken
fixture source, and parsing it produces noise.

## 3. The grammar — the only real blocker

`resources/tree-sitter/` holds seven `.wasm` grammars. There is no
`tree-sitter-go.wasm`. Nothing else in this phase can be tested until
there is.

Options, in order of preference:

1. **A prebuilt wasm from a package that ships them** (e.g. the
   `tree-sitter-wasms` distribution). Fastest, and matches how the
   other grammars are consumed — we commit the artifact, we don't build
   at install time.
2. **Build from `tree-sitter-go` with the tree-sitter CLI**
   (`tree-sitter build --wasm`), which needs Emscripten or Docker.
   Reproducible but adds a toolchain.

Whichever we pick, **record the provenance**. The existing seven
grammars have no note saying where they came from or what version they
are, which will become a supply-chain question the moment Phase 19's
posture work reaches dependencies. Add `resources/tree-sitter/README.md`
listing grammar → source → version → sha256 for all eight, as part of
this phase.

Sanity check before writing any parser code: load the wasm, parse
`package main\n\nfunc main() {}`, print the root node type. If that
doesn't return `source_file`, stop and fix the grammar.

## 4. `parsers/go.ts`

Contract is `ParserPlugin` from `parsers/base.ts`. Registration is one
line in `parsers/index.ts` — `getPluginForFile` indexes by extension
automatically.

```ts
export const goPlugin: ParserPlugin = {
  language: 'go',
  extensions: ['.go'],
  grammarFile: 'tree-sitter-go.wasm',
  grammarKey: 'go',
  extractSymbols,
  extractImports,
};
```

### Symbols

Walk the top-level children of `source_file`:

| tree-sitter node | `SymbolKind` | Notes |
|---|---|---|
| `function_declaration` | `function` | `name` field |
| `method_declaration` | `function` | Name as `(Receiver).Method` so methods don't collide across types — this is the one place we deviate from raw names, and it matters because Go codebases have dozens of `Handle`/`String`/`Close` |
| `type_declaration` → `type_spec` with `struct_type` | `class` | modifier `struct` |
| `type_declaration` → `type_spec` with `interface_type` | `interface` | modifier `interface` |
| `type_declaration` → other | `type` | aliases, named types |
| `const_declaration` / `var_declaration` | `variable` | one symbol per spec name; skip blank `_` |

`type_declaration` wraps one or more `type_spec` children (grouped
`type ( ... )` blocks), so it needs a nested loop — this is the one
structural difference from the Rust plugin, which can read children
directly.

**Exported vs unexported** is load-bearing in Go and free to capture:
an initial capital means exported. Put `exported` in `modifiers`. It
costs nothing now and lets the graph later distinguish a package's
public surface from its internals — which is exactly the architectural
boundary Go developers care about.

### Imports

`import_declaration` contains either a single `import_spec` or an
`import_spec_list`. Each spec has an optional alias (`name` field) and a
quoted `path`.

```go
import (
    "fmt"                                    // stdlib   → skip at resolve time
    "github.com/org/repo/internal/store"     // in-module → resolvable
    sq "github.com/Masterminds/squirrel"     // external → unresolved
    _ "github.com/lib/pq"                    // blank    → still an edge
)
```

Emit `ImportDeclaration` with `source` = the unquoted path and
`specifiers` = `[alias ?? lastSegment(path)]`. Keep blank (`_`) and dot
(`.`) imports: a blank import is a *deliberate side-effect dependency*
(driver registration) and is architecturally significant — arguably
more so than a normal import, since it is invisible in the call graph.
Mark them in specifiers as `_` / `.` so the resolver and UI can tell.

## 5. `resolvers/go.ts`

Contract is `ResolverPlugin`. This is the part with actual thinking in
it, because Go import paths are *module-qualified*, not
filesystem-relative — the opposite of every resolver we have.

The rule: an import path resolves in-repo iff it is prefixed by a
module path declared in some `go.mod` inside the project.

```
go.mod:    module github.com/org/billing
import:    github.com/org/billing/internal/ledger
           └──────── module ────────┘└─── dir ───┘
→ <dir containing that go.mod>/internal/ledger/*.go
```

Steps:

1. **Build a module index** — for every discovered system with
   `manifestKind === 'go.mod'`, read the `module` line. Cache it as
   `modulePath → rootPath`. `go.work` (multi-module workspaces) adds
   `use ./foo` directives pointing at more module dirs; read it if
   present. This index is per-scan, not per-import — resolving is on a
   hot path and re-reading `go.mod` per import would be pathological on
   a big monorepo.
2. **Longest-prefix match** the import path against the index. Longest
   wins, because nested modules are legal and common.
3. **Map the remainder to a directory**, then pick a file. Go imports a
   *package* (a directory), not a file, so unlike TS there is no single
   target. Resolve to the directory's files in `knownFiles`, preferring
   a file named after the last path segment, then `<segment>.go`, then
   any non-`_test.go` file in that directory. One edge per import is
   what the graph model expects.
4. **Miss → null.** Stdlib (no dot in the first segment, e.g. `fmt`,
   `net/http`) and external modules both resolve to null, which is the
   existing convention for "external dependency".

`findContainingSystem` from `resolvers/base.ts` is not the right helper
here — Go resolution is by module path, not by containment. Worth
stating explicitly in the file header so the next person doesn't
"fix" it to match the Rust resolver.

Edge cases to handle, all of which appear in real repos:

- **`internal/`** — importable only from within the subtree rooted at
  the parent of `internal/`. We resolve it regardless; enforcing the
  rule is a *conformity check*, not a resolution rule, and belongs in
  `check_architecture` later. Noting it here because it is a genuinely
  good future finding: "package X imports Y's internal/".
- **Major version suffixes** — `github.com/org/repo/v2` where the module
  line says `module github.com/org/repo/v2`. Prefix matching handles it
  as long as we don't strip the suffix.
- **`replace` directives** — a `go.mod` can point a module path at a
  local directory. Read them; they are how monorepos wire sibling
  services together, so ignoring them loses exactly the edges we most
  want.

## 6. `callsites/go.ts`

Contract is `CallsiteExtractor`. Per `callsites/base.ts` the MVP is
regex over file content, same as TS and Python. That is a pragmatic
choice we inherit, and for Go it is *more* defensible than usual
because route registration is overwhelmingly a single-line literal.

### Inbound (`http_route`)

| Framework | Pattern |
|---|---|
| stdlib `net/http` | `http.HandleFunc("/path", h)`, `mux.Handle("/path", h)` |
| stdlib 1.22+ | `mux.HandleFunc("GET /path", h)` — method is *inside* the pattern string |
| chi | `r.Get("/path", h)`, `r.Route("/prefix", func(r chi.Router){...})` |
| gin | `r.GET("/path", h)`, `v1.POST("/path", h)` |
| echo | `e.GET("/path", h)` |
| gorilla/mux | `r.HandleFunc("/path", h).Methods("GET")` |

Normalise to the same shape the Python extractor produces, so the
existing matcher pairs them with no changes: gin/echo `:id` is already
our canonical form; chi and stdlib use `{id}`, which `normalizeRoute`
already converts.

**Route prefixes are the known limitation.** `r.Route("/api/v1", ...)`
and `v1 := r.Group("/api/v1")` mean the literal on the handler line is
only the tail of the real path. Regex cannot compose these without
tracking the block structure. Options: (a) accept tail-only matching and
let the matcher do suffix comparison, (b) do a shallow brace-depth scan
to carry an active prefix stack. Recommend **(b)** — it is ~30 lines and
without it every grouped router (which is most production Go) produces
wrong URLs, which is worse than no URLs. If (b) proves fragile, fall
back to (a) and record it.

### Outbound (`http_call`)

`http.Get(url)`, `http.Post(...)`, `client.Do(req)` preceded by
`http.NewRequest("GET", url, ...)` / `http.NewRequestWithContext(ctx, "GET", url, ...)`.
Apply the same `isLikelyApiPath` filter the Python extractor uses so we
don't emit an edge for every string that looks like a URL.

`fmt.Sprintf("%s/api/users", base)` is extremely common in Go clients.
Capture the literal portion (`/api/users`) and let the matcher do
suffix matching — a partial match beats none, and this pattern is too
common to skip.

## 7. Cross-system wiring

`cross-system-service.ts` holds the HTTP matcher inline (there is no
`matchers/` directory yet, despite `callsites/base.ts` referring to
one). Go needs **no matcher changes** if the extractor normalises to the
existing shape. Verify rather than assume: the first integration test
should be a TS `fetch('/api/orders')` pairing with a Go
`r.Get("/api/orders", ...)`.

If this phase does touch that file, extracting the HTTP matcher into
`matchers/http.ts` as the header already promises is a cheap tidy —
but it is optional and must not grow into a refactor.

## 8. Tests

Extend `tests/fixtures/sample-app/` with a small Go service — this is
the fixture the whole harness shares, so it must stay deterministic and
small (~8 files):

```
services/billing/
  go.mod                  module github.com/codetrellis/fixture/billing
  main.go                 route registration (chi, with a group prefix)
  internal/ledger/ledger.go
  internal/ledger/entry.go
  internal/store/store.go  imports a sibling module via a replace directive
  client/orders.go         outbound http.Get to the Python service
  testdata/broken.go       must NOT be parsed
```

`tests/e2e/go-support.test.ts` asserting:

1. Scan produces the expected symbol count and kinds, methods named
   `(Receiver).Method`, exported flagged.
2. In-module imports resolve; stdlib and external resolve to null.
3. A `replace`-directed import resolves to the sibling module.
4. Blank imports produce an edge marked `_`.
5. `testdata/` contributes nothing.
6. Cross-system: the TS fixture's `fetch` pairs with the Go route,
   including through the group prefix.
7. Mutation: adding a route to `main.go` yields a new cross-system edge
   within ~1s without a manual rescan (mirrors the existing
   `cross-system.test.ts` pattern, which is what proved the auto-refresh
   works).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Grammar node names differ from what this doc assumes | Verify against the real wasm before writing extraction; the table in §4 is from the published grammar but grammars drift between versions |
| Route prefix tracking is fragile | Ship (b), keep (a) as the fallback, cover both with fixture routes |
| Big Go monorepos blow the parse budget | The budget already exists (Phase 19, finding 24). Measure on a real repo; do not raise the budget to make Go fit |
| `go.mod` parsing grows into a go.mod parser | We need exactly three things: `module`, `replace`, `use`. Line-based reading, no dependency |

## 10. Done when

- A real Go service (not the fixture) opens with symbols, in-module
  edges, and at least one cross-system edge to another language.
- `go-support.test.ts` green, 5 consecutive runs.
- `resources/tree-sitter/README.md` documents all eight grammars.
- TRACKER §1 "AST Parsing" row says 8 languages with real counts.
