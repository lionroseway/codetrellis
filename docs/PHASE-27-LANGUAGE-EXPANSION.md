# Phase 27 — Language expansion (Ruby, C#, Swift, Kotlin)

> Drafted: 2026-09-17
> Status: designed. **§2 is a live bug, not a feature** — fix it first.
> Pattern: [PHASE-20-GO-SUPPORT.md](PHASE-20-GO-SUPPORT.md) established
> the shape; this follows it.

---

## 1. Where we stand

| Language | Parser | Resolver | Callsites | Notes |
|---|---|---|---|---|
| TypeScript / TSX / JS / JSX | ✅ | ✅ | ✅ | |
| Python | ✅ | ✅ | ✅ | |
| Rust | ✅ | ✅ | — | |
| PHP | ✅ | ✅ | — | |
| Java | ✅ | ✅ | — | |
| Go | ✅ | ✅ | ✅ | Phase 20 |
| SQL | n/a | n/a | ✅ | Phase 21 — symbols + refs, no import graph |
| **Ruby** | ❌ | ❌ | ❌ | **Declared but absent — see §2** |
| C# | ❌ | ❌ | ❌ | |
| Swift | ❌ | ❌ | ❌ | |
| Kotlin | ❌ | ❌ | ❌ | |

## 2. Ruby is the Go bug, live right now

`'ruby'` is in the `SupportedLanguage` union and `.rb` is in the
scanner's `LANG_MAP` — but `parsers/ruby.ts` does not exist.

This is precisely the state Go was in before Phase 20, and it fails the
same way: **a Rails repository scans, discovers its files, draws every
one of them as a node, and shows zero symbols and zero edges.**
Confidently empty, with no error to read. A user concludes the product
does not work, and they are not wrong to.

It is also the third instance of this class in this codebase (the
file-watcher's extension list twice, and now this), which suggests the
real fix is structural: **a language should not be able to appear in
`SupportedLanguage` or `LANG_MAP` without a parser behind it.** A startup
assertion that cross-checks the three lists would have caught all three.
Worth adding as part of this phase.

Ruby is also the cheapest of the four to fix — `tree-sitter-ruby@0.23.1`
ships a prebuilt `.wasm`, so it takes the Go path exactly.

## 3. Grammar availability, measured

Checked 2026-09-17 by packing each npm package and looking inside:

| Grammar | Version | Prebuilt `.wasm`? | External C scanner? | Effort |
|---|---|---|---|---|
| `tree-sitter-ruby` | 0.23.1 | **yes** | — | ~1 day, Go path |
| `tree-sitter-c-sharp` | 0.23.5 | **yes** | — | ~1 day, Go path |
| `tree-sitter-swift` | 0.7.1 | **no** | **yes** | build toolchain first |
| `tree-sitter-kotlin` | 0.3.8 | **no** | **yes** | build toolchain first |

The split is the whole planning story. Ruby and C# are a day each because
the artifact exists and Phase 20 proved the path. Swift and Kotlin need
us to **build the wasm ourselves** with the tree-sitter CLI plus
Emscripten or Docker — a toolchain this repository does not have — and
both grammars have an **external C scanner**, which is where wasm builds
usually go wrong.

Note also that `tree-sitter-wasms@0.1.13` is not a shortcut: its Go build
failed to load under `web-tree-sitter@0.27` during Phase 20 (an
ABI mismatch, surfacing as an opaque dylink error). Assume the same for
its other grammars until proven otherwise.

## 4. Kotlin before Swift

If only one mobile language gets built, it should be **Kotlin**:

- Kotlin covers **Android and a large amount of JVM backend work**, so it
  compounds with the Java parser that already exists — shared resolution
  concepts, and real cross-language edges inside one repo.
- Swift is **iOS-only** in practice, and its grammar is the fussier of
  the two to build.

That said, if the pitch is "we map your mobile app", both are eventually
required. The order is about which one pays for itself first, not which
one matters.

## 5. Per-language notes

### Ruby

- **Symbols**: `class`, `module`, `def`, `def self.`, attr accessors.
  Qualify instance methods as `Class#method` and class methods as
  `Class.method` — the Ruby convention, and the same collision problem Go
  had with `Handle` and `String`.
- **Imports**: `require`, `require_relative`, `load`, and Rails
  autoloading. `require_relative` resolves like a path;
  `require 'foo'` is a load-path lookup. **Rails autoloading resolves
  nothing explicitly at all** — `User` just works — so a Rails app's real
  dependency graph is implied by naming convention, not by imports.
  Worth stating plainly in the plugin header: for a Rails repo, expect
  `require_relative` edges and little else until a convention-based
  resolver exists.
- **Callsites**: `Net::HTTP`, `HTTParty`, `RestClient`; routes in
  `config/routes.rb` (a DSL, not a decorator — closer to chi's grouped
  router than to FastAPI's decorators).

### C#

- **Symbols**: `class`, `record`, `struct`, `interface`, `enum`,
  methods, properties. Namespaces are a container, not a symbol.
- **Imports**: `using` directives resolve by **namespace**, not by file —
  the same module-path problem Go had, with the same shape of solution:
  index namespaces to the files declaring them, then longest-prefix
  match. `.csproj` gives project boundaries the way `go.mod` does.
- **Callsites**: `HttpClient`, and ASP.NET routing attributes
  (`[HttpGet("/api/orders")]`), which are decorator-shaped and should
  pair with the existing HTTP matcher directly.

### Swift / Kotlin

Deferred behind the wasm build. When they land:

- **Swift**: `import` is module-level, and a module is usually a
  target, so resolution is package-manifest-driven (`Package.swift`) —
  again the Go shape.
- **Kotlin**: `import` is package-qualified like Java's, so the existing
  Java resolver's concepts port directly; `build.gradle.kts` gives the
  module boundaries.

## 6. Sequence

1. **Ruby** — it is a live bug, and the grammar is ready.
2. **The structural guard** — assert at startup that every language in
   `LANG_MAP` and `SupportedLanguage` has a parser, so this class of bug
   cannot recur silently.
3. **C#** — grammar ready, and it opens the .NET shop segment.
4. **The wasm build toolchain** — documented, reproducible, and recorded
   in `resources/tree-sitter/README.md` alongside the existing hashes.
5. **Kotlin**, then **Swift**.

## 7. Tests

Per language, mirroring `go-support.test.ts`:

- symbols of every kind the language has, with qualified method names;
- in-project imports resolve, stdlib and external do not;
- the grammar loads under the pinned `web-tree-sitter` (a unit test, as
  `parsers/go.test.ts` does — an incompatible grammar is caught, logged
  and skipped at load, so it otherwise presents as a silently empty
  language);
- a fixture service in the shared fixture, small and deterministic.

And once, for the class of bug in §2: a test asserting that every entry
in `LANG_MAP` that claims to be a parseable source language has a
registered parser.

## 8. Done when

- A Rails repository shows symbols and edges instead of a constellation
  of empty nodes.
- A .NET repository does the same.
- `resources/tree-sitter/README.md` documents how to build a grammar
  wasm from source, and the Swift/Kotlin path is either done or
  explicitly costed.
